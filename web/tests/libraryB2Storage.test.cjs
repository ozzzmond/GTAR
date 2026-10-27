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
  for (const n of [153, 1500, 5000, 10000]) {
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

for (const phase of ['source', 'open', 'write', 'readback', 'verify', 'receipt', 'activate']) {
  test(`interrupted at ${phase}: no partial activation, legacy source in use and unchanged; retry completes`, async () => {
    const { storage, factory, tab, source } = await device(40, 6)
    const v1Raw = storage.getItem(V1)
    tab.sj.enableLibraryB2(storage)
    const { tab: page, prepared } = await reopen(storage, factory, { failAt: phase })
    assert.equal(prepared.active, false)
    assert.equal(prepared.hold.reason, 'migration-failed')
    assert.equal(page.sj.isLibraryB2Active(storage), false)
    assert.equal(page.sj.libraryRevision(storage), v1Raw, 'the frozen source is the library')
    assert.ok(sameRecords(page.sj.readPersistedLibrary(storage).songs, source.songs))
    assert.equal(storage.getItem(V1), v1Raw)
    assert.equal([...storage.map.keys()].some(k => k.startsWith('gtar_library_b2_head::')), false, 'never switched')
    assert.ok(page.sj.personalSyncPausedByB2(storage), 'held fallback never syncs')
    // Explicit retry (clears the hold); the move is checked again from the start.
    page.b2.clearB2Hold(storage)
    const retry = await reopen(storage, factory)
    assert.equal(retry.prepared.active, true, JSON.stringify(retry.prepared.hold))
    assert.ok(sameRecords(retry.tab.sj.readPersistedLibrary(storage).songs, source.songs))
    assert.equal(storage.getItem(V1), v1Raw)
  })
}

test('a crash during the migration write transaction leaves no record in B2', async () => {
  const { storage, factory, tab } = await device(30, 3)
  tab.sj.enableLibraryB2(storage)
  factory.faults.commit = () => Object.assign(new Error('power loss'), { name: 'AbortError' })
  const { prepared } = await reopen(storage, factory)
  assert.equal(prepared.active, false)
  const db = factory.databaseNames().find(name => name.startsWith('gtar_library_b2::'))
  for (const store of ['songs', 'bodies', 'setlists', 'meta']) assert.deepEqual(factory.dump(db, store), [], store)
})

test('source edited by an older build during the move: verification refuses, nothing switches', async () => {
  const { storage, factory, tab, source } = await device(30, 3)
  tab.sj.enableLibraryB2(storage)
  let edited = false
  factory.faults.put = (dbName, store) => {
    if (!edited && store === 'meta' && dbName.startsWith('gtar_library_b2::')) {
      edited = true
      // An older build (no B2 code) writes the legacy key directly; current builds refuse (libraryB2Safety F1b).
      storage.setItem(V1, JSON.stringify({ ...source, songs: source.songs.map((s, i) => i === 0 ? { ...s, title: 'Edited elsewhere' } : s) }))
    }
    return null
  }
  const { prepared } = await reopen(storage, factory)
  assert.equal(prepared.active, false)
  assert.match(prepared.hold.detail, /source library changed/)
  assert.equal(JSON.parse(storage.getItem(V1)).songs[0].title, 'Edited elsewhere', 'the newer legacy edit is kept')
})

async function b2Device(n = 60, setlists = 5) {
  const d = await device(n, setlists)
  d.tab.sj.enableLibraryB2(d.storage)
  const { tab, prepared } = await reopen(d.storage, d.factory)
  assert.equal(prepared.active, true, JSON.stringify(prepared.hold))
  return { ...d, tab, db: `gtar_library_b2::${prepared.identity.scope}`, scope: prepared.identity.scope }
}

test('one song edit: one song record + one new body + head, no full-library stringify, one transaction', async () => {
  const { storage, factory, tab, db } = await b2Device(2000, 20)
  const before = tab.sj.readPersistedLibrary(storage)
  const songsBefore = new Map(factory.dump(db, 'songs').map(r => [r.key, r]))
  const bodiesBefore = factory.dump(db, 'bodies').length
  const orderBefore = factory.dump(db, 'meta').find(r => r.key === 'songOrder')
  const statsBefore = { ...factory.stats }
  const puts = []
  factory.faults.put = (dbName, store, value) => { puts.push([store, value.key ?? value.hash]); return null }
  const edited = { ...before.songs[7], rawContent: before.songs[7].rawContent + '\n[G]new line' }
  const next = { songs: before.songs.map((s, i) => i === 7 ? edited : s), setlists: before.setlists }
  const json = JSON.stringify
  let largest = 0, calls = 0
  JSON.stringify = function (...args) { const out = json.apply(this, args); calls++; largest = Math.max(largest, out?.length ?? 0); return out }
  let syncMs
  try {
    const t0 = performance.now()
    tab.sj.persistLibrary(next, storage, { expectedRaw: tab.sj.libraryRevision(storage) })
    syncMs = performance.now() - t0
  } finally { JSON.stringify = json }
  const librarySize = json(before).length
  assert.ok(largest < 4 * json(edited).length + 2000, `largest stringify ${largest} chars vs library ${librarySize}`)
  assert.ok(calls < 20, `${calls} stringify calls`)
  const t1 = performance.now()
  await tab.b2.flushB2()
  const commitMs = performance.now() - t1
  assert.deepEqual(puts.map(p => p[0]).sort(), ['bodies', 'meta', 'songs'])
  assert.deepEqual(puts.find(p => p[0] === 'songs')[1], before.songs[7].id)
  assert.equal(factory.stats.writeTransactions - statsBefore.writeTransactions, 1)
  const songsAfter = factory.dump(db, 'songs')
  assert.equal(songsAfter.filter(r => songsBefore.get(r.key).rev !== r.rev).length, 1)
  assert.equal(songsAfter.find(r => r.key === before.songs[7].id).rev, 2)
  assert.equal(factory.dump(db, 'bodies').length, bodiesBefore + 1)
  assert.deepEqual(factory.dump(db, 'meta').find(r => r.key === 'songOrder'), orderBefore, 'order not rewritten')
  assert.equal(factory.dump(db, 'meta').find(r => r.key === 'head').libraryRev, 2)
  assert.equal(storage.getItem(`gtar_library_b2_wal::${tab.b2.b2Identity().scope}`), null, 'journal cleared after commit')
  console.log(`[B2 measure] 2000 songs, one edit: synchronous save ${syncMs.toFixed(1)} ms, IndexedDB commit ${commitMs.toFixed(1)} ms`)
  // Unchanged save: no write at all.
  const writes = factory.stats.writeTransactions
  tab.sj.persistLibrary(next, storage, { expectedRaw: tab.sj.libraryRevision(storage) })
  await tab.b2.flushB2()
  assert.equal(factory.stats.writeTransactions, writes)
  // Reopened: the edit is there and every other record is unchanged.
  const page = await reopen(storage, factory)
  const back = page.tab.sj.readPersistedLibrary(storage)
  assert.equal(back.songs[7].rawContent, edited.rawContent)
  assert.ok(sameRecords(back.songs.filter((_, i) => i !== 7), before.songs.filter((_, i) => i !== 7)))
})

test('trash, restore from trash, new song, setlist edit and permanent delete each save only what changed', async () => {
  const { storage, factory, tab, db } = await b2Device(30, 3)
  let lib = tab.sj.readPersistedLibrary(storage)
  const save = next => { tab.sj.persistLibrary(next, storage, { expectedRaw: tab.sj.libraryRevision(storage) }); lib = tab.sj.readPersistedLibrary(storage) }
  save({ ...lib, songs: lib.songs.map((s, i) => i === 2 ? { ...s, isDeleted: true } : s) })
  save({ ...lib, songs: [...lib.songs, { id: 'new-1', title: 'New', artist: '', rawContent: '[C]new' }] })
  save({ ...lib, setlists: lib.setlists.map((l, i) => i === 0 ? { ...l, songs: [...l.songs].reverse() } : l) })
  save({ ...lib, songs: lib.songs.filter(s => s.id !== lib.songs[2].id), setlists: lib.setlists.map(l => ({ ...l, songs: l.songs.filter(r => r.id !== lib.songs[2].id) })) })
  await tab.b2.flushB2()
  const page = await reopen(storage, factory)
  const back = page.tab.sj.readPersistedLibrary(storage)
  assert.ok(sameRecords(back.songs, canon(lib).songs))
  assert.ok(sameRecords(back.setlists, canon(lib).setlists))
  assert.equal(factory.dump(db, 'songs').find(r => r.key === 'new-1').rev, 1)
  assert.equal(factory.dump(db, 'songs').filter(r => r.deleted === 1).length, back.songs.filter(s => s.isDeleted).length)
})

test('closing the tab before IndexedDB commits: the journalled save is replayed on the next start', async () => {
  const { storage, factory, tab } = await b2Device(20, 2)
  const lib = tab.sj.readPersistedLibrary(storage)
  factory.faults.commit = () => Object.assign(new Error('tab closed'), { name: 'AbortError' })
  const edited = { ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, title: 'Saved just before close' } : s) }
  tab.sj.persistLibrary(edited, storage, { expectedRaw: tab.sj.libraryRevision(storage) })
  await tab.b2.flushB2().catch(() => {})
  assert.ok(storage.getItem(`gtar_library_b2_wal::${tab.b2.b2Identity().scope}`), 'journal kept')
  storage.removeItem(`gtar_library_b2_hold::${tab.b2.b2Identity().scope}`) // the closed tab never saw its failure
  factory.faults.commit = undefined
  const page = await reopen(storage, factory)
  assert.equal(page.prepared.active, true, JSON.stringify(page.prepared.hold))
  assert.equal(page.prepared.replayed, 1)
  assert.equal(page.tab.sj.readPersistedLibrary(storage).songs[0].title, 'Saved just before close')
})

test('failures hold B2 and keep every copy: IndexedDB open, quota, missing body, corrupt body', async () => {
  // Open failure before migration.
  {
    const { storage, factory, tab, source } = await device(20, 2)
    tab.sj.enableLibraryB2(storage)
    factory.faults.open = name => name.startsWith('gtar_library_b2::') ? new Error('IndexedDB unavailable') : null
    const { tab: page, prepared } = await reopen(storage, factory)
    assert.equal(prepared.hold.reason, 'open-failed')
    assert.ok(sameRecords(page.sj.readPersistedLibrary(storage).songs, source.songs))
    assert.match(page.b2.holdMessage(prepared.hold), /Nothing was deleted/)
  }
  // Quota during the migration write.
  {
    const { storage, factory, tab } = await device(50, 2)
    tab.sj.enableLibraryB2(storage)
    factory.faults.quotaBytes = 10_000
    const { prepared } = await reopen(storage, factory)
    assert.equal(prepared.hold.reason, 'migration-failed')
    assert.match(prepared.hold.detail, /quota/i)
  }
  // Missing and corrupt bodies after activation: frozen source used, B2 records kept.
  for (const damage of ['missing', 'corrupt']) {
    const { storage, factory, tab, db, source } = await b2Device(20, 2)
    const lib = tab.sj.readPersistedLibrary(storage)
    tab.sj.persistLibrary({ ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, title: 'Only in B2' } : s) }, storage, { expectedRaw: tab.sj.libraryRevision(storage) })
    await tab.b2.flushB2()
    const shared = factory._dbs.get(db).stores.get('bodies').records
    const [hash, record] = [...shared][3]
    if (damage === 'missing') shared.delete(hash)
    else shared.set(hash, { ...record, body: record.body + 'tampered' })
    const songsKept = factory.dump(db, 'songs').length
    const page = await reopen(storage, factory)
    assert.equal(page.prepared.active, false)
    assert.equal(page.prepared.hold.reason, damage === 'missing' ? 'missing-body' : 'corrupt-body')
    assert.equal(page.tab.sj.isLibraryB2Active(storage), false)
    assert.ok(sameRecords(page.tab.sj.readPersistedLibrary(storage).songs, source.songs), 'frozen source in use')
    assert.equal(factory.dump(db, 'songs').length, songsKept, 'B2 records not erased')
    assert.ok(factory.dump(db, 'songs').some(r => r.data.title === 'Only in B2'))
    assert.ok(page.tab.sj.personalSyncPausedByB2(storage))
  }
})

test('quota while committing a save: hold, the edit stays journalled, further saves refused, nothing overwritten', async () => {
  const { storage, factory, tab, db } = await b2Device(20, 2)
  const lib = tab.sj.readPersistedLibrary(storage)
  factory.faults.quotaBytes = factory.usedBytes() + 10
  const edited = { ...lib, songs: lib.songs.map((s, i) => i === 1 ? { ...s, rawContent: s.rawContent + 'x'.repeat(5000) } : s) }
  tab.sj.persistLibrary(edited, storage, { expectedRaw: tab.sj.libraryRevision(storage) })
  await assert.rejects(tab.b2.flushB2(), /storage is full/)
  assert.equal(tab.b2.readB2Hold(storage).reason, 'quota')
  const wal = JSON.parse(storage.getItem(`gtar_library_b2_wal::${tab.b2.b2Identity().scope}`))
  assert.equal(wal[0].songs[0].song.rawContent, edited.songs[1].rawContent, 'edit preserved in the journal')
  assert.throws(() => tab.sj.persistLibrary({ ...edited, songs: edited.songs.map((s, i) => i === 2 ? { ...s, title: 'later' } : s) }, storage), /storage is full/)
  assert.equal(factory.dump(db, 'songs').find(r => r.key === lib.songs[1].id).rev, 1, 'stored record unchanged')
})

test('turning B2 off writes the B2 library back to the legacy source (archived first); on again re-checks both copies', async () => {
  const { storage, factory, tab, db } = await b2Device(25, 3)
  const lib = tab.sj.readPersistedLibrary(storage)
  const edited = { ...lib, songs: lib.songs.map((s, i) => i === 4 ? { ...s, title: 'Edited in B2' } : s) }
  tab.sj.persistLibrary(edited, storage, { expectedRaw: tab.sj.libraryRevision(storage) })
  const v1Before = storage.getItem(V1)
  await tab.sj.disableLibraryB2(storage)
  assert.equal(tab.sj.isLibraryB2Active(storage), false)
  assert.equal(JSON.parse(storage.getItem(V1)).songs[4].title, 'Edited in B2', 'no edit lost')
  assert.ok([...storage.map.keys()].some(k => k.startsWith('gtar_sync_recovery:b2-disable-source:')), 'frozen source archived first')
  assert.equal(JSON.parse(storage.map.get([...storage.map.keys()].find(k => k.startsWith('gtar_sync_recovery:b2-disable-source:')))).local.songs[4].title, JSON.parse(v1Before).songs[4].title)
  assert.ok(factory.dump(db, 'songs').length > 0, 'B2 copy kept')
  // Edited while off, then on again: B2 is an older copy of the legacy library → archived and replaced.
  const off = h.newTab()
  const legacy = off.sj.readPersistedLibrary(storage)
  off.sj.persistLibrary({ ...legacy, songs: legacy.songs.map((s, i) => i === 5 ? { ...s, title: 'Edited while off' } : s) }, storage)
  off.sj.enableLibraryB2(storage)
  const page = await reopen(storage, factory)
  assert.equal(page.prepared.active, true, JSON.stringify(page.prepared.hold))
  const back = page.tab.sj.readPersistedLibrary(storage)
  assert.deepEqual([back.songs[4].title, back.songs[5].title], ['Edited in B2', 'Edited while off'])
  assert.ok([...storage.map.keys()].some(k => k.startsWith('gtar_sync_recovery:b2-superseded:')))
  // Both changed: hold, neither replaced.
  page.tab.sj.persistLibrary({ ...back, songs: back.songs.map((s, i) => i === 6 ? { ...s, title: 'B2 only' } : s) }, storage, { expectedRaw: page.tab.sj.libraryRevision(storage) })
  await page.tab.b2.flushB2()
  storage.removeItem(`gtar_library_b2_head::${page.prepared.identity.scope}`) // e.g. an older build turned B2 off without writing back
  storage.removeItem('gtar_library_b2_enabled')
  const older = h.newTab()
  const legacy2 = older.sj.readPersistedLibrary(storage)
  older.sj.persistLibrary({ ...legacy2, songs: legacy2.songs.map((s, i) => i === 7 ? { ...s, title: 'Legacy only' } : s) }, storage)
  older.sj.enableLibraryB2(storage)
  const held = await reopen(storage, factory)
  assert.equal(held.prepared.hold.reason, 'diverged')
  assert.equal(held.tab.sj.readPersistedLibrary(storage).songs[7].title, 'Legacy only')
  assert.ok(factory.dump(db, 'songs').some(r => r.data.title === 'B2 only'), 'B2 edit kept')
})
