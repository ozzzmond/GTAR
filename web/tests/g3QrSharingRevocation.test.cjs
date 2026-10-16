const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
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

const webDir = path.resolve(__dirname, '..')
const shareApi = require(path.join(webDir, 'functions/api/setlist/share.ts'))
const revokeApi = require(path.join(webDir, 'functions/api/setlist/revoke.ts'))
const authCore = require(path.join(webDir, 'functions/lib/authCore.ts'))
const { extractShareToken, sanitizeSetlistForShare } = require(path.join(webDir, 'src/utils/sharedSetlist.ts'))
const { generateQrSvgDataUri } = require(path.join(webDir, 'src/utils/qrCode.ts'))

const TEST_SECRET = 'disposable-test-secret-gtar-g3-qr-sharing-32-chars!'

function createTestSqliteDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON;')

  const migrationFiles = [
    '0001_users.sql',
    '0002_songbook_sync.sql',
    '0003_shared_setlists.sql',
    '0004_shared_catalog.sql',
    '0005_shared_setlists_revocation.sql',
  ]

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(webDir, 'migrations', file), 'utf8')
    sqlite.exec(sql)
  }

  const db = {
    sqlite,
    prepare(sql) {
      let bound = []
      return {
        bind(...args) {
          bound = args
          return this
        },
        async first() {
          return sqlite.prepare(sql).get(...bound) ?? null
        },
        async all() {
          return { success: true, results: sqlite.prepare(sql).all(...bound) }
        },
        async run() {
          const res = sqlite.prepare(sql).run(...bound)
          return { success: true, meta: res }
        },
      }
    },
  }

  return { sqlite, db }
}

function makeUser(user) {
  return {
    id: user.id,
    google_sub: user.google_sub || `sub-${user.id}`,
    email: user.email || `${user.id}@example.com`,
    display_name: user.display_name || user.id,
    role: user.role || 'member',
    access_status: user.access_status || 'active',
  }
}

async function seedUser(sqlite, user) {
  const fullUser = makeUser(user)
  const now = new Date().toISOString()
  sqlite
    .prepare(
      `INSERT INTO users (id, google_sub, email, display_name, role, access_status, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fullUser.id,
      fullUser.google_sub,
      fullUser.email,
      fullUser.display_name,
      fullUser.role,
      fullUser.access_status,
      now,
      now,
      now
    )
  return fullUser
}

test('1. MIGRATION_0005_SCHEMA: Additive columns and indexes apply cleanly over 0001-0004', () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON;')

  for (const file of ['0001_users.sql', '0002_songbook_sync.sql', '0003_shared_setlists.sql', '0004_shared_catalog.sql']) {
    sqlite.exec(fs.readFileSync(path.join(webDir, 'migrations', file), 'utf8'))
  }

  // Insert a pre-existing legacy record
  const legacySql = `INSERT INTO shared_setlists (share_token, setlist_name, payload_json, created_at, expires_at)
                     VALUES ('legacy-tok-1234', 'Historical Sunday', '{"version":1}', '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z');`
  sqlite.exec(legacySql)

  // Now apply 0005 additive migration
  const mig0005 = fs.readFileSync(path.join(webDir, 'migrations', '0005_shared_setlists_revocation.sql'), 'utf8')
  assert.doesNotThrow(() => sqlite.exec(mig0005), 'Migration 0005 must execute without error')

  // Verify column existence via PRAGMA
  const cols = sqlite.prepare('PRAGMA table_info(shared_setlists);').all().map((c) => c.name)
  assert.ok(cols.includes('creator_user_id'), 'Column creator_user_id exists')
  assert.ok(cols.includes('is_revoked'), 'Column is_revoked exists')
  assert.ok(cols.includes('revoked_at'), 'Column revoked_at exists')
  assert.ok(cols.includes('revoked_by_user_id'), 'Column revoked_by_user_id exists')

  // Verify legacy record was preserved with null creator and unrevoked status
  const legacyRow = sqlite.prepare('SELECT * FROM shared_setlists WHERE share_token = ?').get('legacy-tok-1234')
  assert.ok(legacyRow, 'Legacy row preserved')
  assert.equal(legacyRow.creator_user_id, null, 'Legacy record has null creator')
  assert.equal(legacyRow.is_revoked, 0, 'Legacy record defaults to unrevoked')
  assert.equal(legacyRow.revoked_at, null)
  assert.equal(legacyRow.revoked_by_user_id, null)
})

test('2. SHARE_CREATION_OWNER_BINDING_AND_128BIT_ENTROPY: Created share is bound to creator and has >= 128 bits of entropy', async () => {
  shareApi._resetRateLimitsForTesting()
  const { sqlite, db } = createTestSqliteDb()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const creator = await seedUser(sqlite, { id: 'user-creator-1', role: 'member', access_status: 'active' })
  const token = await authCore.createSessionToken(creator, TEST_SECRET)

  const payload = {
    type: 'GTAR_SHARED_SETLIST',
    name: 'Easter Morning',
    songs: [{ title: 'Alive in Us', rawContent: '[G]Alive in us' }],
  }

  const req = new Request('https://gtar.pages.dev/api/setlist/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  const res = await shareApi.onRequestPost({ request: req, env })
  assert.equal(res.status, 200, 'Share creation should succeed')
  const data = await res.json()

  // 128 bits = 16 bytes = 32 hexadecimal characters
  assert.match(data.token, /^[a-f0-9]{32}$/, 'Share token must be 32 lowercase hex chars (128 bits entropy)')
  assert.equal(data.name, 'Easter Morning')
  assert.equal(data.songCount, 1)

  // Verify DB record binding
  const row = sqlite.prepare('SELECT * FROM shared_setlists WHERE share_token = ?').get(data.token)
  assert.ok(row, 'Row inserted into shared_setlists')
  assert.equal(row.creator_user_id, creator.id, 'Share is bound to creator user ID')
  assert.equal(row.is_revoked, 0, 'Share starts unrevoked')
  assert.equal(row.revoked_at, null)
})

test('3. TOKEN_COLLISION_HANDLING: Safely retries on primary key collision without overwriting', async () => {
  shareApi._resetRateLimitsForTesting()
  const { sqlite, db } = createTestSqliteDb()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const user = await seedUser(sqlite, { id: 'user-collision-1', role: 'member', access_status: 'active' })
  const authToken = await authCore.createSessionToken(user, TEST_SECRET)

  let attemptCount = 0
  const originalPrepare = db.prepare.bind(db)
  const collisionDb = {
    prepare(sql) {
      if (sql.includes('INSERT INTO shared_setlists')) {
        attemptCount++
        if (attemptCount === 1) {
          return {
            bind() { return this },
            async run() {
              throw new Error('UNIQUE constraint failed: shared_setlists.share_token')
            },
          }
        }
      }
      return originalPrepare(sql)
    },
  }

  const req = new Request('https://gtar.pages.dev/api/setlist/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      type: 'GTAR_SHARED_SETLIST',
      name: 'Collision Setlist',
      songs: [{ title: 'Resilience', rawContent: '[C]Chord' }],
    }),
  })

  const res = await shareApi.onRequestPost({ request: req, env: { ...env, DB: collisionDb } })
  assert.equal(res.status, 200, 'Share creation succeeds on second attempt after collision')
  assert.equal(attemptCount, 2, 'Two attempts were made')
  const data = await res.json()
  assert.match(data.token, /^[a-f0-9]{32}$/)
})

test('4. OWNER_REVOCATION_AND_IDEMPOTENCE: Verified owner can revoke; repeated calls are idempotent', async () => {
  shareApi._resetRateLimitsForTesting()
  const { sqlite, db } = createTestSqliteDb()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const owner = await seedUser(sqlite, { id: 'user-owner-1', role: 'member', access_status: 'active' })
  const ownerToken = await authCore.createSessionToken(owner, TEST_SECRET)

  // Create share
  const postReq = new Request('https://gtar.pages.dev/api/setlist/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ type: 'GTAR_SHARED_SETLIST', name: 'My Setlist', songs: [{ title: 'S1', rawContent: '[D]C' }] }),
  })
  const postRes = await shareApi.onRequestPost({ request: postReq, env })
  const { token: shareToken } = await postRes.json()

  // First revocation via POST /api/setlist/revoke
  const revokeReq1 = new Request('https://gtar.pages.dev/api/setlist/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ token: shareToken }),
  })
  const revokeRes1 = await revokeApi.onRequestPost({ request: revokeReq1, env })
  assert.equal(revokeRes1.status, 200, 'Owner revocation returns HTTP 200')
  const revokeData1 = await revokeRes1.json()
  assert.equal(revokeData1.success, true)
  assert.equal(revokeData1.revoked, true)

  // Verify DB state
  const rowAfter1 = sqlite.prepare('SELECT is_revoked, revoked_by_user_id, revoked_at FROM shared_setlists WHERE share_token = ?').get(shareToken)
  assert.equal(rowAfter1.is_revoked, 1)
  assert.equal(rowAfter1.revoked_by_user_id, owner.id)
  assert.ok(rowAfter1.revoked_at)

  // Second revocation (idempotent repeat)
  const revokeReq2 = new Request('https://gtar.pages.dev/api/setlist/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ token: shareToken }),
  })
  const revokeRes2 = await revokeApi.onRequestPost({ request: revokeReq2, env })
  assert.equal(revokeRes2.status, 200, 'Repeated revocation is idempotent and returns HTTP 200')
  const revokeData2 = await revokeRes2.json()
  assert.equal(revokeData2.alreadyRevoked, true)

  // DELETE /api/setlist/share is also supported
  const deleteReq = new Request(`https://gtar.pages.dev/api/setlist/share?token=${shareToken}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` },
  })
  const deleteRes = await shareApi.onRequestDelete({ request: deleteReq, env })
  assert.equal(deleteRes.status, 200, 'DELETE method also revokes idempotently')
})

test('5. ADMIN_REVOCATION: Administrator can revoke shares created by other users', async () => {
  shareApi._resetRateLimitsForTesting()
  const { sqlite, db } = createTestSqliteDb()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const creator = await seedUser(sqlite, { id: 'user-member-2', role: 'member', access_status: 'active' })
  const admin = await seedUser(sqlite, { id: 'user-admin-1', role: 'admin', access_status: 'active' })

  const creatorToken = await authCore.createSessionToken(creator, TEST_SECRET)
  const adminToken = await authCore.createSessionToken(admin, TEST_SECRET)

  const postRes = await shareApi.onRequestPost({
    request: new Request('https://gtar.pages.dev/api/setlist/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creatorToken}` },
      body: JSON.stringify({ type: 'GTAR_SHARED_SETLIST', name: 'Member Set', songs: [{ title: 'Song', rawContent: '[A]Chord' }] }),
    }),
    env,
  })
  const { token: shareToken } = await postRes.json()

  // Admin revokes creator's share
  const revokeReq = new Request('https://gtar.pages.dev/api/setlist/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ token: shareToken }),
  })
  const revokeRes = await revokeApi.onRequestPost({ request: revokeReq, env })
  assert.equal(revokeRes.status, 200, 'Admin can revoke another user share')
  const row = sqlite.prepare('SELECT is_revoked, revoked_by_user_id FROM shared_setlists WHERE share_token = ?').get(shareToken)
  assert.equal(row.is_revoked, 1)
  assert.equal(row.revoked_by_user_id, admin.id)
})

test('6. NON_OWNER_REJECTION: Regular member cannot revoke another member share', async () => {
  shareApi._resetRateLimitsForTesting()
  const { sqlite, db } = createTestSqliteDb()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const owner = await seedUser(sqlite, { id: 'user-real-owner', role: 'member', access_status: 'active' })
  const stranger = await seedUser(sqlite, { id: 'user-stranger', role: 'member', access_status: 'active' })

  const ownerToken = await authCore.createSessionToken(owner, TEST_SECRET)
  const strangerToken = await authCore.createSessionToken(stranger, TEST_SECRET)

  const postRes = await shareApi.onRequestPost({
    request: new Request('https://gtar.pages.dev/api/setlist/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ type: 'GTAR_SHARED_SETLIST', name: 'Owner Set', songs: [{ title: 'S1', rawContent: '[E]E' }] }),
    }),
    env,
  })
  const { token: shareToken } = await postRes.json()

  // Stranger attempts to revoke
  const revokeReq = new Request('https://gtar.pages.dev/api/setlist/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${strangerToken}` },
    body: JSON.stringify({ token: shareToken }),
  })
  const revokeRes = await revokeApi.onRequestPost({ request: revokeReq, env })
  assert.equal(revokeRes.status, 403, 'Unauthorized non-owner receives HTTP 403')
  const errData = await revokeRes.json()
  assert.equal(errData.error, 'FORBIDDEN_NOT_SHARE_OWNER')

  // Verify share remains unrevoked
  const row = sqlite.prepare('SELECT is_revoked FROM shared_setlists WHERE share_token = ?').get(shareToken)
  assert.equal(row.is_revoked, 0, 'Share remains unrevoked')
})

test('7. ANONYMOUS_REJECTION: Unauthenticated calls to create, retrieve, and revoke return 401', async () => {
  shareApi._resetRateLimitsForTesting()
  const { db } = createTestSqliteDb()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  // Anonymous POST
  const postRes = await shareApi.onRequestPost({
    request: new Request('https://gtar.pages.dev/api/setlist/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'GTAR_SHARED_SETLIST', name: 'Anon', songs: [{ title: 'S', rawContent: 'C' }] }),
    }),
    env,
  })
  assert.equal(postRes.status, 401)

  // Anonymous GET
  const getRes = await shareApi.onRequestGet({
    request: new Request('https://gtar.pages.dev/api/setlist/share?token=0123456789abcdef0123456789abcdef', { method: 'GET' }),
    env,
  })
  assert.equal(getRes.status, 401)

  // Anonymous Revoke
  const revokeRes = await revokeApi.onRequestPost({
    request: new Request('https://gtar.pages.dev/api/setlist/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '0123456789abcdef0123456789abcdef' }),
    }),
    env,
  })
  assert.equal(revokeRes.status, 401)
})

test('8. REVOKED_LINK_RETRIEVAL_REJECTION: Revoked share cannot be retrieved through normal GET', async () => {
  shareApi._resetRateLimitsForTesting()
  const { sqlite, db } = createTestSqliteDb()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const owner = await seedUser(sqlite, { id: 'user-owner-3', role: 'member', access_status: 'active' })
  const recipient = await seedUser(sqlite, { id: 'user-recipient-1', role: 'member', access_status: 'active' })

  const ownerToken = await authCore.createSessionToken(owner, TEST_SECRET)
  const recipientToken = await authCore.createSessionToken(recipient, TEST_SECRET)

  const postRes = await shareApi.onRequestPost({
    request: new Request('https://gtar.pages.dev/api/setlist/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ type: 'GTAR_SHARED_SETLIST', name: 'Will Revoke', songs: [{ title: 'Soon Gone', rawContent: '[F]Chord' }] }),
    }),
    env,
  })
  const { token: shareToken } = await postRes.json()

  // Recipient can retrieve initially
  const getRes1 = await shareApi.onRequestGet({
    request: new Request(`https://gtar.pages.dev/api/setlist/share?token=${shareToken}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${recipientToken}` },
    }),
    env,
  })
  assert.equal(getRes1.status, 200)

  // Owner revokes
  await revokeApi.onRequestPost({
    request: new Request('https://gtar.pages.dev/api/setlist/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ token: shareToken }),
    }),
    env,
  })

  // Recipient retrieval fails with 410 SHARED_SETLIST_REVOKED
  const getRes2 = await shareApi.onRequestGet({
    request: new Request(`https://gtar.pages.dev/api/setlist/share?token=${shareToken}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${recipientToken}` },
    }),
    env,
  })
  assert.equal(getRes2.status, 410, 'Revoked share retrieval returns HTTP 410')
  const getData2 = await getRes2.json()
  assert.equal(getData2.error, 'SHARED_SETLIST_REVOKED')
  assert.equal(getData2.setlist, undefined, 'Payload is not leaked')
})

test('9. EXPIRED_LINK_REJECTION: Expired share returns HTTP 410 SHARED_SETLIST_EXPIRED', async () => {
  shareApi._resetRateLimitsForTesting()
  const { sqlite, db } = createTestSqliteDb()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const user = await seedUser(sqlite, { id: 'user-active-exp', role: 'member', access_status: 'active' })
  const token = await authCore.createSessionToken(user, TEST_SECRET)

  const expiredToken = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const past = new Date(Date.now() - 10000).toISOString()
  sqlite
    .prepare(
      `INSERT INTO shared_setlists (share_token, setlist_name, payload_json, created_at, expires_at, is_revoked)
       VALUES (?, 'Expired Set', '{"version":1,"type":"GTAR_SHARED_SETLIST","name":"E","createdAt":"2026-01-01","songs":[{"title":"S","rawContent":"C"}]}', ?, ?, 0)`
    )
    .run(expiredToken, past, past)

  const getRes = await shareApi.onRequestGet({
    request: new Request(`https://gtar.pages.dev/api/setlist/share?token=${expiredToken}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }),
    env,
  })
  assert.equal(getRes.status, 410, 'Expired share returns HTTP 410')
  const getData = await getRes.json()
  assert.equal(getData.error, 'SHARED_SETLIST_EXPIRED')
})

test('10. LEGACY_OWNERLESS_LINK_COMPATIBILITY: Historical links without creator remain readable, but only admin can revoke', async () => {
  shareApi._resetRateLimitsForTesting()
  const { sqlite, db } = createTestSqliteDb()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const regularMember = await seedUser(sqlite, { id: 'user-member-leg', role: 'member', access_status: 'active' })
  const admin = await seedUser(sqlite, { id: 'user-admin-leg', role: 'admin', access_status: 'active' })

  const memberToken = await authCore.createSessionToken(regularMember, TEST_SECRET)
  const adminToken = await authCore.createSessionToken(admin, TEST_SECRET)

  // Seed legacy 16-hex record with creator_user_id = NULL
  const legacyToken = '1122334455667788'
  const future = new Date(Date.now() + 3600000).toISOString()
  const legacyPayload = {
    version: 1,
    type: 'GTAR_SHARED_SETLIST',
    name: 'Legacy Hymnal',
    createdAt: '2026-01-01T00:00:00Z',
    songs: [{ title: 'Amazing Grace', rawContent: '[G]Amazing grace' }],
  }

  sqlite
    .prepare(
      `INSERT INTO shared_setlists (share_token, setlist_name, payload_json, created_at, expires_at, creator_user_id, is_revoked)
       VALUES (?, ?, ?, '2026-01-01T00:00:00Z', ?, NULL, 0)`
    )
    .run(legacyToken, legacyPayload.name, JSON.stringify(legacyPayload), future)

  // Regular member can retrieve legacy share
  const getRes = await shareApi.onRequestGet({
    request: new Request(`https://gtar.pages.dev/api/setlist/share?token=${legacyToken}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${memberToken}` },
    }),
    env,
  })
  assert.equal(getRes.status, 200, 'Legacy ownerless link remains accessible to active members')
  const getData = await getRes.json()
  assert.equal(getData.setlist.name, 'Legacy Hymnal')

  // Regular member cannot revoke legacy ownerless link (HTTP 403)
  const memberRevokeRes = await revokeApi.onRequestPost({
    request: new Request('https://gtar.pages.dev/api/setlist/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({ token: legacyToken }),
    }),
    env,
  })
  assert.equal(memberRevokeRes.status, 403, 'Regular member cannot revoke ownerless legacy share')

  // Admin CAN revoke legacy share
  const adminRevokeRes = await revokeApi.onRequestPost({
    request: new Request('https://gtar.pages.dev/api/setlist/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ token: legacyToken }),
    }),
    env,
  })
  assert.equal(adminRevokeRes.status, 200, 'Admin can revoke ownerless legacy share')

  // Once revoked, even legacy link returns 410
  const getResAfterRevoke = await shareApi.onRequestGet({
    request: new Request(`https://gtar.pages.dev/api/setlist/share?token=${legacyToken}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${memberToken}` },
    }),
    env,
  })
  assert.equal(getResAfterRevoke.status, 410, 'Revoked legacy link returns 410')
})

test('11. CREATOR_DENIED_AFTER_CREATION: Creator access denial invalidates previously issued snapshot', async () => {
  shareApi._resetRateLimitsForTesting()
  const { sqlite, db } = createTestSqliteDb()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const creator = await seedUser(sqlite, { id: 'user-creator-rogue', role: 'member', access_status: 'active' })
  const recipient = await seedUser(sqlite, { id: 'user-innocent-recipient', role: 'member', access_status: 'active' })

  const creatorToken = await authCore.createSessionToken(creator, TEST_SECRET)
  const recipientToken = await authCore.createSessionToken(recipient, TEST_SECRET)

  const postRes = await shareApi.onRequestPost({
    request: new Request('https://gtar.pages.dev/api/setlist/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creatorToken}` },
      body: JSON.stringify({ type: 'GTAR_SHARED_SETLIST', name: 'Rogue Set', songs: [{ title: 'Track', rawContent: '[A]A' }] }),
    }),
    env,
  })
  const { token: shareToken } = await postRes.json()

  // Recipient can retrieve initially
  const get1 = await shareApi.onRequestGet({
    request: new Request(`https://gtar.pages.dev/api/setlist/share?token=${shareToken}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${recipientToken}` },
    }),
    env,
  })
  assert.equal(get1.status, 200)

  // Admin denies creator's account
  sqlite.prepare("UPDATE users SET access_status = 'denied' WHERE id = ?").run(creator.id)

  // Recipient attempts to fetch share again -> rejected with 403 CREATOR_ACCESS_DENIED
  const get2 = await shareApi.onRequestGet({
    request: new Request(`https://gtar.pages.dev/api/setlist/share?token=${shareToken}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${recipientToken}` },
    }),
    env,
  })
  assert.equal(get2.status, 403, 'Denied creator snapshot must be rejected with HTTP 403')
  const errData = await get2.json()
  assert.equal(errData.error, 'CREATOR_ACCESS_DENIED')
})

test('12. UNAUTHORIZED_RECIPIENT_REJECTION: Pending and denied recipients cannot retrieve shares', async () => {
  shareApi._resetRateLimitsForTesting()
  const { sqlite, db } = createTestSqliteDb()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const creator = await seedUser(sqlite, { id: 'user-c-ok', role: 'member', access_status: 'active' })
  const pendingRecipient = await seedUser(sqlite, { id: 'user-r-pending', role: 'member', access_status: 'pending' })
  const deniedRecipient = await seedUser(sqlite, { id: 'user-r-denied', role: 'member', access_status: 'denied' })

  const creatorToken = await authCore.createSessionToken(creator, TEST_SECRET)
  const pendingToken = await authCore.createSessionToken(pendingRecipient, TEST_SECRET)
  const deniedToken = await authCore.createSessionToken(deniedRecipient, TEST_SECRET)

  const postRes = await shareApi.onRequestPost({
    request: new Request('https://gtar.pages.dev/api/setlist/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creatorToken}` },
      body: JSON.stringify({ type: 'GTAR_SHARED_SETLIST', name: 'Valid', songs: [{ title: 'S', rawContent: 'C' }] }),
    }),
    env,
  })
  const { token: shareToken } = await postRes.json()

  // Pending user receives 403
  const getPending = await shareApi.onRequestGet({
    request: new Request(`https://gtar.pages.dev/api/setlist/share?token=${shareToken}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${pendingToken}` },
    }),
    env,
  })
  assert.equal(getPending.status, 403)

  // Denied user receives 403
  const getDenied = await shareApi.onRequestGet({
    request: new Request(`https://gtar.pages.dev/api/setlist/share?token=${shareToken}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${deniedToken}` },
    }),
    env,
  })
  assert.equal(getDenied.status, 403)
})

test('13. MISSING_MIGRATION_SCHEMA_AND_DB_FAILURES: Controlled 500 error without leaking SQLite details or tokens', async () => {
  shareApi._resetRateLimitsForTesting()
  // Unmigrated SQLite instance: only migrations 0001-0003 applied (no creator_user_id or is_revoked columns)
  const sqlite = new DatabaseSync(':memory:')
  for (const file of ['0001_users.sql', '0002_songbook_sync.sql', '0003_shared_setlists.sql']) {
    sqlite.exec(fs.readFileSync(path.join(webDir, 'migrations', file), 'utf8'))
  }
  const user = await seedUser(sqlite, { id: 'user-unmigrated', role: 'member', access_status: 'active' })
  const token = await authCore.createSessionToken(user, TEST_SECRET)

  const unmigratedDb = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              return sqlite.prepare(sql).get(...args) ?? null
            },
            async run() {
              return sqlite.prepare(sql).run(...args)
            },
          }
        },
      }
    },
  }

  const env = { DB: unmigratedDb, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  // POST with missing schema
  const postReq = new Request('https://gtar.pages.dev/api/setlist/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'GTAR_SHARED_SETLIST', name: 'Unmigrated Test', songs: [{ title: 'S', rawContent: 'C' }] }),
  })
  const postRes = await shareApi.onRequestPost({ request: postReq, env })
  assert.equal(postRes.status, 500, 'Unmigrated database schema fails safely with HTTP 500')
  const postData = await postRes.json()
  assert.equal(postData.error, 'FAILED_TO_CREATE_SHARE')
  assert.equal(JSON.stringify(postData).includes('no such column'), false, 'Does not disclose SQLite schema error')
  assert.equal(postData.token, undefined, 'Does not disclose token on failure')

  // GET with missing schema
  const getReq = new Request('https://gtar.pages.dev/api/setlist/share?token=0123456789abcdef0123456789abcdef', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const getRes = await shareApi.onRequestGet({ request: getReq, env })
  assert.equal(getRes.status, 500, 'Unmigrated database schema on GET returns HTTP 500')
  const getData = await getRes.json()
  assert.equal(getData.error, 'FAILED_TO_FETCH_SHARE')
  assert.equal(JSON.stringify(getData).includes('no such column'), false)

  // Revoke with missing schema
  const revokeReq = new Request('https://gtar.pages.dev/api/setlist/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ token: '0123456789abcdef0123456789abcdef' }),
  })
  const revokeRes = await revokeApi.onRequestPost({ request: revokeReq, env })
  assert.equal(revokeRes.status, 500, 'Unmigrated database schema on revoke returns HTTP 500')
  const revokeData = await revokeRes.json()
  assert.equal(revokeData.error, 'FAILED_TO_REVOKE_SHARE')
})

test('14. CLIENT_EXTRACT_SHARE_TOKEN_AND_QR_GENERATION: Token extraction accepts 16 and 32 hex chars; QR generation succeeds', () => {
  // 32-hex token (128-bit)
  const tok32 = '0123456789abcdef0123456789abcdef'
  const ext1 = extractShareToken(tok32)
  assert.equal(ext1.isValid, true)
  assert.equal(ext1.token, tok32)

  // 16-hex token (legacy)
  const tok16 = '0123456789abcdef'
  const ext2 = extractShareToken(tok16)
  assert.equal(ext2.isValid, true)
  assert.equal(ext2.token, tok16)

  // Relative URL with 32-hex param
  const ext3 = extractShareToken(`/?share=${tok32}`)
  assert.equal(ext3.isValid, true)
  assert.equal(ext3.token, tok32)

  // Relative URL with 16-hex param
  const ext4 = extractShareToken(`/?share=${tok16}`)
  assert.equal(ext4.isValid, true)
  assert.equal(ext4.token, tok16)

  // Invalid token format
  const extBad = extractShareToken('not-a-valid-token')
  assert.equal(extBad.isValid, false)

  // QR SVG Data URI generation with 32-hex token
  const shareUrl = `https://gtar.pages.dev?share=${tok32}`
  const qrUri = generateQrSvgDataUri(shareUrl)
  assert.ok(qrUri.startsWith('data:image/svg+xml;utf8,'), 'QR code generates valid data URI')
  const decoded = decodeURIComponent(qrUri.replace('data:image/svg+xml;utf8,', ''))
  assert.ok(decoded.includes('<svg'), 'QR SVG contains svg element')
})
