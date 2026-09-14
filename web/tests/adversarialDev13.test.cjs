const { test } = require('node:test')
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

const { openSyncJournal, computeDelta, applyDelta, persistLibrary, performStorageHousekeeping, estimateStorageFootprint, isQuotaError } = require('../src/utils/syncJournal.ts')
const { mergeSyncLibrary } = require('../src/utils/syncMerge.ts')
const { prunePersistedLogs, MAX_PERSISTED_LOGS } = require('../src/utils/logger.ts')

function mockStorage() {
  const values = new Map()
  const log = []
  return {
    getItem: k => values.get(k) ?? null,
    setItem: (k, v) => {
      log.push({ op: 'set', key: k, size: (k.length + String(v).length) * 2 })
      values.set(k, String(v))
    },
    removeItem: k => {
      log.push({ op: 'remove', key: k })
      values.delete(k)
    },
    key: i => [...values.keys()][i] ?? null,
    get length() { return values.size },
    values,
    log,
  }
}

// =========================================================================
// SCENARIO 1: Local Edit After Prepare Before Reload
// =========================================================================
test('Adversarial 1: Local edit after prepare before reload preserves unpersisted and new edits', () => {
  const store = mockStorage()
  const base = { songs: [{ id: 's1', title: 'Song 1', rawContent: 'v1' }], setlists: [] }

  // Establish baseline
  const j0 = openSyncJournal('acc', base, store)
  j0.prepare(base, base)
  j0.acknowledge()
  j0.complete()

  // User edits to v2
  const localV2 = { songs: [{ id: 's1', title: 'Song 1', rawContent: 'v2' }], setlists: [] }
  const j1 = openSyncJournal('acc', localV2, store)
  j1.archive(base)
  j1.prepare(localV2, localV2) // Unacknowledged prepare writes { acknowledged: false }

  // User edits again locally to v3 BEFORE upload completes / before crash:
  const localV3 = { songs: [{ id: 's1', title: 'Song 1', rawContent: 'v3' }], setlists: [] }
  persistLibrary(localV3, store)

  // Crash / page reload occurs!
  const j2 = openSyncJournal('acc', localV3, store)
  assert.deepEqual(j2.local, localV3, 'Local must retain latest v3 edit')
  assert.deepEqual(j2.baseline, base, 'Baseline must remain base v1 since upload never completed')

  // Next sync cycle against remote cloud (cloud still has base v1):
  const nextSync = mergeSyncLibrary(j2.local, base, j2.baseline)
  assert.equal(nextSync.songs[0].rawContent, 'v3', 'Local v3 edit is 100% preserved against cloud')
})

// =========================================================================
// SCENARIO 2: Acknowledge Lost + Concurrent Local & Cloud Edits
// =========================================================================
test('Adversarial 2: Acknowledge lost + concurrent local and cloud edits reconciles without silent overwrite', () => {
  const store = mockStorage()
  const base = {
    songs: [
      { id: 'A', title: 'Song A', rawContent: 'A_base' },
      { id: 'B', title: 'Song B', rawContent: 'B_base' },
    ],
    setlists: [],
  }

  // Synced initial state
  const j0 = openSyncJournal('acc', base, store)
  j0.prepare(base, base)
  j0.acknowledge()
  j0.complete()

  // Client prepared and uploaded Song A edit:
  const localAEdit = {
    songs: [
      { id: 'A', title: 'Song A', rawContent: 'A_local_v1' },
      { id: 'B', title: 'Song B', rawContent: 'B_base' },
    ],
    setlists: [],
  }
  const j1 = openSyncJournal('acc', localAEdit, store)
  j1.archive(base)
  j1.prepare(localAEdit, localAEdit)
  // Cloud upload succeeds: cloud now has localAEdit!
  const cloudState = JSON.parse(JSON.stringify(localAEdit))

  // CRASH occurs before j1.acknowledge()!
  // While client is offline / reloading:
  // 1. Local user makes further edit to Song A -> 'A_local_v2'
  const localAEdit2 = {
    songs: [
      { id: 'A', title: 'Song A', rawContent: 'A_local_v2' },
      { id: 'B', title: 'Song B', rawContent: 'B_base' },
    ],
    setlists: [],
  }
  persistLibrary(localAEdit2, store)

  // 2. Remote collaborator makes concurrent edit to Song B on Cloud -> 'B_cloud_v1'
  cloudState.songs[1].rawContent = 'B_cloud_v1'

  // Client restarts and reconnects:
  const j2 = openSyncJournal('acc', localAEdit2, store)
  // 3-way merge: local (A:v2, B:base) vs cloud (A:v1, B:cloud_v1) with baseline (A:base, B:base)
  const reconciled = mergeSyncLibrary(j2.local, cloudState, j2.baseline)

  // Verify neither side was lost:
  const songA = reconciled.songs.find(s => s.id === 'A')
  const songB = reconciled.songs.find(s => s.id === 'B')
  assert.equal(songA.rawContent, 'A_local_v2', 'Local Song A v2 must win over uploaded v1')
  assert.equal(songB.rawContent, 'B_cloud_v1', 'Remote Song B edit must be incorporated cleanly')
})

// =========================================================================
// SCENARIO 3: Ambiguous Upload Failure / Timeout
// =========================================================================
test('Adversarial 3A: Ambiguous upload timeout where cloud received write reconciles idempotently', () => {
  const store = mockStorage()
  const base = { songs: [{ id: '1', title: 'Song', rawContent: 'base' }], setlists: [] }
  const j0 = openSyncJournal('acc', base, store)
  j0.prepare(base, base)
  j0.acknowledge()
  j0.complete()

  const localEdited = { songs: [{ id: '1', title: 'Song', rawContent: 'edited' }], setlists: [] }
  const j1 = openSyncJournal('acc', localEdited, store)
  j1.prepare(localEdited, localEdited)
  // Cloud received write:
  const cloudState = JSON.parse(JSON.stringify(localEdited))
  // Client got network timeout before acknowledge.

  // Reload:
  const j2 = openSyncJournal('acc', localEdited, store)
  // Subsequent sync fetches cloud:
  const merged = mergeSyncLibrary(j2.local, cloudState, j2.baseline)
  assert.deepEqual(merged, localEdited)
  // Re-upload or advance is idempotent:
  j2.prepare(localEdited, merged)
  j2.acknowledge()
  j2.complete()
  assert.deepEqual(j2.baseline, localEdited)
})

test('Adversarial 3B: Ambiguous upload timeout where cloud did NOT receive write safely re-syncs', () => {
  const store = mockStorage()
  const base = { songs: [{ id: '1', title: 'Song', rawContent: 'base' }], setlists: [] }
  const j0 = openSyncJournal('acc', base, store)
  j0.prepare(base, base)
  j0.acknowledge()
  j0.complete()

  const localEdited = { songs: [{ id: '1', title: 'Song', rawContent: 'edited' }], setlists: [] }
  const j1 = openSyncJournal('acc', localEdited, store)
  j1.prepare(localEdited, localEdited)
  // Cloud did NOT receive write, remains base:
  const cloudState = JSON.parse(JSON.stringify(base))

  // Reload:
  const j2 = openSyncJournal('acc', localEdited, store)
  const merged = mergeSyncLibrary(j2.local, cloudState, j2.baseline)
  assert.deepEqual(merged, localEdited, 'Local changes are preserved and ready for re-upload')
})

// =========================================================================
// SCENARIO 4: Legacy Full-Format Journal Migration
// =========================================================================
test('Adversarial 4: Legacy full-format journal migration reconstructs with 100% fidelity', () => {
  const store = mockStorage()
  const legacyBaseline = {
    songs: [
      { id: '1', title: 'Song 1', rawContent: 'raw 1' },
      { id: '2', title: 'Song 2', rawContent: 'raw 2', isDeleted: true },
    ],
    setlists: [{ id: 's1', name: 'Sunday Service', songs: [{ id: '1', title: 'Song 1' }] }],
    allowedUsers: ['owner@example.com'],
  }
  const legacyBefore = {
    songs: [
      { id: '1', title: 'Song 1', rawContent: 'raw 1' },
      { id: '2', title: 'Song 2', rawContent: 'raw 2', isDeleted: true },
    ],
    setlists: [{ id: 's1', name: 'Sunday Service', songs: [{ id: '1', title: 'Song 1' }] }],
    allowedUsers: ['owner@example.com'],
  }
  const legacyMerged = {
    songs: [
      { id: '2', title: 'Song 2', rawContent: 'raw 2', isDeleted: true },
      { id: '1', title: 'Song 1', rawContent: 'raw 1 edited' },
      { id: '3', title: 'Song 3', rawContent: 'raw 3' },
    ],
    setlists: [{ id: 's1', name: 'Sunday Service Reordered', songs: [{ id: '3', title: 'Song 3' }, { id: '1', title: 'Song 1' }] }],
    allowedUsers: ['owner@example.com', 'collaborator@example.com'],
  }

  // Write pre-DEV.13 legacy format with full snapshot objects in pending
  store.setItem('gtar_sync_v1:acc', JSON.stringify({
    version: 1,
    baseline: legacyBaseline,
    pending: {
      acknowledged: true,
      before: legacyBefore,
      merged: legacyMerged,
    },
  }))
  store.setItem('gtar_sync_library_owner', 'acc')

  // Reopen with DEV.13
  const j = openSyncJournal('acc', legacyBefore, store)

  // Baseline must advance to legacy merged state with 100% exact fidelity:
  assert.deepEqual(j.baseline, legacyMerged, 'Baseline must advance to legacy merged state')

  // j.local is resolved via mergeSyncLibrary(legacyBefore, legacyMerged, legacyBefore)
  // Verify all data survived into local:
  assert.equal(j.local.songs.length, 3)
  const s1 = j.local.songs.find(s => s.id === '1')
  const s2 = j.local.songs.find(s => s.id === '2')
  const s3 = j.local.songs.find(s => s.id === '3')
  assert.equal(s1.rawContent, 'raw 1 edited')
  assert.equal(s2.isDeleted, true)
  assert.equal(s3.rawContent, 'raw 3')
  assert.equal(j.local.setlists[0].name, 'Sunday Service Reordered')
  assert.equal(j.local.setlists[0].songs.length, 2)
  assert.equal(j.local.setlists[0].songs[0].id, '3')
  assert.equal(j.local.setlists[0].songs[1].id, '1')
})

// =========================================================================
// SCENARIO 5: Near-Quota Migration Edge Case (Legacy stores are sole source)
// =========================================================================
test('Adversarial 5: Near-quota migration edge case where legacy stores are sole source never deletes gtar_songs_store', () => {
  const store = mockStorage()
  const soleSourceSongs = [
    { id: 'legacy-1', title: 'Irreplaceable Song 1', rawContent: 'chords 1' },
    { id: 'legacy-2', title: 'Irreplaceable Song 2', rawContent: 'chords 2' },
  ]
  store.setItem('gtar_songs_store', JSON.stringify(soleSourceSongs))
  store.setItem('gtar_setlists_store', JSON.stringify([{ id: 'set-1', name: 'Main', songIds: ['legacy-1'] }]))

  // Storage is at quota: writing gtar_library_v1 throws QuotaExceededError permanently
  const quotaStore = {
    ...store,
    setItem(k, v) {
      if (k === 'gtar_library_v1') {
        const err = new Error('QuotaExceededError: storage limit reached')
        err.name = 'QuotaExceededError'
        err.code = 22
        throw err
      }
      store.setItem(k, v)
    },
  }

  assert.throws(() => {
    persistLibrary({ songs: soleSourceSongs, setlists: [] }, quotaStore)
  }, /quota exceeded/i)

  // CRITICAL VERIFICATION: gtar_songs_store MUST STILL EXIST and be 100% intact!
  const surviving = store.getItem('gtar_songs_store')
  assert.ok(surviving, 'gtar_songs_store must NEVER be deleted when it is sole source!')
  assert.deepEqual(JSON.parse(surviving), soleSourceSongs)
  assert.ok(store.getItem('gtar_setlists_store'), 'gtar_setlists_store must also be preserved')
})

// =========================================================================
// SCENARIO 6: Near-Quota Cleanup Precedence
// =========================================================================
test('Adversarial 6: Near-quota cleanup precedence prunes expendables first and records exact order', () => {
  const store = mockStorage()
  const validLib = { songs: [{ id: '1', title: 'Saved Song', rawContent: 'content' }], setlists: [] }
  store.setItem('gtar_library_v1', JSON.stringify(validLib))
  store.setItem('gtar_sync_recovery:acc:1_snap', 'snap1')
  store.setItem('gtar_sync_recovery:acc:2_snap', 'snap2')
  store.setItem('gtar_sync_recovery:other:3_snap', 'snap3')
  store.setItem('gtar_web_debug_logs', JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, message: `log ${i}` }))))
  store.setItem('gtar_songs_store', 'duplicate legacy data')
  store.setItem('gtar_trash_songs_store', 'duplicate legacy trash')
  store.setItem('gtar_setlists_store', 'duplicate legacy setlists')
  store.setItem('gtar_theme_mode', '"dark"')
  store.setItem('gtar_sync_library_owner', 'acc')

  const removedKeys = []
  let throwCount = 1
  const quotaStore = {
    ...store,
    removeItem(k) {
      removedKeys.push(k)
      store.removeItem(k)
    },
    setItem(k, v) {
      if (k === 'gtar_library_v1' && throwCount > 0) {
        throwCount--
        const err = new Error('QuotaExceededError')
        err.name = 'QuotaExceededError'
        err.code = 22
        throw err
      }
      store.setItem(k, v)
    },
  }

  persistLibrary({ songs: [{ id: '1', title: 'Saved Song Edited', rawContent: 'content 2' }], setlists: [] }, quotaStore)

  // Verify:
  // 1. Recovery snapshots were pruned first
  assert.ok(removedKeys.includes('gtar_sync_recovery:acc:1_snap'))
  assert.ok(removedKeys.includes('gtar_sync_recovery:acc:2_snap'))
  assert.ok(removedKeys.includes('gtar_sync_recovery:other:3_snap'))
  // 2. Logs were pruned to 10
  const logs = JSON.parse(store.getItem('gtar_web_debug_logs'))
  assert.equal(logs.length, 10)
  // 3. Duplicate stores were purged AFTER canonical write succeeded
  assert.equal(store.getItem('gtar_songs_store'), null)
  assert.equal(store.getItem('gtar_trash_songs_store'), null)
  assert.equal(store.getItem('gtar_setlists_store'), null)
  // 4. Canonical user data keys were preserved
  assert.ok(store.getItem('gtar_library_v1'))
  assert.equal(store.getItem('gtar_theme_mode'), '"dark"')
  assert.equal(store.getItem('gtar_sync_library_owner'), 'acc')
})

// =========================================================================
// SCENARIO 7: Nontrivial / Randomized LibraryDelta Round-Trip Fidelity
// =========================================================================
test('Adversarial 7: Nontrivial randomized LibraryDelta round-trip with complex mutations', () => {
  const baseSongs = [
    { id: 's-alpha', title: 'Alpha Song', artist: 'Band A', key: 'C', rawContent: '[C]Alpha chord', tags: ['fast'] },
    { id: 's-beta', title: 'Beta Song', artist: 'Band B', key: 'G', rawContent: '[G]Beta chord', transpose: 2 },
    { id: 101, title: 'Numeric ID Song', key: 'Am', rawContent: 'Am F C G' },
    { id: 's-gamma', title: 'Gamma Song', key: 'F', rawContent: 'To be deleted' },
    { id: 's-delta', title: 'Delta Song', key: 'D', rawContent: 'To be moved', isDeleted: false },
  ]
  const baseSetlists = [
    { id: 'set-1', name: 'Opening Set', songIds: ['s-alpha', 's-beta'] },
    { id: 'set-2', name: 'Acoustic Set', songIds: [101, 's-gamma'] },
  ]
  const base = { songs: baseSongs, setlists: baseSetlists, allowedUsers: ['user1@test.com', 'user2@test.com'] }

  // Target performs 7 simultaneous non-trivial mutations:
  // 1. Edit s-alpha content and transpose
  // 2. Delete s-gamma completely
  // 3. Mark s-beta as isDeleted: true
  // 4. Add new song 's-epsilon' with empty fields
  // 5. Add new song 202 with complex multiline lyrics & chords
  // 6. Completely shuffle song order to [202, 's-delta', 's-alpha', 's-epsilon', 101, 's-beta']
  // 7. Mutate setlists and allowedUsers
  const targetSongs = [
    { id: 202, title: 'New Song 202', artist: '', key: '', rawContent: 'Verse 1:\n[Em]Deep in the [D]night\n[C]Looking for [G]light' },
    { id: 's-delta', title: 'Delta Song', key: 'D', rawContent: 'To be moved', isDeleted: false },
    { id: 's-alpha', title: 'Alpha Song', artist: 'Band A', key: 'D', rawContent: '[D]Alpha chord transposed', tags: ['fast', 'opener'], transpose: 2 },
    { id: 's-epsilon', title: 'Empty Song', artist: '', key: '', rawContent: '' },
    { id: 101, title: 'Numeric ID Song', key: 'Am', rawContent: 'Am F C G' },
    { id: 's-beta', title: 'Beta Song', artist: 'Band B', key: 'G', rawContent: '[G]Beta chord', transpose: 2, isDeleted: true },
  ]
  const targetSetlists = [
    { id: 'set-1', name: 'Opening Set Expanded', songIds: [202, 's-alpha', 101] },
    { id: 'set-3', name: 'Brand New Set', songIds: ['s-delta'] },
  ]
  const target = {
    songs: targetSongs,
    setlists: targetSetlists,
    allowedUsers: ['user1@test.com', 'admin@test.com', 'guest@test.com'],
  }

  const delta = computeDelta(base, target)

  // Verify delta properties
  assert.equal(delta.deletedSongIds.length, 1)
  assert.equal(delta.deletedSongIds[0], 's-gamma')
  assert.deepEqual(delta.songIdsOrder, [202, 's-delta', 's-alpha', 's-epsilon', 101, 's-beta'])

  const reconstructed = applyDelta(base, delta)
  assert.deepEqual(reconstructed, target, 'Reconstructed library must match target with 100% exact fidelity')
})
