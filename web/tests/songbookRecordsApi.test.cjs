const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8').replaceAll('import.meta.env','({DEV:false})'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f)
const api=require('../functions/api/songbook/records.ts')
for(const host of ['dev.gtar-web.pages.dev','example.com']) for(const method of ['Get','Post']) test(`records ${method} disabled on ${host} even with flag`,async()=>{
 const result=await api[`onRequest${method}`]({request:new Request(`https://${host}/api/songbook/records`,{method:method.toUpperCase()}),env:{SONGBOOK_RECORDS_SYNC:'records-v1',DB:{prepare(){throw Error('DB must stay inert')}}}})
 assert.equal(result.status,404);assert.equal((await result.json()).code,'RECORDS_SYNC_DISABLED')
})
