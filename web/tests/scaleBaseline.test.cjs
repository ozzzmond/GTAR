// #139 phase 1-2 baseline: deterministic synthetic fixtures exercise local library
// persistence limits (the catalog snapshot guards left with the catalog, #413/#453). No timing assertions (see
// scripts/benchmark-scale.cjs for measurements).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
const { makeLibrary, QuotaStorage } = require('./helpers/syntheticSongbook.cjs')
const { persistLibrary, LIBRARY_KEY } = require('../src/utils/syncJournal.ts')

test('fixtures are deterministic, distinct and use the canonical six-field header', () => {
  assert.deepEqual(makeLibrary(25), makeLibrary(25))
  const big = makeLibrary(1500, 0)
  assert.equal(new Set(big.songs.map(s => s.id)).size, 1500)
  assert.equal(new Set(big.songs.map(s => s.title)).size, 1500)
  const header = big.songs[0].rawContent.split('\n').slice(0, 6).map(line => line.replace(/:.*$/, ''))
  assert.deepEqual(header, ['{title', '{artist', '{original_key', '{tempo', '{time', '{year'])
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
