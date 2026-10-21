const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client"})'),
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

const sampleSongs = [
  {
    id: 'song-1',
    title: 'Alpha Tune',
    artist: 'Band One',
    key: 'C',
    bpm: '120',
    rawContent: '[C] Alpha lyrics',
    format: 'CHORD_PRO',
  },
  {
    id: 'song-2',
    title: 'Beta Groove',
    artist: 'Band Two',
    key: 'G',
    bpm: '100',
    rawContent: '[G] Beta lyrics',
    format: 'CHORD_PRO',
  },
]

function baseProps(setlists, extra = {}) {
  return {
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
    ...extra,
  }
}

function makeActive(id, name, songs = []) {
  return { id, name, songs }
}

function makeDeleted(id, name) {
  return { id, name, songs: [], isDeleted: true }
}

function cardIds() {
  return Array.from(document.querySelectorAll('[data-testid^="setlist-card-"]')).map((el) =>
    el.getAttribute('data-testid').replace('setlist-card-', '')
  )
}

test('Setlist count parity: main Setlists tab equals canonical active setlists and equals Song Setlists panel total', async () => {
  localStorage.clear()
  const active = [makeActive('sl-a', 'Alpha'), makeActive('sl-b', 'Bravo'), makeActive('sl-c', 'Charlie')]
  const deleted = [
    makeDeleted('sl-d1', 'Deleted One'),
    makeDeleted('sl-d2', 'Deleted Two'),
    makeDeleted('sl-d3', 'Deleted Three'),
    makeDeleted('sl-d4', 'Deleted Four'),
  ]
  const setlists = [...active, ...deleted]
  const snapshot = JSON.stringify(setlists)
  const root = createRoot(document.getElementById('root'))

  try {
    await act(async () => root.render(React.createElement(SongbookHomeView, baseProps(setlists))))

    // Main "Setlists" tab reflects the canonical active (non-deleted) count.
    const tab = document.querySelector('[data-testid="tab-setlists"]')
    assert.ok(tab)
    assert.equal(tab.textContent.trim(), `Setlists (${active.length})`)

    // Panel heading reflects the same canonical count.
    assert.match(document.body.textContent, /Song Setlists \(3\)/)

    // Rendered setlist cards are consistent with the canonical count (no tombstones rendered).
    assert.deepEqual(cardIds().sort(), ['sl-a', 'sl-b', 'sl-c'])

    // Source records are never mutated (tombstones preserved, original order intact).
    assert.equal(JSON.stringify(setlists), snapshot)
  } finally {
    await act(async () => root.unmount())
  }
})

test('Soft-deleted setlists are excluded from every user-facing count and are never rendered as cards', async () => {
  localStorage.clear()
  const active = [makeActive('sl-live', 'Live Set')]
  const deleted = [makeDeleted('sl-gone1', 'Gone One'), makeDeleted('sl-gone2', 'Gone Two')]
  const setlists = [...active, ...deleted]
  const root = createRoot(document.getElementById('root'))

  try {
    await act(async () => root.render(React.createElement(SongbookHomeView, baseProps(setlists))))

    assert.equal(document.querySelector('[data-testid="tab-setlists"]').textContent.trim(), 'Setlists (1)')
    assert.match(document.body.textContent, /Song Setlists \(1\)/)
    assert.deepEqual(cardIds(), ['sl-live'])
    assert.equal(document.querySelector('[data-testid="setlist-card-sl-gone1"]'), null)
    assert.equal(document.querySelector('[data-testid="setlist-card-sl-gone2"]'), null)
  } finally {
    await act(async () => root.unmount())
  }
})

test('Filtered panel total uses the canonical active count (X of <active>), never the raw stored count', async () => {
  localStorage.clear()
  const active = [
    makeActive('sl-rock', 'Rock Night'),
    makeActive('sl-folk', 'Folk Evening'),
  ]
  const deleted = [makeDeleted('sl-rock-dup', 'Rock Night Archive')]
  const setlists = [...active, ...deleted]
  const root = createRoot(document.getElementById('root'))

  try {
    await act(async () =>
      root.render(
        React.createElement(SongbookHomeView, baseProps(setlists, { searchQuery: 'Rock' }))
      )
    )

    // Only one active setlist matches ("Rock Night"); the deleted "Rock Night Archive" must not count.
    assert.match(document.body.textContent, /Song Setlists \(1 of 2\)/)
    assert.match(document.body.textContent, /Rock Night/)
    assert.doesNotMatch(document.body.textContent, /Rock Night Archive/)
  } finally {
    await act(async () => root.unmount())
  }
})

test('When every setlist is soft-deleted the tab and panel resolve to zero and show the empty state', async () => {
  localStorage.clear()
  const setlists = [makeDeleted('sl-d1', 'Deleted One'), makeDeleted('sl-d2', 'Deleted Two')]
  const snapshot = JSON.stringify(setlists)
  const root = createRoot(document.getElementById('root'))

  try {
    await act(async () => root.render(React.createElement(SongbookHomeView, baseProps(setlists))))

    assert.equal(document.querySelector('[data-testid="tab-setlists"]').textContent.trim(), 'Setlists (0)')

    // With active-tab setlists view the empty state is shown, not a zero-count card panel.
    const setlistsTab = document.querySelector('[data-testid="tab-setlists"]')
    await act(async () => setlistsTab.click())
    assert.match(document.body.textContent, /No Setlists Yet/)
    assert.equal(cardIds().length, 0)

    // Tombstones remain preserved and unmodified.
    assert.equal(JSON.stringify(setlists), snapshot)
    assert.equal(setlists.every((sl) => sl.isDeleted === true), true)
  } finally {
    await act(async () => root.unmount())
  }
})

test('No duplicate counting: each distinct active setlist is counted exactly once', async () => {
  localStorage.clear()
  const active = [makeActive('sl-a', 'Alpha'), makeActive('sl-b', 'Bravo'), makeActive('sl-c', 'Charlie')]
  const setlists = [...active, ...active.map((sl) => makeDeleted(`tomb-${sl.id}`, sl.name))]
  const root = createRoot(document.getElementById('root'))

  try {
    await act(async () => root.render(React.createElement(SongbookHomeView, baseProps(setlists))))

    assert.equal(document.querySelector('[data-testid="tab-setlists"]').textContent.trim(), 'Setlists (3)')
    assert.deepEqual(cardIds().sort(), ['sl-a', 'sl-b', 'sl-c'])
  } finally {
    await act(async () => root.unmount())
  }
})
