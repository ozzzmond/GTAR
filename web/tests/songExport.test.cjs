// #149 S5: Songs Library export as TXT (ChordPro, as stored) or printable PDF (chords above lyrics).
const { test, afterEach } = require('node:test')
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
const exp = require('../src/utils/songExport.ts')
const { ExportSongsDialog } = require('../src/components/ExportSongsDialog.tsx')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')

const song = (id, extra = {}) => ({ id, title: `Song ${id}`, artist: 'Band', key: 'G', capo: 'No Capo', bpm: '120', rawContent:
  `{title: Song ${id}}\n{key: G}\n\n{comment: Verse 1}\n[G]Hello [C]world & "friends"\n`, format: 'CHORD_PRO', transposeOffset: 0, ...extra })

test('TXT: one song is the stored chart; several songs share one file with {new_song}', () => {
  const one = exp.songsToTxt([song('a', { title: 'Go / Live?' })])
  assert.equal(one.filename, 'Go Live.txt')
  assert.equal(one.text, song('a').rawContent)
  const many = exp.songsToTxt([song('a'), song('b')])
  assert.equal(many.filename, 'GTAR songs (2).txt')
  assert.equal(many.text.split('{new_song}').length, 2)
  assert.ok(many.text.includes('{title: Song a}') && many.text.includes('{title: Song b}'))
})

test('PDF page: chords above lyrics, sections, one song per page, escaped text, no script', () => {
  const html = exp.buildPrintHtml([song('a'), song('b')], 'saved')
  assert.equal((html.match(/<section class="song">/g) || []).length, 2)
  assert.match(html, /break-after: page/)
  assert.match(html, /<h3>Verse 1<\/h3>/)
  assert.match(html, /<span class="c">G<\/span><span class="l">Hello <\/span>/)
  assert.match(html, /world &amp; &quot;friends&quot;/, 'chart text is escaped')
  assert.doesNotMatch(html, /<script/i)
  assert.match(html, /Key G/)
})

test('PDF page: transposed key uses each song\'s current offset; saved key leaves chords as stored', () => {
  const s = song('a', { transposeOffset: 2 })
  const saved = exp.buildPrintHtml([s], 'saved')
  assert.match(saved, /<span class="c">G<\/span>/)
  const moved = exp.buildPrintHtml([s], 'transposed')
  assert.match(moved, /<span class="c">A<\/span>/)
  assert.match(moved, /Key A/)
})

test('print opens from the click and reports a blocked pop-up', () => {
  let written = '', printed = 0
  const win = { document: { open() {}, write(h) { written += h }, close() {} }, focus() {}, print() { printed++ } }
  assert.equal(exp.printSongs([song('a')], 'saved', () => win), true)
  assert.match(written, /<h1>Song a<\/h1>/)
  assert.equal(exp.printSongs([song('a')], 'saved', () => null), false)
  return new Promise(r => setTimeout(() => { assert.equal(printed, 1); r() }, 350))
})

let root
afterEach(async () => { await act(async () => root?.unmount()); root = null })
const render = async (el, props) => {
  document.body.innerHTML = '<div id="root"></div>'
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(el, props)))
}

test('dialog: nothing preselected by default; TXT downloads the chosen songs', async () => {
  const urls = []
  global.URL.createObjectURL = blob => { urls.push(blob); return 'blob:x' }
  global.URL.revokeObjectURL = () => {}
  const clicks = []
  dom.window.HTMLAnchorElement.prototype.click = function () { clicks.push(this.download) }
  await render(ExportSongsDialog, { songs: [song('a'), song('b')], onClose() {} })
  assert.equal(document.querySelector('[data-testid="export-run-btn"]').disabled, true)
  await act(async () => document.querySelectorAll('input[type="checkbox"]')[1].click())
  await act(async () => document.querySelector('[data-testid="export-run-btn"]').click())
  assert.deepEqual(clicks, ['Song b.txt'])
  assert.equal(urls.length, 1)
})

test('dialog: Manage selection is preselected; PDF offers saved or transposed key', async () => {
  await render(ExportSongsDialog, { songs: [song('a'), song('b')], preselected: ['a'], onClose() {} })
  assert.equal(document.querySelector('[data-testid="export-selected-count"]').textContent, '1 selected')
  assert.equal(document.querySelector('[data-testid="export-key-saved"]'), null, 'key choice only for PDF')
  await act(async () => document.querySelector('[data-testid="export-format-pdf"]').click())
  assert.ok(document.querySelector('[data-testid="export-key-saved"]').checked)
  assert.ok(document.querySelector('[data-testid="export-key-transposed"]'))
})

test('Songs Library ⋯ menu has Export songs, which opens the dialog', async () => {
  await render(SongbookHomeView, { songs: [song('a')], setlists: [], activeSongIndex: 0, activeTab: 'my_songs',
    onOpenImportSongs() {}, onSelectSong() {}, onNewSong() {}, onOpenSetlists() {}, onDeleteSong() {} })
  await act(async () => document.querySelector('[data-testid="songs-library-menu-btn"]').click())
  await act(async () => document.querySelector('[data-testid="songs-library-menu-export"]').click())
  assert.ok(document.querySelector('[data-testid="export-songs-dialog"]'))
})
