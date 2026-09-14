const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename)
const { openSyncJournal } = require('../src/utils/syncJournal.ts')
const { mergeSyncLibrary } = require('../src/utils/syncMerge.ts')
const base = {songs:[{id:'a',title:'Song',rawContent:'old'}],setlists:[]}
const edited = {songs:[{...base.songs[0],rawContent:'unsent'}],setlists:[]}
function storage() {
  const values = new Map()
  return {
    getItem: k => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: k => values.delete(k),
    key: i => [...values.keys()][i] ?? null,
    get length() { return values.size },
    values
  }
}
function synced(store) { const j=openSyncJournal('account',base,store);j.prepare(base,base);j.acknowledge() }
for (const local of [edited,{songs:[],setlists:[]}]) test(`offline mutation, failed upload and restart: ${local.songs.length}`,()=>{
  const store=storage();synced(store)
  const first=openSyncJournal('account',local,store)
  first.archive(base);first.prepare(local,local) // Upload fails or token expires.
  const restarted=openSyncJournal('account',local,store)
  assert.deepEqual(mergeSyncLibrary(restarted.local,base,restarted.baseline),local)
  assert.ok([...store.values.keys()].some(k=>k.startsWith('gtar_sync_recovery:')))
})
test('acknowledged upload interrupted before local apply resumes from durable pending record',()=>{
  const store=storage();synced(store)
  const j=openSyncJournal('account',base,store);j.prepare(base,edited);j.acknowledge()
  const recovered=openSyncJournal('account',base,store)
  assert.deepEqual(recovered.local,edited)
  assert.deepEqual(recovered.baseline,edited)
})
test('account switches and corrupt or unavailable storage stop before changes',()=>{
  const store=storage();synced(store)
  assert.throws(()=>openSyncJournal('other',edited,store),/another Google account/)
  store.setItem('gtar_sync_v1:account','bad')
  assert.throws(()=>openSyncJournal('account',edited,store))
  assert.throws(()=>openSyncJournal('account',edited,{getItem(){return null},setItem(){throw Error('quota')}}),/quota/)
})

test('atomic device persistence survives a restart and does not partially replace on quota failure',()=>{
  const {persistLibrary,readPersistedLibrary}=require('../src/utils/syncJournal.ts')
  const store=storage()
  persistLibrary(base,store)
  assert.deepEqual(readPersistedLibrary(store),base)
  const blocked={...store,setItem(){throw Error('quota')}}
  assert.throws(()=>persistLibrary(edited,blocked),/quota/)
  assert.deepEqual(readPersistedLibrary(store),base)
})

test('archive prunes older recovery snapshots and tolerates quota errors gracefully',()=>{
  const store=storage()
  const j=openSyncJournal('account',base,store)
  // Archive multiple times
  j.archive(base)
  j.archive(edited)
  j.archive(base)
  const recoveryKeys = [...store.values.keys()].filter(k=>k.startsWith('gtar_sync_recovery:account:'))
  assert.ok(recoveryKeys.length <= 2, `Expected at most 2 recovery snapshots, got ${recoveryKeys.length}`)

  // Storage failure during archive degrades gracefully and does NOT throw or crash sync
  let throwsOnSet = false
  const quotaStore = {
    ...store,
    setItem(k, v) {
      if (throwsOnSet && k.startsWith('gtar_sync_recovery:')) throw new Error('QuotaExceededError')
      store.setItem(k, v)
    }
  }
  const jQuota = openSyncJournal('account',base,quotaStore)
  throwsOnSet = true
  assert.doesNotThrow(() => jQuota.archive(base))
})

test('isQuotaError detects DOMException and quota error messages correctly',()=>{
  const { isQuotaError } = require('../src/utils/syncJournal.ts')
  assert.equal(isQuotaError(new Error('QuotaExceededError')), true)
  assert.equal(isQuotaError(new Error('The quota has been exceeded.')), true)
  assert.equal(isQuotaError(new Error('Failed to execute setItem: Setting the value exceeded the quota.')), true)
  assert.equal(isQuotaError({ name: 'QuotaExceededError', code: 22 }), true)
  assert.equal(isQuotaError(new Error('Network error')), false)
  assert.equal(isQuotaError(null), false)
})

test('persistLibrary auto-prunes recovery snapshots to save primary library on quota hit',()=>{
  const { persistLibrary, readPersistedLibrary, openSyncJournal } = require('../src/utils/syncJournal.ts')
  const store = storage()
  const j = openSyncJournal('account', base, store)
  j.archive(base)
  j.archive(edited)
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
  // Recovery snapshots were pruned to allow saving primary library
  const remaining = [...quotaStore.values.keys()].filter(k => k.startsWith('gtar_sync_recovery:'))
  assert.equal(remaining.length, 0)
})

test('normal storage persistence saves journal, snapshots, and primary library without error', () => {
  const { persistLibrary, readPersistedLibrary, openSyncJournal } = require('../src/utils/syncJournal.ts')
  const store = storage()
  const j = openSyncJournal('account', base, store)
  assert.equal(j.isDegraded(), false)
  j.archive(base)
  const recoveryKeys = [...store.values.keys()].filter(k => k.startsWith('gtar_sync_recovery:account:'))
  assert.equal(recoveryKeys.length, 1)
  j.prepare(base, edited)
  assert.ok(store.getItem('gtar_sync_v1:account'))
  j.acknowledge()
  const ackRaw = JSON.parse(store.getItem('gtar_sync_v1:account'))
  assert.equal(ackRaw.pending.acknowledged, true)
  j.complete()
  const compRaw = JSON.parse(store.getItem('gtar_sync_v1:account'))
  assert.equal(compRaw.pending, undefined)
  persistLibrary(edited, store)
  assert.deepEqual(readPersistedLibrary(store), edited)
  assert.equal(j.isDegraded(), false)
})

test('initial QuotaExceededError on archive recovers when pruning stale snapshots allows retry to succeed', () => {
  const store = storage()
  // Store a stale recovery snapshot
  store.setItem('gtar_sync_recovery:account:1000_stale', 'stale-data')

  let firstAttempt = true
  const quotaStore = {
    ...store,
    setItem(k, v) {
      if (firstAttempt && k.startsWith('gtar_sync_recovery:')) {
        firstAttempt = false
        throw new Error('QuotaExceededError')
      }
      store.setItem(k, v)
    }
  }

  const j2 = openSyncJournal('account', base, quotaStore)
  j2.archive(base)

  // Retry succeeded after pruning the stale snapshot
  assert.equal(j2.isDegraded(), false)
  assert.equal(quotaStore.getItem('gtar_sync_recovery:account:1000_stale'), null)
  const recoveryKeys = [...quotaStore.values.keys()].filter(k => k.startsWith('gtar_sync_recovery:account:'))
  assert.equal(recoveryKeys.length, 1)
})

test('initial QuotaExceededError on prepare recovers when pruning stale snapshots allows retry to succeed', () => {
  const store = storage()
  store.setItem('gtar_sync_recovery:account:1000_stale', 'stale-data')

  let firstAttempt = true
  const quotaStore = {
    ...store,
    setItem(k, v) {
      if (firstAttempt && k.startsWith('gtar_sync_v1:')) {
        firstAttempt = false
        throw new Error('QuotaExceededError')
      }
      store.setItem(k, v)
    }
  }

  const j2 = openSyncJournal('account', base, quotaStore)
  j2.prepare(base, edited)

  assert.equal(j2.isDegraded(), false)
  assert.equal(quotaStore.getItem('gtar_sync_recovery:account:1000_stale'), null)
  assert.ok(quotaStore.getItem('gtar_sync_v1:account'))
})

test('QuotaExceededError persisting after pruning transitions gracefully to in-memory mode without warning spam', () => {
  const store = storage()
  const failingStore = {
    ...store,
    setItem(k, v) {
      if (k.startsWith('gtar_sync_recovery:') || k.startsWith('gtar_sync_v1:')) {
        throw new Error('QuotaExceededError')
      }
      store.setItem(k, v)
    }
  }

  const warns = []
  const originalWarn = console.warn
  console.warn = (...args) => { warns.push(args[0]) }

  try {
    const j = openSyncJournal('account', base, failingStore)
    // Archive 1 fails initial and retry
    j.archive(base)
    assert.equal(j.isDegraded(), true)
    const warnsCountAfterFirst = warns.length
    assert.ok(warnsCountAfterFirst > 0)

    // Archive 2 in same sync cycle: should NOT spam console.warn
    j.archive(edited)
    assert.equal(warns.length, warnsCountAfterFirst)

    // Prepare in degraded mode: should NOT throw and NOT spam console.warn
    assert.doesNotThrow(() => j.prepare(base, edited))
    assert.equal(warns.length, warnsCountAfterFirst)

    // Acknowledge in degraded mode: should NOT throw and NOT spam console.warn
    assert.doesNotThrow(() => j.acknowledge())
    assert.equal(warns.length, warnsCountAfterFirst)

    // Complete in degraded mode: should NOT throw and NOT spam console.warn
    assert.doesNotThrow(() => j.complete())
    assert.equal(warns.length, warnsCountAfterFirst)
    assert.deepEqual(j.baseline, edited)
  } finally {
    console.warn = originalWarn
  }
})

test('sync journal pending and acknowledge state quota failure handles state transition in-memory', () => {
  const store = storage()
  // Store fails only on sync journal updates
  const failingStore = {
    ...store,
    setItem(k, v) {
      if (k.startsWith('gtar_sync_v1:')) {
        throw new Error('QuotaExceededError')
      }
      store.setItem(k, v)
    }
  }

  const j = openSyncJournal('account', base, failingStore)
  assert.equal(j.isDegraded(), false)

  // Prepare encounters quota failure -> transitions to in-memory
  assert.doesNotThrow(() => j.prepare(base, edited))
  assert.equal(j.isDegraded(), true)

  // Acknowledge operates in-memory smoothly
  assert.doesNotThrow(() => j.acknowledge())

  // Complete updates in-memory baseline
  assert.doesNotThrow(() => j.complete())
  assert.deepEqual(j.baseline, edited)
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
  const { pruneRecoverySnapshots, pruneAllRecoverySnapshots, isCanonicalKey } = require('../src/utils/syncJournal.ts')
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

  // Prune account recovery snapshots down to 0
  pruneRecoverySnapshots(store, 'account', 0)
  assert.equal(store.getItem('gtar_sync_recovery:account:1001_snap1'), null)
  assert.equal(store.getItem('gtar_sync_recovery:account:1002_snap2'), null)
  assert.ok(store.getItem('gtar_sync_recovery:other:2001_snap3'))

  // Prune all recovery snapshots down to 0
  pruneAllRecoverySnapshots(store, 0)
  assert.equal(store.getItem('gtar_sync_recovery:other:2001_snap3'), null)

  // Verify ALL canonical keys remain completely intact
  for (const [k, v] of canonicalEntries) {
    assert.equal(store.getItem(k), v, `Canonical key ${k} was unexpectedly modified or pruned!`)
  }
  assert.equal(store.length, canonicalEntries.length)
})

test('performStorageHousekeeping purges legacy duplicate stores and bounds recovery snapshots', () => {
  const { performStorageHousekeeping } = require('../src/utils/syncJournal.ts')
  const store = storage()

  // Simulate canonical library present along with legacy duplicate stores
  store.setItem('gtar_library_v1', JSON.stringify(base))
  store.setItem('gtar_songs_store', JSON.stringify(base.songs))
  store.setItem('gtar_trash_songs_store', '[]')
  store.setItem('gtar_setlists_store', '[]')
  store.setItem('gtar_theme_mode', '"solarized-dark"')

  // Simulate extra recovery snapshots
  store.setItem('gtar_sync_recovery:acc:1_snap', 'snap1')
  store.setItem('gtar_sync_recovery:acc:2_snap', 'snap2')
  store.setItem('gtar_sync_recovery:acc:3_snap', 'snap3')

  performStorageHousekeeping(store)

  // Legacy duplicate stores should be purged
  assert.equal(store.getItem('gtar_songs_store'), null)
  assert.equal(store.getItem('gtar_trash_songs_store'), null)
  assert.equal(store.getItem('gtar_setlists_store'), null)

  // Canonical library and theme settings preserved
  assert.ok(store.getItem('gtar_library_v1'))
  assert.equal(store.getItem('gtar_theme_mode'), '"solarized-dark"')

  // In retirement era, recovery snapshots are pruned to 0 and retirement marker is set
  const remainingSnaps = [...store.values.keys()].filter(k => k.startsWith('gtar_sync_recovery:'))
  assert.equal(remainingSnaps.length, 0)
  assert.equal(store.getItem('gtar_sync_retired_v1'), 'true')
})

test('persistLibrary purges legacy duplicate stores on quota hit to reclaim maximum storage space', () => {
  const { persistLibrary } = require('../src/utils/syncJournal.ts')
  const store = storage()

  store.setItem('gtar_songs_store', 'legacy-data')
  store.setItem('gtar_trash_songs_store', 'legacy-data')
  store.setItem('gtar_setlists_store', 'legacy-data')

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

  // Legacy stores purged during quota recovery
  assert.equal(store.getItem('gtar_songs_store'), null)
  assert.equal(store.getItem('gtar_trash_songs_store'), null)
  assert.equal(store.getItem('gtar_setlists_store'), null)
  assert.ok(store.getItem('gtar_library_v1'))
})

test('SAFETY REQUIREMENT 1: performStorageHousekeeping preserves gtar_songs_store when canonical library is absent or damaged', () => {
  const { performStorageHousekeeping } = require('../src/utils/syncJournal.ts')
  const store = storage()
  store.setItem('gtar_songs_store', JSON.stringify([{ id: 'legacy-1', title: 'Sole Source' }]))

  // Scenario A: Canonical library absent
  performStorageHousekeeping(store)
  assert.ok(store.getItem('gtar_songs_store'), 'Housekeeping must NOT delete gtar_songs_store if canonical is absent!')

  // Scenario B: Canonical library damaged / invalid JSON
  store.setItem('gtar_library_v1', '{"invalid": true}')
  performStorageHousekeeping(store)
  assert.ok(store.getItem('gtar_songs_store'), 'Housekeeping must NOT delete gtar_songs_store if canonical is damaged!')
})

test('SAFETY REQUIREMENT 1: persistLibrary never purges gtar_songs_store if it is the sole migration source and write fails', () => {
  const { persistLibrary } = require('../src/utils/syncJournal.ts')
  const store = storage()
  store.setItem('gtar_songs_store', JSON.stringify([{ id: 'legacy-1', title: 'Sole Source Song' }]))

  const permanentQuotaStore = {
    ...store,
    setItem(k, v) {
      if (k === 'gtar_library_v1') {
        throw new Error('QuotaExceededError')
      }
      store.setItem(k, v)
    }
  }

  assert.throws(() => {
    persistLibrary(edited, permanentQuotaStore)
  }, /quota exceeded/i)

  // gtar_songs_store MUST NOT be deleted!
  assert.ok(store.getItem('gtar_songs_store'), 'Sole migration source gtar_songs_store must NEVER be deleted on failed migration!')
  assert.match(store.getItem('gtar_songs_store'), /Sole Source Song/)
})

// =========================================================================
// SAFETY REQUIREMENT 2: CRASH / RECOVERY MATRIX FOR LibraryDelta (ALL 6 BOUNDARIES)
// =========================================================================

test('CRASH BOUNDARY 1: reload after archive, before prepare', () => {
  const store = storage()
  synced(store) // establishes initial baseline
  const localEdit = { songs: [{ id: 'a', title: 'Song', rawContent: 'local edit 1' }], setlists: [] }
  const j1 = openSyncJournal('account', localEdit, store)
  j1.archive(base) // Boundary 1 reached: archive saved, prepare not yet called

  // Simulated process crash / reload:
  const j2 = openSyncJournal('account', localEdit, store)
  assert.deepEqual(j2.baseline, base, 'Baseline must remain original synced baseline')
  assert.deepEqual(j2.local, localEdit, 'Local state must remain intact')
  assert.ok([...store.values.keys()].some(k => k.startsWith('gtar_sync_recovery:account:')), 'Recovery snapshot must exist')
})

test('CRASH BOUNDARY 2: reload after prepare, before cloud upload', () => {
  const store = storage()
  synced(store)
  const localEdit = { songs: [{ id: 'a', title: 'Song', rawContent: 'local edit 2' }], setlists: [] }
  const merged = { songs: [{ id: 'a', title: 'Song', rawContent: 'merged candidate' }], setlists: [] }
  const j1 = openSyncJournal('account', localEdit, store)
  j1.archive(base)
  j1.prepare(localEdit, merged) // Boundary 2 reached: prepare called, upload not yet done

  // Simulated process crash / reload before upload:
  const j2 = openSyncJournal('account', localEdit, store)
  assert.deepEqual(j2.baseline, base, 'Baseline must remain base since upload was not acknowledged')
  assert.deepEqual(j2.local, localEdit, 'Local unacknowledged edits must remain authoritative')
})

test('CRASH BOUNDARY 3: reload after cloud upload, before acknowledge', () => {
  const store = storage()
  synced(store)
  const localEdit = { songs: [{ id: 'a', title: 'Song', rawContent: 'local edit 3' }], setlists: [] }
  const merged = { songs: [{ id: 'a', title: 'Song', rawContent: 'cloud uploaded' }], setlists: [] }
  const j1 = openSyncJournal('account', localEdit, store)
  j1.archive(base)
  j1.prepare(localEdit, merged)
  // Cloud upload succeeds in network, but process crashes before j1.acknowledge()!

  // Simulated process reload:
  const j2 = openSyncJournal('account', localEdit, store)
  // On next sync cycle, cloud returns merged, and 3-way merge reconstructs clean state:
  const nextSync = mergeSyncLibrary(j2.local, merged, j2.baseline)
  assert.deepEqual(nextSync.songs[0].rawContent, 'local edit 3', 'Local changes are preserved against cloud upload')
})

test('CRASH BOUNDARY 4: reload after acknowledge, before local persistLibrary', () => {
  const store = storage()
  synced(store)
  const localEdit = { songs: [{ id: 'a', title: 'Song', rawContent: 'local edit 4' }], setlists: [] }
  const merged = { songs: [{ id: 'a', title: 'Song', rawContent: 'merged authoritative' }, { id: 'b', title: 'New Cloud Song', rawContent: 'content b' }], setlists: [] }
  const j1 = openSyncJournal('account', localEdit, store)
  j1.archive(base)
  j1.prepare(localEdit, merged)
  j1.acknowledge() // Boundary 4 reached: acknowledged on disk, persistLibrary not yet called

  // Simulated crash / reload: disk still has localEdit in gtar_library_v1
  const j2 = openSyncJournal('account', localEdit, store)
  // Durable delta recovery must reconstruct pendingMerged and apply it cleanly!
  assert.deepEqual(j2.local, merged, 'Local state must be reconstructed from acknowledged delta without loss')
  assert.deepEqual(j2.baseline, merged, 'Baseline must advance to acknowledged merged state')
})

test('CRASH BOUNDARY 5: reload after local persistLibrary, before complete', () => {
  const { persistLibrary } = require('../src/utils/syncJournal.ts')
  const store = storage()
  synced(store)
  const localEdit = { songs: [{ id: 'a', title: 'Song', rawContent: 'local edit 5' }], setlists: [] }
  const merged = { songs: [{ id: 'a', title: 'Song', rawContent: 'persisted merged' }], setlists: [] }
  const j1 = openSyncJournal('account', localEdit, store)
  j1.archive(base)
  j1.prepare(localEdit, merged)
  j1.acknowledge()
  persistLibrary(merged, store) // Boundary 5 reached: persisted, complete not yet called

  // Simulated crash / reload:
  const j2 = openSyncJournal('account', merged, store)
  assert.deepEqual(j2.local, merged, 'Local state must remain merged')
  assert.deepEqual(j2.baseline, merged, 'Baseline must remain merged')

  // Next sync cycle can prepare new changes smoothly:
  assert.doesNotThrow(() => {
    j2.prepare(merged, merged)
  })
})

test('CRASH BOUNDARY 6: reload after complete', () => {
  const store = storage()
  synced(store)
  const localEdit = { songs: [{ id: 'a', title: 'Song', rawContent: 'local edit 6' }], setlists: [] }
  const merged = { songs: [{ id: 'a', title: 'Song', rawContent: 'final merged' }], setlists: [] }
  const j1 = openSyncJournal('account', localEdit, store)
  j1.archive(base)
  j1.prepare(localEdit, merged)
  j1.acknowledge()
  j1.complete() // Boundary 6 reached: complete called

  // Simulated reload:
  const j2 = openSyncJournal('account', merged, store)
  assert.deepEqual(j2.baseline, merged, 'Baseline must be final merged state')
  assert.deepEqual(j2.local, merged, 'Local state matches final merged state')
})

test('LibraryDelta preserves song reordering and exact structure across round-trip', () => {
  const { computeDelta, applyDelta } = require('../src/utils/syncJournal.ts')
  const baseLib = {
    songs: [
      { id: '1', title: 'One', rawContent: 'c1' },
      { id: '2', title: 'Two', rawContent: 'c2' },
      { id: '3', title: 'Three', rawContent: 'c3' },
    ],
    setlists: [{ id: 's1', name: 'Setlist', songIds: ['1', '2'] }],
    allowedUsers: ['user@example.com'],
  }

  // Target modifies song 2, deletes song 1, adds song 4, and reorders to [3, 4, 2]
  const targetLib = {
    songs: [
      { id: '3', title: 'Three', rawContent: 'c3' },
      { id: '4', title: 'Four', rawContent: 'c4' },
      { id: '2', title: 'Two', rawContent: 'c2-edited' },
    ],
    setlists: [{ id: 's1', name: 'Setlist Updated', songIds: ['3', '4', '2'] }],
    allowedUsers: ['user@example.com', 'admin@example.com'],
  }

  const delta = computeDelta(baseLib, targetLib)
  assert.equal(delta.changedSongs.length, 2) // 4 (new) and 2 (edited)
  assert.deepEqual(delta.deletedSongIds, ['1'])
  assert.deepEqual(delta.songIdsOrder, ['3', '4', '2'])

  const reconstructed = applyDelta(baseLib, delta)
  assert.deepEqual(reconstructed, targetLib, 'Delta must reconstruct exact song contents, setlists, allowedUsers, and ordering')
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



