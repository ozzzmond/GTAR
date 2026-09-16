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
