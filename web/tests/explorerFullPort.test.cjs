const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:true})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }
).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const React = require('react')
const { act } = React
const { JSDOM } = require('jsdom')

async function ui(run) {
  const dom = new JSDOM('<button id="opener">Open</button><div id="root"></div>', { url: 'http://localhost' })
  const keys = ['window', 'document', 'Node', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
  Object.assign(global, { window: dom.window, document: dom.window.document, Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia = () => ({ matches: false })
  const root = require('react-dom/client').createRoot(document.getElementById('root'))
  const click = async node => { assert.ok(node, 'control exists'); await act(async () => node.click()) }
  const render = async (component, props) => act(async () => root.render(React.createElement(component, props)))
  try { await run({ root, click, render }) }
  finally { await act(async () => root.unmount()); dom.window.close(); Object.assign(global, previous) }
}

test('cloud button announces backup time accessibly, shows status badges and opens Backup & Restore', async () => ui(async ({ render, click }) => {
  const { SyncStatusPill } = require('../src/components/SyncStatusPill.tsx')
  let opened = 0
  const props = { signedIn: true, lastBackup: '2026-11-02T00:00:00Z', backupChecksum: 'saved', localChecksum: 'saved',
    now: Date.parse('2026-11-02T08:00:00Z'), onClick: () => opened++, recoveryAttention: true }
  await render(SyncStatusPill, props)
  const button = () => document.querySelector('[data-testid="header-cloud-sync-button"]')
  assert.equal(button().dataset.status, 'backed-up')
  assert.ok(button().querySelector('.lucide-check'))
  assert.match(button().getAttribute('aria-label'), /Last cloud backup: 8 h ago/)
  assert.doesNotMatch(button().textContent, /ago|Last cloud/)
  assert.ok(button().querySelector('[data-testid="cloud-recovery-dot"]'))
  await click(button()); assert.equal(opened, 1)
  await render(SyncStatusPill, { ...props, localChecksum: 'changed' })
  assert.equal(button().dataset.status, 'not-backed-up')
  assert.ok(button().querySelector('.lucide-circle-alert'))
  await render(SyncStatusPill, { ...props, lastBackup: null, backupChecksum: null })
  assert.equal(button().dataset.status, 'not-backed-up')
  await render(SyncStatusPill, { ...props, signedIn: false })
  assert.equal(button().dataset.status, 'signed-out')
  assert.ok(button().querySelector('.lucide-ban'))
}))

test('compact Header opens Explorer in Stage and expands search with Ctrl/Cmd+K and Escape outside Stage', async () => ui(async ({ render, click }) => {
  window.innerWidth = 360
  const { Header } = require('../src/components/Header.tsx')
  const noop = () => {}
  let opened = 0
  const props = { activeView: 'songbook', onViewChange: noop, song: { id: 'one', title: 'One', rawContent: '' }, searchQuery: '',
    onSearchQueryChange: noop, onOpenWebsiteUrlSource: noop, onOpenStageTools: noop, onToggleTheme: noop,
    onOpenStageSettings: noop, onOpenImportModal: noop, onOpenSetlistDrawer: () => opened++ }
  await render(Header, props)
  const input = () => document.getElementById('search-input')
  assert.equal(input(), null, 'compact header starts with search closed')
  await click(document.querySelector('[aria-label="Open search"]'))
  assert.equal(document.activeElement, input())
  await act(async () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(input(), null)
  for (const modifier of ['ctrlKey', 'metaKey']) {
    await act(async () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', [modifier]: true, bubbles: true })))
    assert.equal(document.activeElement, input())
    await act(async () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  }
  await render(Header, { ...props, activeView: 'stage' })
  await click(document.querySelector('[aria-label="Open Music Explorer"]'))
  assert.equal(opened, 1)
  await act(async () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })))
  assert.equal(input(), null, 'search shortcut stays blocked in Stage')
  assert.equal(document.querySelector('[aria-label="Side Panel"]'), null)
}))

test('Explorer sidebar remembers collapse per device; drawer traps focus, closes on Escape and restores opener', async () => ui(async ({ root, render, click }) => {
  const { ExplorerNavigation } = require('../src/components/ExplorerNavigation.tsx')
  const noop = () => {}
  let closed = 0
  const props = { songs: [], setlists: [], currentSelection: { type: 'ALL_SONGS' }, onSelect: noop,
    onNewSong: noop, onNewSetlist: noop, isOpen: false, onClose: () => closed++ }
  await render(ExplorerNavigation, props)
  await click(document.querySelector('[aria-label="Collapse Music Explorer"]'))
  assert.equal(document.querySelector('[data-testid="explorer-sidebar"]').dataset.collapsed, 'true')
  await act(async () => root.render(null))
  await render(ExplorerNavigation, props)
  assert.ok(document.querySelector('[aria-label="Expand Music Explorer"]'))
  window.innerWidth = 360
  document.getElementById('opener').focus()
  await render(ExplorerNavigation, { ...props, isOpen: true })
  const dialog = document.querySelector('[role="dialog"]')
  assert.ok(dialog.contains(document.activeElement))
  await act(async () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(closed, 1)
  await render(ExplorerNavigation, props)
  assert.equal(document.activeElement.id, 'opener')
  const original = window.Storage.prototype.setItem
  window.Storage.prototype.setItem = () => { throw new Error('unavailable') }
  try { await click(document.querySelector('[aria-label="Expand Music Explorer"]')) }
  finally { window.Storage.prototype.setItem = original }
  assert.equal(document.querySelector('[data-testid="explorer-sidebar"]').dataset.collapsed, 'false')
}))

test('a desktop Explorer request reveals the permanent sidebar without locking the workspace', async () => ui(async ({ render, click }) => {
  window.innerWidth = 1280
  const { ExplorerNavigation } = require('../src/components/ExplorerNavigation.tsx')
  const noop = () => {}
  let closed = 0
  const props = { songs: [], setlists: [], currentSelection: { type: 'ALL_SONGS' }, onSelect: noop,
    onNewSong: noop, onNewSetlist: noop, isOpen: false, onClose: () => closed++ }
  await render(ExplorerNavigation, props)
  await click(document.querySelector('[aria-label="Collapse Music Explorer"]'))
  await render(ExplorerNavigation, { ...props, isOpen: true })
  assert.equal(document.querySelector('[data-testid="explorer-sidebar"]').dataset.collapsed, 'false')
  assert.equal(document.body.style.overflow, '')
  assert.equal(closed, 1)
}))

test('Header reads existing backup metadata, tracks local edits without requests, and isolates account status', async () => ui(async ({ root, click }) => {
  const { Header } = require('../src/components/Header.tsx')
  const { AuthContext } = require('../src/utils/authContext.ts')
  const { persistLibrary } = require('../src/utils/syncJournal.ts')
  const { computeSongbookChecksum } = require('../src/utils/cloudBackupFormat.ts')
  const library = { songs: [{ id: '11111111-1111-4111-8111-111111111111', title: 'One', rawContent: '[C]One' }], setlists: [] }
  persistLibrary(library)
  const record = { data: library, checksum: computeSongbookChecksum(library), version: 1, updatedAt: '2026-11-02T00:00:00Z' }
  const originalFetch = global.fetch
  const requests = []
  global.fetch = async (url, options) => { requests.push([url, options.method]); return new Response(JSON.stringify({ success: true, cloudRecord: record })) }
  const noop = () => {}
  const props = { activeView: 'songbook', song: library.songs[0], searchQuery: '', onViewChange: noop,
    onSearchQueryChange: noop, onOpenWebsiteUrlSource: noop, onOpenStageTools: noop, onToggleTheme: noop,
    onOpenStageSettings: noop, onOpenImportModal: noop }
  const renderAccount = async id => act(async () => root.render(React.createElement(AuthContext.Provider,
    { value: { session: id ? { token: 'test', user: { id } } : null, role: 'USER', accessStatus: 'active' } }, React.createElement(Header, props))))
  const button = () => document.querySelector('[data-testid="header-cloud-sync-button"]')
  try {
    await renderAccount('A')
    assert.equal(button().dataset.status, 'not-backed-up')
    assert.deepEqual(requests, [], 'header status itself never reads the network')
    await click(button())
    assert.deepEqual(requests, [['/api/songbook/sync', 'GET']], 'only the existing dialog fetch runs')
    await click(document.querySelector('[data-testid="cloud-sync-close-button"]'))
    assert.equal(button().dataset.status, 'backed-up')
    await act(async () => persistLibrary({ ...library, songs: [{ ...library.songs[0], title: 'Changed' }] }))
    assert.equal(button().dataset.status, 'not-backed-up')
    assert.equal(requests.length, 1, 'local edits do not fetch or auto-backup')
    await renderAccount('B')
    assert.equal(button().dataset.status, 'not-backed-up', 'another account cannot inherit the backup')
    await renderAccount(null)
    assert.equal(button().dataset.status, 'signed-out')
    assert.equal(requests.length, 1)
  } finally { global.fetch = originalFetch }
}))
