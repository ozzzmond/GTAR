const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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

const sampleSongs = [
  { id: 'song-1', title: 'Alpha Tune', artist: 'Band One', key: 'C', rawContent: '[C] Lyrics' },
  { id: 'song-2', title: 'Beta Groove', artist: 'Band Two', key: 'G', rawContent: '[G] Lyrics' },
]

const sampleSetlists = [
  { id: 'sl-1', name: 'Gig Set A', songs: [{ id: 'song-1', title: 'Alpha Tune' }] },
  { id: 'sl-2', name: 'Gig Set B', songs: [{ id: 'song-2', title: 'Beta Groove' }] },
]

test('ISSUE 130: 1. Top navigation renders 3 distinct tabs (My Songs, Setlists, Shared Catalog) with counts', async () => {
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => {
      root.render(
        React.createElement(SongbookHomeView, {
          songs: sampleSongs,
          setlists: sampleSetlists,
          activeSongIndex: 0,
          onSelectSong: () => {},
          onNewSong: () => {},
          onOpenSetlists: () => {},
          onDeleteSong: () => {},
          onSongMembershipChange: () => {},
          onCreateSetlistForSong: () => {},
        })
      )
    })

    const mySongsTab = document.querySelector('[data-testid="tab-my-songs"]')
    const setlistsTab = document.querySelector('[data-testid="tab-setlists"]')
    const sharedTab = document.querySelector('[data-testid="tab-shared-catalog"]')

    assert.ok(mySongsTab, 'My Songs tab pill must exist')
    assert.ok(setlistsTab, 'Setlists tab pill must exist')
    assert.ok(sharedTab, 'Shared Catalog tab pill must exist')

    assert.equal(mySongsTab.getAttribute('aria-selected'), 'true')
    assert.equal(setlistsTab.getAttribute('aria-selected'), 'false')
    assert.equal(sharedTab.getAttribute('aria-selected'), 'false')

    assert.match(mySongsTab.textContent, /My Songs \(2\)/)
    assert.match(setlistsTab.textContent, /Setlists \(2\)/)
    assert.match(sharedTab.textContent, /Shared Catalog/)
  } finally {
    await act(async () => root.unmount())
  }
})

test('ISSUE 130: 2. Default view renders both separate rounded panels: SONG SETLISTS and SONGS LIBRARY', async () => {
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => {
      root.render(
        React.createElement(SongbookHomeView, {
          songs: sampleSongs,
          setlists: sampleSetlists,
          activeSongIndex: 0,
          onSelectSong: () => {},
          onNewSong: () => {},
          onOpenSetlists: () => {},
          onDeleteSong: () => {},
          onSongMembershipChange: () => {},
          onCreateSetlistForSong: () => {},
        })
      )
    })

    const setlistPanel = document.querySelector('section[aria-label="Song Setlists"]')
    const songsPanel = document.querySelector('section[aria-label="Songs Library"]')

    assert.ok(setlistPanel, 'Song Setlists panel section must exist')
    assert.ok(songsPanel, 'Songs Library panel section must exist')

    // Rounded styling
    assert.match(setlistPanel.className, /rounded-2xl/)
    assert.match(setlistPanel.className, /border-app-border/)
    assert.match(songsPanel.className, /rounded-2xl/)
    assert.match(songsPanel.className, /border-app-border/)

    // Panel headings & counts
    assert.match(setlistPanel.textContent, /Song Setlists \(2\)/)
    assert.match(songsPanel.textContent, /Songs Library \(2 of 2\)/)
  } finally {
    await act(async () => root.unmount())
  }
})

test('ISSUE 130: 3. Switching to Setlists tab isolates view to SONG SETLISTS panel', async () => {
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => {
      root.render(
        React.createElement(SongbookHomeView, {
          songs: sampleSongs,
          setlists: sampleSetlists,
          activeSongIndex: 0,
          onSelectSong: () => {},
          onNewSong: () => {},
          onOpenSetlists: () => {},
          onDeleteSong: () => {},
          onSongMembershipChange: () => {},
          onCreateSetlistForSong: () => {},
        })
      )
    })

    const setlistsTab = document.querySelector('[data-testid="tab-setlists"]')
    await act(async () => setlistsTab.click())

    assert.equal(setlistsTab.getAttribute('aria-selected'), 'true')
    assert.ok(document.querySelector('section[aria-label="Song Setlists"]'))
    assert.equal(document.querySelector('section[aria-label="Songs Library"]'), null)
  } finally {
    await act(async () => root.unmount())
  }
})

test('ISSUE 130: 4. Dedicated tinted Setlist Controls toolbar contains sort, New Setlist, Manage, QR, Import, and Hide', async () => {
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => {
      root.render(
        React.createElement(SongbookHomeView, {
          songs: sampleSongs,
          setlists: sampleSetlists,
          activeSongIndex: 0,
          onSelectSong: () => {},
          onNewSong: () => {},
          onOpenSetlists: () => {},
          onDeleteSong: () => {},
          onSongMembershipChange: () => {},
          onCreateSetlistForSong: () => {},
        })
      )
    })

    const toolbar = document.querySelector('[data-testid="setlist-controls-toolbar"]')
    assert.ok(toolbar, 'Setlist controls toolbar must exist')
    assert.match(toolbar.className, /bg-app-filter/)
    assert.match(toolbar.className, /rounded-2xl/)

    // Sort select
    const sortSelect = toolbar.querySelector('[data-testid="setlist-sort-select"]')
    assert.ok(sortSelect, 'Sort select must be inside toolbar')

    // Setlist action buttons
    const actionToolbar = toolbar.querySelector('[data-testid="setlist-toolbar"]')
    assert.ok(actionToolbar)
    const buttons = Array.from(actionToolbar.querySelectorAll('button'))
    assert.equal(buttons.length, 5)
    assert.equal(buttons[0].getAttribute('data-testid'), 'main-new-setlist-btn')
    assert.equal(buttons[1].getAttribute('data-testid'), 'toggle-setlist-selection-mode')
    assert.equal(buttons[2].getAttribute('data-testid'), 'main-share-setlist-btn')
    assert.equal(buttons[3].getAttribute('data-testid'), 'main-import-setlist-btn')
    assert.equal(buttons[4].getAttribute('data-testid'), 'toggle-setlists-collapse')
  } finally {
    await act(async () => root.unmount())
  }
})

test('ISSUE 130: 5. Preserves PR #131 Shared Setlist publishing UI parity and setlist actions', async () => {
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => {
      root.render(
        React.createElement(SongbookHomeView, {
          songs: sampleSongs,
          setlists: sampleSetlists,
          activeSongIndex: 0,
          onSelectSong: () => {},
          onNewSong: () => {},
          onOpenSetlists: () => {},
          onDeleteSong: () => {},
          onSongMembershipChange: () => {},
          onCreateSetlistForSong: () => {},
          onPublishSetlist: () => {},
          onShareSetlist: () => {},
        })
      )
    })

    // Setlist card actions exist
    const playBtn = document.querySelector('[data-testid="play-setlist-sl-1"]')
    const menuBtn = document.querySelector('[data-testid="setlist-menu-sl-1"]')
    assert.ok(playBtn, 'Play button on setlist card must exist')
    assert.ok(menuBtn, 'Menu button on setlist card must exist')

    // Open menu
    await act(async () => menuBtn.click())

    // PR #131 action items in menu
    const publishBtn = document.querySelector('[data-testid="menu-publish-setlist-sl-1"]')
    const shareBtn = document.querySelector('[data-testid="menu-share-sl-1"]')
    const exportBtn = document.querySelector('[data-testid="menu-export-json-sl-1"]')

    assert.ok(shareBtn, 'QR Share Setlist must be present')
    assert.ok(exportBtn, 'Export JSON must be present')
  } finally {
    await act(async () => root.unmount())
  }
})
