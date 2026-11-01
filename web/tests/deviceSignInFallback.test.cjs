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

async function fallback(moment, run) {
  for (const key of Object.keys(require.cache)) if (key.includes('/web/src/')) delete require.cache[key]
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.example/' })
  const prior = Object.fromEntries(['window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'].map(k => [k, global[k]]))
  Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true })
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const library = '{"songs":[{"id":"local","title":"Device song"}],"setlists":[]}'
  localStorage.setItem('gtar_library_v1', library)
  localStorage.setItem('gtar_library_owner_v1', 'owner bytes')
  let callback, renders = 0, requests = 0
  window.google = { accounts: { id: {
    initialize(config) { callback = config.callback },
    prompt(notify) { notify({ isNotDisplayed: () => moment === 'cooldown', getNotDisplayedReason: () => 'suppressed_by_user',
      isSkippedMoment: () => moment === 'skipped', getSkippedReason: () => 'auto_cancel', isDismissedMoment: () => false }) },
    renderButton(container) {
      renders++
      const button = document.createElement('button'); button.textContent = 'Official Google button'
      button.onclick = () => callback({ credential: 'test-credential' }); container.append(button)
    }, cancel() {},
  } } }
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
    assert.equal(requests, 0); assert.equal(renders, 0)
    await act(async () => auth.signIn())
    assert.ok(document.querySelector('dialog[open]'), 'fallback dialog opens')
    assert.equal(renders, 1, 'GIS renderButton renders the official button')
    assert.match(document.querySelector('main').textContent, /Device song/)
    await run({ auth: () => auth, requests: () => requests, credential: () => callback({ credential: 'late-credential' }) })
    assert.equal(localStorage.getItem('gtar_library_v1'), library)
    assert.equal(localStorage.getItem('gtar_library_owner_v1'), 'owner bytes')
  } finally { await act(async () => root.unmount()); Object.assign(global, prior); dom.window.close() }
}

for (const moment of ['cooldown', 'skipped']) test(`deviceOwned One Tap ${moment}: official button signs in without replacing library`, async () => {
  await fallback(moment, async r => {
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Official Google button').click())
    assert.equal(r.auth().session?.user.id, 'test-user')
    assert.equal(document.querySelector('dialog'), null, 'dialog closes after sign-in')
    assert.equal(r.requests(), 1)
  })
})

test('deviceOwned fallback cancel stays signed out and ignores late credentials', async () => {
  await fallback('cooldown', async r => {
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click())
    assert.equal(document.querySelector('dialog'), null)
    await act(async () => r.credential())
    assert.equal(r.auth().session, null)
    assert.equal(r.requests(), 0)
  })
})
