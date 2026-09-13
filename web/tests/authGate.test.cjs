const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client"})'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
}).outputText, filename)
const { authorizedEmail, allowLocalBypass } = require('../src/utils/authPolicy.ts')
const { verifyGoogleSession, readGoogleSession, saveGoogleSession } = require('../src/utils/googleAuth.ts')
const React = require('react')
const { renderToString } = require('react-dom/server')
const { AuthGate } = require('../src/components/AuthGate.tsx')

test('email whitelist defaults to owner and requires an exact normalized match', () => {
  assert.equal(authorizedEmail(' JLOPEZ3RD@gmail.com '), true)
  for (const email of ['attacker@example.com', 'jlopez3rd@gmail.com.attacker.com', 'other+jlopez3rd@gmail.com']) assert.equal(authorizedEmail(email), false)
  assert.equal(authorizedEmail('second@example.com', 'first@example.com, SECOND@example.com'), true)
  assert.equal(authorizedEmail('jlopez3rd@gmail.com', ''), false)
})
test('bypass is allowed only for development builds on exact loopback hosts', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(allowLocalBypass(true, host), true)
    assert.equal(allowLocalBypass(false, host), false)
  }
  for (const host of ['gtar-web.pages.dev', 'dev.gtar-web.pages.dev', 'localhost.attacker.com', '192.168.1.1']) assert.equal(allowLocalBypass(true, host), false)
})
test('locked gate never renders app children or reads library storage', () => {
  const prevWindow = global.window
  const prevStorage = global.localStorage
  try {
    global.window = { location: { hostname: 'gtar-web.pages.dev' } }
    global.localStorage = { getItem() { assert.fail('Library storage accessed while locked') } }
    function Library() { assert.fail('Library rendered while locked') }
    const html = renderToString(React.createElement(AuthGate, null, React.createElement(Library)))
    assert.match(html, /GTAR/)
    assert.match(html, /restricted to authorized owners/)
    assert.doesNotMatch(html, /Continue offline/)
  } finally {
    global.window = prevWindow
    global.localStorage = prevStorage
  }
})
test('cached user email is reverified against Google without requesting an OAuth popup', async () => {
  const original = global.fetch
  const session = { token: 'cached-token', expiresAt: Date.now() + 60000, user: { sub: 'fake', email: 'jlopez3rd@gmail.com' } }
  let stored = JSON.stringify(session)
  global.sessionStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value }, removeItem: () => { stored = null } }
  global.fetch = async (_url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer cached-token')
    return new Response(JSON.stringify({ sub: 'actual', email: 'outsider@example.com', email_verified: true }))
  }
  try {
    const actual = await verifyGoogleSession(readGoogleSession())
    assert.equal(authorizedEmail(actual.user.email), false)
    saveGoogleSession(null)
    assert.equal(readGoogleSession(), null)
    global.fetch = async () => new Response('', { status: 401 })
    await assert.rejects(verifyGoogleSession(session), /verified/)
    global.fetch = async () => new Response(JSON.stringify({ sub: 'owner', email: 'jlopez3rd@gmail.com', email_verified: false }))
    await assert.rejects(verifyGoogleSession(session), /verified Google email/)
    await assert.rejects(verifyGoogleSession({ ...session, expiresAt: 0 }), /expired/)
  } finally { global.fetch = original }
})

test('getUserRole correctly identifies SUPER_ADMIN, USER, and NONE', () => {
  const { getUserRole } = require('../src/utils/authPolicy.ts')
  // Root admin
  assert.equal(getUserRole('jlopez3rd@gmail.com'), 'SUPER_ADMIN')
  assert.equal(getUserRole(' JLOPEZ3RD@gmail.com '), 'SUPER_ADMIN')
  assert.equal(getUserRole('custom-root@example.com', 'custom-root@example.com'), 'SUPER_ADMIN')

  // Standard authorized users
  assert.equal(getUserRole('bandmate@example.com', 'jlopez3rd@gmail.com', 'jlopez3rd@gmail.com, bandmate@example.com'), 'USER')
  assert.equal(getUserRole(' BANDMATE@example.com ', 'jlopez3rd@gmail.com', 'bandmate@example.com'), 'USER')

  // Direct authenticated users without explicit whitelist
  assert.equal(getUserRole('newuser@example.com', 'jlopez3rd@gmail.com'), 'USER')
  assert.equal(getUserRole('anyone@gmail.com'), 'USER')

  // Unauthorized users
  assert.equal(getUserRole('stranger@example.com', 'jlopez3rd@gmail.com', 'bandmate@example.com'), 'NONE')
  assert.equal(getUserRole('', 'jlopez3rd@gmail.com'), 'NONE')
  assert.equal(getUserRole(null, 'jlopez3rd@gmail.com'), 'NONE')
})

test('whitelist management supports add, remove, and protects root admin', () => {
  const { addAuthorizedEmail, removeAuthorizedEmail, resetAuthorizedEmails, getAuthorizedEmailsList, authorizedEmail } = require('../src/utils/authPolicy.ts')
  resetAuthorizedEmails()

  try {
    const initial = getAuthorizedEmailsList('jlopez3rd@gmail.com')
    assert.deepEqual(initial, ['jlopez3rd@gmail.com'])

    // Add new user
    const updated = addAuthorizedEmail('musician@example.com', 'jlopez3rd@gmail.com')
    assert.equal(updated.includes('musician@example.com'), true)
    assert.equal(authorizedEmail('musician@example.com', 'jlopez3rd@gmail.com'), true)

    // Cannot remove root admin
    const afterRootRemove = removeAuthorizedEmail('jlopez3rd@gmail.com', 'jlopez3rd@gmail.com')
    assert.equal(afterRootRemove.includes('jlopez3rd@gmail.com'), true)

    // Can remove added user
    const afterUserRemove = removeAuthorizedEmail('musician@example.com', 'jlopez3rd@gmail.com')
    assert.equal(afterUserRemove.includes('musician@example.com'), false)
    assert.equal(authorizedEmail('musician@example.com', 'jlopez3rd@gmail.com'), false)
  } finally {
    resetAuthorizedEmails()
  }
})

test('baseline whitelist includes johncriscaculitan01@gmail.com and jlopez3rd@gmail.com by default', () => {
  const { authorizedEmail, getAuthorizedEmailsList, resetAuthorizedEmails } = require('../src/utils/authPolicy.ts')
  resetAuthorizedEmails()
  assert.equal(authorizedEmail('jlopez3rd@gmail.com'), true)
  assert.equal(authorizedEmail('johncriscaculitan01@gmail.com'), true)
  assert.equal(authorizedEmail(' JOHNCRISCACULITAN01@GMAIL.COM '), true)
  const defaultList = getAuthorizedEmailsList()
  assert.ok(defaultList.includes('jlopez3rd@gmail.com'))
  assert.ok(defaultList.includes('johncriscaculitan01@gmail.com'))
})

test('mergeCloudAuthorizedEmails dynamically synchronizes and caches remote approved users', () => {
  const { mergeCloudAuthorizedEmails, authorizedEmail, resetAuthorizedEmails } = require('../src/utils/authPolicy.ts')
  resetAuthorizedEmails()
  try {
    assert.equal(authorizedEmail('newbandmate@example.com'), false)
    const merged = mergeCloudAuthorizedEmails(['newbandmate@example.com', 'another@example.com'])
    assert.ok(merged.includes('newbandmate@example.com'))
    assert.equal(authorizedEmail('newbandmate@example.com'), true)
    assert.equal(authorizedEmail('another@example.com'), true)
  } finally {
    resetAuthorizedEmails()
  }
})
