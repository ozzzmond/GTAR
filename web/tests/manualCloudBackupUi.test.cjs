// #292/#299: manual cloud backup and restore in the Backup & Restore center (shared restore preview).
const { test, after } = require('node:test')
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
const globalKeys = ['window', 'document', 'localStorage', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT', 'navigator', 'fetch']
const originalGlobals = new Map(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]))
// Always runs, even after a failed assertion: close the JSDOM window and restore globals so no handle stays open.
after(() => {
 dom.window.close()
 for (const [key, descriptor] of originalGlobals) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key] }
})
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const auth = require('../src/utils/authContext.ts')
const { CloudSyncModal } = require('../src/components/CloudSyncModal.tsx')
const { computeSongbookChecksum } = require('../src/utils/cloudBackupFormat.ts')
const {persistLibrary,readPersistedLibrary}=require('../src/utils/syncJournal.ts')
const {expectedRestoredLibrary}=require('../src/utils/backupExport.ts')
const {getRestoreSafetySnapshot}=require('../src/utils/jsonBackup.ts')
const {STORAGE_KEY:DEBUG_LOG_KEY}=require('../src/utils/logger.ts')
const song=(id)=>({id,title:id,rawContent:'[C]Hello',artist:'A'})
const local={songs:[song('11111111-1111-4111-8111-111111111111')],setlists:[]}
const remote={songs:[song('22222222-2222-4222-8222-222222222222')],setlists:[]}
const click=async text=>act(async()=>{ const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(button,text);button.click();await new Promise(r=>setTimeout(r,5)) })
async function setup(signedIn=true,{device=local,cloudLibrary=remote}={}){
 localStorage.clear();persistLibrary(device,localStorage)
 localStorage.setItem('gtar_library_owner_v1','owner-A-preserved');localStorage.setItem('gtar_sync_library_owner','owner-A-preserved')
 let record={version:1,checksum:computeSongbookChecksum(cloudLibrary),updatedAt:'2026-11-01T00:00:00Z',data:cloudLibrary};const calls=[],uploads=[],folderArgs=[]
 global.fetch=async(_,opts)=>{calls.push(opts.method);if(opts.method==='POST'){const body=JSON.parse(opts.body);uploads.push(body);record={...record,version:2,data:body.data,checksum:body.clientChecksum}};return new Response(JSON.stringify({success:true,cloudRecord:record}))}
 let signIns=0
 auth.useOptionalGoogleAuth=()=>({session:signedIn?{token:'t',user:{id:'B',email:'b@example.com'}}:null,accessStatus:'active',signIn:async()=>{signIns++}})
 const apply=mode=>async(songs,setlists,folders)=>{folderArgs.push(folders);assert.ok(getRestoreSafetySnapshot(localStorage),'snapshot before apply');persistLibrary(expectedRestoredLibrary(readPersistedLibrary(),{songs,setlists,folders},mode),localStorage)}
 const root=createRoot(document.getElementById('root'))
 await act(async()=>{root.render(React.createElement(CloudSyncModal,{isOpen:true,onClose(){},onFullRestore:apply('replace'),onSmartMerge:apply('merge')}));await new Promise(r=>setTimeout(r,5))})
 return {calls,uploads,folderArgs,root,signIns:()=>signIns}
}

for(const mode of ['replace','merge']) for(const appearance of [true,false]) for(const preferences of [true,false])
test(`cloud settings preview/cancel/confirm: ${mode}, appearance=${appearance}, preferences=${preferences}`,async()=>{
 const settings={appearance:{themeMode:'paper-light',stageSettings:{fontSizePx:32},tvFontSize:40},preferences:{songbookSort:'artist'}}
 const data={...remote,settings,settingsSchemaVersion:2,checksumScheme:'gtar-backup-settings-v2'}
 const {root}=await setup(true,{cloudLibrary:data})
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_n,_o,fn)=>fn({})}})
 localStorage.setItem('gtar_theme_store','oled-black');localStorage.setItem('gtar_tv_font_size','28');localStorage.setItem('gtar_songbook_sort','title')
 const before=JSON.stringify({...localStorage})
 try {
  await click('Restore from cloud')
  const preview=document.querySelector('[data-testid="restore-preview"]')
  assert.match(preview.textContent,/3 appearance and 1 preference settings/)
  assert.match(preview.textContent,/theme, colours, stage and TV text/)
  assert.match(preview.textContent,/2026-11-01/)
  const boxes=[...preview.querySelectorAll('input[type="checkbox"]')]
  assert.deepEqual(boxes.map(b=>b.checked),[true,true],'full restore defaults include both groups')
  await click('Cancel');assert.equal(JSON.stringify({...localStorage}),before)
  await click('Restore from cloud')
  await act(async()=>{
   const inputs=document.querySelector('[data-testid="restore-preview"]').querySelectorAll('input[type="checkbox"]')
   if(!appearance)inputs[0].click()
   if(!preferences)inputs[1].click()
  })
  if(mode==='replace'){await click('Replace device');assert.equal(localStorage.getItem('gtar_tv_font_size'),'28');await click('Confirm replace')}
  else await click('Merge into device')
  assert.match(document.body.textContent,/Backup restored: .*verified after saving/)
  assert.equal(localStorage.getItem('gtar_theme_store'),appearance?'paper-light':'oled-black')
  assert.equal(localStorage.getItem('gtar_tv_font_size'),appearance?'40':'28')
  assert.equal(localStorage.getItem('gtar_songbook_sort'),preferences?'artist':'title')
 }finally{delete navigator.locks;await act(async()=>root.unmount())}
})

for(const operation of ['backup','restore'])test(`settings-only edits invalidate ${operation} consent`,async()=>{
 const {root,uploads}=await setup()
 try {
  await click(operation==='backup'?'Back up to cloud':'Restore from cloud')
  const library=JSON.stringify(readPersistedLibrary())
  localStorage.setItem('gtar_tv_font_size','44')
  if(operation==='backup')await click('Confirm backup')
  else {await click('Replace device');await click('Confirm replace')}
  assert.match(document.body.textContent,/Device library or settings changed/)
  assert.equal(uploads.length,0);assert.equal(JSON.stringify(readPersistedLibrary()),library)
  assert.equal(localStorage.getItem('gtar_tv_font_size'),'44')
  assert.equal(getRestoreSafetySnapshot(localStorage),null)
 }finally{await act(async()=>root.unmount())}
})

test('another tab changing account invalidates the settings preview and prevents restore',async()=>{
 const {root}=await setup()
 try {
  await click('Restore from cloud')
  const bytes=JSON.stringify({...localStorage})
  await act(async()=>window.dispatchEvent(new window.StorageEvent('storage',{key:'gtar_auth_session',newValue:'changed'})))
  assert.equal(document.querySelector('[data-testid="restore-preview"]'),null)
  assert.equal(document.querySelector('[data-testid="cloud-restore-button"]').disabled,true)
  assert.equal(JSON.stringify({...localStorage}),bytes)
 }finally{await act(async()=>root.unmount())}
})

test('cloud revision changed after preview requires fresh consent before device mutation',async()=>{
 const {root}=await setup()
 try {
  await click('Restore from cloud')
  const bytes=JSON.stringify(readPersistedLibrary())
  const data={...remote,settingsSchemaVersion:2,checksumScheme:'gtar-backup-settings-v2',settings:{appearance:{tvFontSize:44},preferences:{}}}
  global.fetch=async()=>new Response(JSON.stringify({success:true,cloudRecord:{version:2,checksum:computeSongbookChecksum(data),data}}))
  await click('Replace device');await click('Confirm replace')
  assert.match(document.body.textContent,/Cloud backup changed/)
  assert.equal(JSON.stringify(readPersistedLibrary()),bytes)
  assert.equal(localStorage.getItem('gtar_tv_font_size'),null)
  assert.equal(getRestoreSafetySnapshot(localStorage),null)
 }finally{await act(async()=>root.unmount())}
})
test('opening and device edits make no POST; backup confirms account and verifies unchanged device',async()=>{
 const {calls,root}=await setup()
 try{
  assert.deepEqual(calls,['GET'])
  await act(async()=>{persistLibrary({...local,songs:[...local.songs,song('33333333-3333-4333-8333-333333333333')]},localStorage);window.dispatchEvent(new window.Event('storage'));window.dispatchEvent(new window.Event('focus'))})
  assert.deepEqual(calls,['GET'])
  await click('Back up to cloud');assert.match(document.body.textContent,/b@example.com/);assert.match(document.body.textContent,/overwrites/)
  // Only the debug-log key (logger STORAGE_KEY) may change; every other key stays byte-identical.
  const withoutDebugLogs=()=>{const all={...localStorage};delete all[DEBUG_LOG_KEY];return JSON.stringify(all)}
  const bytes=JSON.stringify(readPersistedLibrary());const storageBytes=withoutDebugLogs();await click('Confirm backup')
  assert.deepEqual(calls,['GET','GET','POST','GET']);assert.equal(JSON.stringify(readPersistedLibrary()),bytes);assert.equal(withoutDebugLogs(),storageBytes)
  assert.ok(JSON.parse(localStorage.getItem(DEBUG_LOG_KEY)??'[]').some(entry=>entry.tag==='BackupSaved'),'BackupSaved logged')
 }finally{await act(async()=>root.unmount())}
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
 global.fetch=async(_,opts)=>{calls.push(opts.method);if(opts.method==='POST'){posts++;return new Response(JSON.stringify({code:'SONGBOOK_REVISION_CONFLICT'}),{status:409})}return new Response(JSON.stringify({success:true,cloudRecord:changed}))}
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

const nestedFolders=[{id:'root-folder',name:'Root',parentId:null},{id:'child-folder',name:'Child',parentId:'root-folder'}]
const folderCloud={...remote,folders:nestedFolders,setlists:[{id:'folder-set',name:'Filed set',folderId:'child-folder',songs:[{id:remote.songs[0].id,title:remote.songs[0].title}]}]}
for(const mode of ['replace','merge'])test(`cloud ${mode} carries two nested folders through the apply callback and saved verification`,async()=>{
 const device={...local,folders:[{id:'local-folder',name:'Local',parentId:null}]}
 const {root,folderArgs}=await setup(true,{device,cloudLibrary:folderCloud})
 try {
  await click('Restore from cloud')
  if(mode==='replace'){await click('Replace device');await click('Confirm replace')}else await click('Merge into device')
  assert.deepEqual(folderArgs,[nestedFolders],'apply must receive parsed folders')
  const saved=readPersistedLibrary()
  assert.deepEqual(saved.folders,mode==='replace'?nestedFolders:[...device.folders,...nestedFolders])
  assert.equal(saved.setlists[0].folderId,'child-folder')
  assert.match(document.body.textContent,/Backup restored: .*verified after saving/)
 }finally{await act(async()=>root.unmount())}
})
test('cloud upload payload carries device folders and setlist folder placement',async()=>{
 const {root,uploads}=await setup(true,{device:folderCloud})
 try{
  await click('Back up to cloud');await click('Confirm backup')
  assert.deepEqual(uploads[0].data.folders,nestedFolders)
  assert.equal(uploads[0].data.setlists[0].folderId,'child-folder')
 }finally{await act(async()=>root.unmount())}
})

test('failed initial read exits loading, disables restore and permits a safe retry',async()=>{
 const {root}=await setup()
 try {
  global.fetch=async()=>new Response(JSON.stringify({success:false,error:'private server message'}),{status:500})
  await act(async()=>{root.render(React.createElement(CloudSyncModal,{isOpen:false,onClose(){}}))})
  await act(async()=>{root.render(React.createElement(CloudSyncModal,{isOpen:true,onClose(){}}));await new Promise(r=>setTimeout(r,5))})
  assert.doesNotMatch(document.body.textContent,/Reading cloud backup/)
  assert.equal(document.querySelector('[data-testid="cloud-restore-button"]').disabled,true)
  assert.doesNotMatch(document.body.textContent,/private server message/)
  global.fetch=async()=>new Response(JSON.stringify({success:true,cloudRecord:null}))
  await click('Retry cloud read')
  assert.match(document.body.textContent,/No cloud backup yet/)
  assert.equal(document.querySelector('[data-testid="cloud-backup-button"]').disabled,false)
 } finally {await act(async()=>root.unmount())}
})

test('account switch discards pending A read, clears metadata and leaves device data unchanged',async()=>{
 const {root}=await setup();const deviceBefore=JSON.stringify(readPersistedLibrary());let finishA
 let current='A'
 auth.useOptionalGoogleAuth=()=>({session:{token:current,user:{id:current,email:`${current}@example.com`}},accessStatus:'active'})
 global.fetch=async(_,options)=>{
  if(options.headers.Authorization==='Bearer A')return new Promise(resolve=>{finishA=resolve})
  return new Response(JSON.stringify({success:true,cloudRecord:null}))
 }
 const props={isOpen:true,onClose(){}}
 try {
  await act(async()=>{root.render(React.createElement(CloudSyncModal,props));await new Promise(r=>setTimeout(r,5))})
  current='B'
  await act(async()=>{root.render(React.createElement(CloudSyncModal,props));await new Promise(r=>setTimeout(r,5))})
  assert.match(document.body.textContent,/No cloud backup yet/)
  await act(async()=>{finishA(new Response(JSON.stringify({success:true,cloudRecord:{version:1,updatedAt:'1999-01-01',checksum:computeSongbookChecksum(remote),data:remote}})));await new Promise(r=>setTimeout(r,5))})
  assert.doesNotMatch(document.body.textContent,/1999|Reading cloud backup|account changed/)
  assert.equal(document.querySelector('[data-testid="cloud-backup-button"]').disabled,false)
  assert.equal(document.querySelector('[data-testid="cloud-restore-button"]').disabled,true)
  assert.equal(JSON.stringify(readPersistedLibrary()),deviceBefore)
 } finally {await act(async()=>root.unmount())}
})
test('switching account during POST releases busy state and ignores the old result',async()=>{
 const {root}=await setup();let finishPost,posts=0;const deviceBefore=JSON.stringify(readPersistedLibrary())
 try {
  await click('Back up to cloud')
  global.fetch=async(_,options)=>{if(options.method==='POST'){posts++;return new Promise(resolve=>{finishPost=resolve})}return new Response(JSON.stringify({success:true,cloudRecord:null}))}
  await click('Confirm backup')
  assert.equal(posts,1)
  auth.useOptionalGoogleAuth=()=>({session:{token:'new-session',user:{id:'C',email:'c@example.com'}},accessStatus:'active'})
  await act(async()=>{root.render(React.createElement(CloudSyncModal,{isOpen:true,onClose(){}}));await new Promise(r=>setTimeout(r,5))})
  await act(async()=>{finishPost(new Response(JSON.stringify({success:true})));await new Promise(r=>setTimeout(r,5))})
  assert.doesNotMatch(document.body.textContent,/Cloud backup saved|account changed|Reading cloud backup/)
  assert.equal(document.querySelector('[data-testid="cloud-backup-button"]').disabled,false)
  assert.equal(document.querySelector('[data-testid="cloud-sync-close-button"]').disabled,false)
  assert.equal(JSON.stringify(readPersistedLibrary()),deviceBefore)
 } finally {await act(async()=>root.unmount())}
})

test('integrity failure never enables restore or posts; one sanitized modal ERROR then retry',async()=>{
 const {root,calls}=await setup();const {appLogger}=require('../src/utils/logger.ts');appLogger.clearLogs()
 try {
  global.fetch=async()=>new Response(JSON.stringify({success:true,cloudRecord:{version:1,checksum:'ck_0000000000000000',data:remote}}))
  await click('Restore from cloud')
  assert.equal(document.querySelector('[data-testid="cloud-restore-button"]').disabled,true)
  assert.match(document.body.textContent,/checksum verification failed/)
  assert.doesNotMatch(document.body.textContent,/Reading cloud backup/)
  assert.equal(appLogger.getLogs().filter(e=>e.tag==='CloudBackupFailure').length,1)
  assert.ok(calls.every(method=>method==='GET'))
  await click('Retry cloud read')
  assert.equal(document.querySelector('[data-testid="cloud-restore-button"]').disabled,true)
  assert.equal(appLogger.getLogs().filter(e=>e.tag==='CloudBackupFailure').length,2)
 } finally {await act(async()=>root.unmount())}
})

// #368: exercise parity through the real Header -> verified modal response -> badge.
async function badgeSetup({legacy=false}={}) {
 const initial=await setup(true,{device:local});await act(async()=>initial.root.unmount())
 window.matchMedia=()=>({matches:false})
 const {captureCloudBackup}=require('../src/utils/manualCloudBackup.ts')
 const data=legacy?readPersistedLibrary():captureCloudBackup(readPersistedLibrary())
 const record={userId:'B',version:1,updatedAt:'2026-11-05T00:00:00Z',data,checksum:computeSongbookChecksum(data)}
 global.fetch=async()=>new Response(JSON.stringify({success:true,cloudRecord:record}))
 const {Header}=require('../src/components/Header.tsx')
 const root=createRoot(document.getElementById('root'));const noop=()=>{}
 const props={activeView:'songbook',song:local.songs[0],searchQuery:'',onViewChange:noop,onSearchQueryChange:noop,
  onOpenWebsiteUrlSource:noop,onOpenStageTools:noop,onToggleTheme:noop,onOpenStageSettings:noop,onOpenImportModal:noop}
 const render=async()=>act(async()=>root.render(React.createElement(Header,props)))
 const badge=()=>document.querySelector('[data-testid="header-cloud-sync-button"]')
 const open=async()=>act(async()=>{badge().click();await new Promise(r=>setTimeout(r,5))})
 const close=async()=>act(async()=>document.querySelector('[data-testid="cloud-sync-close-button"]').click())
 await render()
 return {root,render,badge,open,close,record}
}

test('#368 verified matching settings-v2 backup reports Backed up through Header',async()=>{
 const h=await badgeSetup()
 try {
  await h.open()
  assert.equal(h.badge().dataset.status,'backed-up')
  assert.match(h.badge().getAttribute('aria-label'),/Backed up/)
  assert.equal(h.badge().getAttribute('title'),h.badge().getAttribute('aria-label'))
  assert.equal(h.badge().textContent,'','icon-only layout retained')
 } finally {await act(async()=>h.root.unmount())}
})


test('#368 signed-out, unknown cached metadata and verified missing backup stay distinct',async()=>{
 const h=await badgeSetup()
 try {
  localStorage.setItem('gtar_manual_cloud_backup_dates',JSON.stringify({B:h.record.updatedAt}))
  localStorage.setItem('gtar_manual_cloud_backup_checksums',JSON.stringify({B:h.record.checksum}))
  await h.render()
  assert.equal(h.badge().dataset.status,'unknown','cached presence cannot confirm parity')
  assert.match(h.badge().title,/Backup status unknown/)
  assert.doesNotMatch(h.badge().title,/No cloud backup yet/)
  global.fetch=async()=>new Response(JSON.stringify({success:true,cloudRecord:null}))
  await h.open()
  assert.equal(h.badge().dataset.status,'no-backup')
  assert.match(h.badge().title,/No cloud backup/)
  await h.close()
  auth.useOptionalGoogleAuth=()=>({session:null,accessStatus:'active'})
  await h.render()
  assert.equal(h.badge().dataset.status,'signed-out')
  assert.match(h.badge().title,/Not signed in/)
 } finally {await act(async()=>h.root.unmount())}
})

test('#368 persisted song, setlist, trash, folder and tag-colour changes invalidate settings-v2 parity',async()=>{
 const h=await badgeSetup()
 try {
  await h.open();await h.close()
  const original=readPersistedLibrary()
  const mutations=[
   {...original,songs:[{...original.songs[0],rawContent:'changed'}]},
   {...original,setlists:[{id:'new-set',name:'New set',songs:[]}]},
   {...original,songs:[{...original.songs[0],isDeleted:true}]},
   {...original,folders:[{id:'folder',name:'Folder',parentId:null}]},
   {...original,tagColors:{worship:'#123456'}},
  ]
  for(const changed of mutations){
   await act(async()=>persistLibrary(changed,localStorage))
   assert.equal(h.badge().dataset.status,'not-backed-up')
   await act(async()=>persistLibrary(original,localStorage))
   assert.equal(h.badge().dataset.status,'backed-up')
  }
 } finally {await act(async()=>h.root.unmount())}
})

test('#368 settings-only changes refresh on notification and Backup center close without a storage event',async()=>{
 const h=await badgeSetup()
 const {SETTINGS_CHANGED}=require('../src/utils/backupSettings.ts')
 try {
  await h.open();await h.close()
  await act(async()=>{localStorage.setItem('gtar_tv_font_size','44');window.dispatchEvent(new window.Event(SETTINGS_CHANGED))})
  assert.equal(h.badge().dataset.status,'not-backed-up')
  await act(async()=>{localStorage.removeItem('gtar_tv_font_size');window.dispatchEvent(new window.Event(SETTINGS_CHANGED))})
  assert.equal(h.badge().dataset.status,'backed-up')
  await h.open()
  localStorage.setItem('gtar_songbook_sort','artist')
  await h.close()
  assert.equal(h.badge().dataset.status,'not-backed-up','close re-reads old same-tab settings writers')
  await act(async()=>{localStorage.removeItem('gtar_songbook_sort');window.dispatchEvent(new window.StorageEvent('storage',{key:'gtar_songbook_sort'}))})
  assert.equal(h.badge().dataset.status,'backed-up')
 } finally {await act(async()=>h.root.unmount())}
})

test('#368 verified legacy checksum remains compatible and detects library changes',async()=>{
 const h=await badgeSetup({legacy:true})
 try {
  await h.open();await h.close()
  assert.equal(h.badge().dataset.status,'backed-up')
  await act(async()=>persistLibrary({...local,songs:[{...local.songs[0],title:'Changed title'}]},localStorage))
  assert.equal(h.badge().dataset.status,'not-backed-up')
 } finally {await act(async()=>h.root.unmount())}
})

test('#368 A -> B -> A and logout reject delayed proof from every former session',async()=>{
 const h=await badgeSetup();let account='A';const pending=[]
 auth.useOptionalGoogleAuth=()=>({session:account?{token:account,user:{id:account,email:`${account}@example.com`}}:null,accessStatus:'active'})
 global.fetch=async()=>new Promise(resolve=>pending.push(resolve))
 const response=id=>new Response(JSON.stringify({success:true,cloudRecord:{...h.record,userId:id}}))
 try {
  await h.render();await h.open()
  account='B';await h.render()
  account='A';await h.render()
  assert.equal(pending.length,3)
  await act(async()=>{pending[0](response('A'));pending[1](response('B'));await new Promise(r=>setTimeout(r,5))})
  assert.equal(h.badge().dataset.status,'unknown','old A cannot become current after A -> B -> A')
  await act(async()=>{pending[2](response('A'));await new Promise(r=>setTimeout(r,5))})
  assert.equal(h.badge().dataset.status,'backed-up')
  await h.close();await h.open()
  account='';await h.render()
  await act(async()=>{pending[3](response('A'));await new Promise(r=>setTimeout(r,5))})
  assert.equal(h.badge().dataset.status,'signed-out')
  account='A';await h.render()
  assert.equal(h.badge().dataset.status,'unknown','returning account needs new verification')
 } finally {await act(async()=>h.root.unmount())}
})

test('#368 failed revalidation and cache/session invalidation never leave confirmed parity',async()=>{
 const h=await badgeSetup()
 try {
  await h.open();await h.close()
  assert.equal(h.badge().dataset.status,'backed-up')
  await act(async()=>window.dispatchEvent(new window.StorageEvent('storage',{key:'gtar_manual_cloud_backup_checksums'})))
  assert.equal(h.badge().dataset.status,'unknown')
  await h.open();await h.close()
  assert.equal(h.badge().dataset.status,'backed-up')
  global.fetch=async()=>new Response(JSON.stringify({success:false}),{status:500})
  await h.open()
  assert.equal(h.badge().dataset.status,'unknown')
  global.fetch=async()=>new Response(JSON.stringify({success:true,cloudRecord:h.record}))
  await click('Retry cloud read')
  assert.equal(h.badge().dataset.status,'backed-up')
  await act(async()=>window.dispatchEvent(new window.StorageEvent('storage',{key:'gtar_auth_session'})))
  assert.equal(h.badge().dataset.status,'unknown')
 } finally {await act(async()=>h.root.unmount())}
})
