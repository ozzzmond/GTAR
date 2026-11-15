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
const { mergeImportedSetlists, mergeImportedSetlistsWithReport } = require('../src/utils/importIdentity.ts')
const { persistLibrary, LIBRARY_KEY } = require('../src/utils/syncJournal.ts')
const song = normalizeBackupSong({ id: 'song-source', title: 'Song', artist: 'Artist', rawContent: '[G]Chart' })
const list = { id: 'set-source', name: 'Gig', createdAt: 1, songs: [{ id: song.id, title: song.title, artist: song.artist }] }
const library = { songs: [song], setlists: [list] }
const parse = data => parseBackupJson(JSON.stringify(data))
function merge(existing, incoming) {
  const songs = mergeBackupLibrary(existing.songs, incoming.songs, incoming.setlists)
  return { songs: songs.songs, setlists: mergeImportedSetlists(existing.setlists, songs.setlists) }
}
function storage() {
  const values = new Map()
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
    key: i => [...values.keys()][i] ?? null, get length() { return values.size } }
}

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

test('ordered legacy references preserve playback/export; malformed references reject; missing shortcuts remain and title-only matches upgrade', () => {
  const second = normalizeBackupSong({ ...song, id: 2, title: 'Second', rawContent: 'Second chart' })
  const parsed = parse({ songs: [song, second], setlists: [{ ...list, songs: [
    { title: second.title, artist: second.artist, position: 0 }, { title: song.title, position: 1 }, { id: song.id, title: song.title, position: 2 },
  ] }] })
  assert.equal(parsed.isValid, true, parsed.error)
  assert.deepEqual(parsed.setlists[0].songs.map(ref => resolveSetlistSong(ref, parsed.songs).rawContent), ['Second chart', song.rawContent, song.rawContent])
  const exported = createSingleSetlistPayload(parsed.setlists[0], parsed.songs)
  assert.deepEqual(parse(exported).setlists[0].songs.map(ref => ref.id), [2, song.id, song.id])
  for (const ref of ['Song', { songId: song.id }]) {
    assert.equal(parse({ songs: [song], setlists: [{ ...list, songs: [ref] }] }).isValid, false)
  }
  const upgraded = parse({ songs: [song, { ...song, id: 'other' }], setlists: [{ ...list, songs: [{ title: song.title }, {id:'missing',title:song.title}] }] })
  assert.equal(upgraded.isValid, true, upgraded.error)
  assert.match(upgraded.setlists[0].songs[0].id, /^missing:/)
  assert.equal(upgraded.setlists[0].songs[1].id, 'missing')
})

test('cross-library whitespace aliases abort instead of silently claiming existing records', () => {
  assert.throws(() => mergeImportedSetlists([{ ...list, id: ' set-source ' }], [list]), /canonical ID collision/)
  assert.throws(() => mergeBackupLibrary([{ ...song, id: ' song-source ' }], [song], []), /canonical ID collision/)
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
  const candidate = merge(library, library)
  assert.throws(() => persistLibrary(candidate, store, { expectedRaw }), /another tab|newer|changed/i)
  assert.equal(store.getItem(LIBRARY_KEY), current)
  assert.equal(store.getItem(RESTORE_SNAPSHOT_KEY), snapshot)
  assert.equal(store.getItem('gtar_sync_recovery:original'), 'unique raw recovery bytes')
})
