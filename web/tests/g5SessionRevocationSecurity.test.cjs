const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { createHmac, createHash } = require('node:crypto')

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
const authCore = require(path.join(webDir, 'functions/lib/authCore.ts'))
const sessionApi = require(path.join(webDir, 'functions/api/auth/session.ts'))
const logoutApi = require(path.join(webDir, 'functions/api/auth/logout.ts'))
const syncApi = require(path.join(webDir, 'functions/api/songbook/sync.ts'))
const shareApi = require(path.join(webDir, 'functions/api/setlist/share.ts'))
const { logoutFromServer } = require(path.join(webDir, 'src/utils/googleAuth.ts'))

const TEST_SECRET = 'disposable-test-secret-gtar-g5-session-revocation-key-32'

function createTestSqliteDb(options = {}) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON;')

  const migrationFiles = [
    '0001_users.sql',
    '0002_songbook_sync.sql',
    '0003_shared_setlists.sql',
    '0004_shared_catalog.sql',
    '0005_shared_setlists_revocation.sql',
  ]

  if (!options.skipMigration0006) {
    migrationFiles.push('0006_session_revocation.sql')
  }

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
    picture_url: user.picture_url || null,
    role: user.role || 'member',
    access_status: user.access_status || 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  }
}

async function seedUser(sqlite, user) {
  const fullUser = makeUser(user)
  sqlite
    .prepare(
      `INSERT INTO users (id, google_sub, email, display_name, picture_url, role, access_status, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fullUser.id,
      fullUser.google_sub,
      fullUser.email,
      fullUser.display_name,
      fullUser.picture_url,
      fullUser.role,
      fullUser.access_status,
      fullUser.created_at,
      fullUser.updated_at,
      fullUser.last_login_at
    )
  return fullUser
}

function createLegacyToken(user, secret = TEST_SECRET, claims = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const payload = {
    uid: user.id,
    sub: user.google_sub,
    email: user.email,
    role: user.role,
    status: user.access_status,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 30 * 86400,
    ...claims,
  }
  const message = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`
  return `${message}.${createHmac('sha256', secret).update(message).digest('base64url')}`
}

test('1. MIGRATION_0006_SCHEMA: Additive sessions table and users.sessions_revoked_at apply cleanly', () => {
  const { sqlite } = createTestSqliteDb()

  const sessionCols = sqlite.prepare('PRAGMA table_info(sessions);').all().map((c) => c.name)
  assert.ok(sessionCols.includes('id'), 'sessions.id exists')
  assert.ok(sessionCols.includes('user_id'), 'sessions.user_id exists')
  assert.ok(sessionCols.includes('session_token_hash'), 'sessions.session_token_hash exists')
  assert.ok(sessionCols.includes('created_at'), 'sessions.created_at exists')
  assert.ok(sessionCols.includes('expires_at'), 'sessions.expires_at exists')
  assert.ok(sessionCols.includes('last_seen_at'), 'sessions.last_seen_at exists')
  assert.ok(sessionCols.includes('is_revoked'), 'sessions.is_revoked exists')
  assert.ok(sessionCols.includes('revoked_at'), 'sessions.revoked_at exists')

  const userCols = sqlite.prepare('PRAGMA table_info(users);').all().map((c) => c.name)
  assert.ok(userCols.includes('sessions_revoked_at'), 'users.sessions_revoked_at exists')
})

test('2. SUCCESSFUL_GOOGLE_SIGNIN_AND_SESSION_ISSUANCE: Issues modern token with sid and stores hash only', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const mockToken = 'test_token:sub_new_user:new_user@example.com:New User'
  const req = new Request('http://localhost/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: mockToken }),
  })

  const res = await sessionApi.onRequestPost({ request: req, env })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.success, true)
  assert.ok(data.sessionToken, 'sessionToken must be returned')

  // Verify token has sid
  const verified = await authCore.verifySessionToken(data.sessionToken, TEST_SECRET)
  assert.ok(verified?.sid, 'session token must contain sid')

  // Verify hash in D1
  const tokenHash = createHash('sha256').update(data.sessionToken).digest('hex')
  const sessionRow = sqlite.prepare('SELECT * FROM sessions WHERE session_token_hash = ?').get(tokenHash)
  assert.ok(sessionRow, 'Session record must exist in D1')
  assert.equal(sessionRow.is_revoked, 0, 'New session is not revoked')
  assert.equal(sessionRow.user_id, data.user.id)

  // Verify raw token is never stored in DB
  const rawMatch = sqlite.prepare('SELECT * FROM sessions WHERE session_token_hash LIKE ?').all(`%${data.sessionToken}%`)
  assert.equal(rawMatch.length, 0, 'Raw bearer token must not be persisted in database')
})

test('3. VALID_PROTECTED_API_ACCESS: Valid session token accesses protected endpoints', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_valid' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const token = await authCore.createSessionToken(user, TEST_SECRET, undefined, 'sid_valid')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_valid',
    user_id: user.id,
    session_token_hash: tokenHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  // GET /api/auth/session
  const getReq = new Request('http://localhost/api/auth/session', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const getRes = await sessionApi.onRequestGet({ request: getReq, env })
  assert.equal(getRes.status, 200)
  const getData = await getRes.json()
  assert.equal(getData.user.id, user.id)

  // authenticateUserRequest
  const authRes = await authCore.authenticateUserRequest(getReq, env)
  assert.equal(authRes.user?.id, user.id)
})

test('4. LOGOUT_REVOKES_CURRENT_SESSION: Logout revokes session and rejects subsequent access', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_logout' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const token = await authCore.createSessionToken(user, TEST_SECRET, undefined, 'sid_logout')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_logout',
    user_id: user.id,
    session_token_hash: tokenHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  // Call logout
  const logoutReq = new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const logoutRes = await logoutApi.onRequestPost({ request: logoutReq, env })
  assert.equal(logoutRes.status, 200)
  const logoutData = await logoutRes.json()
  assert.equal(logoutData.success, true)
  assert.equal(logoutData.revoked, true)

  // Verify D1 state
  const sessionRow = sqlite.prepare('SELECT * FROM sessions WHERE session_token_hash = ?').get(tokenHash)
  assert.equal(sessionRow.is_revoked, 1, 'is_revoked must be 1')
  assert.ok(sessionRow.revoked_at, 'revoked_at must be set')

  // Access with revoked token rejected on GET /api/auth/session
  const getReq = new Request('http://localhost/api/auth/session', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const getRes = await sessionApi.onRequestGet({ request: getReq, env })
  assert.equal(getRes.status, 401)

  // authenticateUserRequest returns 401
  const authRes = await authCore.authenticateUserRequest(getReq, env)
  assert.equal(authRes.status, 401)
  assert.match(authRes.error, /revoked/i)
})

test('5. COPIED_TOKEN_REJECTED_AFTER_LOGOUT: Stolen/copied token cannot survive verified logout', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_victim' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const token = await authCore.createSessionToken(user, TEST_SECRET, undefined, 'sid_victim')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_victim',
    user_id: user.id,
    session_token_hash: tokenHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  // Attacker copies token
  const copiedToken = token

  // Victim logs out
  const logoutReq = new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  await logoutApi.onRequestPost({ request: logoutReq, env })

  // Attacker uses copiedToken on protected API
  const attackerReq = new Request('http://localhost/api/songbook/sync', {
    method: 'GET',
    headers: { Authorization: `Bearer ${copiedToken}` },
  })
  const authRes = await authCore.authenticateUserRequest(attackerReq, env)
  assert.equal(authRes.status, 401)
  assert.match(authRes.error, /revoked/i)
})

test('6. REPEATED_LOGOUT: Calling logout repeatedly is safe and idempotent', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_repeat' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const token = await authCore.createSessionToken(user, TEST_SECRET, undefined, 'sid_repeat')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_repeat',
    user_id: user.id,
    session_token_hash: tokenHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  const req1 = new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const res1 = await logoutApi.onRequestPost({ request: req1, env })
  assert.equal(res1.status, 200)

  const req2 = new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const res2 = await logoutApi.onRequestPost({ request: req2, env })
  assert.equal(res2.status, 200)
  const data2 = await res2.json()
  assert.equal(data2.success, true)
  assert.equal(data2.revoked, true)
})

test('7. MULTI_DEVICE: Another independently issued session remains valid after one session logs out', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_multidev' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  // Device 1
  const tokenDevice1 = await authCore.createSessionToken(user, TEST_SECRET, undefined, 'sid_dev1')
  const hash1 = createHash('sha256').update(tokenDevice1).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_dev1',
    user_id: user.id,
    session_token_hash: hash1,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  // Device 2
  const tokenDevice2 = await authCore.createSessionToken(user, TEST_SECRET, undefined, 'sid_dev2')
  const hash2 = createHash('sha256').update(tokenDevice2).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_dev2',
    user_id: user.id,
    session_token_hash: hash2,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  // Device 1 logs out
  const logoutReq = new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenDevice1}` },
  })
  await logoutApi.onRequestPost({ request: logoutReq, env })

  // Device 1 is rejected
  const req1 = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${tokenDevice1}` } })
  const res1 = await authCore.authenticateUserRequest(req1, env)
  assert.equal(res1.status, 401)

  // Device 2 is STILL VALID!
  const req2 = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${tokenDevice2}` } })
  const res2 = await authCore.authenticateUserRequest(req2, env)
  assert.equal(res2.user?.id, user.id)
})

test('8. EXPIRED_AND_MALFORMED_TOKENS: Expired and tampered tokens rejected', async () => {
  const { db } = createTestSqliteDb()
  const user = makeUser({ id: 'usr_exp' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  // Expired token (negative duration)
  const expiredToken = await authCore.createSessionToken(user, TEST_SECRET, -1000, 'sid_exp')
  const expReq = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${expiredToken}` } })
  const expRes = await authCore.authenticateUserRequest(expReq, env)
  assert.equal(expRes.status, 401)

  // Tampered signature
  const validToken = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_valid')
  const tampered = validToken.slice(0, -5) + 'xxxxx'
  const tampReq = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${tampered}` } })
  const tampRes = await authCore.authenticateUserRequest(tampReq, env)
  assert.equal(tampRes.status, 401)

  // Non-JWT string
  const garbageReq = new Request('http://localhost/api/auth/session', { headers: { Authorization: 'Bearer not_a_jwt' } })
  const garbageRes = await authCore.authenticateUserRequest(garbageReq, env)
  assert.equal(garbageRes.status, 401)
})

test('9. SESSION_OWNERSHIP_AND_SUB_BINDING: User id / sub mismatch rejected', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const userA = await seedUser(sqlite, { id: 'usr_a', google_sub: 'sub_a' })
  const userB = await seedUser(sqlite, { id: 'usr_b', google_sub: 'sub_b' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  // Token claims User A, but D1 session is bound to User B
  const token = await authCore.createSessionToken(userA, TEST_SECRET, 3600000, 'sid_mismatch')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_mismatch',
    user_id: userB.id, // Mismatched owner
    session_token_hash: tokenHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  const req = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${token}` } })
  const res = await authCore.authenticateUserRequest(req, env)
  assert.equal(res.status, 401)
  assert.match(res.error, /mismatch/i)
})

test('10. USER_ROLE_AND_STATUS_CHANGES: Account pending or denied denies access despite valid session token', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_pending', access_status: 'pending' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const token = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_pen')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_pen',
    user_id: user.id,
    session_token_hash: tokenHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  const req = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${token}` } })
  const res = await authCore.authenticateUserRequest(req, env)
  assert.equal(res.status, 403)
})

test('11. ACCOUNT_DENIAL_AND_RESTORATION: Denying user revokes sessions, restoring does not resurrect', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_deny_restore', access_status: 'active' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const token1 = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_dr1')
  const tokenHash1 = createHash('sha256').update(token1).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_dr1',
    user_id: user.id,
    session_token_hash: tokenHash1,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  // Verify token1 works initially
  const req1 = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${token1}` } })
  const res1 = await authCore.authenticateUserRequest(req1, env)
  assert.equal(res1.user?.id, user.id)

  // Admin denies user
  const nowIso = new Date().toISOString()
  await authCore.updateUserAccessStatus(db, user.id, 'denied', nowIso)

  // Verify session 1 is marked revoked in D1
  const sessRow = sqlite.prepare('SELECT * FROM sessions WHERE session_token_hash = ?').get(tokenHash1)
  assert.equal(sessRow.is_revoked, 1, 'Session must be revoked on account denial')

  // Using token1 returns 401/403
  const resDeny = await authCore.authenticateUserRequest(req1, env)
  assert.ok(resDeny.status === 401 || resDeny.status === 403)

  // Admin restores user to active
  await authCore.updateUserAccessStatus(db, user.id, 'active', new Date().toISOString())

  // Token1 must NOT be resurrected!
  const resAfterRestore = await authCore.authenticateUserRequest(req1, env)
  assert.equal(resAfterRestore.status, 401, 'Revoked session must not be resurrected on account restoration')

  // User logs in fresh: obtains new valid session
  const token2 = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_dr2')
  const tokenHash2 = createHash('sha256').update(token2).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_dr2',
    user_id: user.id,
    session_token_hash: tokenHash2,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  const req2 = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${token2}` } })
  const res2 = await authCore.authenticateUserRequest(req2, env)
  assert.equal(res2.user?.id, user.id, 'Fresh session after account restoration succeeds')
})

test('12. D1_QUERY_ERRORS: Database failures are handled safely and predictably', async () => {
  const brokenDb = {
    prepare() {
      throw new Error('D1 internal connection failure')
    },
  }
  const user = makeUser({ id: 'usr_broken' })
  const env = { DB: brokenDb, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }
  const token = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_broken')

  const req = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${token}` } })
  const res = await authCore.authenticateUserRequest(req, env)
  assert.equal(res.status, 500)
  assert.equal(res.error, 'Authentication lookup failed')
})

test('13. MISSING_MIGRATION_SCHEMA: Missing sessions table fails closed predictably with 500', async () => {
  // DB without migration 0006
  const { db } = createTestSqliteDb({ skipMigration0006: true })
  const user = makeUser({ id: 'usr_nomig' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }
  const token = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_nomig')

  const req = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${token}` } })
  const res = await authCore.authenticateUserRequest(req, env)
  assert.equal(res.status, 500)
  assert.match(res.error, /migration required/i)
})

test('14. CONCURRENT_LOGOUT_AND_VALIDATION: Concurrent operations handle race safely', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_concurrent' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const token = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_conc')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_conc',
    user_id: user.id,
    session_token_hash: tokenHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  // Concurrently run 5 validations and 1 logout
  const operations = [
    authCore.authenticateUserRequest(new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${token}` } }), env),
    logoutApi.onRequestPost({ request: new Request('http://localhost/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }), env }),
    authCore.authenticateUserRequest(new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${token}` } }), env),
    authCore.authenticateUserRequest(new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${token}` } }), env),
  ]

  const results = await Promise.all(operations)
  assert.ok(results.length === 4)

  // Subsequent check must definitely be revoked
  const finalCheck = await authCore.authenticateUserRequest(
    new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${token}` } }),
    env
  )
  assert.equal(finalCheck.status, 401)
  assert.match(finalCheck.error, /revoked/i)
})

test('15. LEGACY_TOKEN_TRANSITION: Legacy tokens valid within window, revoked on logout, rejected if stale', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_legacy' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  // 1. Fresh legacy token (no sid) within 7 days
  const freshLegacy = createLegacyToken(user, TEST_SECRET)
  const req1 = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${freshLegacy}` } })
  const res1 = await authCore.authenticateUserRequest(req1, env)
  assert.equal(res1.user?.id, user.id, 'Fresh legacy token is valid during transition')

  // 2. Logout with legacy token revokes it
  const logoutReq = new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${freshLegacy}` },
  })
  const logoutRes = await logoutApi.onRequestPost({ request: logoutReq, env })
  assert.equal(logoutRes.status, 200)

  // Copied legacy token is now rejected!
  const resCopied = await authCore.authenticateUserRequest(req1, env)
  assert.equal(resCopied.status, 401, 'Revoked legacy token must be rejected')

  // 3. Stale legacy token older than 7 days (e.g. 8 days old)
  const staleLegacy = createLegacyToken(user, TEST_SECRET, { iat: Math.floor(Date.now() / 1000) - 8 * 86400 })
  const reqStale = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${staleLegacy}` } })
  const resStale = await authCore.authenticateUserRequest(reqStale, env)
  assert.equal(resStale.status, 401)
  assert.match(resStale.error, /expired/i)
})

test('16. GOOGLE_ID_TOKEN_FALLBACK: Revoked session does not fall back to Google ID token, and Google tokens cannot bypass revocation', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_gfallback', google_sub: 'sub_gfallback' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  // User has session
  const token = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_gfall')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_gfall',
    user_id: user.id,
    session_token_hash: tokenHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  // Revoke session
  await authCore.revokeSessionByTokenHash(db, tokenHash, new Date().toISOString())

  // Calling with revoked GTAR token does NOT fall back to Google ID token -> returns 401
  const req = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${token}` } })
  const res = await authCore.authenticateUserRequest(req, env)
  assert.equal(res.status, 401)
  assert.match(res.error, /revoked/i)

  // If user has sessions_revoked_at recorded, old Google ID token is also blocked
  sqlite.prepare('UPDATE users SET sessions_revoked_at = ? WHERE id = ?').run(new Date().toISOString(), user.id)
  const mockOldGoogleToken = 'test_token:sub_gfallback:user@example.com'
  const googleReq = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${mockOldGoogleToken}` } })
  const googleRes = await authCore.authenticateUserRequest(googleReq, env)
  // Rejected because token issued prior to revocation
  assert.ok(googleRes.status === 401)
})

test('17. ADMIN_AUTHORIZATION: Admin endpoint enforces session revocation and admin role', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const adminUser = await seedUser(sqlite, { id: 'usr_admin', role: 'admin' })
  const memberUser = await seedUser(sqlite, { id: 'usr_member', role: 'member' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  // Admin token
  const adminToken = await authCore.createSessionToken(adminUser, TEST_SECRET, 3600000, 'sid_admin')
  const adminHash = createHash('sha256').update(adminToken).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_admin',
    user_id: adminUser.id,
    session_token_hash: adminHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  // Member token
  const memberToken = await authCore.createSessionToken(memberUser, TEST_SECRET, 3600000, 'sid_member')
  const memberHash = createHash('sha256').update(memberToken).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_member',
    user_id: memberUser.id,
    session_token_hash: memberHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  // Admin access succeeds
  const reqAdmin = new Request('http://localhost/api/admin/users', { headers: { Authorization: `Bearer ${adminToken}` } })
  const resAdmin = await authCore.authenticateAdminRequest(reqAdmin, env)
  assert.equal(resAdmin.user?.id, adminUser.id)

  // Member access gets 403 Forbidden
  const reqMember = new Request('http://localhost/api/admin/users', { headers: { Authorization: `Bearer ${memberToken}` } })
  const resMember = await authCore.authenticateAdminRequest(reqMember, env)
  assert.equal(resMember.status, 403)

  // Revoked admin gets 401
  await authCore.revokeSessionByTokenHash(db, adminHash, new Date().toISOString())
  const resRevokedAdmin = await authCore.authenticateAdminRequest(reqAdmin, env)
  assert.equal(resRevokedAdmin.status, 401)
})

test('18. CLOUD_SYNC_PROTECTION: Cloud Sync rejects revoked session token', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_sync' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const token = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_sync')
  const hash = createHash('sha256').update(token).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_sync',
    user_id: user.id,
    session_token_hash: hash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  // GET sync succeeds
  const req = new Request('http://localhost/api/songbook/sync', { headers: { Authorization: `Bearer ${token}` } })
  const res = await syncApi.onRequestGet({ request: req, env })
  assert.equal(res.status, 200)

  // Revoke session
  await authCore.revokeSessionByTokenHash(db, hash, new Date().toISOString())

  // GET sync now returns 401
  const reqRev = new Request('http://localhost/api/songbook/sync', { headers: { Authorization: `Bearer ${token}` } })
  const resRev = await syncApi.onRequestGet({ request: reqRev, env })
  assert.equal(resRev.status, 401)
})

test('19. QR_SHARING_PROTECTION: QR share creation rejects revoked session token', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_share' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const token = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_share')
  const hash = createHash('sha256').update(token).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_share',
    user_id: user.id,
    session_token_hash: hash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  // Revoke session
  await authCore.revokeSessionByTokenHash(db, hash, new Date().toISOString())

  const postReq = new Request('http://localhost/api/setlist/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ setlistName: 'Sunday Morning', songbookPayload: { version: 1 } }),
  })
  const postRes = await shareApi.onRequestPost({ request: postReq, env })
  assert.equal(postRes.status, 401)
})

test('20. RATE_LIMITING_AND_RETRY_AFTER: session-revoke rate limiting returns 429 with Retry-After', async () => {
  const { db } = createTestSqliteDb()
  const user = makeUser({ id: 'usr_rate' })

  // Mock DO limiter that returns rate limit exceeded payload
  const mockLimiter = {
    idFromName: () => 'rate-id',
    get: () => ({
      fetch: async () => new Response(JSON.stringify({ allowed: false, retryAfter: 45 }), { status: 200 }),
    }),
  }
  const env = {
    DB: db,
    AUTH_SECRET: 'disposable-key-that-is-at-least-32-chars-long!!',
    API_ABUSE_MODE: 'durable-v1',
    API_ABUSE_LIMITER: mockLimiter,
  }

  const token = await authCore.createSessionToken(user, env.AUTH_SECRET, 3600000, 'sid_rate')
  const req = new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })

  const res = await logoutApi.onRequestPost({ request: req, env })
  assert.equal(res.status, 429)
  assert.equal(res.headers.get('Retry-After'), '45')
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
})

test('21. SECURITY_HEADERS: Logout endpoint includes API security headers', async () => {
  const { db } = createTestSqliteDb()
  const user = makeUser({ id: 'usr_headers' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET }
  const token = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_head')

  const postReq = new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const postRes = await logoutApi.onRequestPost({ request: postReq, env })
  assert.equal(postRes.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(postRes.headers.get('X-Frame-Options'), 'DENY')
  assert.equal(postRes.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin')
  const { STATIC_SECURITY_HEADERS } = require(path.join(webDir, 'functions/lib/securityHeaders.ts'))
  assert.ok(STATIC_SECURITY_HEADERS['Content-Security-Policy-Report-Only'], 'CSP Report-Only header must be defined')

  const optRes = await logoutApi.onRequestOptions()
  assert.equal(optRes.status, 204)
  assert.equal(optRes.headers.get('X-Content-Type-Options'), 'nosniff')
})

test('22. CLIENT_LOGOUT_DURING_NETWORK_FAILURE: Client logoutFromServer handles network error gracefully', async () => {
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('Simulated network offline / timeout')
  }

  try {
    const success = await logoutFromServer('any_token')
    assert.equal(success, false, 'logoutFromServer returns false on network error without throwing')
  } finally {
    globalThis.fetch = origFetch
  }
})

test('23. NO_RAW_TOKENS_STORED_OR_LOGGED: Only token hashes are stored, errors do not disclose tokens', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_notokens' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const token = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_secret')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_secret',
    user_id: user.id,
    session_token_hash: tokenHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  // Check table dump: no column holds token
  const rows = sqlite.prepare('SELECT * FROM sessions WHERE id = ?').all('sid_secret')
  assert.equal(rows.length, 1)
  const jsonStr = JSON.stringify(rows[0])
  assert.ok(!jsonStr.includes(token), 'Session row must not contain raw bearer token')

  // Check error response for invalid bearer token
  const badReq = new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}_malformed` },
  })
  const errRes = await logoutApi.onRequestPost({ request: badReq, env })
  const errBody = await errRes.text()
  assert.ok(!errBody.includes(token), 'Error response must not disclose bearer token')
})

test('24. REGRESSION_MISSING_TOKEN_HASHES: Missing or empty token hashes fail closed', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_nohash' })
  const nowIso = new Date().toISOString()

  // Empty, null, undefined or whitespace tokenHash to revokeSessionByTokenHash
  assert.equal(await authCore.revokeSessionByTokenHash(db, '', nowIso), false)
  assert.equal(await authCore.revokeSessionByTokenHash(db, '   ', nowIso), false)
  assert.equal(await authCore.revokeSessionByTokenHash(db, null, nowIso), false)
  assert.equal(await authCore.revokeSessionByTokenHash(db, undefined, nowIso), false)

  // Empty or whitespace token to validateSessionWithDb
  const emptyRes = await authCore.validateSessionWithDb(db, '', { uid: user.id, sub: user.google_sub })
  assert.equal(emptyRes.valid, false)
  assert.match(emptyRes.reason, /invalid or missing/i)

  const spaceRes = await authCore.validateSessionWithDb(db, '   ', { uid: user.id, sub: user.google_sub })
  assert.equal(spaceRes.valid, false)

  // Modern token whose token hash is completely missing from D1 sessions table
  const token = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_unregistered')
  const missingRes = await authCore.validateSessionWithDb(db, token, {
    uid: user.id,
    sub: user.google_sub,
    sid: 'sid_unregistered',
  })
  assert.equal(missingRes.valid, false)
  assert.match(missingRes.reason, /not found or revoked/i)
})

test('25. REGRESSION_FAILED_D1_WRITES: Failed D1 writes fail closed without silent success', async () => {
  const { db } = createTestSqliteDb()
  const user = makeUser({ id: 'usr_failwrite' })
  const nowIso = new Date().toISOString()

  // 1. Mock D1 where UPDATE returns { success: false }
  const failingUpdateDb = {
    prepare(sql) {
      return {
        bind() { return this },
        async run() {
          return { success: false }
        },
        async first() {
          return null
        },
      }
    },
  }
  const updateRes = await authCore.revokeSessionByTokenHash(failingUpdateDb, 'some_hash', nowIso)
  assert.equal(updateRes, false, 'Failed D1 UPDATE must return false')

  // 2. Mock D1 where legacy INSERT returns { success: false }
  const failingInsertDb = {
    prepare(sql) {
      return {
        bind() { return this },
        async run() {
          if (sql.trim().startsWith('UPDATE')) return { success: true, meta: { changes: 0 } }
          return { success: false }
        },
        async first() {
          return null
        },
      }
    },
  }
  const insertRes = await authCore.revokeSessionByTokenHash(failingInsertDb, 'some_hash', nowIso, { userId: user.id })
  assert.equal(insertRes, false, 'Failed D1 legacy INSERT must return false')

  // 3. createSessionRecord throws when D1 run returns { success: false }
  await assert.rejects(
    async () => {
      await authCore.createSessionRecord(failingUpdateDb, {
        id: 'sid_fail',
        user_id: user.id,
        session_token_hash: 'hash_fail',
        created_at: nowIso,
        expires_at: nowIso,
      })
    },
    /Failed to insert session record/
  )

  // 4. Logout endpoint returns HTTP 500 when D1 write fails, never silent 200
  const env = { DB: failingUpdateDb, AUTH_SECRET: TEST_SECRET }
  const token = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_fail_logout')
  const req = new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const logoutRes = await logoutApi.onRequestPost({ request: req, env })
  assert.equal(logoutRes.status, 500, 'Logout must fail with 500 when D1 write fails')
  const logoutBody = await logoutRes.json()
  assert.equal(logoutBody.success, false)
  assert.match(logoutBody.error, /failed/i)
})

test('26. REGRESSION_MALFORMED_AND_MISSING_IAT: Legacy tokens require trustworthy iat', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_iat' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  // 1. Missing iat claim entirely
  const noIatToken = createLegacyToken(user, TEST_SECRET, { iat: undefined })
  const noIatRes = await authCore.validateSessionWithDb(db, noIatToken, {
    uid: user.id,
    sub: user.google_sub,
    iat: undefined,
  })
  assert.equal(noIatRes.valid, false)
  assert.match(noIatRes.reason, /valid issuance timestamp/i)

  const noIatReq = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${noIatToken}` } })
  const noIatAuth = await authCore.authenticateUserRequest(noIatReq, env)
  assert.equal(noIatAuth.status, 401)

  // 2. Non-number or invalid iat
  const stringIatToken = createLegacyToken(user, TEST_SECRET, { iat: 'invalid_string' })
  const stringIatReq = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${stringIatToken}` } })
  const stringIatAuth = await authCore.authenticateUserRequest(stringIatReq, env)
  assert.equal(stringIatAuth.status, 401)

  // 3. Negative / non-positive iat
  const negativeIatToken = createLegacyToken(user, TEST_SECRET, { iat: -500 })
  const negativeIatReq = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${negativeIatToken}` } })
  const negativeIatAuth = await authCore.authenticateUserRequest(negativeIatReq, env)
  assert.equal(negativeIatAuth.status, 401)

  // 4. Future iat (clock skew beyond 60s)
  const futureIatToken = createLegacyToken(user, TEST_SECRET, { iat: Math.floor(Date.now() / 1000) + 7200 })
  const futureIatReq = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${futureIatToken}` } })
  const futureIatAuth = await authCore.authenticateUserRequest(futureIatReq, env)
  assert.equal(futureIatAuth.status, 401)
  assert.match(futureIatAuth.error, /future/i)

  // 5. Expired legacy transition window (older than 7 days)
  const staleIatToken = createLegacyToken(user, TEST_SECRET, { iat: Math.floor(Date.now() / 1000) - 8 * 86400 })
  const staleIatReq = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${staleIatToken}` } })
  const staleIatAuth = await authCore.authenticateUserRequest(staleIatReq, env)
  assert.equal(staleIatAuth.status, 401)
  assert.match(staleIatAuth.error, /expired/i)
})

test('27. REGRESSION_REPEATED_LOGOUT: Repeated logout on both modern and legacy sessions confirms durable revocation', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_repeat_both' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  // Modern session repeated logout
  const modernToken = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_rep_mod')
  const modernHash = createHash('sha256').update(modernToken).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_rep_mod',
    user_id: user.id,
    session_token_hash: modernHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  for (let i = 0; i < 3; i++) {
    const req = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${modernToken}` },
    })
    const res = await logoutApi.onRequestPost({ request: req, env })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.success, true)
    assert.equal(body.revoked, true)

    const row = sqlite.prepare('SELECT is_revoked, revoked_at FROM sessions WHERE session_token_hash = ?').get(modernHash)
    assert.equal(row.is_revoked, 1)
    assert.ok(row.revoked_at)
  }

  // Legacy session repeated logout
  const legacyToken = createLegacyToken(user, TEST_SECRET)
  const legacyHash = createHash('sha256').update(legacyToken).digest('hex')

  for (let i = 0; i < 3; i++) {
    const req = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${legacyToken}` },
    })
    const res = await logoutApi.onRequestPost({ request: req, env })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.success, true)
    assert.equal(body.revoked, true)

    const row = sqlite.prepare('SELECT is_revoked, revoked_at FROM sessions WHERE session_token_hash = ?').get(legacyHash)
    assert.equal(row.is_revoked, 1)
    assert.ok(row.revoked_at)
  }
})

test('28. REGRESSION_COPIED_LEGACY_TOKENS_AND_ISOLATED_MODERN_SESSIONS: Direct D1 validation blocks copied legacy tokens while preserving modern sessions', async () => {
  const { sqlite, db } = createTestSqliteDb()
  const user = await seedUser(sqlite, { id: 'usr_copied_legacy' })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  // 1. User has modern session on laptop
  const modernToken = await authCore.createSessionToken(user, TEST_SECRET, 3600000, 'sid_laptop')
  const modernHash = createHash('sha256').update(modernToken).digest('hex')
  await authCore.createSessionRecord(db, {
    id: 'sid_laptop',
    user_id: user.id,
    session_token_hash: modernHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })

  // 2. User has legacy session on old phone
  const legacyToken = createLegacyToken(user, TEST_SECRET)
  const legacyHash = createHash('sha256').update(legacyToken).digest('hex')

  // Both tokens work initially
  const modReq1 = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${modernToken}` } })
  const modRes1 = await authCore.authenticateUserRequest(modReq1, env)
  assert.equal(modRes1.user?.id, user.id)

  const legReq1 = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${legacyToken}` } })
  const legRes1 = await authCore.authenticateUserRequest(legReq1, env)
  assert.equal(legRes1.user?.id, user.id)

  // 3. Attacker copies the legacy token
  const copiedLegacyToken = legacyToken

  // 4. User logs out the legacy session from old phone
  const logoutReq = new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${legacyToken}` },
  })
  const logoutRes = await logoutApi.onRequestPost({ request: logoutReq, env })
  assert.equal(logoutRes.status, 200)

  // 5. Attacker attempts to use copied legacy token -> REJECTED directly via D1 hash check
  const attackerReq = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${copiedLegacyToken}` } })
  const attackerRes = await authCore.authenticateUserRequest(attackerReq, env)
  assert.equal(attackerRes.status, 401)
  assert.match(attackerRes.error, /revoked/i)

  // 6. User's independent modern session on laptop REMAINS FULLY ACTIVE
  const modReq2 = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${modernToken}` } })
  const modRes2 = await authCore.authenticateUserRequest(modReq2, env)
  assert.equal(modRes2.user?.id, user.id, 'Modern session must remain active after legacy session logout')

  // 7. When user eventually logs out modern session, only modern session is revoked
  const logoutModReq = new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${modernToken}` },
  })
  const logoutModRes = await logoutApi.onRequestPost({ request: logoutModReq, env })
  assert.equal(logoutModRes.status, 200)

  const modReq3 = new Request('http://localhost/api/auth/session', { headers: { Authorization: `Bearer ${modernToken}` } })
  const modRes3 = await authCore.authenticateUserRequest(modReq3, env)
  assert.equal(modRes3.status, 401)
  assert.match(modRes3.error, /revoked/i)
})

