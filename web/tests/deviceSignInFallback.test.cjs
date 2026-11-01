const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false,VITE_GOOGLE_CLIENT_ID:"test-client"})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }
).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const React = require('react'), { act } = React
const { createRoot } = require('react-dom/client')
const { JSDOM } = require('jsdom')

async function fallback(mode, run, storedStatus) {
  for (const key of Object.keys(require.cache)) if (key.includes('/web/src/')) delete require.cache[key]
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.example/' })
  const prior = Object.fromEntries(['window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'].map(k => [k, global[k]]))
  Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true })
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const library = '{"songs":[{"id":"local","title":"Device song"}],"setlists":[]}'
  localStorage.setItem('gtar_library_v1', library)
  localStorage.setItem('gtar_library_owner_v1', 'owner bytes')
  let storedSession
  if (storedStatus) {
    const { createDurableSession } = require('../src/utils/googleAuth.ts')
    storedSession = JSON.stringify(createDurableSession({
      id: 'previous-user', sub: 'previous-sub', email: 'previous@example.com',
      role: 'member', access_status: storedStatus,
    }, undefined, Date.now(), { sessionToken: 'previous-token', role: 'member', access_status: storedStatus }))
    localStorage.setItem('gtar_auth_session', storedSession)
  }
  let callback, renders = 0, requests = 0, sdkRequests = 0
  const google = { accounts: { id: {
    initialize(config) { callback = config.callback },
    prompt() { assert.fail('Explicit sign-in must not call One Tap prompt') },
    renderButton(container) {
      renders++
      const button = document.createElement('button'); button.textContent = 'Official Google button'
      button.onclick = () => callback({ credential: 'test-credential' }); container.append(button)
    }, cancel() {},
  } } }
  if (mode === 'loaded') window.google = google
  const append = document.head.appendChild.bind(document.head)
  document.head.appendChild = element => {
    const result = append(element)
    if (element.tagName === 'SCRIPT') {
      assert.equal(element.src, 'https://accounts.google.com/gsi/client')
      sdkRequests++
      window.google = google
      element.onload()
    }
    return result
  }
  global.fetch = async (url, options) => {
    requests++; assert.equal(url, '/api/auth/session'); assert.equal(options.method, 'POST')
    return new Response(JSON.stringify({ success: true, sessionToken: 'test-session', user: {
      id: 'test-user', google_sub: 'test-sub', email: 'test@example.com', role: 'member', access_status: 'active',
    } }))
  }
  const { AuthGate, useGoogleAuth } = require('../src/components/AuthGate.tsx')
  let auth
  function Songbook() {
    auth = useGoogleAuth()
    return React.createElement('main', null, JSON.parse(localStorage.getItem('gtar_library_v1')).songs[0].title)
  }
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(AuthGate, { deviceOwned: true }, React.createElement(Songbook))))
    assert.equal(requests, 0); assert.equal(renders, 0); assert.equal(sdkRequests, 0)
    await act(async () => auth.signIn())
    assert.ok(document.querySelector('dialog[open]'), 'sign-in dialog opens')
    assert.equal(renders, 1, 'GIS renderButton renders the official button')
    assert.equal(sdkRequests, mode === 'loaded' ? 0 : 1)
    assert.match(document.querySelector('main').textContent, /Device song/)
    await run({ auth: () => auth, requests: () => requests, storedSession, credential: () => callback({ credential: 'late-credential' }) })
    assert.equal(localStorage.getItem('gtar_library_v1'), library)
    assert.equal(localStorage.getItem('gtar_library_owner_v1'), 'owner bytes')
  } finally { await act(async () => root.unmount()); Object.assign(global, prior); dom.window.close() }
}

for (const mode of ['loaded', 'first-load']) test(`deviceOwned explicit sign-in ${mode}: official button signs in without replacing library`, async () => {
  await fallback(mode, async r => {
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Official Google button').click())
    assert.equal(r.auth().session?.user.id, 'test-user')
    assert.equal(document.querySelector('dialog'), null, 'dialog closes after sign-in')
    assert.equal(r.requests(), 1)
  })
})

test('deviceOwned sign-in cancel stays signed out and ignores late credentials', async () => {
  await fallback('first-load', async r => {
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click())
    assert.equal(document.querySelector('dialog'), null)
    await act(async () => r.credential())
    assert.equal(r.auth().session, null)
    assert.equal(r.requests(), 0)
  })
})

for (const status of ['pending', 'denied']) {
  test(`stored ${status} account can sign in to an active account through the official button`, async () => {
    await fallback('first-load', async r => {
      assert.equal(r.auth().session, null)
      await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Official Google button').click())
      assert.equal(r.auth().session?.user.id, 'test-user')
      assert.equal(r.auth().session?.access_status, 'active')
      assert.equal(JSON.parse(localStorage.getItem('gtar_auth_session')).user.id, 'test-user')
      assert.equal(r.requests(), 1)
      assert.equal(document.querySelector('dialog'), null)
    }, status)
  })
}

for (const status of ['pending', 'denied']) {
  test(`cancel preserves the stored ${status} account and ignores late credentials`, async () => {
    await fallback('first-load', async r => {
      assert.equal(r.auth().session, null)
      assert.equal(r.auth().accessStatus, status)
      await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click())
      assert.equal(document.querySelector('dialog'), null)
      await act(async () => r.credential())
      assert.equal(r.auth().session, null)
      assert.equal(r.auth().accessStatus, status)
      assert.equal(localStorage.getItem('gtar_auth_session'), r.storedSession)
      assert.equal(r.requests(), 0)
    }, status)
  })
}
