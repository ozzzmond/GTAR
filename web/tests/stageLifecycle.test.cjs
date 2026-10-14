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
test('Band Sync preserves scheme, port, IPv6 and path through connect, reconnect and history',()=>{
  const {bandSync,formatLeaderAddress,getRecentLeaders}=require('../src/utils/bandSync.ts')
  const oldWindow=global.window,oldSocket=global.WebSocket,oldStorage=global.localStorage
  const values=new Map(),urls=[]
  global.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}
  global.window={location:{hostname:'localhost'},setTimeout(){return 1},setInterval(){return 1},clearInterval(){}}
  global.WebSocket=class {constructor(url){urls.push(url)}close(){}send(){}}
  try {
    for (const [input,expected] of [['wss://example.com:9443/stage','wss://example.com:9443/stage'],['wss://example.com','wss://example.com:8765/'],['wss://example.com:443','wss://example.com:443/'],['https://example.com/stage','wss://example.com:8765/stage'],['ws://example.com:8765','ws://example.com:8765/'],['192.168.1.2','ws://192.168.1.2:8765/'],['[::1]:8765','ws://[::1]:8765/']]) {
      assert.equal(formatLeaderAddress(input),expected)
      bandSync.connectWebSocket(input)
      assert.equal(urls.at(-1),expected)
      bandSync.ws.onopen()
      assert.equal(getRecentLeaders()[0],expected)
      bandSync.initWebSocketConnection()
      assert.equal(urls.at(-1),expected)
      bandSync.disconnectWebSocket()
    }
    bandSync.setCustomHostIp('wss://example.com:9443/stage')
    assert.equal(bandSync.getState().leaderEndpoint, 'wss://example.com:9443/stage')
    assert.throws(()=>formatLeaderAddress('ftp://example.com'),/endpoint/)
  } finally {bandSync.setRole('OFF');global.window=oldWindow;global.WebSocket=oldSocket;global.localStorage=oldStorage}
})
