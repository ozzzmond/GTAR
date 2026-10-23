// #171 B1: slim gtar_library_v2 index with chart bodies in IndexedDB (DEV toggle, off by default).
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('', { url: 'https://dev.gtar-web.pages.dev' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage })
const { MockIDBFactory } = require('./helpers/mockIdb.cjs')
const { makeLibrary, QuotaStorage } = require('./helpers/syntheticSongbook.cjs')
const api = require('../src/utils/syncJournal.ts')
const index = require('../src/utils/libraryIndex.ts')
const bodies = require('../src/utils/libraryBodyStore.ts')

const V1 = api.LIBRARY_KEY, V2 = index.LIBRARY_V2_KEY, B1 = index.LIBRARY_B1_KEY
const flush = () => new Promise(resolve => setTimeout(resolve, 10))
const bodiesOf = lib => lib.songs.map(song => song.rawContent)
let factory
/** Fresh tab: empty in-memory body cache, same localStorage and IndexedDB. */
const newTab = () => { index.forgetLibraryBodies(); index.setLibraryBodyBackend(bodies.libraryBodyBackend({ indexedDBFactory: factory })) }
beforeEach(() => { localStorage.clear(); factory = new MockIDBFactory(); newTab() })
const seed = (n = 20, chars = 600) => { const lib = makeLibrary(n, Math.min(n, 5), { chars }); api.persistLibrary(lib, localStorage); return api.readPersistedLibrary(localStorage) }

test('off by default: nothing changes until the toggle is turned on', async () => {
  const lib = seed()
  assert.equal(api.isLibraryIndexActive(), false)
  assert.equal(localStorage.getItem(V2), null)
  assert.deepEqual(await api.prepareLibraryStorage(localStorage), { indexed: false, fellBack: false })
  assert.equal(api.libraryRevision(), localStorage.getItem(V1))
  assert.deepEqual(api.readPersistedLibrary(), lib)
})

for (const n of [100, 1500]) {
  test(`round trip v1 -> v2 -> new tab at ${n} songs is byte-identical`, async () => {
    const storage = new QuotaStorage(64 * 1024 * 1024) // models storage size, not a browser quota
    api.persistLibrary(makeLibrary(n, Math.min(n, 5), { chars: 3000 }), storage)
    const lib = api.readPersistedLibrary(storage)
    const v1Before = storage.getItem(V1)
    await api.enableLibraryIndex(storage)
    assert.equal(api.isLibraryIndexActive(storage), true)
    assert.equal(storage.getItem(V1), v1Before, 'v1 frozen, not deleted')
    const slim = storage.getItem(V2)
    assert.ok(slim.length < v1Before.length / 5, `index ${slim.length} vs v1 ${v1Before.length}`)
    assert.ok(!slim.includes('pendingRawContent'))
    newTab()
    assert.throws(() => api.readPersistedLibrary(storage), index.MissingLibraryBodyError, 'bodies not loaded yet')
    assert.deepEqual(await api.prepareLibraryStorage(storage), { indexed: true, fellBack: false })
    assert.deepEqual(bodiesOf(api.readPersistedLibrary(storage)), bodiesOf(lib))
    assert.deepEqual(api.readPersistedLibrary(storage), lib)
  })
}

test('5,000 songs: encode/decode is byte-identical with every body cached (no IndexedDB)', () => {
  const lib = makeLibrary(5000, 0, { chars: 1200 })
  index.rememberLibraryBodies(lib.songs.map((song, i) => [`sha256:${i}`, song.rawContent]))
  const { payload, pending } = index.encodeLibraryIndex(lib)
  assert.equal(pending.length, 0)
  assert.deepEqual(bodiesOf(index.decodeLibraryIndex(JSON.parse(payload))), bodiesOf(lib))
})

test('save keeps new bodies inline until IndexedDB confirms; the next save drops the inline copy', async () => {
  const lib = seed()
  await api.enableLibraryIndex(localStorage)
  const edited = { ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, rawContent: s.rawContent + '\nnew line' } : s) }
  api.persistLibrary(edited, localStorage, { expectedRaw: api.libraryRevision() })
  assert.match(localStorage.getItem(V2), /pendingRawContent/)
  await flush()
  api.persistLibrary(edited, localStorage, { expectedRaw: api.libraryRevision() })
  assert.doesNotMatch(localStorage.getItem(V2), /pendingRawContent/)
  newTab(); await api.prepareLibraryStorage(localStorage)
  assert.equal(api.readPersistedLibrary().songs[0].rawContent, edited.songs[0].rawContent)
})

test('crash between body and index write: inline copy restores the edit on reload', async () => {
  const lib = seed()
  await api.enableLibraryIndex(localStorage)
  index.setLibraryBodyBackend({ load: async () => new Map(), store: () => new Promise(() => {}) }) // never confirms
  const edited = { ...lib, songs: lib.songs.map((s, i) => i === 1 ? { ...s, rawContent: 'crash-safe edit' } : s) }
  api.persistLibrary(edited, localStorage, { expectedRaw: api.libraryRevision() })
  newTab() // "reload"
  assert.deepEqual(await api.prepareLibraryStorage(localStorage), { indexed: true, fellBack: false })
  assert.equal(api.readPersistedLibrary().songs[1].rawContent, 'crash-safe edit')
})

test('IndexedDB write failure: save still succeeds with the body inline and logs a warning', async () => {
  const lib = seed()
  await api.enableLibraryIndex(localStorage)
  index.setLibraryBodyBackend({ load: async () => new Map(), store: async () => { throw new DOMException('full', 'QuotaExceededError') } })
  const edited = { ...lib, songs: lib.songs.map((s, i) => i === 2 ? { ...s, rawContent: 'kept inline' } : s) }
  api.persistLibrary(edited, localStorage, { expectedRaw: api.libraryRevision() })
  await flush()
  assert.match(localStorage.getItem(V2), /kept inline/)
  assert.equal(api.readPersistedLibrary().songs[2].rawContent, 'kept inline')
})

for (const fault of ['missing', 'corrupt']) {
  test(`${fault} body at startup: falls back to frozen v1, keeps the index for review, never blank charts`, async () => {
    const lib = seed()
    await api.enableLibraryIndex(localStorage)
    const raw = localStorage.getItem(V2)
    const hash = JSON.parse(raw).songs[0].contentHash
    const records = factory.databases.get(bodies.BODY_DB_NAME).stores.get(bodies.BODY_STORE).records
    if (fault === 'missing') records.delete(hash)
    else records.get(hash).body = 'tampered'
    newTab()
    assert.deepEqual(await api.prepareLibraryStorage(localStorage), { indexed: false, fellBack: true })
    assert.equal(api.isLibraryIndexActive(), false)
    assert.equal(localStorage.getItem(V2), raw, 'index kept')
    assert.ok(Object.keys(localStorage).some(k => k.startsWith('gtar_sync_recovery:replacement:')), 'archived for review')
    const current = api.readPersistedLibrary()
    assert.deepEqual(current, lib)
    assert.ok(current.songs.every(song => song.rawContent.length > 0))
  })
}

test('two tabs: a stale write on v2 still throws StaleWriteConflictError', async () => {
  const lib = seed()
  await api.enableLibraryIndex(localStorage)
  const tabA = api.libraryRevision()
  api.persistLibrary({ ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, title: 'tab B' } : s) }, localStorage, { expectedRaw: tabA })
  assert.throws(() => api.persistLibrary({ ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, title: 'tab A' } : s) }, localStorage, { expectedRaw: tabA }),
    api.StaleWriteConflictError)
  assert.equal(api.isLibraryStorageKey(V2), true)
})

test('cross-tab: a tab missing new bodies loads them from IndexedDB before adopting', async () => {
  const lib = seed()
  await api.enableLibraryIndex(localStorage)
  newTab() // tab B: knows nothing yet
  await api.prepareLibraryStorage(localStorage)
  // tab A writes an edit whose body tab B has never seen; simulate with tab B's cache cleared afterwards
  const edited = { ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, rawContent: 'from tab A' } : s) }
  api.persistLibrary(edited, localStorage, { expectedRaw: api.libraryRevision() })
  await flush()
  api.persistLibrary(edited, localStorage, { expectedRaw: api.libraryRevision() }) // now hash-only
  const externalRaw = api.libraryRevision()
  newTab()
  assert.throws(() => api.decodeLibraryRevision(externalRaw), index.MissingLibraryBodyError)
  await index.loadLibraryIndexBodies(externalRaw)
  assert.equal(api.decodeLibraryRevision(externalRaw).songs[0].rawContent, 'from tab A')
})

test('localStorage quota on the v2 write keeps the last good library', async () => {
  const storage = new QuotaStorage(400000)
  const lib = makeLibrary(20, 5, { chars: 600 })
  api.persistLibrary(lib, storage)
  await api.enableLibraryIndex(storage)
  const before = api.libraryRevision(storage)
  const huge = { ...lib, songs: lib.songs.map(s => ({ ...s, rawContent: s.rawContent + 'x'.repeat(30000) })) }
  assert.throws(() => api.persistLibrary(huge, storage, { expectedRaw: before }), /quota/i)
  assert.equal(api.libraryRevision(storage), before)
  assert.equal(api.readPersistedLibrary(storage).songs[0].rawContent, lib.songs[0].rawContent)
})

test('toggle off writes every edit back to v1 and verifies; toggling on again is idempotent', async () => {
  const lib = seed()
  await api.enableLibraryIndex(localStorage)
  await api.enableLibraryIndex(localStorage) // idempotent
  const edited = { ...lib, songs: lib.songs.map((s, i) => i === 3 ? { ...s, rawContent: 'edited while on', title: 'Renamed' } : s) }
  api.persistLibrary(edited, localStorage, { expectedRaw: api.libraryRevision() })
  api.disableLibraryIndex(localStorage)
  assert.equal(api.isLibraryIndexActive(), false)
  assert.equal(localStorage.getItem(V2), null)
  assert.equal(localStorage.getItem(B1), null)
  const back = JSON.parse(localStorage.getItem(V1))
  assert.equal(back.songs[3].rawContent, 'edited while on')
  assert.equal(back.songs[3].title, 'Renamed')
  assert.equal(api.readPersistedLibrary().songs[3].title, 'Renamed')
  await api.enableLibraryIndex(localStorage)
  assert.equal(api.readPersistedLibrary().songs[3].rawContent, 'edited while on')
})

test('recovery export carries the full current library with B1 on, same as off', async () => {
  const lib = seed()
  const off = api.recoveryData()
  await api.enableLibraryIndex(localStorage)
  const on = api.recoveryData()
  assert.deepEqual(JSON.parse(on[V1]), JSON.parse(off[V1]))
  assert.equal(on[V2], undefined, 'slim index never exported alone')
  assert.equal(api.inspectRecovery().invalid, false)
  assert.deepEqual(api.readPersistedLibrary(), lib)
})

test('shadow cleanup is refused while B1 is on', async () => {
  seed()
  await api.enableLibraryIndex(localStorage)
  await assert.rejects(bodies.inspectShadowCleanup(localStorage, { indexedDBFactory: factory }), /B1 is on/)
})
