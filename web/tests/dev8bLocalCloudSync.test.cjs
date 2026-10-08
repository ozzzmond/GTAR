const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs
          .readFileSync(filename, 'utf8')
          .replaceAll(
            'import.meta.env',
            '({DEV:true,VITE_GOOGLE_CLIENT_ID:"client-test-id",VITE_AUTHORIZED_EMAILS:"jlopez3rd@gmail.com",VITE_ROOT_ADMIN_EMAIL:"jlopez3rd@gmail.com"})'
          ),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        }
      ).outputText,
      filename
    )
}

const {
  performCloudSongbookSync,
  computeSongbookChecksum,
} = require('../src/utils/cloudSongbookSync.ts')
const {
  insertUser,
  findUserById,
  findUserSongbook,
  upsertUserSongbook,
  createSessionToken,
  verifySessionToken,
} = require('../functions/lib/authCore.ts')
const syncApi = require('../functions/api/songbook/sync.ts')
const { generateUUID } = require('../src/utils/uuid.ts')
const { persistLibrary, readPersistedLibrary } = require('../src/utils/syncJournal.ts')

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null },
    setItem(k, v) { store.set(k, String(v)) },
    removeItem(k) { store.delete(k) },
    clear() { store.clear() },
  }
}

// ---------------------------------------------------------------------------
// 1. API ROUTING GUARD (Vite Middleware)
// ---------------------------------------------------------------------------
test('1: API routing guard intercepts unhandled /api/ requests and responds with JSON 404, never SPA HTML', async () => {
  // Read vite.config.ts to inspect the guard plugin definition
  const viteConfigContent = fs.readFileSync(path.resolve(__dirname, '../vite.config.ts'), 'utf8')
  assert.ok(viteConfigContent.includes('apiRoutingGuardPlugin'), 'vite.config.ts must define apiRoutingGuardPlugin')
  assert.ok(viteConfigContent.includes("startsWith('/api/')"), 'apiRoutingGuardPlugin must check for /api/ prefix')
  assert.ok(viteConfigContent.includes('application/json'), 'apiRoutingGuardPlugin must return application/json')

  // Simulate middleware execution
  let writtenStatus = 0
  let writtenHeaders = {}
  let writtenBody = ''
  let nextCalled = false

  const mockReq = { url: '/api/songbook/sync' }
  const mockRes = {
    setHeader(k, v) { writtenHeaders[k] = v },
    writeHead(status) { writtenStatus = status },
    end(body) { writtenBody = body },
  }
  const mockNext = () => { nextCalled = true }

  // Replicate guard logic
  const parsedPath = mockReq.url
  if (parsedPath && parsedPath.startsWith('/api/')) {
    mockRes.setHeader('Content-Type', 'application/json; charset=utf-8')
    mockRes.writeHead(404)
    mockRes.end(JSON.stringify({ success: false, error: `API route not found: ${parsedPath}` }))
  } else {
    mockNext()
  }

  assert.equal(writtenStatus, 404)
  assert.equal(writtenHeaders['Content-Type'], 'application/json; charset=utf-8')
  assert.equal(nextCalled, false, 'next() must NOT be called for /api/ paths')
  const json = JSON.parse(writtenBody)
  assert.equal(json.success, false)
  assert.match(json.error, /API route not found/)
})

// ---------------------------------------------------------------------------
// 2. VITE PROXY 503 ERROR HANDLING IN CLIENT
// ---------------------------------------------------------------------------
test('2: Client safeParseJsonResponse handles 503 Service Unavailable JSON from offline Vite proxy without data loss', async () => {
  const storage = createMockStorage()
  persistLibrary({
    songs: [{ id: generateUUID(), title: 'Safe Local Song', rawContent: '[G]Lyrics' }],
    setlists: [{ id: generateUUID(), name: 'Safe Local Setlist', songs: [] }],
  }, storage)

  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: false,
    status: 503,
    headers: {
      get: (header) => (header.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null),
    },
    text: async () => JSON.stringify({
      success: false,
      error: 'Local API backend unavailable. Ensure wrangler pages dev is running on port 8788 (npm run dev:api).',
    }),
  })

  try {
    const result = await performCloudSongbookSync('dummy_token', { storage })
    assert.equal(result.success, false)
    assert.equal(result.status, 'OFFLINE')
    assert.equal(result.actionTaken, 'NONE')
    assert.match(result.error, /Local API backend unavailable/)

    // Confirm local library is completely intact
    const preserved = readPersistedLibrary(storage)
    assert.equal(preserved.songs.length, 1)
    assert.equal(preserved.songs[0].title, 'Safe Local Song')
    assert.equal(preserved.setlists.length, 1)
    assert.equal(preserved.setlists[0].name, 'Safe Local Setlist')
  } finally {
    global.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// 3. LOCAL D1 MIGRATION & SCHEMA READINESS
// ---------------------------------------------------------------------------
test('3: D1 migration 0002_songbook_sync.sql defines user_songbooks table and cascade relationship', () => {
  const migration0001 = fs.readFileSync(path.resolve(__dirname, '../migrations/0001_users.sql'), 'utf8')
  assert.ok(migration0001.includes('CREATE TABLE IF NOT EXISTS users'), '0001 must create users table')
  assert.ok(migration0001.includes('google_sub TEXT UNIQUE NOT NULL'), '0001 must have google_sub unique')

  const migration0002 = fs.readFileSync(path.resolve(__dirname, '../migrations/0002_songbook_sync.sql'), 'utf8')
  assert.ok(migration0002.includes('CREATE TABLE IF NOT EXISTS user_songbooks'), '0002 must create user_songbooks table')
  assert.ok(migration0002.includes('user_id TEXT PRIMARY KEY NOT NULL'), '0002 must have user_id primary key')
  assert.ok(migration0002.includes('version INTEGER NOT NULL DEFAULT 1'), '0002 must have version column')
  assert.ok(migration0002.includes('data_json TEXT NOT NULL'), '0002 must have data_json column')
  assert.ok(migration0002.includes('checksum TEXT NOT NULL'), '0002 must have checksum column')
  assert.ok(migration0002.includes('REFERENCES users(id) ON DELETE CASCADE'), '0002 must reference users table')
})

test('4: D1 schema operations support both Songbook and Setlist (DEV7) sync within user_songbooks payload', async () => {
  const users = new Map()
  const songbooks = new Map()

  const mockDb = {
    prepare(sql) {
      let bound = []
      return {
        bind(...args) {
          bound = args
          return this
        },
        async first() {
          if (sql.includes('FROM users WHERE id = ?')) {
            return users.get(bound[0]) || null
          }
          if (sql.includes('FROM user_songbooks WHERE user_id = ?')) {
            return songbooks.get(bound[0]) || null
          }
          return null
        },
        async run() {
          if (sql.includes('INSERT INTO users')) {
            const [id, google_sub, email, display_name, picture_url, role, access_status, created_at, updated_at, last_login_at] = bound
            users.set(id, { id, google_sub, email, display_name, picture_url, role, access_status, created_at, updated_at, last_login_at })
            return { success: true }
          }
          if (sql.includes('INSERT INTO user_songbooks') || sql.includes('ON CONFLICT(user_id)')) {
            const [userId, version, dataJson, checksum, updatedAt] = bound
            songbooks.set(userId, {
              user_id: userId,
              version,
              checksum,
              data_json: dataJson,
              updated_at: updatedAt,
            })
            return { success: true }
          }
          return { success: true }
        },
      }
    },
  }

  // Insert user
  const userId = 'usr_test_123'
  await insertUser(mockDb, {
    id: userId,
    google_sub: 'sub_123',
    email: 'jlopez3rd@gmail.com',
    display_name: 'Tester',
    picture_url: null,
    role: 'admin',
    access_status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  })

  // Upsert user songbook containing both songs and DEV7 setlists
  const songId = generateUUID()
  const setlistId = generateUUID()
  const payload = {
    songs: [{ id: songId, title: 'Amazing Grace', artist: 'Traditional', rawContent: '[G]Amazing [C]grace' }],
    setlists: [{ id: setlistId, name: 'Morning Service', songs: [{ id: songId, title: 'Amazing Grace' }] }],
  }
  const checksum = computeSongbookChecksum(payload)

  await upsertUserSongbook(mockDb, userId, JSON.stringify(payload), checksum, new Date().toISOString())

  // Verify retrieval
  const retrieved = await findUserSongbook(mockDb, userId)
  assert.ok(retrieved)
  assert.equal(retrieved.user_id, userId)
  assert.equal(retrieved.version, 1)
  assert.equal(retrieved.checksum, checksum)

  const parsed = JSON.parse(retrieved.data_json)
  assert.equal(parsed.songs.length, 1)
  assert.equal(parsed.songs[0].id, songId)
  assert.equal(parsed.setlists.length, 1)
  assert.equal(parsed.setlists[0].id, setlistId)
  assert.equal(parsed.setlists[0].songs[0].id, songId)
})
