const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { readSource } = require('./helpers/sourceText.cjs')
const path = require('node:path')
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
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')

test('SONG_CARD_TITLE+ARTIST_VISIBLE: Song library card clearly renders primary title and secondary artist', () => {
  const songs = [
    { id: 101, title: 'Comfortably Numb', artist: 'Pink Floyd', key: 'Bm', bpm: '127', rawContent: '' }
  ]

  const html = renderToString(React.createElement(SongbookHomeView, {
    songs,
    setlists: [],
    searchQuery: '',
    activeSongIndex: 0,
    onSelectSong: () => {},
    onSongMembershipChange: () => {},
    onCreateSetlistForSong: () => {},
    onNewSong: () => {},
    onOpenSetlists: () => {},
    onDeleteSong: () => {},
  }))

  assert.match(html, /Comfortably Numb/)
  assert.match(html, /Pink Floyd/)
  assert.ok(html.includes('data-testid="song-card-0"'), 'Song card has data-testid')
})

test('SONG_CARD_BPM_UNIT_RENDERED_ONCE: stored "73 BPM" renders the unit once', () => {
  const html = renderToString(React.createElement(SongbookHomeView, {
    songs: [
      { id: 102, title: 'Tempo Song', artist: 'Band', key: 'G', bpm: '73 BPM', rawContent: '' }
    ],
    setlists: [],
    searchQuery: '',
    activeSongIndex: 0,
    onSelectSong: () => {},
    onSongMembershipChange: () => {},
    onCreateSetlistForSong: () => {},
    onNewSong: () => {},
    onOpenSetlists: () => {},
    onDeleteSong: () => {},
  }))
  // React SSR separates adjacent text nodes with comment markers; compare visible text.
  const text = html.replace(/<!--[\s\S]*?-->/g, '')
  assert.ok(text.includes('73 BPM'), 'card shows the tempo label')
  assert.equal(text.includes('73 BPM BPM'), false, 'unit is not duplicated')
})

test('SONG_CARD_KEY+BPM_LABEL: Key is not a badge and BPM renders once as plain text', () => {
  const songs = [
    { id: 101, title: 'Comfortably Numb', artist: 'Pink Floyd', key: 'Bm', bpm: '127', rawContent: '' }
  ]

  const html = renderToString(React.createElement(SongbookHomeView, {
    songs,
    setlists: [],
    searchQuery: '',
    activeSongIndex: 0,
    onSelectSong: () => {},
    onSongMembershipChange: () => {},
    onCreateSetlistForSong: () => {},
    onNewSong: () => {},
    onOpenSetlists: () => {},
    onDeleteSong: () => {},
  }))

  // #388: the card renders the key chip and one plain-text tempo label (unit once).
  assert.equal(html.includes('KEY: Bm'), false, 'Song card must not render KEY: badge')
  assert.ok(html.includes('127 BPM'), 'Song card renders the tempo label')
  assert.equal(html.includes('127 BPM BPM'), false, 'Tempo unit is not duplicated')
  assert.equal(html.includes('OPEN STAGE'), false, 'Song card must not render OPEN STAGE footer text')
})

test('SONG_OPTIONS_MENU: Song card has compact ellipsis button for options', () => {
  const songs = [
    { id: 101, title: 'Comfortably Numb', artist: 'Pink Floyd', key: 'Bm', rawContent: '' }
  ]

  const html = renderToString(React.createElement(SongbookHomeView, {
    songs,
    setlists: [],
    searchQuery: '',
    activeSongIndex: 0,
    onSelectSong: () => {},
    onSongMembershipChange: () => {},
    onCreateSetlistForSong: () => {},
    onNewSong: () => {},
    onOpenSetlists: () => {},
    onDeleteSong: () => {},
  }))

  assert.ok(html.includes('data-testid="song-menu-0"'), 'Song card includes options menu trigger')
  assert.match(html, /aria-label="Song options for /, 'Options button has an accessible name')
  assert.ok(html.includes('aria-label="Song options for Comfortably Numb"'), 'Options button has accessibility label')
})

test('SONG_ADD_TO_SETLIST_OPTIONS_ACTION: Add to setlist is consolidated into song options menu', () => {
  const viewCode = readSource(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'))

  // Menu item exists and triggers membership dialog
  assert.ok(viewCode.includes('data-testid={`menu-add-to-setlist-${originalIdx}`}'), 'Add to setlist menu button exists')
  assert.ok(viewCode.includes('setMembershipSongId(song.id ?? null)'), 'Menu button sets membershipSongId')
  assert.ok(viewCode.includes('Add to Setlist'), 'Menu button labelled')
})

test('SONG_DELETE_OPTIONS_ACTION: Song delete is consolidated into options menu with confirmation guard', () => {
  const viewCode = readSource(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'))

  // Menu item exists and triggers confirm state
  assert.ok(viewCode.includes('data-testid={`menu-delete-song-${originalIdx}`}'), 'Delete song menu button exists')
  assert.ok(viewCode.includes('setConfirmDeleteIdx(originalIdx)'), 'Menu button opens confirmation dialog')

  // Inline confirmation popover
  assert.ok(viewCode.includes('Delete this song?'), 'Confirmation question present')
  assert.ok(viewCode.includes('data-testid={`confirm-delete-song-${originalIdx}`}'), 'Confirm delete button present')
  assert.ok(viewCode.includes('onDeleteSong(originalIdx)'), 'Confirming invokes onDeleteSong')
  assert.ok(viewCode.includes('data-testid={`cancel-delete-song-${originalIdx}`}'), 'Cancel delete button present')
})

test('SONG_CARD_STAGE_LAUNCH: Clicking song card calls onSelectSong to launch stage view', () => {
  const viewCode = readSource(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'))

  assert.ok(
    viewCode.includes('onClick={() => onSelectSong(originalIdx)}') ||
    viewCode.includes('onSelectSong(originalIdx)'),
    'Song card root must have onClick invoking onSelectSong'
  )
})

test('MENU_CLICK_DOES_NOT_LAUNCH_STAGE: Clicking song options menu button or items stops event propagation', () => {
  const viewCode = readSource(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'))

  // Check that song menu trigger stops propagation
  assert.ok(
    viewCode.includes('e.stopPropagation()\n                        setActiveMenuSongIdx(') ||
    viewCode.includes('e.stopPropagation(); setActiveMenuSongIdx(') ||
    viewCode.includes('e.stopPropagation()') && viewCode.includes('setActiveMenuSongIdx(isMenuOpen ? null : originalIdx)'),
    'Options menu trigger must stop event propagation to prevent launching stage view'
  )

  // Check that options menu dropdown stops propagation
  assert.ok(
    viewCode.includes('onClick={(e) => e.stopPropagation()}') && viewCode.includes('data-testid={`menu-add-to-setlist-'),
    'Options menu container must stop click propagation'
  )
})

test('EXISTING_SEARCH+FILTER_REGRESSION: Search and key/setlist/sort controls remain functional', () => {
  const songs = [
    { id: 1, title: 'Beta Song', artist: 'Zeta Artist', key: 'C', rawContent: '' },
    { id: 2, title: 'Alpha Song', artist: 'Abe Artist', key: 'G', rawContent: '' },
  ]
  const setlists = [
    { id: 'sl-1', name: 'Gig 1', songs: [{ id: 1 }] }
  ]

  // Render with filter and search
  const html = renderToString(React.createElement(SongbookHomeView, {
    songs,
    setlists,
    searchQuery: 'Alpha',
    activeSongIndex: 0,
    onSelectSong: () => {},
    onSongMembershipChange: () => {},
    onCreateSetlistForSong: () => {},
    onNewSong: () => {},
    onOpenSetlists: () => {},
    onDeleteSong: () => {},
  }))

  assert.match(html, /Alpha Song/)
  assert.equal(html.includes('Beta Song'), false, 'Search query must filter out non-matching songs')
  assert.match(html.replaceAll('<!-- -->', ''), /All Songs.*\(1 song\)/, '#319: GTAR1 heading count')
})

test('RESPONSIVE_RENDER_GUARDS_WHERE_EXISTING: Desktop grid reserves title width and cards truncate long titles with tooltips', () => {
  const viewCode = readSource(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'))

  // Fit desktop tracks to the available workspace, including the Explorer sidebar.
  assert.ok(
    viewCode.includes('lg:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]'),
    'Desktop song tracks must reserve enough width for typical titles'
  )
  assert.ok(viewCode.includes("title={song.title || 'Untitled Song'}"), 'Truncated titles retain a tooltip')

  // Title and artist use truncate to prevent overflow
  assert.ok(
    viewCode.includes('{song.title || \'Untitled Song\'}\n                        </h3>') ||
    viewCode.includes('truncate'),
    'Song title must be truncated when long'
  )
})
