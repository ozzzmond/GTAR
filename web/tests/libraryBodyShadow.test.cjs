// #167 phase B0: DEV-only IndexedDB shadow copy of chart bodies. localStorage stays authoritative.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
const { MockIDBFactory } = require('./helpers/mockIdb.cjs')
const { makeLibrary } = require('./helpers/syntheticSongbook.cjs')
const store = require('../src/utils/libraryBodyStore.ts')

const bodiesIn = factory => factory.databases.get(store.BODY_DB_NAME)?.stores.get(store.BODY_STORE)?.records ?? new Map()
const logger = () => { const lines = []; return { lines, info: (t, m) => lines.push(['info', m]), warn: (t, m) => lines.push(['warn', m]) } }

test('shadow write stores each distinct chart once and is idempotent', async () => {
  const factory = new MockIDBFactory()
  const library = makeLibrary(50, 0, { chars: 1500 })
  library.songs.push({ ...library.songs[0], id: 'copy-of-first' }) // identical body
  const first = await store.shadowWriteBodies(library, { indexedDBFactory: factory })
  assert.deepEqual(first, { songs: 51, unique: 50, written: 50, present: 0 })
  const second = await store.shadowWriteBodies(library, { indexedDBFactory: factory })
  assert.deepEqual(second, { songs: 51, unique: 50, written: 0, present: 50 })
  assert.equal(bodiesIn(factory).size, 50)
})

test('existing records are never overwritten or deleted', async () => {
  const factory = new MockIDBFactory()
  const library = makeLibrary(5, 0, { chars: 800 })
  await store.shadowWriteBodies(library, { indexedDBFactory: factory, now: () => 111 })
  const before = JSON.stringify([...bodiesIn(factory)])
  library.songs.splice(0, 2) // songs removed from the library
  await store.shadowWriteBodies(library, { indexedDBFactory: factory, now: () => 999 })
  assert.equal(JSON.stringify([...bodiesIn(factory)]), before)
})

test('1,000 synthetic songs round-trip byte-identical and verify clean', async () => {
  const factory = new MockIDBFactory()
  const library = makeLibrary(1000, 0)
  await store.shadowWriteBodies(library, { indexedDBFactory: factory })
  assert.deepEqual(await store.verifyShadowBodies(library, { indexedDBFactory: factory }), { songs: 1000, unique: 1000, missing: 0, corrupt: 0 })
  for (const song of library.songs.slice(0, 25)) {
    assert.equal(bodiesIn(factory).get(await store.bodyHash(song.rawContent)).body, song.rawContent)
  }
})

test('verification reports edited (not yet shadowed) and tampered bodies', async () => {
  const factory = new MockIDBFactory()
  const library = makeLibrary(10, 0, { chars: 600 })
  await store.shadowWriteBodies(library, { indexedDBFactory: factory })
  library.songs[0] = { ...library.songs[0], rawContent: library.songs[0].rawContent + '\nedited' }
  const hash = await store.bodyHash(library.songs[1].rawContent)
  bodiesIn(factory).get(hash).body = 'tampered'
  assert.deepEqual(await store.verifyShadowBodies(library, { indexedDBFactory: factory }), { songs: 10, unique: 10, missing: 1, corrupt: 1 })
})

test('quota failure rejects the shadow write; the installer logs it and keeps going', async () => {
  const factory = new MockIDBFactory()
  const library = makeLibrary(3, 0, { chars: 500 })
  await store.openBodyDatabase({ indexedDBFactory: factory }).then(db => db.close())
  factory.databases.get(store.BODY_DB_NAME)._simulateQuotaError = true
  await assert.rejects(store.shadowWriteBodies(library, { indexedDBFactory: factory }), /Quota/)

  const log = logger(), listeners = {}, queue = []
  const dispose = store.installLibraryBodyShadow({
    enabled: true, indexedDBFactory: factory, logger: log, readLibrary: () => library, debounceMs: 0,
    target: { addEventListener: (t, fn) => { listeners[t] = fn }, removeEventListener: t => { delete listeners[t] } },
    schedule: fn => { queue.push(fn); return queue.length }, cancel: () => {},
  })
  queue.shift()() // startup verify + write
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(log.lines.some(([level, m]) => level === 'warn' && /quota reached; shadow copy paused \(library unaffected\)/.test(m)))
  dispose()
  assert.deepEqual(listeners, {})
})

test('installer: disabled or IndexedDB-less is a no-op; saves trigger debounced single-flight writes', async () => {
  const added = []
  const target = { addEventListener: t => added.push(t), removeEventListener() {} }
  store.installLibraryBodyShadow({ enabled: false, logger: logger(), readLibrary: () => null, target })
  store.installLibraryBodyShadow({ enabled: true, indexedDBFactory: null, logger: logger(), readLibrary: () => null, target })
  assert.deepEqual(added, [])

  const factory = new MockIDBFactory()
  let library = makeLibrary(4, 0, { chars: 400 })
  const listeners = {}, queue = []
  const log = logger()
  store.installLibraryBodyShadow({
    enabled: true, indexedDBFactory: factory, logger: log, readLibrary: () => library, debounceMs: 0,
    target: { addEventListener: (t, fn) => { listeners[t] = fn }, removeEventListener() {} },
    schedule: fn => { queue.push(fn); return queue.length }, cancel: () => {},
  })
  queue.shift()()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(bodiesIn(factory).size, 4)
  assert.ok(log.lines.some(([, m]) => /Startup check: 0\/4 chart bodies present/.test(m)))

  library = makeLibrary(6, 0, { chars: 400 })
  listeners['gtar-library-persisted']()
  listeners.storage({ key: 'unrelated' }) // ignored
  assert.equal(queue.length, 1, 'one debounced run per save burst')
  queue.shift()()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(bodiesIn(factory).size, 6)
})
