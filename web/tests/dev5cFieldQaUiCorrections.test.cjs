const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
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

const React = require('react')
const { renderToString } = require('react-dom/server')
const { SetlistDrawer } = require('../src/components/SetlistDrawer.tsx')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
const { getSongMetadataStatus } = require('../src/utils/chordProMetadata.ts')

const webDir = path.resolve(__dirname, '..')

const sampleCompleteSong = {
  id: 'song-1',
  title: 'Hotel California',
  artist: 'Eagles',
  originalKey: 'Bm',
  bpm: '75',
  time: '4/4',
  year: '1976',
  rawContent: '{title: Hotel California}\n{artist: Eagles}\n{original_key: Bm}\n{tempo: 75}\n{time: 4/4}\n{year: 1976}\n[Bm]Welcome',
}

const sampleIncompleteSong = {
  id: 'song-2',
  title: 'Untitled Draft',
  artist: '',
  rawContent: '[C]Hello world',
}

const sampleSetlists = [
  {
    id: 'sl-1',
    name: 'Acoustic Set',
    songs: [{ id: 'song-1', title: 'Hotel California', artist: 'Eagles' }],
  },
]

// 1. SONGBOOK SIDE PANEL COMPACT ACTIONS & REDUNDANT GREEN CHECK REMOVAL
test('DEV5C_QA_1_2: Side-panel cards render compact metadata status icon and compact Add to Setlist button, removing text badges and redundant check', () => {
  const songs = [sampleCompleteSong, sampleIncompleteSong]

  const html = renderToString(
    React.createElement(SetlistDrawer, {
      isOpen: true,
      onClose: () => {},
      songs,
      activeSongIndex: 0, // song-1 is active
      onSelectSongIndex: () => {},
      onDeleteSong: () => {},
      onNewSong: () => {},
      setlists: sampleSetlists,
    })
  )

  // 1. Metadata status: rendered as compact icon state with role and accessible label
  assert.ok(html.includes('data-testid="drawer-song-metadata-status-0"'), 'Drawer renders metadata status container for song 0')
  assert.ok(html.includes('aria-label="Metadata OK"'), 'Complete song has aria-label="Metadata OK"')
  assert.ok(html.includes('aria-label="Needs Metadata"'), 'Incomplete song has aria-label="Needs Metadata"')

  // Crucial: verbose text badges MUST NOT be in drawer cards
  assert.ok(!html.includes('<span>Metadata OK</span>'), 'Must NOT render textual "Metadata OK" badge span')
  assert.ok(!html.includes('<span>Needs Metadata</span>'), 'Must NOT render textual "Needs Metadata" badge span')

  // 2. Add to Setlist: rendered as compact icon button with accessible label
  assert.ok(html.includes('data-testid="drawer-song-add-to-setlist-0"'), 'Drawer renders add-to-setlist button for song 0')
  assert.ok(html.includes('aria-label="Add to Setlist"'), 'Add to setlist button has aria-label="Add to Setlist"')
  assert.ok(!html.includes('<span>Add to Setlist</span>'), 'Must NOT render textual "Add to Setlist" label span')

  // 3. Redundant green check removal:
  // Active song has the playing pulse icon, but NOT a redundant standalone green check action
  const drawerSource = fs.readFileSync(path.join(webDir, 'src/components/SetlistDrawer.tsx'), 'utf8')
  assert.ok(
    !drawerSource.includes('{isActive && (\n                      <CheckCircle2 className="w-3.5 h-3.5 text-status-success shrink-0" />\n                    )}'),
    'Redundant green circled-check icon indicator must be removed from Songbook drawer cards'
  )
})

// 2. MAIN PAGE SIDEPANEL ENTRY CONTROLS (PANEL-MENU ICONS FOR SETLISTS & SONGBOOK)
test('DEV5C_QA_3: Gig Setlists and Songs Library have matching Menu icon entry controls with accessible labels', () => {
  let openedSetlists = false
  let openedSongbook = false

  const html = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [sampleCompleteSong],
      activeSongIndex: 0,
      onSelectSong: () => {},
      onNewSong: () => {},
      onOpenSetlists: () => { openedSetlists = true },
      onOpenSongbook: () => { openedSongbook = true },
      onDeleteSong: () => {},
      setlists: sampleSetlists,
      onSongMembershipChange: () => {},
      onCreateSetlistForSong: () => {},
    })
  )

  // 1. Gig Setlists section entry control
  assert.ok(html.includes('data-testid="open-setlists-panel-btn"'), 'Gig Setlists must have open-setlists-panel-btn')
  assert.ok(html.includes('aria-label="Open Setlists panel"'), 'Setlists panel button has aria-label="Open Setlists panel"')
  assert.ok(html.includes('title="Open Setlists panel"'), 'Setlists panel button has title="Open Setlists panel"')

  // 2. Songs Library section entry control
  assert.ok(html.includes('data-testid="open-songbook-panel-btn"'), 'Songs Library must have open-songbook-panel-btn')
  assert.ok(html.includes('aria-label="Open Songbook panel"'), 'Songbook panel button has aria-label="Open Songbook panel"')
  assert.ok(html.includes('title="Open Songbook panel"'), 'Songbook panel button has title="Open Songbook panel"')

  // 3. Existing bulk Songs Library "Manage" button remains separate
  assert.ok(html.includes('data-testid="toggle-song-selection-mode"'), 'Bulk Songs Library Manage button preserved')
  assert.ok(html.includes('>Manage<'), 'Bulk Manage button retains text label Manage')

  // Source code check: both use Menu icon from lucide-react
  const songbookSource = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')
  assert.ok(songbookSource.includes('<Menu className="w-3.5 h-3.5" />'), 'Entry controls use compact Menu icon')
})

// 3. MAIN SONGS LIBRARY CARDS METADATA STATUS ICON
test('DEV5C_QA_4: Main Songs Library cards render compact canonical metadata status icons', () => {
  const songs = [sampleCompleteSong, sampleIncompleteSong]

  const html = renderToString(
    React.createElement(SongbookHomeView, {
      songs,
      activeSongIndex: 0,
      onSelectSong: () => {},
      onNewSong: () => {},
      onOpenSetlists: () => {},
      onOpenSongbook: () => {},
      onDeleteSong: () => {},
      setlists: sampleSetlists,
      onSongMembershipChange: () => {},
      onCreateSetlistForSong: () => {},
    })
  )

  // Complete song card
  assert.ok(html.includes('data-testid="song-metadata-status-0"'), 'Main card 0 renders metadata status container')
  assert.ok(html.includes('title="Metadata OK"'), 'Main card 0 has title="Metadata OK"')

  // Incomplete song card
  assert.ok(html.includes('data-testid="song-metadata-status-1"'), 'Main card 1 renders metadata status container')
  assert.ok(html.includes('Needs Metadata'), 'Main card 1 renders Needs Metadata status')

  // Source code check: canonical helper is called for each card
  const songbookSource = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')
  assert.ok(
    songbookSource.includes('const metadataStatus = getSongMetadataStatus(song)'),
    'SongbookHomeView must use canonical getSongMetadataStatus for card status'
  )
})

// 4. GIG SETLISTS TOOLBAR COMPACT QR/SHARE ICON
test('DEV5C_QA_5: Main Gig Setlists toolbar Share Setlist button is a compact QR icon button', () => {
  const html = renderToString(
    React.createElement(SongbookHomeView, {
      songs: [sampleCompleteSong],
      activeSongIndex: 0,
      onSelectSong: () => {},
      onNewSong: () => {},
      onOpenSetlists: () => {},
      onOpenSongbook: () => {},
      onDeleteSong: () => {},
      setlists: sampleSetlists,
      onSongMembershipChange: () => {},
      onCreateSetlistForSong: () => {},
    })
  )

  assert.ok(html.includes('data-testid="main-share-setlist-btn"'), 'Main share setlist button preserved')
  assert.ok(html.includes('aria-label="Share Setlist"'), 'Share setlist button has aria-label="Share Setlist"')
  assert.ok(!html.includes('<span>Share Setlist</span>'), 'Main toolbar share setlist button must NOT render text span')
})

// 5. DRAWER INITIAL TAB WIRE-UP IN APP.TSX
test('DEV5C_QA_APP_WIRING: App.tsx wires onOpenSetlists to setlists mode, onOpenSongbook to songbook mode, and passes initialTab', () => {
  const appSource = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')

  assert.ok(appSource.includes("drawerInitialTab, setDrawerInitialTab] = useState<'songbook' | 'setlists'>('setlists')"), 'App.tsx defines drawerInitialTab state')
  assert.ok(appSource.includes("setDrawerInitialTab('setlists')"), 'onOpenSetlists sets initialTab to setlists')
  assert.ok(appSource.includes("setDrawerInitialTab('songbook')"), 'onOpenSongbook sets initialTab to songbook')
  assert.ok(appSource.includes('initialTab={drawerInitialTab}'), 'SetlistDrawer receives initialTab')
})
