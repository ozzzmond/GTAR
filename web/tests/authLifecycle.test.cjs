const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
for (const ext of ['.ts','.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8').replaceAll('import.meta.env','({DEV:false,VITE_GOOGLE_CLIENT_ID:"client"})'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename)
require.extensions['.png'] = (module) => { module.exports = '/assets/dev-logo.png' }
const {JSDOM}=require('jsdom')
const React=require('react')
const {act}=React
const {createRoot}=require('react-dom/client')

for (const route of ['/stage/present?view=present&session=GTAR-ABCD', '/tv', '/tv?session=GTAR-ABCD']) {
test(`owner gate preserves presentation lifecycle and expiry: ${route}`,async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:`https://dev.gtar-web.pages.dev${route}`})
  const previous={window:global.window,document:global.document,localStorage:global.localStorage,sessionStorage:global.sessionStorage,fetch:global.fetch}
  Object.assign(global,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true})
  window.google={}
  const originalNow=Date.now
  const now=originalNow()
  let mounted=0,unmounted=0
  global.fetch=async()=>new Response(JSON.stringify({success:true,user:{id:'owner-id',google_sub:'owner',email:'owner@example.com',display_name:'Owner',picture_url:null,role:'admin',access_status:'active'}}))
  const {AuthGate}=require('../src/components/AuthGate.tsx')
  const {StagePresentationView}=require('../src/components/StagePresentationView.tsx')
  function Presentation(){React.useEffect(()=>{mounted++;return()=>{unmounted++}},[]);return React.createElement(StagePresentationView)}
  sessionStorage.setItem('gtar_google_session',JSON.stringify({sessionToken:'test-session-token',role:'admin',access_status:'active',expiresAt:now+60000,user:{id:'owner-id',sub:'owner',email:'owner@example.com',role:'admin',access_status:'active'}}))
  let root=createRoot(document.getElementById('root'))
  try {
    await act(async()=>{root.render(React.createElement(AuthGate,null,React.createElement(Presentation)))})
    assert.equal(mounted,1)
    assert.match(document.body.textContent,/Stage Teleprompter Ready/)
    assert.match(document.body.textContent, /Opening this page does not connect devices/)
    assert.match(document.body.textContent, /Independent-device synchronization is not yet supported/)
    assert.doesNotMatch(document.body.textContent, /mirror here in real time/)
    if (route.includes('session=')) assert.match(document.body.textContent, /Session: GTAR-ABCD/)
    assert.equal(window.location.pathname + window.location.search, route)
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
      sessionToken: 'test-session-token',
      role: 'admin',
      access_status: 'active',
      authenticatedAt: now,
      lastVerifiedAt: now,
      localExpiresAt: now + 30 * 24 * 60 * 60 * 1000,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
      user: { id: 'owner-id', sub: 'owner', email: 'owner@example.com', role: 'admin', access_status: 'active' }
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

}

// JSDOM models same-origin persistent storage; real browser QA remains separate.
for (const route of ['/stage/present?view=present', '/tv']) {
  for (const status of ['valid', 'expired', 'revoked', 'signed-out']) {
    test(`presentation popup persisted-session gate: ${route} ${status}`, async () => {
      const operator = new JSDOM('', { url: 'https://dev.gtar-web.pages.dev/' })
      const popup = new JSDOM('<div id="root"></div>', { url: `https://dev.gtar-web.pages.dev${route}` })
      // Same-origin windows share localStorage, but this popup starts with empty sessionStorage.
      Object.defineProperty(popup.window, 'localStorage', { value: operator.window.localStorage })
      const previousNavigator = Object.getOwnPropertyDescriptor(global, 'navigator')
      Object.defineProperty(global, 'navigator', { configurable: true, value: popup.window.navigator })
      const previous = { window: global.window, document: global.document, localStorage: global.localStorage, sessionStorage: global.sessionStorage, fetch: global.fetch, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT }
      const { AuthGate } = require('../src/components/AuthGate.tsx')
      const { StagePresentationView } = require('../src/components/StagePresentationView.tsx')
      const { createDurableSession, SESSION_STORAGE_KEY } = require('../src/utils/googleAuth.ts')
      const now = Date.now()
      const user = { id: 'owner-id', sub: 'owner', email: 'owner@example.com', role: 'admin', access_status: 'active' }
      const stored = createDurableSession(user, undefined, status === 'expired' ? now - 31 * 86400000 : now,
        { sessionToken: 'private-server-session', role: 'admin', access_status: 'active' })
      if (status !== 'signed-out') operator.window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stored))
      Object.assign(global, { window: popup.window, document: popup.window.document, localStorage: popup.window.localStorage, sessionStorage: popup.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true })
      window.google = {}
      global.fetch = async () => status === 'revoked'
        ? new Response(JSON.stringify({ error: 'Session revoked' }), { status: 401 })
        : new Response(JSON.stringify({ success: true, user: { ...user, google_sub: user.sub, display_name: 'Owner' } }))
      const root = createRoot(document.getElementById('root'))
      try {
        assert.equal(sessionStorage.length, 0)
        await act(async () => root.render(React.createElement(AuthGate, null, React.createElement(StagePresentationView))))
        if (status === 'valid') {
          assert.match(document.body.textContent, /Stage Teleprompter Ready/)
          assert.doesNotMatch(document.body.textContent, /Owner Access/)
        } else {
          assert.match(document.body.textContent, /Owner Access/)
          assert.doesNotMatch(document.body.textContent, /Stage Teleprompter Ready/)
        }
        assert.equal(window.location.pathname + window.location.search, route)
        assert.equal(window.location.href.includes('private-server-session'), false)
      } finally {
        await act(async () => root.unmount())
        popup.window.close()
        operator.window.close()
        Object.assign(global, previous)
        if (previousNavigator) Object.defineProperty(global, 'navigator', previousNavigator)
        else delete global.navigator
      }
    })
  }
}
