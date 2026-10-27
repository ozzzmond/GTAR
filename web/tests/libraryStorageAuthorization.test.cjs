// #258 storage read authorization: owner-bound legacy library, open B2 partitions and recovery
// archives are returned only to the verified owner of the current sign-in. Synthetic fixtures only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/b2Harness.cjs')
const { installNavigatorLocks } = require('./helpers/fakeLocks.cjs')

installNavigatorLocks()
const V1 = 'gtar_library_v1'
const A_TITLE = /Synthetic Song|A private/

function owned({ owner = 'user-a', b2 = false } = {}) {
  const storage = h.freshStorage()
  const factory = new h.Factory()
  const tab = h.newTab()
  if (owner) { h.bindOwner(storage, owner); h.signIn(storage, owner) }
  tab.sj.persistLibrary(h.library(8, 1), storage)
  if (b2) tab.sj.enableLibraryB2(storage)
  return { storage, factory }
}
const snapshot = storage => new Map([...storage.map.entries()].filter(([k]) => !k.startsWith('gtar_auth_session')))
const rotate = storage => {
  const session = JSON.parse(storage.getItem('gtar_auth_session'))
  storage.setItem('gtar_auth_session', JSON.stringify({ ...session, sessionToken: `rotated-${Math.random()}` }))
}
/** Every public read/write entry point refuses or returns nothing of A; storage unchanged. */
async function assertClosed(tab, storage, token) {
  const before = snapshot(storage)
  assert.throws(() => tab.sj.readPersistedLibrary(storage), 'read')
  assert.throws(() => tab.sj.peekPersistedLibrary(storage), 'peek')
  assert.throws(() => tab.sj.libraryRevision(storage), 'revision')
  assert.equal(tab.sj.getPersistedLibraryRaw(storage), null, 'raw')
  if (token) {
    assert.throws(() => tab.sj.decodeLibraryRevision(token), 'decode of an earlier revision token')
    assert.equal(tab.sj.libraryMatchesRevision({ songs: [], setlists: [] }, token), false)
  }
  assert.equal(A_TITLE.test(JSON.stringify(tab.sj.recoveryExportData(storage))), false, 'export')
  assert.equal(A_TITLE.test(JSON.stringify(tab.sj.recoveryData(storage))), false, 'recovery data')
  assert.throws(() => tab.sj.persistLibrary({ songs: [], setlists: [] }, storage), 'save')
  assert.throws(() => tab.sj.restoreLibraryRevision(null, storage), 'restore')
  const facts = await require('../src/utils/useSyncStatus.ts').readSyncDeviceFacts(storage)
  assert.equal(facts.songs, null, 'startup sync facts')
  assert.deepEqual(snapshot(storage), before, 'nothing mutated')
}

// R1: owner-bound legacy library, B2 off
test('R1: valid owner reads, peeks, exports, saves and restores the legacy library', async () => {
  const { storage } = owned()
  const tab = h.newTab()
  const lib = tab.sj.readPersistedLibrary(storage)
  assert.equal(lib.songs.length, 8)
  assert.ok(tab.sj.peekPersistedLibrary(storage))
  assert.ok(A_TITLE.test(JSON.stringify(tab.sj.recoveryExportData(storage))))
  const raw = tab.sj.libraryRevision(storage)
  tab.sj.persistLibrary({ ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, title: 'A private edit' } : s) }, storage, { expectedRaw: raw })
  tab.sj.restoreLibraryRevision(raw, storage)
  assert.equal(tab.sj.readPersistedLibrary(storage).songs[0].title, lib.songs[0].title)
})

for (const [label, change] of [
  ['signed out', s => h.signIn(s, null)],
  ['signed out, then reload', s => h.signIn(s, null)],
  ['malformed owner record, signed in as owner', s => s.setItem('gtar_library_owner_v1', '{broken')],
  ['owner record for another environment', s => s.setItem('gtar_library_owner_v1', JSON.stringify({ v: 1, userId: 'user-a', env: 'other.host', boundAt: 1, reason: 'confirmed' }))],
  ['malformed owner record, signed out', s => { s.setItem('gtar_library_owner_v1', '{broken'); h.signIn(s, null) }],
]) {
  test(`R1: ${label}: no owner-bound data returned or changed`, async () => {
    const { storage } = owned()
    const live = h.newTab()
    change(storage)
    await assertClosed(label.includes('reload') ? h.newTab() : live, storage)
    assert.ok(storage.getItem(V1), 'legacy library kept')
  })
}

test('R1: startup paths (B1 preparation, recovery notice, housekeeping) neither expose nor change it while signed out', async () => {
  const { storage } = owned()
  h.signIn(storage, null)
  const tab = h.newTab()
  const before = snapshot(storage)
  assert.deepEqual(await tab.sj.prepareLibraryStorage(storage), { indexed: false, fellBack: false })
  assert.equal(tab.sj.performStorageHousekeeping(storage), false)
  assert.equal(tab.sj.hasActionableRecovery(storage) === true || tab.sj.hasActionableRecovery(storage) === false, true)
  assert.deepEqual(snapshot(storage), before)
})

test('R1: a library never linked to an account stays usable on this device, signed in or out (explicit policy)', () => {
  const { storage } = owned({ owner: null })
  const tab = h.newTab()
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 8)
  h.signIn(storage, 'user-c')
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 8)
})

// R2: an already-open B2 partition after the sign-in changes
async function openA() {
  const d = owned({ b2: true })
  const tab = h.newTab()
  const prepared = await tab.sj.prepareLibraryB2(d.storage, { factory: d.factory })
  assert.equal(prepared.active, true)
  return { ...d, tab, token: tab.sj.libraryRevision(d.storage) }
}
for (const [label, change] of [['session switched to B', s => h.signIn(s, 'user-b')], ['signed out', s => h.signIn(s, null)]]) {
  test(`R2: open A partition, ${label}: every read, decode, export and save refuses`, async () => {
    const { storage, tab, token } = await openA()
    change(storage)
    await assertClosed(tab, storage, token)
  })
}

test('R2: token rotation for the same account keeps access (same verified owner)', async () => {
  const { storage, tab } = await openA()
  rotate(storage)
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 8)
})

test('R2: a queued revision load that completes after the switch returns nothing', async () => {
  const { storage, factory, tab } = await openA()
  const other = h.newTab()
  await other.sj.prepareLibraryB2(storage, { factory })
  const lib = other.sj.readPersistedLibrary(storage)
  other.sj.persistLibrary({ ...lib, songs: lib.songs.map((s, i) => i === 1 ? { ...s, title: 'A private newer' } : s) }, storage, { expectedRaw: other.sj.libraryRevision(storage) })
  const newer = other.sj.libraryRevision(storage)
  const outcome = tab.sj.loadLibraryRevision(newer).then(() => null, error => error) // waits for the other tab's commit
  h.signIn(storage, 'user-b')
  await other.b2.flushB2().catch(() => {})
  assert.equal((await outcome)?.name, 'LibraryPartitionError')
  assert.throws(() => tab.sj.decodeLibraryRevision(newer))
})

test('R2: A → B → A: B sees nothing of A; A reopens everything', async () => {
  const { storage, factory, tab } = await openA()
  h.signIn(storage, 'user-b')
  await assertClosed(tab, storage)
  const b = h.newTab()
  await b.sj.prepareLibraryB2(storage, { factory })
  assert.deepEqual(b.sj.readPersistedLibrary(storage).songs, [])
  h.signIn(storage, 'user-a')
  const a = h.newTab()
  await a.sj.prepareLibraryB2(storage, { factory })
  assert.equal(a.sj.readPersistedLibrary(storage).songs.length, 8)
})

// R3: direct archive lookup
test('R3: readRecoveryArchive enforces ownership and partition scope; nothing deleted or relabelled', async () => {
  const { storage, factory } = owned({ b2: true })
  const legacyKey = 'gtar_sync_recovery:replacement:1:a'
  storage.setItem(legacyKey, JSON.stringify({ raw: storage.getItem(V1) }))
  // B writes an archive in its own partition.
  h.signIn(storage, 'user-b')
  const b = h.newTab()
  await b.sj.prepareLibraryB2(storage, { factory })
  b.sj.persistLibrary({ songs: [{ id: 'b-1', title: 'B private song', artist: '', rawContent: '[D]b' }], setlists: [] }, storage, { expectedRaw: b.sj.libraryRevision(storage) })
  const bKey = b.sj.saveCrossTabConflictSnapshot(b.sj.readPersistedLibrary(storage), storage)
  assert.match(b.sj.readRecoveryArchive(bKey, storage), /B private song/, 'scoped lookup: own archive')
  assert.equal(b.sj.readRecoveryArchive(legacyKey, storage), null, 'B cannot read A\'s untagged archive by key')
  const scopes = storage.getItem('gtar_recovery_scopes_v1')
  // A (B2 open as A) cannot read B's archive by key.
  h.signIn(storage, 'user-a')
  const a = h.newTab()
  await a.sj.prepareLibraryB2(storage, { factory })
  assert.equal(a.sj.readRecoveryArchive(bKey, storage), null)
  assert.match(a.sj.readRecoveryArchive(legacyKey, storage), /Synthetic Song/)
  // Signed out (and B2 off): nothing by key.
  h.signIn(storage, null)
  const out = h.newTab()
  assert.equal(out.sj.readRecoveryArchive(legacyKey, storage), null)
  assert.equal(out.sj.readRecoveryArchive(bKey, storage), null)
  // A → B → A: still the same, and every archive and tag is preserved.
  h.signIn(storage, 'user-a')
  assert.match(h.newTab().sj.readRecoveryArchive(legacyKey, storage), /Synthetic Song/)
  assert.ok(storage.getItem(legacyKey) && storage.getItem(bKey))
  assert.equal(storage.getItem('gtar_recovery_scopes_v1'), scopes)
})
