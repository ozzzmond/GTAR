const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }
).outputText, filename)
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { JSDOM } = require('jsdom')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')

// Execute the actual App callback so the interaction proves the drawer's ID wiring.
const appSource = fs.readFileSync(require.resolve('../src/App.tsx'), 'utf8')
const appAst = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let manageCallback
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(appAst) === 'handleManageSetlist') {
    manageCallback = ts.transpileModule(`const callback = ${node.initializer.getText(appAst)}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText
  }
  ts.forEachChild(node, visit)
}
visit(appAst)
assert.ok(manageCallback)
assert.match(appSource, /onManageSetlist=\{handleManageSetlist\}/)

for (const width of [320, 1280]) test(`dev.8f membership badge interaction at ${width}px`, async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  const keys = ['window', 'document', 'Node', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
  Object.assign(global, { window: dom.window, document: dom.window.document, Node: dom.window.Node,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, 'innerWidth', { value: width })
  Object.defineProperty(window, 'innerHeight', { value: 600 })
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.hasAttribute('data-dropdown-portal')
      ? { width: 192, height: 160 }
      : { left: width - 40, right: width - 8, top: 540, bottom: 568, width: 32, height: 28 }
  }
  const songs = ['one', 'many', 'zero'].map(id => ({ id, title: id, artist: '', rawContent: '' }))
  let setlists = [
    { id: 'stable-a', name: 'Same name', songs: [{ id: 'one' }, { id: 'many' }] },
    { id: 42, name: 'Same name', songs: [{ id: 'many' }] },
    { id: 'stable-c', name: 'Current third', songs: [{ id: 'many' }] },
    { id: 'deleted', name: 'Deleted', isDeleted: true, songs: [{ id: 'many' }, { id: 'zero' }] },
  ]
  let selected = 0, openedOverview = 0, activeId = null, drawerOpen = false
  const managed = []
  const appManage = new Function('setActiveSetlistId', 'setIsSetlistDrawerOpen', `${manageCallback}; return callback`)(
    id => { activeId = id }, open => { drawerOpen = open })
  const props = {
    songs, activeSongIndex: -1, onSelectSong: () => selected++, onNewSong() {}, onDeleteSong() {},
    onOpenSetlists: () => openedOverview++, onSongMembershipChange() {}, onCreateSetlistForSong() {},
    onManageSetlist: sl => { managed.push(sl); appManage(sl) },
  }
  const root = createRoot(document.getElementById('root'))
  const render = async () => act(async () => root.render(React.createElement(SongbookHomeView, { ...props, setlists })))
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
    assert.equal(single.getAttribute('aria-label'), 'Used in 1 setlist')
    assert.equal(single.textContent, '1', 'card stays count only')
    assert.equal(find('song-setlist-count-1').textContent, '3')
    await click(find('song-menu-1'))
    await click(single)
    assert.equal(document.querySelectorAll('[data-dropdown-portal]').length, 1, 'badge replaces existing menu')
    expectItems(0, [setlists[0]])
    assert.equal(single.getAttribute('aria-expanded'), 'true')
    assert.equal(single.getAttribute('aria-controls'), find('membership-popover-0').id)
    assert.equal(find('membership-popover-0').getAttribute('role'), 'dialog')
    await click(find('jump-setlist-stable-a'))
    assert.equal(managed.at(-1), setlists[0], 'passes canonical object')
    assert.equal(activeId, 'stable-a')
    assert.equal(drawerOpen, true)
    assert.equal(portal(), null)

    const multiple = find('song-setlist-indicator-1')
    // A tap ends with the browser's click activation; dispatch touch events first.
    for (const type of ['touchstart', 'touchend']) await act(async () => multiple.dispatchEvent(new window.Event(type, { bubbles: true })))
    await click(multiple)
    expectItems(1, setlists.slice(0, 3))
    await click(find('jump-setlist-42'))
    assert.equal(activeId, 42, 'duplicate names navigate by selected stable ID')
    assert.equal(managed.at(-1), setlists[1])
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
    assert.equal(activeId, 'stable-c')
    assert.equal(managed.at(-1), setlists[2])
    assert.equal(selected, 0, 'badge and item never launch normal song action')
    assert.equal(openedOverview, 0, 'item only opens selected manage drawer')
    await click(find('song-card-0'))
    assert.equal(selected, 1, 'normal card action still works')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    Object.assign(global, previous)
  }
})
