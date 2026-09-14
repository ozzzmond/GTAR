const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename)
const { parseBackupJson, createBackupPayload, createSingleSetlistPayload, normalizeBackupSong } = require('../src/utils/jsonBackup.ts')
const { SETTINGS_KEYS, restoreBackupSettings, readBackupSettings } = require('../src/utils/backupSettings.ts')
const { bindLegacySetlists, resolveSetlistSong, mergeBackupLibrary, partitionSongs } = require('../src/utils/setlistSongs.ts')
const { searchOnlineChords, fetchOnlineChordSheet } = require('../src/utils/onlineSearch.ts')
const song = { id: 'song-1', title: 'Original', artist: 'Artist', rawContent: '[C]Original lyrics' }
const setlist = { id: 'gig-1', name: 'Gig', songs: [{ id: song.id, title: song.title, artist: song.artist }] }
const parse = (payload, options) => parseBackupJson(JSON.stringify(payload), options)

test('transpose accepts only safe integers within -11..11, including embedded songs', () => {
  for (const offset of [0.5, -0.5, 12, -12, Number.MAX_SAFE_INTEGER, '1', null]) {
    for (const payload of [{ songs: [{ ...song, transposeOffset: offset }] },
      { exportType: 'SINGLE_SETLIST', setlist: { name: 'Gig', songs: [{ ...song, transposeOffset: offset }] } }]) {
      const result = parse(payload)
      assert.equal(result.isValid, false)
      assert.match(result.error, /transposeOffset/)
    }
  }
  for (const offset of [-11, 0, 11]) assert.equal(parse({ songs: [{ ...song, transposeOffset: offset }] }).isValid, true)
})

test('replacement rejects orphans and authoritative missing IDs; merge accepts existing IDs', () => {
  const payload = { songs: [], setlists: [setlist] }
  assert.equal(parse(payload).isValid, false)
  assert.equal(parse(payload, { mode: 'merge', existingSongs: [song] }).isValid, true)
  assert.equal(parse(payload, { mode: 'merge', existingSongs: [] }).isValid, false)
  assert.equal(parse({ songs: [song], setlists: [{ ...setlist, songs: [{ ...setlist.songs[0], id: 'missing' }] }] }).isValid, false)
  assert.equal(parse({ songs: [], setlists: [] }).isValid, true)
  assert.equal(parse({ songs: [song, song] }).isValid, false)
})

test('download/clipboard payload, normalization and merge preserve metadata and trash', () => {
  global.localStorage = { getItem: () => null }
  const metadata = { ...song, tags: 'Acoustic, Gig', isFavorite: true, isDeleted: true, createdAt: 0, lastOpenedAt: 1234 }
  const exported = createBackupPayload([metadata], [setlist])
  const result = parse(exported)
  assert.equal(result.isValid, true, result.error)
  for (const key of ['id', 'tags', 'isFavorite', 'isDeleted', 'createdAt', 'lastOpenedAt']) assert.equal(result.songs[0][key], metadata[key])
  const merged = mergeBackupLibrary([normalizeBackupSong(song)], result.songs, result.setlists)
  assert.equal(partitionSongs(merged.songs).active.length, 0)
  assert.equal(partitionSongs(merged.songs).deleted[0].isFavorite, true)
  assert.equal(parse(createSingleSetlistPayload(setlist, result.songs)).songs[0].tags, metadata.tags)
  const restored = parse(createBackupPayload([{ ...metadata, isDeleted: false, isFavorite: false, tags: '' }], []))
  assert.equal(restored.songs[0].isFavorite, false)
  assert.equal(restored.songs[0].tags, '')
  assert.equal(partitionSongs(restored.songs).active.length, 1)
})

test('legacy binding survives title/artist edits and preserves queue order and charts', () => {
  const other = normalizeBackupSong({ ...song, id: 'song-2', title: 'Second' })
  const legacy = [{ ...setlist, songs: [{ title: song.title, artist: song.artist }, { title: other.title, artist: other.artist }] }]
  const bound = bindLegacySetlists(legacy, [song, other])
  const renamed = { ...song, title: 'Renamed', artist: 'New Artist', rawContent: '[G]Updated lyrics' }
  assert.equal(resolveSetlistSong(bound[0].songs[0], [renamed, other]), renamed)
  assert.equal(resolveSetlistSong(bound[0].songs[1], [renamed, other]), other)
  assert.equal(resolveSetlistSong(bound[0].songs[0], [other]), undefined)
  assert.throws(() => createSingleSetlistPayload(bound[0], [other]), /Missing song/)
  const again = bindLegacySetlists(JSON.parse(JSON.stringify(bound)), [renamed, other])
  assert.equal(again[0].songs[0].id, song.id)
  assert.equal(createSingleSetlistPayload(again[0], [renamed, other]).setlist.songs[0].rawContent, renamed.rawContent)
})

test('merge rebinds incoming IDs when an existing legacy identity is deduplicated', () => {
  const incoming = { ...song, id: 'import-id', tags: 'preserved' }
  const merged = mergeBackupLibrary([song], [incoming], [{ ...setlist, songs: [{ ...setlist.songs[0], id: incoming.id }] }])
  assert.equal(merged.songs.length, 1)
  assert.equal(merged.setlists[0].songs[0].id, song.id)
  assert.equal(resolveSetlistSong(merged.setlists[0].songs[0], merged.songs).tags, 'preserved')
})

test('malformed settings reject the whole backup before any write', () => {
  const invalidSettings = [
    { themeMode: {} }, { themeMode: 'unknown' }, { customThemeColors: {} },
    { customThemeColors: { bgHex: 'url(evil)', textHex: '#ffffff', chordHex: '#ffffff', sectionHex: '#ffffff' } },
    { stageSettings: null }, { stageSettings: [] }, { stageSettings: { fontStyle: 'comic' } },
    { stageSettings: { fontSizePx: '20' } }, { stageSettings: { fontSizePx: 1000 } },
    { stageSettings: { scrollSpeed: -1 } }, { stageSettings: { scrollSpeed: 0.5 } },
    { stageSettings: { isTwoColumn: 'true' } }, { stageSettings: { surprise: {} } },
  ]
  const storage = { setItem() { assert.fail('Malformed settings wrote to storage') } }
  for (const settings of invalidSettings) {
    const result = parse({ songs: [song], ...settings })
    assert.equal(result.isValid, false, JSON.stringify(settings))
    assert.deepEqual(result.songs, [])
    assert.throws(() => restoreBackupSettings(settings, storage))
  }
})

test('settings round-trip uses exactly the runtime storage keys and valid bounds', () => {
  const map = new Map()
  const storage = { setItem: (key, value) => map.set(key, value), getItem: key => map.get(key) ?? null }
  const settings = { themeMode: 'custom', customThemeColors: { bgHex: '#121820', textHex: '#F1F5F9', chordHex: '#F59E0B', sectionHex: '#A78BFA' },
    stageSettings: { fontStyle: 'serif', fontSizePx: 38, scrollSpeed: 180, isTwoColumn: false } }
  restoreBackupSettings(settings, storage)
  assert.deepEqual(readBackupSettings(storage), settings)
  assert.deepEqual(new Set(map.keys()), new Set(Object.values(SETTINGS_KEYS)))
  global.localStorage = storage
  const exported = createBackupPayload([], [])
  const parsed = parse(exported)
  assert.equal(parsed.isValid, true, parsed.error)
  assert.deepEqual(parsed.stageSettings, settings.stageSettings)
  assert.deepEqual(parsed.customThemeColors, settings.customThemeColors)
})

test('network failure never selects a substring-matched song or unrelated source', async () => {
  const originalFetch = global.fetch
  const originalWarn = console.warn
  global.fetch = async () => { throw new Error('offline') }
  console.warn = () => {}
  try {
    for (const query of ['by', 'me', 'Remember Me', 'Baby Blue']) assert.deepEqual(await searchOnlineChords(query), [])
    const results = await searchOnlineChords('Stand By Me')
    assert.equal(results.length, 1)
    assert.equal(results[0].type, 'Offline example')
    const example = await fetchOnlineChordSheet(results[0])
    assert.equal(example.title, 'Stand By Me')
    assert.match(example.rawContent, /Offline example/)
    await assert.rejects(fetchOnlineChordSheet({ ...results[0], id: 'wrong-source' }), /Unknown offline/)
    await assert.rejects(fetchOnlineChordSheet({ ...results[0], offlineExample: false, songName: 'Remember Me' }), /Could not extract/)
  } finally { global.fetch = originalFetch; console.warn = originalWarn }
})

test('legacy Android merge resolves incoming references before matching existing library', () => {
  const incoming = { title: song.title, artist: song.artist, rawContent: '[G]Backup', tags: 'Imported' }
  const result = parse({ songs: [incoming], setlists: [{ ...setlist, songs: [{ title: song.title }] }] }, { mode: 'merge', existingSongs: [song] })
  assert.equal(result.isValid, true, result.error)
  const merged = mergeBackupLibrary([song], result.songs, result.setlists)
  assert.equal(merged.songs.length, 1)
  assert.equal(merged.setlists[0].songs[0].id, song.id)
  assert.equal(resolveSetlistSong(merged.setlists[0].songs[0], merged.songs).rawContent, '[G]Backup')
})

test('distinct incoming IDs with the same name stay distinct during merge', () => {
  const second = { ...song, id: 'other-id', rawContent: 'Other arrangement' }
  const merged = mergeBackupLibrary([], [song, second], [{ ...setlist, songs: [setlist.songs[0], { ...setlist.songs[0], id: second.id }] }])
  assert.equal(merged.songs.length, 2)
  assert.equal(resolveSetlistSong(merged.setlists[0].songs[1], merged.songs).rawContent, second.rawContent)
})
