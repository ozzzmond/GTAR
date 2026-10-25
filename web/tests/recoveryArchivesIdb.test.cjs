// #167 B1c: recovery archives live in IndexedDB (mirrored in memory); localStorage ones are moved after verification.
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
Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent: 'GTAR test', locks: { request: async (_, options, fn) => fn({}) } } })
const { MockIDBFactory } = require('./helpers/mockIdb.cjs')
const api = require('../src/utils/syncJournal.ts')
const store = require('../src/utils/recoveryArchiveStore.ts')

const song = (id, rawContent = 'chart') => ({ id, title: id, rawContent })
const lib = (...ids) => ({ songs: ids.map(id => song(id)), setlists: [] })
const archiveKeysInLocalStorage = () => Object.keys(localStorage).filter(k => k.startsWith('gtar_sync_recovery:'))
let factory
const prepare = () => store.prepareRecoveryArchives(store.recoveryArchiveBackend(factory), localStorage)
const idbRecords = () => factory.databases.get(store.ARCHIVE_DB_NAME)?.stores.get(store.ARCHIVE_STORE)?.records ?? new Map()
beforeEach(() => { localStorage.clear(); store.resetRecoveryArchives(); factory = new MockIDBFactory(); api.persistLibrary(lib('current'), localStorage) })
afterEach(() => store.resetRecoveryArchives())

test('without IndexedDB prepared, archives keep the localStorage behavior and limits', async () => {
  await api.writeRecoverySnapshot('gtar_sync_recovery:merge:1', '{"local":null}', localStorage)
  assert.equal(localStorage.getItem('gtar_sync_recovery:merge:1'), '{"local":null}')
  assert.deepEqual(api.recoveryRetentionUsage(localStorage).maxCount, 32)
})

test('startup moves localStorage archives to IndexedDB after a verified copy; review and export still see them', async () => {
  const raws = { 'gtar_sync_recovery:download:1': JSON.stringify(lib('a')), 'gtar_sync_recovery:merge:2': JSON.stringify({ local: lib('b'), remote: lib('current') }) }
  for (const [k, v] of Object.entries(raws)) localStorage.setItem(k, v)
  const before = api.inspectRecovery()
  const result = await prepare()
  assert.deepEqual(result, { indexedDb: true, migrated: 2, failed: 0 })
  assert.deepEqual(archiveKeysInLocalStorage(), [], 'removed from localStorage only after the IndexedDB copy verified')
  for (const [k, v] of Object.entries(raws)) { assert.equal(idbRecords().get(k).raw, v); assert.equal(api.readRecoveryArchive(k), v) }
  assert.deepEqual(api.inspectRecovery(), before, 'recovery review is unchanged by the move')
  for (const [k, v] of Object.entries(raws)) assert.equal(api.recoveryData()[k], v)
})

test('a key already in IndexedDB with different bytes is never overwritten; the localStorage copy stays', async () => {
  await prepare()
  await store.putRecoveryArchive('gtar_sync_recovery:download:9', 'idb version')
  store.resetRecoveryArchives()
  localStorage.setItem('gtar_sync_recovery:download:9', 'local version')
  assert.deepEqual(await prepare(), { indexedDb: true, migrated: 0, failed: 1 })
  assert.equal(localStorage.getItem('gtar_sync_recovery:download:9'), 'local version')
  assert.equal(idbRecords().get('gtar_sync_recovery:download:9').raw, 'idb version')
})

test('new safety snapshots go to IndexedDB: five 1 MB merges fit where the 3 MiB cap stopped at three', async () => {
  await prepare()
  const big = JSON.stringify({ local: lib('x'), remote: lib('y'), pad: 'p'.repeat(500000) }) // ~1 MB as UTF-16
  for (let i = 0; i < 5; i++) await api.writeRecoverySnapshot(`gtar_sync_recovery:merge:${i}`, big, localStorage)
  assert.deepEqual(archiveKeysInLocalStorage(), [])
  assert.equal(idbRecords().size, 5)
  const usage = api.recoveryRetentionUsage(localStorage)
  assert.equal(usage.indexedDb, true)
  assert.equal(usage.count, 5)
  assert.equal(usage.maxCount, store.IDB_RECOVERY_MAX_COUNT)
  assert.equal(api.readRecoveryArchive('gtar_sync_recovery:merge:4'), big)
})

test('the IndexedDB limit still blocks with a specific message and saves nothing', async () => {
  await prepare()
  for (let i = 0; i < store.IDB_RECOVERY_MAX_COUNT; i++) await store.putRecoveryArchive(`gtar_sync_recovery:download:${i}`, '{}')
  const error = await api.writeRecoverySnapshot('gtar_sync_recovery:merge:new', '{}', localStorage).catch(e => e)
  assert.ok(error instanceof api.RecoveryRetentionError)
  assert.match(api.recoverySnapshotFailureMessage(error, 'sync'), /limit 64 archives \/ 200 MiB/)
  assert.equal(api.readRecoveryArchive('gtar_sync_recovery:merge:new'), null)
})

test('an IndexedDB write failure rejects the snapshot (sync stops before changing anything)', async () => {
  const backend = store.recoveryArchiveBackend(factory)
  await store.prepareRecoveryArchives({ ...backend, put: async () => { throw new DOMException('full', 'QuotaExceededError') } }, localStorage)
  await assert.rejects(api.writeRecoverySnapshot('gtar_sync_recovery:merge:1', '{}', localStorage), /full/)
  assert.equal(api.readRecoveryArchive('gtar_sync_recovery:merge:1'), null)
  assert.deepEqual(archiveKeysInLocalStorage(), [])
})

test('confirmed cleanup removes decided IndexedDB archives; undecided ones are protected', async () => {
  await prepare()
  await store.putRecoveryArchive('gtar_sync_recovery:download:1', JSON.stringify(lib('old-1')))
  await api.recordRecoveryChoice(api.inspectRecovery(), 'keep-current', () => false)
  await store.putRecoveryArchive('gtar_sync_recovery:download:2', JSON.stringify(lib('undecided')))
  assert.equal(api.planRecoveryCleanup(api.inspectRecovery()).length, 1)
  await api.confirmRecoveryCleanup(api.inspectRecovery(), true, () => false)
  assert.equal(idbRecords().has('gtar_sync_recovery:download:1'), false)
  assert.equal(api.readRecoveryArchive('gtar_sync_recovery:download:1'), null)
  assert.equal(idbRecords().get('gtar_sync_recovery:download:2').raw, JSON.stringify(lib('undecided')))
})

test('reload: archives come back from IndexedDB', async () => {
  await prepare()
  await api.writeRecoverySnapshot('gtar_sync_recovery:download:1', JSON.stringify(lib('kept')), localStorage)
  store.resetRecoveryArchives()
  assert.equal(api.readRecoveryArchive('gtar_sync_recovery:download:1'), null, 'not loaded yet')
  await prepare()
  assert.equal(api.readRecoveryArchive('gtar_sync_recovery:download:1'), JSON.stringify(lib('kept')))
  assert.equal(api.inspectRecovery().sources.length, 1)
})

// #225: synchronous snapshots (Shared Catalog import, JSON import, cross-tab conflicts) must not be
// refused by the 3 MiB localStorage cap when the IndexedDB archives alone exceed it.
test('#225: with >3 MiB of archives in IndexedDB, a sync snapshot still saves (localStorage part within its own cap)', async () => {
  await prepare()
  for (let i = 0; i < 4; i++) await store.putRecoveryArchive(`gtar_sync_recovery:download:${i}:x`, 'x'.repeat(500000))
  const usage = api.recoveryRetentionUsage(localStorage)
  assert.ok(usage.indexedDb && usage.bytes > api.RECOVERY_MAX_BYTES, 'IndexedDB total is beyond the old localStorage cap')
  const key = api.saveCrossTabConflictSnapshot(lib('current'))
  assert.ok(localStorage.getItem(key), 'written synchronously to localStorage')
  assert.ok(api.inspectRecovery().sources.some(s => s.key === key), 'visible in recovery review')
  // The next startup moves it to IndexedDB.
  store.resetRecoveryArchives()
  await prepare()
  assert.deepEqual(archiveKeysInLocalStorage(), [])
  assert.ok(api.readRecoveryArchive(key))
})

test('#225: the IndexedDB total limit still applies to sync snapshots, and so does the localStorage cap', async () => {
  await prepare()
  for (let i = 0; i < store.IDB_RECOVERY_MAX_COUNT; i++) await store.putRecoveryArchive(`gtar_sync_recovery:download:${i}:y`, 'y')
  assert.throws(() => api.saveCrossTabConflictSnapshot(lib('current')), err => err instanceof api.RecoveryRetentionError && err.maxCount === store.IDB_RECOVERY_MAX_COUNT)
  store.resetRecoveryArchives(); factory = new MockIDBFactory(); await prepare()
  localStorage.setItem('gtar_sync_recovery:merge:big', 'z'.repeat(Math.floor(api.RECOVERY_MAX_BYTES / 2)))
  assert.throws(() => api.saveCrossTabConflictSnapshot(lib('current')), api.RecoveryRetentionError, 'localStorage part stays capped')
})
