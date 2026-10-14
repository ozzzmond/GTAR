const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename)
const { mergeBackupLibrary, resolveSetlistSong, ensureSongIds } = require('../src/utils/setlistSongs.ts')
const { createBackupPayload, parseBackupJson, normalizeBackupSong } = require('../src/utils/jsonBackup.ts')
const { generateUUID } = require('../src/utils/uuid.ts')

const makeSong = (id, title, rawContent) => normalizeBackupSong({ id, title, artist: 'Artist', rawContent })
const ref = song => ({ id: song.id, title: song.title, artist: song.artist })

for (const reverse of [false, true]) {
  test(`exact-ID reservations prevent identity collapse with incoming ${reverse ? 'A then B' : 'B then A'}`, () => {
    const original = makeSong('A', 'Original', 'chart 1')
    const b = makeSong('B', 'Original', 'chart 2')
    const a = makeSong('A', 'Renamed', 'chart 3')
    const existing = Object.freeze([Object.freeze(original)])
    const incoming = Object.freeze(reverse ? [a, b] : [b, a])
    const setlists = [{ id: 'gig', name: 'Gig', songs: [ref(b), ref(a)] }]
    const before = JSON.stringify({ existing, incoming, setlists })
    // Exercise the same validation + merge sequence used by App.
    const parsed = parseBackupJson(JSON.stringify({ songs: incoming, setlists }), { mode: 'merge', existingSongs: existing })
    assert.equal(parsed.isValid, true, parsed.error)
    const merged = mergeBackupLibrary(existing, parsed.songs, parsed.setlists)
    assert.equal(merged.songs.length, 2)
    assert.equal(merged.songs.find(song => song.id === 'A').rawContent, 'chart 3')
    assert.equal(merged.songs.find(song => song.id === 'A').title, 'Renamed')
    assert.equal(merged.songs.find(song => song.id === 'B').rawContent, 'chart 2')
    assert.deepEqual(merged.setlists[0].songs.map(item => item.id), ['B', 'A'])
    assert.deepEqual(merged.setlists[0].songs.map(item => resolveSetlistSong(item, merged.songs).rawContent), ['chart 2', 'chart 3'])
    assert.equal(JSON.stringify({ existing, incoming, setlists }), before)
  })
}

test('legacy deduplication claims only unreserved slots and never applies updates to its lookup snapshot', () => {
  const a = makeSong('A', 'First', 'old A')
  const c = makeSong('C', 'Second', 'old C')
  const incoming = [makeSong('B', 'Second', 'new C'), makeSong('A', 'Second', 'new A')]
  const merged = mergeBackupLibrary([a, c], incoming, [{ id: 'gig', name: 'Gig', songs: incoming.map(ref) }])
  assert.deepEqual(merged.setlists[0].songs.map(item => item.id), ['C', 'A'])
  assert.deepEqual(merged.songs.map(song => song.rawContent), ['new A', 'new C'])
  assert.throws(() => mergeBackupLibrary([a], [a, a], []), /duplicate song ID/)
})

test('full backup rejects unresolved references and preserves originals until songs are restored', () => {
  const previousStorage = global.localStorage
  global.localStorage = { getItem: () => null }
  try {
    const a = makeSong('A', 'First', 'chart A')
    const trashed = { ...makeSong('T', 'Trashed', 'chart T'), isDeleted: true }
    const gone = { id: 'permanently-deleted', title: 'Gone', artist: 'Artist' }
    const setlists = [
      { id: 'gig', name: 'Gig', createdAt: 123, songs: [ref(a), gone, ref(trashed)] },
      { id: 'empty-gig', name: 'Empty Gig', songs: [gone] },
    ]
    const before = JSON.stringify(setlists)
    assert.throws(() => createBackupPayload([a, trashed], setlists), /Backup blocked.*permanently-deleted/)
    assert.equal(JSON.stringify(setlists), before)
    const recovered = { ...gone, rawContent: 'Recovered chart' }
    const exported = createBackupPayload([a, trashed, recovered], setlists)
    assert.deepEqual(exported.setlists[0].songs.map(item => item.id), ['A', 'permanently-deleted', 'T'])
    assert.equal(parseBackupJson(JSON.stringify(exported)).isValid, true)
  } finally { global.localStorage = previousStorage }
})

function withCrypto(value, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value })
  try { callback() } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor)
    else delete globalThis.crypto
  }
}
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('UUID helper uses native randomUUID with the correct receiver', () => {
  const source = { randomUUID() { assert.equal(this, source); return 'native-id' } }
  withCrypto(source, () => assert.equal(generateUUID(), 'native-id'))
})

test('LAN HTTP without randomUUID uses random bytes and imports songs and setlists', () => {
  let count = 0
  const source = { getRandomValues(bytes) {
    assert.equal(this, source)
    bytes.fill(255)
    bytes[0] = ++count
    return bytes
  } }
  withCrypto(source, () => {
    const uuid = generateUUID()
    assert.match(uuid, uuidV4)
    assert.equal(uuid, '01ffffff-ffff-4fff-bfff-ffffffffffff')
    const parsed = parseBackupJson(JSON.stringify({ songs: [{ title: 'LAN', rawContent: 'chart' }], setlists: [{ name: 'LAN Gig', songs: [{ title: 'LAN' }] }] }))
    assert.equal(parsed.isValid, true, parsed.error)
    assert.match(parsed.songs[0].id, uuidV4)
    assert.match(parsed.setlists[0].id, uuidV4)
    assert.equal(parsed.setlists[0].songs[0].id, parsed.songs[0].id)
    assert.notEqual(parsed.setlists[0].id, parsed.songs[0].id)
    assert.match(ensureSongIds([{ title: 'Legacy', rawContent: '' }])[0].id, uuidV4)
    const single = parseBackupJson('{"exportType":"SINGLE_SETLIST","setlist":{"name":"Gig","songs":[{"title":"Song","rawContent":"chart"}]}}')
    assert.equal(single.isValid, true, single.error)
  })
})

test('UUID fallback works when crypto is absent or browser crypto methods throw', () => {
  for (const source of [undefined, { randomUUID() { throw new Error('unavailable') }, getRandomValues() { throw new Error('unavailable') } }]) {
    withCrypto(source, () => {
      const ids = Array.from({ length: 100 }, () => generateUUID())
      ids.forEach(id => assert.match(id, uuidV4))
      assert.equal(new Set(ids).size, ids.length)
    })
  }
})
