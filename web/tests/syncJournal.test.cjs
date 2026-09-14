const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
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


