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
  performCloudSongbookSync,
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

function createMockD1() {
  const users = new Map()
  const songbooks = new Map()

  return {
    _users: users,
    _songbooks: songbooks,
    prepare(sql) {
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
          if (sql.includes('FROM user_songbooks WHERE user_id = ?')) {
            const [userId] = bound
            return songbooks.get(userId) || null
          }
          return null
        },
        async all() {
          return { results: [], success: true }
        },
        async run() {
          if (sql.includes('INSERT INTO users')) {
            const [id, google_sub, email, display_name, picture_url, role, access_status, created_at, updated_at, last_login_at] = bound
            users.set(id, {
              id,
              google_sub,
              email,
              display_name,
              picture_url,
              role,
              access_status,
              created_at,
              updated_at,
              last_login_at,
            })
            return { success: true }
          }
          if (sql.includes('INSERT INTO user_songbooks')) {
            const [userId, version, dataJson, checksum, updatedAt] = bound
            songbooks.set(userId, {
              user_id: userId,
              version,
              data_json: dataJson,
              checksum,
              updated_at: updatedAt,
            })
            return { success: true }
          }
          return { success: true }
        },
      }
    },
  }
}

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem(k) {
      return store.has(k) ? store.get(k) : null
    },
    setItem(k, v) {
      store.set(k, String(v))
    },
    removeItem(k) {
      store.delete(k)
    },
    clear() {
      store.clear()
    },
    get length() {
      return store.size
    },
    key(i) {
      return Array.from(store.keys())[i] || null
    },
  }
}

// ---------------------------------------------------------------------------
// 1. DETERMINISTIC CHECKSUM
// ---------------------------------------------------------------------------
test('CHECKSUM: produces deterministic collision-resistant fingerprint regardless of key order', () => {
  const song1 = {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    title: 'Hotel California',
    artist: 'Eagles',
    key: 'Bm',
    rawContent: '[Bm]Welcome to the Hotel California',
  }
  const song2 = {
    id: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
    title: 'Wonderwall',
    artist: 'Oasis',
    key: 'Em',
    rawContent: '[Em]Today is gonna be the day',
  }

  const libA = { songs: [song1, song2], setlists: [] }
  const libB = { songs: [song2, song1], setlists: [] } // reverse array order

  const hashA = computeSongbookChecksum(libA)
  const hashB = computeSongbookChecksum(libB)

  assert.equal(hashA, hashB, 'Checksum must be identical regardless of song array order')
  assert.match(hashA, /^ck_[0-9a-f]{16}$/, 'Checksum format matches ck_<16hex>')

  // Modifying content must change checksum
  const modifiedSong = { ...song1, rawContent: '[Bm]Changed lyrics' }
  const libC = { songs: [modifiedSong, song2], setlists: [] }
  const hashC = computeSongbookChecksum(libC)
  assert.notEqual(hashA, hashC, 'Content change must produce distinct checksum')
})

// ---------------------------------------------------------------------------
// 2. DETERMINISTIC DECISION LOGIC: 7 CORE STATES
// ---------------------------------------------------------------------------
test('DECISION: LOCAL_ONLY triggers UPLOAD when cloud is empty', () => {
  const localLib = {
    songs: [{ id: generateUUID(), title: 'My Song', rawContent: '[C]Hello' }],
    setlists: [],
  }
  const result = evaluateSyncDecision({
    localData: localLib,
    cloudRecord: null,
    baseMeta: null,
  })

  assert.equal(result.decision, 'UPLOAD')
  assert.equal(result.state, 'LOCAL_ONLY')
})

test('DECISION: CLOUD_ONLY triggers DOWNLOAD when local is empty and cloud has songs', () => {
  const localLib = { songs: [], setlists: [] }
  const remoteSong = { id: generateUUID(), title: 'Cloud Song', rawContent: '[G]Sky' }
  const remoteLib = { songs: [remoteSong], setlists: [] }
  const cloudRecord = {
    version: 1,
    checksum: computeSongbookChecksum(remoteLib),
    updatedAt: new Date().toISOString(),
    data: remoteLib,
  }

  const result = evaluateSyncDecision({
    localData: localLib,
    cloudRecord,
    baseMeta: null,
  })

  assert.equal(result.decision, 'DOWNLOAD')
  assert.equal(result.state, 'CLOUD_ONLY')
})

test('DECISION: SAME_STATE triggers NOOP when checksums match', () => {
  const song = { id: generateUUID(), title: 'Synced Song', rawContent: '[D]Sync' }
  const lib = { songs: [song], setlists: [] }
  const checksum = computeSongbookChecksum(lib)
  const cloudRecord = {
    version: 5,
    checksum,
    updatedAt: new Date().toISOString(),
    data: lib,
  }

  const result = evaluateSyncDecision({
    localData: lib,
    cloudRecord,
    baseMeta: { lastSyncedChecksum: checksum, lastSyncedAt: Date.now(), cloudVersion: 5 },
  })

  assert.equal(result.decision, 'NOOP')
  assert.equal(result.state, 'SAME_STATE')
})

test('DECISION: LOCAL_NEWER triggers UPLOAD when cloud matches base and local changed', () => {
  const songBase = { id: generateUUID(), title: 'Base Song', rawContent: '[A]Base' }
  const baseLib = { songs: [songBase], setlists: [] }
  const baseChecksum = computeSongbookChecksum(baseLib)

  const localEdited = { songs: [{ ...songBase, rawContent: '[A]Edited locally' }], setlists: [] }

  const cloudRecord = {
    version: 2,
    checksum: baseChecksum, // cloud unchanged
    updatedAt: new Date().toISOString(),
    data: baseLib,
  }

  const result = evaluateSyncDecision({
    localData: localEdited,
    cloudRecord,
    baseMeta: { lastSyncedChecksum: baseChecksum, lastSyncedAt: Date.now(), cloudVersion: 2 },
  })

  assert.equal(result.decision, 'UPLOAD')
  assert.equal(result.state, 'LOCAL_NEWER')
})

test('DECISION: CLOUD_NEWER triggers DOWNLOAD when local matches base and cloud changed', () => {
  const songBase = { id: generateUUID(), title: 'Base Song', rawContent: '[A]Base' }
  const baseLib = { songs: [songBase], setlists: [] }
  const baseChecksum = computeSongbookChecksum(baseLib)

  const remoteEdited = { songs: [{ ...songBase, rawContent: '[A]Edited on another device' }], setlists: [] }
  const remoteChecksum = computeSongbookChecksum(remoteEdited)

  const cloudRecord = {
    version: 3,
    checksum: remoteChecksum,
    updatedAt: new Date().toISOString(),
    data: remoteEdited,
  }

  const result = evaluateSyncDecision({
    localData: baseLib, // local unchanged
    cloudRecord,
    baseMeta: { lastSyncedChecksum: baseChecksum, lastSyncedAt: Date.now(), cloudVersion: 2 },
  })

  assert.equal(result.decision, 'DOWNLOAD')
  assert.equal(result.state, 'CLOUD_NEWER')
})

test('DECISION: CONFLICT detected when both local and cloud have changed since base', () => {
  const songBase = { id: generateUUID(), title: 'Base Song', rawContent: '[A]Base' }
  const baseLib = { songs: [songBase], setlists: [] }
  const baseChecksum = computeSongbookChecksum(baseLib)

  const localEdited = { songs: [{ ...songBase, rawContent: '[A]Local change' }], setlists: [] }
  const remoteEdited = { songs: [{ ...songBase, rawContent: '[A]Remote change' }], setlists: [] }
  const remoteChecksum = computeSongbookChecksum(remoteEdited)

  const cloudRecord = {
    version: 3,
    checksum: remoteChecksum,
    updatedAt: new Date().toISOString(),
    data: remoteEdited,
  }

  const result = evaluateSyncDecision({
    localData: localEdited,
    cloudRecord,
    baseMeta: { lastSyncedChecksum: baseChecksum, lastSyncedAt: Date.now(), cloudVersion: 2 },
  })

  assert.equal(result.decision, 'CONFLICT')
  assert.equal(result.state, 'CONFLICT')
})

test('DECISION: OFFLINE_OR_CLOUD_FAILURE prevents destructive action when offline', () => {
  const song = { id: generateUUID(), title: 'Offline Song', rawContent: '[E]Off' }
  const lib = { songs: [song], setlists: [] }

  const result = evaluateSyncDecision({
    localData: lib,
    cloudRecord: null,
    baseMeta: null,
    isOffline: true,
  })

  assert.equal(result.decision, 'OFFLINE')
  assert.equal(result.state, 'OFFLINE_OR_CLOUD_FAILURE')
})

// ---------------------------------------------------------------------------
// 3. RECONCILIATION & SAFE CONFLICT RESOLUTION
// ---------------------------------------------------------------------------
test('RECONCILE: clean additions on either side merge without conflict', () => {
  const songA = { id: generateUUID(), title: 'Song Local', rawContent: '[C]Local' }
  const songB = { id: generateUUID(), title: 'Song Remote', rawContent: '[D]Remote' }

  const local = { songs: [songA], setlists: [] }
  const remote = { songs: [songB], setlists: [] }

  const result = reconcileSongbook(local, remote, null)

  assert.equal(result.hasConflicts, false)
  assert.equal(result.merged.songs.length, 2)
  assert.ok(result.merged.songs.some((s) => s.id === songA.id))
  assert.ok(result.merged.songs.some((s) => s.id === songB.id))
})

test('RECONCILE: conflict creates safe non-destructive copy with distinct UUID and zero data loss', () => {
  const sharedId = generateUUID()
  const baseSong = { id: sharedId, title: 'Shared Song', rawContent: '[G]Original' }
  const localSong = { id: sharedId, title: 'Shared Song', rawContent: '[G]Local modification' }
  const remoteSong = { id: sharedId, title: 'Shared Song', rawContent: '[G]Cloud modification' }

  const local = { songs: [localSong], setlists: [] }
  const remote = { songs: [remoteSong], setlists: [] }
  const base = { songs: [baseSong], setlists: [] }

  const result = reconcileSongbook(local, remote, base)

  assert.equal(result.hasConflicts, true)
  assert.equal(result.conflicts.length, 1)
  assert.equal(result.conflicts[0].id, sharedId)

  // Both versions are preserved!
  assert.equal(result.merged.songs.length, 2)
  const keptLocal = result.merged.songs.find((s) => s.id === sharedId)
  assert.equal(keptLocal.rawContent, '[G]Local modification')

  const conflictCopy = result.merged.songs.find((s) => s.id !== sharedId)
  assert.ok(conflictCopy, 'Cloud copy must be preserved as distinct item')
  assert.ok(isValidUUID(conflictCopy.id), 'Conflict copy receives valid UUID')
  assert.equal(conflictCopy.rawContent, '[G]Cloud modification')
  assert.ok(conflictCopy.title.includes('Cloud Copy'))
})

// ---------------------------------------------------------------------------
// 4. SERVER D1 ENDPOINT SECURITY & USER ISOLATION
// ---------------------------------------------------------------------------
test('ENDPOINT: User A cannot access or overwrite User B cloud songbook (strict isolation)', async () => {
  const db = createMockD1()
  const env = { DB: db, AUTH_SECRET: 'test_secret_key' }

  // Insert User A and User B
  const userA = {
    id: 'user_a_uuid',
    google_sub: 'sub_a',
    email: 'user_a@gmail.com',
    role: 'member',
    access_status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  }
  const userB = {
    id: 'user_b_uuid',
    google_sub: 'sub_b',
    email: 'user_b@gmail.com',
    role: 'member',
    access_status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  }

  await insertUser(db, userA)
  await insertUser(db, userB)

  const tokenA = await createSessionToken(userA, env.AUTH_SECRET)
  const tokenB = await createSessionToken(userB, env.AUTH_SECRET)

  // User A uploads their songbook
  const songA = { id: generateUUID(), title: 'User A Secret Song', rawContent: '[A]Private' }
  const reqPostA = new Request('https://gtar.dev/api/songbook/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      action: 'upload',
      data: { songs: [songA], setlists: [] },
    }),
  })

  const postResA = await syncApi.onRequestPost({ request: reqPostA, env })
  assert.equal(postResA.status, 200)

  // User B queries their own songbook -> must be null, CANNOT see User A's data!
  const reqGetB = new Request('https://gtar.dev/api/songbook/sync', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${tokenB}`,
    },
  })

  const getResB = await syncApi.onRequestGet({ request: reqGetB, env })
  assert.equal(getResB.status, 200)
  const dataB = await getResB.json()
  assert.equal(dataB.cloudRecord, null, 'User B must not see User A songbook')

  // User A queries their own songbook -> receives User A songbook
  const reqGetA = new Request('https://gtar.dev/api/songbook/sync', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${tokenA}`,
    },
  })
  const getResA = await syncApi.onRequestGet({ request: reqGetA, env })
  assert.equal(getResA.status, 200)
  const dataA = await getResA.json()
  assert.equal(dataA.cloudRecord.userId, userA.id)
  assert.equal(dataA.cloudRecord.data.songs[0].title, 'User A Secret Song')
})

test('ENDPOINT: unauthenticated or pending users are rejected', async () => {
  const db = createMockD1()
  const env = { DB: db, AUTH_SECRET: 'test_secret_key' }

  // 1. Missing Authorization header
  const reqNoAuth = new Request('https://gtar.dev/api/songbook/sync', { method: 'GET' })
  const resNoAuth = await syncApi.onRequestGet({ request: reqNoAuth, env })
  assert.equal(resNoAuth.status, 401)

  // 2. Pending user
  const pendingUser = {
    id: 'user_pending',
    google_sub: 'sub_pending',
    email: 'pending@gmail.com',
    role: 'member',
    access_status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  }
  await insertUser(db, pendingUser)
  const pendingToken = await createSessionToken(pendingUser, env.AUTH_SECRET)

  const reqPending = new Request('https://gtar.dev/api/songbook/sync', {
    method: 'GET',
    headers: { Authorization: `Bearer ${pendingToken}` },
  })
  const resPending = await syncApi.onRequestGet({ request: reqPending, env })
  assert.equal(resPending.status, 403, 'Pending user must receive 403 Forbidden')
})

// ---------------------------------------------------------------------------
// 5. CANONICAL 108-dev.5 IDENTITIES & COMPATIBILITY PRESERVATION
// ---------------------------------------------------------------------------
test('COMPATIBILITY: Cloud serialization roundtrip preserves 108-dev.5 UUIDs and setlist bindings', async () => {
  const song1 = {
    id: generateUUID(),
    title: 'Stand By Me',
    artist: 'Ben E. King',
    key: 'A',
    rawContent: '[A]Stand by me',
  }
  const song2 = {
    id: generateUUID(),
    title: 'El Bimbo',
    artist: 'Eraserheads',
    key: 'G',
    rawContent: '[G]El Bimbo',
  }

  const setlist = {
    id: generateUUID(),
    name: 'Acoustic Set',
    songs: [
      { id: song1.id, title: song1.title, artist: song1.artist },
      { id: song2.id, title: song2.title, artist: song2.artist },
    ],
  }

  const originalLibrary = {
    songs: [song1, song2],
    setlists: [setlist],
  }

  // Pre-condition: integrity valid
  const preCheck = validateSongbookIntegrity(originalLibrary.songs, originalLibrary.setlists)
  assert.equal(preCheck.isValid, true)

  // Simulate Cloud persistence serialize & deserialize
  const serialized = JSON.stringify(originalLibrary)
  const deserialized = JSON.parse(serialized)

  // Normalization on deserialized data
  const normalized = normalizeSongbookIds(deserialized.songs, deserialized.setlists)
  assert.equal(normalized.migrated, false, 'Valid 108-dev.5 UUIDs must not be re-migrated')
  assert.equal(normalized.songs[0].id, song1.id)
  assert.equal(normalized.songs[1].id, song2.id)
  assert.equal(normalized.setlists[0].songs[0].id, song1.id)
  assert.equal(normalized.setlists[0].songs[1].id, song2.id)

  const postCheck = validateSongbookIntegrity(normalized.songs, normalized.setlists)
  assert.equal(postCheck.isValid, true)
})
