// #167 v1 retirement (DEV): B1 auto-on, gtar_library_v1 moved to a verified IndexedDB copy, fallback restores it.
const { test, beforeEach, afterEach } = require('node:test')
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
Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent: 'GTAR test', locks: { request: async (_, o, fn) => fn({}) } } })
const { MockIDBFactory } = require('./helpers/mockIdb.cjs')
const { makeLibrary } = require('./helpers/syntheticSongbook.cjs')
const api = require('../src/utils/syncJournal.ts')
const index = require('../src/utils/libraryIndex.ts')
const bodies = require('../src/utils/libraryBodyStore.ts')
const archives = require('../src/utils/recoveryArchiveStore.ts')

const V1 = api.LIBRARY_KEY
let bodyDb, archiveDb
const tab = async () => {
  index.forgetLibraryBodies(); archives.resetRecoveryArchives()
  index.setLibraryBodyBackend(bodies.libraryBodyBackend({ indexedDBFactory: bodyDb }))
  await archives.prepareRecoveryArchives(archives.recoveryArchiveBackend(archiveDb), localStorage)
}
/** What App's DEV startup does, in order. */
const devStartup = async () => {
  await tab()
  const enabled = await api.autoEnableLibraryIndex(localStorage)
  const prepared = await api.prepareLibraryStorage(localStorage)
  const freed = prepared.indexed ? await api.retireLibraryV1(localStorage) : 0
  return { enabled, prepared, freed }
}
beforeEach(() => { localStorage.clear(); bodyDb = new MockIDBFactory(); archiveDb = new MockIDBFactory() })
afterEach(() => archives.resetRecoveryArchives())
const seed = () => { api.persistLibrary(makeLibrary(30, 5, { chars: 800 }), localStorage); return { lib: api.readPersistedLibrary(localStorage), raw: localStorage.getItem(V1) } }

test('first DEV startup: B1 turns on, v1 bytes move to IndexedDB (verified), localStorage is freed', async () => {
  const { lib, raw } = seed()
  const result = await devStartup()
  assert.equal(result.enabled, true)
  assert.deepEqual(result.prepared, { indexed: true, fellBack: false })
  assert.ok(result.freed > 2 * raw.length)
  assert.equal(localStorage.getItem(V1), null, 'gtar_library_v1 retired')
  assert.equal(archives.getRetiredLibrary(), raw, 'exact bytes kept in IndexedDB')
  assert.deepEqual(api.readPersistedLibrary(), lib, 'library unchanged')
  assert.equal(api.inspectRecovery().sources.length, 0, 'retired copy is not a recovery source (no red dot)')
})

test('later startups: no re-enable, no re-retire, edits persist through v2', async () => {
  const { lib } = seed()
  await devStartup()
  const edited = { ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, rawContent: 'edited after retirement' } : s) }
  api.persistLibrary(edited, localStorage, { expectedRaw: api.libraryRevision() })
  await new Promise(r => setTimeout(r, 10))
  const second = await devStartup()
  assert.deepEqual(second, { enabled: false, prepared: { indexed: true, fellBack: false }, freed: 0 })
  assert.equal(api.readPersistedLibrary().songs[0].rawContent, 'edited after retirement')
})

test('turning B1 off writes v1 back and is not undone by the next startup', async () => {
  const { lib } = seed()
  await devStartup()
  api.disableLibraryIndex(localStorage)
  assert.deepEqual(JSON.parse(localStorage.getItem(V1)).songs.length, lib.songs.length)
  const next = await devStartup()
  assert.equal(next.enabled, false, 'owner opt-out respected')
  assert.equal(api.isLibraryIndexActive(), false)
  assert.deepEqual(api.readPersistedLibrary(), lib)
  await api.enableLibraryIndex(localStorage) // turning it on by hand clears the opt-out
  assert.equal(localStorage.getItem(index.LIBRARY_B1_OPTOUT_KEY), null)
})

test('missing body after retirement: fallback restores the retired copy instead of an empty library', async () => {
  const { lib, raw } = seed()
  await devStartup()
  const hash = JSON.parse(localStorage.getItem(index.LIBRARY_V2_KEY)).songs[0].contentHash
  bodyDb.databases.get(bodies.BODY_DB_NAME).stores.get(bodies.BODY_STORE).records.delete(hash)
  const after = await (async () => { await tab(); return api.prepareLibraryStorage(localStorage) })()
  assert.deepEqual(after, { indexed: false, fellBack: true })
  assert.equal(localStorage.getItem(V1), raw)
  assert.deepEqual(api.readPersistedLibrary(), lib)
  assert.ok(localStorage.getItem(index.LIBRARY_V2_KEY), 'index kept for review')
  assert.ok(localStorage.getItem(api.RECORDS_DELETE_HOLD_KEY), '#208 F1: fallback holds per-record deletes')
  assert.equal(api.recordsDeleteHoldActive(localStorage), true)
})

test('retirement is skipped when archives are not in IndexedDB or the index cannot load', async () => {
  seed()
  index.setLibraryBodyBackend(bodies.libraryBodyBackend({ indexedDBFactory: bodyDb }))
  await api.enableLibraryIndex(localStorage)
  archives.resetRecoveryArchives() // no IndexedDB archive store
  assert.equal(await api.retireLibraryV1(localStorage), 0)
  assert.ok(localStorage.getItem(V1), 'v1 kept')
  await archives.prepareRecoveryArchives(archives.recoveryArchiveBackend(archiveDb), localStorage)
  index.forgetLibraryBodies() // bodies not loaded: decode fails, nothing is removed
  await assert.rejects(api.retireLibraryV1(localStorage), index.MissingLibraryBodyError)
  assert.ok(localStorage.getItem(V1), 'v1 kept')
})
