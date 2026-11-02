// #300 B3: device library in one IndexedDB database — migration, interruption, two tabs, reload, quota.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/tabHarness.cjs')

const V1 = 'gtar_library_v1'
const DB = 'gtar_library_db'
const plain = value => JSON.parse(JSON.stringify(value))
const titled = (lib, title) => ({ ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, title } : s) })

/** A device with an earlier gtar_library_v1 library of n songs. */
function device(n = 150, setlists = 20) {
  const storage = h.freshStorage()
  const factory = new h.Factory()
  h.newTab().sj.persistLibrary(h.library(n, setlists), storage)
  return { storage, factory, sourceRaw: storage.getItem(V1) }
}
async function open(storage, factory, options = {}) {
  const tab = h.newTab()
  const prepared = await tab.sj.prepareLibraryStorage(storage, { factory, ...options })
  return { tab, prepared }
}

test('migration (150 songs): counts, IDs and content equal; source untouched; snapshot and receipt written', async () => {
  const { storage, factory, sourceRaw } = device()
  const source = JSON.parse(sourceRaw)
  const { tab, prepared } = await open(storage, factory)
  assert.equal(prepared.active, true, prepared.error)
  assert.equal(prepared.migrated, true)
  assert.equal(prepared.source, V1)
  const back = tab.sj.readPersistedLibrary(storage)
  assert.equal(back.songs.length, 150)
  assert.equal(back.setlists.length, 20)
  assert.deepEqual(back.songs.map(s => s.id), source.songs.map(s => s.id))
  assert.deepEqual(back.setlists.map(s => s.id), source.setlists.map(s => s.id))
  assert.deepEqual(plain(back), source)
  assert.equal(storage.getItem(V1), sourceRaw, 'gtar_library_v1 byte-identical')
  assert.equal(factory.dump(DB, 'songs').length, 150)
  assert.equal(factory.dump(DB, 'folders').length, 0)
  assert.equal(factory.dump(DB, 'snapshots')[0].reason, 'before-migration')
  assert.equal(factory.dump(DB, 'meta').find(r => r.key === 'migration').songs, 150)
  // Second start: no second migration; the source is never read again.
  const again = await open(storage, factory)
  assert.equal(again.prepared.migrated, false)
  assert.deepEqual(plain(again.tab.sj.readPersistedLibrary(storage)), source)
})

test('B1 and B2 sources migrate read-only (newest storage wins)', async () => {
  const { storage, factory } = device(4, 1)
  const lib = JSON.parse(storage.getItem(V1))
  // B1: slim index in localStorage, chart bodies in their own database.
  storage.setItem('gtar_library_b1_enabled', '1')
  storage.setItem('gtar_library_v2', JSON.stringify({ format: 'gtar-library-index-v2', ...lib, songs: lib.songs.map(({ rawContent, ...s }, i) => ({ ...s, contentHash: `h${i}` })) }))
  const bodies = await new Promise(resolve => { const r = factory.open('gtar_library_bodies_db', 1); r.onupgradeneeded = () => r.result.createObjectStore('bodies', { keyPath: 'hash' }); r.onsuccess = () => resolve(r.result) })
  await new Promise(resolve => { const tx = bodies.transaction(['bodies'], 'readwrite'); lib.songs.forEach((s, i) => tx.objectStore('bodies').put({ hash: `h${i}`, body: s.rawContent })); tx.oncomplete = resolve })
  const b1 = await open(storage, factory)
  assert.equal(b1.prepared.source, 'gtar_library_v2')
  assert.deepEqual(b1.tab.sj.readPersistedLibrary(storage).songs.map(s => s.rawContent), lib.songs.map(s => s.rawContent))

  // B2 (fresh device): partition records + bodies by hash + orders.
  const d2 = device(3, 1)
  const lib2 = JSON.parse(d2.storage.getItem(V1))
  d2.storage.setItem('gtar_library_b2_enabled', '1')
  d2.storage.setItem('gtar_library_b2_head::device', 'b2|device|1|x')
  const b2db = await new Promise(resolve => {
    const r = d2.factory.open('gtar_library_b2::device', 1)
    r.onupgradeneeded = () => { for (const [name, key] of [['songs', 'key'], ['bodies', 'hash'], ['setlists', 'key'], ['meta', 'key']]) r.result.createObjectStore(name, { keyPath: key }) }
    r.onsuccess = () => resolve(r.result)
  })
  await new Promise(resolve => {
    const tx = b2db.transaction(['songs', 'bodies', 'setlists', 'meta'], 'readwrite')
    lib2.songs.forEach((s, i) => {
      const { rawContent, ...data } = { ...s, title: `B2 ${s.title}` }
      tx.objectStore('songs').put({ key: String(s.id), data, bodyAt: -1, contentHash: `sha256:${i}` })
      tx.objectStore('bodies').put({ hash: `sha256:${i}`, body: rawContent })
    })
    lib2.setlists.forEach(l => tx.objectStore('setlists').put({ key: String(l.id), data: l }))
    tx.objectStore('meta').put({ key: 'songOrder', keys: lib2.songs.map(s => String(s.id)) })
    tx.objectStore('meta').put({ key: 'setlistOrder', keys: lib2.setlists.map(l => String(l.id)) })
    tx.objectStore('meta').put({ key: 'extra', value: {} })
    tx.oncomplete = resolve
  })
  const b2 = await open(d2.storage, d2.factory)
  assert.equal(b2.prepared.source, 'gtar_library_b2::device')
  assert.ok(b2.tab.sj.readPersistedLibrary(d2.storage).songs.every(s => s.title.startsWith('B2 ')))
  assert.equal(d2.storage.getItem(V1), d2.sourceRaw)
})

test('interrupted migration at any step falls back to the earlier library; the next start migrates', async () => {
  const { storage, factory, sourceRaw } = device(20, 2)
  for (const failAt of ['open', 'source', 'snapshot', 'write', 'verify', 'receipt']) {
    const { tab, prepared } = await open(storage, factory, { failAt })
    assert.equal(prepared.active, false, failAt)
    assert.match(prepared.error, /interrupted/)
    assert.equal(tab.sj.isLibraryStoreActive(storage), false)
    assert.equal(tab.sj.libraryRevision(storage), sourceRaw, `${failAt}: earlier library still in use`)
    assert.equal(storage.getItem(V1), sourceRaw)
  }
  const { tab, prepared } = await open(storage, factory)
  assert.equal(prepared.migrated, true)
  assert.deepEqual(plain(tab.sj.readPersistedLibrary(storage)), JSON.parse(sourceRaw))
})

test('two tabs: a stale save never overwrites the other tab (announced, and missed announcement)', async () => {
  const { storage, factory } = device(10, 1)
  const a = (await open(storage, factory)).tab
  const b = (await open(storage, factory)).tab
  const base = b.sj.libraryRevision(storage)
  const lib = a.sj.readPersistedLibrary(storage)
  a.sj.persistLibrary(titled(lib, 'From A'), storage, { expectedRaw: base })
  await a.store.flushLibraryStore()
  await h.settle(20) // BroadcastChannel delivery
  assert.notEqual(b.sj.libraryRevision(storage), base, 'B learned the new head')
  assert.throws(() => b.sj.persistLibrary(titled(lib, 'From B'), storage, { expectedRaw: base }), err => b.sj.isStaleWriteConflictError(err))

  // Missed announcement (no BroadcastChannel in that tab): the commit-time head check still refuses.
  const channel = global.BroadcastChannel
  global.BroadcastChannel = undefined
  const d = (await open(storage, factory)).tab
  global.BroadcastChannel = channel
  const c = (await open(storage, factory)).tab
  const head = d.sj.libraryRevision(storage)
  c.sj.persistLibrary(titled(lib, 'From C'), storage, { expectedRaw: head })
  await c.store.flushLibraryStore()
  d.sj.persistLibrary(titled(lib, 'From D'), storage, { expectedRaw: head })
  await assert.rejects(d.store.flushLibraryStore(), err => err.name === 'LibraryStaleWriteError')
  assert.equal((await open(storage, factory)).tab.sj.readPersistedLibrary(storage).songs[0].title, 'From C')
})

test('reload keeps edits; quota error keeps the previous library and retries later', async () => {
  const { storage, factory } = device(10, 1)
  const { tab } = await open(storage, factory)
  const lib = tab.sj.readPersistedLibrary(storage)
  tab.sj.persistLibrary(titled(lib, 'Saved edit'), storage, { expectedRaw: tab.sj.libraryRevision(storage) })
  await tab.store.flushLibraryStore()
  assert.equal((await open(storage, factory)).tab.sj.readPersistedLibrary(storage).songs[0].title, 'Saved edit')

  const page = (await open(storage, factory)).tab
  const failures = []
  const onFail = event => failures.push(event.detail)
  h.dom.window.addEventListener('gtar-library-write-failed', onFail)
  factory.faults.quotaBytes = factory.usedBytes() + 10
  const big = page.sj.readPersistedLibrary(storage)
  big.songs[1] = { ...big.songs[1], rawContent: 'x'.repeat(5000) }
  page.sj.persistLibrary(titled(big, 'Too big'), storage, { expectedRaw: page.sj.libraryRevision(storage) })
  await assert.rejects(page.store.flushLibraryStore(), /quota/i)
  assert.equal(failures.length, 1)
  assert.equal(page.store.libraryStorePending(), true, 'unsaved edits keep the unload guard on')
  assert.equal((await open(storage, factory)).tab.sj.readPersistedLibrary(storage).songs[0].title, 'Saved edit', 'previous library kept')
  delete factory.faults.quotaBytes
  await page.store.flushLibraryStore()
  h.dom.window.removeEventListener('gtar-library-write-failed', onFail)
  assert.equal((await open(storage, factory)).tab.sj.readPersistedLibrary(storage).songs[0].title, 'Too big')
})

test('safety snapshots: taken before restore, last 5 kept, oldest dropped first', async () => {
  const { storage, factory } = device(5, 1)
  const { tab } = await open(storage, factory)
  const ex = require('../src/utils/backupExport.ts')
  const lib = tab.sj.readPersistedLibrary(storage)
  const ids = []
  for (let i = 0; i < 6; i++) ids.push((await ex.ensureRestoreSafetySnapshot(titled(lib, `v${i}`), storage)).key)
  const kept = await tab.store.listSafetySnapshots()
  assert.equal(kept.length, 5)
  assert.ok(kept.every(s => s.reason === 'before-restore'), 'before-migration snapshot dropped first')
  assert.equal((await tab.store.readSafetySnapshot(ids[5])).songs[0].title, 'v5')
  assert.equal(tab.store.SNAPSHOT_MAX_BYTES, 50 * 1024 * 1024)
})
