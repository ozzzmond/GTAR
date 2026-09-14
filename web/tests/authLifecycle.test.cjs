const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
for (const ext of ['.ts','.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8').replaceAll('import.meta.env','({DEV:false,VITE_GOOGLE_CLIENT_ID:"client"})'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename)
require.extensions['.png'] = (module) => { module.exports = '/assets/dev-logo.png' }
const {JSDOM}=require('jsdom')
const React=require('react')
const {act}=React
const {createRoot}=require('react-dom/client')

test('owner gate unmounts real presentation on expiry and offline reload remains locked',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'https://gtar-web.pages.dev/stage/present'})
  const previous={window:global.window,document:global.document,localStorage:global.localStorage,sessionStorage:global.sessionStorage,fetch:global.fetch}
  Object.assign(global,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true})
  window.google={}
  const originalNow=Date.now
  const now=originalNow()
  let mounted=0,unmounted=0
  global.fetch=async()=>new Response(JSON.stringify({sub:'owner',email:'jlopez3rd@gmail.com',email_verified:true}))
  const {AuthGate}=require('../src/components/AuthGate.tsx')
  const {StagePresentationView}=require('../src/components/StagePresentationView.tsx')
  function Presentation(){React.useEffect(()=>{mounted++;return()=>{unmounted++}},[]);return React.createElement(StagePresentationView)}
  sessionStorage.setItem('gtar_google_session',JSON.stringify({token:'test',expiresAt:now+60000,user:{sub:'owner',email:'jlopez3rd@gmail.com'}}))
  let root=createRoot(document.getElementById('root'))
  try {
    await act(async()=>{root.render(React.createElement(AuthGate,null,React.createElement(Presentation)))})
    assert.equal(mounted,1)
    assert.match(document.body.textContent,/Stage Teleprompter Ready/)
    // Advance beyond the 30-day durable session expiry
    Date.now = () => now + 31 * 24 * 60 * 60 * 1000
    await act(async () => { window.dispatchEvent(new window.Event('focus')) })
    assert.equal(unmounted, 1)
    assert.match(document.body.textContent, /Owner Access/)
    assert.doesNotMatch(document.body.textContent, /Stage Teleprompter Ready/)
    assert.equal(sessionStorage.getItem('gtar_google_session'), null)
    await act(async () => root.unmount())

    // DEV.18 Offline Resilience: valid durable session reloaded offline preserves presentation stage view
    Date.now = originalNow
    sessionStorage.setItem('gtar_google_session', JSON.stringify({
      version: 1,
      token: 'test',
      authenticatedAt: now,
      lastVerifiedAt: now,
      localExpiresAt: now + 30 * 24 * 60 * 60 * 1000,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
      user: { sub: 'owner', email: 'jlopez3rd@gmail.com' }
    }))
    global.fetch = async () => { throw Error('offline') }
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(React.createElement(AuthGate, null, React.createElement(Presentation))))
    assert.equal(mounted, 2)
    assert.match(document.body.textContent, /Stage Teleprompter Ready/)
    await act(async () => root.unmount())

    // DEV.18 Offline Expired: expired session (>30d) reloaded offline locks gate with clear renewal message without data loss
    Date.now = () => now + 31 * 24 * 60 * 60 * 1000
    if (typeof global.navigator !== 'undefined') {
      Object.defineProperty(global.navigator, 'onLine', { value: false, configurable: true, writable: true })
    }
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true, writable: true })
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(React.createElement(AuthGate, null, React.createElement(Presentation))))
    assert.match(document.body.textContent, /Your 30-day offline stage session has expired/)
  } finally {
    Date.now = originalNow
    await act(async()=>root.unmount())
    dom.window.close()
    Object.assign(global,previous)
    delete global.IS_REACT_ACT_ENVIRONMENT
  }
})
