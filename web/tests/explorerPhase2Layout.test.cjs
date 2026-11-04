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
  assert.equal($('[data-testid="explorer-sidebar"]'), null)
  const grip = $('[data-testid="explorer-edge-grip"]')
  assert.equal(grip.getAttribute('aria-label'), 'Expand Music Explorer')
  assert.equal(document.activeElement, grip, 'focus follows to the grip')
  assert.equal(localStorage.getItem('gtar_explorer_collapsed'), 'true')
  await act(async () => root.render(null))
  await render(ExplorerNavigation, props)
  assert.ok($('[data-testid="explorer-edge-grip"]'), 'collapsed state is remembered')
  const setItem = window.Storage.prototype.setItem
  window.Storage.prototype.setItem = () => { throw new Error('blocked') }
  try { await click($('[data-testid="explorer-edge-grip"]')) } finally { window.Storage.prototype.setItem = setItem }
  assert.ok($('[data-testid="explorer-sidebar"]'), 'blocked storage never blocks the toggle')
  assert.equal(document.activeElement, $('[data-testid="explorer-collapse"]'))
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

test('header: GTAR1 row with actions (Theme, Trash, More, cloud status) in UPPERBOX (#333)', async () => ui(async ({ $, click, render }) => {
  const { Header } = require('../src/components/Header.tsx')
  const calls = []
  await render(Header, headerProps(calls))
  assert.ok($('[data-testid="dev-header-diagnostics"]'), 'DEV deployment details stay next to the logo')
  assert.ok($('[data-testid="dev-header-diagnostics-compact"]'), 'compact DEV strip for phones')
  assert.ok($('[data-testid="header-cloud-sync-button"]'), 'cloud status button kept')
  assert.ok($('[aria-label="Theme"]'), 'Theme in header')
  assert.ok($('[aria-label="Trash (2)"]'), 'Trash in header')
  assert.ok($('[aria-label="More"]'), 'More in header')
  assert.equal($('[data-testid="header-new-song"]'), null, 'no header New Song button (#332)')
  assert.equal($('[data-testid="header-sources"]'), null, 'no header Sources button (#332)')
  assert.equal($('nav[aria-label="Main navigation"]'), null, 'no header Songbook/Setlists switcher (#332)')
  await click($('[aria-label="Theme"]'))
  await click($('[aria-label="Trash (2)"]'))
  await click($('[aria-label="More"]'))
  assert.match(document.body.textContent, /Stage Settings[\s\S]*Web Sources[\s\S]*Import Songs\.\.\./, 'More keeps its pre-#319 items')
  await click($('[data-testid="header-avatar"]'))
  assert.equal($('[data-testid="header-theme-settings-btn"]'), null, 'Theme stays in header, not the profile menu')
  assert.deepEqual(calls, ['theme', 'view:trash'])
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
