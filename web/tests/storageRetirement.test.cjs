const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText,
      filename
    )
}

const {
  retireDriveSyncState,
  performStorageHousekeeping,
  persistLibrary,
  readPersistedLibrary,
  SYNC_RETIRED_KEY,
  LIBRARY_KEY,
} = require('../src/utils/syncJournal.ts')

function createMockStorage() {
  const store = new Map()
  return {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size },
    store,
  }
}

const sampleLibrary = {
  songs: [
    { id: 's1', title: 'Song One', rawContent: '[C]Hello [G]world', isDeleted: false },
    { id: 's2', title: 'Song Two', rawContent: '[Am]Another [F]tune', isDeleted: false },
  ],
  setlists: [
    { id: 'set-1', name: 'Gig 1', songIds: ['s1', 's2'] },
  ],
}

test('1. DEV.12 storage upgrade -> retirement (two-step migration)', () => {
  const storage = createMockStorage()

  // Setup DEV.12 state: No canonical gtar_library_v1; only legacy stores + obsolete Drive keys
  storage.setItem('gtar_songs_store', JSON.stringify(sampleLibrary.songs))
  storage.setItem('gtar_trash_songs_store', '[]')
  storage.setItem('gtar_setlists_store', JSON.stringify(sampleLibrary.setlists))
  storage.setItem('gtar_sync_v1:dev12-user', JSON.stringify({ version: 1, baseline: sampleLibrary }))
  storage.setItem('gtar_sync_library_owner', 'dev12-user')
  storage.setItem('gtar_sync_recovery:dev12-user:1001', 'recovery-data')

  // Step 1: Initial startup housekeeping runs before library migration
  performStorageHousekeeping(storage)

  // Safety check: Canonical missing, so legacy stores and Drive keys MUST be preserved!
  assert.equal(storage.getItem(SYNC_RETIRED_KEY), null, 'Retirement marker must not be set when canonical is missing')
  assert.ok(storage.getItem('gtar_songs_store'), 'Legacy gtar_songs_store must NOT be deleted')
  assert.ok(storage.getItem('gtar_setlists_store'), 'Legacy gtar_setlists_store must NOT be deleted')

  // Step 2: App converts legacy stores into canonical library
  persistLibrary(sampleLibrary, storage)
  assert.ok(storage.getItem(LIBRARY_KEY), 'Canonical library successfully created')

  // Step 3: Post-ingestion housekeeping runs
  performStorageHousekeeping(storage)

  // Legacy stores must now be purged
  assert.equal(storage.getItem('gtar_songs_store'), null)
  assert.equal(storage.getItem('gtar_trash_songs_store'), null)
  assert.equal(storage.getItem('gtar_setlists_store'), null)

  // Drive sync machinery must be fully retired
  assert.equal(storage.getItem('gtar_sync_v1:dev12-user'), null)
  assert.equal(storage.getItem('gtar_sync_library_owner'), null)
  assert.equal(storage.getItem('gtar_sync_recovery:dev12-user:1001'), null)

  // Retirement marker must be written
  assert.equal(storage.getItem(SYNC_RETIRED_KEY), 'true')

  // Canonical library must be intact
  const canonical = readPersistedLibrary(storage)
  assert.deepEqual(canonical, sampleLibrary)
})

test('2. DEV.13 storage upgrade -> retirement (direct canonical upgrade)', () => {
  const storage = createMockStorage()

  // Setup DEV.13 state: Canonical gtar_library_v1 present alongside obsolete Drive keys & recovery snapshots
  storage.setItem(LIBRARY_KEY, JSON.stringify(sampleLibrary))
  storage.setItem('gtar_songs_store', JSON.stringify(sampleLibrary.songs))
  storage.setItem('gtar_trash_songs_store', '[]')
  storage.setItem('gtar_setlists_store', '[]')
  storage.setItem('gtar_sync_v1:dev13-account', JSON.stringify({ version: 1, baseline: sampleLibrary }))
  storage.setItem('gtar_sync_library_owner', 'dev13-account')
  storage.setItem('gtar_sync_recovery:dev13-account:2001', 'snap-1')
  storage.setItem('gtar_sync_recovery:dev13-account:2002', 'snap-2')
  storage.setItem('gtar_theme_mode', '"dark"')

  // Startup housekeeping runs
  performStorageHousekeeping(storage)

  // Obsolete Drive and legacy keys must be gone
  assert.equal(storage.getItem('gtar_songs_store'), null)
  assert.equal(storage.getItem('gtar_trash_songs_store'), null)
  assert.equal(storage.getItem('gtar_setlists_store'), null)
  assert.equal(storage.getItem('gtar_sync_v1:dev13-account'), null)
  assert.equal(storage.getItem('gtar_sync_library_owner'), null)
  assert.equal(storage.getItem('gtar_sync_recovery:dev13-account:2001'), null)
  assert.equal(storage.getItem('gtar_sync_recovery:dev13-account:2002'), null)

  // Marker set
  assert.equal(storage.getItem(SYNC_RETIRED_KEY), 'true')

  // Canonical data and user preferences preserved
  const canonical = readPersistedLibrary(storage)
  assert.deepEqual(canonical, sampleLibrary)
  assert.equal(storage.getItem('gtar_theme_mode'), '"dark"')
})

test('3. Valid canonical + obsolete Drive state (multi-account Drive cleanup)', () => {
  const storage = createMockStorage()

  storage.setItem(LIBRARY_KEY, JSON.stringify(sampleLibrary))
  storage.setItem('gtar_sync_v1:account-A', 'data-A')
  storage.setItem('gtar_sync_v1:account-B', 'data-B')
  storage.setItem('gtar_sync_library_owner', 'account-A')
  storage.setItem('gtar_sync_recovery:account-A:3001', 'recovery-A')
  storage.setItem('gtar_sync_recovery:account-B:3002', 'recovery-B')

  const retired = retireDriveSyncState(storage)
  assert.equal(retired, true)

  assert.equal(storage.getItem('gtar_sync_v1:account-A'), null)
  assert.equal(storage.getItem('gtar_sync_v1:account-B'), null)
  assert.equal(storage.getItem('gtar_sync_library_owner'), null)
  assert.equal(storage.getItem('gtar_sync_recovery:account-A:3001'), null)
  assert.equal(storage.getItem('gtar_sync_recovery:account-B:3002'), null)
  assert.equal(storage.getItem(SYNC_RETIRED_KEY), 'true')

  // Canonical library untouched
  assert.deepEqual(readPersistedLibrary(storage), sampleLibrary)
})

test('4. Invalid / missing canonical preserves legacy stores intact', () => {
  // Scenario A: Completely missing canonical
  {
    const storage = createMockStorage()
    storage.setItem('gtar_songs_store', JSON.stringify(sampleLibrary.songs))
    storage.setItem('gtar_sync_v1:test', 'journal')

    const result = retireDriveSyncState(storage)
    assert.equal(result, false, 'retireDriveSyncState must return false when canonical is missing')
    assert.equal(storage.getItem(SYNC_RETIRED_KEY), null, 'Marker must not be set')
    assert.ok(storage.getItem('gtar_songs_store'), 'gtar_songs_store must remain intact')
  }

  // Scenario B: Corrupted JSON in canonical
  {
    const storage = createMockStorage()
    storage.setItem(LIBRARY_KEY, '{invalid json!')
    storage.setItem('gtar_songs_store', JSON.stringify(sampleLibrary.songs))

    const result = retireDriveSyncState(storage)
    assert.equal(result, false, 'retireDriveSyncState must return false when canonical JSON is malformed')
    assert.equal(storage.getItem(SYNC_RETIRED_KEY), null)
    assert.ok(storage.getItem('gtar_songs_store'), 'Legacy songs must remain intact')
  }

  // Scenario C: Malformed schema (missing arrays)
  {
    const storage = createMockStorage()
    storage.setItem(LIBRARY_KEY, JSON.stringify({ songs: 'not-an-array' }))
    storage.setItem('gtar_songs_store', JSON.stringify(sampleLibrary.songs))

    const result = retireDriveSyncState(storage)
    assert.equal(result, false, 'retireDriveSyncState must return false when canonical schema is invalid')
    assert.equal(storage.getItem(SYNC_RETIRED_KEY), null)
    assert.ok(storage.getItem('gtar_songs_store'), 'Legacy songs must remain intact')
  }
})

test('5. Near/full quota resilience: deletes succeed even if marker write throws', () => {
  const baseStorage = createMockStorage()
  baseStorage.setItem(LIBRARY_KEY, JSON.stringify(sampleLibrary))
  baseStorage.setItem('gtar_sync_v1:quota-user', 'large-journal-data')
  baseStorage.setItem('gtar_sync_library_owner', 'quota-user')
  baseStorage.setItem('gtar_sync_recovery:quota-user:5001', 'snapshot')

  // Storage proxy that throws QuotaExceededError when setting SYNC_RETIRED_KEY
  const quotaStorage = {
    ...baseStorage,
    setItem: (k, v) => {
      if (k === SYNC_RETIRED_KEY) {
        const err = new Error('QuotaExceededError')
        err.name = 'QuotaExceededError'
        err.code = 22
        throw err
      }
      baseStorage.setItem(k, v)
    },
  }

  // retireDriveSyncState should gracefully handle the quota throw and not crash
  let threw = false
  let result = false
  try {
    result = retireDriveSyncState(quotaStorage)
  } catch {
    threw = true
  }

  assert.equal(threw, false, 'retireDriveSyncState must not throw on quota error setting marker')
  assert.equal(result, false, 'Should return false indicating marker could not be set')

  // CRITICAL: Cleanup deletes still occurred BEFORE marker attempt!
  assert.equal(baseStorage.getItem('gtar_sync_v1:quota-user'), null, 'Journal should be deleted to free quota')
  assert.equal(baseStorage.getItem('gtar_sync_library_owner'), null, 'Owner key should be deleted')
  assert.equal(baseStorage.getItem('gtar_sync_recovery:quota-user:5001'), null, 'Recovery snapshots should be deleted')

  // On next attempt when quota is restored, marker write succeeds
  const secondResult = retireDriveSyncState(baseStorage)
  assert.equal(secondResult, true)
  assert.equal(baseStorage.getItem(SYNC_RETIRED_KEY), 'true')
})

test('6. Interruption / partial previous run recovery', () => {
  const storage = createMockStorage()
  storage.setItem(LIBRARY_KEY, JSON.stringify(sampleLibrary))

  // Simulate an interrupted run: gtar_sync_v1 was deleted, but recovery snapshot remains and marker is missing
  storage.setItem('gtar_sync_recovery:user:6001', 'stranded-snapshot')
  assert.equal(storage.getItem(SYNC_RETIRED_KEY), null)

  // Next run executes
  performStorageHousekeeping(storage)

  // Remaining stranded items cleaned up, marker set
  assert.equal(storage.getItem('gtar_sync_recovery:user:6001'), null)
  assert.equal(storage.getItem(SYNC_RETIRED_KEY), 'true')
  assert.deepEqual(readPersistedLibrary(storage), sampleLibrary)
})

test('7. Second launch idempotency (marker exists -> no-op)', () => {
  const storage = createMockStorage()
  storage.setItem(LIBRARY_KEY, JSON.stringify(sampleLibrary))
  storage.setItem(SYNC_RETIRED_KEY, 'true')

  let readCount = 0
  const spyStorage = {
    ...storage,
    getItem: (k) => {
      readCount++
      return storage.getItem(k)
    },
    removeItem: () => {
      assert.fail('removeItem should not be called when already retired!')
    },
  }

  const result = retireDriveSyncState(spyStorage)
  assert.equal(result, true)
  assert.equal(readCount, 1, 'Only SYNC_RETIRED_KEY should be read on idempotent check')
})
