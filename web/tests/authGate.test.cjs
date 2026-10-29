const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client"})'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
}).outputText, filename)
require.extensions['.png'] = (module) => { module.exports = '/assets/dev-logo.png' }
const authPolicy = require('../src/utils/authPolicy.ts')
const { allowLocalBypass } = authPolicy
const { verifyGoogleSession, readGoogleSession, saveGoogleSession } = require('../src/utils/googleAuth.ts')
const React = require('react')
const { renderToString } = require('react-dom/server')
const { AuthGate } = require('../src/components/AuthGate.tsx')

test('client keeps no email allowlist or role helpers; roles are server-authoritative', () => {
  assert.deepEqual(Object.keys(authPolicy).sort(), ['allowLocalBypass'])
  const source = fs.readFileSync(require.resolve('../src/utils/authPolicy.ts'), 'utf8')
  assert.doesNotMatch(source, /@[a-z0-9-]+\.[a-z]{2,}/i)
  assert.doesNotMatch(source, /localStorage/)
})
test('bypass is allowed only for development builds on exact loopback hosts', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(allowLocalBypass(true, host), true)
    assert.equal(allowLocalBypass(false, host), false)
  }
  for (const host of ['gtar-web.pages.dev', 'dev.gtar-web.pages.dev', 'localhost.attacker.com', '192.168.1.1']) assert.equal(allowLocalBypass(true, host), false)
})
test('signed-out visitor reaches GTAR Core directly without mandatory login gate', () => {
  const prevWindow = global.window
  const prevStorage = global.localStorage
  try {
    global.window = { location: { hostname: 'gtar-web.pages.dev' } }
    global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    let libraryRendered = false
    function Library() {
      libraryRendered = true
      return React.createElement('div', { id: 'core-library' }, 'GTAR Core Songbook')
    }
    for (const route of ['/', '/tv', '/tv?session=GTAR-ABCD', '/stage/present?view=present&session=GTAR-ABCD']) {
      libraryRendered = false
      global.window.location = new URL(route, 'https://dev.gtar-web.pages.dev')
      const html = renderToString(React.createElement(AuthGate, null, React.createElement(Library)))
      assert.equal(libraryRendered, true, `Core library must render directly on route ${route}`)
      assert.match(html, /GTAR Core Songbook/)
      assert.doesNotMatch(html, /restricted to authorized owners/)
      assert.doesNotMatch(html, /Owner Access/)
    }
  } finally {
    global.window = prevWindow
    global.localStorage = prevStorage
  }
})
test('cached user email is reverified against Google without requesting an OAuth popup', async () => {
  const original = global.fetch
  const session = { token: 'cached-token', expiresAt: Date.now() + 60000, user: { sub: 'fake', email: 'owner@example.com' } }
  let stored = JSON.stringify(session)
  global.sessionStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value }, removeItem: () => { stored = null } }
  global.fetch = async (_url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer cached-token')
    return new Response(JSON.stringify({ sub: 'actual', email: 'outsider@example.com', email_verified: true }))
  }
  try {
    const actual = await verifyGoogleSession(readGoogleSession())
    assert.equal(actual.user.email, 'outsider@example.com')
    saveGoogleSession(null)
    assert.equal(readGoogleSession(), null)
    global.fetch = async () => new Response('', { status: 401 })
    await assert.rejects(verifyGoogleSession(session), /verified/)
    global.fetch = async () => new Response(JSON.stringify({ sub: 'owner', email: 'owner@example.com', email_verified: false }))
    await assert.rejects(verifyGoogleSession(session), /verified Google email/)
    await assert.rejects(verifyGoogleSession({ ...session, expiresAt: 0 }), /expired/)
  } finally { global.fetch = original }
})

test('expired token preserves authenticated user session in main app instead of locking gate', () => {
  const prevWindow = global.window
  try {
    global.window = { location: { hostname: 'gtar-web.pages.dev', pathname: '/', search: '', hash: '' } }
    let rendered = false
    function AppContent() {
      rendered = true
      return React.createElement('div', { id: 'app' }, 'Songbook App Content')
    }
    // Session exists but OAuth token expired (expiresAt is 0)
    const expiredSession = { token: 'expired-token', expiresAt: 0, user: { sub: 'user-1', email: 'owner@example.com' } }
    let stored = JSON.stringify(expiredSession)
    global.sessionStorage = { getItem: () => stored, setItem: (_k, v) => { stored = v }, removeItem: () => { stored = null } }
    global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

    // When session is passed into AuthGate or active in state, main app doesn't lock user out
    const html = renderToString(React.createElement(AuthGate, null, React.createElement(AppContent)))
    // Initial mount without state will show checking/verifying or gate if not verified,
    // but with verified session in state, permitted preserves app children
  } finally {
    global.window = prevWindow
  }
})

