// #258 legacy fallback account isolation: with B2 off (or unavailable), the origin-wide earlier
// library opens only for its verified owner. Synthetic fixtures only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/b2Harness.cjs')
const { installNavigatorLocks } = require('./helpers/fakeLocks.cjs')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

installNavigatorLocks()
const V1 = 'gtar_library_v1'
const A_TITLE = /Synthetic Song|A private/

/** Earlier library owned by `owner`, built while `owner` is signed in. */
function device({ owner = 'user-a', n = 10 } = {}) {
  const storage = h.freshStorage()
  const factory = new h.Factory()
  const tab = h.newTab()
  if (owner) { h.bindOwner(storage, owner); h.signIn(storage, owner) }
  tab.sj.persistLibrary(h.library(n, 2), storage)
  return { storage, factory }
}
/** What a fresh page shows under the current sign-in: its songs, or null when the library is closed. */
async function view(storage, factory) {
  const tab = h.newTab()
  await tab.sj.prepareLibraryB2(storage, { factory })
  let songs = null
  try { songs = tab.sj.readPersistedLibrary(storage)?.songs ?? [] } catch { songs = null }
  const exported = JSON.stringify(tab.sj.recoveryExportData(storage))
  return { tab, songs, exported, blocked: tab.sj.isLegacyLibraryBlocked(storage) }
}
const noAccountAContent = v => {
  assert.ok(v.songs === null || !v.songs.some(s => A_TITLE.test(s.title)), 'no A songs shown')
  assert.equal(A_TITLE.test(v.exported), false, 'no A content in exports')
}
const snapshot = storage => new Map([...storage.map.entries()].filter(([k]) => !k.startsWith('gtar_auth_session')))

test('A turns B2 off, then B signs in: B sees and changes nothing of A; A reopens everything, B2-era edit included', async () => {
  const { storage, factory } = device()
  const setup = h.newTab()
  setup.sj.enableLibraryB2(storage)
  const a = await view(storage, factory)
  a.tab.sj.persistLibrary({ ...a.tab.sj.readPersistedLibrary(storage), songs: a.tab.sj.readPersistedLibrary(storage).songs.map((s, i) => i === 0 ? { ...s, title: 'A private edit' } : s) }, storage, { expectedRaw: a.tab.sj.libraryRevision(storage) })
  await a.tab.sj.disableLibraryB2(storage)
  const before = snapshot(storage)
  h.signIn(storage, 'user-b')
  const b = await view(storage, factory)
  noAccountAContent(b)
  assert.equal(b.blocked, true)
  assert.throws(() => b.tab.sj.persistLibrary({ songs: [], setlists: [] }, storage))
  assert.deepEqual(snapshot(storage), before, 'nothing on the device changed')
  h.signIn(storage, 'user-a')
  const back = await view(storage, factory)
  assert.equal(back.blocked, false)
  assert.equal(back.songs.length, 10)
  assert.equal(back.songs[0].title, 'A private edit')
})

test('B2 never enabled: A → B → A on one device; B is closed out, A keeps full access and can save', async () => {
  const { storage, factory } = device()
  const before = storage.getItem(V1)
  h.signIn(storage, 'user-b')
  const b = await view(storage, factory)
  noAccountAContent(b)
  assert.equal(storage.getItem(V1), before)
  h.signIn(storage, 'user-a')
  const a = await view(storage, factory)
  assert.equal(a.songs.length, 10)
  const lib = a.tab.sj.readPersistedLibrary(storage)
  a.tab.sj.persistLibrary({ ...lib, songs: lib.songs.map((s, i) => i === 1 ? { ...s, title: 'A saved again' } : s) }, storage, { expectedRaw: a.tab.sj.libraryRevision(storage) })
  assert.equal(JSON.parse(storage.getItem(V1)).songs[1].title, 'A saved again')
})

/** App startup in this storage: closed state shown, no A titles, no export offered, nothing changed. */
async function appStartupIsClosed(storage) {
  for (const key of Object.keys(require.cache)) if (key.includes('/src/')) delete require.cache[key]
  global.IS_REACT_ACT_ENVIRONMENT = true
  global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }))
  global.matchMedia = global.window.matchMedia
  document.body.innerHTML = '<div id="root"></div>'
  const before = snapshot(storage)
  const App = require('../src/App.tsx').default
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(App)))
    assert.ok(document.querySelector('[data-testid="library-partition-blocked"]'), 'closed state shown')
    assert.equal(A_TITLE.test(document.body.textContent), false, 'no A titles rendered')
    assert.equal([...document.querySelectorAll('button')].some(b => /export/i.test(b.textContent)), false, 'no export of A data offered')
  } finally { await act(async () => root.unmount()) }
  assert.deepEqual(snapshot(storage), before, 'startup changed nothing')
}

test('sign-out and reload: the app shows nothing of the owned library until its owner signs in again', async () => {
  const { storage, factory } = device()
  const before = snapshot(storage)
  h.signIn(storage, null)
  for (let reload = 0; reload < 2; reload++) await appStartupIsClosed(storage)
  assert.deepEqual(snapshot(storage), before)
  h.signIn(storage, 'user-a')
  assert.equal((await view(storage, factory)).songs.length, 10)
})

for (const [label, owner] of [['unreadable owner record', '{broken'], ['owner record for another environment', JSON.stringify({ v: 1, userId: 'user-a', env: 'other.host', boundAt: 1, reason: 'confirmed' })]]) {
  test(`unknown owner (${label}), B2 off: closed for every sign-in, nothing changed`, async () => {
    const { storage, factory } = device()
    storage.setItem('gtar_library_owner_v1', owner)
    const before = snapshot(storage)
    for (const who of ['user-a', 'user-b']) { h.signIn(storage, who); noAccountAContent(await view(storage, factory)) }
    h.signIn(storage, null)
    await appStartupIsClosed(storage)
    assert.deepEqual(snapshot(storage), before)
  })
}

test('B2 on but IndexedDB unavailable, B signed in: closed, nothing changed', async () => {
  const { storage, factory } = device()
  h.newTab().sj.enableLibraryB2(storage)
  h.signIn(storage, 'user-b')
  factory.faults.open = () => new Error('IndexedDB unavailable')
  const before = storage.getItem(V1)
  noAccountAContent(await view(storage, factory))
  assert.equal(storage.getItem(V1), before)
})

test('failed turn-off (sign-in changed): B2 stays on, B gets its own empty partition, A data intact in both stores', async () => {
  const { storage, factory } = device()
  h.newTab().sj.enableLibraryB2(storage)
  const a = await view(storage, factory)
  h.signIn(storage, 'user-b')
  await assert.rejects(a.tab.sj.disableLibraryB2(storage))
  const b = await view(storage, factory)
  assert.deepEqual(b.songs, [])
  noAccountAContent(b)
  h.signIn(storage, 'user-a')
  assert.equal((await view(storage, factory)).songs.length, 10)
  assert.equal(JSON.parse(storage.getItem(V1)).songs.length, 10)
})

test('library never linked to an account (no owner record) stays usable on this device, as before', async () => {
  const { storage, factory } = device({ owner: null })
  h.signIn(storage, 'user-c')
  const v = await view(storage, factory)
  assert.equal(v.blocked, false)
  assert.equal(v.songs.length, 10)
})

test('app startup as B on A\'s device (B2 off) shows the closed state, no A titles, and no export of A data', async () => {
  const { storage } = device()
  h.signIn(storage, 'user-b')
  await appStartupIsClosed(storage)
})
