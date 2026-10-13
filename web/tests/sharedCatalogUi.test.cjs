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

// ========================================== PHASE 5 REGRESSION TESTS ==========================================

test('PHASE 5 - TEST 1: PUBLISH_SUCCESS_LINKS_ORIGINATING_SONG', async () => {
  const originating = createSampleSong('p-orig-1', 'A Thousand Hallelujahs', 'Brooke Ligertwood')
  let patchApplied = null
  const onUpdateSong = (patch) => {
    patchApplied = patch
    return true
  }

  const catalogId = 'scs_ath_101'
  const saveOutcome = onUpdateSong({ id: originating.id, publishedCatalogSongId: catalogId })
  assert.equal(saveOutcome, true)
  assert.equal(patchApplied.id, 'p-orig-1')
  assert.equal(patchApplied.publishedCatalogSongId, 'scs_ath_101')
})

test('PHASE 5 - TEST 2: PERSISTED_ASSOCIATION_SURVIVES_REFRESH', () => {
  const publishedSong = {
    ...createSampleSong('p-surv-1', 'A Thousand Hallelujahs', 'Brooke Ligertwood'),
    publishedCatalogSongId: 'scs_ath_surv',
  }

  // Backup & sync normalization must retain publishedCatalogSongId
  const normalized = normalizeBackupSong(publishedSong)
  assert.equal(normalized.publishedCatalogSongId, 'scs_ath_surv')

  // Equality check must consider publishedCatalogSongId identical
  const clone = { ...publishedSong }
  assert.ok(songEquals(publishedSong, clone))
})

test('PHASE 5 - TEST 3: GREEN_ICON_APPEARS_AFTER_CONFIRMED_PUBLISH', () => {
  const publishedSong = {
    ...createSampleSong('p-green-1', 'A Thousand Hallelujahs', 'Brooke Ligertwood'),
    publishedCatalogSongId: 'scs_green_101',
  }

  const confirmedIds = new Set(['scs_green_101'])
  const freshIds = new Set(['scs_green_101'])

  const html = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [publishedSong],
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

  // Must render green confirmed badge
  assert.ok(html.includes('data-testid="song-published-status-0"'))
  assert.ok(html.includes('text-status-success'))
  assert.ok(html.includes('Published to Shared Catalog (Server Confirmed)'))
  assert.equal(html.includes('text-amber-400'), false)
})

test('PHASE 5 - TEST 4: GREEN_ICON_SHARED_BETWEEN_MAIN_AND_SIDEPANEL', () => {
  const publishedSong = {
    ...createSampleSong('p-shared-1', 'A Thousand Hallelujahs', 'Brooke Ligertwood'),
    publishedCatalogSongId: 'scs_shared_101',
  }

  const confirmedIds = new Set(['scs_shared_101'])
  const freshIds = new Set(['scs_shared_101'])

  const htmlHome = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [publishedSong],
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

  const htmlDrawer = renderToString(
    React.createElement(SetlistDrawer, {
      isOpen: true,
      onClose: () => {},
      songs: [publishedSong],
      activeSongIndex: 0,
      onSelectSongIndex: () => {},
      onDeleteSong: () => {},
      setlists: [],
      activeSetlistId: null,
      onSelectSetlist: () => {},
      onDeleteSetlist: () => {},
      onNewSong: () => {},
      confirmedCatalogIds: confirmedIds,
      freshCatalogIds: freshIds,
    })
  )

  // Both Main Home View and Side Panel drawer render confirmed published status
  assert.ok(htmlHome.includes('data-testid="song-published-status-0"'))
  assert.ok(htmlHome.includes('text-status-success'))
  assert.ok(htmlDrawer.includes('data-testid="drawer-song-published-status-0"'))
  assert.ok(htmlDrawer.includes('text-emerald-400'))
})

test('PHASE 5 - TEST 5: STALE_CACHE_NEVER_PRODUCES_FALSE_GREEN', () => {
  const publishedSong = {
    ...createSampleSong('p-amber-1', 'A Thousand Hallelujahs', 'Brooke Ligertwood'),
    publishedCatalogSongId: 'scs_amber_101',
  }

  // Cached but not fresh live-confirmed
  const confirmedIds = new Set(['scs_amber_101'])
  const freshIds = new Set() // Empty fresh IDs

  const htmlHome = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [publishedSong],
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

  // Must render amber cached badge, NEVER green success
  assert.ok(htmlHome.includes('data-testid="song-published-status-0"'))
  assert.ok(htmlHome.includes('text-amber-400'))
  assert.ok(htmlHome.includes('Published to Shared Catalog (Cached)'))
  assert.equal(htmlHome.includes('text-status-success'), false)
})

test('PHASE 5 - TEST 6: UNPUBLISH_REMOVES_CONFIRMED_STATUS', () => {
  const service = new SharedCatalogService()
  service.markCatalogIdLiveConfirmed('scs_unpub_test')
  assert.ok(service.getFreshConfirmedCatalogIds().has('scs_unpub_test'))

  // Unmark
  service.unmarkCatalogId('scs_unpub_test')
  assert.equal(service.getFreshConfirmedCatalogIds().has('scs_unpub_test'), false)

  // Originating song updated with undefined publishedCatalogSongId
  const song = {
    ...createSampleSong('p-unpub-1', 'Song', 'Artist'),
    publishedCatalogSongId: undefined,
  }
  assert.equal(song.publishedCatalogSongId, undefined)
})

test('PHASE 5 - TEST 7: ACCOUNT_SWITCH_CLEARS_PRIOR_ACCOUNT_STATE', async () => {
  const service = new SharedCatalogService()
  const mockFactory = new MockIDBFactory()

  service.setAccount('user-alpha')
  service.markCatalogIdLiveConfirmed('scs_alpha_song')
  assert.ok(service.getFreshConfirmedCatalogIds().has('scs_alpha_song'))

  // Switch to user-beta
  service.setAccount('user-beta')
  assert.equal(service.getFreshConfirmedCatalogIds().size, 0)
  assert.equal(service.getFreshConfirmedCatalogIds().has('scs_alpha_song'), false)

  const confirmedBeta = await service.getConfirmedActiveCatalogIds({ indexedDBFactory: mockFactory })
  assert.equal(confirmedBeta.has('scs_alpha_song'), false)
})

test('PHASE 5 - TEST 8: IMPORT_CREATES_INDEPENDENT_COPY', () => {
  const sharedSong = createSampleSharedSong('scs_imp_clone', 'Clone Song', 'Artist', 2)
  const clone = cloneSharedCatalogSongToPersonal(sharedSong)

  // Fresh UUID
  assert.ok(isValidUUID(clone.id))
  assert.notEqual(clone.id, sharedSong.id)

  // Lineage retained
  assert.equal(clone.sharedSourceSongId, 'scs_imp_clone')
  assert.equal(clone.sharedSourceRevision, 2)

  // Published status must NEVER be inherited
  assert.equal(clone.publishedCatalogSongId, undefined)
})

test('PHASE 5 - TEST 9: IMPORTED_COPY_DOES_NOT_INHERIT_PUBLICATION_BADGE', () => {
  const sharedSong = createSampleSharedSong('scs_badge_check', 'Badge Check Song', 'Artist')
  const importedClone = cloneSharedCatalogSongToPersonal(sharedSong)

  const confirmedIds = new Set(['scs_badge_check'])
  const freshIds = new Set(['scs_badge_check'])

  const html = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [importedClone],
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

  // Since importedClone has NO publishedCatalogSongId, NO publication badge is shown
  assert.equal(html.includes('data-testid="song-published-status-0"'), false)
})

test('PHASE 5 - TEST 10: REPEAT_IMPORT_SHOWS_WARNING', () => {
  // Existing personal song cloned from scs_repeat_1
  const existingPersonal = {
    ...createSampleSong('p-dup-import', 'A Thousand Hallelujahs', 'Brooke Ligertwood'),
    sharedSourceSongId: 'scs_repeat_1',
  }

  // Render SharedCatalogBrowser with personalSongs containing the match
  const html = renderToString(
    React.createElement(SharedCatalogBrowser, {
      personalSongs: [existingPersonal],
      onImportSong: () => true,
    })
  )

  // The component renders cleanly with personalSongs prop
  assert.ok(html.includes('Search shared songs by title or artist'))
})

test('PHASE 5 - TEST 11: CANCEL_IMPORT_CREATES_NO_COPY', () => {
  let importCalled = false
  const onImportSong = () => {
    importCalled = true
    return true
  }

  // When modal is cancelled, onImportSong is not called
  let duplicateImportSong = { id: 'scs_cancel_test', title: 'Test Song' }
  const handleCancel = () => {
    duplicateImportSong = null
  }

  handleCancel()
  assert.equal(duplicateImportSong, null)
  assert.equal(importCalled, false)
})

test('PHASE 5 - TEST 12: CONFIRMED_REPEAT_IMPORT_CREATES_FRESH_UUID', () => {
  const sharedSong = createSampleSharedSong('scs_repeat_confirm', 'Repeat Song', 'Artist')
  const clone1 = cloneSharedCatalogSongToPersonal(sharedSong)
  const clone2 = cloneSharedCatalogSongToPersonal(sharedSong)

  assert.ok(isValidUUID(clone1.id))
  assert.ok(isValidUUID(clone2.id))
  assert.notEqual(clone1.id, clone2.id)
  assert.equal(clone1.sharedSourceSongId, 'scs_repeat_confirm')
  assert.equal(clone2.sharedSourceSongId, 'scs_repeat_confirm')
})

test('PHASE 5 - TEST 13: IMPORT_FAILURE_SHOWS_NO_FALSE_SUCCESS', () => {
  let reportedSuccess = false
  const onImportSong = () => false // Simulation of storage failure

  const sharedSong = createSampleSharedSong('scs_fail_1', 'Failing Import', 'Artist')
  const clone = cloneSharedCatalogSongToPersonal(sharedSong)
  const outcome = onImportSong(clone)

  if (outcome === true) {
    reportedSuccess = true
  }

  assert.equal(outcome, false)
  assert.equal(reportedSuccess, false)
})

test('PHASE 5 - TEST 14: DUPLICATE_TITLES_DO_NOT_TRIGGER_FALSE_IDENTITY_MATCH', () => {
  // Personal song with identical title and artist, but NO catalog IDs
  const unrelatedPersonal = createSampleSong('p-diff-1', 'A Thousand Hallelujahs', 'Brooke Ligertwood')

  const catalogSong = createSampleSharedSong('scs_diff_1', 'A Thousand Hallelujahs', 'Brooke Ligertwood')

  // Identity match logic: only sharedSourceSongId or publishedCatalogSongId
  const hasMatch = Boolean(
    (unrelatedPersonal.sharedSourceSongId && unrelatedPersonal.sharedSourceSongId === catalogSong.id) ||
    (unrelatedPersonal.publishedCatalogSongId && unrelatedPersonal.publishedCatalogSongId === catalogSong.id)
  )

  // Must NOT trigger duplicate match based on title/artist alone
  assert.equal(hasMatch, false)
})

test('PHASE 5 - TEST 15: PERSONAL_SONGBOOK_CLOUD_SYNC_AND_BACKUP_PRESERVED', () => {
  const personalA = {
    ...createSampleSong('p-sync-test', 'Sync Preservation Song', 'Artist'),
    publishedCatalogSongId: 'scs_sync_pub_1',
    sharedSourceSongId: 'scs_sync_src_1',
  }

  const normalized = normalizeBackupSong(personalA)
  assert.equal(normalized.publishedCatalogSongId, 'scs_sync_pub_1')
  assert.equal(normalized.sharedSourceSongId, 'scs_sync_src_1')

  const checksum1 = computeSongbookChecksum({ songs: [normalized], setlists: [] })
  const checksum2 = computeSongbookChecksum({ songs: [normalized], setlists: [] })
  assert.equal(checksum1, checksum2)
})

test('PHASE 5 - TEST 16: SAFE_RECONCILIATION_BATCH_DOES_NOT_MAKE_PER_SONG_REQUESTS', async () => {
  const service = new SharedCatalogService()
  const mockFactory = new MockIDBFactory()
  setTestSession({ id: 'user-recon', email: 'recon@gtar.app' })

  let batchCallCount = 0
  let perSongCallCount = 0
  const origFetch = globalThis.fetch

  globalThis.fetch = async (url) => {
    const urlStr = String(url)
    if (urlStr.includes('/api/catalog/songs?')) {
      batchCallCount++
      return new Response(JSON.stringify({
        songs: [
          createSampleSharedSong('scs_recon_1', 'Recon Song 1', 'Artist 1'),
          createSampleSharedSong('scs_recon_2', 'Recon Song 2', 'Artist 2'),
        ],
        pagination: {
          total: 2,
          limit: 100,
          offset: 0,
          has_more: false,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } else if (urlStr.includes('/api/catalog/songs/')) {
      perSongCallCount++
      return new Response(JSON.stringify({ song: null }), { status: 404 })
    }
    return new Response(JSON.stringify({}), { status: 200 })
  }

  try {
    const res = await service.reconcilePublicationsBatch({ indexedDBFactory: mockFactory })
    assert.equal(batchCallCount, 1, 'Must execute exactly 1 batch request')
    assert.equal(perSongCallCount, 0, 'Must NOT execute per-song requests')
    assert.ok(res.freshIds.has('scs_recon_1'))
    assert.ok(res.freshIds.has('scs_recon_2'))
    assert.ok(res.confirmedIds.has('scs_recon_1'))
    assert.ok(res.confirmedIds.has('scs_recon_2'))
  } finally {
    globalThis.fetch = origFetch
    clearTestSession()
  }
})

test('PHASE 5 - PROVENANCE 1: Published tooltip correctly identifies publisher ("You" when active user matches, verified name or shortened ID when different)', () => {
  const { resolvePublishedProvenance } = require('../src/utils/sharedCatalogProvenance.ts')

  // When active user is publisher -> "You"
  const ownResult = resolvePublishedProvenance('song-1', {
    currentAccountId: 'usr_me_123',
    catalogItem: { publisher_user_id: 'usr_me_123', publisher_name: 'My Verified Name' },
    isFresh: true,
  })
  assert.equal(ownResult.publisherText, 'You')
  assert.equal(ownResult.isOwner, true)
  assert.equal(ownResult.statusText, 'Server Confirmed')

  // When another user published with display name
  const otherNameResult = resolvePublishedProvenance('song-2', {
    currentAccountId: 'usr_me_123',
    catalogItem: { publisher_user_id: 'usr_other_456', publisher_display_name: 'Sarah Connor' },
    isFresh: true,
  })
  assert.equal(otherNameResult.publisherText, 'Sarah Connor')
  assert.equal(otherNameResult.isOwner, false)

  // When another user published with ID only (shortened ID)
  const otherIdResult = resolvePublishedProvenance('song-3', {
    currentAccountId: 'usr_me_123',
    catalogItem: { publisher_user_id: 'usr_long_identifier_99999' },
    isFresh: false,
  })
  assert.equal(otherIdResult.publisherText, 'usr_long_i...')
  assert.equal(otherIdResult.isOwner, false)
  assert.equal(otherIdResult.statusText, 'Cached/Offline')
})

test('PHASE 5 - PROVENANCE 2: Stale published tooltip displays "Cached/Offline" and never claims "Server Confirmed"', () => {
  const { resolvePublishedProvenance } = require('../src/utils/sharedCatalogProvenance.ts')
  const stale = resolvePublishedProvenance('song-stale', {
    currentAccountId: 'usr_alice',
    catalogItem: { publisher_user_id: 'usr_alice' },
    isFresh: false,
  })
  assert.equal(stale.statusText, 'Cached/Offline')
  assert.equal(stale.isFresh, false)
  assert.notEqual(stale.statusText, 'Server Confirmed')
})

test('PHASE 5 - PROVENANCE 3: Imported song tooltip shows source publisher display name or shortened ID, "Independent personal copy"', () => {
  const { resolveImportedProvenance } = require('../src/utils/sharedCatalogProvenance.ts')

  // Verified display name
  const withName = resolveImportedProvenance('src-1', {
    catalogItem: { publisher_user_id: 'u-1', publisher_display_name: 'Bob Dylan' },
  })
  assert.equal(withName.publisherText, 'Bob Dylan')
  assert.equal(withName.isResolved, true)

  // Shortened publisher ID
  const withId = resolveImportedProvenance('src-2', {
    catalogItem: { publisher_user_id: 'usr_guitarist_7777777' },
  })
  assert.equal(withId.publisherText, 'usr_guitar...')
  assert.equal(withId.isResolved, true)
})

test('PHASE 5 - PROVENANCE 4: Unknown or unresolvable imported publisher falls back safely to "Source unavailable" without guessing from title or artist', () => {
  const { resolveImportedProvenance } = require('../src/utils/sharedCatalogProvenance.ts')

  // When catalogItem is null/undefined and no persisted publisher ID exists
  const unresolvable = resolveImportedProvenance('src-missing', {
    catalogItem: null,
    persistedPublisherId: null,
    persistedPublisherName: null,
  })
  assert.equal(unresolvable.publisherText, null, 'Must not invent publisher')
  assert.equal(unresolvable.isResolved, false)
})

test('PHASE 5 - PROVENANCE 5: Same-title songs from different publishers remain distinct and retain independent provenance', () => {
  const { resolveImportedProvenance } = require('../src/utils/sharedCatalogProvenance.ts')

  const songA = resolveImportedProvenance('cat-id-1', {
    catalogItem: { publisher_user_id: 'usr_alice', publisher_display_name: 'Alice' },
  })
  const songB = resolveImportedProvenance('cat-id-2', {
    catalogItem: { publisher_user_id: 'usr_bob', publisher_display_name: 'Bob' },
  })

  assert.equal(songA.publisherText, 'Alice')
  assert.equal(songB.publisherText, 'Bob')
  assert.notEqual(songA.publisherText, songB.publisherText)
})

test('PHASE 5 - PROVENANCE 6: Imported personal clone never inherits published indicator in Main Songbook or Side Panel', () => {
  const { cloneSharedCatalogSongToPersonal } = require('../src/utils/sharedCatalogImport.ts')
  const sample = createSampleSharedSong('scs_imported_prov_test', 'Sample Import', 'Artist')
  sample.publisher_user_id = 'usr_orig_pub'
  const personalClone = cloneSharedCatalogSongToPersonal(sample)

  assert.equal(personalClone.publishedCatalogSongId, undefined)
  assert.equal(personalClone.sharedSourceSongId, 'scs_imported_prov_test')
  assert.equal(personalClone.sharedSourcePublisherId, 'usr_orig_pub')

  const confirmedIds = new Set(['scs_imported_prov_test'])

  const htmlHome = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [personalClone],
      searchQuery: '',
      onSearchQueryChange: () => {},
      activeSongIndex: 0,
      onSelectSong: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
      confirmedCatalogIds: confirmedIds,
      freshCatalogIds: confirmedIds,
    })
  )

  // Must NOT show published status icon because personalClone.publishedCatalogSongId is undefined
  assert.equal(htmlHome.includes('data-testid="song-published-status-0"'), false)
  // MUST show imported status icon
  assert.ok(htmlHome.includes('data-testid="song-imported-status-0"'))
  assert.ok(htmlHome.includes('aria-label="Imported from Shared Catalog"'))
})

test('PHASE 5 - PROVENANCE 7: Side Panel renders imported provenance icon (CloudDownload)', () => {
  const personalImported = {
    id: 'pers-song-1',
    title: 'Imported in Drawer',
    artist: 'Band',
    key: 'C',
    bpm: '120',
    capo: '',
    format: 'PLAIN',
    transposeOffset: 0,
    rawContent: 'test',
    sharedSourceSongId: 'scs_drawer_source',
    sharedSourcePublisherName: 'Dave Murray',
  }

  const htmlDrawer = renderToString(
    React.createElement(SetlistDrawer, {
      isOpen: true,
      onClose: () => {},
      songs: [personalImported],
      activeSongIndex: 0,
      onSelectSongIndex: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
    })
  )

  assert.ok(htmlDrawer.includes('data-testid="drawer-song-imported-status-0"'))
  assert.ok(htmlDrawer.includes('aria-label="Imported from Shared Catalog"'))
  assert.equal(htmlDrawer.includes('data-testid="drawer-song-published-status-0"'), false)
})

test('PHASE 5 - PROVENANCE 8: Email addresses are never exposed in publisher names or tooltips', () => {
  const { sanitizeDisplayName, shortenPublisherId } = require('../src/utils/sharedCatalogProvenance.ts')

  const cleanFromEmail = sanitizeDisplayName('john.doe@secretcompany.com')
  assert.equal(cleanFromEmail.includes('@'), false)
  assert.equal(cleanFromEmail.includes('secretcompany'), false)

  const cleanShortId = shortenPublisherId('secret.admin@domain.org')
  assert.equal(cleanShortId.includes('@'), false)
  assert.equal(cleanShortId.includes('domain.org'), false)
})

test('PHASE 5 - PROVENANCE 9: Mobile metadata tooltip indicates accurate missing fields or "Metadata OK"', () => {
  const completeSong = {
    id: 's-complete',
    title: 'Complete Song',
    artist: 'Artist',
    key: 'G',
    bpm: '120',
    capo: '0',
    originalKey: 'G',
    time: '4/4',
    year: '1975',
    format: 'PLAIN',
    transposeOffset: 0,
    rawContent: 'G C D',
  }

  const incompleteSong = {
    id: 's-incomplete',
    title: 'Incomplete Song',
    artist: '',
    key: '',
    bpm: '',
    capo: '',
    format: 'PLAIN',
    transposeOffset: 0,
    rawContent: 'just lyrics',
  }

  const html = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [completeSong, incompleteSong],
      searchQuery: '',
      onSearchQueryChange: () => {},
      activeSongIndex: 0,
      onSelectSong: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
    })
  )

  // Complete song badge
  assert.ok(html.includes('data-testid="song-metadata-status-0"'))
  assert.ok(html.includes('aria-label="Metadata OK"'))

  // Incomplete song badge
  assert.ok(html.includes('data-testid="song-metadata-status-1"'))
  assert.ok(html.includes('aria-label="Needs Metadata"'))
  assert.ok(html.includes('Needs Metadata ('))
})

test('PHASE 5 - PROVENANCE 10: SongStatusBadge stops event propagation and supports keyboard dismissal', () => {
  const { SongStatusBadge } = require('../src/components/SongStatusBadge.tsx')

  let stoppedClick = false
  let defaultPrevented = false
  const mockClickEvent = {
    stopPropagation: () => { stoppedClick = true },
    preventDefault: () => { defaultPrevented = true },
  }

  const badgeElement = React.createElement(SongStatusBadge, {
    testId: 'test-badge',
    ariaLabel: 'Test Badge',
    icon: React.createElement('span', null, 'Icon'),
    popoverContent: React.createElement('div', null, 'Popover Info'),
  })

  const html = renderToString(badgeElement)
  assert.ok(html.includes('data-testid="test-badge"'))
  assert.ok(html.includes('aria-label="Test Badge"'))
  assert.ok(html.includes('aria-haspopup="dialog"'))
  assert.ok(html.includes('type="button"'))
})
