// #252 Cloud V2 P1: B2 per-record IndexedDB storage — migration, interruption, write path, failures.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/b2Harness.cjs')
const { stableStringify } = require('../src/utils/contentHash.ts')

const V1 = 'gtar_library_v1', V2 = 'gtar_library_v2'
const canon = lib => ({ songs: lib.songs.map(s => JSON.parse(JSON.stringify(s))), setlists: JSON.parse(JSON.stringify(lib.setlists)) })
const sameRecords = (a, b) => a.length === b.length && a.every((record, i) => stableStringify(record) === stableStringify(b[i]))

/** One device with a legacy library (v1, or B1 with bodies in IndexedDB), signed in as its owner. */
async function device(n, setlists, mode = 'v1', storage = h.freshStorage()) {
  const factory = new h.Factory()
  const tab = h.newTab()
  tab.idx.setLibraryBodyBackend(tab.bodies.libraryBodyBackend({ indexedDBFactory: factory }))
  h.signIn(storage, 'user-a'); h.bindOwner(storage, 'user-a')
  const source = h.library(n, setlists)
  tab.sj.persistLibrary(source, storage)
  if (mode === 'b1') await tab.sj.enableLibraryIndex(storage, 60000)
  return { storage, factory, tab, source: canon(tab.sj.readPersistedLibrary(storage)) }
}
/** A reopened page: new module state, B1 bodies reloaded, then B2 prepared. */
async function reopen(storage, factory, options = {}) {
  const tab = h.newTab()
  tab.idx.setLibraryBodyBackend(tab.bodies.libraryBodyBackend({ indexedDBFactory: factory }))
  await tab.sj.prepareLibraryStorage(storage, 60000)
  const prepared = await tab.sj.prepareLibraryB2(storage, { factory, ...options })
  return { tab, prepared }
}

for (const mode of ['v1', 'b1']) {
  for (const n of [5000, 10000]) {
    test(`migration ${mode} → B2 at ${n} songs + 300 setlists: exact counts, identity, content, checksum; source untouched`, async () => {
      const { storage, factory, tab, source } = await device(n, 300, mode)
      const sourceKey = mode === 'v1' ? V1 : V2
      const sourceRaw = storage.getItem(sourceKey)
      const v1Raw = storage.getItem(V1)
      tab.sj.enableLibraryB2(storage)
      const started = Date.now()
      const { tab: page, prepared } = await reopen(storage, factory)
      const migrationMs = Date.now() - started
      assert.equal(prepared.active, true, JSON.stringify(prepared.hold))
      assert.equal(prepared.migrated, true)
      assert.equal(page.sj.isLibraryB2Active(storage), true)
      assert.match(page.sj.libraryRevision(storage), /^b2\|acct-[0-9a-f]{32}\|1\|/)
      const back = page.sj.readPersistedLibrary(storage)
      assert.equal(back.songs.length, n)
      assert.equal(back.songs.filter(s => s.isDeleted).length, source.songs.filter(s => s.isDeleted).length)
      assert.equal(back.setlists.length, 300)
      assert.deepEqual(h.ids(back.songs), h.ids(source.songs), 'song identity and order')
      assert.deepEqual(h.ids(back.setlists), h.ids(source.setlists), 'setlist identity and order')
      assert.ok(sameRecords(back.songs, source.songs), 'every song field and chart body')
      assert.ok(sameRecords(back.setlists, source.setlists), 'every setlist and its ordered entries')
      const want = await page.b2.libraryFingerprintB2(source)
      const got = await page.b2.libraryFingerprintB2(back)
      assert.equal(got.aggregate, want.aggregate, 'aggregate canonical checksum')
      const receipt = factory.dump(`gtar_library_b2::${prepared.identity.scope}`, 'meta').find(r => r.key === 'receipt')
      assert.deepEqual([receipt.songs, receipt.setlists, receipt.aggregate, receipt.source], [n, 300, want.aggregate, sourceKey])
      assert.equal(storage.getItem(sourceKey), sourceRaw, 'legacy source byte-identical')
      assert.equal(storage.getItem(V1), v1Raw, 'gtar_library_v1 never removed or changed')
      // A later start reads the same library back from IndexedDB without migrating again.
      const started2 = Date.now()
      const again = await reopen(storage, factory)
      const loadMs = Date.now() - started2
      assert.equal(again.prepared.migrated, false)
      assert.equal((await again.tab.b2.libraryFingerprintB2(again.tab.sj.readPersistedLibrary(storage))).aggregate, want.aggregate)
      if (n >= 5000) console.log(`[B2 measure] ${mode} ${n} songs: migration ${migrationMs} ms, reopen (load + verify bodies) ${loadMs} ms, heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MiB`)
    })
  }
}
