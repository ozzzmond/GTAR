const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
const {createWakeLockController} = require('../src/utils/stagePerformance.ts')
test('late wake lock is released after cleanup; concurrent acquire calls share one request',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator')
  const oldDocument=global.document
  let resolve, requests=0, releases=0, removed=0
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{wakeLock:{request(){requests++;return new Promise(r=>{resolve=r})}}}})
  global.document={addEventListener(){},removeEventListener(){removed++}}
  try {
    const lock=createWakeLockController()
    const a=lock.acquire(),b=lock.acquire()
    assert.equal(requests,1)
    await lock.cleanup()
    resolve({released:false,async release(){releases++}})
    await Promise.all([a,b])
    assert.equal(releases,1);assert.equal(removed,1)
    await lock.acquire();assert.equal(requests,1)
  } finally {Object.defineProperty(globalThis,'navigator',descriptor);global.document=oldDocument}
})
