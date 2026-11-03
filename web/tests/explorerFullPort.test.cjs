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
const bootDom = new JSDOM('<!doctype html>')
Object.assign(global, { window: bootDom.window, document: bootDom.window.document })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

test('Explorer quick actions guard unsaved editor changes in the sidebar and drawer', async t => {
  for (const width of [1280, 360]) {
    for (const action of ['new-song', 'new-set']) {
      await t.test(`${width}px: ${action}`, async () => ui(async ({ render, click }) => {
        window.innerWidth = width
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
        const keys = ['sessionStorage', 'Event', 'CustomEvent', 'fetch']
        const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
        Object.assign(global, { sessionStorage: window.sessionStorage, Event: window.Event,
          CustomEvent: window.CustomEvent, fetch: async () => { throw new Error('offline') } })
        const song = { id: 'guard-song', title: 'Amazing Grace', artist: 'John Newton', key: 'G',
          format: 'CHORD_PRO', transposeOffset: 0, rawContent: '{title: Amazing Grace}\n{key: G}\n[G]Grace' }
        localStorage.setItem('gtar_library_v1', JSON.stringify({ songs: [song], setlists: [] }))
        try {
          await render(require('../src/App.tsx').default, {})
          await click(document.querySelector('[aria-label="Editor (Alt+2)"]'))
          const editor = document.querySelector('textarea')
          assert.ok(editor, 'existing song opens in the real editor')
          if (width < 768) await click(document.querySelector('[aria-label="Open Music Explorer"]'))
          const draft = `${song.rawContent}\nUnsaved verse`
          // Refuse the autosave at the browser boundary to leave a real unsaved lyric edit.
          const setItem = window.Storage.prototype.setItem
          window.Storage.prototype.setItem = function (key, value) {
            if (key === 'gtar_library_v1') throw new window.DOMException('Full', 'QuotaExceededError')
            return setItem.call(this, key, value)
          }
          try {
            await act(async () => {
              Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(editor, draft)
              editor.dispatchEvent(new window.Event('input', { bubbles: true }))
            })
          } finally { window.Storage.prototype.setItem = setItem }
          assert.equal(document.querySelector('[data-testid="editor-save-status"]').dataset.saveStatus, 'FAILED', 'draft is unsaved before navigation')
          const surface = document.querySelector(width < 768 ? '[data-testid="music-explorer-drawer"]' : '[data-testid="explorer-sidebar"]')
          await click(surface.querySelector(`[data-testid="explorer-nav-${action}"]`))
          const guard = document.querySelector('[role="dialog"][aria-label="Unsaved changes"]')
          assert.ok(guard, 'unsaved-changes guard appears before the action runs')
          assert.equal(document.querySelector('textarea'), editor, 'active song/editor is unchanged')
          assert.equal(editor.value, draft, 'unsaved draft is preserved')
          await click([...guard.querySelectorAll('button')].find(button => button.textContent === 'Cancel'))
          assert.equal(document.querySelector('[aria-label="Unsaved changes"]'), null)
          assert.equal(editor.value, draft, 'cancel keeps the draft')
          assert.equal(document.querySelector('[data-testid="editor-save-status"]').dataset.saveStatus, 'FAILED')
        } finally { Object.assign(global, previous) }
      }))
    }
  }
})

async function ui(run) {
  const dom = new JSDOM('<button id="opener">Open</button><div id="root"></div>', { url: 'http://localhost' })
  const keys = ['window', 'document', 'Node', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
  Object.assign(global, { window: dom.window, document: dom.window.document, Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia = () => ({ matches: false })
  const root = createRoot(document.getElementById('root'))
  const click = async node => { assert.ok(node, 'control exists'); await act(async () => node.click()) }
  const render = async (component, props) => act(async () => root.render(React.createElement(component, props)))
  try { await run({ root, click, render }) }
  finally { await act(async () => root.unmount()); dom.window.close(); Object.assign(global, previous) }
}

test('windowed song grid uses workspace tracks instead of viewport breakpoints', async () => ui(async ({ render }) => {
  window.innerWidth = 1280
  window.innerHeight = 580
  const { useListWindow } = require('../src/utils/listWindow.ts')
  function Grid({ tracks }) {
    const ref = React.useRef(null)
    const range = useListWindow(1000, ref)
    return React.createElement('div', { ref, style: { gridTemplateColumns: tracks }, 'data-range': JSON.stringify(range) })
  }
  const range = () => JSON.parse(document.querySelector('[data-range]').dataset.range)
  await render(Grid, { tracks: '438px 438px' })
  assert.equal(range().end, 32, 'two workspace columns render sixteen rows')
  assert.equal(range().padBottom, 484 * 58, 'spacer represents remaining two-column rows')
  await render(Grid, { tracks: '900px' })
  await act(async () => window.dispatchEvent(new window.Event('resize')))
  await act(async () => new Promise(resolve => setTimeout(resolve, 25)))
  assert.equal(range().end, 16, 'resizing to one track recomputes the window')
}))

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
  // #319: collapsed = no aside, only the left-edge grip that reopens it.
  assert.equal(document.querySelector('[data-testid="explorer-sidebar"]'), null)
  assert.ok(document.querySelector('[data-testid="explorer-edge-grip"]'))
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

test('fullscreen hides the explorer sidebar and toggle, and exiting fullscreen restores previous state', async () => ui(async ({ render, click }) => {
  window.innerWidth = 1280
  window.innerHeight = 800
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  const keys = ['sessionStorage', 'Event', 'CustomEvent', 'fetch']
  const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
  Object.assign(global, { sessionStorage: window.sessionStorage, Event: window.Event,
    CustomEvent: window.CustomEvent, fetch: async () => { throw new Error('offline') } })
  const song = { id: 'test-fs-song', title: 'Fullscreen Song', artist: 'Artist', key: 'C',
    format: 'CHORD_PRO', transposeOffset: 0, rawContent: '{title: Fullscreen Song}\n{key: C}\n[C]Hello world' }
  const song2 = { id: 'test-fs-song-2', title: 'Second Song', artist: 'Artist', key: 'D',
    format: 'CHORD_PRO', transposeOffset: 0, rawContent: '{title: Second Song}\n{key: D}\n[D]Another song' }
  localStorage.setItem('gtar_library_v1', JSON.stringify({ songs: [song, song2], setlists: [] }))

  try {
    const App = require('../src/App.tsx').default
    await render(App, {})

    // 1. Outside fullscreen (Songbook): sidebar and header explorer trigger are visible
    assert.ok(document.querySelector('[data-testid="explorer-sidebar"]'), 'sidebar visible in songbook')
    assert.equal(document.querySelector('[data-testid="explorer-edge-grip"]'), null)
    assert.ok(document.querySelector('[aria-label="Open Music Explorer"]'), 'header explorer trigger visible outside fullscreen')

    // Open song to enter Stage view
    const songCard = document.querySelector('[data-testid="song-card-0"]') || document.querySelector('[aria-label="Stage (Alt+4)"]')
    await click(songCard)

    // In Stage view outside fullscreen: sidebar, header trigger, and setlist drawer trigger are visible
    assert.ok(document.querySelector('[data-testid="explorer-sidebar"]'), 'sidebar visible in stage outside fullscreen')
    assert.ok(document.querySelector('button[aria-label="Open setlist / library"]'), 'setlist drawer trigger rendered outside fullscreen')

    // 2. Enter fullscreen
    const enterFullscreenBtn = document.querySelector('button[aria-label="Enter fullscreen"]')
    assert.ok(enterFullscreenBtn, 'Enter fullscreen button present')
    await click(enterFullscreenBtn)

    // Fullscreen active: sidebar, grip toggle, and ALL setlist drawer triggers MUST BE HIDDEN
    assert.equal(document.querySelector('[data-testid="explorer-sidebar"]'), null, 'sidebar hidden in fullscreen')
    assert.equal(document.querySelector('[data-testid="explorer-edge-grip"]'), null, 'edge grip hidden in fullscreen')
    assert.equal(document.querySelector('[aria-label="Open Music Explorer"]'), null, 'open explorer trigger hidden in fullscreen')
    assert.equal(document.querySelector('button[aria-label="Open setlist / library"]'), null, 'no setlist drawer trigger rendered in fullscreen')

    // 3. Exit fullscreen
    const exitFullscreenBtn = document.querySelector('button[aria-label="Exit fullscreen"]')
    assert.ok(exitFullscreenBtn, 'Exit fullscreen button present')
    await click(exitFullscreenBtn)

    // Outside fullscreen: sidebar restored to expanded state, and drawer triggers rendered
    assert.ok(document.querySelector('[data-testid="explorer-sidebar"]'), 'sidebar restored after exit')
    assert.equal(document.querySelector('[data-testid="explorer-edge-grip"]'), null)
    assert.ok(document.querySelector('button[aria-label="Open setlist / library"]'), 'setlist drawer trigger restored after exit')
    assert.ok(document.querySelector('[aria-label="Open Music Explorer"]'), 'open explorer trigger restored after exit')

    // 4. Test with sidebar previously collapsed
    await click(document.querySelector('[data-testid="explorer-collapse"]'))
    assert.equal(document.querySelector('[data-testid="explorer-sidebar"]'), null)
    assert.ok(document.querySelector('[data-testid="explorer-edge-grip"]'), 'sidebar is now collapsed')

    // Enter fullscreen while collapsed
    await click(document.querySelector('button[aria-label="Enter fullscreen"]'))
    assert.equal(document.querySelector('[data-testid="explorer-sidebar"]'), null, 'sidebar still hidden in fullscreen')
    assert.equal(document.querySelector('[data-testid="explorer-edge-grip"]'), null, 'edge grip hidden in fullscreen')
    assert.equal(document.querySelector('[aria-label="Open Music Explorer"]'), null)
    assert.equal(document.querySelector('button[aria-label="Open setlist / library"]'), null, 'no setlist drawer trigger in fullscreen while collapsed')

    // Exit fullscreen
    await click(document.querySelector('button[aria-label="Exit fullscreen"]'))
    // Edge grip restored (previous collapsed state restored) and trigger restored
    assert.equal(document.querySelector('[data-testid="explorer-sidebar"]'), null, 'sidebar remains collapsed')
    assert.ok(document.querySelector('[data-testid="explorer-edge-grip"]'), 'edge grip restored after exit')
    assert.ok(document.querySelector('button[aria-label="Open setlist / library"]'), 'setlist drawer trigger restored after exit')
  } finally {
    Object.assign(global, previous)
  }
}))
