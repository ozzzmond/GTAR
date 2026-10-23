// #139 phase 1-2 baseline: deterministic synthetic fixtures exercise the shared-setlist
// snapshot guards and local library persistence limits. No timing assertions (see
// scripts/benchmark-scale.cjs for measurements).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
const { makeLibrary, makeSong, QuotaStorage } = require('./helpers/syntheticSongbook.cjs')
const { snapshotFromSongbook, SETLIST_LIMITS } = require('../src/utils/sharedSetlistSnapshot.ts')
const { persistLibrary, LIBRARY_KEY } = require('../src/utils/syncJournal.ts')

const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8')

test('fixtures are deterministic, distinct and use the canonical six-field header', () => {
  assert.deepEqual(makeLibrary(25), makeLibrary(25))
  const big = makeLibrary(1500, 0)
  assert.equal(new Set(big.songs.map(s => s.id)).size, 1500)
  assert.equal(new Set(big.songs.map(s => s.title)).size, 1500)
  const header = big.songs[0].rawContent.split('\n').slice(0, 6).map(line => line.replace(/:.*$/, ''))
  assert.deepEqual(header, ['{title', '{artist', '{original_key', '{tempo', '{time', '{year'])
})

test('REGRESSION_62: a 62-song setlist of ~3 KB charts publishes within the 256 KB snapshot budget', () => {
  const library = makeLibrary(62, 62, { chars: 3000 })
  const snapshot = snapshotFromSongbook(library, library.setlists[0].id)
  assert.equal(snapshot.entries.length, 62)
  assert.ok(bytes(snapshot) <= SETLIST_LIMITS.snapshotBytes, `snapshot ${bytes(snapshot)} B`)
})

test('CAPACITY_62: at ~4 KB average charts the 256 KB budget holds about 60 songs (measured ceiling)', () => {
  const fits = n => { const l = makeLibrary(n, n, { chars: 4000 }); try { snapshotFromSongbook(l, l.setlists[0].id); return true } catch { return false } }
  assert.equal(fits(60), true)
  assert.equal(fits(62), false, '62 songs at ~4 KB exceed the budget and are rejected whole')
})

test('SNAPSHOT_GUARD: oversized setlists fail clearly instead of partially publishing', () => {
  const longCharts = makeLibrary(62, 62, { chars: 8000 })
  assert.throws(() => snapshotFromSongbook(longCharts, longCharts.setlists[0].id), /Snapshot too large/)
  const hundredTypical = makeLibrary(100, 100)
  assert.throws(() => snapshotFromSongbook(hundredTypical, hundredTypical.setlists[0].id), /Snapshot too large/)
  const tiny = makeLibrary(101, 101, { chars: 200 })
  assert.throws(() => snapshotFromSongbook(tiny, tiny.setlists[0].id), /Invalid setlist snapshot/, '101 occurrences exceed the 100 limit')
  const oneHundredTiny = makeLibrary(100, 100, { chars: 200 })
  assert.equal(snapshotFromSongbook(oneHundredTiny, oneHundredTiny.setlists[0].id).entries.length, 100)
})

test('SNAPSHOT_GUARD: a single chart over 100 KB is rejected', () => {
  const library = { songs: [makeSong(1, { chars: SETLIST_LIMITS.chartBytes + 500 })], setlists: [] }
  library.setlists.push({ id: 'one', name: 'One', songs: [{ id: library.songs[0].id, title: library.songs[0].title, artist: library.songs[0].artist }] })
  assert.throws(() => snapshotFromSongbook(library, 'one'), /Invalid setlist snapshot/)
})

test('LOCAL_LIBRARY: 1,000 typical songs persist within a modeled 5 MiB localStorage quota', () => {
  const storage = new QuotaStorage()
  const library = makeLibrary(1000, 62)
  persistLibrary(library, storage)
  assert.equal(JSON.parse(storage.getItem(LIBRARY_KEY)).songs.length, 1000)
})

test('LOCAL_LIBRARY: exceeding quota fails with a clear error and preserves the previous library', () => {
  const storage = new QuotaStorage()
  persistLibrary(makeLibrary(1000, 62), storage)
  const before = storage.getItem(LIBRARY_KEY)
  assert.throws(() => persistLibrary(makeLibrary(1500, 62), storage, { expectedRaw: before }), /quota exceeded/i)
  assert.equal(storage.getItem(LIBRARY_KEY), before, 'existing library must survive a failed write')
})
