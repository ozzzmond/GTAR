const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
let dev = true
for (const ext of ['.ts','.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8').replaceAll('import.meta.env',`({DEV:${dev}})`),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const {JSDOM} = require('jsdom')
const React = require('react'), {act} = React
const {createRoot} = require('react-dom/client')
for (const [host, development, allowed] of [['localhost',true,true],['127.0.0.1',true,true],['[::1]',true,true],['192.168.1.2',true,false],['localhost',false,false]]) test(`offline interaction ${host}, development=${development}`,async()=>{
  dev = development
  delete require.cache[require.resolve('../src/components/AuthGate.tsx')]
  const {AuthGate,useGoogleAuth} = require('../src/components/AuthGate.tsx')
  const dom = new JSDOM('<div id="root"></div>',{url:`http://${host}/`})
  const prior = {window:global.window,document:global.document,localStorage:global.localStorage,sessionStorage:global.sessionStorage,IS_REACT_ACT_ENVIRONMENT:global.IS_REACT_ACT_ENVIRONMENT}
  Object.assign(global,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true})
  const root = createRoot(document.getElementById('root'))
  function Content(){ const auth = useGoogleAuth(); return React.createElement('p',null,`Private library ${auth.role}`) }
  try {
    await act(async()=>root.render(React.createElement(AuthGate,null,React.createElement(Content))))
    const button = [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Continue offline'))
    assert.equal(!!button,allowed)
    if (allowed) {
      await act(async()=>button.click())
      assert.match(document.body.textContent,/Private library SUPER_ADMIN/)
      await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Exit bypass').click())
      assert.doesNotMatch(document.body.textContent,/Private library/)
      assert.match(document.body.textContent,/Continue offline/)
    }
  } finally { await act(async()=>root.unmount()); Object.assign(global,prior); dom.window.close() }
})
