// #189 (RFC #188 S1): slim cloud sync base with chart bodies in IndexedDB; base-write failures are reported.
const { bindOwner } = require('./helpers/libraryOwner.cjs')
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
const { makeLibrary } = require('./helpers/syntheticSongbook.cjs')
const { createSongbookSqlite } = require('./helpers/songbookSqlite.cjs')
const journal = require('../src/utils/syncJournal.ts')
const index = require('../src/utils/libraryIndex.ts')
const bodies = require('../src/utils/libraryBodyStore.ts')
const sync = require('../src/utils/cloudSongbookSync.ts')
const { upsertUserSongbook, createSessionToken } = require('../functions/lib/authCore.ts')
const api = require('../functions/api/songbook/sync.ts')

const BASE = sync.CLOUD_SYNC_BASE_KEY
const flush = () => new Promise(resolve => setTimeout(resolve, 10))
let factory
const newTab = () => { index.forgetLibraryBodies(); index.setLibraryBodyBackend(bodies.libraryBodyBackend({ indexedDBFactory: factory })) }
beforeEach(() => { localStorage.clear(); bindOwner(localStorage, 'user-a'); factory = new MockIDBFactory(); newTab() })
const seed = (n = 12) => { journal.persistLibrary(makeLibrary(n, 2, { chars: 2500 }), localStorage); return journal.readPersistedLibrary(localStorage) }
const b1On = async () => { seed(); await journal.enableLibraryIndex(localStorage); return journal.readPersistedLibrary(localStorage) }

test('key stays in step with the shadow-cleanup copy', () => {
  assert.equal(bodies.CLOUD_SYNC_BASE_STORAGE_KEY, BASE)
})

test('B1 off: base is stored as plain JSON, unchanged from before', () => {
  const lib = seed()
  assert.equal(sync.saveCloudSyncBase(lib, localStorage), true)
  assert.deepEqual(JSON.parse(localStorage.getItem(BASE)), lib)
  assert.deepEqual(sync.readCloudSyncBase(localStorage), lib)
})

test('B1 on: base references known bodies by hash and is rebuilt in a new tab after prepare', async () => {
  const lib = await b1On()
  assert.equal(sync.saveCloudSyncBase(lib, localStorage), true)
  const raw = localStorage.getItem(BASE)
  assert.ok(index.isLibraryIndex(JSON.parse(raw)))
  assert.doesNotMatch(raw, /pendingRawContent|"rawContent"/)
  assert.ok(raw.length < JSON.stringify(lib).length / 5, `slim base ${raw.length} vs full ${JSON.stringify(lib).length}`)
  newTab()
  assert.equal(sync.readCloudSyncBase(localStorage), null, 'bodies not loaded: base unavailable, never partial')
  await sync.prepareCloudSyncBase(localStorage)
  assert.deepEqual(sync.readCloudSyncBase(localStorage), lib)
})

test('B1 on: a body IndexedDB has not seen stays inline, then becomes durable in the background', async () => {
  const lib = await b1On()
  const remote = { ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, rawContent: s.rawContent + '\nremote line' } : s) }
  assert.equal(sync.saveCloudSyncBase(remote, localStorage), true)
  assert.match(localStorage.getItem(BASE), /pendingRawContent/)
  await flush()
  const hash = await bodies.bodyHash(remote.songs[0].rawContent)
  const loaded = await bodies.libraryBodyBackend({ indexedDBFactory: factory }).load([hash])
  assert.equal(loaded.get(hash), remote.songs[0].rawContent)
  assert.deepEqual(sync.readCloudSyncBase(localStorage), remote)
})

test('quota failure is reported and keeps the previous base untouched', () => {
  const lib = seed()
  sync.saveCloudSyncBase(lib, localStorage)
  const before = localStorage.getItem(BASE)
  const full = { getItem: k => localStorage.getItem(k), removeItem: k => localStorage.removeItem(k),
    setItem: (k, v) => { if (k === BASE) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e } localStorage.setItem(k, v) },
    key: i => localStorage.key(i), get length() { return localStorage.length } }
  assert.equal(sync.saveCloudSyncBase({ ...lib, setlists: [] }, full), false)
  assert.equal(localStorage.getItem(BASE), before)
})

test('a write that does not read back is rolled back and reported', () => {
  const lib = seed()
  let corrupt = true
  const flaky = { getItem: k => localStorage.getItem(k), removeItem: k => localStorage.removeItem(k),
    setItem: (k, v) => { localStorage.setItem(k, k === BASE && corrupt ? v.replace('Song', 'Gnos') : v); if (k === BASE) corrupt = false },
    key: i => localStorage.key(i), get length() { return localStorage.length } }
  assert.equal(sync.saveCloudSyncBase(lib, flaky), false)
  assert.equal(localStorage.getItem(BASE), null, 'no base before: none after')
})

test('shadow cleanup keeps bodies that only the sync base still references', async () => {
  const lib = await b1On()
  assert.equal(sync.saveCloudSyncBase(lib, localStorage), true)
  const oldBody = lib.songs[0].rawContent
  const edited = { ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, rawContent: 'replaced chart' } : s) }
  journal.persistLibrary(edited, localStorage, { expectedRaw: journal.libraryRevision(localStorage) })
  await flush()
  const store = bodies.libraryBodyBackend({ indexedDBFactory: factory })
  await store.store(['truly orphaned body'])
  journal.disableLibraryIndex(localStorage)
  localStorage.removeItem('gtar_library_v1_retired')
  const plan = await bodies.inspectShadowCleanup(localStorage, { indexedDBFactory: factory })
  const orphanHashes = new Set(plan.records.map(r => r.hash))
  assert.equal(orphanHashes.has(await bodies.bodyHash(oldBody)), false, 'base body protected')
  assert.equal(orphanHashes.has(await bodies.bodyHash('truly orphaned body')), true)
})

async function cloud() {
  const db = createSongbookSqlite()
  const user = { id: 'user-a', google_sub: 'sub-a', email: 'a@example.com', role: 'member', access_status: 'active' }
  const original = db.prepare.bind(db)
  db.prepare = sql => sql.includes('FROM users WHERE id = ?')
    ? { bind(id) { return { first: async () => id === user.id ? user : null } } } : original(sql)
  const env = { DB: db, AUTH_SECRET: 'sync-base-test-secret' }
  const token = await createSessionToken(user, env.AUTH_SECRET)
  const request = (opts) => api[opts.method === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env,
    request: new Request('https://example.com/api/songbook/sync', { method: opts.method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(opts.body ? { body: opts.body } : {}) }) })
  return { db, request }
}
async function withFetch(request, body) {
  const saved = global.fetch
  global.fetch = (url, opts) => request(opts)
  try { return await body() } finally { global.fetch = saved }
}

test('end to end: a slim base survives a new tab and still allows a safe merge', async () => {
  const { db, request } = await cloud()
  const lib = await b1On()
  await withFetch(request, async () => {
    const first = await sync.performCloudSongbookSync('token', { storage: localStorage })
    assert.equal(first.success, true)
    assert.equal(first.warning, undefined)
    assert.ok(index.isLibraryIndex(JSON.parse(localStorage.getItem(BASE))))
    // Another device edits song 1; this device edits song 0.
    const remote = { ...lib, songs: lib.songs.map((s, i) => i === 1 ? { ...s, rawContent: s.rawContent + '\nother device' } : s) }
    const { findUserSongbook } = require('../functions/lib/authCore.ts')
    const current = await findUserSongbook(db, 'user-a')
    await upsertUserSongbook(db, 'user-a', JSON.stringify(remote), sync.computeSongbookChecksum(remote), '2026-10-24T00:00:00Z',
      { version: current.version, checksum: current.checksum })
    const local = { ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, rawContent: s.rawContent + '\nthis device' } : s) }
    journal.persistLibrary(local, localStorage, { expectedRaw: journal.libraryRevision(localStorage) })
    newTab(); await journal.prepareLibraryStorage(localStorage)
    const merged = await sync.performCloudSongbookSync('token', { storage: localStorage, forceAction: 'merge_preserve' })
    assert.equal(merged.success, true, merged.error)
    assert.equal(merged.actionTaken, 'MERGED')
    assert.match(merged.updatedLibrary.songs[0].rawContent, /this device/)
    assert.match(merged.updatedLibrary.songs[1].rawContent, /other device/)
  })
})

test('end to end: sync still succeeds when the base cannot be saved, and says so', async () => {
  const { request } = await cloud()
  seed()
  const noBase = { getItem: k => localStorage.getItem(k), removeItem: k => localStorage.removeItem(k),
    setItem: (k, v) => { if (k === BASE) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e } localStorage.setItem(k, v) },
    key: i => localStorage.key(i), get length() { return localStorage.length } }
  await withFetch(request, async () => {
    const result = await sync.performCloudSongbookSync('token', { storage: noBase })
    assert.equal(result.success, true)
    assert.equal(result.actionTaken, 'UPLOADED')
    assert.equal(result.warning, sync.SYNC_BASE_NOT_SAVED_WARNING)
  })
})
