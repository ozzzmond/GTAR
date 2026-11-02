// #312 S2: App wiring for the DEV Setlist Manager: guarded saves survive a reload, cancel adds
// nothing, a stale write is refused, and manage remains available after removing the legacy drawer.
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
// react-dom detects input-event support from the global document when it loads.
const bootDom = new JSDOM('<!doctype html>')
Object.assign(global, { window: bootDom.window, document: bootDom.window.document })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const srcDir = path.join(__dirname, '../src')
const song = (id, title, artist, key) => ({ id, title, artist, key, capo: 'No Capo', bpm: '', format: 'CHORD_PRO', transposeOffset: 0, rawContent: `{title: ${title}}\n{key: ${key}}\n[${key}]Line` })
const LIBRARY = {
  songs: [song('s1', 'Amazing Grace', 'John Newton', 'G'), song('s2', 'Goodness of God', 'Bethel Music', 'Ab'),
    song('s3', 'Great Are You Lord', 'All Sons & Daughters', 'G'), song('s4', 'Hotel California', 'Eagles', 'Bm')],
  setlists: [{ id: 'sl-1', name: 'Sunday AM', createdAt: 1, songs: [{ id: 's1', title: 'Amazing Grace', artist: 'John Newton' }] }],
}

let dom, root, home
afterEach(async () => { if (root) { await act(async () => root.unmount()); root = null } dom?.window.close() })

function freshModules() {
  for (const key of Object.keys(require.cache)) if (key.startsWith(srcDir)) delete require.cache[key]
}
async function mountApp(url, { keepStorage = false } = {}) {
  const previous = keepStorage ? dom.window.localStorage : null
  const saved = previous ? Object.fromEntries(Object.keys(previous).map(k => [k, previous.getItem(k)])) : null
  if (root) { await act(async () => root.unmount()); root = null }
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url })
  Object.assign(global, {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  global.fetch = async () => { throw new Error('offline') }
  if (saved) for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v)
  else localStorage.setItem('gtar_library_v1', JSON.stringify(LIBRARY))
  freshModules()
  const homeModule = require('../src/components/SongbookHomeView.tsx')
  homeModule.SongbookHomeView = props => { home = props; return React.createElement('div', null, 'Songbook') }
  require('../src/components/Header.tsx').Header = () => null
  const App = require('../src/App.tsx').default
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(App)))
}
const stored = () => require('../src/utils/syncJournal.ts').readPersistedLibrary()
const storedOrder = () => stored().setlists.find(sl => sl.id === 'sl-1').songs.map(ref => ref.id)
const $ = sel => document.querySelector(sel)
const $$ = sel => [...document.querySelectorAll(sel)]
const button = text => $$('button').find(b => b.textContent.includes(text))
const option = text => $$('[role="option"]').find(el => el.textContent.includes(text))
async function click(el) { assert.ok(el, 'control exists'); await act(async () => el.click()) }
async function openManagerPicker() {
  await act(async () => home.onManageSetlist(home.setlists[0]))
  assert.ok($('[role="dialog"][aria-label="Setlist Manager"]'), 'DEV manage opens the Setlist Manager')
  await click(button('Search Songs (Outlook-style Picker)'))
}

test('DEV: select N songs → one guarded add, appended in selection order, kept after reload', async () => {
  await mountApp('http://localhost/')
  assert.equal(typeof home.onOpenSetlistManager, 'function', 'DEV wires ⋯ Manage Setlists to the manager')
  await openManagerPicker()
  await click(option('Hotel California'))
  await click(option('Goodness of God'))
  await click(option('Great Are You Lord'))
  await click(button('Add 3 Selected Songs'))
  assert.deepEqual(storedOrder(), ['s1', 's4', 's2', 's3'], 'saved immediately, in selection order')
  assert.equal($('[aria-label="Multi-song search picker"]'), null)
  await mountApp('http://localhost/', { keepStorage: true })
  assert.deepEqual(home.setlists.find(sl => sl.id === 'sl-1').songs.map(ref => ref.id), ['s1', 's4', 's2', 's3'], 'reload keeps it')
})

test('DEV: cancel adds nothing', async () => {
  await mountApp('http://localhost/')
  const before = localStorage.getItem('gtar_library_v1')
  await openManagerPicker()
  await click(option('Hotel California'))
  await click(button('Cancel'))
  assert.equal($('[aria-label="Multi-song search picker"]'), null)
  assert.equal(localStorage.getItem('gtar_library_v1'), before)
  assert.deepEqual(home.setlists[0].songs.map(ref => ref.id), ['s1'])
})

test('DEV: a stale write is refused, reported, and leaves the other tab\'s save untouched', async () => {
  await mountApp('http://localhost/')
  await openManagerPicker()
  const external = JSON.stringify({ ...LIBRARY, setlists: [{ ...LIBRARY.setlists[0], name: 'Changed elsewhere' }] })
  localStorage.setItem('gtar_library_v1', external)
  await click(option('Eagles'))
  await click(button('Add 1 Selected Song'))
  assert.ok($('[aria-label="Multi-song search picker"]'), 'picker stays open on failure')
  assert.match($('[role="dialog"][aria-label="Multi-song search picker"] [role="alert"]').textContent, /not added/i)
  assert.equal(localStorage.getItem('gtar_library_v1'), external, 'no overwrite')
})

test('DEV: rename, reorder, remove and delete persist through the guarded path', async () => {
  await mountApp('http://localhost/')
  const twoSongs = { ...LIBRARY, setlists: [{ ...LIBRARY.setlists[0], songs: [{ id: 's1', title: 'Amazing Grace' }, { id: 's2', title: 'Goodness of God' }, { id: 's3', title: 'Great Are You Lord' }] }] }
  localStorage.setItem('gtar_library_v1', JSON.stringify(twoSongs))
  await mountApp('http://localhost/', { keepStorage: true })
  await act(async () => home.onOpenSetlistManager(null))
  await click(button('Rename'))
  const input = $('[data-testid="setlist-manager-rename-input"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'Sunday PM')
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await click(button('Save'))
  assert.equal(stored().setlists[0].name, 'Sunday PM')
  await click($('[data-testid="setlist-manager-entry-0-down"]'))
  assert.deepEqual(storedOrder(), ['s2', 's1', 's3'])
  await click($('[data-testid="setlist-manager-entry-2-remove"]'))
  assert.deepEqual(storedOrder(), ['s2', 's1'])
  await click(button('Delete Setlist'))
  await click($$('[role="alertdialog"] button').find(b => b.textContent === 'Delete'))
  assert.equal(stored().setlists[0].isDeleted, true, 'tombstoned like the existing delete')
  await mountApp('http://localhost/', { keepStorage: true })
  assert.equal(home.setlists.filter(sl => !sl.isDeleted).length, 0)
})

// #311 removes the legacy drawer in every build; manage must retain its replacement action.
test('manage remains available without the legacy drawer outside local development', async () => {
  await mountApp('https://gtar.example/')
  assert.equal(typeof home.onOpenSetlistManager, 'function')
  await act(async () => home.onManageSetlist(home.setlists[0]))
  assert.ok($('[role="dialog"][aria-label="Setlist Manager"]'))
})
