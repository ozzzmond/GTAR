// #252 / PR #258 audit F1–F7: deterministic reproductions of the B2 data-safety findings.
// Each test fails on 56c7431 (pre-fix) and passes on the remediation.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/b2Harness.cjs')
const { installNavigatorLocks } = require('./helpers/fakeLocks.cjs')

installNavigatorLocks()
const V1 = 'gtar_library_v1'
const b2Db = factory => factory.databaseNames().filter(name => name.startsWith('gtar_library_b2::'))
const records = (factory, db, store) => factory._dbs.get(db).stores.get(store).records

/** Legacy v1 library owned by `owner` (when given), signed in as `session`, B2 enabled. */
function device({ owner = 'user-a', session = 'user-a', n = 12, setlists = 2, storage = h.freshStorage() } = {}) {
  const factory = new h.Factory()
  const tab = h.newTab()
  if (owner) h.bindOwner(storage, owner)
  h.signIn(storage, session)
  if (n) tab.sj.persistLibrary(h.library(n, setlists), storage)
  tab.sj.enableLibraryB2(storage)
  return { storage, factory }
}
async function open(storage, factory, options = {}) {
  const tab = h.newTab()
  const prepared = await tab.sj.prepareLibraryB2(storage, { factory, ...options })
  return { tab, prepared }
}
const edit = (tab, storage, i, fields, options) => {
  const lib = tab.sj.readPersistedLibrary(storage)
  tab.sj.persistLibrary({ ...lib, songs: lib.songs.map((s, k) => k === i ? { ...s, ...fields } : s) }, storage, options ?? { expectedRaw: tab.sj.libraryRevision(storage) })
}
/** An older build (no B2 code) writing gtar_library_v1 directly. */
function oldBuildEdit(storage, i, title) {
  const lib = JSON.parse(storage.getItem(V1))
  lib.songs[i] = { ...lib.songs[i], title }
  storage.setItem(V1, JSON.stringify(lib))
}
const allValues = storage => [...storage.map.entries()]

// F1: migration / activation race
test('F1a: legacy edit after verification but before activation is never hidden (stale migration rejected)', async () => {
  const { storage, factory } = device()
  factory.faults.put = (db, store, value) => {
    if (store === 'meta' && value.key === 'receipt') oldBuildEdit(storage, 0, 'Edited during the move')
    return null
  }
  const { tab, prepared } = await open(storage, factory)
  factory.faults.put = undefined
  assert.equal(prepared.active, false, 'stale migration must not activate')
  assert.equal(tab.sj.isLibraryB2Active(storage), false)
  assert.equal(tab.sj.readPersistedLibrary(storage).songs[0].title, 'Edited during the move')
})

test('F1b: a tab that has not opened B2 cannot save into the frozen legacy source once B2 is enabled', async () => {
  const { storage, factory } = device()
  const before = storage.getItem(V1)
  const b2tab = await open(storage, factory)
  assert.equal(b2tab.prepared.active, true)
  const staleTab = h.newTab() // opened before the switch: still reads the legacy library
  const lib = JSON.parse(before)
  assert.throws(() => staleTab.sj.persistLibrary({ ...lib, songs: lib.songs.map((s, i) => i === 1 ? { ...s, title: 'Hidden edit' } : s) }, storage),
    error => staleTab.sj.isStaleWriteConflictError(error))
  assert.equal(storage.getItem(V1), before)
})

test('F1c: an older build edits the legacy source after activation: next start shows the edit (B2 unchanged → re-moved)', async () => {
  const { storage, factory } = device()
  assert.equal((await open(storage, factory)).prepared.active, true)
  oldBuildEdit(storage, 2, 'Old build edit')
  const { tab, prepared } = await open(storage, factory)
  assert.equal(tab.sj.readPersistedLibrary(storage).songs[2].title, 'Old build edit')
  assert.equal(prepared.active, true)
  assert.ok([...storage.map.keys()].some(k => k.startsWith('gtar_sync_recovery:b2-superseded:')), 'older B2 copy archived')
})

test('F1d: both copies changed after activation: hold, neither copy replaced', async () => {
  const { storage, factory } = device()
  const a = await open(storage, factory)
  edit(a.tab, storage, 3, { title: 'B2 edit' })
  await a.tab.b2.flushB2()
  oldBuildEdit(storage, 4, 'Old build edit')
  const { tab, prepared } = await open(storage, factory)
  assert.equal(prepared.active, false)
  assert.equal(prepared.hold.reason, 'diverged')
  assert.equal(tab.sj.readPersistedLibrary(storage).songs[4].title, 'Old build edit')
  assert.ok([...records(factory, b2Db(factory)[0], 'songs').values()].some(r => r.data.title === 'B2 edit'))
})

// F2: metadata integrity
const tampers = {
  'song metadata changed': (f, db) => { const r = [...records(f, db, 'songs').values()][1]; r.data = { ...r.data, title: 'Tampered title' } },
  'setlist changed': (f, db) => { const r = [...records(f, db, 'setlists').values()][0]; r.data = { ...r.data, name: 'Tampered' } },
  'head schema unsupported': (f, db) => { const m = records(f, db, 'meta'); m.set('head', { ...m.get('head'), schemaVersion: 99 }) },
  'owner scope mismatch': (f, db) => { const m = records(f, db, 'meta'); m.set('owner', { ...m.get('owner'), scope: 'acct-0000', userId: 'user-z' }) },
  'record revision ahead of head': (f, db) => { const r = [...records(f, db, 'songs').values()][2]; r.rev = 999 },
  'deleted flag disagrees': (f, db) => { const r = [...records(f, db, 'songs').values()][3]; r.deleted = 1 },
  'top-level fields changed': (f, db) => { const m = records(f, db, 'meta'); m.set('extra', { ...m.get('extra'), value: { allowedUsers: ['x@example.test'] } }) },
  'head revision rewound': (f, db) => { const m = records(f, db, 'meta'); m.set('head', { ...m.get('head'), libraryRev: 0 }) },
}
for (const [label, tamper] of Object.entries(tampers)) {
  test(`F2: ${label} → B2 fails closed (hold, earlier library in use, B2 records kept)`, async () => {
    const { storage, factory } = device()
    assert.equal((await open(storage, factory)).prepared.active, true)
    const db = b2Db(factory)[0]
    tamper(factory, db)
    const kept = records(factory, db, 'songs').size
    const { tab, prepared } = await open(storage, factory)
    assert.equal(prepared.active, false, `${label} must not load`)
    assert.ok(prepared.hold)
    assert.equal(tab.sj.isLibraryB2Active(storage), false)
    assert.equal(tab.sj.readPersistedLibrary(storage).songs[1].title, h.library(12, 2).songs[1].title, 'legacy library in use')
    assert.equal(records(factory, db, 'songs').size, kept)
  })
}

// F3: journal recovery
test('F3: a conflicting journalled edit is never discarded by revision comparison; it is kept and held', async () => {
  const { storage, factory } = device()
  const a = await open(storage, factory), b = await open(storage, factory)
  edit(a.tab, storage, 3, { title: 'Committed by A' })
  await a.tab.b2.flushB2()
  edit(b.tab, storage, 3, { title: 'Forced by B' }, { force: true })
  await b.tab.b2.flushB2().catch(() => {})
  // Explicit Retry, then a fresh start.
  b.tab.b2.clearB2Hold(storage)
  const { prepared } = await open(storage, factory)
  assert.equal(prepared.active, false, 'conflicting journal must hold, not be dropped')
  const kept = allValues(storage).some(([k, v]) => (k.startsWith('gtar_library_b2_wal::') || k.startsWith('gtar_sync_recovery:')) && v.includes('Forced by B'))
  assert.ok(kept, 'B\'s edit is kept in the journal or a recovery archive')
  const db = b2Db(factory)[0]
  assert.equal([...records(factory, db, 'songs').values()].find(r => r.data.title === 'Committed by A') !== undefined, true)
})

// F4: rollback (turn off) race
test('F4a: turning B2 off refuses when the legacy source changed while B2 was on (no overwrite)', async () => {
  const { storage, factory } = device()
  const { tab } = await open(storage, factory)
  edit(tab, storage, 0, { title: 'B2 edit' })
  oldBuildEdit(storage, 5, 'Old build edit')
  await assert.rejects(tab.sj.disableLibraryB2(storage))
  assert.equal(JSON.parse(storage.getItem(V1)).songs[5].title, 'Old build edit', 'legacy edit not overwritten')
  assert.equal(storage.getItem('gtar_library_b2_enabled'), '1', 'B2 stays on')
})

test('F4b: a B2 save in another tab during turn-off: B2 stays on, nothing stale becomes the library', async () => {
  const { storage, factory } = device()
  const a = await open(storage, factory), b = await open(storage, factory)
  const setItem = storage.setItem.bind(storage)
  let injected = false
  storage.setItem = (key, value) => {
    setItem(key, value)
    if (!injected && key.startsWith('gtar_sync_recovery:b2-disable-source:')) {
      injected = true
      // Tab B loads A's revision and saves a newer one while A is turning B2 off.
      b.tab.b2.b2Decode(a.tab.sj.libraryRevision(storage))
      edit(b.tab, storage, 6, { title: 'Saved in tab B during turn-off' })
    }
  }
  await assert.rejects(a.tab.sj.disableLibraryB2(storage))
  storage.setItem = setItem
  assert.equal(storage.getItem('gtar_library_b2_enabled'), '1')
  await b.tab.b2.flushB2()
  const page = await open(storage, factory)
  assert.equal(page.tab.sj.readPersistedLibrary(storage).songs[6].title, 'Saved in tab B during turn-off')
})

// F5: partition fallback
test('F5a: account B with B2 failing never reads or changes account A\'s earlier library', async () => {
  const { storage, factory } = device({ owner: 'user-a', session: 'user-b' })
  const before = storage.getItem(V1)
  factory.faults.open = () => new Error('IndexedDB unavailable')
  const { tab, prepared } = await open(storage, factory)
  assert.equal(prepared.active, false)
  let songs = null
  try { songs = tab.sj.readPersistedLibrary(storage)?.songs ?? null } catch { songs = null }
  assert.ok(!songs || songs.length === 0, 'A\'s songs not visible to B')
  assert.throws(() => tab.sj.persistLibrary({ songs: [], setlists: [] }, storage))
  assert.equal(storage.getItem(V1), before)
})

test('F5b: account B cannot turn B2 off into account A\'s earlier library', async () => {
  const { storage, factory } = device({ owner: 'user-a', session: 'user-b' })
  const { tab } = await open(storage, factory)
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 0)
  await assert.rejects(tab.sj.disableLibraryB2(storage))
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 0)
  assert.equal(storage.getItem('gtar_library_b2_enabled'), '1')
})

for (const [label, owner] of [['owner record for another environment', { v: 1, userId: 'user-a', env: 'other.host', boundAt: 1, reason: 'confirmed' }], ['unreadable owner record', '{broken']]) {
  test(`F5c: ${label}: the earlier library is not opened for a signed-in account`, async () => {
    const storage = h.freshStorage()
    const { factory } = device({ owner: null, session: 'user-c', storage })
    storage.setItem('gtar_library_owner_v1', typeof owner === 'string' ? owner : JSON.stringify(owner))
    const { tab } = await open(storage, factory)
    let songs = null
    try { songs = tab.sj.readPersistedLibrary(storage)?.songs ?? null } catch { songs = null }
    assert.ok(!songs || songs.length === 0, 'unknown ownership fails closed')
    for (const db of b2Db(factory)) assert.equal(records(factory, db, 'songs').size, 0, 'not copied into a partition')
  })
}

// F6: recovery isolation
test('F6: recovery archives, decisions and exports are scoped by account partition', async () => {
  const { storage, factory } = device({ owner: 'user-a', session: 'user-a' })
  const aLibrary = storage.getItem(V1)
  storage.setItem('gtar_sync_recovery:replacement:1:a', JSON.stringify({ raw: aLibrary }))
  const decisions = JSON.stringify({ version: 3, legacyRaw: null, decisions: [] })
  storage.setItem('gtar_recovery_decisions_v1', decisions)
  // B opens its own partition.
  h.signIn(storage, 'user-b')
  const b = await open(storage, factory)
  assert.equal(b.prepared.active, true)
  const leaks = data => Object.values(data).some(value => value.includes('Synthetic Song 000001'))
  assert.equal(leaks(b.tab.sj.recoveryData(storage)), false, 'A archive hidden from B')
  assert.equal(leaks(b.tab.sj.recoveryExportData(storage)), false, 'A data not in B export')
  assert.equal(b.tab.sj.inspectRecovery(storage).sources.length, 0)
  const review = b.tab.sj.inspectRecovery(storage)
  await assert.rejects(b.tab.sj.recordRecoveryChoice(review, 'keep-current', () => false, storage))
  assert.equal(storage.getItem('gtar_recovery_decisions_v1'), decisions, 'A decisions untouched')
  // B's own archive is invisible to A (B2 on) and with B2 off.
  b.tab.sj.persistLibrary({ songs: [{ id: 'b-1', title: 'B private song', artist: '', rawContent: '[D]b' }], setlists: [] }, storage, { expectedRaw: b.tab.sj.libraryRevision(storage) })
  b.tab.sj.saveCrossTabConflictSnapshot(b.tab.sj.readPersistedLibrary(storage), storage)
  await b.tab.b2.flushB2()
  assert.ok(Object.values(b.tab.sj.recoveryData(storage)).some(v => v.includes('B private song')), 'B sees its own archive')
  h.signIn(storage, 'user-a')
  const a = await open(storage, factory)
  assert.equal(Object.values(a.tab.sj.recoveryData(storage)).some(v => v.includes('B private song')), false, 'B archive hidden from A')
  assert.ok(Object.values(a.tab.sj.recoveryData(storage)).some(v => v.includes('Synthetic Song 000001')), 'A still sees its archives')
  const off = h.newTab()
  storage.removeItem('gtar_library_b2_enabled')
  assert.equal(Object.values(off.sj.recoveryData(storage)).some(v => v.includes('B private song')), false, 'hidden with B2 off')
  assert.ok(allValues(storage).some(([, v]) => v.includes('B private song')), 'B archive preserved, not deleted')
})

test('F6: a restore safety snapshot in B\'s partition never lands in the shared single-key snapshot', async () => {
  const { storage, factory } = device({ owner: 'user-a', session: 'user-b' })
  const b = await open(storage, factory)
  const ex = require('../src/utils/backupExport.ts')
  const jb = require('../src/utils/jsonBackup.ts')
  const result = await ex.ensureRestoreSafetySnapshot({ songs: [{ id: 'b-1', title: 'B private song', artist: '', rawContent: '[D]b' }], setlists: [] }, storage)
  assert.equal(storage.getItem(jb.RESTORE_SNAPSHOT_KEY), null)
  assert.equal(result.location, 'recovery-archive')
  h.signIn(storage, 'user-a')
  const off = h.newTab()
  storage.removeItem('gtar_library_b2_enabled')
  assert.equal(Object.values(off.sj.recoveryData(storage)).some(v => v.includes('B private song')), false)
  void b
})

// F7: shared setlist publishing
test('F7: with B2 on, shared setlist create/update is refused with a B2-specific reason before any request; unpublish still allowed', async () => {
  const { storage, factory } = device()
  const { tab } = await open(storage, factory)
  const pub = require('../src/utils/sharedSetlistPublishing.ts')
  const realFetch = global.fetch
  let requests = 0
  global.fetch = async () => { requests++; return new Response(JSON.stringify({ success: false }), { status: 503 }) }
  try {
    const lib = tab.sj.readPersistedLibrary(storage)
    await assert.rejects(pub.preparePublication(lib.setlists[0].id, () => lib, () => false), /new device storage \(B2\)/)
    await assert.rejects(pub.sendPublicationIntent('user-a', lib.setlists[0].id, { publicationKey: 'k', pending: { method: 'POST', key: 'k', body: {} } }), /new device storage \(B2\)/)
    assert.equal(requests, 0)
    // Unpublishing sends no library content: whatever else it needs, B2 is not the reason it stops.
    const unpublish = await pub.sendPublicationIntent('user-a', lib.setlists[0].id, { publicationKey: 'k', result: { id: 'p', revision: 1, unpublished: false }, pending: { method: 'DELETE', id: 'p', key: 'k', body: {} } })
      .then(() => null, error => error)
    assert.doesNotMatch(String(unpublish?.message ?? ''), /new device storage \(B2\)/, 'unpublish is not blocked by B2')
  } finally { global.fetch = realFetch }
})
