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
    assert.equal(manageBtn.textContent.trim(), 'Manage')
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

    const songSortSelect = document.querySelector('#songbook-sort-filter-options select')
    await selectValue(songSortSelect, 'key')
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
    assert.ok(publishBtn)
    assert.equal(publishBtn.getAttribute('aria-disabled'), 'true')
    await act(async () => publishBtn.click())

    assert.equal(fetchCount, 0)
    const errBanner = document.querySelector('[data-testid="songbook-publish-error"]')
    assert.ok(errBanner)
    assert.match(errBanner.textContent, /Authentication required/)
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

test('G7.3: Songbook Options toggle uses Hide and Show labels and preserves collapse/expand state', async () => {
  localStorage.clear()
  const root = createRoot(document.getElementById('root'))

  try {
    await act(async () =>
      root.render(
        React.createElement(SongbookHomeView, {
          songs: sampleSongs,
          setlists: [],
          searchQuery: '',
          activeSongIndex: 0,
          onSelectSong() {},
          onNewSong() {},
          onOpenSetlists() {},
          onDeleteSong() {},
          onSongMembershipChange() {},
          onCreateSetlistForSong() {},
        })
      )
    )

    const toggleBtn = document.querySelector('[data-testid="toggle-sort-filter-options"]')
    const optionsPanel = document.getElementById('songbook-sort-filter-options')
    assert.ok(toggleBtn)
    assert.equal(toggleBtn.textContent.trim(), 'Hide')
    assert.equal(toggleBtn.getAttribute('aria-expanded'), 'true')
    assert.equal(optionsPanel.hidden, false)

    await act(async () => toggleBtn.click())
    assert.equal(toggleBtn.textContent.trim(), 'Show')
    assert.equal(toggleBtn.getAttribute('aria-expanded'), 'false')
    assert.equal(optionsPanel.hidden, true)
    assert.equal(localStorage.getItem('gtar_songbook_options_collapsed'), 'true')

    await act(async () => toggleBtn.click())
    assert.equal(toggleBtn.textContent.trim(), 'Hide')
    assert.equal(toggleBtn.getAttribute('aria-expanded'), 'true')
    assert.equal(optionsPanel.hidden, false)
  } finally {
    await act(async () => root.unmount())
  }
})

test('G7.4: Setlist heading rename, toolbar action order (New Setlist | Manage | QR | Import | Hide), Setlist Manage mode, and display-only sorting', async () => {
  localStorage.clear()
  const ref1 = { id: 'song-1', title: 'Alpha Tune', artist: 'Band One' }
  const ref2 = { id: 'song-2', title: 'Beta Groove', artist: 'Band Two' }
  const setlistsNoTimestamps = [
    { id: 'sl-z', name: 'Zeta Set 2025-01-01', songs: [ref1] },
    { id: 'sl-a', name: 'Alpha Set 2026-12-31', songs: [ref2] },
    { id: 'sl-m', name: 'Mid Set', songs: [ref1, ref2] },
  ]
  const snapshotBefore = JSON.stringify(setlistsNoTimestamps)
  let sharedSetlist = null
  let newSetlistClicked = 0

  const root = createRoot(document.getElementById('root'))
  const baseProps = {
    songs: sampleSongs,
    setlists: setlistsNoTimestamps,
    searchQuery: '',
    activeSongIndex: 0,
    onSelectSong() {},
    onNewSong() {},
    onOpenSetlists() {},
    onNewSetlist: () => {
      newSetlistClicked++
    },
    onShareSetlist: (sl) => {
      sharedSetlist = sl
    },
    onDeleteSong() {},
    onSongMembershipChange() {},
    onCreateSetlistForSong() {},
  }

  try {
    await act(async () => root.render(React.createElement(SongbookHomeView, baseProps)))

    // 1. Heading is "Song Setlists"
    assert.match(document.body.textContent, /Song Setlists \(3\)/)
    assert.doesNotMatch(document.body.textContent, /Gig Setlists/)

    // 2. Setlist toolbar action order (#149 owner layout): QR | Manage | ⋯ (New Setlist, Import) | Hide
    const toolbar = document.querySelector('[data-testid="setlist-toolbar"]')
    assert.ok(toolbar)
    const buttons = Array.from(toolbar.querySelectorAll('button'))
    assert.equal(buttons.length, 4)
    assert.equal(buttons[0].getAttribute('data-testid'), 'main-share-setlist-btn')
    assert.equal(buttons[0].getAttribute('aria-label'), 'Share Setlist')
    assert.equal(buttons[1].getAttribute('data-testid'), 'toggle-setlist-selection-mode')
    assert.equal(buttons[1].textContent.trim(), 'Manage')
    assert.equal(buttons[2].getAttribute('data-testid'), 'setlists-menu-btn')
    assert.equal(buttons[3].getAttribute('data-testid'), 'toggle-setlists-collapse')
    assert.equal(buttons[3].textContent.trim(), 'Hide')

    // Mobile responsive layout classes present on toolbar & buttons
    assert.match(toolbar.className, /flex-wrap/)
    assert.match(toolbar.className, /max-w-full/)
    for (const btn of buttons) {
      assert.match(btn.className, /shrink-0/)
    }

    // 3. Without reliable createdAt metadata, Newest First / Oldest First are omitted (no date inference from names)
    const sortSelect = document.querySelector('[data-testid="setlist-sort-select"]')
    assert.ok(sortSelect)
    const optionValuesNoTs = Array.from(sortSelect.querySelectorAll('option')).map((o) => o.value)
    assert.deepEqual(optionValuesNoTs, ['manual', 'title_asc', 'title_desc'])

    const getRenderedSetlistIds = () =>
      Array.from(document.querySelectorAll('[data-testid^="setlist-card-"]')).map((el) =>
        el.getAttribute('data-testid').replace('setlist-card-', '')
      )

    // Default Manual Order
    assert.deepEqual(getRenderedSetlistIds(), ['sl-z', 'sl-a', 'sl-m'])

    // Sort Title A-Z
    await selectValue(sortSelect, 'title_asc')
    assert.deepEqual(getRenderedSetlistIds(), ['sl-a', 'sl-m', 'sl-z'])

    // Sort Title Z-A
    await selectValue(sortSelect, 'title_desc')
    assert.deepEqual(getRenderedSetlistIds(), ['sl-z', 'sl-m', 'sl-a'])

    // Reset to Manual Order -> restores exact manual order, never mutates input array or backup payload
    await selectValue(sortSelect, 'manual')
    assert.deepEqual(getRenderedSetlistIds(), ['sl-z', 'sl-a', 'sl-m'])
    assert.equal(JSON.stringify(setlistsNoTimestamps), snapshotBefore)
    const backup = createBackupPayload(sampleSongs, setlistsNoTimestamps)
    assert.deepEqual(
      backup.setlists.map((s) => s.id),
      ['sl-z', 'sl-a', 'sl-m']
    )

    // 4. With reliable createdAt metadata on all setlists, Newest First and Oldest First appear and sort accurately
    const setlistsWithTimestamps = [
      { id: 'sl-z', name: 'Zeta Set', songs: [ref1], createdAt: 2000 },
      { id: 'sl-a', name: 'Alpha Set', songs: [ref2], createdAt: 3000 },
      { id: 'sl-m', name: 'Mid Set', songs: [ref1], createdAt: 1000 },
    ]
    await act(async () =>
      root.render(
        React.createElement(SongbookHomeView, {
          ...baseProps,
          setlists: setlistsWithTimestamps,
        })
      )
    )
    const sortSelectWithTs = document.querySelector('[data-testid="setlist-sort-select"]')
    const optionValuesWithTs = Array.from(sortSelectWithTs.querySelectorAll('option')).map(
      (o) => o.value
    )
    assert.deepEqual(optionValuesWithTs, ['manual', 'title_asc', 'title_desc', 'newest', 'oldest'])

    await selectValue(sortSelectWithTs, 'newest')
    assert.deepEqual(getRenderedSetlistIds(), ['sl-a', 'sl-z', 'sl-m'])

    await selectValue(sortSelectWithTs, 'oldest')
    assert.deepEqual(getRenderedSetlistIds(), ['sl-m', 'sl-z', 'sl-a'])

    // 5. Setlist Manage mode is decoupled from song selection and stable across sort/filter
    await act(async () =>
      document.querySelector('[data-testid="toggle-setlist-selection-mode"]').click()
    )
    await act(async () => document.querySelector('[data-testid="setlist-card-sl-z"]').click())
    assert.equal(
      document.querySelector('[data-testid="setlist-selection-count"]').textContent.trim(),
      '1 selected'
    )
    // Song selection mode is not activated by setlist selection
    assert.equal(document.querySelector('[data-testid="song-selection-bar"]'), null)

    // Change setlist sort while setlist is selected -> selection persists
    await selectValue(sortSelectWithTs, 'title_asc')
    assert.equal(
      document.querySelector('[data-testid="setlist-selection-count"]').textContent.trim(),
      '1 selected'
    )

    // Cancel setlist selection
    await act(async () =>
      document.querySelector('[data-testid="cancel-setlist-selection"]').click()
    )
    assert.equal(document.querySelector('[data-testid="setlist-selection-bar"]'), null)

    // 6. Hide / Show on Setlist toolbar
    const hideSetlistsBtn = document.querySelector('[data-testid="toggle-setlists-collapse"]')
    assert.equal(hideSetlistsBtn.textContent.trim(), 'Hide')
    await act(async () => hideSetlistsBtn.click())
    assert.equal(document.getElementById('gig-setlist-cards').hidden, true)
    assert.equal(hideSetlistsBtn.textContent.trim(), 'Show')
    await act(async () => hideSetlistsBtn.click())
    assert.equal(document.getElementById('gig-setlist-cards').hidden, false)
    assert.equal(hideSetlistsBtn.textContent.trim(), 'Hide')

    // 7. New Setlist, QR, and Import actions remain functional
    await act(async () => document.querySelector('[data-testid="setlists-menu-btn"]').click())
    assert.equal(document.querySelector('[data-testid="main-new-setlist-btn"]').textContent.trim(), 'New Setlist')
    await act(async () =>
      document.querySelector('[data-testid="main-new-setlist-btn"]').click()
    )
    assert.equal(newSetlistClicked, 1)

    await act(async () => document.querySelector('[data-testid="setlists-menu-btn"]').click())
    await act(async () =>
      document.querySelector('[data-testid="main-import-setlist-btn"]').click()
    )
    const importDialog = document.querySelector('[data-testid="setlist-import-dialog"]')
    assert.ok(importDialog)
    await act(async () =>
      importDialog.querySelector('button[aria-label="Close"]').click()
    )

    await act(async () =>
      document.querySelector('[data-testid="main-share-setlist-btn"]').click()
    )
    assert.ok(document.querySelector('[data-testid="share-setlist-chooser-dialog"]'))
    await act(async () =>
      document.querySelector('[data-testid="share-chooser-target-sl-a"]').click()
    )
    assert.equal(sharedSetlist?.id, 'sl-a')

    // 8. SetlistDrawer and Header also use "Song Setlists" label
    const headerTsx = fs.readFileSync(path.join(webDir, 'src/components/Header.tsx'), 'utf8')
    const drawerTsx = fs.readFileSync(path.join(webDir, 'src/components/SetlistDrawer.tsx'), 'utf8')
    assert.ok(headerTsx.includes('Song Setlists'))
    assert.ok(!headerTsx.includes('Gig Setlists'))
    assert.ok(drawerTsx.includes('Song Setlists'))
    assert.ok(!drawerTsx.includes('Gig Setlists'))
  } finally {
    await act(async () => root.unmount())
  }
})
