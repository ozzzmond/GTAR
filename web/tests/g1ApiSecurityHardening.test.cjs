const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
      }).outputText,
      filename
    )
}

const authCore = require('../functions/lib/authCore.ts')
const sessionApi = require('../functions/api/auth/session.ts')
const approveApi = require('../functions/api/admin/approve.ts')
const denyApi = require('../functions/api/admin/deny.ts')
const restoreApi = require('../functions/api/admin/restore.ts')
const syncApi = require('../functions/api/songbook/sync.ts')
const metadataApi = require('../functions/api/songbook/metadata.ts')

const TEST_SECRET = 'g1-test-auth-secret-min-32-chars-long-secure-synthetic'

function createMockDb(users = [], songbooks = new Map(), options = {}) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          const shouldThrowHere = options.shouldThrow &&
            (!options.throwOnSqlPattern || options.throwOnSqlPattern.test(sql)) &&
            (!options.throwWhenArg || args.includes(options.throwWhenArg))
          return {
            async first() {
              if (shouldThrowHere) {
                throw new Error(options.throwMessage || 'CANARY_FIRST_DB_EXCEPTION: SELECT /var/secret/path token=abc')
              }
              if (sql.includes('FROM users WHERE id = ?')) {
                const u = users.find((user) => user.id === args[0])
                return u ? { ...u } : null
              }
              if (sql.includes('FROM users WHERE google_sub = ?')) {
                const u = users.find((user) => user.google_sub === args[0])
                return u ? { ...u } : null
              }
              if (sql.includes('FROM user_songbooks WHERE user_id = ?')) {
                const sb = songbooks.get(args[0])
                return sb ? { ...sb } : null
              }
              if (sql.includes('INSERT INTO user_songbooks') || sql.includes('UPDATE user_songbooks')) {
                // Return version and checksum
                return { version: 1, checksum: args[1] || 'ck_0123456789abcdef', updated_at: new Date().toISOString() }
              }
              return null
            },
            async all() {
              if (shouldThrowHere) {
                throw new Error(options.throwMessage || 'CANARY_ALL_DB_EXCEPTION: SELECT /var/secret')
              }
              return { results: [] }
            },
            async run() {
              if (shouldThrowHere) {
                throw new Error(options.throwMessage || 'CANARY_RUN_DB_EXCEPTION: UPDATE users /var/secret')
              }
              return { success: true }
            },
          }
        },
      }
    },
  }
}

function createStreamRequest(url, chunks, headers = {}) {
  let index = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(typeof chunks[index] === 'string' ? new TextEncoder().encode(chunks[index]) : chunks[index])
        index++
      } else {
        controller.close()
      }
    },
  })
  return new Request(url, {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  })
}

test('S1_JSON_STRUCTURE_VALIDATION: Rejection of null, arrays, primitives, and malformed JSON', async () => {
  const adminUser = {
    id: 'admin-s1',
    google_sub: 'sub-admin-s1',
    email: 'admin@gtar.app',
    role: 'admin',
    access_status: 'active',
  }
  const db = createMockDb([adminUser])
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }
  const adminToken = await authCore.createSessionToken(adminUser, TEST_SECRET)

  const nonObjectPayloads = [
    { label: 'null', body: 'null' },
    { label: 'array', body: '[1, 2, 3]' },
    { label: 'string', body: '"plain text string"' },
    { label: 'number', body: '12345' },
    { label: 'boolean', body: 'true' },
    { label: 'malformed_json', body: '{"broken": json' },
    { label: 'empty_string', body: '   ' },
  ]

  // Test admin endpoints
  for (const endpoint of [approveApi, denyApi, restoreApi]) {
    for (const { label, body } of nonObjectPayloads) {
      const req = new Request('https://gtar.local/api/admin/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body,
      })
      const res = await endpoint.onRequestPost({ request: req, env })
      assert.equal(res.status, 400, `Expected 400 for ${label} on admin endpoint`)
      const json = await res.json()
      assert.equal(json.success, false)
      assert.match(json.error, /Malformed JSON|invalid/i)
    }
  }

  // Test session endpoint
  for (const { label, body } of nonObjectPayloads) {
    const req = new Request('https://gtar.local/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    const res = await sessionApi.onRequestPost({ request: req, env })
    assert.equal(res.status, 400, `Expected 400 for ${label} on session endpoint`)
    const json = await res.json()
    assert.equal(json.success, false)
    assert.match(json.error, /Malformed JSON/i)
  }

  // Test songbook sync endpoint
  for (const { label, body } of nonObjectPayloads) {
    const req = new Request('https://gtar.local/api/songbook/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body,
    })
    const res = await syncApi.onRequestPost({ request: req, env })
    assert.equal(res.status, 400, `Expected 400 for ${label} on songbook sync endpoint`)
    const json = await res.json()
    assert.equal(json.success, false)
    assert.match(json.error, /Malformed JSON|Missing required data/i)
  }

  // Test songbook metadata endpoint
  for (const { label, body } of nonObjectPayloads) {
    const req = new Request('https://gtar.local/api/songbook/metadata', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body,
    })
    const res = await metadataApi.onRequestPost({ request: req, env: { ...env, AI: { run: async () => ({}) } } })
    assert.equal(res.status, 400, `Expected 400 for ${label} on songbook metadata endpoint`)
    const json = await res.json()
    assert.equal(json.success, false)
    assert.match(json.error, /Invalid JSON body|valid JSON object|Title is required/i)
  }
})

test('S1_FIELD_TYPE_VALIDATION: Rejection of invalid field types for sensitive and required properties', async () => {
  const adminUser = {
    id: 'admin-fields',
    google_sub: 'sub-admin-fields',
    email: 'admin@gtar.app',
    role: 'admin',
    access_status: 'active',
  }
  const db = createMockDb([adminUser])
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }
  const adminToken = await authCore.createSessionToken(adminUser, TEST_SECRET)

  // 1. Session: invalid idToken / credential types
  const badSessionBodies = [
    { idToken: 123 },
    { idToken: true },
    { idToken: {} },
    { idToken: [] },
    { credential: 456 },
    { credential: null },
    { idToken: '' },
    { idToken: '   ' },
    {},
  ]
  for (const body of badSessionBodies) {
    const req = new Request('https://gtar.local/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const res = await sessionApi.onRequestPost({ request: req, env })
    assert.equal(res.status, 400)
    const json = await res.json()
    assert.equal(json.success, false)
    assert.match(json.error, /Missing required Google identity token/i)
  }

  // 2. Admin: invalid userId types
  const badAdminBodies = [
    { userId: 123 },
    { userId: true },
    { userId: {} },
    { userId: [] },
    { userId: null },
    { userId: '' },
    { userId: '   ' },
    {},
  ]
  for (const endpoint of [approveApi, denyApi, restoreApi]) {
    for (const body of badAdminBodies) {
      const req = new Request('https://gtar.local/api/admin/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(body),
      })
      const res = await endpoint.onRequestPost({ request: req, env })
      assert.equal(res.status, 400)
      const json = await res.json()
      assert.equal(json.success, false)
      assert.match(json.error, /Missing required userId parameter/i)
    }
  }

  // 3. Metadata: invalid title and field types
  const badMetadataBodies = [
    { title: 123 },
    { title: true },
    { title: {} },
    { title: [] },
    { title: '' },
    { title: '   ' },
    { title: 'Valid Title', artist: 123 },
    { title: 'Valid Title', currentKey: 456 },
    { title: 'Valid Title', tempo: [] },
    { title: 'Valid Title', timeSignature: 123 },
    { title: 'Valid Title', year: {} },
  ]
  for (const body of badMetadataBodies) {
    const req = new Request('https://gtar.local/api/songbook/metadata', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(body),
    })
    const res = await metadataApi.onRequestPost({ request: req, env: { ...env, AI: { run: async () => ({}) } } })
    assert.equal(res.status, 400)
    const json = await res.json()
    assert.equal(json.success, false)
  }
})

test('S1_PAYLOAD_SIZE_BOUNDARIES: Exact limit, 1-byte overflow, missing/invalid Content-Length, streaming', async () => {
  const adminUser = {
    id: 'admin-limits',
    google_sub: 'sub-admin-limits',
    email: 'admin@gtar.app',
    role: 'admin',
    access_status: 'active',
  }
  const db = createMockDb([adminUser])
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }
  const adminToken = await authCore.createSessionToken(adminUser, TEST_SECRET)

  // 1. Session: limit 32KB
  assert.equal(sessionApi.MAX_SESSION_PAYLOAD_BYTES, 32 * 1024)
  const sessionLimit = 32 * 1024
  // 1-byte overflow via Content-Length precheck
  const reqSessionOverCL = new Request('https://gtar.local/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Length': String(sessionLimit + 1), 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: 'a' }),
  })
  const resSessionOverCL = await sessionApi.onRequestPost({ request: reqSessionOverCL, env })
  assert.equal(resSessionOverCL.status, 413)

  // Streamed 1-byte overflow without Content-Length
  const padOver = 'x'.repeat(sessionLimit)
  const streamedSessionOver = createStreamRequest('https://gtar.local/api/auth/session', [
    '{"idToken":"',
    padOver,
    '"}',
  ])
  const resStreamedSessionOver = await sessionApi.onRequestPost({ request: streamedSessionOver, env })
  assert.equal(resStreamedSessionOver.status, 413)

  // 2. Admin: limit 16KB
  assert.equal(approveApi.MAX_ADMIN_PAYLOAD_BYTES, 16 * 1024)
  const adminLimit = 16 * 1024
  // 1-byte overflow via Content-Length
  const reqAdminOverCL = new Request('https://gtar.local/api/admin/approve', {
    method: 'POST',
    headers: {
      'Content-Length': String(adminLimit + 1),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ userId: 'user-1' }),
  })
  const resAdminOverCL = await approveApi.onRequestPost({ request: reqAdminOverCL, env })
  assert.equal(resAdminOverCL.status, 413)

  // Streamed overflow with non-numeric Content-Length header
  const adminPadOver = 'y'.repeat(adminLimit)
  const streamedAdminOver = createStreamRequest(
    'https://gtar.local/api/admin/approve',
    ['{"userId":"', adminPadOver, '"}'],
    { 'Content-Length': 'not-a-number', Authorization: `Bearer ${adminToken}` }
  )
  const resStreamedAdminOver = await approveApi.onRequestPost({ request: streamedAdminOver, env })
  assert.equal(resStreamedAdminOver.status, 413)

  // 3. Metadata: limit 64KB
  assert.equal(metadataApi.MAX_METADATA_PAYLOAD_BYTES, 64 * 1024)
  const metaLimit = 64 * 1024
  const reqMetaOverCL = new Request('https://gtar.local/api/songbook/metadata', {
    method: 'POST',
    headers: {
      'Content-Length': String(metaLimit + 1),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ title: 'A' }),
  })
  const resMetaOverCL = await metadataApi.onRequestPost({ request: reqMetaOverCL, env: { ...env, AI: { run: async () => ({}) } } })
  assert.equal(resMetaOverCL.status, 413)

  // 4. Sync: limit 2MB
  assert.equal(syncApi.MAX_SONGBOOK_PAYLOAD_BYTES, 2 * 1024 * 1024)
  const syncLimit = 2 * 1024 * 1024
  const reqSyncOverCL = new Request('https://gtar.local/api/songbook/sync', {
    method: 'POST',
    headers: {
      'Content-Length': String(syncLimit + 1),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ data: { songs: [], setlists: [] } }),
  })
  const resSyncOverCL = await syncApi.onRequestPost({ request: reqSyncOverCL, env })
  assert.equal(resSyncOverCL.status, 413)
})

test('S4_CANARY_SANITIZATION: Server exceptions never expose internal diagnostics, SQL, paths, or tokens', async () => {
  const CANARY_SQL_ERR = 'CANARY_D1_ERROR: table users column secret_token /var/run/gtar.sqlite leaked password_hash'
  const CANARY_AI_ERR = 'CANARY_WORKERS_AI_FAIL: model @cf/meta/llama-3-8b secret_token=sk-999 /app/worker.ts'

  const activeUser = {
    id: 'user-canary',
    google_sub: 'sub-canary',
    email: 'canary@gtar.app',
    role: 'admin',
    access_status: 'active',
  }
  const token = await authCore.createSessionToken(activeUser, TEST_SECRET)

  // 1. Songbook Sync GET exception sanitization
  const failingDbSyncGet = createMockDb([activeUser], new Map(), {
    shouldThrow: true,
    throwOnSqlPattern: /user_songbooks/i,
    throwMessage: CANARY_SQL_ERR,
  })
  const syncGetReq = new Request('https://gtar.local/api/songbook/sync', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const syncGetRes = await syncApi.onRequestGet({ request: syncGetReq, env: { DB: failingDbSyncGet, AUTH_SECRET: TEST_SECRET } })
  assert.equal(syncGetRes.status, 500)
  const syncGetJson = await syncGetRes.json()
  assert.equal(syncGetJson.success, false)
  assert.equal(syncGetJson.error, 'Failed to retrieve cloud songbook')
  const syncGetStr = JSON.stringify(syncGetJson)
  assert.ok(!syncGetStr.includes('CANARY'))
  assert.ok(!syncGetStr.includes('secret_token'))
  assert.ok(!syncGetStr.includes('/var/run'))

  // 2. Songbook Sync POST exception sanitization
  const failingDbSyncPost = createMockDb([activeUser], new Map(), {
    shouldThrow: true,
    throwOnSqlPattern: /user_songbooks/i,
    throwMessage: CANARY_SQL_ERR,
  })
  const syncPostReq = new Request('https://gtar.local/api/songbook/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      data: { songs: [{ title: 'Test', rawContent: 'C G Am F' }], setlists: [] },
      expectedVersion: 0,
      expectedChecksum: null,
    }),
  })
  const syncPostRes = await syncApi.onRequestPost({ request: syncPostReq, env: { DB: failingDbSyncPost, AUTH_SECRET: TEST_SECRET } })
  assert.equal(syncPostRes.status, 500)
  const syncPostJson = await syncPostRes.json()
  assert.equal(syncPostJson.success, false)
  assert.equal(syncPostJson.error, 'Failed to persist cloud songbook')
  const syncPostStr = JSON.stringify(syncPostJson)
  assert.ok(!syncPostStr.includes('CANARY'))
  assert.ok(!syncPostStr.includes('secret_token'))
  assert.ok(!syncPostStr.includes('/var/run'))

  // 3. Songbook Metadata POST exception sanitization
  const normalDb = createMockDb([activeUser])
  const failingAi = {
    AI: {
      async run() {
        throw new Error(CANARY_AI_ERR)
      },
    },
  }
  const metaReq = new Request('https://gtar.local/api/songbook/metadata', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title: 'Wonderwall' }),
  })
  const metaRes = await metadataApi.onRequestPost({
    request: metaReq,
    env: { DB: normalDb, AUTH_SECRET: TEST_SECRET, ...failingAi },
  })
  assert.equal(metaRes.status, 500)
  const metaJson = await metaRes.json()
  assert.equal(metaJson.success, false)
  assert.equal(metaJson.error, 'Workers AI execution failed: Inference service error')
  const metaStr = JSON.stringify(metaJson)
  assert.ok(!metaStr.includes('CANARY'))
  assert.ok(!metaStr.includes('sk-999'))
  assert.ok(!metaStr.includes('/app/worker.ts'))

  // 4. Admin approve/deny/restore unexpected DB exception sanitization
  for (const endpoint of [approveApi, denyApi, restoreApi]) {
    const failingDbAdmin = createMockDb([activeUser], new Map(), {
      shouldThrow: true,
      throwWhenArg: 'other-user',
      throwMessage: CANARY_SQL_ERR,
    })
    const adminReq = new Request('https://gtar.local/api/admin/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId: 'other-user' }),
    })
    const adminRes = await endpoint.onRequestPost({ request: adminReq, env: { DB: failingDbAdmin, AUTH_SECRET: TEST_SECRET } })
    assert.equal(adminRes.status, 500)
    const adminJson = await adminRes.json()
    assert.equal(adminJson.success, false)
    assert.ok(!JSON.stringify(adminJson).includes('secret_token'))
  }
})

test('AUTH_AND_PERMISSIONS: Administrative authorization and self-denial guards intact', async () => {
  const admin = { id: 'admin-auth', google_sub: 'sub-admin-auth', email: 'admin@gtar.app', role: 'admin', access_status: 'active' }
  const member = { id: 'member-auth', google_sub: 'sub-member-auth', email: 'member@gtar.app', role: 'member', access_status: 'active' }
  const pending = { id: 'pending-auth', google_sub: 'sub-pending-auth', email: 'pending@gtar.app', role: 'member', access_status: 'pending' }
  const target = { id: 'target-user', google_sub: 'sub-target', email: 'target@gtar.app', role: 'member', access_status: 'pending' }

  const db = createMockDb([admin, member, pending, target])
  const env = { DB: db, AUTH_SECRET: TEST_SECRET }

  const adminToken = await authCore.createSessionToken(admin, TEST_SECRET)
  const memberToken = await authCore.createSessionToken(member, TEST_SECRET)
  const pendingToken = await authCore.createSessionToken(pending, TEST_SECRET)

  // 1. Missing Authorization header -> 401
  const noAuthReq = new Request('https://gtar.local/api/admin/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: target.id }),
  })
  const noAuthRes = await approveApi.onRequestPost({ request: noAuthReq, env })
  assert.equal(noAuthRes.status, 401)

  // 2. Member caller -> 403 Forbidden
  const memberReq = new Request('https://gtar.local/api/admin/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({ userId: target.id }),
  })
  const memberRes = await approveApi.onRequestPost({ request: memberReq, env })
  assert.equal(memberRes.status, 403)

  // 3. Pending caller -> 403 Forbidden
  const pendingReq = new Request('https://gtar.local/api/admin/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pendingToken}` },
    body: JSON.stringify({ userId: target.id }),
  })
  const pendingRes = await approveApi.onRequestPost({ request: pendingReq, env })
  assert.equal(pendingRes.status, 403)

  // 4. Admin self-denial forbidden -> 400
  const selfDenyReq = new Request('https://gtar.local/api/admin/deny', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ userId: admin.id }),
  })
  const selfDenyRes = await denyApi.onRequestPost({ request: selfDenyReq, env })
  assert.equal(selfDenyRes.status, 400)
  const selfDenyJson = await selfDenyRes.json()
  assert.equal(selfDenyJson.success, false)
  assert.match(selfDenyJson.error, /Self-denial forbidden/i)
})

test('CONFLICTS_AND_VALID_REQUESTS: Optimistic concurrency and valid client flows remain intact', async () => {
  const activeUser = {
    id: 'user-valid',
    google_sub: 'sub-valid',
    email: 'valid@gtar.app',
    role: 'admin',
    access_status: 'active',
  }
  const targetUser = {
    id: 'user-target-valid',
    google_sub: 'sub-target-valid',
    email: 'target@gtar.app',
    role: 'member',
    access_status: 'pending',
  }
  const db = createMockDb([activeUser, targetUser])
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }
  const token = await authCore.createSessionToken(activeUser, TEST_SECRET)

  // 1. Valid Admin approve
  const approveReq = new Request('https://gtar.local/api/admin/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId: targetUser.id }),
  })
  const approveRes = await approveApi.onRequestPost({ request: approveReq, env })
  assert.equal(approveRes.status, 200)
  const approveJson = await approveRes.json()
  assert.equal(approveJson.success, true)
  assert.equal(approveJson.access_status, 'active')

  // 2. Valid Admin deny
  const denyReq = new Request('https://gtar.local/api/admin/deny', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId: targetUser.id }),
  })
  const denyRes = await denyApi.onRequestPost({ request: denyReq, env })
  assert.equal(denyRes.status, 200)
  const denyJson = await denyRes.json()
  assert.equal(denyJson.success, true)
  assert.equal(denyJson.access_status, 'denied')

  // 3. Valid Admin restore
  const restoreReq = new Request('https://gtar.local/api/admin/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId: targetUser.id }),
  })
  const restoreRes = await restoreApi.onRequestPost({ request: restoreReq, env })
  assert.equal(restoreRes.status, 200)
  const restoreJson = await restoreRes.json()
  assert.equal(restoreJson.success, true)
  assert.equal(restoreJson.access_status, 'active')

  // 4. Revision conflict in Songbook Sync -> 409
  const conflictReq = new Request('https://gtar.local/api/songbook/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      data: { songs: [{ title: 'Wonderwall', rawContent: 'Em7 G Dsus4 A7sus4' }], setlists: [] },
      expectedVersion: 5, // Non-zero version without matching valid checksum format
      expectedChecksum: 'invalid_checksum',
    }),
  })
  const conflictRes = await syncApi.onRequestPost({ request: conflictReq, env })
  assert.equal(conflictRes.status, 409)
  const conflictJson = await conflictRes.json()
  assert.equal(conflictJson.success, false)
  assert.equal(conflictJson.code, 'SONGBOOK_REVISION_CONFLICT')

  // 5. Valid Songbook Sync POST with valid initial base (version: 0, checksum: null)
  const validSyncReq = new Request('https://gtar.local/api/songbook/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      data: { songs: [{ title: 'Wonderwall', rawContent: 'Em7 G Dsus4 A7sus4' }], setlists: [] },
      expectedVersion: 0,
      expectedChecksum: null,
    }),
  })
  const validSyncRes = await syncApi.onRequestPost({ request: validSyncReq, env })
  assert.equal(validSyncRes.status, 200)
  const validSyncJson = await validSyncRes.json()
  assert.equal(validSyncJson.success, true)
  assert.equal(validSyncJson.userId, activeUser.id)

  // 6. Valid Songbook Sync GET
  const validGetReq = new Request('https://gtar.local/api/songbook/sync', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const validGetRes = await syncApi.onRequestGet({ request: validGetReq, env })
  assert.equal(validGetRes.status, 200)
  const validGetJson = await validGetRes.json()
  assert.equal(validGetJson.success, true)
})
