// #247 Option A: Unbound populated device library read-only guard.
// When a signed-in account encounters an unbound populated device library, local mutations
// are prevented and an actionable ownership warning is shown until ownership is explicitly
// confirmed or a safe isolated library is selected.
'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/b2Harness.cjs')
const { installNavigatorLocks } = require('./helpers/fakeLocks.cjs')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

installNavigatorLocks()

const V1 = 'gtar_library_v1'
const OWNER_KEY = 'gtar_library_owner_v1'

/** Fixture matching DEV field evidence: populated legacy library, owner record absent, B2 disabled. */
function unboundDevice({ n = 5, setlistCount = 2 } = {}) {
  const storage = h.freshStorage()
  const factory = new h.Factory()
  const tab = h.newTab()
  tab.sj.persistLibrary(h.library(n, setlistCount), storage)
  // Ensure owner record is absent (unbound)
  storage.removeItem(OWNER_KEY)
  return { storage, factory }
}

const snapshot = storage => new Map([...storage.map.entries()].filter(([k]) => !k.startsWith('gtar_auth_session')))

test('REPRO: Before/after reproduction: Account B cannot delete or mutate Account A\'s unbound device library', async () => {
  const { storage } = unboundDevice({ n: 3, setlistCount: 0 })
  const beforeState = snapshot(storage)
  const initialV1 = storage.getItem(V1)

  // Account B signs in
  h.signIn(storage, 'user-b')
  const tabB = h.newTab()

  // B can read and browse
  const lib = tabB.sj.readPersistedLibrary(storage)
  assert.equal(lib.songs.length, 3, 'Account B can read existing songs')
  assert.equal(tabB.sj.isUnboundDeviceLibraryReadOnly(storage), true, 'Library detected as unbound read-only for B')

  // B attempts to delete a song
  const songToDelete = lib.songs[0]
  const mutatedLib = {
    ...lib,
    songs: lib.songs.filter(s => s.id !== songToDelete.id),
  }

  // Refusal proof: mutation must throw LibraryOwnershipError('unbound')
  assert.throws(
    () => tabB.sj.persistLibrary(mutatedLib, storage),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'persistLibrary refuses mutation on unbound populated library'
  )

  // Verify storage was untouched by B's failed mutation
  assert.equal(storage.getItem(V1), initialV1, 'Storage V1 payload unchanged')
  assert.deepEqual(snapshot(storage), beforeState, 'Entire storage snapshot unchanged')

  // Account A signs in
  h.signIn(storage, 'user-a')
  const tabA = h.newTab()
  const libA = tabA.sj.readPersistedLibrary(storage)

  // A sees original content completely intact
  assert.equal(libA.songs.length, 3, 'Account A observes all original songs intact')
  assert.equal(libA.songs[0].id, songToDelete.id, 'Original song preserved')
})

test('Signed-in unbound populated library: read and export allowed, mutations blocked', async () => {
  const { storage } = unboundDevice({ n: 4 })
  h.signIn(storage, 'user-b')
  const tab = h.newTab()

  // Reading allowed
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 4)
  assert.ok(tab.sj.peekPersistedLibrary(storage))
  assert.ok(tab.sj.libraryRevision(storage))

  // Export allowed
  const exportData = tab.sj.recoveryExportData(storage)
  assert.ok(exportData)

  // Block creation
  const newSong = { id: 'new-song-1', title: 'New Song', artist: '', rawContent: '[C]test' }
  const currentLib = tab.sj.readPersistedLibrary(storage)
  assert.throws(() => tab.sj.persistLibrary({ ...currentLib, songs: [newSong, ...currentLib.songs] }, storage))

  // Block edit
  assert.throws(() => tab.sj.persistLibrary({ ...currentLib, songs: currentLib.songs.map((s, i) => i === 0 ? { ...s, title: 'Edited' } : s) }, storage))

  // Block delete
  assert.throws(() => tab.sj.persistLibrary({ ...currentLib, songs: currentLib.songs.slice(1) }, storage))

  // Block restore revision
  assert.throws(() => tab.sj.restoreLibraryRevision(tab.sj.libraryRevision(storage), storage))

  // Block repair
  assert.throws(() => tab.sj.applyDanglingReferenceRepair({ raw: tab.sj.libraryRevision(storage), references: [] }, storage))
})

test('Verified-owner account: normal edits preserved', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.bindOwner(storage, 'user-a')
  h.signIn(storage, 'user-a')
  const tab = h.newTab()

  assert.equal(tab.sj.isUnboundDeviceLibraryReadOnly(storage), false)
  const lib = tab.sj.readPersistedLibrary(storage)
  const updated = {
    ...lib,
    songs: lib.songs.map((s, i) => i === 0 ? { ...s, title: 'Owner Edit Verified' } : s),
  }
  tab.sj.persistLibrary(updated, storage, { expectedRaw: tab.sj.libraryRevision(storage) })
  assert.equal(tab.sj.readPersistedLibrary(storage).songs[0].title, 'Owner Edit Verified')
})

test('Different account with bound library: existing partition safeguards preserved', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.bindOwner(storage, 'user-a')
  h.signIn(storage, 'user-b')
  const tab = h.newTab()

  assert.equal(tab.sj.isLegacyLibraryBlocked(storage), true)
  assert.throws(() => tab.sj.readPersistedLibrary(storage))
  assert.throws(() => tab.sj.persistLibrary({ songs: [], setlists: [] }, storage))
})

test('Signed-out offline library: normal local edits preserved', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.signIn(storage, null) // signed out
  const tab = h.newTab()

  assert.equal(tab.sj.isUnboundDeviceLibraryReadOnly(storage), false)
  const lib = tab.sj.readPersistedLibrary(storage)
  const updated = {
    ...lib,
    songs: lib.songs.map((s, i) => i === 0 ? { ...s, title: 'Offline Local Edit' } : s),
  }
  tab.sj.persistLibrary(updated, storage, { expectedRaw: tab.sj.libraryRevision(storage) })
  assert.equal(tab.sj.readPersistedLibrary(storage).songs[0].title, 'Offline Local Edit')
})

test('Unbound empty library: preserve established onboarding semantics', async () => {
  const storage = h.freshStorage()
  h.signIn(storage, 'user-new')
  const tab = h.newTab()

  // Empty library on device
  tab.sj.persistLibrary({ songs: [], setlists: [] }, storage)
  storage.removeItem(OWNER_KEY)

  assert.equal(tab.sj.isUnboundDeviceLibraryReadOnly(storage), false, 'Empty unbound library is not blocked')
  assert.equal(tab.owner.libraryOwnership('user-new', storage), 'unbound-empty')

  // On first sync with an empty library: assertLibraryOwner automatically binds ownership
  tab.owner.assertLibraryOwner('user-new', storage)
  assert.equal(JSON.parse(storage.getItem(OWNER_KEY)).userId, 'user-new')
  assert.equal(tab.owner.libraryOwnership('user-new', storage), 'owned')

  // User creates their first song
  const firstSong = { id: 'song-1', title: 'First Song', artist: '', rawContent: '[G]Hello' }
  tab.sj.persistLibrary({ songs: [firstSong], setlists: [] }, storage)
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 1)
})

test('A → B → A: no cross-account local mutation across session transitions', async () => {
  const { storage } = unboundDevice({ n: 5 })
  const before = snapshot(storage)

  // Account B signs in and tries multiple mutations
  h.signIn(storage, 'user-b')
  const tabB = h.newTab()
  const currentLib = tabB.sj.readPersistedLibrary(storage)

  assert.throws(() => tabB.sj.persistLibrary({ songs: [], setlists: [] }, storage))
  assert.throws(() => tabB.sj.persistLibrary({ songs: currentLib.songs.slice(1), setlists: [] }, storage))
  assert.throws(() => tabB.sj.restoreLibraryRevision(null, storage))

  assert.deepEqual(snapshot(storage), before, 'Storage completely unchanged by B')

  // Account A signs in
  h.signIn(storage, 'user-a')
  const tabA = h.newTab()
  const libA = tabA.sj.readPersistedLibrary(storage)
  assert.equal(libA.songs.length, 5)
  assert.deepEqual(snapshot(storage), before, 'A sees exact original storage')
})

test('Async account switch during write: fails closed', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.bindOwner(storage, 'user-a')
  h.signIn(storage, 'user-a')
  const tab = h.newTab()

  // Write started under user-a session
  const genA = tab.owner.captureSessionGeneration(storage)
  assert.equal(genA.userId, 'user-a')
  const lib = tab.sj.readPersistedLibrary(storage)

  // Session switches to user-b before write commits
  h.signIn(storage, 'user-b')

  // persist with stale generation must fail closed
  assert.throws(
    () => tab.sj.persistLibrary(lib, storage, { generation: genA }),
    err => err.name === 'StaleSyncRoundError' && err.reason === 'session-changed'
  )

  // Session logs out before write commits
  h.signIn(storage, null)
  assert.throws(
    () => tab.sj.persistLibrary(lib, storage, { generation: genA }),
    err => err.name === 'StaleSyncRoundError' && err.reason === 'signed-out'
  )
})

test('Linking: explicit owner confirmation and recovery snapshot required', async () => {
  const { storage } = unboundDevice({ n: 4 })
  h.signIn(storage, 'user-b')
  const tab = h.newTab()

  assert.equal(tab.sj.isUnboundDeviceLibraryReadOnly(storage), true)

  // Explicit linking workflow
  await tab.owner.confirmLibraryOwner('user-b', storage)

  // Verify recovery snapshot was created
  const recoveryKeys = [...storage.map.keys()].filter(k => k.startsWith('gtar_sync_recovery:owner-confirm:'))
  assert.ok(recoveryKeys.length > 0, 'Recovery snapshot archive was saved')

  // Verify owner record saved
  const ownerRecord = JSON.parse(storage.getItem(OWNER_KEY))
  assert.equal(ownerRecord.userId, 'user-b')
  assert.equal(ownerRecord.reason, 'confirmed')

  // Library is now owned and editable
  assert.equal(tab.sj.isUnboundDeviceLibraryReadOnly(storage), false)
  assert.equal(tab.owner.libraryOwnership('user-b', storage), 'owned')

  const lib = tab.sj.readPersistedLibrary(storage)
  tab.sj.persistLibrary({ ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, title: 'Linked Owner Save' } : s) }, storage, { expectedRaw: tab.sj.libraryRevision(storage) })
  assert.equal(tab.sj.readPersistedLibrary(storage).songs[0].title, 'Linked Owner Save')
})

test('UI Guard and Actionable Warning Banner: App renders warning banner and links on click', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.signIn(storage, 'user-b')

  for (const key of Object.keys(require.cache)) if (key.includes('/src/')) delete require.cache[key]
  global.IS_REACT_ACT_ENVIRONMENT = true
  global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }))
  global.matchMedia = global.window.matchMedia
  document.body.innerHTML = '<div id="root"></div>'

  const App = require('../src/App.tsx').default
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(App)))

    // Actionable warning banner is displayed
    const banner = document.querySelector('[data-testid="unbound-library-warning"]')
    assert.ok(banner, 'Unbound library warning banner is displayed')
    assert.match(banner.textContent, /not yet linked to an account/i)
    assert.match(banner.textContent, /stored on this browser/i)

    // Link button is present
    const linkBtn = document.querySelector('[data-testid="link-unbound-library-button"]')
    assert.ok(linkBtn, 'Link to this account button is present')

    // Click link button
    await act(async () => {
      linkBtn.click()
    })

    // After linking, banner is cleared and owner is bound
    const bannerAfter = document.querySelector('[data-testid="unbound-library-warning"]')
    assert.equal(bannerAfter, null, 'Warning banner is cleared after linking')
    assert.equal(JSON.parse(storage.getItem(OWNER_KEY)).userId, 'user-b')
  } finally {
    await act(async () => root.unmount())
  }
})
