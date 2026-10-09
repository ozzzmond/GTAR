const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs
          .readFileSync(filename, 'utf8')
          .replaceAll(
            'import.meta.env',
            '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client-test-id",VITE_AUTHORIZED_EMAILS:"jlopez3rd@gmail.com",VITE_ROOT_ADMIN_EMAIL:"jlopez3rd@gmail.com"})'
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
  computeSongbookChecksum,
  evaluateSyncDecision,
  reconcileSongbook,
  readCloudSyncMeta,
  saveCloudSyncMeta,
  readCloudSyncBase,
  saveCloudSyncBase,
  performCloudSongbookSync,
  CLOUD_SYNC_META_KEY,
  CLOUD_SYNC_BASE_KEY,
} = require('../src/utils/cloudSongbookSync.ts')

const {
  insertUser,
  findUserSongbook,
  upsertUserSongbook,
  createSessionToken,
} = require('../functions/lib/authCore.ts')

const syncApi = require('../functions/api/songbook/sync.ts')
const { generateUUID, isValidUUID } = require('../src/utils/uuid.ts')
const { normalizeSongbookIds, validateSongbookIntegrity } = require('../src/utils/songbookFoundation.ts')
const { persistLibrary, readPersistedLibrary } = require('../src/utils/syncJournal.ts')
const { parseStoredSession, createDurableSession } = require('../src/utils/googleAuth.ts')

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null },
    setItem(k, v) { store.set(k, String(v)) },
    removeItem(k) { store.delete(k) },
    clear() { store.clear() },
    _store: store,
  }
}

function createMockD1() {
  const users = new Map()
  const songbookDb = require('./helpers/songbookSqlite.cjs').createSongbookSqlite()

  return {
    _users: users,
    prepare(sql) {
      if (sql.includes('user_songbooks')) return songbookDb.prepare(sql)
      let bound = []
      return {
        bind(...args) {
          bound = args
          return this
        },
        async first() {
          if (sql.includes('FROM users WHERE id = ?')) {
            const [id] = bound
            return users.get(id) || null
          }
          if (sql.includes('FROM users WHERE google_sub = ?')) {
            const [sub] = bound
            for (const u of users.values()) {
              if (u.google_sub === sub) return u
            }
            return null
          }

          return null
        },
        async all() {
          return { results: [], success: true }
        },
        async run() {
          if (sql.includes('INSERT INTO users')) {
            const [id, google_sub, email, display_name, picture_url, role, access_status, created_at, updated_at, last_login_at] = bound
            users.set(id, { id, google_sub, email, display_name, picture_url, role, access_status, created_at, updated_at, last_login_at })
            return { success: true }
          }

          return { success: true }
        },
      }
    },
  }
}

// ===========================================================================
// SECTION 1: ACCOUNT & ACCESS LIFECYCLE HARDENING
// ===========================================================================

test('DEV8_AUTH_01: 401 Unauthorized returns status ERROR and preserves local library intact', async () => {
  const storage = createMockStorage()
  const localLib = {
    songs: [{ id: generateUUID(), title: 'Offline Local Song', rawContent: '[G]Local' }],
    setlists: [{ id: generateUUID(), name: 'Sunday Set', songs: [] }],
  }
  persistLibrary(localLib, storage)

  // Mock global fetch to return 401 Unauthorized
  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: 'Invalid or expired session token' }),
  })

  try {
    const result = await performCloudSongbookSync('expired_or_invalid_token', { storage })
    assert.equal(result.success, false)
    assert.equal(result.status, 'ERROR')
    assert.equal(result.actionTaken, 'NONE')
    assert.match(result.error, /expired or unauthorized/i)

    // Verify local library was NEVER modified or deleted
    const preserved = readPersistedLibrary(storage)
    assert.equal(preserved.songs.length, 1)
    assert.equal(preserved.songs[0].title, 'Offline Local Song')
    assert.equal(preserved.setlists.length, 1)
    assert.equal(preserved.setlists[0].name, 'Sunday Set')
  } finally {
    global.fetch = originalFetch
  }
})

test('DEV8_AUTH_02: 403 Forbidden returns status ERROR and preserves local library intact', async () => {
  const storage = createMockStorage()
  const localLib = {
    songs: [{ id: generateUUID(), title: 'Local Song', rawContent: '[A]Song' }],
    setlists: [],
  }
  persistLibrary(localLib, storage)

  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: 'Forbidden: Active account approval required' }),
  })

  try {
    const result = await performCloudSongbookSync('pending_token', { storage })
    assert.equal(result.success, false)
    assert.equal(result.status, 'ERROR')
    assert.equal(result.actionTaken, 'NONE')

    const preserved = readPersistedLibrary(storage)
    assert.equal(preserved.songs.length, 1)
    assert.equal(preserved.songs[0].title, 'Local Song')
  } finally {
    global.fetch = originalFetch
  }
})

test('DEV8_AUTH_03: Multi-user isolation on shared device clears previous user base snapshot', async () => {
  const storage = createMockStorage()
  const localLib = {
    songs: [{ id: generateUUID(), title: 'User B Local Song', rawContent: '[C]Chord' }],
    setlists: [],
  }
  persistLibrary(localLib, storage)

  // Stale base metadata in storage belongs to User A
  saveCloudSyncMeta({
    lastSyncedChecksum: 'ck_user_a_stale_checksum',
    lastSyncedAt: Date.now() - 100000,
    cloudVersion: 5,
    lastSyncedUserId: 'user_a_uuid',
  }, storage)

  const originalFetch = global.fetch
  global.fetch = async (url, options) => {
    if (options?.method === 'GET') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          cloudRecord: null, // User B has no cloud record yet
          userId: 'user_b_uuid',
        }),
      }
    }
    if (options?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          cloudRecord: { version: 1, checksum: 'ck_user_b_v1', updatedAt: new Date().toISOString() },
          userId: 'user_b_uuid',
        }),
      }
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const result = await performCloudSongbookSync('token_for_user_b', { storage })
    assert.equal(result.success, true)
    assert.equal(result.actionTaken, 'UPLOADED')

    // Stored metadata must now belong to User B, not User A
    const updatedMeta = readCloudSyncMeta(storage)
    assert.equal(updatedMeta.lastSyncedUserId, 'user_b_uuid')
  } finally {
    global.fetch = originalFetch
  }
})

// ===========================================================================
// SECTION 2: DATA INTEGRITY & MALFORMED REMOTE RECOVERY
// ===========================================================================

test('DEV8_DATA_01: Malformed cloud payload (missing arrays) is rejected safely without data loss', async () => {
  const storage = createMockStorage()
  const localLib = {
    songs: [{ id: generateUUID(), title: 'Critical Local Composition', rawContent: '[E]Intro' }],
    setlists: [{ id: generateUUID(), name: 'Album Tracklist', songs: [] }],
  }
  persistLibrary(localLib, storage)

  const originalFetch = global.fetch
  // Remote sends corrupted data payload where songs is not an array
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      cloudRecord: {
        userId: 'user_1',
        version: 2,
        checksum: 'ck_corrupted',
        updatedAt: new Date().toISOString(),
        data: { songs: 'not-an-array', setlists: null },
      },
    }),
  })

  try {
    const result = await performCloudSongbookSync('token_1', { storage, forceAction: 'download' })
    assert.equal(result.success, false)
    assert.equal(result.status, 'ERROR')
    assert.match(result.error, /malformed or missing songs\/setlists/i)

    // Local library MUST remain completely preserved
    const preserved = readPersistedLibrary(storage)
    assert.equal(preserved.songs.length, 1)
    assert.equal(preserved.songs[0].title, 'Critical Local Composition')
  } finally {
    global.fetch = originalFetch
  }
})

test('DEV8_DATA_02: Cloud payload failing referential integrity check is rejected safely', async () => {
  const storage = createMockStorage()
  const localLib = {
    songs: [{ id: generateUUID(), title: 'Safe Local Song', rawContent: '[C]Safe' }],
    setlists: [],
  }
  persistLibrary(localLib, storage)

  const badSongId = generateUUID()
  const originalFetch = global.fetch
  // Remote sends duplicated song IDs which violates RFC referential integrity
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      cloudRecord: {
        userId: 'user_1',
        version: 3,
        checksum: 'ck_violating_integrity',
        updatedAt: new Date().toISOString(),
        data: {
          songs: [
            { id: badSongId, title: 'Duplicate Song 1', rawContent: '[A]Test' },
            { id: badSongId, title: 'Duplicate Song 2', rawContent: '[B]Test' },
          ],
          setlists: [],
        },
      },
    }),
  })

  try {
    const result = await performCloudSongbookSync('token_1', { storage, forceAction: 'download' })
    assert.equal(result.success, false)
    assert.equal(result.status, 'ERROR')
    assert.match(result.error, /failed referential integrity check/i)

    // Local library remains untouched
    const preserved = readPersistedLibrary(storage)
    assert.equal(preserved.songs.length, 1)
    assert.equal(preserved.songs[0].title, 'Safe Local Song')
  } finally {
    global.fetch = originalFetch
  }
})

test('DEV8_DATA_03: Network interruption or timeout fails safe with status OFFLINE', async () => {
  const storage = createMockStorage()
  const localLib = {
    songs: [{ id: generateUUID(), title: 'Local Untouched', rawContent: '[D]Safe' }],
    setlists: [],
  }
  persistLibrary(localLib, storage)

  const originalFetch = global.fetch
  global.fetch = async () => {
    throw new TypeError('Network request failed: device offline')
  }

  try {
    const result = await performCloudSongbookSync('token_1', { storage })
    assert.equal(result.success, false)
    assert.equal(result.status, 'OFFLINE')
    assert.equal(result.actionTaken, 'NONE')

    const preserved = readPersistedLibrary(storage)
    assert.equal(preserved.songs.length, 1)
    assert.equal(preserved.songs[0].title, 'Local Untouched')
  } finally {
    global.fetch = originalFetch
  }
})

test('DEV8_DATA_04: Canonical Checksum produces 100% identical fingerprint on client and server', async () => {
  const song1 = { id: generateUUID(), title: 'Zebra Song', rawContent: '[A]Line\r\n' }
  const song2 = { id: generateUUID(), title: 'Apple Song', rawContent: '[B]Line\n' }
  const setlist = { id: generateUUID(), name: 'Set A', songs: [{ id: song1.id, title: song1.title }] }

  const libOrder1 = { songs: [song1, song2], setlists: [setlist] }
  const libOrder2 = { songs: [song2, song1], setlists: [setlist] }

  const ck1 = computeSongbookChecksum(libOrder1)
  const ck2 = computeSongbookChecksum(libOrder2)

  assert.equal(ck1, ck2, 'Checksum must be invariant to song order and CRLF newlines')

  // Verify server computes identical checksum
  const db = createMockD1()
  const env = { DB: db, AUTH_SECRET: 'test_secret' }
  const user = {
    id: 'user_chk_test',
    google_sub: 'sub_chk',
    email: 'chk@test.com',
    role: 'member',
    access_status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  }
  await insertUser(db, user)
  const token = await createSessionToken(user, env.AUTH_SECRET)

  const postReq = new Request('https://gtar.dev/api/songbook/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'upload', data: libOrder1, expectedVersion: 0, expectedChecksum: null }),
  })

  const postRes = await syncApi.onRequestPost({ request: postReq, env })
  assert.equal(postRes.status, 200)
  const postData = await postRes.json()
  assert.equal(postData.cloudRecord.checksum, ck1, 'Server checksum must exactly match client checksum')
})

// ===========================================================================
// SECTION 3: CLOUD SETLIST & TOMBSTONE RECONCILIATION HARDENING
// ===========================================================================

test('DEV8_SETLIST_01: Dual tombstone of setlist keeps tombstone without resurrection or conflict copy', () => {
  const setlistId = generateUUID()
  const baseSetlist = { id: setlistId, name: 'Gig Setlist', songs: [], isDeleted: false }
  const localSetlist = { id: setlistId, name: 'Gig Setlist (renamed locally)', songs: [], isDeleted: true }
  const remoteSetlist = { id: setlistId, name: 'Gig Setlist (renamed remotely)', songs: [], isDeleted: true }

  const base = { songs: [], setlists: [baseSetlist] }
  const local = { songs: [], setlists: [localSetlist] }
  const remote = { songs: [], setlists: [remoteSetlist] }

  const reconciliation = reconcileSongbook(local, remote, base)
  assert.equal(reconciliation.hasConflicts, false, 'Dual deletion must not be flagged as conflict')
  assert.equal(reconciliation.merged.setlists.length, 1)
  assert.equal(reconciliation.merged.setlists[0].id, setlistId)
  assert.equal(reconciliation.merged.setlists[0].isDeleted, true, 'Setlist must remain tombstoned')
})

test('DEV8_SETLIST_02: Dual deletion of song keeps song deleted without conflict copy', () => {
  const songId = generateUUID()
  const baseSong = { id: songId, title: 'Old Song', rawContent: '[G]Old', isDeleted: false }
  const localSong = { id: songId, title: 'Old Song (Edited)', rawContent: '[A]Edited', isDeleted: true }
  const remoteSong = { id: songId, title: 'Old Song (Cloud Edited)', rawContent: '[C]Cloud', isDeleted: true }

  const base = { songs: [baseSong], setlists: [] }
  const local = { songs: [localSong], setlists: [] }
  const remote = { songs: [remoteSong], setlists: [] }

  const reconciliation = reconcileSongbook(local, remote, base)
  assert.equal(reconciliation.hasConflicts, false)
  assert.equal(reconciliation.merged.songs.length, 1)
  assert.equal(reconciliation.merged.songs[0].id, songId)
  assert.equal(reconciliation.merged.songs[0].isDeleted, true)
})

test('DEV8_SETLIST_03: Local edit vs remote delete preserves local edit safely', () => {
  const songId = generateUUID()
  const baseSong = { id: songId, title: 'Active Song', rawContent: '[G]Original', isDeleted: false }
  const localSong = { id: songId, title: 'Active Song (New Verse)', rawContent: '[G]Updated', isDeleted: false }
  const remoteSong = { id: songId, title: 'Active Song', rawContent: '[G]Original', isDeleted: true }

  const base = { songs: [baseSong], setlists: [] }
  const local = { songs: [localSong], setlists: [] }
  const remote = { songs: [remoteSong], setlists: [] }

  const reconciliation = reconcileSongbook(local, remote, base)
  assert.equal(reconciliation.hasConflicts, true)
  assert.equal(reconciliation.merged.songs.length, 1)
  assert.equal(reconciliation.merged.songs[0].id, songId)
  assert.equal(reconciliation.merged.songs[0].isDeleted, false)
  assert.equal(reconciliation.merged.songs[0].rawContent, '[G]Updated')
})

test('DEV8_SETLIST_04: Remote edit vs local delete preserves remote edit as conflict copy', () => {
  const setlistId = generateUUID()
  const baseSetlist = { id: setlistId, name: 'Live Set', songs: [], isDeleted: false }
  const localSetlist = { id: setlistId, name: 'Live Set', songs: [], isDeleted: true }
  const remoteSetlist = { id: setlistId, name: 'Live Set (Revised)', songs: [], isDeleted: false }

  const base = { songs: [], setlists: [baseSetlist] }
  const local = { songs: [], setlists: [localSetlist] }
  const remote = { songs: [], setlists: [remoteSetlist] }

  const reconciliation = reconcileSongbook(local, remote, base)
  assert.equal(reconciliation.hasConflicts, true)
  assert.equal(reconciliation.merged.setlists.length, 2)
  // Local tombstone preserved
  assert.equal(reconciliation.merged.setlists[0].id, setlistId)
  assert.equal(reconciliation.merged.setlists[0].isDeleted, true)
  // Remote preserved as conflict copy
  assert.equal(reconciliation.merged.setlists[1].name, 'Live Set (Revised) (Cloud Copy)')
  assert.equal(reconciliation.merged.setlists[1].isDeleted, false)
  assert.notEqual(reconciliation.merged.setlists[1].id, setlistId)
})

// ===========================================================================
// SECTION 4: FRESH ENVIRONMENT REHEARSAL
// ===========================================================================

test('DEV8_FRESH_01: Clean environment empty storage initializes with valid RFC4122 v4 UUIDs', () => {
  const rawSongs = [
    { title: 'Stand By Me', rawContent: '[A]Chords' },
    { title: 'El Bimbo', rawContent: '[G]Chords' },
  ]
  const rawSetlists = [
    { name: 'Default Setlist', songs: [{ title: 'Stand By Me' }] },
  ]

  const normalized = normalizeSongbookIds(rawSongs, rawSetlists)
  assert.equal(normalized.migrated, true)
  for (const s of normalized.songs) {
    assert.equal(isValidUUID(s.id), true, `Song "${s.title}" must have valid UUID`)
  }
  for (const sl of normalized.setlists) {
    assert.equal(isValidUUID(sl.id), true, `Setlist "${sl.name}" must have valid UUID`)
    assert.equal(isValidUUID(sl.songs[0].id), true, 'Setlist song ref must bind to UUID')
  }

  const report = validateSongbookIntegrity(normalized.songs, normalized.setlists)
  assert.equal(report.isValid, true)
})

test('DEV8_FRESH_02: First cloud sync on empty remote uploads initial library cleanly', async () => {
  const storage = createMockStorage()
  const initialSongs = [
    { id: generateUUID(), title: 'First Song', rawContent: '[C]Verse' },
  ]
  const initialSetlists = [
    { id: generateUUID(), name: 'First Setlist', songs: [{ id: initialSongs[0].id, title: 'First Song' }] },
  ]
  persistLibrary({ songs: initialSongs, setlists: initialSetlists }, storage)

  let uploadedPayload = null
  const originalFetch = global.fetch
  global.fetch = async (url, options) => {
    if (options?.method === 'GET') {
      return {
        ok: true,
        json: async () => ({ success: true, cloudRecord: null, userId: 'fresh_user_1' }),
      }
    }
    if (options?.method === 'POST') {
      uploadedPayload = JSON.parse(options.body)
      return {
        ok: true,
        json: async () => ({
          success: true,
          cloudRecord: { version: 1, checksum: 'ck_uploaded_fresh', updatedAt: new Date().toISOString() },
          userId: 'fresh_user_1',
        }),
      }
    }
    throw new Error('Unknown route')
  }

  try {
    const result = await performCloudSongbookSync('fresh_token', { storage })
    assert.equal(result.success, true)
    assert.equal(result.actionTaken, 'UPLOADED')
    assert.equal(uploadedPayload.action, 'upload')
    assert.equal(uploadedPayload.data.songs.length, 1)
    assert.equal(uploadedPayload.data.setlists.length, 1)

    // Base snapshot saved in storage
    const base = readCloudSyncBase(storage)
    assert.ok(base)
    assert.equal(base.songs.length, 1)
  } finally {
    global.fetch = originalFetch
  }
})

test('DEV8_FRESH_03: Repeated/replayed sync operations produce identical stable state (idempotency)', async () => {
  const storage = createMockStorage()
  const lib = {
    songs: [{ id: generateUUID(), title: 'Stable Song', rawContent: '[D]Stable' }],
    setlists: [],
  }
  const ck = computeSongbookChecksum(lib)
  persistLibrary(lib, storage)
  saveCloudSyncMeta({ lastSyncedChecksum: ck, lastSyncedAt: Date.now(), cloudVersion: 1 }, storage)
  saveCloudSyncBase(lib, storage)

  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      cloudRecord: { version: 1, checksum: ck, updatedAt: new Date().toISOString(), data: lib },
      userId: 'idempotent_user',
    }),
  })

  try {
    // Run 3 consecutive sync operations
    for (let i = 0; i < 3; i++) {
      const result = await performCloudSongbookSync('token', { storage })
      assert.equal(result.success, true)
      assert.equal(result.status, 'IN_SYNC')
      assert.equal(result.actionTaken, 'NONE')
    }
    const finalLib = readPersistedLibrary(storage)
    assert.equal(finalLib.songs.length, 1)
    assert.equal(finalLib.songs[0].id, lib.songs[0].id)
  } finally {
    global.fetch = originalFetch
  }
})

test('DEV8_DATA_05: Non-JSON responses (HTML 404 / 500 / Vite SPA fallback) fail safely without unhandled JSON.parse crash and preserve local library', async () => {
  const storage = createMockStorage()
  const localLib = {
    songs: [{ id: generateUUID(), title: 'Untouched Safe Song', rawContent: '[G]Safe' }],
    setlists: [{ id: generateUUID(), name: 'Main Set', songs: [] }],
  }
  persistLibrary(localLib, storage)

  const originalFetch = global.fetch

  // Case 1: Status 200 with HTML (e.g. localhost Vite index.html SPA fallback)
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (header) => (header.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
    },
    text: async () => '<!doctype html><html><body>Root SPA Fallback</body></html>',
  })

  try {
    const result = await performCloudSongbookSync('test_token', { storage })
    assert.equal(result.success, false)
    assert.equal(result.status, 'ERROR')
    assert.match(result.error, /non-JSON response \(200\)/)

    // Ensure local library is unharmed
    const preserved = readPersistedLibrary(storage)
    assert.equal(preserved.songs.length, 1)
    assert.equal(preserved.songs[0].title, 'Untouched Safe Song')
  } finally {
    global.fetch = originalFetch
  }

  // Case 2: Status 404 with HTML error page
  global.fetch = async () => ({
    ok: false,
    status: 404,
    headers: {
      get: (header) => (header.toLowerCase() === 'content-type' ? 'text/html' : null),
    },
    text: async () => '<html><body>404 Not Found</body></html>',
  })

  try {
    const result404 = await performCloudSongbookSync('test_token', { storage })
    assert.equal(result404.success, false)
    assert.equal(result404.status, 'OFFLINE')
    assert.match(result404.error, /non-JSON \(404\)/)

    // Local library still preserved
    const preserved = readPersistedLibrary(storage)
    assert.equal(preserved.songs.length, 1)
  } finally {
    global.fetch = originalFetch
  }
})

