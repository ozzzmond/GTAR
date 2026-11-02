const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/tabHarness.cjs')

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
