const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/b2Harness.cjs')

test('PR-A 1: fresh signed-out device can save, edit and reload a song', () => {
  const storage = h.freshStorage()
  const tab = h.newTab()
  tab.sj.persistLibrary(h.library(1, 0), storage)
  const lib = tab.sj.readPersistedLibrary(storage)
  lib.songs[0].title = 'Device edit'
  tab.sj.persistLibrary(lib, storage)
  assert.equal(h.newTab().sj.readPersistedLibrary(storage).songs[0].title, 'Device edit')
})

test('PR-A 2: signed-out owner library reads without changing library or owner bytes', () => {
  const storage = h.freshStorage()
  const tab = h.newTab()
  tab.sj.persistLibrary(h.library(3, 1), storage)
  h.bindOwner(storage, 'user-a')
  storage.setItem('gtar_sync_library_owner', 'owner-sync-bytes')
  const keys = ['gtar_library_v1', 'gtar_library_owner_v1', 'gtar_sync_library_owner']
  const before = keys.map(k => storage.getItem(k))
  assert.equal(h.newTab().sj.readPersistedLibrary(storage).songs.length, 3)
  assert.deepEqual(keys.map(k => storage.getItem(k)), before)
})

test('PR-A 3: account B sign-in and sign-out do not change the device library or upload', () => {
  const storage = h.freshStorage()
  const tab = h.newTab()
  tab.sj.persistLibrary(h.library(3, 1), storage)
  h.bindOwner(storage, 'user-a')
  const before = storage.getItem('gtar_library_v1')
  const fetchBefore = global.fetch
  let uploads = 0
  global.fetch = () => { uploads++; throw new Error('Unexpected upload') }
  try {
    h.signIn(storage, 'user-b')
    assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 3)
    h.signIn(storage, null)
    assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 3)
    assert.equal(storage.getItem('gtar_library_v1'), before)
    assert.equal(uploads, 0)
  } finally { global.fetch = fetchBefore }
})

test('PR-A 4: one B2 partition opens signed out and stays open across account changes', async () => {
  const storage = h.freshStorage(), factory = new h.Factory(), tab = h.newTab()
  h.bindOwner(storage, 'user-a'); h.signIn(storage, 'user-a')
  tab.sj.persistLibrary(h.library(3, 1), storage)
  tab.sj.enableLibraryB2(storage)
  await tab.sj.prepareLibraryB2(storage, { factory })
  await tab.b2.flushB2()
  h.signIn(storage, null)
  const next = h.newTab()
  assert.equal((await next.sj.prepareLibraryB2(storage, { factory })).active, true)
  h.signIn(storage, 'user-b')
  assert.equal(next.sj.readPersistedLibrary(storage).songs.length, 3)
})

test('PR-A 4 recovery: most recently used of two B2 partitions opens; both remain exportable', async () => {
  const storage = h.freshStorage(), factory = new h.Factory()
  let tab = h.newTab()
  tab.sj.persistLibrary(h.library(2, 0), storage)
  tab.sj.enableLibraryB2(storage)
  await tab.sj.prepareLibraryB2(storage, { factory })
  await tab.b2.flushB2()
  // Model a second partition retained by the previous per-account version.
  const secondScope = await tab.b2.partitionScope('account', 'user-b', h.HOST)
  // Seed through the original migration seam by temporarily selecting an owner on a fresh device.
  const secondStorage = h.freshStorage()
  h.bindOwner(secondStorage, 'user-b')
  tab = h.newTab()
  tab.sj.persistLibrary(h.library(4, 0), secondStorage)
  tab.sj.enableLibraryB2(secondStorage)
  await tab.sj.prepareLibraryB2(secondStorage, { factory })
  await tab.b2.flushB2()
  storage.setItem(tab.b2.b2HeadKey(secondScope), secondStorage.getItem(tab.b2.b2HeadKey(secondScope)))
  storage.setItem('gtar_library_b2_last_used::' + secondScope, '9999999999999')
  global.localStorage = storage
  tab = h.newTab()
  await tab.sj.prepareLibraryB2(storage, { factory })
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 4)
  assert.equal((await tab.b2.exportB2Partition('device', storage, factory)).songs.length, 2)
  assert.equal((await tab.b2.exportB2Partition(secondScope, storage, factory)).songs.length, 4)
})
