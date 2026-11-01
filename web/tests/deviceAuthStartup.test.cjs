const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/b2Harness.cjs')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

test('PR-A 5: signed-out startup renders songbook with auth context and no network requests', async () => {
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
  } finally { await act(async () => root.unmount()); el.remove(); global.fetch = saved }
})
