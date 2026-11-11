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
