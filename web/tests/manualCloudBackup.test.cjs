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
 const {computeSongbookChecksum}=require('../src/utils/cloudSongbookSync.ts')
 const checksum=computeSongbookChecksum(library); const calls=[]
 global.fetch=async (_,opts)=>{ calls.push(opts); return new Response(JSON.stringify({success:true,cloudRecord:{version:2,checksum,updatedAt:'2026-11-01',data:library}})) }
 await writeCloudBackup({token:'token',userId:'B'},library,{version:1,checksum:'old'})
 assert.deepEqual(calls.map(c=>c.method),['POST','GET'])
 assert.equal(calls[0].headers['X-GTAR-Library-Owner'],'B')
 assert.equal(JSON.parse(calls[0].body).expectedVersion,1)
 assert.equal(JSON.stringify(library),bytes)
})
test('stale backup does not retry or merge', async()=>{
 let calls=0; global.fetch=async()=>{calls++;return new Response('{}',{status:409})}
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
