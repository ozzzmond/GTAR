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


