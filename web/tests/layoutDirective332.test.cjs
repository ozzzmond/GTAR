// #332: Layout directive — Header simplification, Songbook/Explorer action pruning,
// Setlist workspace Add button, and restyled Explorer folder form/delete confirmation.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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
  try {
    await run({ $, click, render, root, dom })
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    Object.assign(global, previous)
    Object.defineProperty(global, 'navigator', previousNavigator)
  }
}

function baseHeaderProps(calls = []) {
  return {
    activeView: 'songbook',
    onViewChange: view => calls.push(`view:${view}`),
    song: null,
    allSongs: [{ id: 'a', title: 'Song A', artist: 'Artist', rawContent: '' }],
    songsCount: 1,
    deletedSongsCount: 0,
    searchQuery: '',
    onSearchQueryChange: noop,
    onNavigateHome: () => calls.push('home'),
    onOpenWebsiteUrlSource: () => calls.push('sources'),
    onOpenStageTools: noop,
    onToggleTheme: noop,
    onOpenStageSettings: noop,
    onOpenImportModal: noop,
    onOverlayChange: noop,
    onOpenSetlistDrawer: () => calls.push('open-explorer'),
    isExplorerOpen: false,
    setlists: [],
    onNewSong: () => calls.push('new-song'),
    onOpenSection: s => calls.push(`section:${s}`),
  }
}

test('SCOPE 1: Header removes Songbook/Setlists toggle, New Song, and Sources; keeps search, cloud status, profile, and mobile explorer button', async () => ui(async ({ $, render }) => {
  const { Header } = require('../src/components/Header.tsx')
  const calls = []
  await render(Header, baseHeaderProps(calls))

  // Removals
  assert.equal($('nav[aria-label="Main navigation"]'), null, 'Songbook/Setlists toggle is removed')
  assert.equal($('[data-testid="header-new-song"]'), null, 'New Song button in header is removed')
  assert.equal($('[data-testid="header-sources"]'), null, 'Sources button in header is removed')

  // Kept elements
  assert.ok($('form[role="search"]'), 'Desktop search container is kept')
  assert.ok(document.getElementById('search-input'), 'Search input is kept')
  assert.equal($('[data-testid="header-cloud-sync-button"]'), null, 'Cloud sync button retired per #434')
  assert.ok($('[data-testid="header-settings"]'), 'Settings gear button is kept per #434')
  assert.ok($('button[aria-label="Open Music Explorer"]'), 'Music explorer button is kept for mobile navigation')
}))

test('SCOPE 2: Songbook page removes Browse Sources; keeps Add Song', async () => ui(async ({ $, render }) => {
  const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
  let newSongCalled = false
  await render(SongbookHomeView, {
    songs: [{ id: 's1', title: 'Song 1', artist: 'Band', rawContent: '[C]lyrics' }],
    activeSongIndex: 0,
    setlists: [],
    onSelectSong: noop,
    onNewSong: () => { newSongCalled = true },
    onOpenSources: noop,
    onSongMembershipChange: noop,
    onCreateSetlistForSong: noop,
    onOpenSetlists: noop,
    onDeleteSong: noop,
  })

  assert.equal($('[data-testid="songs-browse-sources"]'), null, 'Browse Sources button is removed from Songbook')
  const addSongBtn = $('[data-testid="songs-add-song"]')
  assert.ok(addSongBtn, 'Add Song button is kept in Songbook')
  assert.match(addSongBtn.textContent, /Add Song/)
  await act(async () => addSongBtn.click())
  assert.equal(newSongCalled, true)
}))

test('SCOPE 3: Music Explorer removes New Song and New Set quick actions', async () => ui(async ({ $, render }) => {
  const { MusicExplorerNav } = require('../src/components/MusicExplorerNav.tsx')
  await render(MusicExplorerNav, {
    songs: [{ id: 's1', title: 'Song 1', artist: 'Band', rawContent: '' }],
    setlists: [{ id: 'sl1', name: 'Gig 1', songs: [] }],
    currentSelection: { type: 'ALL_SONGS' },
    onSelect: noop,
    onNewSong: noop,
    onNewSetlist: noop,
  })

  assert.equal($('[data-testid="explorer-nav-new-song"]'), null, 'New Song button is removed from Music Explorer')
  assert.equal($('[data-testid="explorer-nav-new-set"]'), null, 'New Set button is removed from Music Explorer')
  assert.ok($('[data-testid="explorer-nav-all-songs"]'), 'All Songs is accessible in one tap')
  assert.ok($('[data-testid="explorer-nav-all-setlists"]'), 'All Setlists is accessible in one tap')
}))

test('SCOPE 4: Setlists main page adds "Add new setlist" button that reuses the create-setlist handler', async () => ui(async ({ $, click, render }) => {
  const { SetlistWorkspace } = require('../src/components/SetlistWorkspace.tsx')
  let createCalled = false
  await render(SetlistWorkspace, {
    scope: 'ALL_SETLISTS',
    setlists: [{ id: 'sl1', name: 'Sunday Service', songs: [] }],
    songs: [],
    onNewSetlist: () => { createCalled = true },
    menu: {
      sortValue: 'manual',
      sortOptions: [{ value: 'manual', label: 'Manual Order' }],
      onSortChange: noop,
      onNewSetlist: () => { createCalled = true },
    },
  })

  const addSetlistBtn = $('[data-testid="setlists-add-new"]')
  assert.ok(addSetlistBtn, 'Add new setlist button is present on setlists main page')
  assert.match(addSetlistBtn.textContent, /Add new setlist/)
  assert.match(addSetlistBtn.className, /min-h-11/, '44px touch target')
  await click(addSetlistBtn)
  assert.equal(createCalled, true, 'Reuses existing create-setlist handler')
}))

test('SCOPE 5 & 6: Folder inline form spacing matches search box design; delete confirmation restyled to app pattern', async () => ui(async ({ $, click, render }) => {
  const { ExplorerFolderTree } = require('../src/components/ExplorerFolderTree.tsx')
  let deletedId = null
  let savedFolder = null
  const folders = [{ id: 'f1', name: 'Worship Sets', parentId: null, createdAt: Date.now() }]

  await render(ExplorerFolderTree, {
    folders,
    setlists: [],
    onSelect: noop,
    onSave: f => { savedFolder = f; return true },
    onDelete: id => { deletedId = id; return true },
  })

  // Open edit form
  const actionsBtn = $('button[aria-label="Folder actions for Worship Sets"]')
  assert.ok(actionsBtn)
  await click(actionsBtn)

  const form = $('form[aria-label="Folder editor"]')
  assert.ok(form, 'Folder editor form is open')
  assert.match(form.className, /rounded-xl border border-app-border bg-app-surface/, 'Form container matches card/searchbox tokens')

  const nameInput = $('input[aria-label="Folder name"]')
  assert.ok(nameInput)
  assert.match(nameInput.className, /rounded-xl border border-app-border.*bg-app-surface.*px-3.*text-xs/, 'Input tokens match search box')
  assert.match(nameInput.className, /min-h-\[36px\]/, 'matches search box height')

  // Click Delete button to trigger confirmation
  const deleteBtn = [...form.querySelectorAll('button')].find(b => b.textContent.trim() === 'Delete')
  assert.ok(deleteBtn)
  await click(deleteBtn)

  const confirmBox = form.querySelector('[role="alert"]')
  assert.ok(confirmBox, 'Confirmation alert box rendered')
  assert.match(confirmBox.className, /rounded-xl border border-status-error/, 'Confirmation styled with app status-error pattern')
  assert.match(confirmBox.textContent, /Delete this folder\? Its setlists move to Unfiled; subfolders move to its parent\./)

  const cancelBtn = [...confirmBox.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel')
  const confirmDeleteBtn = [...confirmBox.querySelectorAll('button')].find(b => b.textContent.trim() === 'Confirm delete folder')
  assert.ok(cancelBtn, 'Cancel button exists in delete confirmation')
  assert.ok(confirmDeleteBtn, 'Confirm delete folder button exists in confirmation')
  assert.match(confirmDeleteBtn.className, /h-7/, 'compact button with touch target')

  // Confirm deletion
  await click(confirmDeleteBtn)
  assert.equal(deletedId, 'f1', 'Folder deleted with unchanged behavior')
}))
