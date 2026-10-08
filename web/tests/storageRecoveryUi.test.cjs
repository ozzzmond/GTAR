const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs=require('node:fs'),ts=require('typescript')
for (const ext of ['.ts','.tsx']) require.extensions[ext]=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8').replaceAll('import.meta.env','({DEV:false})'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename)
require.extensions['.png']=module=>{module.exports='/logo.png'}
const {JSDOM}=require('jsdom')
const React=require('react'),{act}=React
const {createRoot}=require('react-dom/client')
test('damaged canonical library shows recovery export and preserves raw sources',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'})
  const prior={window:global.window,document:global.document,localStorage:global.localStorage,sessionStorage:global.sessionStorage,IS_REACT_ACT_ENVIRONMENT:global.IS_REACT_ACT_ENVIRONMENT}
  Object.assign(global,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true})
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL
  let blob,download
  URL.createObjectURL=value=>{blob=value;return 'blob:recovery'}
  URL.revokeObjectURL=()=>{}
  dom.window.HTMLAnchorElement.prototype.click=function(){download=this.download}
  localStorage.setItem('gtar_library_v1','{"songs":[null],"setlists":[]}')
  localStorage.setItem('gtar_sync_recovery:account:1','raw recovery')
  const raw=localStorage.getItem('gtar_library_v1')
  const root=createRoot(document.getElementById('root'))
  try {
    const App=require('../src/App.tsx').default
    await act(async()=>root.render(React.createElement(App)))
    assert.match(document.body.textContent,/Device library needs recovery/)
    await act(async()=>[...document.querySelectorAll('button')].find(x=>x.textContent==='Export recovery data').click())
    assert.equal(download,'GTAR-storage-recovery.json')
    const exported=JSON.parse(await blob.text())
    assert.equal(exported.gtar_library_v1,raw)
    assert.equal(exported['gtar_sync_recovery:account:1'],'raw recovery')
    assert.equal(localStorage.getItem('gtar_library_v1'),raw)
  } finally {await act(async()=>root.unmount());URL.createObjectURL=create;URL.revokeObjectURL=revoke;Object.assign(global,prior);dom.window.close()}
})

test('supported recovery preview/cancel has zero writes; explicit apply mounts app without cloud upload',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'})
  const prior={window:global.window,document:global.document,localStorage:global.localStorage,sessionStorage:global.sessionStorage,IS_REACT_ACT_ENVIRONMENT:global.IS_REACT_ACT_ENVIRONMENT,fetch:global.fetch}
  Object.assign(global,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true})
  window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
  window.requestAnimationFrame=fn=>setTimeout(fn,0)
  let uploads=0
  global.fetch=async(url,options)=>{
    if(String(url).includes('/songbook/sync')&&options?.method==='POST')uploads++
    return new Response('{}',{status:401,headers:{'content-type':'application/json'}})
  }
  const song={id:'11111111-1111-4111-8111-111111111111',title:'Kept Song',artist:'',key:'G',capo:'No Capo',bpm:'120',format:'CHORD_PRO',transposeOffset:0,rawContent:'{title: Kept Song}\n[G]kept'}
  const damaged={songs:[song],setlists:[{id:'22222222-2222-4222-8222-222222222222',name:'Affected Gig',songs:[{id:song.id,title:song.title},{id:'missing-id',title:'Missing Song'}]}]}
  const raw=JSON.stringify(damaged,null,2)
  localStorage.setItem('gtar_library_v1',raw)
  const root=createRoot(document.getElementById('root'))
  const click=async text=>act(async()=>{const button=[...document.querySelectorAll('button')].find(x=>x.textContent===text);assert.ok(button,text);button.click()})
  try{
    const App=require('../src/App.tsx').default
    await act(async()=>root.render(React.createElement(App)))
    assert.match(document.body.textContent,/Repair dangling setlist references/)
    const before=Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))
    await click('Preview')
    assert.match(document.body.textContent,/Affected Gig.*entry 2: Missing Song.*missing song ID missing-id/)
    await click('Cancel')
    assert.deepEqual(Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])),before)
    assert.equal(localStorage.getItem('gtar_library_v1'),raw)
    await click('Preview');await click('Apply Repair')
    assert.doesNotMatch(document.body.textContent,/Device library needs recovery/)
    assert.ok(document.querySelector('[data-testid="toggle-song-selection-mode"]'),'normal Songbook mounts')
    const repaired=JSON.parse(localStorage.getItem('gtar_library_v1'))
    assert.deepEqual(repaired.setlists[0].songs,[damaged.setlists[0].songs[0]])
    const archive=Object.keys(localStorage).find(k=>k.startsWith('gtar_sync_recovery:dangling-references:'))
    assert.equal(localStorage.getItem(archive),raw)
    assert.equal(uploads,0)
  }finally{await act(async()=>root.unmount());Object.assign(global,prior);dom.window.close()}
})

test('App lifecycle commits valid complete libraries and rejected persistence keeps React partitions',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'})
 const prior={window:global.window,document:global.document,localStorage:global.localStorage,sessionStorage:global.sessionStorage,IS_REACT_ACT_ENVIRONMENT:global.IS_REACT_ACT_ENVIRONMENT}
 Object.assign(global,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true})
 window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
 const modules=['SongbookHomeView','TrashView','Header'].map(name=>require(`../src/components/${name}.tsx`))
 const originals=modules.map((module,i)=>module[['SongbookHomeView','TrashView','Header'][i]])
 let home,trash,header
 modules[0].SongbookHomeView=props=>{home=props;return React.createElement('div',null,'Songbook mounted')}
 modules[1].TrashView=props=>{trash=props;return React.createElement('div',null,'Trash mounted')}
 modules[2].Header=props=>{header=props;return null}
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']
 const songs=ids.map((id,i)=>({id,title:`Song ${i}`,artist:'',key:'G',capo:'No Capo',bpm:'120',format:'CHORD_PRO',transposeOffset:0,rawContent:'[G]text'}))
 const setlists=[{id:'33333333-3333-4333-8333-333333333333',name:'Gig',songs:songs.map(s=>({id:s.id,title:s.title}))}]
 localStorage.setItem('gtar_library_v1',JSON.stringify({songs,setlists}))
 const root=createRoot(document.getElementById('root'))
 const {readPersistedLibrary}=require('../src/utils/syncJournal.ts')
 const valid=()=>{assert.doesNotMatch(document.body.textContent,/Device library needs recovery/);return readPersistedLibrary()}
 const actCall=async fn=>act(async()=>fn())
 const storageSet=window.Storage.prototype.setItem
 const originalTimeout=global.setTimeout, timers=new Set()
 global.setTimeout=(fn,delay,...args)=>{const timer=originalTimeout(fn,delay,...args);timers.add(timer);return timer}
 try{
  const App=require('../src/App.tsx').default
  await actCall(()=>root.render(React.createElement(App)))
  await actCall(()=>home.onDeleteSong(0))
  assert.deepEqual(valid().setlists,setlists)
  assert.equal(home.songs.length,1);assert.equal(header.deletedSongsCount,1)
  await actCall(()=>header.onViewChange('trash'))
  await actCall(()=>trash.onRestoreSong(ids[0]))
  assert.equal(valid().songs.find(s=>s.id===ids[0]).isDeleted,false)
  assert.deepEqual(valid().setlists,setlists)
  await actCall(()=>trash.onBackToSongbook())
  const raw=localStorage.getItem('gtar_library_v1')
  window.Storage.prototype.setItem=function(k,v){if(k==='gtar_library_v1')throw Error('blocked write');return storageSet.call(this,k,v)}
  await actCall(()=>home.onBulkDeleteSongs(ids))
  assert.equal(localStorage.getItem('gtar_library_v1'),raw)
  assert.equal(home.songs.length,2);assert.equal(header.deletedSongsCount,0)
  window.Storage.prototype.setItem=storageSet
  await actCall(()=>home.onBulkDeleteSongs(ids))
  assert.deepEqual(valid().setlists,setlists);assert.equal(header.deletedSongsCount,2)
  assert.equal(home.songs.length,1);assert.equal(home.songs[0].title,'New Song')
  await actCall(()=>header.onViewChange('trash'))
  await actCall(()=>trash.onPermanentDeleteSong(ids[0]))
  assert.deepEqual(valid().setlists[0].songs,[setlists[0].songs[1]])
  await actCall(()=>trash.onEmptyTrash())
  assert.deepEqual(valid().setlists[0].songs,[]);assert.equal(trash.deletedSongs.length,0)
 }finally{
  window.Storage.prototype.setItem=storageSet
  await actCall(()=>root.unmount())
  for(const timer of timers)clearTimeout(timer)
  global.setTimeout=originalTimeout
  modules.forEach((module,i)=>module[['SongbookHomeView','TrashView','Header'][i]]=originals[i])
  Object.assign(global,prior);dom.window.close()
 }
})
