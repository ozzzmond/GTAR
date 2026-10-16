const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
const { parseBackupJson, normalizeBackupSong, createSingleSetlistPayload, createRestoreSafetySnapshot, RESTORE_SNAPSHOT_KEY } = require('../src/utils/jsonBackup.ts')
const { normalizeSongbookIds } = require('../src/utils/songbookFoundation.ts')
const { mergeBackupLibrary, resolveSetlistSong } = require('../src/utils/setlistSongs.ts')
const { mergeImportedSetlists } = require('../src/utils/importIdentity.ts')
const { parseBandSetlist } = require('../src/utils/bandSetlistImport.ts')
const { bandSync } = require('../src/utils/bandSync.ts')
const { persistLibrary, LIBRARY_KEY } = require('../src/utils/syncJournal.ts')
const song = normalizeBackupSong({ id: 'song-source', title: 'Song', artist: 'Artist', rawContent: '[G]Chart' })
const list = { id: 'set-source', name: 'Gig', createdAt: 1, songs: [{ id: song.id, title: song.title, artist: song.artist }] }
const library = { songs: [song], setlists: [list] }
const parse = data => parseBackupJson(JSON.stringify(data))
function merge(existing, incoming) {
  const songs = mergeBackupLibrary(existing.songs, incoming.songs, incoming.setlists)
  return { songs: songs.songs, setlists: mergeImportedSetlists(existing.setlists, songs.setlists) }
}
const payload = { setlistId: list.id, setlistName: list.name, songs: [song] }
function receive(existing, message = payload) { return merge(existing, parseBandSetlist(message, existing.songs)) }
function storage() {
  const values = new Map()
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
    key: i => [...values.keys()][i] ?? null, get length() { return values.size } }
}

test('Band Sync wire preserves source IDs across broadcast and WebSocket reception', () => {
  const sent = []
  bandSync.role = 'HOST'
  const original = bandSync.broadcastMessage
  bandSync.broadcastMessage = (type, body) => sent.push({ type, body })
  const messages = []
  const handler = message => messages.push(message)
  bandSync.messageHandlers.add(handler)
  try {
    bandSync.broadcastSetlist(list.name, [song], list.id)
    bandSync.broadcastSetlist(list.name, [song], list.id)
    for (const item of sent) bandSync.handleWebSocketMessage({ type: item.type, ...item.body })
    assert.equal(messages.length, 2)
    let result = { songs: [], setlists: [] }
    for (const message of messages) result = receive(result, message.payload)
    assert.deepEqual(result.setlists.map(item => item.id), [list.id])
    assert.deepEqual(result.songs.map(item => item.id), [song.id])
  } finally {
    bandSync.broadcastMessage = original
    bandSync.messageHandlers.delete(handler)
    bandSync.role = 'OFF'
  }
})

test('repeated reception including a reload never manufactures identities', () => {
  const first = receive({ songs: [], setlists: [] })
  const reloaded = normalizeSongbookIds(first.songs, first.setlists)
  assert.deepEqual(receive(reloaded), first)
})

test('same source rename, stale sender and conflicting revision abort without replacing originals', () => {
  const before = JSON.stringify(library)
  for (const incoming of [{ ...payload, setlistName: 'Renamed' }, { ...payload, songs: [] },
    { ...payload, songs: [{ ...song, rawContent: 'Stale chart' }] }]) {
    assert.throws(() => receive(library, incoming), /revision conflict/)
    assert.equal(JSON.stringify(library), before)
  }
})

test('independent same-name lists survive; ambiguous legacy sender aborts', () => {
  const result = receive({ songs: [song], setlists: [{ ...list, id: 'independent' }] })
  assert.deepEqual(result.setlists.map(item => item.id), ['independent', list.id])
  const before = JSON.stringify(result)
  assert.throws(() => receive(result, { ...payload, setlistId: undefined }), /Stable ID required/)
  assert.equal(JSON.stringify(result), before)
})

for (const deleted of [true, false]) test(`setlist and song lifecycle disagreement aborts in both directions: existing deleted=${deleted}`, () => {
  const existing = { songs: [{ ...song, isDeleted: deleted }], setlists: [{ ...list, isDeleted: deleted }] }
  const before = JSON.stringify(existing)
  assert.throws(() => mergeImportedSetlists(existing.setlists, [{ ...list, isDeleted: !deleted }]), /lifecycle conflict/)
  assert.throws(() => mergeBackupLibrary(existing.songs, [{ ...song, isDeleted: !deleted }], []), /lifecycle conflict/)
  assert.equal(JSON.stringify(existing), before)
})

test('matching Band Sync tombstones remain deleted; incoming deleted transmission cannot activate', () => {
  assert.throws(() => receive({ songs: [song], setlists: [{ ...list, isDeleted: true }] }), /lifecycle conflict/)
  assert.throws(() => receive({ songs: [{ ...song, isDeleted: true }], setlists: [] }), /lifecycle conflict/)
  assert.throws(() => receive(library, { ...payload, setlistDeleted: true }), /explicit resolution/)
})

test('numeric/string stable IDs survive normalization, merge and repeated import', () => {
  for (const id of [42, '42', 'legacy-id', '  legacy-id  ']) {
    const parsed = parse({ songs: [song], setlists: [{ ...list, id }] })
    assert.equal(parsed.isValid, true, parsed.error)
    const normalized = normalizeSongbookIds(parsed.songs, parsed.setlists)
    assert.equal(normalized.setlists[0].id, String(id).trim())
    const first = merge({ songs: [], setlists: [] }, normalized)
    assert.deepEqual(merge(first, normalized), first)
  }
  const generated = '11111111-1111-4111-8111-111111111111'
  assert.equal(normalizeSongbookIds([], [{ ...list, id: generated, songs: [] }]).setlists[0].id, generated)
})

for (const ids of [[42, '42'], ['same', ' same ']]) test(`canonical collisions reject before mutation: ${JSON.stringify(ids)}`, () => {
  const data = { songs: [song], setlists: ids.map(id => ({ ...list, id })) }
  const before = JSON.stringify(data)
  assert.equal(parse(data).isValid, false)
  assert.throws(() => normalizeSongbookIds(data.songs, data.setlists), /collision/)
  assert.equal(JSON.stringify(data), before)
  assert.equal(parse({ songs: ids.map(id => ({ ...song, id })), setlists: [] }).isValid, false)
})

test('repeated ID-less imports abort with actionable errors and no records', () => {
  for (const data of [{ songs: [song], setlists: [{ name: list.name, songs: [] }] },
    { songs: [{ title: 'Song', rawContent: 'Chart' }] },
    { exportType: 'SINGLE_SETLIST', setlist: { name: 'Gig', songs: [song] } }]) {
    for (let i = 0; i < 2; i++) {
      const parsed = parse(data)
      assert.equal(parsed.isValid, false)
      assert.match(parsed.error, /Stable ID required.*import-as-new/)
      assert.deepEqual(parsed.songs, [])
      assert.deepEqual(parsed.setlists, [])
    }
  }
})

test('Smart Merge repeated tombstones and active records are idempotent without name deduplication', () => {
  const incoming = { songs: [song, { ...song, id: 'deleted-song', isDeleted: true }],
    setlists: [list, { ...list, id: 'deleted-set', isDeleted: true }] }
  const first = merge({ songs: [], setlists: [] }, incoming)
  assert.deepEqual(merge(first, incoming), first)
  assert.equal(first.setlists.length, 2)
  assert.equal(first.songs.length, 2)
})

test('ordered legacy references preserve playback/export; unsupported or ambiguous references reject', () => {
  const second = normalizeBackupSong({ ...song, id: 2, title: 'Second', rawContent: 'Second chart' })
  const parsed = parse({ songs: [song, second], setlists: [{ ...list, songs: [
    { title: second.title, artist: second.artist, position: 0 }, { title: song.title, position: 1 }, { id: song.id, title: song.title, position: 2 },
  ] }] })
  assert.equal(parsed.isValid, true, parsed.error)
  assert.deepEqual(parsed.setlists[0].songs.map(ref => resolveSetlistSong(ref, parsed.songs).rawContent), ['Second chart', song.rawContent, song.rawContent])
  const exported = createSingleSetlistPayload(parsed.setlists[0], parsed.songs)
  assert.deepEqual(parse(exported).setlists[0].songs.map(ref => ref.id), [2, song.id, song.id])
  for (const ref of ['Song', { songId: song.id }, { id: 'missing', title: song.title }]) {
    assert.equal(parse({ songs: [song], setlists: [{ ...list, songs: [ref] }] }).isValid, false)
  }
  assert.equal(parse({ songs: [song, { ...song, id: 'other' }], setlists: [{ ...list, songs: [{ title: song.title }] }] }).isValid, false)
})

test('stale cross-tab merge rejects while retaining recovery snapshots and archive bytes', () => {
  const store = storage()
  persistLibrary(library, store)
  const expectedRaw = store.getItem(LIBRARY_KEY)
  createRestoreSafetySnapshot(library, store)
  store.setItem('gtar_sync_recovery:original', 'unique raw recovery bytes')
  const newer = { songs: [song], setlists: [{ ...list, name: 'Newer tab' }] }
  persistLibrary(newer, store, { expectedRaw })
  const current = store.getItem(LIBRARY_KEY)
  const snapshot = store.getItem(RESTORE_SNAPSHOT_KEY)
  const candidate = receive(library)
  assert.throws(() => persistLibrary(candidate, store, { expectedRaw }), /another tab|newer|changed/i)
  assert.equal(store.getItem(LIBRARY_KEY), current)
  assert.equal(store.getItem(RESTORE_SNAPSHOT_KEY), snapshot)
  assert.equal(store.getItem('gtar_sync_recovery:original'), 'unique raw recovery bytes')
})

test('JSON Bridge backup export has stable list identity and round-trips repeatedly', async () => {
  const { JSDOM } = require('jsdom')
  const React = require('react')
  const { act } = React
  const { createRoot } = require('react-dom/client')
  const { JsonBridgeModal } = require('../src/components/JsonBridgeModal.tsx')
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.test/' })
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT }
  global.window = dom.window
  global.document = dom.window.document
  global.localStorage = dom.window.localStorage
  global.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  try {
    const props = { isOpen: true, onClose() {}, song, allSongs: [song], onImportSong() {} }
    await act(async () => root.render(React.createElement(JsonBridgeModal, props)))
    const button = [...document.querySelectorAll('button')].find(item => item.textContent.includes('Full GTAR'))
    assert.ok(button)
    await act(async () => button.click())
    const raw = document.querySelector('textarea').value
    const parsed = parseBackupJson(raw)
    assert.equal(parsed.isValid, true, parsed.error)
    assert.ok(parsed.setlists[0].id)
    assert.equal(parsed.setlists[0].songs[0].id, song.id)
    const first = merge({ songs: [], setlists: [] }, parsed)
    assert.deepEqual(merge(first, parseBackupJson(raw)), first)
    await act(async () => root.render(React.createElement(JsonBridgeModal, { ...props })))
    assert.equal(JSON.parse(document.querySelector('textarea').value).setlists[0].id, parsed.setlists[0].id)
    const zero = { ...song, id: 0 }
    await act(async () => root.render(React.createElement(JsonBridgeModal, { ...props, song: zero, allSongs: [zero] })))
    const zeroParsed = parseBackupJson(document.querySelector('textarea').value)
    assert.equal(zeroParsed.isValid, true, zeroParsed.error)
    assert.equal(zeroParsed.songs[0].id, 0)
    assert.equal(zeroParsed.setlists[0].songs[0].id, 0)
  } finally {
    await act(async () => root.unmount())
    Object.assign(global, saved)
    dom.window.close()
  }
})

test('App receives consecutive messages before render without losing lists and rejects stale tab writes', async () => {
  require.extensions['.png'] = module => { module.exports = '/logo.png' }
  const { JSDOM } = require('jsdom')
  const React = require('react')
  const { act } = React
  const { createRoot } = require('react-dom/client')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage,
    sessionStorage: global.sessionStorage, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  const componentNames = ['StageView', 'SongbookHomeView', 'Header']
  const modules = componentNames.map(name => require(`../src/components/${name}.tsx`))
  const originals = modules.map((module, index) => module[componentNames[index]])
  modules.forEach((module, index) => { module[componentNames[index]] = () => null })
  const root = createRoot(document.getElementById('root'))
  const oldTimeout = global.setTimeout
  const timers = new Set()
  global.setTimeout = (fn, delay, ...args) => { const timer = oldTimeout(fn, delay, ...args); timers.add(timer); return timer }
  try {
    persistLibrary(library, localStorage)
    const App = require('../src/App.tsx').default
    await act(async () => root.render(React.createElement(App)))
    bandSync.role = 'CLIENT'
    const send = body => bandSync.dispatchSyncMessage({ type: 'SETLIST_SYNC', payload: body, role: 'HOST', senderId: 'source', timestamp: 1 })
    await act(async () => {
      send({ ...payload, setlistId: 'independent-one' })
      send({ ...payload, setlistId: 'independent-two' })
      send({ ...payload, setlistId: 'independent-two' })
    })
    const stored = JSON.parse(localStorage.getItem(LIBRARY_KEY))
    assert.deepEqual(stored.setlists.map(item => item.id), [list.id, 'independent-one', 'independent-two'])
    assert.equal(stored.songs.length, 1)
    const newer = { ...stored, setlists: [...stored.setlists, { ...list, id: 'newer-tab' }] }
    persistLibrary(newer, localStorage)
    const raw = localStorage.getItem(LIBRARY_KEY)
    await act(async () => send({ ...payload, setlistId: 'stale-tab-import' }))
    assert.equal(localStorage.getItem(LIBRARY_KEY), raw)
    assert.match(document.body.textContent, /another tab|newer|changed/i)
  } finally {
    await act(async () => root.unmount())
    bandSync.role = 'OFF'
    for (const timer of timers) clearTimeout(timer)
    global.setTimeout = oldTimeout
    modules.forEach((module, index) => { module[componentNames[index]] = originals[index] })
    Object.assign(global, saved)
    dom.window.close()
  }
})

test('Band Sync keeps existing chart metadata, performance settings and recovery state', () => {
  const local = { ...song, transposeOffset: 4, originalKey: 'G', tags: 'local', isFavorite: true, createdAt: 99 }
  const result = receive({ songs: [local], setlists: [list] })
  assert.deepEqual(result.songs, [local])
})

test('cross-library whitespace aliases abort instead of silently claiming existing records', () => {
  assert.throws(() => mergeImportedSetlists([{ ...list, id: ' set-source ' }], [list]), /canonical ID collision/)
  assert.throws(() => mergeBackupLibrary([{ ...song, id: ' song-source ' }], [song], []), /canonical ID collision/)
})
