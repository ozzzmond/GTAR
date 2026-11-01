// #292/#299: manual cloud backup and restore in the Backup & Restore center (shared restore preview).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:true})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.gtar-web.pages.dev' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const auth = require('../src/utils/authContext.ts')
const { CloudSyncModal } = require('../src/components/CloudSyncModal.tsx')
const {computeSongbookChecksum}=require('../src/utils/cloudSongbookSync.ts')
const {persistLibrary,readPersistedLibrary}=require('../src/utils/syncJournal.ts')
const {expectedRestoredLibrary}=require('../src/utils/backupExport.ts')
const {getRestoreSafetySnapshot}=require('../src/utils/jsonBackup.ts')
const song=(id)=>({id,title:id,rawContent:'[C]Hello',artist:'A'})
const local={songs:[song('11111111-1111-4111-8111-111111111111')],setlists:[]}
const remote={songs:[song('22222222-2222-4222-8222-222222222222')],setlists:[]}
const click=async text=>act(async()=>{ const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(button,text);button.click();await new Promise(r=>setTimeout(r,5)) })
async function setup(signedIn=true){
 localStorage.clear();persistLibrary(local,localStorage)
 localStorage.setItem('gtar_library_owner_v1','owner-A-preserved');localStorage.setItem('gtar_sync_library_owner','owner-A-preserved')
 let record={version:1,checksum:computeSongbookChecksum(remote),updatedAt:'2026-11-01T00:00:00Z',data:remote};const calls=[]
 global.fetch=async(_,opts)=>{calls.push(opts.method);if(opts.method==='POST'){const body=JSON.parse(opts.body);record={...record,version:2,data:body.data,checksum:body.clientChecksum}};return new Response(JSON.stringify({success:true,cloudRecord:record}))}
 let signIns=0
 auth.useOptionalGoogleAuth=()=>({session:signedIn?{token:'t',user:{id:'B',email:'b@example.com'}}:null,accessStatus:'active',signIn:async()=>{signIns++}})
 const apply=mode=>async(songs,setlists)=>{assert.ok(getRestoreSafetySnapshot(localStorage),'snapshot before apply');persistLibrary(expectedRestoredLibrary(readPersistedLibrary(),{songs,setlists},mode),localStorage)}
 const root=createRoot(document.getElementById('root'))
 await act(async()=>{root.render(React.createElement(CloudSyncModal,{isOpen:true,onClose(){},onFullRestore:apply('replace'),onSmartMerge:apply('merge')}));await new Promise(r=>setTimeout(r,5))})
 return {calls,root,signIns:()=>signIns}
}
test('opening and device edits make no POST; backup confirms account and verifies unchanged device',async()=>{
 const {calls,root}=await setup();assert.deepEqual(calls,['GET'])
 persistLibrary({...local,songs:[...local.songs,song('33333333-3333-4333-8333-333333333333')]},localStorage)
 window.dispatchEvent(new window.Event('storage'));window.dispatchEvent(new window.Event('focus'))
 assert.deepEqual(calls,['GET'])
 await click('Back up to cloud');assert.match(document.body.textContent,/b@example.com/);assert.match(document.body.textContent,/overwrites/)
 const bytes=JSON.stringify(readPersistedLibrary());const storageBytes=JSON.stringify({...localStorage});await click('Confirm backup')
 assert.deepEqual(calls,['GET','GET','POST','GET']);assert.equal(JSON.stringify(readPersistedLibrary()),bytes);assert.equal(JSON.stringify({...localStorage}),storageBytes)
 await act(async()=>root.unmount())
})
for(const mode of ['replace','merge'])test(`restore ${mode}: cancel unchanged; snapshot before apply; no POST`,async()=>{
 const {calls,root}=await setup();const bytes=JSON.stringify(readPersistedLibrary())
 await click('Restore from cloud');assert.match(document.body.textContent,/Only on device: 1 songs/)
 await click('Cancel');assert.equal(JSON.stringify(readPersistedLibrary()),bytes);assert.equal(getRestoreSafetySnapshot(localStorage),null)
 await click('Restore from cloud')
 if(mode==='replace'){await click('Replace device');assert.match(document.body.textContent,/Replace device\?/);assert.equal(getRestoreSafetySnapshot(localStorage),null,'Replace device alone changes nothing');await click('Confirm replace')}
 else await click('Merge into device')
 assert.match(document.body.textContent,/Backup restored: 1 songs, 0 setlists \(verified after saving\)/)
 assert.equal(readPersistedLibrary().songs.length,mode==='replace'?1:2)
 assert.ok(calls.every(c=>c==='GET'))
 await act(async()=>root.unmount())
})
test('signed out displays explicit sign-in with no cloud request',async()=>{
 const {calls,root,signIns}=await setup(false);assert.deepEqual(calls,[])
 await click('Sign in to use cloud backup');assert.equal(signIns(),1);assert.deepEqual(calls,[])
 await act(async()=>root.unmount())
})
test('409 refreshes summary and requires a second confirmation; never merges',async()=>{
 const {calls,root}=await setup();await click('Back up to cloud')
 const bytes=localStorage.getItem('gtar_library_v2');let posts=0
 const changed={version:7,checksum:computeSongbookChecksum(remote),updatedAt:'2026-11-02T12:00:00Z',data:remote}
 global.fetch=async(_,opts)=>{calls.push(opts.method);if(opts.method==='POST'){posts++;return new Response('{}',{status:409})}return new Response(JSON.stringify({success:true,cloudRecord:changed}))}
 await click('Confirm backup');assert.equal(posts,1);assert.match(document.body.textContent,/confirm again/)
 assert.ok(![...document.querySelectorAll('button')].some(b=>b.textContent==='Confirm backup'))
 assert.equal(localStorage.getItem('gtar_library_v2'),bytes)
 await click('Back up to cloud');assert.match(document.body.textContent,/2026-11-02/);assert.equal(posts,1)
 await click('Cancel');assert.equal(posts,1)
 await act(async()=>root.unmount())
})
test('quota failure aborts restore with a clear message and unchanged device',async()=>{
 const {root,calls}=await setup();await click('Restore from cloud')
 const before=JSON.stringify(readPersistedLibrary());const original=window.Storage.prototype.setItem
 window.Storage.prototype.setItem=function(){throw new DOMException('Storage full','QuotaExceededError')}
 try{
  await click('Replace device');await click('Confirm replace')
  assert.match(document.body.textContent,/Restore aborted: safety snapshot failed/)
  assert.equal(JSON.stringify(readPersistedLibrary()),before)
  assert.ok(calls.every(method=>method==='GET'))
 }finally{window.Storage.prototype.setItem=original;await act(async()=>root.unmount())}
})
test('Header preserves an unsaved editor draft and blocks Restore until editor and cross-tab conflict are closed',async()=>{
 const initial=await setup();await act(async()=>initial.root.unmount())
 window.matchMedia=()=>({matches:false})
 const {Header}=require('../src/components/Header.tsx')
 const root=createRoot(document.getElementById('root'));let setView,setConflict;let restores=0
 const noop=()=>{}
 function Harness(){
  const [view,changeView]=React.useState('editor');setView=changeView
  const [conflict,changeConflict]=React.useState(false);setConflict=changeConflict
  const [draft,changeDraft]=React.useState('Unsaved [G]editor draft')
  return React.createElement(React.Fragment,null,
   React.createElement('textarea',{'aria-label':'Editor draft',value:draft,onChange:e=>changeDraft(e.target.value)}),
   React.createElement(Header,{activeView:view,song:local.songs[0],searchQuery:'',onViewChange:changeView,onSearchQueryChange:noop,onOpenWebsiteUrlSource:noop,onOpenStageTools:noop,onToggleTheme:noop,onOpenStageSettings:noop,onOpenImportModal:noop,
    autoSyncBlocked:view==='editor'||conflict,onCloudRestore:()=>{restores++;changeDraft('')},onCloudMerge:()=>{restores++;changeDraft('')}}))
 }
 try{
  await act(async()=>root.render(React.createElement(Harness)))
  await act(async()=>{document.querySelector('[data-testid="header-cloud-sync-button"]').click();await new Promise(r=>setTimeout(r,5))})
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
  assert.equal(button('Restore from cloud').disabled,true)
  assert.equal(button('Restore from file').disabled,true,'file restore is blocked in the editor too')
  assert.match(document.body.textContent,/Close the editor \(save or discard your changes\) before restoring\./)
  await click('Restore from cloud')
  assert.equal(restores,0);assert.equal(document.querySelector('textarea').value,'Unsaved [G]editor draft')
  assert.equal(button('Back up to cloud').disabled,false)
  await click('Back up to cloud');assert.ok(button('Confirm backup'));await click('Cancel')
  await act(async()=>{setView('songbook');setConflict(true)})
  assert.equal(button('Restore from cloud').disabled,true)
  await act(async()=>setConflict(false))
  assert.equal(button('Restore from cloud').disabled,false)
  assert.equal(button('Restore from file').disabled,false)
  assert.equal(document.querySelector('textarea').value,'Unsaved [G]editor draft');assert.equal(restores,0)
 }finally{await act(async()=>root.unmount())}
})

test('#299 cloud and file restores use the same preview, words and default (Merge)',async()=>{
 const {root}=await setup()
 const previewWords=()=>{
  const preview=document.querySelector('[data-testid="restore-preview"]');assert.ok(preview)
  const labels=[...preview.querySelectorAll('button')].map(b=>b.textContent)
  const text=preview.textContent.replace(/(Cloud backup|Backup file): [^O]*/,'SOURCE ')
  return {labels,text,primary:[...preview.querySelectorAll('button')].find(b=>b.className.includes('bg-app-action')).textContent}
 }
 await click('Restore from cloud');const cloud=previewWords();await click('Cancel')
 const input=document.querySelector('[data-testid="restore-file-input"]')
 Object.defineProperty(input,'files',{configurable:true,value:[{text:async()=>JSON.stringify(remote)}]})
 await click('Restore from file');await act(async()=>{input.dispatchEvent(new window.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,5))})
 const file=previewWords()
 assert.deepEqual(file.labels.filter(l=>!/^Also/.test(l)),cloud.labels);assert.deepEqual(cloud.labels,['Merge into device','Replace device','Cancel'])
 assert.equal(cloud.primary,'Merge into device');assert.equal(file.primary,'Merge into device')
 for(const words of [/This device: 1 songs/,/Only on device: 1 songs, 0 setlists/,/Only in backup: 1 songs, 0 setlists/,/A verified local safety snapshot is saved first\. Merge into device: Adds and updates songs; deletes nothing\./]){assert.match(cloud.text,words);assert.match(file.text,words)}
 assert.match(file.text,/Also restore appearance/);assert.match(file.text,/Also restore preferences/)
 // #303: the cloud backup states only its save time; no app version or format is invented.
 assert.match(cloud.text,/Backup made · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);assert.doesNotMatch(cloud.text,/with GTAR|format v/)
 await act(async()=>root.unmount())
})
test('#299 signed out: file backup and restore work end to end through the center',async()=>{
 const {root,calls}=await setup(false)
 const downloads=[];const create=URL.createObjectURL,revoke=URL.revokeObjectURL,anchor=window.HTMLAnchorElement.prototype.click
 URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:backup'};URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=function(){}
 try{
  await click('Download .json');assert.equal(downloads.length,1);assert.match(document.body.textContent,/Backup file verified \(1 songs, 0 setlists, 0 in trash/)
  const json=await downloads[0].text();assert.equal(JSON.parse(json).songs[0].id,local.songs[0].id)
  // Restore a backup file made on another device: merge keeps both songs.
  const input=document.querySelector('[data-testid="restore-file-input"]')
  Object.defineProperty(input,'files',{configurable:true,value:[{text:async()=>JSON.stringify(remote)}]})
  await click('Restore from file');await act(async()=>{input.dispatchEvent(new window.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,5))})
  await click('Merge into device')
  assert.match(document.body.textContent,/Backup restored: 1 songs, 0 setlists \(verified after saving\)/)
  assert.equal(readPersistedLibrary().songs.length,2);assert.ok(getRestoreSafetySnapshot(localStorage),'snapshot first')
  assert.deepEqual(calls,[],'no cloud request signed out')
 }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;window.HTMLAnchorElement.prototype.click=anchor;await act(async()=>root.unmount())}
})
