const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
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
require.extensions['.png'] = (module) => {
  module.exports = '/logo.png'
}

const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/' })
Object.assign(global, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  Event: dom.window.Event,
  CustomEvent: dom.window.CustomEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: (fn) => fn(),
})
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
const { createBackupPayload } = require('../src/utils/jsonBackup.ts')
const { SESSION_STORAGE_KEY } = require('../src/utils/googleAuth.ts')

const webDir = path.resolve(__dirname, '..')

function makeApprovedSession() {
  return {
    version: 1,
    user: {
      id: 'user-pub-1',
      sub: 'sub-pub-1',
      email: 'publisher@gtar.test',
      name: 'Publisher User',
      role: 'member',
      access_status: 'active',
    },
    authenticatedAt: Date.now() - 1000,
    lastVerifiedAt: Date.now() - 1000,
    localExpiresAt: Date.now() + 3600_000,
    expiresAt: Date.now() + 3600_000,
    sessionToken: 'valid-token-123',
    role: 'member',
    access_status: 'active',
  }
}

async function selectValue(selectEl, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(
      selectEl,
      value
    )
    selectEl.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
}

const sampleSongs = [
  {
    id: 'song-1',
    title: 'Alpha Tune',
    artist: 'Band One',
    key: 'C',
    bpm: '120',
    rawContent: '[C] Alpha lyrics',
    tags: 'Rock',
    format: 'CHORD_PRO',
  },
  {
    id: 'song-2',
    title: 'Beta Groove',
    artist: 'Band Two',
    key: 'G',
    bpm: '100',
    rawContent: '[G] Beta lyrics',
    tags: 'Pop',
    format: 'CHORD_PRO',
  },
  {
    id: 'song-3',
    title: 'Charlie Ballad',
    artist: 'Band One',
    key: 'Am',
    bpm: '85',
    rawContent: '[Am] Charlie lyrics',
    tags: 'Acoustic',
    format: 'CHORD_PRO',
  },
]

test('G7.1: Songbook Manage mode — Select All on filtered results, Select None, selection stability across sort/filter, and Add to Setlist + Delete confirmation', async () => {
  localStorage.clear()
  const setlists = [
    {
      id: 'sl-1',
      name: 'Friday Night',
      songs: [{ id: 'song-1', title: 'Alpha Tune', artist: 'Band One' }],
    },
  ]
  let bulkAdded = null
  let bulkDeleted = null
  const root = createRoot(document.getElementById('root'))

  const baseProps = {
    songs: sampleSongs,
    setlists,
    searchQuery: '',
    activeSongIndex: 0,
    onSelectSong() {},
    onNewSong() {},
    onOpenSetlists() {},
    onDeleteSong() {},
    onSongMembershipChange() {},
    onCreateSetlistForSong() {},
    onBulkAddSongsToSetlist: (ids, destId) => {
      bulkAdded = { ids, destId }
    },
    onBulkDeleteSongs: (ids) => {
      bulkDeleted = ids
    },
  }

  try {
    // Render filtered via searchQuery 'Band One' (matches song-1 and song-3, hides song-2)
    await act(async () =>
      root.render(React.createElement(SongbookHomeView, { ...baseProps, searchQuery: 'Band One' }))
    )

    // Enter Songbook Manage mode
    const manageBtn = document.querySelector('[data-testid="toggle-song-selection-mode"]')
    assert.ok(manageBtn)
    assert.equal(manageBtn.textContent.trim(), 'Select', '#319: GTAR1 filter-bar Select toggle')
    await act(async () => manageBtn.click())

    // Select All targets only currently filtered/visible songs (song-1 and song-3, NOT hidden song-2)
    const selectAllBtn = document.querySelector('[data-testid="select-all-songs"]')
    const selectNoneBtn = document.querySelector('[data-testid="select-none-songs"]')
    assert.ok(selectAllBtn)
    assert.ok(selectNoneBtn)
    assert.equal(selectNoneBtn.disabled, true)

    await act(async () => selectAllBtn.click())
    assert.equal(
      document.querySelector('[data-testid="song-selection-count"]').textContent.trim(),
      '2 selected'
    )
    assert.equal(selectNoneBtn.disabled, false)

    // Clear search filter and change sort order -> selection state (song-1, song-3) remains stable!
    await act(async () =>
      root.render(React.createElement(SongbookHomeView, { ...baseProps, searchQuery: '' }))
    )
    assert.equal(
      document.querySelector('[data-testid="song-selection-count"]').textContent.trim(),
      '2 selected'
    )

    await act(async () => document.querySelector('[data-testid="sort-artist"]').click())
    assert.equal(
      document.querySelector('[data-testid="song-selection-count"]').textContent.trim(),
      '2 selected'
    )

    // Select None clears current selection
    await act(async () =>
      document.querySelector('[data-testid="select-none-songs"]').click()
    )
    assert.equal(
      document.querySelector('[data-testid="song-selection-count"]').textContent.trim(),
      '0 selected'
    )

    // Select song-1 manually, verify Add to Setlist works
    await act(async () => document.querySelector('[data-testid="song-card-0"]').click())
    assert.equal(
      document.querySelector('[data-testid="song-selection-count"]').textContent.trim(),
      '1 selected'
    )
    await act(async () =>
      document.querySelector('[data-testid="bulk-add-to-setlist"]').click()
    )
    const addDestBtn = document.querySelector('[data-testid="bulk-add-target-sl-1"]')
    assert.ok(addDestBtn)
    await act(async () => addDestBtn.click())
    assert.deepEqual(bulkAdded, { ids: ['song-1'], destId: 'sl-1' })

    // Re-enter Manage mode and verify Delete with confirmation
    await act(async () =>
      document.querySelector('[data-testid="toggle-song-selection-mode"]').click()
    )
    await act(async () => document.querySelector('[data-testid="song-card-1"]').click())
    await act(async () => document.querySelector('[data-testid="bulk-delete-songs"]').click())
    const confirmDialog = document.querySelector('[data-testid="bulk-delete-songs-confirm-dialog"]')
    assert.ok(confirmDialog)
    await act(async () =>
      document.querySelector('[data-testid="confirm-bulk-delete-songs"]').click()
    )
    assert.deepEqual(bulkDeleted, ['song-2'])
  } finally {
    await act(async () => root.unmount())
  }
})

test('G7.2: Songbook Publish to Shared — authorization guard, success, partial failure, total failure, and duplicate prevention', async () => {
  localStorage.clear()
  const origFetch = global.fetch
  const root = createRoot(document.getElementById('root'))

  let updatedSongs = sampleSongs.map((s) => ({ ...s }))
  const updateCalls = []

  const renderView = async (songsOverride = updatedSongs) => {
    await act(async () =>
      root.render(
        React.createElement(SongbookHomeView, {
          songs: songsOverride,
          setlists: [],
          searchQuery: '',
          activeSongIndex: 0,
          onSelectSong() {},
          onNewSong() {},
          onOpenSetlists() {},
          onDeleteSong() {},
          onSongMembershipChange() {},
          onCreateSetlistForSong() {},
          onUpdateSong: (partial) => {
            updateCalls.push(partial)
            updatedSongs = updatedSongs.map((s) =>
              String(s.id) === String(partial.id) ? { ...s, ...partial } : s
            )
            return true
          },
        })
      )
    )
  }

  try {
    // 1. Unauthorized user cannot bypass permissions
    let fetchCount = 0
    global.fetch = async () => {
      fetchCount++
      throw new Error('Should not call fetch when unauthorized')
    }

    await renderView()
    await act(async () =>
      document.querySelector('[data-testid="toggle-song-selection-mode"]').click()
    )
    await act(async () => document.querySelector('[data-testid="song-card-0"]').click())

    const publishBtn = document.querySelector('[data-testid="bulk-publish-to-shared"]')
    assert.equal(publishBtn, null)

    assert.equal(fetchCount, 0)
    const errBanner = document.querySelector('[data-testid="songbook-publish-error"]')
    assert.equal(errBanner, null)

    assert.equal(document.querySelector('[data-testid="songbook-publish-toast"]'), null)
    // Selection preserved after unauthorized attempt
    assert.equal(
      document.querySelector('[data-testid="song-selection-count"]').textContent.trim(),
      '1 selected'
    )

    // 2. Authorized user: Partial success & failure (song-1 succeeds, song-2 fails 500)
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(makeApprovedSession()))
    await act(async () => root.render(null))

    const publishRequests = []
    global.fetch = async (url, init) => {
      const u = String(url)
      if (u.includes('/api/catalog/songs') && (!init || init.method === 'GET' || !init.method)) {
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          json: async () => ({ ok: true, songs: [], total: 0 }),
        }
      }
      if (u.includes('/api/catalog/songs') && init?.method === 'POST') {
        const body = JSON.parse(init.body)
        publishRequests.push(body.title)
        if (body.title === 'Beta Groove') {
          return {
            ok: false,
            status: 500,
            headers: new Map([['content-type', 'application/json']]),
            json: async () => ({ error: 'Server error on Beta Groove' }),
          }
        }
        const slug = body.title === 'Alpha Tune' ? 'song-1' : 'song-3'
        return {
          ok: true,
          status: 201,
          headers: new Map([['content-type', 'application/json']]),
          json: async () => ({
            ok: true,
            song: {
              id: `cat-${slug}`,
              title: body.title,
              artist: body.artist,
              raw_content: body.raw_content,
            },
          }),
        }
      }
      return { ok: true, status: 200, headers: new Map(), json: async () => ({}) }
    }

    await renderView(updatedSongs)
    await act(async () =>
      document.querySelector('[data-testid="toggle-song-selection-mode"]').click()
    )
    // Select song-1 (Alpha Tune) and song-2 (Beta Groove)
    await act(async () => document.querySelector('[data-testid="song-card-0"]').click())
    await act(async () => document.querySelector('[data-testid="song-card-1"]').click())
    assert.equal(
      document.querySelector('[data-testid="song-selection-count"]').textContent.trim(),
      '2 selected'
    )

    await act(async () =>
      document.querySelector('[data-testid="bulk-publish-to-shared"]').click()
    )

    // Partial failure must NOT show false success toast; must show partial error and keep only failed song-2 selected
    assert.equal(document.querySelector('[data-testid="songbook-publish-toast"]'), null)
    const partialBanner = document.querySelector('[data-testid="songbook-publish-error"]')
    assert.ok(partialBanner)
    assert.match(partialBanner.textContent, /Partial publish: 1 published, 1 failed/)
    assert.equal(
      document.querySelector('[data-testid="song-selection-count"]').textContent.trim(),
      '1 selected'
    )
    assert.equal(updatedSongs[0].publishedCatalogSongId, 'cat-song-1')
    assert.equal(updatedSongs[1].publishedCatalogSongId, undefined)

    // 3. Duplicate prevention + full success: re-render with updatedSongs, select song-1 (already published) and song-3 (Charlie Ballad), deselect song-2
    await renderView(updatedSongs)
    await act(async () => document.querySelector('[data-testid="song-card-0"]').click())
    await act(async () => document.querySelector('[data-testid="song-card-1"]').click())
    await act(async () => document.querySelector('[data-testid="song-card-2"]').click())

    publishRequests.length = 0
    await act(async () =>
      document.querySelector('[data-testid="bulk-publish-to-shared"]').click()
    )

    // song-1 was skipped as already published; only Charlie Ballad was sent to POST /api/catalog/songs
    assert.deepEqual(publishRequests, ['Charlie Ballad'])
    const toast = document.querySelector('[data-testid="songbook-publish-toast"]')
    assert.ok(toast)
    assert.match(toast.textContent, /Published 1 song to Shared Catalog \(1 already published skipped\)/)
    assert.equal(updatedSongs[2].publishedCatalogSongId, 'cat-song-3')
  } finally {
    global.fetch = origFetch
    localStorage.clear()
    await act(async () => root.unmount())
  }
})

