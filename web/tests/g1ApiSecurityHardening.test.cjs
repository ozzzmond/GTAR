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

test('AUTH_AND_PERMISSIONS: Account authorization gate intact', async () => {
  const member = { id: 'member-auth', google_sub: 'sub-member-auth', email: 'member@gtar.app', role: 'member', access_status: 'active' }
  const pending = { id: 'pending-auth', google_sub: 'sub-pending-auth', email: 'pending@gtar.app', role: 'member', access_status: 'pending' }
  const denied = { id: 'denied-auth', google_sub: 'sub-denied-auth', email: 'denied@gtar.app', role: 'member', access_status: 'denied' }

  const db = createMockDb([member, pending, denied])
  const env = { DB: db, AUTH_SECRET: TEST_SECRET }
  // The admin gate was removed with its last callers (#453); the account gate is the remaining authority.
  const gate = token => authCore.authenticateUserRequest(new Request('https://gtar.local/api/auth/session', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }), env)

  // 1. Missing Authorization header -> 401
  assert.equal((await gate(null)).status, 401)
  // 2. Pending caller -> 403 Forbidden
  assert.equal((await gate(await authCore.createSessionToken(pending, TEST_SECRET))).status, 403)
  // 3. Denied caller -> 403 Forbidden
  assert.equal((await gate(await authCore.createSessionToken(denied, TEST_SECRET))).status, 403)
  // 4. Active member -> authorized against the D1 record
  assert.equal((await gate(await authCore.createSessionToken(member, TEST_SECRET))).user?.id, member.id)
})

