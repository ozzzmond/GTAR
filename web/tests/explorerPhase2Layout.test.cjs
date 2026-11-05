// #319: GTAR1 layout port — sidebar collapse/grip/resize, one-row header with moved actions,
// GTAR1 search dropdown and the Explorer-driven Songbook view.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:true})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }
).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
const bootDom = new JSDOM('<!doctype html>', { url: 'http://localhost' })
Object.assign(global, { window: bootDom.window, document: bootDom.window.document })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const noop = () => {}
async function ui(run, width = 1280) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  const keys = ['window', 'document', 'Node', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']
  const previousNavigator = Object.getOwnPropertyDescriptor(global, 'navigator')
  const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
  Object.assign(global, { window: dom.window, document: dom.window.document, Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
  window.innerWidth = width
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.requestAnimationFrame = fn => setTimeout(fn, 0)
  const root = createRoot(document.getElementById('root'))
  const $ = sel => document.querySelector(sel)
  const click = async node => { assert.ok(node, 'control exists'); await act(async () => node.click()) }
  const render = async (component, props) => act(async () => root.render(React.createElement(component, props)))
  const key = async (node, k) => act(async () => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true })))
  try { await run({ root, $, click, render, key }) }
  finally {
    await act(async () => root.unmount()); dom.window.close(); Object.assign(global, previous)
    if (previousNavigator) Object.defineProperty(global, 'navigator', previousNavigator)
  }
}

test('sidebar: drag edge resizes by keyboard with min/max clamp, width and collapse persist per device', async () => ui(async ({ root, $, click, render, key }) => {
  const { ExplorerNavigation } = require('../src/components/ExplorerNavigation.tsx')
  const { EXPLORER_MIN_WIDTH, EXPLORER_MAX_WIDTH } = require('../src/utils/explorerSidebar.ts')
  const props = { songs: [], setlists: [], currentSelection: { type: 'ALL_SONGS' }, onSelect: noop,
    onNewSong: noop, onNewSetlist: noop, isOpen: false, onClose: noop }
  await render(ExplorerNavigation, props)
  const handle = () => $('[data-testid="explorer-resize-handle"]')
  assert.equal(handle().getAttribute('role'), 'separator')
  assert.equal(handle().tabIndex, 0, 'resize handle is keyboard reachable')
  assert.match($('[data-testid="explorer-sidebar"]').className, /w-64 lg:w-72/, 'GTAR1 default widths before any resize')
  await key(handle(), 'ArrowRight')
  assert.equal($('[data-testid="explorer-sidebar"]').style.width, '304px')
  assert.equal(localStorage.getItem('gtar_explorer_width'), '304')
  await key(handle(), 'End')
  assert.equal($('[data-testid="explorer-sidebar"]').style.width, `${EXPLORER_MAX_WIDTH}px`)
  await key(handle(), 'ArrowRight')
  assert.equal($('[data-testid="explorer-sidebar"]').style.width, `${EXPLORER_MAX_WIDTH}px`, 'max clamp')
  await key(handle(), 'Home')
  assert.equal(handle().getAttribute('aria-valuenow'), String(EXPLORER_MIN_WIDTH), 'min clamp')
  localStorage.setItem('gtar_explorer_width', '9999')
  await act(async () => root.render(null))
  await render(ExplorerNavigation, props)
  assert.equal($('[data-testid="explorer-sidebar"]').style.width, `${EXPLORER_MAX_WIDTH}px`, 'stored width is clamped on read')

  // Collapse leaves only the left-edge grip; the grip reopens the sidebar and focus moves back.
  await click($('[data-testid="explorer-collapse"]'))
  assert.equal($('[data-testid="explorer-sidebar"]').dataset.collapsed, 'true')
  const grip = $('[data-testid="explorer-edge-grip"]')
  assert.equal(grip.getAttribute('aria-label'), 'Show Music Explorer')
  assert.equal(document.activeElement, grip, 'focus follows to the grip')
  assert.equal(localStorage.getItem('gtar_explorer_collapsed'), 'true')
  await act(async () => root.render(null))
  await render(ExplorerNavigation, props)
  assert.ok($('[data-testid="explorer-edge-grip"]'), 'collapsed state is remembered')
  const setItem = window.Storage.prototype.setItem
  window.Storage.prototype.setItem = () => { throw new Error('blocked') }
  try { await click($('[data-testid="explorer-edge-grip"]')) } finally { window.Storage.prototype.setItem = setItem }
  assert.equal($('[data-testid="explorer-sidebar"]').dataset.collapsed, 'false', 'blocked storage never blocks the toggle')
  assert.equal(document.activeElement, $('[data-testid="explorer-collapse"]'))
  assert.equal($('[data-testid="explorer-collapse"]').getAttribute('aria-label'), 'Hide Music Explorer')
  assert.equal($('[data-testid="explorer-nav-browse-sources"]'), null, 'Browse Sources left the Explorer')
}))

function headerProps(calls, extra = {}) {
  const log = name => () => calls.push(name)
  return { activeView: 'songbook', onViewChange: view => calls.push(`view:${view}`), song: { id: 'one', title: 'One', rawContent: '' },
    searchQuery: '', onSearchQueryChange: noop, onOpenWebsiteUrlSource: log('sources'), onOpenStageTools: log('band-sync'),
    onToggleTheme: log('theme'), onOpenStageSettings: log('stage-settings'), onOpenImportModal: log('import'),
    onOpenCast: log('cast'), onNewSong: log('new-song'), onOpenSection: section => calls.push(`section:${section}`),
    activeSection: 'songs', deletedSongsCount: 2, ...extra }
}

test('header: actions relocated per #359 (Theme/Trash/More removed, Theme/Sources/Trash/Install in Profile)', async () => ui(async ({ $, click, render }) => {
  const { Header } = require('../src/components/Header.tsx')
  const calls = []
  await render(Header, headerProps(calls))
  assert.ok($('[data-testid="dev-header-diagnostics"]'), 'DEV deployment details stay next to the logo')
  assert.ok($('[data-testid="dev-header-diagnostics-compact"]'), 'compact DEV strip for phones')
  assert.ok($('[data-testid="header-cloud-sync-button"]'), 'cloud status button kept')

  // Theme, Trash, More removed from header bar (#359)
  assert.equal($('[aria-label="Theme"]'), null, 'no header Theme button (#359)')
  assert.equal($('[aria-label="Trash (2)"]'), null, 'no header Trash button (#359)')
  assert.equal($('[aria-label="More"]'), null, 'no header More button (#359)')
  assert.equal($('[data-testid="header-new-song"]'), null, 'no header New Song button (#332)')
  assert.equal($('[data-testid="header-sources"]'), null, 'no header Sources button (#332)')
  assert.equal($('nav[aria-label="Main navigation"]'), null, 'no header Songbook/Setlists switcher (#332)')

  // Branding (#359)
  assert.ok($('button[aria-label="GTAR home"]'), 'GTAR home aria-label')
  assert.equal($('img[alt="GTAR Logo"]')?.getAttribute('alt'), 'GTAR Logo')

  // Avatar popover contains relocated items (#359)
  await click($('[data-testid="header-avatar"]'))
  assert.ok($('[data-testid="profile-theme-button"]'), 'Theme in Profile popover')
  assert.ok($('[data-testid="profile-web-sources"]'), 'Web Sources in Profile popover')
  assert.ok($('[data-testid="profile-trash-button"]'), 'Trash in Profile popover')

  // Theme item triggers onToggleTheme
  await click($('[data-testid="profile-theme-button"]'))
  assert.deepEqual(calls, ['theme'])

  // Web Sources item triggers onOpenWebsiteUrlSource
  await click($('[data-testid="header-avatar"]'))
  await click($('[data-testid="profile-web-sources"]'))
  assert.deepEqual(calls, ['theme', 'sources'])

  // Trash item triggers onViewChange('trash')
  await click($('[data-testid="header-avatar"]'))
  await click($('[data-testid="profile-trash-button"]'))
  assert.deepEqual(calls, ['theme', 'sources', 'view:trash'])

  // Esc closes avatar popover
  await click($('[data-testid="header-avatar"]'))
  assert.ok($('[data-testid="profile-theme-button"]'))
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  assert.equal($('[data-testid="profile-theme-button"]'), null, 'Esc closes avatar popover')

  for (const button of document.querySelectorAll('header button')) {
    assert.doesNotMatch(button.className, /\[#|(bg|text|border)-(red|blue|green|amber|sky|slate|gray)-\d/, 'theme tokens only')
  }
}))

test('header compact: search takes over the row with Sources and Cancel; GTAR1 result rows', async () => ui(async ({ $, click, render }) => {
  const { Header } = require('../src/components/Header.tsx')
  const calls = []
  let query = ''
  const props = () => headerProps(calls, { searchQuery: query, onSearchQueryChange: next => { query = next },
    allSongs: [{ id: 'a', title: 'Blue Moon', artist: 'Rodgers', rawContent: '' }],
    setlists: [{ id: 's', name: 'Moon Gig', songs: [] }], onSelectSearchSong: idx => calls.push(`song:${idx}`) })
  await render(Header, props())
  assert.equal($('[data-testid="header-sources"]'), null, 'phone header keeps Sources inside search')
  await click($('[aria-label="Open search"]'))
  query = 'moon'
  await render(Header, props())
  await act(async () => document.getElementById('search-input').focus())
  const results = $('[data-testid="global-search-results"]')
  assert.ok(results, 'dropdown opens for a query')
  assert.match(results.querySelector('[role="status"]').textContent, /2 local matches · Songs and setlists/)
  assert.deepEqual([...results.querySelectorAll('h2')].map(h => h.textContent).slice(0, 2), ['Songs', 'Setlists'], 'local groups first; remote groups show a spinner while searching')
  for (const row of results.querySelectorAll('button')) assert.match(row.className, /min-h-11/)
  await click([...results.querySelectorAll('button')].find(b => b.textContent.includes('Blue Moon')))
  assert.deepEqual(calls.slice(-2), ['song:0', 'view:stage'])
  assert.equal(document.getElementById('search-input'), null, 'choosing a result closes the overlay')
  await click($('[aria-label="Open search"]'))
  assert.equal($('[aria-label="Browse Song Sources"]'), null, 'Sources removed from search overlay (#332)')
  await click($('[aria-label="Cancel search"]'))
  assert.equal(query, '', 'Cancel clears the query')
  assert.equal(document.getElementById('search-input'), null)
}, 360))

test('SearchResults: catalog and online rows open the preview (one primary action), groups cap at 8', async () => ui(async ({ $, click, render }) => {
  const { SearchResults } = require('../src/components/SearchResults.tsx')
  const seen = []
  const songs = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, title: `Song ${i}`, artist: 'A', rawContent: '', originalIdx: i }))
  await render(SearchResults, { songs, setlists: [], catalog: [{ id: 'c1', title: 'Shared Tune', artist: 'B', key: 'G' }],
    online: [{ id: 'o1', songName: 'Web Tune', artistName: 'C' }], onSelectSong: noop, onSelectSetlist: noop,
    onPreviewCatalog: item => seen.push(item.id), onPreviewOnline: item => seen.push(item.id), onOpenImport: noop, onOpenSources: noop })
  assert.equal([...document.querySelectorAll('button')].filter(b => /^Song \d/.test(b.textContent)).length, 8)
  assert.match(document.body.textContent, /Showing up to 8 of each/)
  await click($('[aria-label="Preview Shared Tune from Shared Catalog"]'))
  await click($('[aria-label="Preview Web Tune online chords"]'))
  assert.deepEqual(seen, ['c1', 'o1'])
  assert.match(document.body.textContent, /Browse external song sources/)
  assert.doesNotMatch(document.body.textContent, /Import$|Importing/)
}))

test('Songbook view: breadcrumb per Explorer target, card Edit Chart, Shared Catalog target, full-width canvas', async () => ui(async ({ $, click, render }) => {
  const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
  const calls = []
  const props = { songs: [{ id: 'a', title: 'Amazing Grace', artist: 'Newton', tags: ['hymn'], rawContent: '' }], setlists: [], activeSongIndex: 0,
    onSelectSong: noop, onNewSong: noop, onOpenSetlists: noop, onDeleteSong: noop, onSongMembershipChange: noop, onCreateSetlistForSong: noop,
    onSelectView: target => calls.push(target), onEditSong: idx => calls.push(`edit:${idx}`), view: { type: 'TAG', tag: 'hymn' } }
  await render(SongbookHomeView, props)
  const crumbs = () => [...document.querySelectorAll('nav[aria-label="Breadcrumb"] button, nav[aria-label="Breadcrumb"] span[aria-current], nav[aria-label="Breadcrumb"] > span')].map(el => el.textContent)
  assert.deepEqual(crumbs(), ['Songbook', 'Tags', '#hymn'])
  assert.match(document.body.textContent, /Songs tagged #hymn/)
  assert.equal($('[data-testid^="tab-"]'), null, 'no Songbook & Gig Library tabs')
  assert.doesNotMatch(document.body.textContent, /Songbook & Gig Library|Song Setlists/)
  const canvas = $('[data-testid="songbook-canvas"]')
  assert.doesNotMatch(canvas.className, /max-w-7xl|mx-auto/, 'canvas fills the workspace (no empty band)')
  assert.match(canvas.className, /w-full/)
  await click($('[data-testid="song-menu-0"]'))
  await click($('[data-testid="menu-edit-song-0"]'))
  await click($('[data-testid="song-tag-0-hymn"]'))
  await click([...document.querySelectorAll('nav[aria-label="Breadcrumb"] button')].find(b => b.textContent === 'Songbook'))
  assert.deepEqual(calls, ['edit:0', { type: 'TAG', tag: 'hymn' }, { type: 'ALL_SONGS' }])
  await render(SongbookHomeView, { ...props, view: { type: 'SHARED_CATALOG' } })
  assert.deepEqual(crumbs(), ['Songbook', 'Shared Catalog'])
  assert.equal($('[data-testid="song-grid"]'), null, 'Shared Catalog target replaces the song grid')
}))

test('App wiring: Explorer selection drives the view; no tab state; header gets New Song and the section switcher', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  assert.match(app, /view=\{explorerSelection\}/)
  assert.doesNotMatch(app, /songbookTab|setSongbookTag|activeTab=\{/)
  assert.match(app, /onNewSong=\{\(\) => navigateSafely\(handleNewSong\)\}/)
  assert.match(app, /onOpenSection=\{/)
  assert.doesNotMatch(app, /onOpenSources=\{\(\) => navigateSafely\(\(\) => setIsWebsiteUrlModalOpen\(true\)\)\} \/>/, 'Explorer has no Sources entry')
})

test('#359: desktop Songbook 2nd row (songbook-filter-bar) stays visible when Explorer is collapsed, toggle uses Chevrons and >=44px touch target, and slide motion respects reduced-motion', async () => ui(async ({ $, click, render }) => {
  const { ExplorerNavigation } = require('../src/components/ExplorerNavigation.tsx')
  const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
  const songs = [{ id: 's1', title: 'Song 1', artist: 'Artist 1', tags: ['worship'], rawContent: '' }]
  const setlists = [{ id: 'sl1', name: 'Sunday Service', songs: [] }]
  let currentSelection = { type: 'ALL_SONGS' }

  const Harness = () => {
    return React.createElement('div', { className: 'flex flex-1 min-h-0' },
      React.createElement(ExplorerNavigation, {
        songs,
        setlists,
        currentSelection,
        onSelect: (target) => { currentSelection = target },
        isOpen: false,
        onClose: noop,
      }),
      React.createElement('main', { className: 'flex-1 min-w-0 flex overflow-hidden' },
        React.createElement(SongbookHomeView, {
          songs,
          setlists,
          view: currentSelection,
          onSelectView: (target) => { currentSelection = target },
          searchQuery: '',
          onSearchQueryChange: noop,
          activeSongIndex: 0,
          onSelectSong: noop,
          onSongMembershipChange: noop,
          onCreateSetlistForSong: noop,
          onNewSong: noop,
          onNewSetlist: noop,
          onOpenSetlists: noop,
          onOpenSongbook: noop,
          onManageSetlist: noop,
          onOpenSetlistManager: noop,
          onDeleteSong: noop,
          onDeleteSetlist: noop,
          onSelectSetlistSong: noop,
          onImportSingleSetlist: noop,
          onOpenImportSongs: noop,
          onBulkDeleteSongs: noop,
          onBulkAddSongsToSetlist: noop,
        })
      )
    )
  }

  // Track focus calls to verify preventScroll: true (#359)
  const focusCalls = []
  const originalFocus = window.HTMLElement.prototype.focus
  window.HTMLElement.prototype.focus = function (options) {
    focusCalls.push({ element: this, options })
    return originalFocus ? originalFocus.call(this, options) : undefined
  }

  try {
    await render(Harness, {})

    // 1. Initial expanded state: Explorer open, collapse button clear with >=44px target and aria
    const sidebar = $('[data-testid="explorer-sidebar"]')
    assert.ok(sidebar, 'sidebar initially mounted')
    assert.equal(sidebar.dataset.collapsed, 'false')
    assert.match(sidebar.className, /transition-\[width,opacity\] duration-200 ease-out motion-reduce:transition-none/)

    const collapseBtn = $('[data-testid="explorer-collapse"]')
    assert.ok(collapseBtn, 'collapse toggle exists in sidebar header')
    assert.equal(collapseBtn.getAttribute('aria-label'), 'Hide Music Explorer')
    assert.equal(collapseBtn.getAttribute('aria-expanded'), 'true')
    assert.match(collapseBtn.className, /min-h-11 min-w-11/, '>=44px touch target')
    assert.ok(collapseBtn.querySelector('svg'), 'chevron icon present')

    // Songbook 2nd row (filter bar) is visible with all controls
    const filterBar = $('[data-testid="songbook-filter-bar"]')
    assert.ok(filterBar, 'Songbook 2nd row visible when Explorer is open')
    assert.match(filterBar.textContent, /Songbook[\s\S]*All Songs/, 'breadcrumb Songbook > All Songs')
    assert.ok($('[data-testid="filter-metadata-select"]'), 'Metadata filter')
    assert.ok($('[data-testid="filter-setlist-select"]'), 'Setlists filter')
    assert.ok($('[data-testid="filter-tags-select"]'), 'Tags filter')
    assert.ok($('[data-testid="sort-title"]'), 'Title sort')
    assert.ok($('[data-testid="toggle-song-selection-mode"]'), 'Select button')
    assert.ok($('[data-testid="songs-library-menu-btn"]'), '... menu button')

    // 2. Collapse Music Explorer
    await click(collapseBtn)

    // Sidebar transitions to collapsed (w-0, opacity-0, aria-hidden, data-collapsed="true", inert)
    assert.equal(sidebar.dataset.collapsed, 'true')
    assert.equal(sidebar.getAttribute('aria-hidden'), 'true')
    assert.ok(sidebar.hasAttribute('inert'), 'collapsed sidebar is inert to prevent tab-focus on hidden children (#359)')
    assert.match(sidebar.className, /w-0 border-r-0 opacity-0 pointer-events-none/)

    // Show Music Explorer toggle is rendered on the left border
    const edgeGrip = $('[data-testid="explorer-edge-grip"]')
    assert.ok(edgeGrip, 'Show Music Explorer toggle exists when collapsed')
    assert.equal(edgeGrip.getAttribute('aria-label'), 'Show Music Explorer')
    assert.equal(edgeGrip.getAttribute('aria-expanded'), 'false')
    assert.match(edgeGrip.className, /w-6 /, 'expand control keeps its own 24px strip inside the layout')
    assert.match(edgeGrip.querySelector('span').className, /h-11 w-6/, '24x44 target (WCAG 2.2 AA) without an overhang under main')
    assert.ok(edgeGrip.querySelector('svg'), 'chevron right icon present')

    // Regression check (#359): focus restored to edge grip with preventScroll: true
    const gripFocus = focusCalls.find(c => c.element === edgeGrip)
    assert.ok(gripFocus, 'focus restored to edge grip on collapse')
    assert.equal(gripFocus.options?.preventScroll, true, 'edge grip focus passed { preventScroll: true }')

    // Songbook 2nd row (filter bar) REMAINS VISIBLE when Explorer is hidden
    const filterBarAfterCollapse = $('[data-testid="songbook-filter-bar"]')
    assert.ok(filterBarAfterCollapse, 'Songbook 2nd row stays visible when Explorer is collapsed')
    assert.match(filterBarAfterCollapse.textContent, /Songbook[\s\S]*All Songs/)
    assert.ok($('[data-testid="filter-metadata-select"]'))
    assert.ok($('[data-testid="filter-setlist-select"]'))
    assert.ok($('[data-testid="filter-tags-select"]'))
    assert.ok($('[data-testid="sort-title"]'))
    assert.ok($('[data-testid="toggle-song-selection-mode"]'))
    assert.ok($('[data-testid="songs-library-menu-btn"]'))

    // 3. Re-expand Music Explorer via edge toggle
    await click(edgeGrip)
    assert.equal(sidebar.dataset.collapsed, 'false')
    assert.equal(sidebar.hasAttribute('inert'), false, 'expanded sidebar is not inert')
    assert.equal($('[data-testid="explorer-edge-grip"]'), null)
    assert.ok($('[data-testid="songbook-filter-bar"]'), 'filter bar stays visible after re-expanding')

    // Regression check (#359): focus restored to collapse button with preventScroll: true
    const collapseFocus = focusCalls.find(c => c.element === $('[data-testid="explorer-collapse"]'))
    assert.ok(collapseFocus, 'focus restored to collapse button on expand')
    assert.equal(collapseFocus.options?.preventScroll, true, 'collapse button focus passed { preventScroll: true }')
  } finally {
    window.HTMLElement.prototype.focus = originalFocus
  }
}))

test('#359: focus restoration on Explorer collapse/expand explicitly specifies { preventScroll: true }', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/ExplorerNavigation.tsx'), 'utf8')
  assert.match(source, /gripRef\.current\?\.focus\(\{\s*preventScroll:\s*true\s*\}\)/)
  assert.match(source, /collapseRef\.current\?\.focus\(\{\s*preventScroll:\s*true\s*\}\)/)
})

test('#359 PR-C: Header icon-only status button and responsive layout across widths 360, 390, 768, 1024, 1440', async () => ui(async ({ $, render }) => {
  const { Header } = require('../src/components/Header.tsx')
  const widths = [360, 390, 768, 1024, 1440]

  for (const width of widths) {
    window.innerWidth = width
    await act(async () => window.dispatchEvent(new window.Event('resize')))
    await render(Header, headerProps([]))

    const hamburger = $('button[aria-label="Open Music Explorer"]')
    const logo = $('button[aria-label="GTAR home"]')
    const searchTrigger = $('button[aria-label="Open search"]')
    const searchInput = document.getElementById('search-input')
    const cloudBtn = $('[data-testid="header-cloud-sync-button"]')
    const avatar = $('[data-testid="header-avatar"]')
    const authDot = document.querySelector('.auth-dot')

    // Always present at all widths
    assert.ok(logo, `Logo must exist at ${width}px`)
    assert.ok(cloudBtn, `Cloud status button must exist at ${width}px`)
    assert.ok(avatar, `Avatar must exist at ${width}px`)
    assert.ok(authDot, `Avatar auth dot must exist at ${width}px`)

    // Cloud status button is strictly ICON-ONLY at ALL widths (no status label in textContent)
    assert.equal(cloudBtn.textContent.trim(), '', `Cloud status button must be icon-only at ${width}px`)
    assert.match(cloudBtn.className, /min-h-11 min-w-11/, `Cloud status button has >=44px target at ${width}px`)
    assert.ok(cloudBtn.querySelector('svg'), `Cloud status icon rendered at ${width}px`)
    assert.match(cloudBtn.getAttribute('aria-label'), /^Backup & Restore/, `aria-label preserved at ${width}px`)
    assert.match(cloudBtn.getAttribute('title'), /^Backup & Restore/, `title/tooltip preserved at ${width}px`)

    if (width < 768) {
      // Compact (<md) layout: hamburger left, logo, search icon, status icon, avatar
      assert.ok(hamburger, `Hamburger drawer button must exist at ${width}px`)
      assert.match(hamburger.className, /md:hidden/, `Hamburger hidden on >=md at ${width}px`)
      assert.match(hamburger.className, /min-h-11 min-w-11/, `Hamburger touch target >=44px at ${width}px`)

      assert.ok(searchTrigger, `Search icon trigger must be rendered at ${width}px`)
      assert.match(searchTrigger.className, /min-h-11 min-w-11/, `Search trigger touch target >=44px at ${width}px`)
      assert.equal(searchInput, null, `Inline search input should not be visible before open at ${width}px`)

      // Compact diagnostics strip remains visible
      assert.ok($('[data-testid="dev-header-diagnostics-compact"]'), `DEV compact diagnostics present at ${width}px`)
    } else {
      // Desktop / tablet (>=md) layout: inline search, no compact trigger
      assert.ok(searchInput, `Inline search input must be rendered at ${width}px`)
      assert.equal(searchTrigger, null, `Search icon trigger hidden at ${width}px`)
      assert.ok($('[data-testid="dev-header-diagnostics"]'), `DEV inline diagnostics present at ${width}px`)
    }
  }
}))

test('#359 PR-C: Cloud status button icon states, tooltips, and aria-labels are distinct and accurate', async () => ui(async ({ $, render }) => {
  const { SyncStatusPill } = require('../src/components/SyncStatusPill.tsx')
  const noop = () => {}

  // 1. Signed out
  await render(SyncStatusPill, { status: { state: 'signed-out', label: 'Not signed in' }, lastBackup: null, onClick: noop })
  let btn = $('[data-testid="header-cloud-sync-button"]')
  assert.equal(btn.dataset.status, 'signed-out')
  assert.ok(btn.querySelector('.lucide-ban'), 'signed-out renders ban icon')
  assert.match(btn.getAttribute('aria-label'), /Not signed in/)
  assert.match(btn.getAttribute('title'), /Not signed in/)
  assert.equal(btn.textContent.trim(), '', 'no text in signed-out state')

  // 2. Synced (backed-up)
  await render(SyncStatusPill, { status: { state: 'backed-up', label: 'Backed up' }, lastBackup: '2026-11-05T00:00:00Z', now: Date.parse('2026-11-05T01:00:00Z'), onClick: noop })
  btn = $('[data-testid="header-cloud-sync-button"]')
  assert.equal(btn.dataset.status, 'backed-up')
  assert.ok(btn.querySelector('.lucide-check'), 'backed-up renders check icon')
  assert.match(btn.getAttribute('aria-label'), /Backed up/)
  assert.match(btn.getAttribute('title'), /Backed up/)
  assert.equal(btn.textContent.trim(), '', 'no text in backed-up state')

  // 3. Not backed up (modified locally)
  await render(SyncStatusPill, { status: { state: 'not-backed-up', label: 'Not backed up' }, lastBackup: '2026-11-05T00:00:00Z', onClick: noop })
  btn = $('[data-testid="header-cloud-sync-button"]')
  assert.equal(btn.dataset.status, 'not-backed-up')
  assert.ok(btn.querySelector('.lucide-circle-alert'), 'not-backed-up renders alert icon')
  assert.match(btn.getAttribute('aria-label'), /Not backed up/)
  assert.match(btn.getAttribute('title'), /Not backed up/)
  assert.equal(btn.textContent.trim(), '', 'no text in not-backed-up state')
}))

test('#359 PR-C: All Header.tsx focus() calls specify { preventScroll: true }', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/Header.tsx'), 'utf8')
  const focusMatches = [...source.matchAll(/\.focus\((.*?)\)/g)]
  assert.ok(focusMatches.length > 0, 'Header must contain focus calls')
  for (const match of focusMatches) {
    assert.match(match[1], /preventScroll:\s*true/, `focus call must include preventScroll: true, got: ${match[0]}`)
  }
})

// #388 follow-up: the collapsed grip used to be a 12px strip with a 44px overhanging hit
// area. Main's z-20 stage top bar painted over the 12px overhang, so half the visible tab was
// clipped and the tab centre hit the stage bar. The strip now owns its full 24px width.
test('#388 follow-up: collapsed grip owns its width and the Explorer header cannot collide', () => {
  const explorer = fs.readFileSync(path.join(__dirname, '../src/components/ExplorerNavigation.tsx'), 'utf8')
  const gripStart = explorer.indexOf('data-testid="explorer-edge-grip"')
  assert.ok(gripStart > -1, 'edge grip exists')
  const grip = explorer.slice(gripStart, explorer.indexOf('</button>', gripStart))
  assert.match(grip, /className="group relative z-20 hidden md:flex w-6 /, 'grip reserves a 24px column')
  assert.doesNotMatch(grip, /min-w-11/, 'no hit area overhangs into main')

  const nav = fs.readFileSync(path.join(__dirname, '../src/components/MusicExplorerNav.tsx'), 'utf8')
  assert.match(nav, /flex min-w-0 items-center gap-1\.5/, 'songbook header right group can shrink')
  assert.match(nav, /min-w-0 truncate text-\[10px\] uppercase[\s\S]*?master song/, 'master-song count truncates instead of overlapping')
})

// #388: the Explorer nav was pinned to 288px inside the 256px md aside, so the right-aligned
// collapse control was clipped and its centre landed under the z-10 resize handle.
test('#388: Explorer nav fills the aside and the collapse control stacks above the resize handle', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/ExplorerNavigation.tsx'), 'utf8')
  assert.doesNotMatch(source, /style=\{\{\s*width:\s*width \?\? 288\s*\}\}/, 'nav is not pinned wider than the md aside')
  assert.match(source, /className="h-full w-full overflow-y-auto"/, 'scroll container follows the aside width')
  assert.match(source, /className="relative z-20 flex min-h-11 min-w-11[^"]*"/, 'collapse control stacks above the z-10 resize handle')
})


