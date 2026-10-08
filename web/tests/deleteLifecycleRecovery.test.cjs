const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename)
const { transitionSongLibrary, partitionSongs, resolveSetlistSong } = require('../src/utils/setlistSongs.ts')
const { persistLibrary, readPersistedLibrary, validateLibrary, planDanglingReferenceRepair, applyDanglingReferenceRepair, recoveryData, LIBRARY_KEY, hasActionableRecovery, performStorageHousekeeping } = require('../src/utils/syncJournal.ts')
const song = id => ({ id, title: `Song ${id}`, artist: '', rawContent: `[G]${id}`, format: 'CHORD_PRO' })
const ref = id => ({ id, title: `Song ${id}` })
const blank = song('blank')
const lists = [
  { id: 'one', name: 'First', createdAt: 42, songs: ['b', 'a', 'c', 'a'].map(ref) },
  { id: 'two', name: 'Second', isDeleted: true, songs: ['c', 'a'].map(ref) }
]
const initial = () => ({ active: ['a', 'b', 'c'].map(song), deleted: [], setlists: structuredClone(lists) })
const complete = state => ({ songs: [...state.active, ...state.deleted], setlists: state.setlists })
function storage() {
  const data = new Map()
  return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: k=>data.delete(k), key: i=>[...data.keys()][i]??null, get length(){return data.size} }
}
function validRoundtrip(state) {
  const candidate = complete(state), store = storage()
  validateLibrary(candidate)
  persistLibrary(candidate, store)
  assert.deepEqual(readPersistedLibrary(store), candidate)
  assert.equal(hasActionableRecovery(store), false)
}
for (const [name, setlists] of [['unreferenced', []], ['one setlist', [lists[0]]], ['multiple including deleted setlists', lists]]) {
  test(`Trash ${name} retains IDs, tombstone content and ordered membership; restore roundtrips`, () => {
    const before = { ...initial(), setlists: structuredClone(setlists) }, frozen = structuredClone(before)
    const trashed = transitionSongLibrary(before, {kind:'trash',ids:['a'],blank})
    assert.deepEqual(before, frozen)
    assert.deepEqual(trashed.setlists, before.setlists)
    assert.deepEqual(trashed.deleted, [{...song('a'),isDeleted:true}])
    validRoundtrip(trashed)
    const restored = transitionSongLibrary(trashed, {kind:'restore',ids:['a']})
    assert.equal(restored.active[0].id, 'a')
    assert.deepEqual(restored.setlists, before.setlists)
    for (const list of restored.setlists) for (const entry of list.songs) assert.ok(resolveSetlistSong(entry,restored.active))
    assert.deepEqual(restored.deleted, [])
    validRoundtrip(restored)
  })
}
test('bulk Trash matches sequential Trash including Restore positions', () => {
  const before=initial()
  const bulk=transitionSongLibrary(before,{kind:'trash',ids:['a','c'],blank})
  const single=transitionSongLibrary(transitionSongLibrary(before,{kind:'trash',ids:['a'],blank}),{kind:'trash',ids:['c'],blank})
  assert.deepEqual(bulk.setlists,single.setlists)
  assert.deepEqual(bulk.active,single.active)
  assert.deepEqual(bulk.deleted.map(s=>s.id).sort(),single.deleted.map(s=>s.id).sort())
  validRoundtrip(bulk)
  const restored=transitionSongLibrary(bulk,{kind:'restore',ids:['a','c']})
  assert.deepEqual(restored.setlists,lists)
  validRoundtrip(restored)
})
for(const kind of ['permanent','empty']) test(`${kind} removes only actual tombstone IDs from every setlist`,()=>{
  const before=transitionSongLibrary(initial(),{kind:'trash',ids:['a','c'],blank})
  const next=transitionSongLibrary(before,{kind,ids:['a','b','missing']})
  assert.deepEqual(next.setlists[0].songs.map(s=>s.id), kind==='empty'?['b']:['b','c'])
  assert.deepEqual(next.setlists[1].songs.map(s=>s.id), kind==='empty'?[]:['c'])
  assert.equal(next.setlists[1].isDeleted,true)
  assert.equal(next.setlists[0].createdAt,42)
  assert.deepEqual(next.active,before.active)
  validRoundtrip(next)
})
test('unknown missing refs survive lifecycle operations and strict validation rejects them',()=>{
  let state=initial();state.setlists[0].songs.push(ref('missing'))
  state=transitionSongLibrary(state,{kind:'trash',ids:['a'],blank})
  for(const op of [{kind:'permanent',ids:['a','missing']},{kind:'empty'}]) {
    const next=transitionSongLibrary(state,op)
    assert.equal(next.setlists[0].songs.at(-1).id,'missing')
    assert.throws(()=>validateLibrary(complete(next)),/damaged/)
  }
})
test('final single and bulk Trash retain valid blank replacement',()=>{
  for(const active of [[song('a')],[song('a'),song('b')]]) {
    const next=transitionSongLibrary({active,deleted:[],setlists:[{id:'s',name:'S',songs:active.map(s=>ref(s.id))}]},{kind:'trash',ids:active.map(s=>s.id),blank})
    assert.deepEqual(next.active,[blank]); assert.equal(next.deleted.length,active.length);validRoundtrip(next)
  }
})
test('retained tombstone valid; physically absent ID and genuine corruption invalid',()=>{
  const library={songs:[{...song('a'),isDeleted:true}],setlists:[lists[1]]}
  library.setlists=[{id:'s',name:'S',songs:[ref('a')]}]
  validateLibrary(library)
  for(const bad of [{...library,songs:[]},{...library,songs:[null]},{...library,songs:[song('a'),song('a')]}])assert.throws(()=>validateLibrary(bad),/damaged/)
})
test('prewrite rejection and storage failure preserve prior canonical bytes',()=>{
  const store=storage();persistLibrary(complete(initial()),store)
  const raw=store.getItem(LIBRARY_KEY)
  for(const bad of [{songs:[],setlists:lists},{songs:[null],setlists:[]},{songs:null,setlists:[]}]) {
    assert.throws(()=>persistLibrary(bad,store),/damaged/);assert.equal(store.getItem(LIBRARY_KEY),raw)
  }
  for(const message of ['quota','blocked']) {
    assert.throws(()=>persistLibrary({songs:[blank],setlists:[]},{...store,setItem(){throw Error(message)}}))
    assert.equal(store.getItem(LIBRARY_KEY),raw)
  }
})
const damaged=()=>({songs:[song('b')],setlists:structuredClone(lists),allowedUsers:['keep']})
test('repair preview exact entries; apply copies only approved refs, archives exact raw and retains metadata',()=>{
  const store=storage(), input=damaged(),raw=JSON.stringify(input,null,2);store.setItem(LIBRARY_KEY,raw)
  const plan=planDanglingReferenceRepair(store)
  assert.deepEqual(plan.references.map(r=>[r.setlistId,r.position,r.songId]),[['one',1,'a'],['one',2,'c'],['one',3,'a'],['two',0,'c'],['two',1,'a']])
  assert.equal(store.getItem(LIBRARY_KEY),raw);assert.equal(store.length,1)
  applyDanglingReferenceRepair(plan,store)
  const repaired=readPersistedLibrary(store)
  assert.deepEqual(repaired,{...input,setlists:input.setlists.map(list=>({...list,songs:list.songs.filter(r=>r.id==='b')}))})
  validateLibrary(repaired);assert.equal(planDanglingReferenceRepair(store),null)
  performStorageHousekeeping(store)
  const archive=Object.entries(recoveryData(store)).find(([k])=>k.startsWith('gtar_sync_recovery:dangling-references:'))
  assert.equal(archive[1],raw)
})
for(const [name,change] of [
 ['duplicate songs',l=>l.songs.push(song('b'))],['duplicate setlists',l=>l.setlists.push(structuredClone(l.setlists[0]))],
 ['malformed song',l=>l.songs.push(null)],['malformed list',l=>l.setlists[0].name=3],
 ['malformed missing ref',l=>l.setlists[0].songs.push({id:'absent'})],['invalid ref ID',l=>l.setlists[0].songs.push({id:null,title:'Bad'})],
 ['mixed top-level corruption',l=>l.allowedUsers=[5]],['malformed tombstone',l=>l.songs[0].isDeleted='yes']
])test(`repair refused: ${name}`,()=>{
 const store=storage(),input=damaged();change(input);const raw=JSON.stringify(input);store.setItem(LIBRARY_KEY,raw)
 assert.equal(planDanglingReferenceRepair(store),null);assert.equal(store.getItem(LIBRARY_KEY),raw)
 assert.equal(recoveryData(store)[LIBRARY_KEY],raw)
})
test('repair refuses stale or tampered preview with zero mutation',()=>{
 const store=storage();store.setItem(LIBRARY_KEY,JSON.stringify(damaged()));const plan=planDanglingReferenceRepair(store)
 assert.throws(()=>applyDanglingReferenceRepair({...plan,references:[]},store),/preview/);assert.equal(store.length,1)
 store.setItem(LIBRARY_KEY,plan.raw+' ');assert.throws(()=>applyDanglingReferenceRepair(plan,store),/changed/);assert.equal(store.length,1)
})
test('repair archive/storage failure cannot overwrite invalid input or lose original',()=>{
 const store=storage();store.setItem(LIBRARY_KEY,JSON.stringify(damaged()));const plan=planDanglingReferenceRepair(store)
 for(const failArchive of [true,false]){
 const blocked={...store,setItem(k,v){if(failArchive||k===LIBRARY_KEY)throw Error('blocked');store.setItem(k,v)}}
 assert.throws(()=>applyDanglingReferenceRepair(plan,blocked),/blocked/)
 assert.equal(store.getItem(LIBRARY_KEY),plan.raw)
 }
})
test('repair is local only; no network upload',()=>{
 const store=storage();store.setItem(LIBRARY_KEY,JSON.stringify(damaged()));const prior=global.fetch;let calls=0
 global.fetch=()=>{calls++;throw Error('network forbidden')}
 try{applyDanglingReferenceRepair(planDanglingReferenceRepair(store),store);assert.equal(calls,0)}finally{global.fetch=prior}
})
