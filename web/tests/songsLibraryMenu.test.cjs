// #149 S1: Songs Library has no Key sort/filter, and a ⋯ menu opens the existing song import.
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node })
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
global.IS_REACT_ACT_ENVIRONMENT = true
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')

const songs = [
  { id: '1', title: 'Bravo', artist: 'Z', key: 'G', rawContent: '{title: Bravo}' },
  { id: '2', title: 'Alpha', artist: 'Y', key: 'C', rawContent: '{title: Alpha}' },
]
let root
const mount = async (props = {}) => {
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(SongbookHomeView, {
    songs, setlists: [], activeSongIndex: 0, activeTab: 'my_songs',
    onSelectSong: () => {}, onNewSong: () => {}, onOpenSetlists: () => {}, onDeleteSong: () => {}, ...props,
  })))
}
beforeEach(() => { localStorage.clear(); document.body.innerHTML = '<div id="root"></div>' })
afterEach(async () => { await act(async () => root?.unmount()); root = null })

test('no Key sort option and no Key filter', async () => {
  await mount()
  const options = [...document.querySelectorAll('option')].map(o => o.value)
  assert.ok(options.includes('title') && options.includes('artist') && options.includes('date'))
  assert.ok(!options.includes('key'), 'Key sort removed')
  assert.doesNotMatch(document.body.textContent, /All Keys|Key:/)
})

test('a saved Key sort falls back to title, and a saved key filter no longer hides songs', async () => {
  localStorage.setItem('gtar_songbook_sort', 'key')
  localStorage.setItem('gtar_songbook_filter_key', 'G')
  await mount()
  const sort = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'artist'))
  assert.equal(sort.value, 'title')
  assert.match(document.body.textContent, /Songs Library \(2 of 2\)/)
  assert.ok(document.body.textContent.indexOf('Alpha') < document.body.textContent.indexOf('Bravo'), 'sorted by title')
})

test('⋯ menu opens the existing import, and is absent without a handler', async () => {
  await mount()
  assert.equal(document.querySelector('[data-testid="songs-library-menu-btn"]'), null)
  await act(async () => root.unmount())
  document.body.innerHTML = '<div id="root"></div>'
  let opened = 0
  await mount({ onOpenImportSongs: () => { opened++ } })
  const btn = document.querySelector('[data-testid="songs-library-menu-btn"]')
  assert.ok(btn)
  await act(async () => btn.click())
  const item = document.querySelector('[data-testid="songs-library-menu-import"]')
  assert.ok(item, 'menu shows Import songs')
  await act(async () => item.click())
  assert.equal(opened, 1)
  assert.equal(document.querySelector('[data-testid="songs-library-menu-import"]'), null, 'menu closes after choosing')
})

test('⋯ menu is available on an empty library', async () => {
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(SongbookHomeView, {
    songs: [], setlists: [], activeSongIndex: 0, activeTab: 'my_songs', onOpenImportSongs: () => {},
    onSelectSong: () => {}, onNewSong: () => {}, onOpenSetlists: () => {}, onDeleteSong: () => {},
  })))
  assert.ok(document.querySelector('[data-testid="songs-library-menu-btn"]'))
})

test('#149 S2: ⋯ menu → AI Worker opens the duplicate check', async () => {
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  await mount({ onTrashDuplicates: () => true })
  await act(async () => document.querySelector('[data-testid="songs-library-menu-btn"]').click())
  assert.equal(document.querySelector('[data-testid="songs-library-menu-import"]'), null, 'no Import item without its handler')
  await act(async () => document.querySelector('[data-testid="songs-library-menu-duplicates"]').click())
  assert.ok(document.querySelector('[data-testid="duplicate-review-dialog"]'))
  assert.match(document.querySelector('[data-testid="duplicate-summary"]').textContent, /No duplicates found/)
})

test('#149 layout: Songs Library controls sit inside the filter box, right side Manage → ⋯ → Hide', async () => {
  await mount({ onOpenImportSongs: () => {}, onTrashDuplicates: () => true })
  const box = document.querySelector('[data-testid="songs-library-toolbar"]')
  assert.ok(box.querySelector('#songbook-sort-filter-options select'), 'filters are inside the box')
  const actions = box.querySelector('[data-testid="songs-library-actions"]')
  assert.deepEqual([...actions.querySelectorAll('button')].map(b => b.getAttribute('data-testid')),
    ['toggle-song-selection-mode', 'songs-library-menu-btn', 'toggle-sort-filter-options'])
  const header = document.querySelector('section[aria-label="Songs Library"] > div')
  assert.equal(header.querySelector('button'), null, 'no controls left outside the box')
  await act(async () => document.querySelector('[data-testid="toggle-sort-filter-options"]').click())
  assert.equal(document.getElementById('songbook-sort-filter-options').hidden, true)
  assert.ok(document.querySelector('[data-testid="toggle-sort-filter-options"]'), 'Show stays reachable while filters are hidden')
})
