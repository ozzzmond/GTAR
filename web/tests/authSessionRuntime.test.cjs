const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:true,VITE_GOOGLE_CLIENT_ID:"client"})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }
).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { JSDOM } = require('jsdom')
const { AuthGate, useGoogleAuth } = require('../src/components/AuthGate.tsx')
const { createDurableSession, saveGoogleSession, readGoogleSession } = require('../src/utils/googleAuth.ts')

async function runtime(status, run) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173' })
  const previous = Object.fromEntries(['window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'].map(k => [k, global[k]]))
  Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true })
  window.google = {}
  let auth, requests = 0, concurrent = 0, peak = 0
  let respond = async () => status
  const user = access_status => ({ id: 'test-id', google_sub: 'test-sub', email: 'test@example.com', role: 'member', access_status })
  global.fetch = async (url) => {
    assert.equal(url, '/api/auth/session')
    requests++; concurrent++; peak = Math.max(peak, concurrent)
    try { return new Response(JSON.stringify({ success: true, user: user(await respond()) })) }
    finally { concurrent-- }
  }
  if (status) saveGoogleSession(createDurableSession({ sub: 'test-sub', ...user(status) }, undefined, Date.now(), { sessionToken: 'test-token', role: 'member', access_status: status }))
  function Child() { auth = useGoogleAuth(); return React.createElement('p', null, 'Protected app') }
  const root = createRoot(document.getElementById('root'))
  const render = () => act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(AuthGate, null, React.createElement(Child)))))
  const click = async label => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)
    assert.ok(button, `Missing button: ${label}`)
    await act(async () => button.click())
  }
  try {
    await run({ render, click, auth: () => auth, requests: () => requests, peak: () => peak, respond: fn => { respond = fn } })
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    Object.assign(global, previous)
  }
}

for (const state of [null, 'pending', 'active']) test(`StrictMode ${state || 'signed-out'} stays idle across rerenders and events`, async () => {
  await runtime(state, async r => {
    await r.render()
    for (let i = 0; i < 25; i++) {
      await r.render()
      await act(async () => {
        window.dispatchEvent(new window.Event('focus'))
        window.dispatchEvent(new window.Event('online'))
        document.dispatchEvent(new window.Event('visibilitychange'))
      })
    }
    assert.equal(r.requests(), state === 'active' ? 1 : 0)
    assert.ok(r.peak() <= 1)
    if (state === null) {
      // Keep the real event loop running long enough to catch rapid retries.
      await act(async () => new Promise(resolve => setTimeout(resolve, 10_000)))
      assert.equal(r.requests(), 0)
    }
    assert.match(document.body.textContent, state === 'active' ? /Protected app/ : state === 'pending' ? /Access Approval Pending/ : /Owner Access/)
    if (state === 'active') await act(async () => r.auth().signOut())
    if (state === 'pending') await r.click('Sign Out')
    await r.render()
    assert.match(document.body.textContent, /Owner Access/)
    assert.doesNotMatch(document.body.textContent, /Loading GTAR|Verifying your session/)
    assert.equal(r.requests(), state === 'active' ? 1 : 0)
  })
})

test('StrictMode initialization applies the authoritative pending response', async () => {
  await runtime('active', async r => {
    r.respond(async () => 'pending')
    await r.render()
    assert.match(document.body.textContent, /Access Approval Pending/)
    assert.doesNotMatch(document.body.textContent, /Protected app/)
    assert.equal(r.requests(), 1)
  })
})

test('Check Status is single-flight and its late response cannot undo sign-out', async () => {
  await runtime('pending', async r => {
    let finish
    r.respond(() => new Promise(resolve => { finish = resolve }))
    await r.render()
    await r.click('Check Status')
    assert.equal(r.requests(), 1)
    await r.click('Sign Out')
    await act(async () => finish('active'))
    assert.equal(readGoogleSession(), null)
    assert.match(document.body.textContent, /Owner Access/)
    assert.equal(r.requests(), 1)
    assert.equal(r.peak(), 1)
  })
})

test('active focus recheck runs once after the cooldown', async () => {
  await runtime('active', async r => {
    await r.render()
    const originalNow = Date.now
    const later = originalNow() + 61_000
    try {
      Date.now = () => later
      await act(async () => window.dispatchEvent(new window.Event('focus')))
      assert.equal(r.requests(), 2)
      assert.equal(r.peak(), 1)
    } finally { Date.now = originalNow }
  })
})

test('manual checks cannot overlap initialization or one another', async () => {
  await runtime('active', async r => {
    let finish
    r.respond(() => new Promise(resolve => { finish = resolve }))
    await r.render()
    const auth = r.auth()
    await act(async () => { void auth.checkStatus(); void auth.checkStatus() })
    assert.equal(r.requests(), 1)
    await act(async () => finish('active'))
    await act(async () => { void r.auth().checkStatus(); void r.auth().checkStatus() })
    assert.equal(r.requests(), 2)
    await act(async () => finish('active'))
    await act(async () => { void r.auth().checkStatus() })
    assert.equal(r.requests(), 2)
    assert.equal(r.peak(), 1)
  })
})
