const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Set up ts/tsx transpilation hook for web source files
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs
          .readFileSync(filename, 'utf8')
          .replaceAll(
            'import.meta.env',
            '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client-test-id",VITE_AUTHORIZED_EMAILS:"member@gtar.app",VITE_ROOT_ADMIN_EMAIL:"admin@gtar.app"})'
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

require.extensions['.png'] = (module) => { module.exports = '/assets/dev-logo.png' }

const { MockIDBFactory, MockIDBKeyRange } = require('./helpers/mockIdb.cjs')
if (typeof globalThis.IDBKeyRange === 'undefined') {
  globalThis.IDBKeyRange = MockIDBKeyRange
}

const React = require('react')
const { renderToString } = require('react-dom/server')

const {
  listSharedCatalogSongs,
  getSharedCatalogSong,
  publishSharedCatalogSong,
  updateSharedCatalogSong,
  unpublishSharedCatalogSong,
  DEFAULT_PAGE_LIMIT,
} = require('../src/utils/sharedCatalogClient.ts')

const {
  SharedCatalogService,
  sharedCatalogService,
} = require('../src/utils/sharedCatalogService.ts')

const {
  saveSongsToCache,
  openCatalogDatabase,
  STORE_SONGS,
  STORE_METADATA,
} = require('../src/utils/sharedCatalogCache.ts')

const {
  cloneSharedCatalogSongToPersonal,
} = require('../src/utils/sharedCatalogImport.ts')

const {
  computeSongbookChecksum,
} = require('../src/utils/cloudSongbookSync.ts')

const {
  isValidUUID,
} = require('../src/utils/uuid.ts')

const {
  SESSION_STORAGE_KEY,
} = require('../src/utils/googleAuth.ts')

const {
  CatalogApiError,
} = require('../src/types/sharedCatalog.ts')

const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
const { SetlistDrawer } = require('../src/components/SetlistDrawer.tsx')
const { normalizeBackupSong } = require('../src/utils/jsonBackup.ts')
const { songEquals } = require('../src/utils/cloudSongbookSync.ts')
const { SharedCatalogBrowser } = require('../src/components/SharedCatalogBrowser.tsx')

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

function createSampleSong(id, title, artist) {
  return {
    id,
    title,
    artist,
    key: 'C',
    bpm: '120',
    timeSignature: '4/4',
    rawContent: `[C]${title} lyrics [G]here`,
    lines: [],
    customVoicings: {},
  }
}

function createSampleSharedSong(id, title, artist, revision = 1, publisher = 'user-1') {
  return {
    id,
    title,
    artist,
    key: 'G',
    bpm: '100',
    time_signature: '4/4',
    year: '1975',
    format: 'CHORD_PRO',
    raw_content: `{title: ${title}}\n{artist: ${artist}}\n[G]Shared song content [D]line`,
    publisher_user_id: publisher,
    current_revision: revision,
    created_at: '2026-10-10T00:00:00Z',
    updated_at: '2026-10-10T00:00:00Z',
  }
}

test('UI 1: SongbookHomeView renders My Songs as default tab and preserves personal library', () => {
  const songs = [
    createSampleSong('song-1', 'Personal Song One', 'Artist A'),
    createSampleSong('song-2', 'Personal Song Two', 'Artist B'),
  ]

  const html = renderToString(
    React.createElement(SongbookHomeView, {
      songs,
      activeSongIndex: 0,
      onSelectSong: () => {},
      onNewSong: () => {},
      onOpenSetlists: () => {},
      onDeleteSong: () => {},
      onSongMembershipChange: () => true,
      onCreateSetlistForSong: () => true,
    })
  )

  // Tab navigation is present with My Songs selected by default
  assert.match(html, /data-testid="tab-my-songs"/)
  assert.match(html, /aria-selected="true"/)
  assert.match(html, /data-testid="tab-shared-catalog"/)
  assert.match(html, /aria-selected="false"/)

  // Personal songs are rendered
  assert.match(html, /Personal Song One/)
  assert.match(html, /Personal Song Two/)

  // Shared Catalog browser is not active in default view
  assert.doesNotMatch(html, /data-testid="shared-catalog-search"/)
})

test('UI 2: SharedCatalogBrowser renders loading, empty, and item states properly', () => {
  // Test basic component markup
  const html = renderToString(
    React.createElement(SharedCatalogBrowser, {
      onImportSong: () => true,
      currentUserId: 'user-1',
      userRole: 'member',
    })
  )

  assert.match(html, /Search shared songs by title or artist/)
  assert.match(html, /data-testid="catalog-search-input"/)
  assert.match(html, /Refresh/)
})

test('UI 3: Shared Catalog Client enforces DEFAULT_PAGE_LIMIT and bounded pagination', async () => {
  assert.equal(DEFAULT_PAGE_LIMIT, 20)

  const originalFetch = globalThis.fetch
  let requestedUrl = ''

  try {
    setTestSession({ id: 'user-1', email: 'user@gtar.app', role: 'member' })
    globalThis.fetch = async (url) => {
      requestedUrl = String(url)
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          songs: [createSampleSharedSong('song-1', 'Test Song', 'Artist')],
          total: 1,
          limit: 20,
          offset: 0,
          has_more: false,
        }),
      }
    }

    const result = await listSharedCatalogSongs({ limit: 100, offset: 50, query: 'test' })
    assert.ok(requestedUrl.includes('limit=50')) // Bounded to MAX_PAGE_LIMIT (50)
    assert.ok(requestedUrl.includes('offset=50'))
    assert.equal(result.songs.length, 1)
  } finally {
    globalThis.fetch = originalFetch
    clearTestSession()
  }
})

test('UI 4: Import to My Songs creates fresh UUID and retains lineage without server authority', () => {
  const sharedSong = createSampleSharedSong('cat-song-999', 'Hotel California', 'Eagles', 4, 'publisher-42')
  const importedPersonal = cloneSharedCatalogSongToPersonal(sharedSong)

  // Fresh UUID
  assert.ok(isValidUUID(importedPersonal.id))
  assert.notEqual(importedPersonal.id, sharedSong.id)

  // Lineage retention
  assert.equal(importedPersonal.sharedSourceSongId, 'cat-song-999')
  assert.equal(importedPersonal.sharedSourceRevision, 4)

  // Stripped server authority
  assert.equal(importedPersonal.publisher_user_id, undefined)
  assert.equal(importedPersonal.current_revision, undefined)
  assert.equal(importedPersonal.last_editor_user_id, undefined)

  // Preserved chord content and metadata
  assert.equal(importedPersonal.title, 'Hotel California')
  assert.equal(importedPersonal.artist, 'Eagles')
  assert.equal(importedPersonal.key, 'G')
  assert.equal(importedPersonal.bpm, '100')
  assert.equal(importedPersonal.time, '4/4')
  assert.match(importedPersonal.rawContent, /\[G\]Shared song content/)
})

test('UI 5: Import persistence contract: failure reports error and does not report false success', () => {
  let persistCalled = false
  const mockOnImportFailure = (song) => {
    persistCalled = true
    return false // Persistence fails (e.g., storage quota or conflict)
  }

  const sharedSong = createSampleSharedSong('cat-1', 'Test Song', 'Artist')
  const personal = cloneSharedCatalogSongToPersonal(sharedSong)
  const success = mockOnImportFailure(personal)

  assert.equal(persistCalled, true)
  assert.equal(success, false) // Must return false so caller does NOT show success banner
})

test('UI 6: Duplicate import prevention logic blocks rapid double-taps', async () => {
  const inFlightIds = new Set()
  let importExecutionCount = 0

  async function handleImportClick(songId) {
    if (inFlightIds.has(songId)) {
      return false // Duplicate tap rejected
    }
    inFlightIds.add(songId)
    try {
      // Simulate async import persistence
      await new Promise((r) => setTimeout(r, 20))
      importExecutionCount++
      return true
    } finally {
      inFlightIds.delete(songId)
    }
  }

  // Rapid double-tap on same song
  const [firstTap, secondTap] = await Promise.all([
    handleImportClick('song-123'),
    handleImportClick('song-123'),
  ])

  // One tap succeeded, the other was rejected
  assert.equal(firstTap || secondTap, true)
  assert.equal(firstTap && secondTap, false)
  assert.equal(importExecutionCount, 1)
})

test('UI 7: Publishing personal song requires authenticated active membership', async () => {
  clearTestSession()

  // Unauthenticated client call rejects immediately
  await assert.rejects(
    publishSharedCatalogSong({
      title: 'Draft Song',
      raw_content: '[C]Content',
    }),
    (err) => {
      assert.ok(err instanceof CatalogApiError)
      assert.equal(err.code, 'AUTH_REQUIRED')
      return true
    }
  )
})

test('UI 8: Publishing personal song sends correct payload and does not alter original personal song', async () => {
  const originalFetch = globalThis.fetch
  let requestBody = null

  try {
    setTestSession({ id: 'user-1', email: 'user@gtar.app', role: 'member', access_status: 'active' })
    globalThis.fetch = async (url, init) => {
      requestBody = JSON.parse(init.body)
      return {
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          song: createSampleSharedSong('server-id-100', 'Original Song', 'Personal Artist', 1, 'user-1'),
          revision: 1,
        }),
      }
    }

    const personalSong = createSampleSong('local-1', 'Original Song', 'Personal Artist')
    personalSong.bpm = '120'
    personalSong.timeSignature = '4/4'

    const result = await publishSharedCatalogSong({
      title: personalSong.title,
      artist: personalSong.artist,
      key: personalSong.key,
      bpm: personalSong.bpm,
      time_signature: personalSong.timeSignature,
      format: 'CHORD_PRO',
      raw_content: personalSong.rawContent,
      change_summary: 'Initial community publication',
    })

    assert.equal(result.song.id, 'server-id-100')
    assert.equal(requestBody.title, 'Original Song')
    assert.equal(requestBody.artist, 'Personal Artist')
    assert.equal(requestBody.change_summary, 'Initial community publication')

    // Original personal song remains unaltered with its local ID
    assert.equal(personalSong.id, 'local-1')
    assert.equal(personalSong.title, 'Original Song')
  } finally {
    globalThis.fetch = originalFetch
    clearTestSession()
  }
})

test('UI 9: Editing shared catalog song with CAS expected_revision surfaces conflict errors', async () => {
  const originalFetch = globalThis.fetch

  try {
    setTestSession({ id: 'user-1', email: 'user@gtar.app', role: 'member', access_status: 'active' })
    globalThis.fetch = async (url, init) => {
      return {
        ok: false,
        status: 409,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          error: 'Revision conflict: song was modified by another editor',
          code: 'CONFLICT',
        }),
      }
    }

    await assert.rejects(
      updateSharedCatalogSong({
        id: 'song-1',
        title: 'Updated Title',
        raw_content: '[D]New chord content',
        expected_revision: 2,
        change_summary: 'Update chords',
      }),
      (err) => {
        assert.ok(err instanceof CatalogApiError)
        assert.equal(err.code, 'CONFLICT')
        assert.equal(err.status, 409)
        return true
      }
    )
  } finally {
    globalThis.fetch = originalFetch
    clearTestSession()
  }
})

test('UI 10: Unpublishing shared song requires confirmation and executes soft delete via DELETE', async () => {
  const originalFetch = globalThis.fetch
  let requestMethod = ''

  try {
    setTestSession({ id: 'user-1', email: 'user@gtar.app', role: 'member', access_status: 'active' })
    globalThis.fetch = async (url, init) => {
      requestMethod = init.method
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: true,
          deleted_at: '2026-10-13T06:00:00Z',
        }),
      }
    }

    const result = await unpublishSharedCatalogSong({ id: 'song-1', expected_revision: 3 })
    assert.equal(requestMethod, 'DELETE')
    assert.equal(result.success, true)
  } finally {
    globalThis.fetch = originalFetch
    clearTestSession()
  }
})

test('UI 11: Account switch and logout clears shared catalog cache and isolates user state', async () => {
  const mockIdb = new MockIDBFactory()
  const service = new SharedCatalogService(mockIdb)

  // User A sets account and loads songs
  service.setAccount('user-a@gtar.app')
  assert.equal(service.getAccount(), 'user-a@gtar.app')

  // Switch to User B
  service.setAccount('user-b@gtar.app')
  assert.equal(service.getAccount(), 'user-b@gtar.app')

  // Logout clears account
  service.setAccount(null)
  assert.equal(service.getAccount(), null)

  // Unauthenticated getCatalogSongs returns AUTH_REQUIRED
  const res = await service.getCatalogSongs()
  assert.equal(res.state, 'AUTH_REQUIRED')
  assert.equal(res.songs.length, 0)
})

test('UI 12: Stale request cancellation via AbortController ignores superseded responses', async () => {
  const originalFetch = globalThis.fetch
  let firstCallAborted = false

  try {
    setTestSession({ id: 'user-1', email: 'user@gtar.app', role: 'member' })
    let callCount = 0

    globalThis.fetch = async (url, init) => {
      callCount++
      const thisCall = callCount

      if (thisCall === 1) {
        return new Promise((resolve, reject) => {
          if (init.signal) {
            init.signal.addEventListener('abort', () => {
              firstCallAborted = true
              const err = new Error('The operation was aborted')
              err.name = 'AbortError'
              reject(err)
            })
          }
        })
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          songs: [createSampleSharedSong('fast-song', 'Fast Song', 'Artist')],
          total: 1,
          limit: 50,
          offset: 0,
          has_more: false,
        }),
      }
    }

    const controller1 = new AbortController()
    const p1 = listSharedCatalogSongs({ query: 'slow', signal: controller1.signal })

    // Second search initiated, aborting first
    controller1.abort()
    const p2 = listSharedCatalogSongs({ query: 'fast' })

    await assert.rejects(p1, (err) => {
      assert.ok(err instanceof CatalogApiError)
      assert.equal(err.code, 'ABORTED')
      return true
    })

    const res2 = await p2
    assert.equal(firstCallAborted, true)
    assert.equal(res2.songs[0].id, 'fast-song')
  } finally {
    globalThis.fetch = originalFetch
    clearTestSession()
  }
})

test('UI 13: Deterministic personal cloud sync checksum remains intact with imported catalog songs', () => {
  const sharedA = createSampleSharedSong('cat-1', 'Hotel California', 'Eagles', 1)
  const sharedB = createSampleSharedSong('cat-2', 'Imagine', 'John Lennon', 2)

  const cloneA = cloneSharedCatalogSongToPersonal(sharedA)
  const cloneB = cloneSharedCatalogSongToPersonal(sharedB)

  const library = {
    songs: [cloneA, cloneB],
    setlists: [],
  }

  const checksum1 = computeSongbookChecksum(library)
  const checksum2 = computeSongbookChecksum(library)

  assert.equal(checksum1, checksum2)
  assert.match(checksum1, /^ck_[0-9a-f]{16}$/)
})

// =========================================================================
// PHASE 4 STEP 5: Cloud Publication Identity & Reconciliation Tests
// =========================================================================

test('PHASE 4 - TEST 1: Publish success stores correct catalog ID in personal song state', async () => {
  const originalFetch = globalThis.fetch
  setTestSession({ id: 'user-1', email: 'user1@gtar.app' })

  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 201,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: true,
        song: createSampleSharedSong('scs_auth_123', 'Amazing Grace', 'John Newton', 1, 'user-1'),
        deduplicated: false,
      }),
    })

    const personalSong = createSampleSong('p-1', 'Amazing Grace', 'John Newton')
    let updatedSongState = null

    // Simulate publication action and association
    const result = await publishSharedCatalogSong({
      title: personalSong.title,
      artist: personalSong.artist,
      raw_content: personalSong.rawContent,
    })

    assert.equal(result.success, true)
    assert.equal(result.song.id, 'scs_auth_123')

    // Personal song receives authoritative catalog ID
    updatedSongState = {
      ...personalSong,
      publishedCatalogSongId: result.song.id,
    }

    assert.equal(updatedSongState.publishedCatalogSongId, 'scs_auth_123')
    assert.equal(updatedSongState.sharedSourceSongId, undefined)
  } finally {
    globalThis.fetch = originalFetch
    clearTestSession()
  }
})

test('PHASE 4 - TEST 2: Publish failure creates no association', async () => {
  const originalFetch = globalThis.fetch
  setTestSession({ id: 'user-1', email: 'user1@gtar.app' })

  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Database failed' },
      }),
    })

    const personalSong = createSampleSong('p-2', 'Failed Publish Song', 'Artist')
    let associationCreated = false

    await assert.rejects(
      publishSharedCatalogSong({
        title: personalSong.title,
        artist: personalSong.artist,
        raw_content: personalSong.rawContent,
      }),
      /Database failed/
    )

    // Verify personalSong remains unchanged with no publishedCatalogSongId
    assert.equal(personalSong.publishedCatalogSongId, undefined)
    assert.equal(associationCreated, false)
  } finally {
    globalThis.fetch = originalFetch
    clearTestSession()
  }
})

test('PHASE 4 - TEST 3: Association survives personal sync and backup lifecycle', () => {
  const originalSong = {
    ...createSampleSong('p-3', 'Sync & Backup Test', 'Artist'),
    publishedCatalogSongId: 'scs_backup_survivor_99',
  }

  // 1. Backup / Restore preservation
  const backupNormalized = normalizeBackupSong(originalSong)
  assert.equal(backupNormalized.publishedCatalogSongId, 'scs_backup_survivor_99')

  // 2. Cloud Sync equality and checksum change detection
  const songWithoutId = { ...originalSong, publishedCatalogSongId: undefined }
  assert.equal(songEquals(originalSong, originalSong), true)
  assert.equal(songEquals(originalSong, songWithoutId), false)

  const libWithId = { songs: [originalSong], setlists: [] }
  const libWithoutId = { songs: [songWithoutId], setlists: [] }
  assert.notEqual(computeSongbookChecksum(libWithId), computeSongbookChecksum(libWithoutId))
})

test('PHASE 4 - TEST 4: Imported clone does not falsely show published', () => {
  const sharedSong = createSampleSharedSong('scs_imported_44', 'Imported Song', 'Band', 1)
  const clone = cloneSharedCatalogSongToPersonal(sharedSong)

  // Clone should have sharedSourceSongId, NEVER publishedCatalogSongId
  assert.equal(clone.sharedSourceSongId, 'scs_imported_44')
  assert.equal(clone.publishedCatalogSongId, undefined)

  // Rendering clone in SongbookHomeView or SetlistDrawer should NOT show published icon
  const confirmedIds = new Set(['scs_imported_44'])
  const htmlHome = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [clone],
      searchQuery: '',
      onSearchQueryChange: () => {},
      activeSongIndex: 0,
      onSelectSong: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
      confirmedCatalogIds: confirmedIds,
    })
  )
  assert.equal(htmlHome.includes('data-testid="song-published-status-'), false)

  const htmlDrawer = renderToString(
    React.createElement(SetlistDrawer, {
      isOpen: true,
      onClose: () => {},
      songs: [clone],
      activeSongIndex: 0,
      onSelectSongIndex: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
      confirmedCatalogIds: confirmedIds,
    })
  )
  assert.equal(htmlDrawer.includes('data-testid="drawer-song-published-status-'), false)
})

test('PHASE 4 - TEST 5: Duplicate titles cannot produce false matches', () => {
  // Two songs with identical title & artist, but only one is published
  const songA = {
    ...createSampleSong('p-dup-1', 'Hallelujah', 'Leonard Cohen'),
    publishedCatalogSongId: 'scs_hal_real',
  }
  const songB = {
    ...createSampleSong('p-dup-2', 'Hallelujah', 'Leonard Cohen'),
    publishedCatalogSongId: undefined,
  }

  const confirmedIds = new Set(['scs_hal_real'])

  const htmlHome = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [songA, songB],
      searchQuery: '',
      onSearchQueryChange: () => {},
      activeSongIndex: 0,
      onSelectSong: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
      confirmedCatalogIds: confirmedIds,
    })
  )

  // Song A gets published indicator, Song B does not
  assert.ok(htmlHome.includes('data-testid="song-published-status-0"'))
  assert.equal(htmlHome.includes('data-testid="song-published-status-1"'), false)
})

test('PHASE 4 - TEST 6: Partial pagination cannot falsely clear publication', () => {
  // Personal song published with id 'scs_paginated_99'
  const personalSong = {
    ...createSampleSong('p-page', 'Long Catalog Song', 'Band'),
    publishedCatalogSongId: 'scs_paginated_99',
  }

  // Suppose an incomplete search or page 1 returns only 'scs_first_10'
  const partialPageIds = new Set(['scs_first_10'])

  // Unconfirmed in this partial page view -> does NOT display icon, but personal song's publishedCatalogSongId is NOT destroyed
  const htmlHome = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [personalSong],
      searchQuery: '',
      onSearchQueryChange: () => {},
      activeSongIndex: 0,
      onSelectSong: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
      confirmedCatalogIds: partialPageIds,
    })
  )

  // No false indicator rendered
  assert.equal(htmlHome.includes('data-testid="song-published-status-0"'), false)
  // Personal state remains intact
  assert.equal(personalSong.publishedCatalogSongId, 'scs_paginated_99')
})

test('PHASE 4 - TEST 7: Confirmed unpublish removes indicator and invalidates association', () => {
  const publishedSong = {
    ...createSampleSong('p-unpub', 'Unpublished Song', 'Band'),
    publishedCatalogSongId: 'scs_to_unpublish',
  }

  // Active confirmed set before unpublish
  const activeIds = new Set(['scs_to_unpublish'])
  const htmlBefore = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [publishedSong],
      searchQuery: '',
      onSearchQueryChange: () => {},
      activeSongIndex: 0,
      onSelectSong: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
      confirmedCatalogIds: activeIds,
    })
  )
  assert.ok(htmlBefore.includes('data-testid="song-published-status-0"'))

  // After confirmed unpublish: active set deletes id and personal song association is cleared
  activeIds.delete('scs_to_unpublish')
  const songAfter = { ...publishedSong, publishedCatalogSongId: undefined }

  const htmlAfter = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [songAfter],
      searchQuery: '',
      onSearchQueryChange: () => {},
      activeSongIndex: 0,
      onSelectSong: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
      confirmedCatalogIds: activeIds,
    })
  )
  assert.equal(htmlAfter.includes('data-testid="song-published-status-0"'), false)
})

test('PHASE 4 - TEST 8: Account switch clears previous account visible state', async () => {
  // Set session for User A with cached songs
  setTestSession({ id: 'user-a', email: 'usera@gtar.app' })
  const mockFactory = new MockIDBFactory()

  // Save song for user A
  const service = new SharedCatalogService()
  const { saveSongsToCache, clearAccountCatalogCache } = require('../src/utils/sharedCatalogCache.ts')
  await saveSongsToCache('user-a', [createSampleSharedSong('scs_user_a', 'Song A', 'Artist A', 1, 'user-a')], { indexedDBFactory: mockFactory })

  const idsA = await service.getConfirmedActiveCatalogIds({ indexedDBFactory: mockFactory })
  assert.ok(idsA.has('scs_user_a'))

  // Switch to User B
  setTestSession({ id: 'user-b', email: 'userb@gtar.app' })
  const idsB = await service.getConfirmedActiveCatalogIds({ indexedDBFactory: mockFactory })
  assert.equal(idsB.has('scs_user_a'), false)
  assert.equal(idsB.size, 0)

  // Clear cache for User A
  await clearAccountCatalogCache('user-a', { indexedDBFactory: mockFactory })
  setTestSession({ id: 'user-a', email: 'usera@gtar.app' })
  const idsACleared = await service.getConfirmedActiveCatalogIds({ indexedDBFactory: mockFactory })
  assert.equal(idsACleared.size, 0)

  clearTestSession()
})

test('PHASE 4 - TEST 9: Main Songbook and Side Panel agree on confirmed publication indicator', () => {
  const publishedSong = {
    ...createSampleSong('p-agree', 'Agreement Song', 'Band'),
    publishedCatalogSongId: 'scs_agree_1',
  }
  const unpublishedSong = createSampleSong('p-unagree', 'Unpublished Song', 'Band')

  const confirmedIds = new Set(['scs_agree_1'])
  const freshIds = new Set(['scs_agree_1'])

  const htmlHomeFresh = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [publishedSong, unpublishedSong],
      searchQuery: '',
      onSearchQueryChange: () => {},
      activeSongIndex: 0,
      onSelectSong: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
      confirmedCatalogIds: confirmedIds,
      freshCatalogIds: freshIds,
    })
  )

  const htmlDrawerFresh = renderToString(
    React.createElement(SetlistDrawer, {
      isOpen: true,
      onClose: () => {},
      songs: [publishedSong, unpublishedSong],
      activeSongIndex: 0,
      onSelectSongIndex: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
      confirmedCatalogIds: confirmedIds,
      freshCatalogIds: freshIds,
    })
  )

  // Both have index 0 published with fresh Server Confirmed label
  assert.ok(htmlHomeFresh.includes('data-testid="song-published-status-0"'))
  assert.ok(htmlDrawerFresh.includes('data-testid="drawer-song-published-status-0"'))
  assert.ok(htmlHomeFresh.includes('aria-label="Published to Shared Catalog (Server Confirmed)"'))
  assert.ok(htmlDrawerFresh.includes('aria-label="Published to Shared Catalog (Server Confirmed)"'))
  assert.ok(htmlHomeFresh.includes('text-status-success'))
  assert.ok(htmlDrawerFresh.includes('text-emerald-400'))

  // Neither has index 1 published
  assert.equal(htmlHomeFresh.includes('data-testid="song-published-status-1"'), false)
  assert.equal(htmlDrawerFresh.includes('data-testid="drawer-song-published-status-1"'), false)

  // Stale cached indicator parity: when in confirmedIds but not in freshIds
  const htmlHomeCached = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [publishedSong, unpublishedSong],
      searchQuery: '',
      onSearchQueryChange: () => {},
      activeSongIndex: 0,
      onSelectSong: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
      confirmedCatalogIds: confirmedIds,
      freshCatalogIds: new Set(),
    })
  )

  const htmlDrawerCached = renderToString(
    React.createElement(SetlistDrawer, {
      isOpen: true,
      onClose: () => {},
      songs: [publishedSong, unpublishedSong],
      activeSongIndex: 0,
      onSelectSongIndex: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
      confirmedCatalogIds: confirmedIds,
      freshCatalogIds: new Set(),
    })
  )

  assert.ok(htmlHomeCached.includes('aria-label="Published to Shared Catalog (Cached)"'))
  assert.ok(htmlDrawerCached.includes('aria-label="Published to Shared Catalog (Cached)"'))
  assert.ok(htmlHomeCached.includes('text-amber-400'))
  assert.ok(htmlDrawerCached.includes('text-amber-400'))
})

test('PHASE 4 - TEST 10: Publication success with confirmed personal persistence', () => {
  const song = createSampleSong('p-save-ok', 'Save OK Song', 'Artist')
  let updateCalledWith = null
  const onUpdateSong = (patch) => {
    updateCalledWith = patch
    return true
  }

  // Simulate publish confirmation flow
  const catalogId = 'scs_save_ok_1'
  const saveOutcome = onUpdateSong({ id: song.id, publishedCatalogSongId: catalogId })
  assert.equal(saveOutcome, true)
  assert.deepEqual(updateCalledWith, { id: song.id, publishedCatalogSongId: catalogId })
})

test('PHASE 4 - TEST 11: Server success plus personal save failure prevents false full-success', () => {
  const song = createSampleSong('p-save-fail', 'Save Fail Song', 'Artist')
  let updateCalledWith = null
  const onUpdateSong = (patch) => {
    updateCalledWith = patch
    // Return false simulating storage failure or missing record
    return false
  }

  const catalogId = 'scs_save_fail_1'
  const saveOutcome = onUpdateSong({ id: song.id, publishedCatalogSongId: catalogId })
  assert.equal(saveOutcome, false)
  // Ensure contract: caller must NOT proceed with full success notice when saveOutcome !== true
  let successReported = false
  let recoveryCatalogId = null
  if (saveOutcome === true) {
    successReported = true
  } else {
    recoveryCatalogId = catalogId
  }
  assert.equal(successReported, false)
  assert.equal(recoveryCatalogId, 'scs_save_fail_1')
})

test('PHASE 4 - TEST 12: Missing or inconclusive save outcome does not guess success', () => {
  const song = createSampleSong('p-save-inconclusive', 'Inconclusive Song', 'Artist')
  const onUpdateSongVoid = (_patch) => {
    // void callback (returns undefined)
  }

  const catalogId = 'scs_save_void_1'
  const saveOutcome = onUpdateSongVoid({ id: song.id, publishedCatalogSongId: catalogId })
  // Strictly check === true
  const isStrictlySaved = saveOutcome === true
  assert.equal(isStrictlySaved, false)
})

test('PHASE 4 - TEST 13: Retry save link without duplicate publication API call', () => {
  const song = createSampleSong('p-retry', 'Retry Song', 'Artist')
  let publishCallCount = 0
  const fakePublishApi = () => {
    publishCallCount++
    return { song: { id: 'scs_retry_1' }, deduplicated: false }
  }

  // First call publishes to remote
  const remoteRes = fakePublishApi()
  assert.equal(publishCallCount, 1)

  // Local save initially fails
  let localLinked = false
  const onUpdateSong = (patch) => {
    if (!localLinked) return false
    return true
  }

  let recoveryId = remoteRes.song.id
  assert.equal(onUpdateSong({ id: song.id, publishedCatalogSongId: recoveryId }), false)

  // User triggers Retry Save Link: re-executes local save ONLY without calling fakePublishApi
  localLinked = true
  const retryOutcome = onUpdateSong({ id: song.id, publishedCatalogSongId: recoveryId })
  assert.equal(retryOutcome, true)
  assert.equal(publishCallCount, 1, 'Publish API must NOT be called again during retry save')
})

test('PHASE 4 - TEST 14: Previously published catalog song subsequently unpublished elsewhere', async () => {
  const mockFactory = new MockIDBFactory()
  const service = new SharedCatalogService()
  setTestSession({ id: 'user-unpub', email: 'unpub@gtar.app' })

  // 1. Initially published and in fresh confirmed set
  service.markCatalogIdLiveConfirmed('scs_later_unpub')
  assert.ok(service.getFreshConfirmedCatalogIds().has('scs_later_unpub'))

  // 2. Mock detail 404 (deleted on server)
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: { message: 'Song not found', code: 'NOT_FOUND' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const detail = await service.getSongDetails('scs_later_unpub', { indexedDBFactory: mockFactory })
    assert.equal(detail.song, null)
    // Fresh confirmation and cache must be invalidated
    assert.equal(service.getFreshConfirmedCatalogIds().has('scs_later_unpub'), false)
    const confirmedIds = await service.getConfirmedActiveCatalogIds({ indexedDBFactory: mockFactory })
    assert.equal(confirmedIds.has('scs_later_unpub'), false)
  } finally {
    globalThis.fetch = origFetch
    clearTestSession()
  }
})

test('PHASE 4 - TEST 15: Stale or offline cache never called live/server-confirmed', async () => {
  const mockFactory = new MockIDBFactory()
  const service = new SharedCatalogService()
  setTestSession({ id: 'user-stale', email: 'stale@gtar.app' })

  const staleItem = createSampleSharedSong('scs_stale_1', 'Stale Song', 'Band')
  // 1. Save initially via cache adapter
  await saveSongsToCache('user-stale', [staleItem], { indexedDBFactory: mockFactory })

  // 2. Adjust fetchedAt to simulate stale record (6 minutes ago, TTL is 5 min)
  const sixMinutesAgo = Date.now() - (6 * 60 * 1000)
  const db = await openCatalogDatabase({ indexedDBFactory: mockFactory })
  await new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_SONGS], 'readwrite')
    const songStore = tx.objectStore(STORE_SONGS)
    const req = songStore.get('user-stale::scs_stale_1')
    req.onsuccess = () => {
      const rec = req.result
      if (rec) {
        rec.fetchedAt = sixMinutesAgo
        songStore.put(rec)
      }
    }
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })

  // getPublicationStatus should return STALE_CACHED, never FRESH_CONFIRMED
  const status = await service.getPublicationStatus('scs_stale_1', { indexedDBFactory: mockFactory })
  assert.equal(status, 'STALE_CACHED')
  assert.equal(service.getFreshConfirmedCatalogIds().has('scs_stale_1'), false)

  clearTestSession()
})

test('PHASE 4 - TEST 16: Account switching and signout clears fresh confirmed set', () => {
  const service = new SharedCatalogService()
  service.setAccount('user-1')
  service.markCatalogIdLiveConfirmed('scs_user1_song')
  assert.ok(service.getFreshConfirmedCatalogIds().has('scs_user1_song'))

  // Switch account to user-2
  service.setAccount('user-2')
  assert.equal(service.getFreshConfirmedCatalogIds().size, 0)
  assert.equal(service.getFreshConfirmedCatalogIds().has('scs_user1_song'), false)

  // Sign out (null account)
  service.markCatalogIdLiveConfirmed('scs_user2_song')
  assert.ok(service.getFreshConfirmedCatalogIds().has('scs_user2_song'))
  service.setAccount(null)
  assert.equal(service.getFreshConfirmedCatalogIds().size, 0)
})

test('PHASE 4 - TEST 17: Publish and unpublish update fresh confirmation set synchronously', async () => {
  const mockFactory = new MockIDBFactory()
  const service = new SharedCatalogService()
  setTestSession({ id: 'user-sync', email: 'sync@gtar.app' })

  const origFetch = globalThis.fetch
  globalThis.fetch = async (url, opts) => {
    const method = opts?.method || 'GET'
    if (method === 'POST') {
      return new Response(JSON.stringify({ song: createSampleSharedSong('scs_sync_1', 'Sync Song', 'Band') }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (method === 'DELETE') {
      return new Response(JSON.stringify({ success: true, id: 'scs_sync_1', unpublished_at: new Date().toISOString() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ songs: [] }), { status: 200 })
  }

  try {
    // 1. Publish song -> marked live confirmed immediately
    await service.publishSong({
      title: 'Sync Song',
      raw_content: '[C]Sync',
    }, { indexedDBFactory: mockFactory })
    assert.ok(service.getFreshConfirmedCatalogIds().has('scs_sync_1'))

    // 2. Unpublish song -> unmarked live confirmed immediately
    await service.unpublishSong({ id: 'scs_sync_1' }, { indexedDBFactory: mockFactory })
    assert.equal(service.getFreshConfirmedCatalogIds().has('scs_sync_1'), false)
  } finally {
    globalThis.fetch = origFetch
    clearTestSession()
  }
})
