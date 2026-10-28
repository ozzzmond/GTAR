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

  // Case 4: Legitimate signed-out editing initiated while signed out: PRESERVED
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
  tab.sj.persistLibrary({ songs: [], setlists: [] }, storage)
  storage.removeItem(OWNER_KEY)

  assert.equal(tab.sj.isUnboundDeviceLibraryReadOnly(storage), false, 'Empty library initially not read-only')
  assert.equal(storage.getItem(OWNER_KEY), null, 'Owner record absent before first save')

  // Save 1: First song save succeeds
  const song1 = { id: 'song-1', title: 'Onboarding Song 1', artist: '', rawContent: '[C]Song 1' }
  tab.sj.persistLibrary({ songs: [song1], setlists: [] }, storage)
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 1)
  assert.equal(storage.getItem(OWNER_KEY), null, 'Owner record remains absent after first save (no silent binding)')

  // Save 2: Second song save succeeds (crucial REPRO requirement: second save was previously rejected)
  const song2 = { id: 'song-2', title: 'Onboarding Song 2', artist: '', rawContent: '[D]Song 2' }
  assert.doesNotThrow(
    () => tab.sj.persistLibrary({ songs: [song1, song2], setlists: [] }, storage),
    'Second save succeeds in legitimate onboarding flow'
  )
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 2)
  assert.equal(storage.getItem(OWNER_KEY), null, 'Owner record still absent after second save')

  // Save 3: Third edit succeeds
  const updatedSong1 = { ...song1, title: 'Onboarding Song 1 Edited' }
  assert.doesNotThrow(
    () => tab.sj.persistLibrary({ songs: [updatedSong1, song2], setlists: [] }, storage),
    'Third edit succeeds in legitimate onboarding flow'
  )
  assert.equal(tab.sj.readPersistedLibrary(storage).songs[0].title, 'Onboarding Song 1 Edited')
  assert.equal(storage.getItem(OWNER_KEY), null, 'Owner record still null (still unbound)')

  // Protection proof: Account B signs in and cannot mutate Account Onboard's unlinked library
  h.signIn(storage, 'user-intruder')
  const tabB = h.newTab()
  assert.equal(tabB.sj.isUnboundDeviceLibraryReadOnly(storage), true, 'User intruder sees library as read-only')
  assert.throws(
    () => tabB.sj.persistLibrary({ songs: [], setlists: [] }, storage),
    err => err.name === 'LibraryOwnershipError' && err.ownership === 'unbound',
    'Intruder cannot delete or mutate user-onboard\'s unlinked library'
  )

  // Pre-existing populated unbound library cannot be claimed via onboarding
  const { storage: prePopulated } = unboundDevice({ n: 3 })
  h.signIn(prePopulated, 'user-attacker')
  const tabAttacker = h.newTab()
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
