const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/' })
Object.assign(global, { window: dom.window, document: dom.window.document, Node: dom.window.Node, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: fn => fn() })
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client')
const { renderToStaticMarkup } = require('react-dom/server')
const { DesktopEditor } = require('../src/components/DesktopEditor.tsx')
const { SongLineRenderer } = require('../src/components/SongLineRenderer.tsx')
const { parseGtarSong } = require('../src/utils/songParser.ts')
const { syncCanonicalDirectives } = require('../src/utils/chordProMetadata.ts')
const { chordLyricWords, twoLineSegments } = require('../src/utils/chordLyricLayout.ts')
const { persistLibrary, readPersistedLibrary } = require('../src/utils/syncJournal.ts')
const { createBackupPayload, parseBackupJson } = require('../src/utils/jsonBackup.ts')
const { computeSongbookChecksum, songEquals } = require('../src/utils/cloudSongbookSync.ts')
const song = { id: 'field-song', title: 'Field Song', artist: 'Old Band', key: 'Bb', capo: '2', bpm: '96', time: '4/4', year: '2024', tags: '', transposeOffset: 0, format: 'CHORD_PRO', rawContent: '{title: Field Song}\n{artist: Old Band}\n{subtitle: Legacy Band}\n{a: Old Alias}\n{capo: 2}\n{custom: keep}\n[Bb]Sing the [F/A]song' }
const change = async (el, value) => act(async () => {
  Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
})
const click = async selector => act(async () => document.querySelector(selector).click())

test('DEV2A artist edit, clear, reload, backup and cloud contract agree without touching body or legacy capo', async () => {
  localStorage.clear()
  let saved = { ...song }, fail = false
  const root = createRoot(document.getElementById('root'))
  const props = () => ({ song: saved, transposeOffset: 0, onUpdateSong(update) { if (fail) return false; saved = { ...saved, ...update }; persistLibrary({ songs: [saved], setlists: [] }); return true }, onSaveSong(update) { if (fail) return false; saved = update; persistLibrary({ songs: [saved], setlists: [] }); return true } })
  try {
    await act(async () => root.render(React.createElement(DesktopEditor, props())))
    await change(document.querySelector('input[placeholder="Artist / Band"]'), 'New Band')
    assert.equal(saved.artist, 'New Band')
    assert.equal(parseGtarSong(saved.rawContent).artist, 'New Band')
    assert.match(document.querySelector('textarea').value, /\{artist: New Band\}/)
    assert.match(document.body.textContent, /New Band/)
    await click('[aria-label="Save changes"]')
    assert.equal(saved.capo, '2')
    assert.ok(saved.rawContent.endsWith('[Bb]Sing the [F/A]song'))
    assert.match(saved.rawContent, /\{capo: 2\}/)
    assert.match(saved.rawContent, /\{custom: keep\}/)
    const reloaded = readPersistedLibrary().songs[0]
    assert.equal(reloaded.artist, 'New Band')
    const backup = parseBackupJson(JSON.stringify(createBackupPayload([reloaded], [])))
    assert.equal(backup.isValid, true)
    assert.equal(backup.songs[0].artist, 'New Band')
    assert.equal(parseGtarSong(backup.songs[0].rawContent).artist, 'New Band')
    assert.notEqual(computeSongbookChecksum({ songs: [song], setlists: [] }), computeSongbookChecksum({ songs: [saved], setlists: [] }))
    assert.equal(songEquals(song, saved), false)
    await act(async () => root.render(null))
    saved = reloaded
    await act(async () => root.render(React.createElement(DesktopEditor, props())))
    assert.equal(document.querySelector('input[placeholder="Artist / Band"]').value, 'New Band')
    await change(document.querySelector('input[placeholder="Artist / Band"]'), '')
    await click('[aria-label="Save changes"]')
    assert.equal(saved.artist, '')
    assert.equal(parseGtarSong(saved.rawContent).artist, '')
    assert.doesNotMatch(saved.rawContent, /\{(?:artist|a|subtitle|st):/)
    await change(document.querySelector('textarea'), saved.rawContent.replace('{title: Field Song}', '{title: Field Song}\n{artist: Raw Band}'))
    assert.equal(saved.artist, 'Raw Band')
    assert.equal(document.querySelector('input[placeholder="Artist / Band"]').value, 'Raw Band')
    await change(document.querySelector('textarea'), saved.rawContent.replace(/\{artist: Raw Band\}\n/g, ''))
    assert.equal(saved.artist, '')
    await change(document.querySelector('input[placeholder="Artist / Band"]'), 'Raw Band')
    fail = true
    await change(document.querySelector('input[placeholder="Artist / Band"]'), 'Unsaved Band')
    assert.equal(saved.artist, 'Raw Band')
    assert.match(document.body.textContent, /Unsaved/)
    await click('[aria-label="Save changes"]')
    assert.match(document.body.textContent, /Changes are not saved/)
    await click('[aria-label="Song Details & Metadata"]')
    assert.doesNotMatch(document.querySelector('.fixed.inset-0').textContent, /Capo/)
  } finally { await act(async () => root.unmount()) }
})

test('DEV2A Insert portal exposes seven options, inserts at caret and preserves wrapper and toolbar actions', async () => {
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(DesktopEditor, { song, transposeOffset: 0, onUpdateSong: () => true })))
    assert.equal(document.querySelectorAll('[aria-label="Save changes"]').length, 1)
    for (const label of ['Copy', 'Paste', 'Select All', 'Clear', 'Song Details & Metadata']) assert.ok(document.querySelector(`[aria-label="${label}"]`))
    assert.doesNotMatch(document.body.textContent, /\[Chords\]|\[Section\]|Insert:/)
    const textarea = document.querySelector('textarea')
    for (const name of ['Intro', 'Verse 1', 'Chorus', 'Bridge', 'Solo', 'Outro', 'Tab']) {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      await click('[aria-label="Insert section"]')
      assert.equal(document.querySelectorAll('[role="menuitem"]').length, 7)
      const option = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.trim() === name)
      await act(async () => option.click())
      assert.ok(textarea.value.endsWith(`[${name}]\n`))
      assert.equal(document.querySelector('[role="menu"]'), null)
    }
    textarea.setSelectionRange(0, 5)
    await click('[aria-label="Wrap selection or insert brackets []"]')
    assert.ok(textarea.value.startsWith('[{titl]'))
    await click('[aria-label="Insert section"]')
    await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(document.querySelector('[role="menu"]'), null)
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Insert section')
  } finally { await act(async () => root.unmount()) }
})

test('DEV2A supplied metadata replaces aliases and clearing never resurrects stale artist', () => {
  const source = '{a: stale}\r\n{st: stale}\r\n{artist: old}\r\n{artist: duplicate}\r\n{capo: 3}\r\n[Bb]body'
  for (const artist of ['Current', '']) {
    const result = syncCanonicalDirectives(source, { artist })
    assert.equal(parseGtarSong(result).artist, artist)
    assert.ok(result.endsWith('{capo: 3}\r\n[Bb]body'))
    assert.doesNotMatch(result, /stale|duplicate|old/)
  }
})

test('DEV2A every supported size and font keeps exact chord anchors, wrapping units and authored data', () => {
  const raw = 'Before [Bbmaj7]wonderful words go [F/A]on and [Ebadd9]forever in a very long wrapping line with [Ab]flats and mid[D/F#]word syllables [G7]'
  const parsed = parseGtarSong(raw), snapshot = JSON.stringify(parsed)
  const expected = parsed.lines[0].segments.filter(s => s.chord).map(s => [s.chord, s.text.match(/\S+\s*|\s+/)?.[0] || '\u00a0'])
  for (const fontFamily of ['mono', 'sans', 'serif']) for (let fontSizePx = 12; fontSizePx <= 38; fontSizePx++) {
    const html = renderToStaticMarkup(React.createElement(SongLineRenderer, { lines: parsed.lines, fontSizePx, fontFamily, chordScale: 1.3 }))
    const document = new JSDOM(html).window.document
    assert.deepEqual([...document.querySelectorAll('[data-chord]')].map(el => [el.dataset.chord, el.querySelector('.stage-lyric-text').textContent]), expected)
    assert.equal([...document.querySelectorAll('.stage-lyric-text')].map(el => el.textContent).join('').replace(/\u00a0$/, ''), parsed.lines[0].segments.map(s => s.text).join(''))
    assert.match(html, /flex-wrap:wrap/)
    assert.equal(JSON.stringify(parsed), snapshot)
  }
  const legacy = twoLineSegments('Bb    F/A       Ebadd9', 'Sing  together  forever')
  assert.deepEqual(legacy.map(s => [s.chord, s.text]), [['Bb', 'Sing  '], ['F/A', 'together  '], ['Ebadd9', 'forever']])
  assert.equal(chordLyricWords(legacy).flat().map(s => s.text).join(''), 'Sing  together  forever')
})
