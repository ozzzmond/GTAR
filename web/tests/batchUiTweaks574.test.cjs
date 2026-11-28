// Batch UI Tweaks (#574): TV Sync in Advanced Tools, Fullscreen theme toggle,
// Sticky navigation headers, 42px control height standardization, Newest First setlist default sort,
// 3-column card grid, and header alignment consistency.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { JSDOM } = require('jsdom')

const webDir = path.resolve(__dirname, '..')
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) => {
    const raw = fs.readFileSync(filename, 'utf8')
      .replace(/import\.meta\.env/g, '({ DEV: true, VITE_CAST2_LOCAL_REVIEW: "true" })')
    const transpiled = ts.transpileModule(raw, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    })
    return module._compile(transpiled.outputText, filename)
  }
}

const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const read = file => fs.readFileSync(path.join(webDir, 'src', file), 'utf8')

test('1_TV_SYNC: TV Sync row in Advanced Tools with explicit ON/OFF toggle and dialog launcher', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://gtar.test/' })
  global.window = dom.window
  global.document = dom.window.document
  global.localStorage = dom.window.localStorage
  global.HTMLElement = dom.window.HTMLElement
  global.Node = dom.window.Node
  global.Event = dom.window.Event
  global.IS_REACT_ACT_ENVIRONMENT = true

  const { TvSyncRow } = require('../src/components/TvSyncRow.tsx')
  const { isTvSyncEnabled, setTvSyncEnabled } = require('../src/utils/tvSyncSettings.ts')

  // Default is OFF for new users / fresh settings
  assert.equal(isTvSyncEnabled(), false)

  let dialogOpened = false
  const root = createRoot(document.getElementById('root'))
  await act(async () => {
    root.render(React.createElement(TvSyncRow, {
      rowClass: 'min-h-11 px-3',
      onOpenDialog: () => { dialogOpened = true },
    }))
  })

  const toggle = document.querySelector('[data-testid="settings-tv-sync"]')
  assert.ok(toggle, 'TV Sync switch toggle exists')
  assert.equal(toggle.getAttribute('role'), 'switch')
  assert.equal(toggle.getAttribute('aria-checked'), 'false')

  // Clicking toggle turns TV Sync ON
  await act(async () => { toggle.click() })
  assert.equal(isTvSyncEnabled(), true)
  assert.equal(localStorage.getItem('gtar_tv_sync'), '1')

  // Clicking toggle again turns TV Sync OFF
  await act(async () => { toggle.click() })
  assert.equal(isTvSyncEnabled(), false)
  assert.equal(localStorage.getItem('gtar_tv_sync'), '0')

  // Clicking launcher opens dialog
  const launcher = document.querySelector('[data-testid="tv-sync-expand"]')
  assert.ok(launcher, 'TV Sync launcher button exists')
  await act(async () => { launcher.click() })
  assert.equal(dialogOpened, true)

  // Verify Header contains TvSyncRow and TvPresentationModal wiring
  const headerSource = read('components/Header.tsx')
  assert.match(headerSource, /<TvSyncRow/, 'Header renders TvSyncRow')
  assert.match(headerSource, /advancedToolsDialog === 'tv-sync'/, 'Header handles tv-sync dialog')

  // Verify duplicate TV link is avoided in StageOptionsSheet
  const stageOptionsSource = read('components/StageOptionsSheet.tsx')
  assert.doesNotMatch(stageOptionsSource, /TV & Second Screen/, 'Duplicate Pair / Cast link removed from StageOptionsSheet')

  // Verify StageView conditionally renders Cast button based on tvSyncEnabled
  const stageViewSource = read('components/StageView.tsx')
  assert.match(stageViewSource, /useTvSyncEnabled/, 'StageView observes tvSyncEnabled')
  assert.match(stageViewSource, /tvSyncEnabled &&[\s\S]*?handleTogglePresentation/, 'Cast button hidden when tvSyncEnabled is false')
  assert.match(stageViewSource, /!tvSyncEnabled && isCastActive[\s\S]*?stopPresentation/, 'StageView cleans up presentation when TV Sync disabled')

  // Verify TvPresentationOptions observes tvSyncEnabled
  const tvOptionsSource = read('components/TvPresentationOptions.tsx')
  assert.match(tvOptionsSource, /!cast2LocalEnabled \|\| !tvSyncEnabled/, 'TvPresentationOptions hidden when tvSyncEnabled is false')

  await act(async () => root.unmount())
})

test('2_FULLSCREEN_THEME: Dark/Light mode toggle inside fullscreen options beside transpose key control', async () => {
  const stageViewSource = read('components/StageView.tsx')
  assert.match(
    stageViewSource,
    /data-testid="stage-fullscreen-theme-mode-toggle"[\s\S]*?Key Chip/,
    'Theme toggle is positioned adjacent to transpose key controls in fullscreen options'
  )
  assert.match(stageViewSource, /onToggleThemeMode/, 'StageView handles theme mode toggle')
  assert.match(stageViewSource, /Moon/, 'Renders Moon icon for dark transition')
  assert.match(stageViewSource, /Sun/, 'Renders Sun icon for light transition')

  const appSource = read('App.tsx')
  assert.match(appSource, /onToggleThemeMode=\{handleToggleThemeMode\}/, 'App passes theme toggle to StageView')
})

test('3_STICKY_HEADERS: Music Explorer and second-row headers are sticky with z-index hierarchy', () => {
  const cssSource = read('index.css')
  assert.match(cssSource, /--app-header-height:\s*61px;/, 'CSS defines --app-header-height token')

  const explorerSource = read('components/ExplorerNavigation.tsx')
  assert.match(explorerSource, /sticky top-\[var\(--app-header-height[^\]]*\)\] z-20/, 'Music Explorer sidebar is sticky at z-20')

  const songbookSource = read('components/SongbookHomeView.tsx')
  assert.match(songbookSource, /data-testid="songbook-filter-bar"[\s\S]*?sticky top-\[var\(--app-header-height[^\]]*\)\] z-30/, 'Songbook filter bar is sticky at z-30')

  const setlistSource = read('components/SetlistWorkspace.tsx')
  assert.match(setlistSource, /data-testid="setlist-filter-bar"[\s\S]*?sticky top-\[var\(--app-header-height[^\]]*\)\] z-30/, 'Setlist filter bar is sticky at z-30')

  const headerSource = read('components/Header.tsx')
  assert.match(headerSource, /sticky top-0 z-40/, 'Global Header is sticky at z-40')
  assert.match(headerSource, /--app-header-height/, 'Header updates --app-header-height dynamically')
})

test('4_CONTROL_HEIGHT: Manage is 44px and rounded-xl on mobile, breadcrumb stays 42px', () => {
  const songbookSource = read('components/SongbookHomeView.tsx')
  assert.match(
    songbookSource,
    /data-testid="songs-manage-btn"[\s\S]{0,500}?className="[^"]*\bmin-h-11 h-11\b[^"]*\brounded-xl\b/,
    'Manage button is 44px (min-h-11 h-11) and rounded-xl'
  )
  assert.match(
    songbookSource,
    /aria-label="Breadcrumb"[\s\S]*?min-h-\[42px\] h-\[42px\]/,
    'Songbook breadcrumb navigation standardized to 42px'
  )

  const setlistSource = read('components/SetlistWorkspace.tsx')
  assert.match(
    setlistSource,
    /aria-label="Breadcrumb"[\s\S]*?min-h-\[42px\] h-\[42px\]/,
    'Setlist breadcrumb navigation standardized to 42px'
  )
  assert.match(
    setlistSource,
    /crumbButton = 'min-h-\[42px\] h-\[42px\]/,
    'Setlist crumb button standardized to 42px'
  )

  const explorerNavSource = read('components/MusicExplorerNav.tsx')
  assert.match(
    explorerNavSource,
    /itemBase =[\s\S]*?min-h-\[42px\] h-\[42px\]/,
    'Music Explorer navigation items standardized to 42px'
  )

  const folderTreeSource = read('components/ExplorerFolderTree.tsx')
  assert.match(
    folderTreeSource,
    /min-h-\[42px\] h-\[42px\] min-w-0 flex-1/,
    'Music Explorer folder tree items standardized to 42px'
  )

  const keyPickerSource = read('components/KeyPickerModal.tsx')
  assert.match(
    keyPickerSource,
    /h-\[42px\] min-h-\[42px\] px-3 py-1\.5 rounded-xl border flex items-center justify-between/,
    'Transpose key option buttons standardized to 42px'
  )
  assert.match(
    keyPickerSource,
    /h-\[42px\] min-h-\[42px\] px-4 rounded-lg bg-app-surface text-app-heading/,
    'KeyPickerModal close button standardized to 42px'
  )

  const castCssSource = read('components/StageCast2Panel.css')
  assert.match(
    castCssSource,
    /\.cast2 button, \.cast2 input, \.cast2 summary\s*\{[^}]*min-height:\s*42px;/,
    'TV cast controls standardized to 42px'
  )

  const editorSource = read('components/DesktopEditor.tsx')
  assert.match(
    editorSource,
    /className="ui-button min-h-11 sm:h-9 sm:min-h-9 max-sm:min-w-11 px-2\.5 rounded-xl sm:rounded-lg border text-xs font-semibold[^"]*"\s+aria-label="Return to Stage View"\s*>\s*<ArrowLeft className="w-5 h-5 sm:w-4 sm:h-4 shrink-0"/,
    'Editor Back uses a 44px minimum target and 20px icon on mobile, retaining its compact styling from sm'
  )
  assert.match(
    editorSource,
    /useState<'code' \| 'raw'>\([\s\S]*?return 'raw'/,
    'Editor opens in RAW mode by default'
  )

  const stageViewSource = read('components/StageView.tsx')
  assert.match(
    stageViewSource,
    /<StagePreviewHelp \/>\s*\{?\/\*.*?\*\/\}?\s*<button[^>]*onClick=\{toggleFullscreen\}/,
    'Help icon sits immediately to the left of the Fullscreen button'
  )
})

test('5_SETLIST_SORT: All Setlists defaults to Newest First with creation timestamp sorting and persistence', () => {
  const songbookSource = read('components/SongbookHomeView.tsx')
  assert.match(songbookSource, /gtar_setlist_sort/, 'Setlist sort preference is persisted')
  assert.match(songbookSource, /return 'newest'/, 'Default sort is newest')
  assert.match(songbookSource, /effectiveSetlistSortBy === 'newest'[\s\S]*?b\.sl\.createdAt/, 'Sorts using creation timestamp')
})

test('6_THREE_COLUMN_GRID: All Songs and All Setlists card grids standardized to 3-col desktop, 2-col tablet, 1-col mobile', () => {
  const songbookSource = read('components/SongbookHomeView.tsx')
  assert.match(
    songbookSource,
    /data-testid="song-grid"[\s\S]*?grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-3\.5/,
    'All Songs grid uses 3-column desktop and responsive 2/1 columns'
  )

  const setlistSource = read('components/SetlistWorkspace.tsx')
  assert.match(
    setlistSource,
    /grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-3\.5/,
    'All Setlists grid uses 3-column desktop and responsive 2/1 columns'
  )
})

test('7_HEADER_ALIGNMENT: Standardized scrollbar gutter and second-row header horizontal padding', () => {
  const cssSource = read('index.css')
  assert.match(cssSource, /html[\s\S]*?scrollbar-gutter:\s*stable;/, 'html uses scrollbar-gutter: stable')
  assert.match(cssSource, /\[data-testid="songbook-canvas"\][\s\S]*?scrollbar-gutter:\s*stable;/, 'canvas uses scrollbar-gutter: stable')

  const songbookSource = read('components/SongbookHomeView.tsx')
  assert.match(songbookSource, /data-testid="songbook-filter-bar"[\s\S]*?px-4 sm:px-6 py-1/, 'Songbook filter bar padding matches px-4 sm:px-6')

  const setlistSource = read('components/SetlistWorkspace.tsx')
  assert.match(setlistSource, /data-testid="setlist-filter-bar"[\s\S]*?px-4 sm:px-6 py-1/, 'Setlist filter bar padding matches px-4 sm:px-6')
})
