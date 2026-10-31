// #170: autosaved edits are confirmed when the editor closes; failed or absent edits are not.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: fn => fn() })
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { DesktopEditor } = require('../src/components/DesktopEditor.tsx')

const { normalizeTags, matchesSongTags } = require('../src/utils/songTags.ts')
const { createBackupPayload, parseBackupJson } = require('../src/utils/jsonBackup.ts')
const { normalizeSongbookIds } = require('../src/utils/songbookFoundation.ts')
const { songEquals } = require('../src/utils/cloudSongbookSync.ts')
const song = { id: 'multi-1', title: 'Song', artist: 'A', key: 'G', rawContent: '{title: Song}\n{artist: A}\n{key: G}\n{tempo: 120 BPM}\n[G] Lyrics', capo: '', bpm: '120', tags: ' Worship, Acoustic ', format: 'CHORD_PRO', transposeOffset: 0 }

test('normalization: legacy, arrays, empties, ordering, first spelling, no input mutation', () => {
  for (const value of [null, undefined, '', ' , ', []]) assert.deepEqual(normalizeTags(value), [])
  assert.deepEqual(normalizeTags(' Rock, jazz, ROCK, , Jazz '), ['Rock', 'jazz'])
  const input = [' Folk ', '', null, 'FOLK', 'Live, loud', 'Jazz']
  assert.deepEqual(normalizeTags(input), ['Folk', 'Live, loud', 'Jazz'])
  assert.equal(input[0], ' Folk ')
  assert.equal(matchesSongTags(' Folk, Jazz', 'JAZ'), true)
  assert.equal(matchesSongTags(['Folk', 'Jazz'], 'jaz'), true)
  assert.equal(matchesSongTags(null, 'rock'), false)
  assert.equal(songEquals({...song, tags:'Folk, Jazz'}, {...song, tags:['Jazz', 'folk']}), true)
})

test('backup round-trip: arrays and legacy; no ID/reference/content mutation or eager migration', () => {
  const sl = { id:'gig', name:'Gig', songs:[{id:song.id, title:song.title, artist:song.artist}] }
  for (const tags of [song.tags, ['Worship', 'Acoustic'], null, undefined]) {
    const original = {...song, tags}
    const before = JSON.stringify(original)
    const result = parseBackupJson(JSON.stringify(createBackupPayload([original], [sl])))
    assert.equal(result.isValid, true, result.error)
    assert.deepEqual(normalizeTags(result.songs[0].tags), normalizeTags(tags))
    assert.equal(result.songs[0].id, song.id)
    assert.equal(result.songs[0].rawContent, song.rawContent)
    assert.equal(result.setlists[0].songs[0].id, song.id)
    assert.equal(JSON.stringify(original), before)
  }
  const loaded = normalizeSongbookIds([song], [sl])
  assert.equal(loaded.migrated, false)
  assert.equal(loaded.songs[0].tags, song.tags)
  assert.equal(song.tags, ' Worship, Acoustic ')
  assert.equal(parseBackupJson(JSON.stringify({songs:[{...song,tags:[7]}]})).isValid, false)
})

test('Editor: legacy display, add/remove, dirty, save and reload arrays', async () => {
  const root = createRoot(document.getElementById('root'))
  let saved
  const render = async value => act(async () => root.render(React.createElement(DesktopEditor, {
    song:value, transposeOffset:0, onUpdateSong: value => { saved=value; return true }, onSaveSong: value => { saved=value; return true },
  })))
  try {
    await render(song)
    await act(async () => document.querySelector('[aria-label="Song Details & Metadata"]').click())
    assert.ok(document.querySelector('[aria-label="Remove tag Worship"]'))
    await act(async () => document.querySelector('[aria-label="Remove tag Worship"]').click())
    assert.equal(document.querySelector('[data-testid="editor-save-status"]').dataset.saveStatus, 'UNSAVED')
    assert.equal(saved, undefined, 'tag drafts do not mutate the original song before save')
    const input = document.querySelector('[aria-label="Add tags"]')
    await act(async () => {
      input.value = ' Jazz, ACOUSTIC '
      input.dispatchEvent(new window.KeyboardEvent('keydown', {key:'Enter', bubbles:true}))
    })
    await act(async () => document.querySelector('[aria-label="Save changes"]').click())
    assert.deepEqual(saved.tags, ['Acoustic', 'Jazz'])
    assert.equal(saved.id, song.id)
    assert.equal(saved.rawContent, song.rawContent)
    assert.equal(document.querySelector('[data-testid="editor-save-status"]').dataset.saveStatus, 'SAVED')
    await render({...saved})
    assert.ok(document.querySelector('[aria-label="Remove tag Jazz"]'))
    assert.equal(document.querySelector('[aria-label="Remove tag Worship"]'), null)
  } finally { await act(async () => root.unmount()) }
})
