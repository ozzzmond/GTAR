const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
      }).outputText,
      filename
    )
}

const base = { songs: [{ id: 'a', title: 'Song', rawContent: 'old' }], setlists: [] }
const edited = { songs: [{ ...base.songs[0], rawContent: 'unsent' }], setlists: [] }

function storage() {
  const values = new Map()
  return {
    getItem: k => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)),
    removeItem: k => values.delete(k),
    key: i => [...values.keys()][i] ?? null,
    get length() { return values.size },
    values
  }
}

test('atomic device persistence survives a restart and does not partially replace on quota failure', () => {
  const { persistLibrary, readPersistedLibrary } = require('../src/utils/syncJournal.ts')
  const store = storage()
  persistLibrary(base, store)
  assert.deepEqual(readPersistedLibrary(store), base)
  const blocked = { ...store, setItem() { throw Error('quota') } }
  assert.throws(() => persistLibrary(edited, blocked), /quota/)
  assert.deepEqual(readPersistedLibrary(store), base)
})

test('isQuotaError detects DOMException and quota error messages correctly', () => {
  const { isQuotaError } = require('../src/utils/syncJournal.ts')
  assert.equal(isQuotaError(new Error('QuotaExceededError')), true)
  assert.equal(isQuotaError(new Error('The quota has been exceeded.')), true)
  assert.equal(isQuotaError(new Error('Failed to execute setItem: Setting the value exceeded the quota.')), true)
  assert.equal(isQuotaError({ name: 'QuotaExceededError', code: 22 }), true)
  assert.equal(isQuotaError(new Error('Network error')), false)
  assert.equal(isQuotaError(null), false)
})

test('pruneAllRecoverySnapshots retains unrecognized recovery snapshots', () => {
  const { pruneAllRecoverySnapshots } = require('../src/utils/syncJournal.ts')
  const store = storage()
  store.setItem('gtar_sync_recovery:account:1', 'snap1')
  store.setItem('gtar_sync_recovery:account:2', 'snap2')
  store.setItem('gtar_sync_recovery:account:3', 'snap3')
  pruneAllRecoverySnapshots(store, 2)
  const remaining = [...store.values.keys()].filter(k => k.startsWith('gtar_sync_recovery:'))
  assert.equal(remaining.length, 3)
  pruneAllRecoverySnapshots(store, 0)
  const empty = [...store.values.keys()].filter(k => k.startsWith('gtar_sync_recovery:'))
  assert.equal(empty.length, 3)
})

test('persistLibrary retains recovery snapshots while retrying primary library on quota hit', () => {
  const { persistLibrary, readPersistedLibrary } = require('../src/utils/syncJournal.ts')
  const store = storage()
  store.setItem('gtar_sync_recovery:account:1', 'snapshot-data')
  assert.ok([...store.values.keys()].some(k => k.startsWith('gtar_sync_recovery:')))

  let hitQuotaOnce = true
  const quotaStore = {
    ...store,
    setItem(k, v) {
      if (k === 'gtar_library_v1' && hitQuotaOnce) {
        hitQuotaOnce = false
        throw new Error('QuotaExceededError')
      }
      store.setItem(k, v)
    }
  }
  persistLibrary(edited, quotaStore)
  assert.deepEqual(readPersistedLibrary(quotaStore), edited)
  // Recovery snapshots remain available after retry
  const remaining = [...quotaStore.values.keys()].filter(k => k.startsWith('gtar_sync_recovery:'))
  assert.equal(remaining.length, 1)
})

test('isQuotaError detects DOMException and rejects non-quota DOMExceptions correctly', () => {
  const { isQuotaError } = require('../src/utils/syncJournal.ts')
  // Quota exceptions
  assert.equal(isQuotaError(new Error('QuotaExceededError')), true)
  assert.equal(isQuotaError(new Error('NS_ERROR_DOM_QUOTA_REACHED')), true)
  assert.equal(isQuotaError(new Error('The quota has been exceeded.')), true)
  assert.equal(isQuotaError(new DOMException('The quota has been exceeded.', 'QuotaExceededError')), true)
  assert.equal(isQuotaError(new DOMException('Persistent storage limit reached', 'NS_ERROR_DOM_QUOTA_REACHED')), true)
  assert.equal(isQuotaError({ name: 'QuotaExceededError', code: 22 }), true)
  assert.equal(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED', code: 1014 }), true)
  assert.equal(isQuotaError({ code: 22 }), true)
  assert.equal(isQuotaError({ code: 1014 }), true)

  // Non-quota exceptions must NOT be misclassified
  assert.equal(isQuotaError(new DOMException('The operation was aborted.', 'AbortError')), false)
  assert.equal(isQuotaError(new DOMException('The operation is insecure.', 'SecurityError')), false)
  assert.equal(isQuotaError(new DOMException('A network error occurred.', 'NetworkError')), false)
  assert.equal(isQuotaError(new DOMException('Hierarchy request error.', 'HierarchyRequestError')), false)
  assert.equal(isQuotaError(new Error('Network disconnected')), false)
  assert.equal(isQuotaError(new Error('Random syntax error')), false)
  assert.equal(isQuotaError({ code: 18, name: 'SecurityError' }), false)
  assert.equal(isQuotaError(null), false)
  assert.equal(isQuotaError(undefined), false)
  assert.equal(isQuotaError('string'), false)
})

test('canonical user data keys are never selected for recovery snapshot pruning', () => {
  const { pruneAllRecoverySnapshots, isCanonicalKey } = require('../src/utils/syncJournal.ts')
  const store = storage()

  // Canonical keys and user state
  const canonicalEntries = [
    ['gtar_library_v1', JSON.stringify(base)],
    ['gtar_sync_library_owner', 'account'],
    ['gtar_sync_v1:account', JSON.stringify({ version: 1, baseline: base })],
    ['gtar_songs_store', JSON.stringify(base.songs)],
    ['gtar_trash_songs_store', '[]'],
    ['gtar_setlists_store', '[]'],
    ['gtar_active_setlist_id', '"gig-1"'],
    ['gtar_theme_mode', '"solarized-dark"'],
    ['gtar_custom_theme_colors', '{}'],
    ['gtar_font_style', '"mono"'],
    ['gtar_is_two_column', 'false'],
  ]

  for (const [k, v] of canonicalEntries) {
    store.setItem(k, v)
    assert.equal(isCanonicalKey(k), true, `Expected ${k} to be recognized as canonical key`)
  }

  // Stale recovery snapshots
  store.setItem('gtar_sync_recovery:account:1001_snap1', 'snapshot-1')
  store.setItem('gtar_sync_recovery:account:1002_snap2', 'snapshot-2')
  store.setItem('gtar_sync_recovery:other:2001_snap3', 'snapshot-3')

  assert.equal(store.length, canonicalEntries.length + 3)

  // Prune all recovery snapshots down to 0
  pruneAllRecoverySnapshots(store, 0)
  assert.equal(store.getItem('gtar_sync_recovery:account:1001_snap1'), 'snapshot-1')
  assert.equal(store.getItem('gtar_sync_recovery:account:1002_snap2'), 'snapshot-2')
  assert.equal(store.getItem('gtar_sync_recovery:other:2001_snap3'), 'snapshot-3')

  // Verify ALL canonical keys remain completely intact
  for (const [k, v] of canonicalEntries) {
    assert.equal(store.getItem(k), v, `Canonical key ${k} was unexpectedly modified or pruned!`)
  }
  assert.equal(store.length, canonicalEntries.length + 3)
})

test('performStorageHousekeeping preserves all sources when recovery snapshots are ambiguous', () => {
  const { performStorageHousekeeping } = require('../src/utils/syncJournal.ts')
  const store = storage()

  // Setup canonical library
  store.setItem('gtar_library_v1', JSON.stringify(base))
  // Setup legacy stores that are duplicates
  store.setItem('gtar_songs_store', JSON.stringify(base.songs))
  store.setItem('gtar_trash_songs_store', '[]')
  store.setItem('gtar_setlists_store', '[]')
  store.setItem('gtar_sync_v1:acc1', JSON.stringify({ version: 1 }))
  store.setItem('gtar_sync_library_owner', 'acc1')

  // Setup 5 recovery snapshots (above bound of 2)
  for (let i = 1; i <= 5; i++) {
    store.setItem(`gtar_sync_recovery:acc1:100${i}`, `snap-${i}`)
  }

  performStorageHousekeeping(store)

  // Canonical library must remain
  assert.deepEqual(JSON.parse(store.getItem('gtar_library_v1')), base)

  // Ambiguity preserves all sources
  assert.ok(store.getItem('gtar_songs_store'))
  assert.ok(store.getItem('gtar_trash_songs_store'))
  assert.ok(store.getItem('gtar_setlists_store'))
  assert.ok(store.getItem('gtar_sync_v1:acc1'))
  assert.ok(store.getItem('gtar_sync_library_owner'))

  // Every unresolved snapshot is retained
  const remainingSnaps = [...store.values.keys()].filter(k => k.startsWith('gtar_sync_recovery:'))
  assert.equal(remainingSnaps.length, 5)
})

test('persistLibrary preserves legacy stores on quota hit', () => {
  const { persistLibrary, readPersistedLibrary } = require('../src/utils/syncJournal.ts')
  const store = storage()

  // Seed store with canonical library + duplicate legacy stores
  store.setItem('gtar_library_v1', JSON.stringify(base))
  store.setItem('gtar_songs_store', JSON.stringify(base.songs))
  store.setItem('gtar_trash_songs_store', '[]')
  store.setItem('gtar_setlists_store', '[]')
  store.setItem('gtar_sync_v1:acc1', JSON.stringify({ version: 1 }))

  let hitQuotaOnce = true
  const quotaStore = {
    ...store,
    setItem(k, v) {
      if (k === 'gtar_library_v1' && hitQuotaOnce) {
        hitQuotaOnce = false
        throw new Error('QuotaExceededError')
      }
      store.setItem(k, v)
    }
  }

  // Persisting retries after pruning only disposable logs
  persistLibrary(edited, quotaStore)

  assert.deepEqual(readPersistedLibrary(quotaStore), edited)
  assert.ok(quotaStore.getItem('gtar_songs_store'))
  assert.ok(quotaStore.getItem('gtar_trash_songs_store'))
  assert.ok(quotaStore.getItem('gtar_setlists_store'))
})

test('SAFETY REQUIREMENT 1: performStorageHousekeeping preserves gtar_songs_store when canonical library is absent or damaged', () => {
  const { performStorageHousekeeping } = require('../src/utils/syncJournal.ts')
  const store = storage()

  // No canonical library, only legacy store
  store.setItem('gtar_songs_store', JSON.stringify(base.songs))
  performStorageHousekeeping(store)
  assert.ok(store.getItem('gtar_songs_store'), 'Must NOT purge gtar_songs_store when canonical library is missing')

  // Corrupted canonical library
  store.setItem('gtar_library_v1', '{corrupt json')
  performStorageHousekeeping(store)
  assert.ok(store.getItem('gtar_songs_store'), 'Must NOT purge gtar_songs_store when canonical library is corrupt')
})

test('SAFETY REQUIREMENT 1: persistLibrary never purges gtar_songs_store if it is the sole migration source and write fails', () => {
  const { persistLibrary } = require('../src/utils/syncJournal.ts')
  const store = storage()

  // Sole migration source present
  store.setItem('gtar_songs_store', JSON.stringify(base.songs))

  // Storage that unconditionally throws on write
  const failingStore = {
    ...store,
    setItem() {
      throw new Error('QuotaExceededError')
    }
  }

  // Attempting to persist when storage is completely full
  assert.throws(() => persistLibrary(edited, failingStore), /quota exceeded/i)

  // gtar_songs_store MUST still exist intact
  assert.ok(store.getItem('gtar_songs_store'), 'Sole migration source gtar_songs_store was purged during failed write!')
  assert.deepEqual(JSON.parse(store.getItem('gtar_songs_store')), base.songs)
})

test('estimateStorageFootprint accurately calculates bytes, MB, key counts, and key sizes', () => {
  const { estimateStorageFootprint } = require('../src/utils/syncJournal.ts')
  const store = storage()
  store.setItem('key1', 'abc') // key: 4, val: 3 -> 14 bytes
  store.setItem('key2', '12345') // key: 4, val: 5 -> 18 bytes
  const fp = estimateStorageFootprint(store)
  assert.equal(fp.keyCount, 2)
  assert.equal(fp.totalBytes, 32)
  assert.equal(fp.keys['key1'], 14)
  assert.equal(fp.keys['key2'], 18)
  assert.equal(typeof fp.totalMB, 'number')
})

test('logger caps localStorage to MAX_PERSISTED_LOGS (30) and prunes to 10 on quota hit', () => {
  const { prunePersistedLogs, MAX_PERSISTED_LOGS } = require('../src/utils/logger.ts')
  const store = storage()
  const logs = Array.from({ length: 50 }, (_, i) => ({
    id: `${i}`,
    timestamp: '2026-09-14T00:00:00.000Z',
    level: 'INFO',
    tag: 'Test',
    message: `log entry ${i}`,
  }))
  store.setItem('gtar_web_debug_logs', JSON.stringify(logs))

  // Normal pruning caps to 30
  prunePersistedLogs(store, MAX_PERSISTED_LOGS)
  const parsed30 = JSON.parse(store.getItem('gtar_web_debug_logs'))
  assert.equal(parsed30.length, 30)
  assert.equal(parsed30[29].message, 'log entry 49')

  // Emergency quota pruning caps to 10
  prunePersistedLogs(store, 10)
  const parsed10 = JSON.parse(store.getItem('gtar_web_debug_logs'))
  assert.equal(parsed10.length, 10)
  assert.equal(parsed10[9].message, 'log entry 49')
})
