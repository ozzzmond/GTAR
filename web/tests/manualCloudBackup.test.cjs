const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8').replaceAll('import.meta.env','({DEV:false})'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const { readCloudBackup, writeCloudBackup } = require('../src/utils/manualCloudBackup.ts')
test('signed out makes no cloud requests', async () => {
 global.fetch = () => { throw Error('network forbidden') }
 await assert.rejects(() => readCloudBackup({token:'',userId:''}), /Sign in/)
})
test('backup uses confirmed revision and verifies without modifying device', async () => {
 const library = {songs:[],setlists:[]}; const bytes=JSON.stringify(library)
 const {computeSongbookChecksum}=require('../src/utils/cloudBackupFormat.ts')
 const checksum=computeSongbookChecksum(library); const calls=[]
 global.fetch=async (_,opts)=>{ calls.push(opts); return new Response(JSON.stringify({success:true,cloudRecord:{version:2,checksum,updatedAt:'2026-11-01',data:library}})) }
 await writeCloudBackup({token:'token',userId:'B'},library,{version:1,checksum:'old'})
 assert.deepEqual(calls.map(c=>c.method),['POST','GET'])
 assert.equal(calls[0].headers['X-GTAR-Library-Owner'],'B')
 assert.equal(JSON.parse(calls[0].body).expectedVersion,1)
 assert.equal(JSON.stringify(library),bytes)
})
test('stale backup does not retry or merge', async()=>{
 let calls=0; global.fetch=async()=>{calls++;return new Response(JSON.stringify({code:'SONGBOOK_REVISION_CONFLICT'}),{status:409})}
 await assert.rejects(()=>writeCloudBackup({token:'t',userId:'B'},{songs:[],setlists:[]},null),/changed/)
 assert.equal(calls,1)
})
test('restore aborts before applying when safety snapshot cannot be saved',async()=>{
 const {restoreCloudBackup}=require('../src/utils/manualCloudBackup.ts');let applied=false
 const storage={getItem:()=>null,setItem:()=>{throw new DOMException('quota','QuotaExceededError')},removeItem:()=>{}}
 await assert.rejects(()=>restoreCloudBackup({songs:[],setlists:[]},{songs:[],setlists:[]},'replace',async()=>{applied=true},storage),/safety snapshot/)
 assert.equal(applied,false)
})
test('sign-out during POST prevents the verification GET',async()=>{
 let current=true,calls=0
 global.fetch=async()=>{calls++;current=false;return new Response(JSON.stringify({success:true}))}
 await assert.rejects(()=>writeCloudBackup({token:'t',userId:'B',isCurrent:()=>current},{songs:[],setlists:[]},null),/Sign in/)
 assert.equal(calls,1)
})

test('each successful file handoff records BackupSaved once without account data', async () => {
 const {appLogger}=require('../src/utils/logger.ts');appLogger.resume()
 const {downloadBackup,shareOrDownloadBackup,copyBackup}=require('../src/utils/backupExport.ts')
 const backup={json:'{}',fileName:'private@example.com-token.json',bytes:2,counts:{songs:2,trash:0,setlists:1},fingerprint:'secret',schemaVersion:2}
 for (const handoff of [()=>downloadBackup(backup,{download(){}}),()=>shareOrDownloadBackup(backup,{makeFile:()=>({}),navigator:{canShare:()=>true,share:async()=>{}}}),()=>copyBackup(backup,{navigator:{clipboard:{writeText:async()=>{}}}})]) {
  appLogger.clearLogs();await handoff()
  assert.deepEqual(appLogger.getLogs().filter(e=>e.tag==='BackupSaved').map(e=>e.message),['Backup saved (file): 2 songs, 1 setlists'])
 }
})

test('verified cloud backup and restore each record one count-only event', async () => {
 const {appLogger}=require('../src/utils/logger.ts');appLogger.resume();appLogger.clearLogs()
 const {restoreCloudBackup}=require('../src/utils/manualCloudBackup.ts')
 const {computeSongbookChecksum}=require('../src/utils/cloudBackupFormat.ts')
 const library={songs:[],setlists:[]};const checksum=computeSongbookChecksum(library)
 global.fetch=async()=>new Response(JSON.stringify({success:true,cloudRecord:{version:1,checksum,data:library}}))
 await writeCloudBackup({token:'secret-token',userId:'private@example.com'},library,null)
 const values=new Map([['gtar_library_v1',JSON.stringify(library)]])
 const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}
 for (const mode of ['merge','replace']) await restoreCloudBackup(library,library,mode,()=>{},storage)
 assert.deepEqual(appLogger.getLogs().filter(e=>['BackupSaved','RestoreApplied'].includes(e.tag)).map(e=>[e.tag,e.message]),[
  ['BackupSaved','Backup saved (cloud): 0 songs, 0 setlists'],
  ['RestoreApplied','Restore applied (merge, cloud): 0 songs, 0 setlists'],
  ['RestoreApplied','Restore applied (replace, cloud): 0 songs, 0 setlists'],
 ])
})
test('cloud restore verification rejects folders dropped by the apply callback',async()=>{
 const {restoreCloudBackup}=require('../src/utils/manualCloudBackup.ts')
 const {persistLibrary,readPersistedLibrary}=require('../src/utils/syncJournal.ts')
 const values=new Map();const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}
 const before={songs:[],setlists:[]}
 persistLibrary(before,storage)
 const incoming={songs:[],setlists:[],folders:[{id:'root',name:'Root',parentId:null},{id:'child',name:'Child',parentId:'root'}]}
 await assert.rejects(()=>restoreCloudBackup(readPersistedLibrary(storage),incoming,'replace',library=>persistLibrary({...library,folders:[]},storage),storage),/Restore could not be verified/)
})

const historical=require('./fixtures/cloudBackupLegacy.json')
for(const fixture of historical.fixtures)test(`historical cloud read: ${fixture.name}, unchanged payload and checksum`,async()=>{
 const record=structuredClone(fixture.record),before=JSON.stringify(record);let calls=0
 global.fetch=async()=>{calls++;return new Response(JSON.stringify({success:true,cloudRecord:record}))}
 const accepted=await readCloudBackup({token:'t',userId:'B'})
 assert.equal(JSON.stringify(accepted),before);assert.equal(calls,1)
})

const {SONGBOOK_CHECKSUM_SCHEME,computeSongbookChecksum}=require('../src/utils/cloudBackupFormat.ts')
test('explicit current scheme round trip; legacy-only matches cannot claim the current scheme',async()=>{
 const data={songs:[{id:'a',title:'A',rawContent:'[C]ok',tags:['#Praise','praise']}],setlists:[],checksumScheme:SONGBOOK_CHECKSUM_SCHEME}
 const record={version:2,checksum:computeSongbookChecksum(data),data}
 global.fetch=async()=>new Response(JSON.stringify({success:true,cloudRecord:record}))
 assert.deepEqual(await readCloudBackup({token:'t',userId:'B'}),record)
 record.data={...historical.fixtures[0].record.data,checksumScheme:SONGBOOK_CHECKSUM_SCHEME};record.checksum=historical.fixtures[0].record.checksum
 await assert.rejects(()=>readCloudBackup({token:'t',userId:'B'}),/verification failed/)
})
test('unknown schemes and tampered content fail closed without sensitive diagnostic data',async()=>{
 const {appLogger}=require('../src/utils/logger.ts');appLogger.resume()
 for(const kind of ['scheme','legacy-content','current-content']) {
  appLogger.clearLogs()
  const record=structuredClone(historical.fixtures[0].record)
  if(kind==='scheme')record.data.checksumScheme='private@example.com-secret-token'
  else if(kind==='current-content')record.checksum=computeSongbookChecksum(record.data)
  if(kind!=='scheme')record.data.songs[0].rawContent='tampered-secret-payload'
  global.fetch=async()=>new Response(JSON.stringify({success:true,cloudRecord:record}))
  await assert.rejects(()=>readCloudBackup({token:'secret-token',userId:'secret-account'}),/checksum/)
  const logs=appLogger.getLogs().filter(e=>e.tag==='CloudBackupFailure');assert.equal(logs.length,1);assert.equal(logs[0].level,'ERROR')
  const detail=JSON.parse(logs[0].message);assert.equal(detail.operation,'read');assert.equal(detail.stage,'verify');assert.equal(detail.httpStatus,200);assert.ok(detail.version);assert.ok(detail.build)
  assert.doesNotMatch(JSON.stringify(logs),/private@example|secret-token|secret-account|tampered-secret|ck_/)
 }
})
test('owner 409 is refused without CAS retry and logs one sanitized HTTP error',async()=>{
 const {appLogger}=require('../src/utils/logger.ts');appLogger.resume();appLogger.clearLogs();let calls=0
 global.fetch=async()=>{calls++;return new Response(JSON.stringify({code:'LIBRARY_OWNER_MISMATCH',error:'secret-account secret-token private@example.com'}),{status:409})}
 await assert.rejects(()=>writeCloudBackup({token:'secret-token',userId:'secret-account'},{songs:[],setlists:[]},null),/refused/)
 assert.equal(calls,1)
 const logs=appLogger.getLogs().filter(e=>e.tag==='CloudBackupFailure');assert.equal(logs.length,1);assert.equal(JSON.parse(logs[0].message).httpStatus,409)
 assert.doesNotMatch(JSON.stringify(logs),/secret-account|secret-token|private@example/)
})
test('no backup and mismatched or stale account reads never return another account data',async()=>{
 global.fetch=async()=>new Response(JSON.stringify({success:true,cloudRecord:null}))
 assert.equal(await readCloudBackup({token:'t',userId:'B'}),null)
 global.fetch=async()=>new Response(JSON.stringify({success:true,cloudRecord:{...historical.fixtures[0].record,userId:'A'}}))
 await assert.rejects(()=>readCloudBackup({token:'t',userId:'B'}),/account did not match/)
 let current=true,finish
 global.fetch=()=>new Promise(resolve=>{finish=resolve})
 const pending=readCloudBackup({token:'t',userId:'A',isCurrent:()=>current});current=false
 finish(new Response(JSON.stringify({success:true,cloudRecord:historical.fixtures[0].record})))
 await assert.rejects(()=>pending,/account changed/)
})
test('locale ordering keeps ASCII historical fixtures valid under en-US and sv-SE',async()=>{
 const original=String.prototype.localeCompare
 try {
  for(const locale of ['en-US','sv-SE']) {
   String.prototype.localeCompare=function(other){return original.call(this,other,locale)}
   for(const fixture of historical.fixtures) {
    global.fetch=async()=>new Response(JSON.stringify({success:true,cloudRecord:fixture.record}))
    assert.deepEqual(await readCloudBackup({token:'t',userId:'B'}),fixture.record)
   }
  }
 } finally {String.prototype.localeCompare=original}
})
