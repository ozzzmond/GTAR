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

test('FIX_R1: Recovery mutation APIs fail closed on unbound populated library; linking snapshot preserved', async () => {
  const { storage } = unboundDevice({ n: 3 })
  const archiveKey = 'gtar_sync_recovery:manual:1000:test-archive'
  const archivePayload = JSON.stringify({ local: { songs: [{ id: 's1', title: 'Archive Song' }], setlists: [] } })
  storage.setItem(archiveKey, archivePayload)

  // Account B signs in
  h.signIn(storage, 'user-b')
  const tab = h.newTab()

  assert.equal(tab.sj.isUnboundDeviceLibraryReadOnly(storage), true)

  // 1. Reading and inspecting recovery data is preserved (safe read/export)
  assert.equal(tab.sj.readRecoveryArchive(archiveKey, storage), archivePayload)
  const review = tab.sj.inspectRecovery(storage)
  assert.ok(review)
  const exportData = tab.sj.recoveryExportData(storage)
  assert.ok(exportData)

  // 2. confirmRecoveryCleanup fails closed
  await assert.rejects(
    () => tab.sj.confirmRecoveryCleanup(review, true, () => false, storage),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'confirmRecoveryCleanup must fail closed on unbound library'
  )

  // 3. recordRecoveryChoice fails closed
  await assert.rejects(
    () => tab.sj.recordRecoveryChoice(review, 'keep-current', () => false, storage),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'recordRecoveryChoice must fail closed on unbound library'
  )

  // 4. writeRecoverySnapshot overwriting existing archive fails closed (destructive)
  await assert.rejects(
    () => tab.sj.writeRecoverySnapshot(archiveKey, JSON.stringify({ local: { songs: [], setlists: [] } }), storage),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'writeRecoverySnapshot overwriting existing archive fails closed'
  )

  // 5. writeRecoverySnapshot with arbitrary new key fails closed
  await assert.rejects(
    () => tab.sj.writeRecoverySnapshot('gtar_sync_recovery:records:999:unauthorized', JSON.stringify({}), storage),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'writeRecoverySnapshot with non-linking key fails closed'
  )

  // 5b. Forged owner-confirm key with arbitrary payload fails closed without verified linking context
  await assert.rejects(
    () => tab.sj.writeRecoverySnapshot('gtar_sync_recovery:owner-confirm:invented:attacker-999', JSON.stringify({ malicious: true }), storage),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'writeRecoverySnapshot with forged owner-confirm prefix must fail closed'
  )

  // 5c. Failed linking never binds owner or deletes archives
  const brokenStorage = h.freshStorage()
  tab.sj.persistLibrary(h.library(2, 0), brokenStorage)
  h.signIn(brokenStorage, 'user-fail-link')
  const initialArchives = ['gtar_sync_recovery:preexisting:1']
  brokenStorage.setItem(initialArchives[0], JSON.stringify({ safe: true }))
  // Simulate account switch during linking
  const tabFail = h.newTab()
  // Mock writeRecoverySnapshot on tabFail to simulate account switch before snapshot verifies
  const origWrite = tabFail.sj.writeRecoverySnapshot
  tabFail.sj.writeRecoverySnapshot = async (k, r, s) => {
    h.signIn(brokenStorage, 'user-switch-intruder')
    return origWrite(k, r, s)
  }
  await assert.rejects(
    () => tabFail.owner.confirmLibraryOwner('user-fail-link', brokenStorage),
    'Failed linking attempt aborts'
  )
  assert.equal(brokenStorage.getItem(OWNER_KEY), null, 'Failed linking never binds owner')
  assert.equal(brokenStorage.getItem(initialArchives[0]), JSON.stringify({ safe: true }), 'Failed linking never deletes archives')

  // Verify archive was NOT deleted or mutated
  assert.equal(storage.getItem(archiveKey), archivePayload, 'Existing recovery archive preserved byte-for-byte')

  // 6. Verified snapshot required for explicit owner linking continues working
  await tab.owner.confirmLibraryOwner('user-b', storage)
  const confirmSnapshots = [...storage.map.keys()].filter(k => k.startsWith('gtar_sync_recovery:owner-confirm:'))
  assert.ok(confirmSnapshots.length > 0, 'Owner-confirm snapshot succeeded during legitimate linking')
  assert.equal(tab.sj.isUnboundDeviceLibraryReadOnly(storage), false, 'Now linked and editable')
})

test('FIX_R2: Asynchronous local mutations enforce mandatory operation context without optional args', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.bindOwner(storage, 'user-a')
  h.signIn(storage, 'user-a')
  const tab = h.newTab()
  const lib = tab.sj.readPersistedLibrary(storage)

  // Case 1: Pause write -> logout -> resume without generation argument: FAILS CLOSED
  tab.sj.beginAsyncMutation(storage)
  h.signIn(storage, null) // logout during pause
  assert.throws(
    () => tab.sj.persistLibrary(lib, storage), // no generation argument passed
    err => err.name === 'StaleSyncRoundError' && err.reason === 'signed-out',
    'Stale write after logout must fail closed even without options.generation'
  )

  // Case 2: Pause write -> account switch -> resume without generation argument: FAILS CLOSED
  h.signIn(storage, 'user-a')
  tab.sj.beginAsyncMutation(storage)
  h.signIn(storage, 'user-b') // account switch during pause
  assert.throws(
    () => tab.sj.persistLibrary(lib, storage),
    err => err.name === 'StaleSyncRoundError' && err.reason === 'session-changed',
    'Stale write after account switch must fail closed even without options.generation'
  )

  // Case 3: Pause write -> same-account token rotation -> resume without generation argument: FAILS CLOSED
  h.signIn(storage, 'user-a')
  tab.sj.beginAsyncMutation(storage)
  // Simulate token rotation for user-a
  storage.setItem('gtar_auth_session', JSON.stringify({
    user: { id: 'user-a', email: 'user-a@example.test' },
    sessionToken: 'token-user-a-rotated-new',
  }))
  assert.throws(
    () => tab.sj.persistLibrary(lib, storage),
    err => err.name === 'StaleSyncRoundError' && err.reason === 'session-changed',
    'Stale write after token rotation must fail closed even without options.generation'
  )

  // Case 4: Concurrent/nested async operations: Op 2 commit does not discard Op 1 isolated context
  h.signIn(storage, 'user-a')
  const ctx1 = tab.sj.beginAsyncMutation(storage)
  const ctx2 = tab.sj.beginAsyncMutation(storage)
  // Op 2 commits successfully
  assert.doesNotThrow(() => tab.sj.persistLibrary(lib, storage, { context: ctx2 }))
  // Token rotates during Op 1's pause
  storage.setItem('gtar_auth_session', JSON.stringify({
    user: { id: 'user-a', email: 'user-a@example.test' },
    sessionToken: 'token-user-a-rotated-v2',
  }))
  // Op 1 resumes without arguments -> must fail closed because its isolated context was preserved
  assert.throws(
    () => tab.sj.persistLibrary(lib, storage),
    err => err.name === 'StaleSyncRoundError' && err.reason === 'session-changed',
    'Op 1 fails closed on token rotation after concurrent Op 2 committed'
  )

  // Case 5: Rejection cleanup prevents poisoning of later legitimate signed-out offline editing
  const rejStorage = h.freshStorage()
  rejStorage.setItem(V1, JSON.stringify({ songs: [{ id: 's1', title: 'S1', artist: '', rawContent: '[C]' }], setlists: [] }))
  h.signIn(rejStorage, 'user-a')
  const tabRej = h.newTab()
  const rejLib = tabRej.sj.readPersistedLibrary(rejStorage)
  tabRej.sj.beginAsyncMutation(rejStorage)
  // Op rejects on unbound library
  assert.throws(() => tabRej.sj.persistLibrary(rejLib, rejStorage))
  // User signs out and edits offline -> MUST SUCCEED without poison from rejected context
  h.signIn(rejStorage, null)
  assert.doesNotThrow(
    () => tabRej.sj.persistLibrary({ songs: [{ id: 's1', title: 'Clean Offline Edit', artist: '', rawContent: '[C]' }], setlists: [] }, rejStorage),
    'Signed-out offline editing succeeds after earlier operation rejected'
  )

  // Case 6: Direct persistence APIs enforce async-session checks
  const directStorage = h.freshStorage()
  h.bindOwner(directStorage, 'user-a')
  h.signIn(directStorage, 'user-a')
  const tabDirect = h.newTab()
  const revA = tabDirect.sj.libraryRevision(directStorage)
  tabDirect.sj.beginAsyncMutation(directStorage)
  h.signIn(directStorage, 'user-b') // switch account
  assert.throws(
    () => tabDirect.sj.restoreLibraryRevision(revA, directStorage),
    err => err.name === 'StaleSyncRoundError' || err.name === 'LibraryOwnershipError' || err.name === 'LibraryPartitionBlockedError',
    'restoreLibraryRevision enforces active async operation checks'
  )

  // Case 7: Legitimate signed-out editing initiated while signed out: PRESERVED
  const { storage: signedOutStorage } = unboundDevice({ n: 3 })
  h.signIn(signedOutStorage, null)
  const tabSignedOut = h.newTab()
  const signedOutLib = tabSignedOut.sj.readPersistedLibrary(signedOutStorage)
  tabSignedOut.sj.beginAsyncMutation(signedOutStorage)
  const offlineEdit = { ...signedOutLib, songs: signedOutLib.songs.map((s, i) => i === 0 ? { ...s, title: 'Valid Offline Edit' } : s) }
  assert.doesNotThrow(
    () => tabSignedOut.sj.persistLibrary(offlineEdit, signedOutStorage),
    'Signed-out async mutation completes when initiated while signed out'
  )
  assert.equal(tabSignedOut.sj.readPersistedLibrary(signedOutStorage).songs[0].title, 'Valid Offline Edit')
})

test('FIX_R3: Repeated onboarding edits work without silent ownership binding or bypass of populated library', async () => {
  const storage = h.freshStorage()
  h.signIn(storage, 'user-onboard')
  const tab = h.newTab()

  // Fresh device: empty unbound library
  // Empty save under user-onboard MUST NOT record creator provenance
  tab.sj.persistLibrary({ songs: [], setlists: [] }, storage)
  storage.removeItem(OWNER_KEY)

  assert.equal(tab.sj.isUnboundDeviceLibraryReadOnly(storage), false, 'Empty library initially not read-only')
  assert.equal(storage.getItem(OWNER_KEY), null, 'Owner record absent before first save')
  assert.equal(tab.sj.readOnboardingCreator(storage), null, 'Empty save does not record creator provenance')

  // Prove protection against offline populating after empty save:
  // If user logs out, populates offline, and re-authenticates as user-onboard:
  h.signIn(storage, null)
  const offlineSongs = [{ id: 'offline-1', title: 'Offline Song', artist: '', rawContent: '[C]Offline' }]
  tab.sj.persistLibrary({ songs: offlineSongs, setlists: [] }, storage)
  h.signIn(storage, 'user-onboard')
  assert.equal(tab.sj.isUnboundDeviceLibraryReadOnly(storage), true, 'User-onboard cannot modify offline populated data')

  // Reset to clean empty storage for legitimate onboarding flow
  const freshOnboardingStorage = h.freshStorage()
  h.signIn(freshOnboardingStorage, 'user-onboard')
  const tabFresh = h.newTab()

  // Save 1: First song save succeeds and establishes provenance bound to revision
  const song1 = { id: 'song-1', title: 'Onboarding Song 1', artist: '', rawContent: '[C]Song 1' }
  tabFresh.sj.persistLibrary({ songs: [song1], setlists: [] }, freshOnboardingStorage)
  assert.equal(tabFresh.sj.readPersistedLibrary(freshOnboardingStorage).songs.length, 1)
  assert.equal(freshOnboardingStorage.getItem(OWNER_KEY), null, 'Owner record remains absent after first save (no silent binding)')
  const prov1 = tabFresh.sj.readOnboardingCreator(freshOnboardingStorage)
  assert.ok(prov1, 'Provenance established after initial content creation')
  assert.equal(prov1.userId, 'user-onboard')
  assert.equal(prov1.headRevision, tabFresh.sj.libraryRevision(freshOnboardingStorage))

  // Save 2: Second song save succeeds
  const song2 = { id: 'song-2', title: 'Onboarding Song 2', artist: '', rawContent: '[D]Song 2' }
  assert.doesNotThrow(
    () => tabFresh.sj.persistLibrary({ songs: [song1, song2], setlists: [] }, freshOnboardingStorage),
    'Second save succeeds in legitimate onboarding flow'
  )
  assert.equal(tabFresh.sj.readPersistedLibrary(freshOnboardingStorage).songs.length, 2)
  assert.equal(freshOnboardingStorage.getItem(OWNER_KEY), null, 'Owner record still absent after second save')

  // Save 3: Third edit succeeds
  const updatedSong1 = { ...song1, title: 'Onboarding Song 1 Edited' }
  assert.doesNotThrow(
    () => tabFresh.sj.persistLibrary({ songs: [updatedSong1, song2], setlists: [] }, freshOnboardingStorage),
    'Third edit succeeds in legitimate onboarding flow'
  )
  assert.equal(tabFresh.sj.readPersistedLibrary(freshOnboardingStorage).songs[0].title, 'Onboarding Song 1 Edited')
  assert.equal(freshOnboardingStorage.getItem(OWNER_KEY), null, 'Owner record still null (still unbound)')

  // Reload: simulated reload as user-onboard preserves editing
  const tabReloaded = h.newTab()
  assert.equal(tabReloaded.sj.isUnboundDeviceLibraryReadOnly(freshOnboardingStorage), false, 'Reloaded session preserves editing')

  // Signed-out edit clears provenance; re-authenticating as user-onboard fails closed
  h.signIn(freshOnboardingStorage, null)
  assert.doesNotThrow(
    () => tabFresh.sj.persistLibrary({ songs: [song1], setlists: [] }, freshOnboardingStorage),
    'Signed-out offline edit succeeds'
  )
  assert.equal(tabFresh.sj.readOnboardingCreator(freshOnboardingStorage), null, 'Signed-out edit cleared provenance')
  h.signIn(freshOnboardingStorage, 'user-onboard')
  assert.equal(tabFresh.sj.isUnboundDeviceLibraryReadOnly(freshOnboardingStorage), true, 'User-onboard blocked after offline modification')

  // Direct exported recordOnboardingCreator cannot spoof provenance on pre-populated unbound data
  const { storage: prePopulated } = unboundDevice({ n: 3 })
  h.signIn(prePopulated, 'user-attacker')
  const tabAttacker = h.newTab()
  assert.throws(
    () => tabAttacker.sj.recordOnboardingCreator(prePopulated, 'user-attacker'),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'recordOnboardingCreator refuses spoofing on pre-existing populated library'
  )
  assert.equal(tabAttacker.sj.isUnboundDeviceLibraryReadOnly(prePopulated), true)
  assert.throws(
    () => tabAttacker.sj.persistLibrary({ songs: [song1], setlists: [] }, prePopulated),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'Pre-existing populated library remains protected and cannot be bypassed via onboarding'
  )
})

test('Codex P1: Damaged unbound library with dangling references fails closed', async () => {
  const { storage } = unboundDevice({ n: 2 })
  // Corrupt the library by adding a dangling reference in setlists (causes validation failure in readPersistedLibrary)
  const damagedRaw = JSON.stringify({
    songs: [{ id: 's1', title: 'Song 1', artist: '', rawContent: '[C]1' }],
    setlists: [{ id: 'l1', name: 'List', songs: [{ id: 'dangling-id', title: 'Missing' }] }],
  })
  storage.setItem(V1, damagedRaw)

  // Account B signs in
  h.signIn(storage, 'user-b')
  const tab = h.newTab()

  // Damaged library must be recognized as having persisted content and be read-only
  assert.equal(tab.sj.hasPersistedContent(storage), true, 'Damaged library recognized as having content')
  assert.equal(tab.sj.isUnboundDeviceLibraryReadOnly(storage), true, 'Damaged library is read-only')

  // Unauthorized repair or mutation fails closed
  assert.throws(
    () => tab.sj.applyDanglingReferenceRepair({ raw: damagedRaw, references: ['dangling-id'] }, storage),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'Applying repair to damaged unbound library fails closed without linking'
  )
})

test('CODEX_R3_R1_1: Exported linking authorization rejects caller-controlled key/payload', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.signIn(storage, 'user-attacker')
  const tab = h.newTab()

  // Attempting to forge arbitrary archive authorization via exported helper fails closed
  assert.throws(
    () => tab.sj.beginLinkingSnapshotAuthorization(storage, 'gtar_sync_recovery:records:999:arbitrary', JSON.stringify({ malicious: true })),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'beginLinkingSnapshotAuthorization rejects caller-controlled key/payload'
  )

  // Subsequent arbitrary snapshot write fails closed
  await assert.rejects(
    () => tab.sj.writeRecoverySnapshot('gtar_sync_recovery:records:999:arbitrary', JSON.stringify({ malicious: true }), storage),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'Arbitrary archive write remains blocked'
  )
  assert.equal(storage.getItem('gtar_sync_recovery:records:999:arbitrary'), null, 'No arbitrary archive created')
})

test('CODEX_R3_R1_2: Stale-session linking authorization rejects archives across logout/session change', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.signIn(storage, 'user-a')
  const tab = h.newTab()

  // Transaction begun under user-a session
  const { key, raw } = tab.sj.beginLinkingTransaction(storage, 'user-a')

  // User logs out before snapshot write
  h.signIn(storage, null)
  await assert.rejects(
    () => tab.sj.writeRecoverySnapshot(key, raw, storage),
    err => /changed/i.test(err.message) || (err.name === 'StaleSyncRoundError' && err.reason === 'signed-out'),
    'Snapshot write under stale signed-out session fails closed'
  )
  assert.equal(storage.getItem(key), null, 'Zero archives written after logout')

  // Re-attempt under session change: begin under user-a, switch to user-b
  h.signIn(storage, 'user-a')
  const tx2 = tab.sj.beginLinkingTransaction(storage, 'user-a')
  h.signIn(storage, 'user-b')
  await assert.rejects(
    () => tab.sj.writeRecoverySnapshot(tx2.key, tx2.raw, storage),
    err => /changed/i.test(err.message) || (err.name === 'StaleSyncRoundError' && (err.reason === 'session-changed' || err.reason === 'signed-out')),
    'Snapshot write after account switch fails closed'
  )
  assert.equal(storage.getItem(tx2.key), null, 'Zero archives written after account switch')
})

test('CODEX_R3_R1_3: Logout or aborted linking invalidates authority and leaves no owner mutations', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.signIn(storage, 'user-link-abort')
  const tab = h.newTab()

  // Intercept writeRecoverySnapshot to simulate logout immediately after write
  const origWrite = tab.sj.writeRecoverySnapshot
  let createdSnapshotKey = null
  tab.sj.writeRecoverySnapshot = async (k, r, s) => {
    createdSnapshotKey = k
    await origWrite(k, r, s)
    // Simulate logout during linking after snapshot persisted
    h.signIn(storage, null)
  }

  await assert.rejects(
    () => tab.owner.confirmLibraryOwner('user-link-abort', storage),
    /changed/i,
    'Aborted linking throws on session change'
  )

  // Verify owner was NEVER bound and authority was invalidated
  assert.equal(storage.getItem(OWNER_KEY), null, 'Aborted linking never bound owner')

  // Transaction authority is invalidated on failure/logout
  await assert.rejects(
    () => tab.sj.writeRecoverySnapshot('gtar_sync_recovery:owner-confirm:subsequent:test', JSON.stringify({}), storage),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'Subsequent snapshot write rejected because transaction was invalidated'
  )
})

test('CODEX_R3_R2_4: Async operation authority is not consumed at preflight', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.bindOwner(storage, 'user-a')
  h.signIn(storage, 'user-a')
  const tab = h.newTab()
  const lib = tab.sj.readPersistedLibrary(storage)

  // Begin async mutation and obtain operation context
  const ctx = tab.sj.beginAsyncMutation(storage)
  assert.ok(ctx.id, 'Context has unique id')

  // Preflight check: assertLibraryMutationAllowed called before async awaits
  assert.doesNotThrow(
    () => tab.sj.assertLibraryMutationAllowed(storage, ctx),
    'Preflight check passes'
  )

  // Simulated async work
  await new Promise(resolve => setTimeout(resolve, 10))

  // Final commit: carries ctx through awaits and succeeds
  const updatedLib = {
    ...lib,
    songs: lib.songs.map((s, i) => i === 0 ? { ...s, title: 'Preflight Safe Edit' } : s),
  }
  assert.doesNotThrow(
    () => tab.sj.persistLibrary(updatedLib, storage, { context: ctx }),
    'Final commit succeeds carrying context without preflight consumption'
  )
  assert.equal(tab.sj.readPersistedLibrary(storage).songs[0].title, 'Preflight Safe Edit')
})

test('CODEX_R3_R2_5: Concurrent operations are isolated and cannot borrow or consume another operation context', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.bindOwner(storage, 'user-a')
  h.signIn(storage, 'user-a')
  const tab = h.newTab()
  const lib = tab.sj.readPersistedLibrary(storage)

  // Start two concurrent operations
  const ctx1 = tab.sj.beginAsyncMutation(storage)
  const ctx2 = tab.sj.beginAsyncMutation(storage)
  assert.notEqual(ctx1.id, ctx2.id, 'Context IDs are unique')

  // Op 2 commits successfully
  const edit2 = { ...lib, songs: lib.songs.map((s, i) => i === 1 ? { ...s, title: 'Op 2 Commit' } : s) }
  assert.doesNotThrow(() => tab.sj.persistLibrary(edit2, storage, { context: ctx2 }))

  // Token rotates during Op 1's pause
  storage.setItem('gtar_auth_session', JSON.stringify({
    user: { id: 'user-a', email: 'user-a@example.test' },
    sessionToken: 'token-rotated-concurrent-test',
  }))

  // Op 1 resumes with its isolated ctx1: MUST FAIL CLOSED
  const edit1 = { ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, title: 'Op 1 Commit' } : s) }
  assert.throws(
    () => tab.sj.persistLibrary(edit1, storage, { context: ctx1 }),
    err => err.name === 'StaleSyncRoundError' && err.reason === 'session-changed',
    'Op 1 fails closed on token rotation; context was not corrupted or borrowed by Op 2'
  )

  // Verify multiple active operations reject ambiguous omitted context
  h.signIn(storage, 'user-a')
  const opA = tab.sj.beginAsyncMutation(storage)
  const opB = tab.sj.beginAsyncMutation(storage)
  assert.throws(
    () => tab.sj.persistLibrary(lib, storage), // omitted context while multiple in flight
    err => err.name === 'StaleSyncRoundError' && err.reason === 'session-changed',
    'Multiple active operations reject omitted context'
  )
})

test('CODEX_R3_R2_6: Omitted-context async writes fail closed on logout/rotation with no partial writes', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.bindOwner(storage, 'user-a')
  h.signIn(storage, 'user-a')
  const tab = h.newTab()
  const initialV1 = storage.getItem(V1)
  const lib = tab.sj.readPersistedLibrary(storage)

  // Op starts while signed in
  tab.sj.beginAsyncMutation(storage)

  // User logs out during operation
  h.signIn(storage, null)

  // Attempt write with omitted context
  const mutated = { ...lib, songs: lib.songs.slice(1) }
  assert.throws(
    () => tab.sj.persistLibrary(mutated, storage),
    err => err.name === 'StaleSyncRoundError' && err.reason === 'signed-out',
    'Omitted-context write fails closed after logout'
  )

  // Verify storage was untouched: NO partial writes
  assert.equal(storage.getItem(V1), initialV1, 'Storage payload completely unchanged on blocked omitted-context write')
  h.signIn(storage, 'user-a')
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 3, 'All songs preserved')
})

test('CODEX_R3_R3_7: Exported recordOnboardingCreator cannot reassign provenance A→B', async () => {
  const storage = h.freshStorage()
  h.signIn(storage, 'user-a')
  const tab = h.newTab()

  // User A creates first song in empty library -> establishes provenance for user-a
  const songA = { id: 'sa-1', title: 'Song User A', artist: '', rawContent: '[C]A' }
  tab.sj.persistLibrary({ songs: [songA], setlists: [] }, storage)
  const provA = tab.sj.readOnboardingCreator(storage)
  assert.ok(provA)
  assert.equal(provA.userId, 'user-a')
  const bytesBefore = storage.getItem(V1)

  // User B signs in
  h.signIn(storage, 'user-b')

  // User B attempts to reassign provenance via recordOnboardingCreator
  assert.throws(
    () => tab.sj.recordOnboardingCreator(storage, 'user-b'),
    err => err.name === 'LibraryOwnershipError',
    'recordOnboardingCreator refuses reassignment A -> B'
  )

  // Provenance remains User A
  const provAfter = tab.sj.readOnboardingCreator(storage)
  assert.equal(provAfter.userId, 'user-a', 'Creator provenance remains user-a')
  assert.equal(storage.getItem(V1), bytesBefore, 'Library bytes completely unchanged')
  assert.equal(storage.getItem(OWNER_KEY), null, 'Owner key unchanged')
})

test('CODEX_R3_R3_8: Stale-revision refresh via onboarding helper is rejected', async () => {
  const storage = h.freshStorage()
  h.signIn(storage, 'user-a')
  const tab = h.newTab()

  // User A creates first song
  const song1 = { id: 's1', title: 'Song 1', artist: '', rawContent: '[C]' }
  tab.sj.persistLibrary({ songs: [song1], setlists: [] }, storage)
  const initialProv = tab.sj.readOnboardingCreator(storage)
  const initialRev = initialProv.headRevision

  // Library is modified offline (headRevision in storage changes)
  h.signIn(storage, null)
  const song2 = { id: 's2', title: 'Song 2', artist: '', rawContent: '[D]' }
  tab.sj.persistLibrary({ songs: [song1, song2], setlists: [] }, storage)
  const newRev = tab.sj.libraryRevision(storage)
  assert.notEqual(newRev, initialRev, 'Revision changed')

  // Put back user-a provenance with old revision
  storage.setItem('gtar_unbound_onboarding_v1', JSON.stringify(initialProv))

  // User A signs in and attempts to refresh stale revision via helper
  h.signIn(storage, 'user-a')
  assert.throws(
    () => tab.sj.recordOnboardingCreator(storage, 'user-a'),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'recordOnboardingCreator refuses stale-revision refresh'
  )
})

test('CODEX_R3_R3_9: Unauthorized deletion via onboarding provenance bypass fails closed', async () => {
  const storage = h.freshStorage()
  h.signIn(storage, 'user-a')
  const tab = h.newTab()

  // User A creates onboarding library with 3 songs
  const songs = [
    { id: 's1', title: 'Song 1', artist: '', rawContent: '[C]' },
    { id: 's2', title: 'Song 2', artist: '', rawContent: '[D]' },
    { id: 's3', title: 'Song 3', artist: '', rawContent: '[E]' },
  ]
  tab.sj.persistLibrary({ songs, setlists: [] }, storage)
  const initialV1 = storage.getItem(V1)

  // Account B signs in
  h.signIn(storage, 'user-b')

  // Account B attempts to delete songs
  assert.throws(
    () => tab.sj.persistLibrary({ songs: [songs[0]], setlists: [] }, storage),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'Account B deletion fails closed'
  )

  // Verify library bytes and song count completely intact
  assert.equal(storage.getItem(V1), initialV1, 'Library bytes unchanged after blocked deletion')
  assert.equal(storage.getItem(OWNER_KEY), null, 'Owner metadata unchanged')
  h.signIn(storage, 'user-a')
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 3, 'All 3 songs intact')
})

test('CODEX_R4_R1_1: Pause confirmLibraryOwner inside navigator.storage.estimate -> logout -> resume -> archive write rejects immediately before persistence with zero archives written', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.signIn(storage, 'user-race-test')
  const tab = h.newTab()

  // Intercept navigator.storage.estimate to simulate logout during pause
  let estimatePaused = false
  const priorNav = Object.getOwnPropertyDescriptor(global, 'navigator')
  const baseNav = typeof navigator !== 'undefined' ? navigator : {}
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      ...baseNav,
      storage: {
        estimate: async () => {
          estimatePaused = true
          // Simulate user logging out while estimate was running
          h.signIn(storage, null)
          return { usage: 100, quota: 1000000 }
        },
      },
    },
  })

  try {
    await assert.rejects(
      () => tab.owner.confirmLibraryOwner('user-race-test', storage),
      err => /changed/i.test(err.message) || (err.name === 'LibraryOwnershipError' && err.ownership === 'unbound'),
      'Linking fails closed when logout occurs during estimate await'
    )
    assert.ok(estimatePaused, 'navigator.storage.estimate was reached')

    // Crucial invariant: zero archives written to storage on rejection
    const archives = [...storage.map.keys()].filter(k => k.startsWith('gtar_sync_recovery:owner-confirm:'))
    assert.equal(archives.length, 0, 'Zero recovery archives written on rejected linking')
    assert.equal(storage.getItem(OWNER_KEY), null, 'Owner key was not written')
  } finally {
    if (priorNav) Object.defineProperty(global, 'navigator', priorNav)
    else delete global.navigator
  }
})

test('CODEX_R4_R1_2: 24-hour-old authority and library revision changes reject recovery mutation immediately before write', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.signIn(storage, 'user-stale-link')
  const tab = h.newTab()

  // Case A: 24-hour-old authority
  const txStale = tab.sj.beginLinkingTransaction(storage, 'user-stale-link')
  // Fast-forward time past 24 hours (86,400,000 ms)
  const origNow = Date.now
  try {
    Date.now = () => origNow() + 86400000
    await assert.rejects(
      () => tab.sj.writeRecoverySnapshot(txStale.key, txStale.raw, storage),
      err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound' && /expired/i.test(err.message),
      '24-hour-old linking authority is expired and rejects snapshot write'
    )
    assert.equal(storage.getItem(txStale.key), null, 'Zero archives written with expired authority')
  } finally {
    Date.now = origNow
  }

  // Case B: Change library revision after authorization
  const txRev = tab.sj.beginLinkingTransaction(storage, 'user-stale-link')
  // Mutate library revision in storage after authorization was granted
  const currentLib = tab.sj.readPersistedLibrary(storage)
  storage.setItem(V1, JSON.stringify({ ...currentLib, songs: currentLib.songs.slice(1) }))
  await assert.rejects(
    () => tab.sj.writeRecoverySnapshot(txRev.key, txRev.raw, storage),
    err => /changed/i.test(err.message),
    'Snapshot write rejects if library revision changed after authorization'
  )
  assert.equal(storage.getItem(txRev.key), null, 'Zero archives written after library revision change')
})

test('CODEX_R4_R2_1: beginAsyncMutation -> unrelated omitted-context save -> token rotation -> stale omitted-context save fails closed', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.bindOwner(storage, 'user-a')
  h.signIn(storage, 'user-a')
  const tab = h.newTab()
  const lib = tab.sj.readPersistedLibrary(storage)

  // 1. Begin async mutation
  tab.sj.beginAsyncMutation(storage)

  // 2. Unrelated omitted-context save succeeds under current valid session
  const unrelatedEdit = { ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, title: 'Unrelated Sync Edit' } : s) }
  assert.doesNotThrow(
    () => tab.sj.persistLibrary(unrelatedEdit, storage),
    'Unrelated sync save succeeds without consuming async authority'
  )
  assert.equal(tab.sj.readPersistedLibrary(storage).songs[0].title, 'Unrelated Sync Edit')

  // 3. Token rotation occurs
  storage.setItem('gtar_auth_session', JSON.stringify({
    user: { id: 'user-a', email: 'user-a@example.test' },
    sessionToken: 'token-rotated-r4-test',
  }))

  // 4. Stale omitted-context save MUST FAIL CLOSED
  const staleEdit = { ...lib, songs: lib.songs.map((s, i) => i === 1 ? { ...s, title: 'Stale Async Edit' } : s) }
  assert.throws(
    () => tab.sj.persistLibrary(staleEdit, storage),
    err => err.name === 'StaleSyncRoundError' && err.reason === 'session-changed',
    'Stale omitted-context save fails closed after token rotation'
  )
  assert.notEqual(tab.sj.readPersistedLibrary(storage).songs[1].title, 'Stale Async Edit', 'Stale edit was NOT written')
})

test('CODEX_R4_R2_2: First stale attempt rejects and retains context -> retry without context fails closed', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.bindOwner(storage, 'user-a')
  h.signIn(storage, 'user-a')
  const tab = h.newTab()
  const lib = tab.sj.readPersistedLibrary(storage)

  tab.sj.beginAsyncMutation(storage)

  // Token rotates
  storage.setItem('gtar_auth_session', JSON.stringify({
    user: { id: 'user-a', email: 'user-a@example.test' },
    sessionToken: 'token-rotated-retry-test',
  }))

  const staleEdit = { ...lib, songs: lib.songs.map((s, i) => i === 2 ? { ...s, title: 'Attempt 1' } : s) }

  // Attempt 1 rejects
  assert.throws(
    () => tab.sj.persistLibrary(staleEdit, storage),
    err => err.name === 'StaleSyncRoundError' && err.reason === 'session-changed',
    'First stale attempt rejects'
  )

  // Attempt 2 (retry without context): MUST STILL FAIL CLOSED
  const retryEdit = { ...lib, songs: lib.songs.map((s, i) => i === 2 ? { ...s, title: 'Attempt 2 Bypass' } : s) }
  assert.throws(
    () => tab.sj.persistLibrary(retryEdit, storage),
    err => err.name === 'StaleSyncRoundError' && err.reason === 'session-changed',
    'Retry without context fails closed; rejection did not purge context'
  )
  assert.notEqual(tab.sj.readPersistedLibrary(storage).songs[2].title, 'Attempt 2 Bypass')
})

test('CODEX_R4_R2_3: Caller-supplied fresh context fails closed and cannot bypass active stale operation', async () => {
  const { storage } = unboundDevice({ n: 3 })
  h.bindOwner(storage, 'user-a')
  h.signIn(storage, 'user-a')
  const tab = h.newTab()
  const lib = tab.sj.readPersistedLibrary(storage)

  // Op 1 begins
  const ctx1 = tab.sj.beginAsyncMutation(storage)

  // Token rotates
  storage.setItem('gtar_auth_session', JSON.stringify({
    user: { id: 'user-a', email: 'user-a@example.test' },
    sessionToken: 'token-rotated-fresh-bypass',
  }))

  // Caller manufactures fresh context matching current rotated token
  const forgedContext = {
    id: 'forged-fresh-id',
    userId: 'user-a',
    token: 'token-rotated-fresh-bypass',
    generation: 'user-a\u0000token-rotated-fresh-bypass',
  }

  // Caller attempts to supply fresh context to bypass stale Op 1
  const bypassEdit = { ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, title: 'Forged Bypass' } : s) }
  assert.throws(
    () => tab.sj.persistLibrary(bypassEdit, storage, { context: forgedContext }),
    err => err.name === 'StaleSyncRoundError',
    'Caller-supplied fresh context cannot bypass active stale operation'
  )
  assert.notEqual(tab.sj.readPersistedLibrary(storage).songs[0].title, 'Forged Bypass')

  // Clean up Op 1 explicitly via operation-specific cleanup
  tab.sj.endAsyncMutation(ctx1, storage)
})

test('CODEX_R4_R3_1: Account A creates library -> saves empty -> repopulates -> next legitimate save succeeds without LibraryOwnershipError', async () => {
  const storage = h.freshStorage()
  h.signIn(storage, 'user-a')
  const tab = h.newTab()

  // 1. Account A creates library with 1 song
  const s1 = { id: 's1', title: 'Song 1', artist: 'Artist A', rawContent: '[C]Song 1' }
  tab.sj.persistLibrary({ songs: [s1], setlists: [] }, storage)
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 1)
  const prov1 = tab.sj.readOnboardingCreator(storage)
  assert.ok(prov1, 'Provenance recorded on initial population')
  assert.equal(prov1.userId, 'user-a')

  // 2. Account A saves empty (deletes songs)
  tab.sj.persistLibrary({ songs: [], setlists: [] }, storage)
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 0)
  const prov2 = tab.sj.readOnboardingCreator(storage)
  assert.ok(prov2, 'Provenance maintained on empty save')
  assert.equal(prov2.userId, 'user-a')

  // 3. Account A repopulates library
  const s2 = { id: 's2', title: 'Song 2', artist: 'Artist A', rawContent: '[D]Song 2' }
  assert.doesNotThrow(
    () => tab.sj.persistLibrary({ songs: [s2], setlists: [] }, storage),
    'Repopulation after empty save succeeds'
  )
  const prov3 = tab.sj.readOnboardingCreator(storage)
  assert.ok(prov3, 'Provenance advanced on repopulation')
  assert.equal(prov3.userId, 'user-a')

  // 4. Next legitimate save: MUST SUCCEED without LibraryOwnershipError
  const s3 = { id: 's3', title: 'Song 3', artist: 'Artist A', rawContent: '[E]Song 3' }
  assert.doesNotThrow(
    () => tab.sj.persistLibrary({ songs: [s2, s3], setlists: [] }, storage),
    'Next legitimate save after repopulation succeeds without LibraryOwnershipError'
  )
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 2)
  assert.equal(storage.getItem(OWNER_KEY), null, 'Zero implicit ownership binding')
})

test('CODEX_R4_R3_2: Onboarding creator provenance protects against Account B takeover across empty/populated transitions', async () => {
  const storage = h.freshStorage()
  h.signIn(storage, 'user-a')
  const tab = h.newTab()

  // User A creates empty library and populates it
  const s1 = { id: 's1', title: 'User A Song', artist: '', rawContent: '[C]' }
  tab.sj.persistLibrary({ songs: [s1], setlists: [] }, storage)
  // User A saves empty
  tab.sj.persistLibrary({ songs: [], setlists: [] }, storage)
  // User A repopulates
  const s2 = { id: 's2', title: 'User A Repopulated', artist: '', rawContent: '[G]' }
  tab.sj.persistLibrary({ songs: [s2], setlists: [] }, storage)

  // Account B signs in
  h.signIn(storage, 'user-b')

  // Account B attempts to edit or delete User A repopulated library
  assert.throws(
    () => tab.sj.persistLibrary({ songs: [{ id: 'b1', title: 'User B Takeover', artist: '', rawContent: '[A]' }], setlists: [] }, storage),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'Account B cannot edit User A repopulated library'
  )

  // Account B cannot reassign onboarding creator
  assert.throws(
    () => tab.sj.recordOnboardingCreator(storage, 'user-b'),
    err => err.name === 'LibraryOwnershipError',
    'Account B cannot reassign onboarding creator'
  )

  // Switch back to Account A: legitimate edits preserved
  h.signIn(storage, 'user-a')
  assert.doesNotThrow(
    () => tab.sj.persistLibrary({ songs: [s2, { id: 's3', title: 'User A 3', artist: '', rawContent: '[F]' }], setlists: [] }, storage),
    'Account A can continue editing legitimate library'
  )
})
