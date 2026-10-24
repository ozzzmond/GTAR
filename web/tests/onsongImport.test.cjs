// #149 S4: .cho and .onsong import. OnSong text converts to ChordPro without inventing data; archives are refused.
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node })
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
global.IS_REACT_ACT_ENVIRONMENT = true
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { onsongToChordPro, looksLikeArchive, SONG_FILE_EXTENSIONS } = require('../src/utils/onsongImport.ts')
const { ImportDialogModal } = require('../src/components/ImportDialogModal.tsx')

const ONSONG = [
  'Amazing Grace', 'John Newton', 'Key: G', 'Tempo: 72', 'Time: 3/4', 'Capo: 2', 'CCLI: 22025', '',
  'Verse 1:', 'A[G]mazing [C]grace how [G]sweet the sound', '', 'Chorus:', '[D]My chains are gone', '',
].join('\r\n')

test('OnSong header and sections become ChordPro; body lines are kept; key is the chart key only', () => {
  const out = onsongToChordPro(ONSONG)
  assert.equal(out.title, 'Amazing Grace')
  assert.equal(out.artist, 'John Newton')
  const lines = out.content.split('\n')
  assert.deepEqual(lines.slice(0, 7), ['{title: Amazing Grace}', '{artist: John Newton}', '{key: G}', '{tempo: 72}', '{time: 3/4}', '{capo: 2}', '{ccli: 22025}'])
  assert.ok(lines.includes('{comment: Verse 1}') && lines.includes('{comment: Chorus}'))
  assert.ok(lines.includes('A[G]mazing [C]grace how [G]sweet the sound'))
  assert.ok(!out.content.includes('original_key'), 'never claims an original key')
  assert.deepEqual(out.warnings, [])
})

test('labelled headers, missing header, and unknown labels: nothing invented, nothing dropped', () => {
  const labelled = onsongToChordPro('Title: Go\nArtist: Hillsong United\n\n[C]Go')
  assert.equal(labelled.title, 'Go'); assert.equal(labelled.artist, 'Hillsong United')
  const bare = onsongToChordPro('[G]Just a chart line\n[C]Another')
  assert.equal(bare.title, undefined)
  assert.match(bare.warnings[0], /No title/)
  assert.ok(bare.content.includes('[G]Just a chart line') && bare.content.includes('[C]Another'))
  const unknown = onsongToChordPro('Song\nBand\nFlow: V1 C V2\n\n[G]x')
  assert.ok(unknown.content.includes('Flow: V1 C V2'), 'unknown label kept in the body')
})

test('zip, SQLite and binary content are recognised as archives', () => {
  assert.equal(looksLikeArchive('PK\u0003\u0004rest'), true)
  assert.equal(looksLikeArchive('SQLite format 3\u0000'), true)
  assert.equal(looksLikeArchive(ONSONG), false)
  assert.ok(SONG_FILE_EXTENSIONS.includes('.cho') && SONG_FILE_EXTENSIONS.includes('.onsong'))
})

let root
afterEach(async () => { await act(async () => root?.unmount()); root = null })
const mount = async props => {
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(ImportDialogModal, { isOpen: true, onClose() {}, onImportSong() {}, onImportAllSongs() {}, ...props })))
}
const pick = async (name, text) => {
  const input = document.querySelector('input[type="file"]:not([multiple])')
  const file = new dom.window.File([text], name, { type: '' })
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => { input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 20)) })
}

test('dialog: the file picker lists .cho and .onsong; an .onsong file is previewed and only saved on confirm', async () => {
  const imported = []
  await mount({ onImportSong: s => imported.push(s) })
  const accept = document.querySelector('input[type="file"]:not([multiple])').getAttribute('accept')
  assert.ok(accept.includes('.cho') && accept.includes('.onsong'), accept)
  assert.match(document.body.textContent, /\.cho, \.chordpro, \.onsong/)
  await pick('amazing.onsong', ONSONG)
  assert.ok(document.querySelector('[data-testid="onsong-preview"]'))
  assert.equal(imported.length, 0, 'nothing saved before confirmation')
  await act(async () => document.querySelector('[data-testid="onsong-import-confirm"]').click())
  assert.equal(imported.length, 1)
  assert.equal(imported[0].title, 'Amazing Grace')
  assert.equal(imported[0].artist, 'John Newton')
  assert.equal(imported[0].key, 'G')
  assert.match(imported[0].rawContent, /^\{title: Amazing Grace\}/)
})

test('dialog: a .cho file imports directly as ChordPro; an OnSong archive is refused with a clear message', async () => {
  const imported = []
  await mount({ onImportSong: s => imported.push(s) })
  await pick('go.cho', '{title: Go}\n{artist: Hillsong United}\n[C]Go')
  assert.equal(imported.length, 1)
  assert.equal(imported[0].title, 'Go')
  await pick('library.onsong', 'PK\u0003\u0004\u0000\u0000binary')
  assert.equal(imported.length, 1, 'archive not imported')
  assert.match(document.body.textContent, /OnSong backup or archive, not a song file/)
})
