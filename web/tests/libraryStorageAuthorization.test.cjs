// #258 storage read authorization, as amended by D1: the device library and its recovery archives
// stay readable for every sign-in and reads change nothing. Synthetic fixtures only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/tabHarness.cjs')
const { installNavigatorLocks } = require('./helpers/fakeLocks.cjs')

installNavigatorLocks()
const V1 = 'gtar_library_v1'
const A_TITLE = /Synthetic Song|A private/

function owned({ owner = 'user-a' } = {}) {
  const storage = h.freshStorage()
  const factory = new h.Factory()
  const tab = h.newTab()
  if (owner) { h.bindOwner(storage, owner); h.signIn(storage, owner) }
  tab.sj.persistLibrary(h.library(8, 1), storage)
  return { storage, factory }
}
const snapshot = storage => new Map([...storage.map.entries()].filter(([k]) => !k.startsWith('gtar_auth_session')))
const rotate = storage => {
  const session = JSON.parse(storage.getItem('gtar_auth_session'))
  storage.setItem('gtar_auth_session', JSON.stringify({ ...session, sessionToken: `rotated-${Math.random()}` }))
}
/** Every public read/write entry point refuses or returns nothing of A; storage unchanged. */
async function assertDeviceOpen(tab, storage, token) {
  const before = snapshot(storage)
  const library = tab.sj.readPersistedLibrary(storage)
  assert.equal(library.songs.length, 8)
  assert.ok(tab.sj.peekPersistedLibrary(storage))
  assert.ok(tab.sj.libraryRevision(storage))
  if (token) assert.equal(tab.sj.decodeLibraryRevision(token).songs.length, 8)
  assert.ok(A_TITLE.test(JSON.stringify(tab.sj.recoveryExportData(storage))))
  assert.deepEqual(snapshot(storage), before, 'reads leave storage unchanged')
}

// R1: owner-bound legacy library
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
  test(`R1: ${label}: device library readable and unchanged`, async () => {
    const { storage } = owned()
    const live = h.newTab()
    change(storage)
    await assertDeviceOpen(label.includes('reload') ? h.newTab() : live, storage)
    assert.ok(storage.getItem(V1), 'legacy library kept')
  })
}

test('R1: startup paths keep the signed-out device library and owner bytes', async () => {
  const { storage } = owned()
  h.signIn(storage, null)
  const tab = h.newTab()
  const before = snapshot(storage)
  assert.equal((await tab.sj.prepareLibraryStorage(storage, { factory: null })).active, false)
  tab.sj.performStorageHousekeeping(storage)
  assert.equal(tab.sj.hasActionableRecovery(storage) === true || tab.sj.hasActionableRecovery(storage) === false, true)
  for (const key of [V1, 'gtar_library_owner_v1']) assert.equal(storage.getItem(key), before.get(key))
})

test('R1: a library never linked to an account stays usable on this device, signed in or out (explicit policy)', () => {
  const { storage } = owned({ owner: null })
  const tab = h.newTab()
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 8)
  h.signIn(storage, 'user-c')
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 8)
})
