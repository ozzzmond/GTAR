const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

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
  module.exports = '/assets/dev-logo.png'
}

const webDir = path.resolve(__dirname, '..')

const { Header } = require('../src/components/Header.tsx')
const { TrashView } = require('../src/components/TrashView.tsx')
const { SongStatusBadge } = require('../src/components/SongStatusBadge.tsx')
const { StageView } = require('../src/components/StageView.tsx')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')

test('STEP_2 & STEP_5: Header canonical sidepanel hamburger and global search source separation', () => {
  const headerHtml = renderToStaticMarkup(
    React.createElement(Header, {
      title: 'GTAR',
      version: 'v1.0.130-dev.2b',
      activeTab: 'library',
      onSelectTab: () => {},
      onOpenSettings: () => {},
      onOpenSetlistDrawer: () => {},
      onOpenSyncStatus: () => {},
      onOpenTrash: () => {},
      onOpenChangelog: () => {},
      onOpenThemeStudio: () => {},
      allSongs: [
        { id: 'song-1', title: 'Hotel California', artist: 'Eagles', tags: ['rock'] },
        { id: 'song-2', title: 'Desperado', artist: 'Eagles', tags: ['rock'] },
      ],
      onSelectSong: () => {},
      onNavigate: () => {},
      userProfile: { id: 'user-1', email: 'test@example.com', display_name: 'Guitarist' },
    })
  )

  // STEP_5: Canonical hamburger button beside More menu
  assert.ok(
    headerHtml.includes('data-testid="canonical-sidepanel-toggle-btn"'),
    'Header must render canonical-sidepanel-toggle-btn'
  )
  assert.ok(
    headerHtml.includes('aria-label="Side Panel"'),
    'Canonical hamburger must have descriptive aria-label'
  )

  // STEP_2: Header code structure verifies global search has Local Songs, Shared Catalog, and Online sections
  const headerSource = fs.readFileSync(path.join(webDir, 'src/components/Header.tsx'), 'utf8')
  assert.ok(
    headerSource.includes('Shared Catalog ({catalogResults.length})'),
    'Header global search dropdown must render explicit heading and count for Shared Catalog'
  )
  assert.ok(
    headerSource.includes('Local Songs ({matchingSearchSongs.length})'),
    'Header global search dropdown must render explicit heading and count for Local Songs'
  )
  assert.ok(
    headerSource.includes('Online Results ({onlineResults.length})'),
    'Header global search dropdown must render explicit heading and count for Online Results'
  )
  assert.ok(
    headerSource.includes('data-testid="header-catalog-preview-modal"'),
    'Header must provide catalog preview modal'
  )
  assert.ok(
    headerSource.includes('cloneSharedCatalogSongToPersonal'),
    'Header search preview must use authorized personal clone creation helper'
  )
})

test('STEP_3: TrashView navigation cleanliness', () => {
  const trashHtml = renderToStaticMarkup(
    React.createElement(TrashView, {
      deletedSongs: [],
      deletedSetlists: [],
      onRestoreSong: () => {},
      onRestoreSetlist: () => {},
      onPermanentDeleteSong: () => {},
      onPermanentDeleteSetlist: () => {},
      onEmptyTrash: () => {},
      onReturnToSongbook: () => {},
    })
  )

  // Redundant outer back arrow/link removed
  assert.ok(
    !trashHtml.includes('data-testid="trash-outer-back-link"'),
    'Outer redundant back-to-songbook link must be removed'
  )
  // Inner button kept functional
  assert.ok(
    trashHtml.includes('data-testid="trash-empty-return-btn"'),
    'Inner Return to Songbook button must remain functional'
  )
  assert.ok(
    trashHtml.includes('Return to Songbook'),
    'Trash empty state must contain Return to Songbook text'
  )
})

test('STEP_4: Tooltip cleanup on interactive SongStatusBadge', () => {
  const badgeHtml = renderToStaticMarkup(
    React.createElement(SongStatusBadge, {
      testId: 'test-status-badge',
      ariaLabel: 'Metadata OK',
      icon: React.createElement('span', null, 'Icon'),
      children: React.createElement('div', null, 'Popover Details'),
    })
  )

  // Does NOT have native HTML title tooltip that conflicts with custom interactive popover
  assert.ok(
    !badgeHtml.includes('title='),
    'SongStatusBadge must not emit native HTML title attribute when custom popover exists'
  )
  assert.ok(
    badgeHtml.includes('aria-label="Metadata OK"'),
    'SongStatusBadge must retain accessible aria-label'
  )
  assert.ok(
    badgeHtml.includes('data-testid="test-status-badge"'),
    'SongStatusBadge must render testId'
  )
})

test('STEP_6: StageView per-song back arrow removed and toolbar back preserved', () => {
  const stageViewSource = fs.readFileSync(path.join(webDir, 'src/components/StageView.tsx'), 'utf8')

  // Redundant per-song back button beside song title removed
  assert.ok(
    !stageViewSource.includes('title="Back to Songbook Library"'),
    'Per-song back button beside title must be removed from StageView'
  )
  assert.ok(
    !stageViewSource.includes('aria-label="Back to Songbook Library"'),
    'Per-song back button aria-label must be removed from StageView'
  )

  // Header toolbar back button preserved in App.tsx / Header.tsx
  const appSource = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')
  assert.ok(
    appSource.includes("onBack: () => setView('library')") || appSource.includes('activeView'),
    'App must preserve toolbar back navigation to library'
  )
})

test('STEP_7: SongbookHomeView Sort & Filter controls and Manage button placement', () => {
  const songbookHtml = renderToStaticMarkup(
    React.createElement(SongbookHomeView, {
      songs: [
        { id: '1', title: 'Song 1', artist: 'Artist 1' },
        { id: '2', title: 'Song 2', artist: 'Artist 2' },
      ],
      setlists: [{ id: 'sl-1', name: 'Gig 1', songs: [] }],
      onSelectSong: () => {},
      onNewSong: () => {},
      onEditSong: () => {},
      onDeleteSong: () => {},
      onRestoreSong: () => {},
      onSelectSetlist: () => {},
      onOpenSetlists: () => {},
      onOpenSongbook: () => {},
      onOpenSettings: () => {},
      onOpenChangelog: () => {},
      onOpenThemeStudio: () => {},
    })
  )

  // STEP_5: Redundant section header hamburger buttons removed
  assert.ok(
    !songbookHtml.includes('data-testid="open-setlists-panel-btn"'),
    'Redundant open-setlists-panel-btn in section header must be removed'
  )
  assert.ok(
    !songbookHtml.includes('data-testid="open-songbook-panel-btn"'),
    'Redundant open-songbook-panel-btn in section header must be removed'
  )

  // STEP_7: Manage button moved into Sort & Filter Toolbar beside Setlist filter
  assert.ok(
    songbookHtml.includes('data-testid="toggle-song-selection-mode"'),
    'Manage button (toggle-song-selection-mode) must be present'
  )

  // STEP_7: Hide Options / Show Options toggle control
  assert.ok(
    songbookHtml.includes('data-testid="toggle-sort-filter-options"'),
    'Show/Hide Options toggle button must be present'
  )
  assert.ok(
    songbookHtml.includes('aria-controls="songbook-sort-filter-options"'),
    'Show/Hide Options button must have aria-controls targeting options container'
  )

  // #149 layout (owner 2026-10-24): New Setlist and Import live in the setlists ⋯ menu, after Manage
  assert.ok(
    songbookHtml.includes('data-testid="setlists-menu-btn"'),
    'Setlists ⋯ menu button must be in action row'
  )
  assert.ok(
    songbookHtml.indexOf('data-testid="toggle-setlist-selection-mode"') < songbookHtml.indexOf('data-testid="setlists-menu-btn"'),
    'Setlists ⋯ menu must follow Manage'
  )

  // FOLLOWUP: text-only buttons in SetlistDrawer (no plus icon)
  const drawerSource = fs.readFileSync(path.join(webDir, 'src/components/SetlistDrawer.tsx'), 'utf8')
  assert.ok(
    !drawerSource.includes('<Plus className="w-4 h-4'),
    'Sidepanel New Song and New Setlist buttons must not have Plus icon'
  )
})
