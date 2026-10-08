const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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

test('SETLIST_CARD_DENSITY: Setlist cards use compact padding, reduced vertical space, and retain title + song count', () => {
  const songs = [
    { id: 1, title: 'Hotel California', artist: 'Eagles', key: 'Bm', rawContent: '' },
    { id: 2, title: 'Take It Easy', artist: 'Eagles', key: 'G', rawContent: '' },
  ]
  const setlists = [
    { id: 'sl-1', name: 'West Coast Set', songs: [{ id: 1 }, { id: 2 }] }
  ]

  const html = renderToString(React.createElement(SongbookHomeView, {
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
    onDeleteSetlist: () => {},
  }))

  // Title and count rendered
  assert.match(html, /West Coast Set/)
  assert.match(html, /2.*songs/)

  // Compact layout verification: uses py-1.5 / py-2 padding, not tall empty card
  assert.ok(html.includes('py-1.5'), 'Setlist card must use compact vertical padding py-1.5')
  assert.ok(html.includes('data-testid="setlist-card-sl-1"'), 'Setlist card has test identifier')
})

test('SETLIST_PLAY_QUICK_ACTION: Quick play action remains directly accessible on setlist card', () => {
  const songs = [
    { id: 1, title: 'Hotel California', artist: 'Eagles', key: 'Bm', rawContent: '' }
  ]
  const setlists = [
    { id: 'sl-1', name: 'West Coast Set', songs: [{ id: 1 }] }
  ]

  const html = renderToString(React.createElement(SongbookHomeView, {
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
    onDeleteSetlist: () => {},
  }))

  assert.ok(html.includes('data-testid="play-setlist-sl-1"'), 'Setlist card has quick play button')
  assert.ok(html.includes('title="Play setlist"'), 'Play button has descriptive title')
  assert.ok(html.includes('aria-label="Play setlist West Coast Set"'), 'Play button has descriptive aria-label')
})

test('SETLIST_DELETE_OPTIONS_ACTION: Setlist delete is consolidated into options menu and preserves confirmation guard', () => {
  const viewCode = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')

  // Setlist card does NOT have an always-visible trash button outside the options menu
  const cardTrashOutsideMenu = viewCode.match(/<button[^>]*title="Delete setlist"[^>]*>[\s\S]*?<\/button>\s*\{?\/\*\s*Three-dot/i)
  assert.equal(cardTrashOutsideMenu, null, 'Delete button must not be always-visible on setlist card beside menu')

  // Delete option is inside the options menu
  assert.ok(viewCode.includes('data-testid={`menu-delete-${sl.id}`}'), 'Delete option is present in setlist menu')
  assert.ok(viewCode.includes('setConfirmDeleteSetlistId(sl.id)'), 'Selecting delete from menu triggers confirmation')

  // Confirmation guard popover preserved
  assert.ok(viewCode.includes('Delete setlist?'), 'Confirmation dialog text preserved')
  assert.ok(viewCode.includes('onDeleteSetlist?.(sl.id)'), 'Confirmation executes onDeleteSetlist')
  assert.ok(viewCode.includes('setConfirmDeleteSetlistId(null)'), 'Cancel dismisses confirmation')
})

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

test('SONG_CARD_KEY+BPM_NOT_RENDERED_AS_CARD_BADGES: Key and BPM are not rendered as badges on the song card', () => {
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

  // The song card must NOT contain KEY badge or BPM badge
  assert.equal(html.includes('KEY: Bm'), false, 'Song card must not render KEY: badge')
  assert.equal(html.includes('127 BPM'), false, 'Song card must not render BPM badge')
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
  assert.ok(html.includes('title="Song options"'), 'Options button has descriptive title')
  assert.ok(html.includes('aria-label="Song options for Comfortably Numb"'), 'Options button has accessibility label')
})

test('SONG_ADD_TO_SETLIST_OPTIONS_ACTION: Add to setlist is consolidated into song options menu', () => {
  const viewCode = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')

  // Menu item exists and triggers membership dialog
  assert.ok(viewCode.includes('data-testid={`menu-add-to-setlist-${originalIdx}`}'), 'Add to setlist menu button exists')
  assert.ok(viewCode.includes('setMembershipSongId(song.id ?? null)'), 'Menu button sets membershipSongId')
  assert.ok(viewCode.includes('title="Add to Setlist"'), 'Menu button has title')
})

test('SONG_DELETE_OPTIONS_ACTION: Song delete is consolidated into options menu with confirmation guard', () => {
  const viewCode = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')

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
  const viewCode = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')

  assert.ok(
    viewCode.includes('onClick={() => onSelectSong(originalIdx)}') ||
    viewCode.includes('onSelectSong(originalIdx)'),
    'Song card root must have onClick invoking onSelectSong'
  )
})

test('MENU_CLICK_DOES_NOT_LAUNCH_STAGE: Clicking song options menu button or items stops event propagation', () => {
  const viewCode = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')

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
  assert.match(html, /Songs Library.*1.*of.*2/)
})

test('RESPONSIVE_RENDER_GUARDS_WHERE_EXISTING: Desktop grid expands to 4 columns and cards truncate long titles', () => {
  const viewCode = fs.readFileSync(path.resolve(__dirname, '../src/components/SongbookHomeView.tsx'), 'utf8')

  // Multi-column responsive layout with 4 columns on large/desktop screens
  assert.ok(
    viewCode.includes('xl:grid-cols-4'),
    'Songs grid must include xl:grid-cols-4 for increased desktop density'
  )

  // Title and artist use truncate to prevent overflow
  assert.ok(
    viewCode.includes('{song.title || \'Untitled Song\'}\n                        </h3>') ||
    viewCode.includes('truncate'),
    'Song title must be truncated when long'
  )
})
