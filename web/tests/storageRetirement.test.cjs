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

const base = { songs: [{ id: 'a', title: 'Song', rawContent: 'old' }], setlists: [] }
const edited = { songs: [{ ...base.songs[0], rawContent: 'new' }], setlists: [] }
const journalKey = 'gtar_sync_v1:user'
const snapshotKey = 'gtar_sync_recovery:user:1'
function setup(journal) {
  const storage = createMockStorage()
  storage.setItem(LIBRARY_KEY, JSON.stringify(base))
  if (journal) storage.setItem(journalKey, JSON.stringify(journal))
  return storage
}
for (const delta of [false, true]) test(`acknowledged pending apply (${delta ? 'delta' : 'full'}) is durable and retry is idempotent`, () => {
  const encode = lib => delta ? { changedSongs: lib.songs, deletedSongIds: [], songIdsOrder: ['a'], setlists: [] } : lib
  const storage = setup({ version: 1, baseline: base, pending: { acknowledged: true, [delta ? 'beforeDelta' : 'before']: encode(base), [delta ? 'mergedDelta' : 'merged']: encode(edited) } })
  const remove = storage.removeItem
  storage.removeItem = key => { assert.deepEqual(readPersistedLibrary(storage), edited); remove(key) }
  assert.equal(retireDriveSyncState(storage), true)
  assert.deepEqual(readPersistedLibrary(storage), edited)
  assert.equal(storage.getItem(journalKey), null)
  assert.equal(retireDriveSyncState(storage), true)
  assert.deepEqual(readPersistedLibrary(storage), edited)
})
test('uncertain upload retains all sources even with an old retirement marker', () => {
  const storage = setup({ version: 1, baseline: base, pending: { acknowledged: false } })
  storage.setItem(SYNC_RETIRED_KEY, 'true')
  storage.setItem(snapshotKey, 'unknown snapshot')
  const before = [...storage.store]
  assert.equal(performStorageHousekeeping(storage), false)
  assert.deepEqual([...storage.store], before)
})
for (const library of [{ songs: [null], setlists: [] }, { songs: [{ id: 'a' }], setlists: [] }, { ...base, setlists: [{id:'x',name:'Set',songs:[{id:'missing',title:'Missing'}]}] }, { songs: [...base.songs, ...base.songs], setlists: [] }]) test('malformed canonical records/references preserve sources', () => {
  const storage = setup({ version: 1, baseline: base })
  storage.setItem(LIBRARY_KEY, JSON.stringify(library))
  const before = [...storage.store]
  assert.equal(retireDriveSyncState(storage), false)
  assert.deepEqual([...storage.store], before)
})
test('divergent legacy records are retained; disjoint records reconcile', () => {
  const storage = setup()
  storage.setItem('gtar_songs_store', JSON.stringify(edited.songs))
  assert.equal(retireDriveSyncState(storage), false)
  assert.deepEqual(readPersistedLibrary(storage), base)
  assert.ok(storage.getItem('gtar_songs_store'))
  storage.setItem('gtar_songs_store', JSON.stringify([{id:'b',title:'Recovered',rawContent:'saved'}]))
  assert.equal(retireDriveSyncState(storage), true)
  assert.equal(readPersistedLibrary(storage).songs.length, 2)
  assert.equal(storage.getItem('gtar_songs_store'), null)
})
test('recovery snapshots reconcile missing songs and setlist references before deletion', () => {
  const storage = setup()
  const recovered = { songs: [{id:'b', title:'Recovered', rawContent:'saved'}], setlists:[{id:'set',name:'Recovered set',songs:[{id:'b',title:'Recovered'}]}] }
  storage.setItem(snapshotKey, JSON.stringify({local:base, remote:recovered, journal:{version:1,baseline:null}}))
  assert.equal(retireDriveSyncState(storage), true)
  assert.equal(readPersistedLibrary(storage).songs.length, 2)
  assert.equal(readPersistedLibrary(storage).setlists[0].songs[0].id, 'b')
  assert.equal(storage.getItem(snapshotKey), null)
})
for (const blockedKey of [LIBRARY_KEY, SYNC_RETIRED_KEY]) test(`quota failure on ${blockedKey} retains all sources and permits retry`, () => {
  const storage = setup({version:1,baseline:base,pending:{acknowledged:true,before:base,merged:edited}})
  const write = storage.setItem
  storage.setItem = (k,v) => { if(k===blockedKey) throw Error('QuotaExceededError'); write(k,v) }
  assert.equal(retireDriveSyncState(storage), false)
  assert.ok(storage.getItem(journalKey))
  if (blockedKey===LIBRARY_KEY) assert.deepEqual(readPersistedLibrary(storage), base)
  storage.setItem = write
  assert.equal(retireDriveSyncState(storage), true)
  assert.deepEqual(readPersistedLibrary(storage), edited)
})
test('conflicting post-upload edit stays intact and recovery remains exportable', () => {
  const storage = setup({version:1,baseline:base,pending:{acknowledged:true,before:base,merged:edited}})
  const local = { songs:[{...base.songs[0],rawContent:'later edit'}],setlists:[] }
  persistLibrary(local,storage)
  assert.equal(retireDriveSyncState(storage),false)
  assert.deepEqual(readPersistedLibrary(storage),local)
  const {recoveryData}=require('../src/utils/syncJournal.ts')
  assert.ok(recoveryData(storage)[journalKey])
})

test('interrupted deletion retries safely with canonical already migrated', () => {
  const storage=setup({version:1,baseline:base,pending:{acknowledged:true,before:base,merged:edited}})
  const remove=storage.removeItem
  storage.removeItem=()=>{throw Error('remove blocked')}
  assert.equal(retireDriveSyncState(storage),false)
  assert.deepEqual(readPersistedLibrary(storage),edited)
  assert.ok(storage.getItem(journalKey))
  storage.removeItem=remove
  assert.equal(retireDriveSyncState(storage),true)
  assert.deepEqual(readPersistedLibrary(storage),edited)
})
test('unreconciled completed baseline and malformed delta never disappear', () => {
  const storage=setup({version:1,baseline:edited})
  assert.equal(retireDriveSyncState(storage),false)
  storage.setItem(journalKey,JSON.stringify({version:1,baseline:base,pending:{acknowledged:true,before:base,mergedDelta:{changedSongs:[],deletedSongIds:[],songIdsOrder:['missing'],setlists:[]}}}))
  assert.equal(retireDriveSyncState(storage),false)
  assert.ok(storage.getItem(journalKey))
  assert.deepEqual(readPersistedLibrary(storage),base)
})

test('acknowledged merge supersedes known pre-upload snapshots and legacy duplicates',()=>{
  const storage=setup({version:1,baseline:base,pending:{acknowledged:true,before:base,merged:edited}})
  storage.setItem(snapshotKey,JSON.stringify({local:base,remote:edited,journal:{version:1,baseline:base}}))
  storage.setItem('gtar_songs_store',JSON.stringify(base.songs))
  assert.equal(retireDriveSyncState(storage),true)
  assert.deepEqual(readPersistedLibrary(storage),edited)
  assert.equal(storage.getItem(snapshotKey),null)
  assert.equal(storage.getItem('gtar_songs_store'),null)
})
test('acknowledged order-only changes survive retirement',()=>{
  const original={songs:[...base.songs,{id:'b',title:'Second',rawContent:'text'}],setlists:[]}
  const reordered={...original,songs:[...original.songs].reverse()}
  const storage=setup({version:1,baseline:original,pending:{acknowledged:true,before:original,merged:reordered}})
  storage.setItem(LIBRARY_KEY,JSON.stringify(original))
  assert.equal(retireDriveSyncState(storage),true)
  assert.deepEqual(readPersistedLibrary(storage),reordered)
})
