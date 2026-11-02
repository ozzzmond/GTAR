// #258 legacy account isolation, as amended by D1: the device library stays open for every
// sign-in. Synthetic fixtures only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/tabHarness.cjs')
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
  void factory
  let songs = null
  try { songs = tab.sj.readPersistedLibrary(storage)?.songs ?? [] } catch { songs = null }
  const exported = JSON.stringify(tab.sj.recoveryExportData(storage))
  return { tab, songs, exported, blocked: false }
}
const deviceContentVisible = v => {
  assert.equal(v.songs.length, 10, 'device songs shown')
  assert.equal(A_TITLE.test(v.exported), true, 'device library exportable')
}
const snapshot = storage => new Map([...storage.map.entries()].filter(([k]) => !k.startsWith('gtar_auth_session')))

test('B2 never enabled: A → B → A on one device; both accounts keep full access and can save', async () => {
  const { storage, factory } = device()
  const before = storage.getItem(V1)
  h.signIn(storage, 'user-b')
  const b = await view(storage, factory)
  deviceContentVisible(b)
  assert.equal(storage.getItem(V1), before)
  h.signIn(storage, 'user-a')
  const a = await view(storage, factory)
  assert.equal(a.songs.length, 10)
  const lib = a.tab.sj.readPersistedLibrary(storage)
  a.tab.sj.persistLibrary({ ...lib, songs: lib.songs.map((s, i) => i === 1 ? { ...s, title: 'A saved again' } : s) }, storage, { expectedRaw: a.tab.sj.libraryRevision(storage) })
  assert.equal(JSON.parse(storage.getItem(V1)).songs[1].title, 'A saved again')
})

/** App startup in this storage: closed state shown, no A titles, no export offered, nothing changed. */
async function appStartupIsOpen(storage) {
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
    assert.equal(document.querySelector('[data-testid="library-partition-blocked"]'), null, 'no sign-in gate')
    assert.equal(A_TITLE.test(document.body.textContent), true, 'device titles rendered')
    assert.ok(document.querySelector('main'), 'songbook rendered')
  } finally { await act(async () => root.unmount()) }
  for (const key of [V1, 'gtar_library_owner_v1', 'gtar_sync_library_owner']) assert.equal(storage.getItem(key), before.get(key) ?? null, key)
}

test('sign-out and reload: the app keeps the device library visible', async () => {
  const { storage, factory } = device()
  const before = snapshot(storage)
  h.signIn(storage, null)
  for (let reload = 0; reload < 2; reload++) await appStartupIsOpen(storage)
  for (const key of [V1, 'gtar_library_owner_v1']) assert.equal(storage.getItem(key), before.get(key))
  h.signIn(storage, 'user-a')
  assert.equal((await view(storage, factory)).songs.length, 10)
})

for (const [label, owner] of [['unreadable owner record', '{broken'], ['owner record for another environment', JSON.stringify({ v: 1, userId: 'user-a', env: 'other.host', boundAt: 1, reason: 'confirmed' })]]) {
  test(`unknown owner (${label}), B2 off: readable for every sign-in, library and owner unchanged`, async () => {
    const { storage, factory } = device()
    storage.setItem('gtar_library_owner_v1', owner)
    const before = snapshot(storage)
    for (const who of ['user-a', 'user-b']) { h.signIn(storage, who); deviceContentVisible(await view(storage, factory)) }
    h.signIn(storage, null)
    await appStartupIsOpen(storage)
    for (const key of [V1, 'gtar_library_owner_v1']) assert.equal(storage.getItem(key), before.get(key))
  })
}

test('library never linked to an account (no owner record) stays usable on this device, as before', async () => {
  const { storage, factory } = device({ owner: null })
  h.signIn(storage, 'user-c')
  const v = await view(storage, factory)
  assert.equal(v.blocked, false)
  assert.equal(v.songs.length, 10)
})

test('app startup as B on A\'s device (B2 off) shows device library titles without a sign-in gate', async () => {
  const { storage } = device()
  h.signIn(storage, 'user-b')
  await appStartupIsOpen(storage)
})
