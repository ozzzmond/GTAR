const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const {fetchUg} = require('../functions/ugFetch.ts')
test('deadline covers stalled headers and stalled body even if mock ignores abort',async()=>{
  const previous = global.fetch
  try {
    global.fetch = () => new Promise(()=>{})
    await assert.rejects(fetchUg('https://example.test',{},20),{name:'TimeoutError'})
    let cancelled=false
    global.fetch=async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{})},cancel(){cancelled=true}}))
    await assert.rejects(fetchUg('https://example.test',{},20),{name:'TimeoutError'})
    assert.equal(cancelled,true)
  } finally {global.fetch=previous}
})
test('limits decoded stream bytes, rejects advertised oversize, accepts exact boundary and UTF-8 chunks',async()=>{
  const previous=global.fetch
  try {
    for (const advertised of [false,true]) {
      let cancelled=false
      global.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(9))},cancel(){cancelled=true}}),{headers:advertised?{'content-length':'9'}:{}})
      await assert.rejects(fetchUg('https://example.test',{},100,8),/size limit/)
      assert.equal(cancelled,true)
    }
    const bytes=new TextEncoder().encode('h?llo')
    global.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,2));c.enqueue(bytes.slice(2));c.close()}}))
    assert.deepEqual(await fetchUg('https://example.test',{},100,bytes.length),{status:200,html:'h?llo'})
  } finally {global.fetch=previous}
})
for (const endpoint of ['ug-search','ug-tab']) test(`${endpoint} returns timeout and oversize errors through handler`,async()=>{
  const previous=global.fetch, oldTimer=global.setTimeout
  const {onRequestGet}=require(`../functions/api/${endpoint}.ts`)
  const url=endpoint==='ug-search'?'https://local/api/ug-search?q=hello':'https://local/api/ug-tab?url='+encodeURIComponent('https://tabs.ultimate-guitar.com/tab/radiohead/creep-chords-4169')
  try {
    global.setTimeout=(fn,ms,...args)=>oldTimer(fn,ms===8000?20:ms,...args)
    global.fetch=async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{})}}))
    assert.equal((await onRequestGet({request:new Request(url)})).status,504)
    global.fetch=async()=>new Response(new Uint8Array(2*1024*1024+1))
    const response=await onRequestGet({request:new Request(url)})
    assert.equal(response.status,502)
    assert.match((await response.json()).error,/size limit/)
  } finally {global.fetch=previous;global.setTimeout=oldTimer}
})
