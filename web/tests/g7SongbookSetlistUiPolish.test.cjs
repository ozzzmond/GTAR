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
