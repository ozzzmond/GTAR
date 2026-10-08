const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename)
const { setSongMembership, isSongInSetlist } = require('../src/utils/setlistSongs.ts')
const { normalizeBackupSong, parseBackupJson, createBackupPayload } = require('../src/utils/jsonBackup.ts')
const song = normalizeBackupSong({ id: 0, title: 'Same title', rawContent: '[C]Song' })
const other = { ...song, id: 'other' }
const setlist = { id: 'gig', name: 'Gig', songs: [{ id: other.id, title: other.title }] }

test('membership uses stable IDs, appends once and preserves the other song with the same title', () => {
  const added = setSongMembership(setlist, song, true)
  assert.deepEqual(added.songs.map(ref => ref.id), ['other', 0])
  assert.equal(setlist.songs.length, 1)
  assert.equal(isSongInSetlist(added, '0'), true)
  assert.equal(setSongMembership(added, { ...song, title: 'Renamed' }, true), added)
  const removed = setSongMembership(added, { ...song, id: '0', title: 'Renamed' }, false)
  assert.deepEqual(removed.songs, setlist.songs)
  assert.equal(isSongInSetlist(removed, song.id), false)
})
test('removal clears repeated references without changing queue order; missing IDs are rejected', () => {
  const repeated = { ...setlist, songs: [{ id: 0, title: 'old' }, ...setlist.songs, { id: '0', title: 'old' }] }
  assert.deepEqual(setSongMembership(repeated, song, false).songs, setlist.songs)
  assert.throws(() => setSongMembership(setlist, { ...song, id: undefined }, true), /stable song ID/)
})
test('new setlist membership survives local JSON persistence and cloud backup validation', () => {
  global.localStorage = { getItem: () => null }
  const created = setSongMembership({ id: 'new', name: 'New Gig', songs: [] }, song, true)
  const saved = JSON.parse(JSON.stringify([created]))
  const restored = parseBackupJson(JSON.stringify(createBackupPayload([song], saved)))
  assert.equal(restored.isValid, true, restored.error)
  assert.equal(isSongInSetlist(restored.setlists[0], 0), true)
})
