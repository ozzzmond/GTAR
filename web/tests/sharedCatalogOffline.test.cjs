const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Set up ts transpilation for web utils
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs
          .readFileSync(filename, 'utf8')
          .replaceAll(
            'import.meta.env',
            '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client-test-id"})'
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

const { MockIDBFactory, MockIDBKeyRange } = require('./helpers/mockIdb.cjs')

// Set global IDBKeyRange if missing in node environment
if (typeof globalThis.IDBKeyRange === 'undefined') {
  globalThis.IDBKeyRange = MockIDBKeyRange
}

const {
  listSharedCatalogSongs,
  getSharedCatalogSong,
  getAuthenticatedSessionToken,
} = require('../src/utils/sharedCatalogClient.ts')

const {
  saveSongsToCache,
  getCachedSongs,
  getCachedSongById,
  getCachedMetadata,
  removeCachedSong,
  clearAccountCatalogCache,
  buildCompositeKey,
} = require('../src/utils/sharedCatalogCache.ts')

const {
  SharedCatalogService,
} = require('../src/utils/sharedCatalogService.ts')

const {
  cloneSharedCatalogSongToPersonal,
} = require('../src/utils/sharedCatalogImport.ts')

const {
  computeSongbookChecksum,
} = require('../src/utils/cloudSongbookSync.ts')

const {
  generateUUID,
  isValidUUID,
} = require('../src/utils/uuid.ts')

const {
  SESSION_STORAGE_KEY,
} = require('../src/utils/googleAuth.ts')

// Helper to configure simulated sessionStorage for auth
function setTestSession(user, token = 'valid-jwt-token') {
  const session = {
    version: 1,
    user: {
      id: user.id || 'user-1',
      sub: user.sub || 'google-sub-1',
      email: user.email || 'user1@gtar.app',
      name: user.name || 'User One',
      role: user.role || 'member',
      access_status: user.access_status || 'active',
      email_verified: true,
    },
    authenticatedAt: Date.now(),
    lastVerifiedAt: Date.now(),
    localExpiresAt: Date.now() + 3600000,
    expiresAt: Date.now() + 3600000,
    sessionToken: token,
    role: user.role || 'member',
    access_status: user.access_status || 'active',
  }

  // Set up window/localStorage/sessionStorage mock if needed
  const store = new Map()
  store.set(SESSION_STORAGE_KEY, JSON.stringify(session))

  globalThis.localStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  }
}

function clearTestSession() {
  if (globalThis.localStorage) {
    globalThis.localStorage.clear()
  }
}

// Mock song builder
function createMockSharedSong(id, title, artist = 'Artist', revision = 1) {
  return {
    id,
    title,
    artist,
    key: 'G',
    original_key: 'G',
    capo: '0',
    bpm: '120',
    time_signature: '4/4',
    year: '2024',
    raw_content: '{title: ' + title + '}\n[G]Amazing [C]grace',
    format: 'CHORD_PRO',
    checksum: 'mock-checksum-' + id + '-r' + revision,
    publisher_user_id: 'publisher-user-id-999',
    last_editor_user_id: 'editor-user-id-888',
    current_revision: revision,
    created_at: '2026-10-12T12:00:00Z',
    updated_at: '2026-10-12T12:00:00Z',
  }
}

test('Scenario 1: Paginated fetch and successful caching in IndexedDB', async () => {
  setTestSession({ id: 'acc-1', email: 'acc1@gtar.app' })
  const mockIdb = new MockIDBFactory()

  const song1 = createMockSharedSong('song-1', 'Hotel California')
  const song2 = createMockSharedSong('song-2', 'Desperado')

  // Mock fetch
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    assert.match(url, /\/api\/catalog\/songs\?limit=20&offset=0/)
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: true,
        songs: [song1, song2],
        pagination: { limit: 20, offset: 0, total: 2, has_more: false },
      }),
    }
  }

  try {
    const service = new SharedCatalogService()
    const result = await service.getCatalogSongs({ indexedDBFactory: mockIdb })

    assert.equal(result.state, 'ONLINE')
    assert.equal(result.isStale, false)
    assert.equal(result.songs.length, 2)
    assert.equal(result.total, 2)

    // Verify written to IndexedDB
    const cached = await getCachedSongs('acc-1', { indexedDBFactory: mockIdb })
    assert.equal(cached.length, 2)
    assert.equal(cached[0].id, 'song-1')
    assert.equal(cached[0].compositeKey, buildCompositeKey('acc-1', 'song-1'))
    assert.ok(cached[0].fetchedAt > 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Scenario 2: Offline browsing of cached records when network is down', async () => {
  setTestSession({ id: 'acc-1', email: 'acc1@gtar.app' })
  const mockIdb = new MockIDBFactory()

  // Pre-seed cache
  const song1 = createMockSharedSong('song-1', 'Song One')
  const song2 = createMockSharedSong('song-2', 'Song Two')
  await saveSongsToCache('acc-1', [song1, song2], { indexedDBFactory: mockIdb })

  // Network down
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('Failed to fetch (offline network)')
  }

  try {
    const service = new SharedCatalogService()
    const result = await service.getCatalogSongs({ indexedDBFactory: mockIdb })

    assert.equal(result.state, 'OFFLINE_CACHED')
    assert.equal(result.isStale, false)
    assert.equal(result.songs.length, 2)
    assert.equal(result.total, 2)
    assert.equal(result.songs[0].id, 'song-1')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Scenario 3: Fresh install with no cache and offline returns ERROR, not empty catalog', async () => {
  setTestSession({ id: 'acc-1', email: 'acc1@gtar.app' })
  const mockIdb = new MockIDBFactory()

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('Network error')
  }

  try {
    const service = new SharedCatalogService()
    const result = await service.getCatalogSongs({ indexedDBFactory: mockIdb })

    assert.equal(result.state, 'ERROR')
    assert.equal(result.songs.length, 0)
    assert.match(result.error, /Network error/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Scenario 4: Network timeout triggers structured timeout error and fallback to cache', async () => {
  setTestSession({ id: 'acc-1', email: 'acc1@gtar.app' })
  const mockIdb = new MockIDBFactory()

  const song1 = createMockSharedSong('song-1', 'Song One')
  await saveSongsToCache('acc-1', [song1], { indexedDBFactory: mockIdb })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_, opts) => {
    return new Promise((_, reject) => {
      opts.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })
  }

  try {
    const service = new SharedCatalogService()
    const result = await service.getCatalogSongs({
      indexedDBFactory: mockIdb,
      timeoutMs: 50,
    })

    assert.equal(result.state, 'OFFLINE_CACHED')
    assert.equal(result.songs.length, 1)
    assert.match(result.error, /timed out/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Scenario 5: Cache / IndexedDB unavailable degrades gracefully without breaking online access', async () => {
  setTestSession({ id: 'acc-1', email: 'acc1@gtar.app' })
  const mockIdb = new MockIDBFactory()
  mockIdb._simulateUnavailable = true // IDB disabled in private browsing or unsupported

  const song1 = createMockSharedSong('song-1', 'Online Only Song')

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: true,
        songs: [song1],
        pagination: { limit: 20, offset: 0, total: 1, has_more: false },
      }),
    }
  }

  try {
    const service = new SharedCatalogService()
    const result = await service.getCatalogSongs({ indexedDBFactory: mockIdb })

    assert.equal(result.state, 'ONLINE')
    assert.equal(result.songs.length, 1)
    assert.equal(result.songs[0].id, 'song-1')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Scenario 6: Quota failure in IndexedDB does not break online catalog access', async () => {
  setTestSession({ id: 'acc-1', email: 'acc1@gtar.app' })
  const mockIdb = new MockIDBFactory()

  // Initialize DB and turn on quota simulation
  await mockIdb.open('gtar_shared_catalog_db')
  const db = mockIdb.databases.get('gtar_shared_catalog_db')
  db._simulateQuotaError = true

  const song1 = createMockSharedSong('song-1', 'Quota Exceeded Song')

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: true,
        songs: [song1],
        pagination: { limit: 20, offset: 0, total: 1, has_more: false },
      }),
    }
  }

  try {
    const service = new SharedCatalogService()
    const result = await service.getCatalogSongs({ indexedDBFactory: mockIdb })

    assert.equal(result.state, 'ONLINE')
    assert.equal(result.songs.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Scenario 7: Account switch and logout isolation prevents data leaks across accounts', async () => {
  const mockIdb = new MockIDBFactory()

  // Account A logs in and fetches catalog
  setTestSession({ id: 'acc-a', email: 'a@gtar.app' })
  const songA = createMockSharedSong('song-a', 'Account A Secret Song')
  await saveSongsToCache('acc-a', [songA], { indexedDBFactory: mockIdb })

  // Account B logs in
  setTestSession({ id: 'acc-b', email: 'b@gtar.app' })
  const songB = createMockSharedSong('song-b', 'Account B Song')
  await saveSongsToCache('acc-b', [songB], { indexedDBFactory: mockIdb })

  // Verify Account B only sees Account B's cached records
  const cachedForB = await getCachedSongs('acc-b', { indexedDBFactory: mockIdb })
  assert.equal(cachedForB.length, 1)
  assert.equal(cachedForB[0].title, 'Account B Song')

  // Verify Account A's record is completely isolated
  const cachedForA = await getCachedSongs('acc-a', { indexedDBFactory: mockIdb })
  assert.equal(cachedForA.length, 1)
  assert.equal(cachedForA[0].title, 'Account A Secret Song')

  // Logout / clear Account A
  await clearAccountCatalogCache('acc-a', { indexedDBFactory: mockIdb })
  const cachedForAAfter = await getCachedSongs('acc-a', { indexedDBFactory: mockIdb })
  assert.equal(cachedForAAfter.length, 0)

  // Account B's data remains untouched
  const cachedForBAfter = await getCachedSongs('acc-b', { indexedDBFactory: mockIdb })
  assert.equal(cachedForBAfter.length, 1)
})

test('Scenario 8: Expired or missing authentication returns AUTH_REQUIRED state', async () => {
  clearTestSession() // No auth
  const mockIdb = new MockIDBFactory()

  const service = new SharedCatalogService()
  const result = await service.getCatalogSongs({ indexedDBFactory: mockIdb })

  assert.equal(result.state, 'AUTH_REQUIRED')
  assert.equal(result.songs.length, 0)
  assert.match(result.error, /Authentication required/)
})

test('Scenario 9: Stale cache labeling indicates cache is older than TTL', async () => {
  setTestSession({ id: 'acc-1', email: 'acc1@gtar.app' })
  const mockIdb = new MockIDBFactory()

  const song1 = createMockSharedSong('song-1', 'Stale Song')
  await saveSongsToCache('acc-1', [song1], { indexedDBFactory: mockIdb })

  // Backdate metadata to simulate 10 minutes ago
  const db = await mockIdb.open('gtar_shared_catalog_db')
  const metaStore = db.result.stores.get('catalog_meta')
  metaStore.put({
    accountId: 'acc-1',
    lastFetchedAt: Date.now() - 10 * 60 * 1000,
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('Offline')
  }

  try {
    const service = new SharedCatalogService()
    const result = await service.getCatalogSongs({ indexedDBFactory: mockIdb })

    assert.equal(result.state, 'OFFLINE_CACHED')
    assert.equal(result.isStale, true)
    assert.equal(result.songs.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Scenario 10: Soft-deleted song reconciliation removes server-deleted song from cache', async () => {
  setTestSession({ id: 'acc-1', email: 'acc1@gtar.app' })
  const mockIdb = new MockIDBFactory()

  const song1 = createMockSharedSong('song-1', 'Surviving Song')
  const song2 = createMockSharedSong('song-2', 'Deleted Song')
  await saveSongsToCache('acc-1', [song1, song2], { indexedDBFactory: mockIdb })

  // Server response now only contains song1 (song2 was deleted on server)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: true,
        songs: [song1],
        pagination: { limit: 20, offset: 0, total: 1, has_more: false },
      }),
    }
  }

  try {
    const service = new SharedCatalogService()
    const result = await service.getCatalogSongs({ indexedDBFactory: mockIdb })

    assert.equal(result.state, 'ONLINE')
    assert.equal(result.songs.length, 1)
    assert.equal(result.songs[0].id, 'song-1')

    // Inspect IndexedDB to ensure song2 was tombstoned/pruned
    const cached = await getCachedSongs('acc-1', { indexedDBFactory: mockIdb })
    assert.equal(cached.length, 1)
    assert.equal(cached[0].id, 'song-1')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Scenario 11: Partial pagination refresh does NOT purge unseen cached songs', async () => {
  setTestSession({ id: 'acc-1', email: 'acc1@gtar.app' })
  const mockIdb = new MockIDBFactory()

  const song1 = createMockSharedSong('song-1', 'Page 1 Song')
  const song2 = createMockSharedSong('song-2', 'Page 2 Song')
  await saveSongsToCache('acc-1', [song1, song2], { indexedDBFactory: mockIdb })

  // Request only page 2 (offset=1, limit=1) with has_more = true
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: true,
        songs: [song2],
        pagination: { limit: 1, offset: 1, total: 10, has_more: true },
      }),
    }
  }

  try {
    const service = new SharedCatalogService()
    const result = await service.getCatalogSongs({
      limit: 1,
      offset: 1,
      indexedDBFactory: mockIdb,
    })

    assert.equal(result.state, 'ONLINE')
    assert.equal(result.songs.length, 1)
    assert.equal(result.songs[0].id, 'song-2')

    // Verify Page 1 song (song1) was NOT purged from cache!
    const cached = await getCachedSongs('acc-1', { indexedDBFactory: mockIdb })
    assert.equal(cached.length, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Scenario 12: Concurrent refresh cancellation with AbortController', async () => {
  setTestSession({ id: 'acc-1', email: 'acc1@gtar.app' })
  const mockIdb = new MockIDBFactory()

  const controller = new AbortController()

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_, opts) => {
    return new Promise((_, reject) => {
      opts.signal?.addEventListener('abort', () => {
        const err = new Error('Request was cancelled')
        err.name = 'AbortError'
        reject(err)
      })
    })
  }

  try {
    const service = new SharedCatalogService()
    const promise = service.getCatalogSongs({
      signal: controller.signal,
      indexedDBFactory: mockIdb,
    })
    controller.abort()

    await assert.rejects(promise, (err) => {
      return err.code === 'ABORTED' || err.name === 'AbortError'
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Scenario 13: Duplicate or updated revision reconciliation updates cache to latest', async () => {
  setTestSession({ id: 'acc-1', email: 'acc1@gtar.app' })
  const mockIdb = new MockIDBFactory()

  const songV1 = createMockSharedSong('song-1', 'Old Title', 'Old Artist', 1)
  await saveSongsToCache('acc-1', [songV1], { indexedDBFactory: mockIdb })

  const songV2 = createMockSharedSong('song-1', 'Updated Title', 'Updated Artist', 2)

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: true,
        songs: [songV2],
        pagination: { limit: 20, offset: 0, total: 1, has_more: false },
      }),
    }
  }

  try {
    const service = new SharedCatalogService()
    await service.getCatalogSongs({ indexedDBFactory: mockIdb })

    const cached = await getCachedSongById('acc-1', 'song-1', { indexedDBFactory: mockIdb })
    assert.equal(cached.current_revision, 2)
    assert.equal(cached.title, 'Updated Title')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Scenario 14: Personal import generates an independent UUID and drops shared server authority', () => {
  const sharedSong = createMockSharedSong('server-uuid-1234', 'Stand by Me', 'Ben E. King', 5)

  const personalClone = cloneSharedCatalogSongToPersonal(sharedSong)

  // Must have a new, valid local UUID
  assert.ok(isValidUUID(personalClone.id))
  assert.notEqual(personalClone.id, sharedSong.id)

  // Must track source catalog identity additively
  assert.equal(personalClone.sharedSourceSongId, 'server-uuid-1234')
  assert.equal(personalClone.sharedSourceRevision, 5)

  // Must NOT carry shared publisher/editor/checksum authority
  assert.equal(personalClone.publisher_user_id, undefined)
  assert.equal(personalClone.last_editor_user_id, undefined)
  assert.equal(personalClone.current_revision, undefined)
})

test('Scenario 15: Imported song faithfully preserves chords, lyrics, and metadata', () => {
  const sharedSong = createMockSharedSong('song-uuid-abc', 'Hallelujah', 'Leonard Cohen', 3)
  sharedSong.raw_content = '{title: Hallelujah}\n{artist: Leonard Cohen}\n[C]Now I\'ve heard there was a [Am]secret chord'
  sharedSong.key = 'C'
  sharedSong.original_key = 'C'
  sharedSong.bpm = '80'
  sharedSong.time_signature = '6/8'
  sharedSong.year = '1984'

  const clone = cloneSharedCatalogSongToPersonal(sharedSong)

  assert.equal(clone.title, 'Hallelujah')
  assert.equal(clone.artist, 'Leonard Cohen')
  assert.equal(clone.key, 'C')
  assert.equal(clone.bpm, '80')
  assert.equal(clone.time, '6/8')
  assert.equal(clone.year, '1984')
  assert.equal(clone.rawContent, sharedSong.raw_content)
  assert.equal(clone.format, 'CHORD_PRO')
})

test('Scenario 16: Editing imported clone in personal library does NOT mutate shared catalog', () => {
  const sharedSong = createMockSharedSong('song-uuid-abc', 'Original Title', 'Original Artist', 1)
  const clone = cloneSharedCatalogSongToPersonal(sharedSong)

  // Mutate personal clone locally
  clone.title = 'My Customized Title'
  clone.rawContent = '[D]Custom chords'
  clone.transposeOffset = 2

  // Shared song remains pristine
  assert.equal(sharedSong.title, 'Original Title')
  assert.equal(sharedSong.raw_content.includes('Custom chords'), false)
  assert.equal(sharedSong.current_revision, 1)
})

test('Scenario 17: Existing personal cloud sync checksum remains deterministic with imported songs', () => {
  const sharedSong = createMockSharedSong('song-uuid-abc', 'Checksum Test Song', 'Artist', 1)
  const clone = cloneSharedCatalogSongToPersonal(sharedSong)

  const libraryA = {
    songs: [clone],
    setlists: [],
  }

  const checksum1 = computeSongbookChecksum(libraryA)
  const checksum2 = computeSongbookChecksum(libraryA)

  assert.equal(checksum1, checksum2)
  assert.match(checksum1, /^ck_[0-9a-f]{16}$/)
})

test('Scenario 18: Offline write safety - shared writes remain online-only with no automatic background execution', () => {
  // Verify that sharedCatalogImport only exports client-side cloning,
  // and no offline mutation queues or background sync mechanisms exist.
  const importModule = require('../src/utils/sharedCatalogImport.ts')
  assert.equal(typeof importModule.cloneSharedCatalogSongToPersonal, 'function')
  assert.equal(importModule.queueSharedWrite, undefined)
  assert.equal(importModule.syncOfflineWrites, undefined)
})
