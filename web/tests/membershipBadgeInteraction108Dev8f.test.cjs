const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:true})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }
).outputText, filename)
require.extensions['.png'] = (module, filename) => { module.exports = filename }
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { JSDOM } = require('jsdom')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')

for (const width of [320, 1280]) test(`dev.8f membership badge interaction at ${width}px`, async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  const keys = ['window', 'document', 'Node', 'HTMLElement', 'localStorage', 'sessionStorage', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
  Object.assign(global, { window: dom.window, document: dom.window.document, Node: dom.window.Node, HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, 'innerWidth', { value: width })
  Object.defineProperty(window, 'innerHeight', { value: 600 })
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.hasAttribute('data-dropdown-portal')
      ? { width: 192, height: 160 }
      : { left: width - 40, right: width - 8, top: 540, bottom: 568, width: 32, height: 28 }
  }
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  const nativeSetTimeout = global.setTimeout
  const timers = new Set()
  global.setTimeout = (fn, delay, ...args) => {
    const timer = nativeSetTimeout(fn, delay, ...args)
    timers.add(timer)
    return timer
  }
  const songs = ['one', 'many', 'zero'].map(id => ({ id, title: id, artist: '', rawContent: '' }))
  let setlists = [
    { id: 'stable-a', name: 'Same name', songs: [{ id: 'one' }, { id: 'many' }] },
    { id: 42, name: 'Same name', songs: [{ id: 'many' }] },
    { id: 'stable-c', name: 'Current third', songs: [{ id: 'many' }] },
    { id: 'deleted', name: 'Deleted', isDeleted: true, songs: [{ id: 'many' }, { id: 'zero' }] },
  ]
  setlists = setlists.map(sl => ({ ...sl, songs: sl.songs.map(ref => ({ ...ref, title: ref.id })) }))
  let selected = 0, openedOverview = 0, home, drawer
  const managed = []
  // Render App and observe its public child props; keep the real badge UI.
  const homeModule = require('../src/components/SongbookHomeView.tsx')
  const drawerModule = require('../src/components/SetlistManager.tsx')
  const originalDrawer = drawerModule.SetlistManager
  homeModule.SongbookHomeView = props => {
    home = props
    return React.createElement(SongbookHomeView, {
      ...props,
      onSelectSong: () => selected++,
      onOpenSetlists: () => openedOverview++,
      onManageSetlist: sl => { managed.push(sl); props.onManageSetlist(sl) },
    })
  }
  drawerModule.SetlistManager = props => { drawer = props; return null }
  localStorage.setItem('gtar_library_v1', JSON.stringify({ songs, setlists }))
  const root = createRoot(document.getElementById('root'))
  const App = require('../src/App.tsx').default
  let mounted = false
  const render = async () => act(async () => {
    if (!mounted) {
      root.render(React.createElement(App))
      mounted = true
    } else {
      // Adopt changed membership through App's real cross-tab storage boundary.
      const raw = JSON.stringify({ songs, setlists })
      localStorage.setItem('gtar_library_v1', raw)
      window.dispatchEvent(new window.StorageEvent('storage', { key: 'gtar_library_v1', newValue: raw }))
    }
  })
  const find = id => document.querySelector(`[data-testid="${id}"]`)
  const click = async element => { assert.ok(element); await act(async () => element.click()) }
  const portal = () => document.querySelector('[data-dropdown-portal]')
  const expectItems = (index, expected) => {
    const popover = find(`membership-popover-${index}`)
    assert.ok(popover, 'badge activation opens popover')
    assert.deepEqual([...popover.querySelectorAll('button')].map(button => button.textContent), expected.map(sl => sl.name))
    assert.deepEqual([...popover.querySelectorAll('button')].map(button => button.dataset.testid), expected.map(sl => `jump-setlist-${sl.id}`))
    assert.equal(portal().parentElement, document.body)
    assert.equal(portal().style.left, `${width - 200}px`, 'fits mobile and desktop viewport')
    assert.equal(portal().style.top, '374px', 'flips above viewport bottom')
    assert.equal(document.activeElement, popover.querySelector('button'), 'focus enters list for keyboard navigation')
  }
  try {
    await render()
    assert.equal(find('song-setlist-indicator-2'), null, 'zero membership has no badge')
    const single = find('song-setlist-indicator-0')
    assert.equal(single.tagName, 'BUTTON', 'native Enter/Space activation')
    assert.equal(single.getAttribute('aria-label'), 'In 1 setlist')
    assert.equal(single.getAttribute('title'), 'In 1 setlist')
    assert.ok(single.querySelector('svg'), 'setlist chip keeps an icon glyph')
    assert.equal(single.textContent, '1', 'card stays count only')
    assert.equal(find('song-setlist-count-1').textContent, '3')
    assert.equal(find('song-setlist-indicator-1').getAttribute('title'), 'In 3 setlists')
    await click(find('song-menu-1'))
    await click(single)
    assert.equal(document.querySelectorAll('[data-dropdown-portal]').length, 1, 'badge replaces existing menu')
    expectItems(0, [setlists[0]])
    assert.equal(single.getAttribute('aria-expanded'), 'true')
    assert.equal(single.getAttribute('aria-controls'), find('membership-popover-0').id)
    assert.equal(find('membership-popover-0').getAttribute('role'), 'dialog')
    await click(find('jump-setlist-stable-a'))
    assert.equal(managed.at(-1), home.setlists[0], 'passes canonical object')
    assert.equal(drawer.selectedSetlistId, 'stable-a')
    assert.ok(drawer, 'Setlist Manager opened')
    assert.equal(portal(), null)

    const multiple = find('song-setlist-indicator-1')
    // A tap ends with the browser's click activation; dispatch touch events first.
    for (const type of ['touchstart', 'touchend']) await act(async () => multiple.dispatchEvent(new window.Event(type, { bubbles: true })))
    await click(multiple)
    expectItems(1, setlists.slice(0, 3))
    await click(find('jump-setlist-42'))
    assert.equal(drawer.selectedSetlistId, home.setlists[1].id, 'duplicate names navigate by selected stable ID')
    assert.equal(managed.at(-1), home.setlists[1])
    assert.equal(managed.length, 2, 'each item activation navigates once')
    await click(multiple)
    await click(document.body)
    assert.equal(portal(), null, 'outside click dismisses')
    await click(multiple)
    await click(multiple)
    assert.equal(portal(), null, 'badge toggles closed')

    multiple.focus()
    // jsdom does not synthesize native button key activation: detail=0 models it.
    await act(async () => multiple.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 0 })))
    expectItems(1, setlists.slice(0, 3))
    await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(portal(), null)
    assert.equal(document.activeElement, multiple, 'Escape restores badge focus')
    assert.equal(multiple.getAttribute('aria-expanded'), 'false')

    await click(multiple)
    setlists = [ { ...setlists[0], name: 'Renamed current' }, { ...setlists[1], isDeleted: true }, ...setlists.slice(2) ]
    await render()
    assert.equal(find('song-setlist-count-1').textContent, '2')
    assert.deepEqual([...find('membership-popover-1').querySelectorAll('button')].map(button => button.textContent), ['Renamed current', 'Current third'])
    await click(find('jump-setlist-stable-c'))
    assert.equal(drawer.selectedSetlistId, 'stable-c')
    assert.equal(managed.at(-1), home.setlists[2])
    assert.equal(selected, 0, 'badge and item never launch normal song action')
    assert.equal(openedOverview, 0, 'item only opens selected manage drawer')
    // App normalizes persisted numeric IDs to strings. Its callback must also
    // preserve a numeric ID supplied by a child without source-level assumptions.
    await act(async () => home.onManageSetlist(setlists[1]))
    assert.equal(drawer.selectedSetlistId, 42)
    assert.ok(drawer, 'Setlist Manager opened')
    await click(find('song-card-0'))
    assert.equal(selected, 1, 'normal card action still works')
  } finally {
    await act(async () => root.unmount())
    homeModule.SongbookHomeView = SongbookHomeView
    drawerModule.SetlistManager = originalDrawer
    for (const timer of timers) clearTimeout(timer)
    global.setTimeout = nativeSetTimeout
    dom.window.close()
    Object.assign(global, previous)
  }
})
