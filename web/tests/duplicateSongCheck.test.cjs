// #149 S2: deterministic duplicate check, delete validation, setlist re-pointing and the review dialog.
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
const dup = require('../src/utils/duplicateSongs.ts')
const { transitionSongLibrary, repointSetlists } = require('../src/utils/setlistSongs.ts')
const { DuplicateReviewDialog } = require('../src/components/DuplicateReviewDialog.tsx')

const song = (id, title, raw, extra = {}) => ({ id, title, artist: 'Band', key: 'G', capo: '', bpm: '', rawContent: raw, format: 'chordpro', transposeOffset: 0, ...extra })
const BODY = '{title: Go}\n[G]Go and [C]tell it\n[D]on the mountain'
const TRANSPOSED = '{title: Go}\n{key: A}\n[A]Go and [D]tell it\n[E]on the mountain'
const OTHER = '{title: Go}\n[G]A different [C]song entirely'
const list = (id, name, ids, extra = {}) => ({ id, name, songs: ids.map(i => ({ id: i, title: 'Go', artist: 'Band' })), ...extra })

beforeEach(() => { localStorage.clear(); document.body.innerHTML = '<div id="root"></div>' })

test('normalization ignores line whitespace for exact copies and chords for lyrics', () => {
  assert.equal(dup.normalizeChartBody('  [G]Go   and \r\n\r\n tell '), dup.normalizeChartBody('[G]Go and\ntell'))
  assert.equal(dup.lyricsSignature(BODY), dup.lyricsSignature(TRANSPOSED))
  assert.notEqual(dup.lyricsSignature(BODY), dup.lyricsSignature(OTHER))
})

test('exact copies: unused copy is safe, used copy is re-pointed, most-used copy is kept', () => {
  const songs = [song('a', 'Go', BODY), song('b', 'Go', BODY + '\n'), song('c', 'Go (copy)', '  ' + BODY)]
  const [g] = dup.findDuplicateGroups(songs, [list('s1', 'Sunday', ['b']), list('s2', 'Friday', ['b', 'c'])])
  assert.equal(g.kind, 'exact')
  assert.deepEqual(g.copies.map(c => [c.id, c.verdict]), [['a', 'safe'], ['b', 'keep'], ['c', 'repoint']])
  assert.deepEqual(dup.planDuplicateCleanup(g), { trash: ['a', 'c'], repoint: { c: 'b' } })
})

test('likely duplicate (transposed): review when unused, blocked when in a setlist; distinct versions get no delete', () => {
  const songs = [song('a', 'Go', BODY), song('b', 'Go', TRANSPOSED), song('c', 'Go', OTHER)]
  const groups = dup.findDuplicateGroups(songs, [list('s1', 'Sunday', ['a'])])
  const likely = groups.find(g => g.kind === 'likely')
  assert.deepEqual(likely.copies.map(c => [c.id, c.verdict]), [['a', 'keep'], ['b', 'review']])
  const distinct = groups.find(g => g.kind === 'distinct')
  assert.ok(distinct.copies.every(c => c.verdict === 'info'))
  assert.deepEqual(dup.planDuplicateCleanup(distinct), { trash: [], repoint: {} })
  const blocked = dup.findDuplicateGroups(songs, [list('s1', 'Sunday', ['a', 'b'])], {
    keepChoices: { [likely.dismissKey]: 'a' } }).find(g => g.kind === 'likely')
  assert.equal(blocked.copies.find(c => c.id === 'b').verdict, 'blocked')
  assert.deepEqual(dup.planDuplicateCleanup(blocked).trash, [])
})

test('trashed songs, deleted setlists, empty bodies and different titles are not matched as duplicates', () => {
  const songs = [song('a', 'Go', BODY), song('b', 'Go', BODY, { isDeleted: true }), song('c', 'X', ''), song('d', 'Y', '')]
  assert.deepEqual(dup.findDuplicateGroups(songs, []), [])
  const used = dup.findDuplicateGroups([song('a', 'Go', BODY), song('b', 'Go', BODY)], [list('s1', 'Old', ['b'], { isDeleted: true })])
  assert.equal(used[0].copies.find(c => c.id === 'b').setlists.length, 0)
})

test('"Not a duplicate" is remembered per content and comes back when a copy changes', () => {
  const songs = [song('a', 'Go', BODY), song('b', 'Go', BODY)]
  const [g] = dup.findDuplicateGroups(songs, [])
  dup.dismissDuplicateGroup(g.dismissKey)
  assert.deepEqual(dup.findDuplicateGroups(songs, [], { dismissed: dup.readDismissedDuplicates() }), [])
  const edited = [songs[0], { ...songs[1], rawContent: BODY + '\n[G]new line' }]
  const again = dup.findDuplicateGroups([...edited, song('c', 'Go', BODY)], [], { dismissed: dup.readDismissedDuplicates() })
  assert.ok(again.some(x => x.kind === 'exact'))
})

test('trash with repoint: refs move to the kept song, no duplicate entry, other refs untouched, bad target refused', () => {
  const songs = [song('a', 'Go', BODY), song('b', 'Go', BODY), song('z', 'Other', OTHER)]
  const setlists = [list('s1', 'Sunday', ['b', 'z']), list('s2', 'Friday', ['a', 'b', 'z', 'z'])]
  const next = transitionSongLibrary({ active: songs, deleted: [], setlists }, { kind: 'trash', ids: ['b'], blank: song('blank', '', ''), repoint: { b: 'a' } })
  assert.deepEqual(next.active.map(s => s.id), ['a', 'z'])
  assert.deepEqual(next.deleted.map(s => [s.id, s.isDeleted]), [['b', true]])
  assert.deepEqual(next.setlists.map(l => l.songs.map(r => r.id)), [['a', 'z'], ['a', 'z', 'z']])
  assert.throws(() => repointSetlists(setlists, { b: 'missing' }, songs), /not an active song/)
  assert.throws(() => transitionSongLibrary({ active: songs, deleted: [], setlists },
    { kind: 'trash', ids: ['a', 'b'], blank: song('blank', '', ''), repoint: { b: 'a' } }), /not an active song/)
})

test('1,500-song library scans quickly', () => {
  const songs = Array.from({ length: 1500 }, (_, i) => song(`s${i}`, `Song ${i % 1400}`, `{title: Song ${i % 1400}}\n[G]Line ${i % 1450}`))
  const start = Date.now()
  const groups = dup.findDuplicateGroups(songs, [])
  assert.ok(Date.now() - start < 1000)
  assert.ok(groups.length > 0)
})

let root
afterEach(async () => { await act(async () => root?.unmount()); root = null })

test('dialog: confirm step before Move to Trash, then calls back with the plan', async () => {
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const songs = [song('a', 'Go', BODY), song('b', 'Go', BODY)]
  const calls = []
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(DuplicateReviewDialog, {
    songs, setlists: [list('s1', 'Sunday', ['b'])], onClose: () => {},
    onTrashDuplicates: (trash, repoint) => { calls.push({ trash, repoint }); return true },
  })))
  assert.match(document.querySelector('[data-testid="duplicate-summary"]').textContent, /1 duplicate group/)
  await act(async () => document.querySelector('[data-testid="duplicate-trash-btn"]').click())
  assert.equal(calls.length, 0, 'nothing changes before confirmation')
  assert.ok(document.querySelector('[data-testid="duplicate-confirm"]'))
  await act(async () => document.querySelector('[data-testid="duplicate-confirm-btn"]').click())
  assert.deepEqual(calls, [{ trash: ['a'], repoint: {} }])
  assert.match(document.body.textContent, /Moved 1 copy of “Go” to Trash/)
})

test('dialog: Not a duplicate hides the group and persists', async () => {
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  const songs = [song('a', 'Go', BODY), song('b', 'Go', BODY)]
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(DuplicateReviewDialog, { songs, setlists: [], onClose: () => {}, onTrashDuplicates: () => true })))
  await act(async () => document.querySelector('[data-testid="duplicate-not-duplicate-btn"]').click())
  assert.match(document.querySelector('[data-testid="duplicate-summary"]').textContent, /No duplicates found/)
  assert.equal(dup.readDismissedDuplicates().length, 1)
})
