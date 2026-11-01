const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/b2Harness.cjs')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

test('signed-out startup leaves SDK unloaded and makes zero Google/auth requests', async () => {
  h.freshStorage()
  global.sessionStorage = h.dom.window.sessionStorage
  global.IS_REACT_ACT_ENVIRONMENT = true
  const { AuthGate, useGoogleAuth } = require('../src/components/AuthGate.tsx')
  let requests = 0
  const saved = global.fetch
  global.fetch = () => { requests++; throw new Error('Startup network request') }
  const el = document.createElement('div'); document.body.append(el)
  const root = createRoot(el)
  function Songbook() {
    const auth = useGoogleAuth()
    assert.equal(auth.session, null)
    return React.createElement('main', null, 'Songbook')
  }
  try {
    await act(async () => root.render(React.createElement(AuthGate, { deviceOwned: true }, React.createElement(Songbook))))
    assert.equal(el.textContent, "Songbook")
    assert.equal(document.querySelector('script[src*="accounts.google"]'), null)
    assert.equal(requests, 0)
    assert.equal(el.querySelector('dialog'), null, 'sign-in dialog requires an explicit action')
  } finally { await act(async () => root.unmount()); el.remove(); global.fetch = saved }
})

async function storedSessionStartup(raw, { online = false } = {}) {
  const storage = h.freshStorage()
  global.sessionStorage = h.dom.window.sessionStorage
  global.IS_REACT_ACT_ENVIRONMENT = true
  storage.setItem('gtar_auth_session', raw)
  const preserved = {
    gtar_library_v1: JSON.stringify(h.library(1, 0)),
    gtar_library_owner_v1: 'owner bytes',
    gtar_sync_library_owner: 'sync owner bytes',
    unrelated: 'keep me',
  }
  for (const [key, value] of Object.entries(preserved)) storage.setItem(key, value)
  const { AuthGate, useGoogleAuth } = require('../src/components/AuthGate.tsx')
  const priorFetch = global.fetch
  const priorNavigator = Object.getOwnPropertyDescriptor(global, 'navigator')
  Object.defineProperty(global, 'navigator', { configurable: true, value: { onLine: online } })
  let requests = 0, auth
  global.fetch = async url => {
    requests++
    assert.equal(url, '/api/auth/session', 'only the existing signed-in recheck may run')
    return new Response(JSON.stringify({ success: true, user: {
      id: 'test-id', google_sub: 'test-sub', email: 'test@example.com', role: 'member', access_status: 'active',
    } }))
  }
  function Songbook() {
    auth = useGoogleAuth()
    const lib = JSON.parse(storage.getItem('gtar_library_v1'))
    return React.createElement('main', null, `${lib.songs[0].title}: ${auth.session ? 'signed in' : 'signed out'}`)
  }
  const el = document.createElement('div'); document.body.append(el)
  let root
  try {
    // A second root models reload: React state is discarded; localStorage survives.
    for (let reload = 0; reload < 2; reload++) {
      root = createRoot(el)
      await act(async () => root.render(React.createElement(React.StrictMode, null,
        React.createElement(AuthGate, { deviceOwned: true }, React.createElement(Songbook)))))
      assert.match(el.textContent, /Synthetic Song/)
      for (const [key, value] of Object.entries(preserved)) assert.equal(storage.getItem(key), value, key)
      if (reload === 0) await act(async () => root.unmount())
    }
    return { session: auth.session, text: el.textContent, requests, stored: storage.getItem('gtar_auth_session') }
  } finally {
    await act(async () => root?.unmount()); el.remove(); global.fetch = priorFetch
    if (priorNavigator) Object.defineProperty(global, 'navigator', priorNavigator)
    else delete global.navigator
  }
}

function validStoredSession() {
  const { createDurableSession } = require('../src/utils/googleAuth.ts')
  return createDurableSession({ id: 'test-id', sub: 'test-sub', email: 'test@example.com', role: 'member', access_status: 'active' }, undefined, Date.now(), {
    sessionToken: 'test-token', role: 'member', access_status: 'active',
  })
}

test('deviceOwned restores a valid stored session across reloads offline without requests', async () => {
  const session = validStoredSession()
  const result = await storedSessionStartup(JSON.stringify(session))
  assert.equal(result.session?.user.id, 'test-id')
  assert.match(result.text, /signed in$/)
  assert.equal(result.requests, 0)
  assert.equal(result.stored, JSON.stringify(session))
})

test('deviceOwned restores online sign-in and only runs the existing session recheck', async () => {
  const result = await storedSessionStartup(JSON.stringify(validStoredSession()), { online: true })
  assert.equal(result.session?.user.id, 'test-id')
  assert.match(result.text, /signed in$/)
  assert.equal(result.requests, 2, 'one recheck per reload, including StrictMode')
})

test('deviceOwned clears an expired session and keeps the library visible and signed out', async () => {
  const { createDurableSession } = require('../src/utils/googleAuth.ts')
  const session = createDurableSession({ id: 'test-id', sub: 'test-sub', email: 'test@example.com', role: 'member', access_status: 'active' }, undefined,
    Date.now() - 31 * 24 * 60 * 60 * 1000, { sessionToken: 'test-token', role: 'member', access_status: 'active' })
  const result = await storedSessionStartup(JSON.stringify(session), { online: true })
  assert.equal(result.session, null)
  assert.match(result.text, /signed out$/)
  assert.equal(result.requests, 0)
  assert.equal(result.stored, null)
})

for (const raw of ['{broken', '{}']) test(`deviceOwned clears malformed session ${raw} without hiding the library or requesting auth`, async () => {
  const result = await storedSessionStartup(raw, { online: true })
  assert.equal(result.session, null)
  assert.match(result.text, /signed out$/)
  assert.equal(result.requests, 0)
  assert.equal(result.stored, null)
})
