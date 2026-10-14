const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client"})'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
    }).outputText, filename
  )
}
require.extensions['.png'] = (module) => { module.exports = '/assets/dev-logo.png' }

const React = require('react')
const { renderToString } = require('react-dom/server')
const { SetlistDrawer } = require('../src/components/SetlistDrawer.tsx')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
const { Header } = require('../src/components/Header.tsx')

test('1. Header search input has clear unified placeholder including setlists', () => {
  const song = { id: 1, title: 'Hotel California', artist: 'Eagles', key: 'Bm', rawContent: '' }
  const html = renderToString(React.createElement(Header, {
    activeView: 'songbook',
    onViewChange: () => {},
    song,
    searchQuery: '',
    onSearchQueryChange: () => {},
    onOpenWebsiteUrlSource: () => {},
    onOpenStageTools: () => {},
    onToggleTheme: () => {},
    onOpenStageSettings: () => {},
    onOpenImportModal: () => {},
    onOpenBackupRestoreModal: () => {},
  }))

  assert.match(html, /Search songs, artists, setlists (&|&amp;) online chords\.\.\./)
})

test('2. SongbookHomeView filters gig setlists when search query is active', () => {
  const songs = [
    { id: 1, title: 'Hotel California', artist: 'Eagles', key: 'Bm', rawContent: '' },
    { id: 2, title: 'Wonderwall', artist: 'Oasis', key: 'Em', rawContent: '' },
  ]
  const setlists = [
    { id: 'sl-1', name: 'Acoustic Classics', songs: [{ id: 1, title: 'Hotel California', artist: 'Eagles' }] },
    { id: 'sl-2', name: 'Rock Night', songs: [{ id: 2, title: 'Wonderwall', artist: 'Oasis' }] },
  ]

  // Query matching "Acoustic"
  const htmlAcoustic = renderToString(React.createElement(SongbookHomeView, {
    songs,
    setlists,
    searchQuery: 'Acoustic',
    activeSongIndex: 0,
    onSelectSong: () => {},
    onSongMembershipChange: () => {},
    onCreateSetlistForSong: () => {},
    onNewSong: () => {},
    onOpenSetlists: () => {},
    onDeleteSong: () => {},
  }))

  assert.match(htmlAcoustic, /Gig Setlists.*1 of 2/)
  assert.match(htmlAcoustic, /Acoustic Classics/)

  // Query matching song inside setlist "Wonderwall"
  const htmlSongInSetlist = renderToString(React.createElement(SongbookHomeView, {
    songs,
    setlists,
    searchQuery: 'Wonderwall',
    activeSongIndex: 0,
    onSelectSong: () => {},
    onSongMembershipChange: () => {},
    onCreateSetlistForSong: () => {},
    onNewSong: () => {},
    onOpenSetlists: () => {},
    onDeleteSong: () => {},
  }))

  assert.match(htmlSongInSetlist, /Gig Setlists.*1 of 2/)
  assert.match(htmlSongInSetlist, /Rock Night/)
})

test('3. SetlistDrawer provides tab-aware placeholder and filters setlists on setlists tab', () => {
  const songs = [
    { id: 1, title: 'Hotel California', artist: 'Eagles', key: 'Bm', rawContent: '' },
    { id: 2, title: 'Wonderwall', artist: 'Oasis', key: 'Em', rawContent: '' },
  ]
  const setlists = [
    { id: 'sl-1', name: 'Friday Gig', songs: [{ id: 1, title: 'Hotel California', artist: 'Eagles' }] },
    { id: 'sl-2', name: 'Saturday Party', songs: [{ id: 2, title: 'Wonderwall', artist: 'Oasis' }] },
  ]

  const html = renderToString(React.createElement(SetlistDrawer, {
    isOpen: true,
    onClose: () => {},
    songs,
    setlists,
    activeSongIndex: 0,
    onSelectSongIndex: () => {},
    onDeleteSong: () => {},
    onNewSong: () => {},
  }))

  // Drawer has search input with clear placeholder
  assert.match(html, /placeholder="Search by title or artist\.\.\."/)
})

test('4. Main song library view has exactly one primary search surface in Header and no duplicate in SongbookHomeView', () => {
  const songs = [
    { id: 1, title: 'Hotel California', artist: 'Eagles', key: 'Bm', rawContent: '' },
    { id: 2, title: 'Wonderwall', artist: 'Oasis', key: 'Em', rawContent: '' },
  ]
  const setlists = [
    { id: 'sl-1', name: 'Friday Gig', songs: [{ id: 1, title: 'Hotel California', artist: 'Eagles' }] },
  ]

  // Render Header
  const headerHtml = renderToString(React.createElement(Header, {
    activeView: 'songbook',
    onViewChange: () => {},
    song: songs[0],
    searchQuery: '',
    onSearchQueryChange: () => {},
    onOpenWebsiteUrlSource: () => {},
    onOpenStageTools: () => {},
    onToggleTheme: () => {},
    onOpenStageSettings: () => {},
    onOpenImportModal: () => {},
    onOpenBackupRestoreModal: () => {},
  }))

  // Primary global search input exists in Header
  assert.match(headerHtml, /<input[^>]+type="text"[^>]+placeholder="Search songs, artists, setlists (&|&amp;) online chords\.\.\."/)

  // Render SongbookHomeView
  const homeHtml = renderToString(React.createElement(SongbookHomeView, {
    songs,
    setlists,
    searchQuery: '',
    activeSongIndex: 0,
    onSelectSong: () => {},
    onSongMembershipChange: () => {},
    onCreateSetlistForSong: () => {},
    onNewSong: () => {},
    onOpenSetlists: () => {},
    onDeleteSong: () => {},
  }))

  // SongbookHomeView must NOT contain a text search input (deduplicated)
  assert.equal(homeHtml.includes('placeholder="Search songs in library..."'), false)
  const homeInputMatches = homeHtml.match(/<input[^>]+type="text"/g) || []
  assert.equal(homeInputMatches.length, 0, 'SongbookHomeView should have zero text inputs (no redundant lower search)')

  // Filters must be preserved: Sort dropdown, Key dropdown, Setlist dropdown
  assert.match(homeHtml, /Sort:/)
  assert.match(homeHtml, /Key:/)
  assert.match(homeHtml, /Setlist:/)
})
