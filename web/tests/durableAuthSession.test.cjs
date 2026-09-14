const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client-id-123",VITE_AUTHORIZED_EMAILS:"jlopez3rd@gmail.com, bandmate@gmail.com",VITE_ROOT_ADMIN_EMAIL:"jlopez3rd@gmail.com"})'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
    }).outputText, filename
  )
}
require.extensions['.png'] = (module) => { module.exports = '/assets/dev-logo.png' }

const { JSDOM } = require('jsdom')
const {
  createDurableSession,
  renewDurableSession,
  parseStoredSession,
  validSession,
  isSessionExpired,
  getStoredSessionStatus,
  readGoogleSession,
  saveGoogleSession,
  DURABLE_SESSION_DURATION_MS,
  SESSION_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
} = require('../src/utils/googleAuth.ts')
const { allowLocalBypass, authorizedEmail, getUserRole } = require('../src/utils/authPolicy.ts')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { AuthGate } = require('../src/components/AuthGate.tsx')

function createMemoryStorage() {
  const store = new Map()
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
    clear: () => { store.clear() },
    get size() { return store.size },
  }
}

test('1. First successful login creates 30-day durable session with normalized identity', () => {
  const t0 = Date.now()
  const session = createDurableSession(
    { sub: 'google-sub-42', email: '  BAndmate@GMAIL.COM  ', name: 'Bassist Bob', picture: 'https://example.com/bob.jpg' },
    'access-token-xyz',
    t0
  )

  assert.equal(session.version, 1)
  assert.equal(session.user.sub, 'google-sub-42')
  assert.equal(session.user.email, 'bandmate@gmail.com')
  assert.equal(session.user.name, 'Bassist Bob')
  assert.equal(session.user.picture, 'https://example.com/bob.jpg')
  assert.equal(session.authenticatedAt, t0)
  assert.equal(session.lastVerifiedAt, t0)
  assert.equal(session.localExpiresAt, t0 + DURABLE_SESSION_DURATION_MS)
  assert.equal(session.expiresAt, session.localExpiresAt)
  assert.equal(session.token, 'access-token-xyz')
  assert.equal(validSession(session), true)
  assert.equal(isSessionExpired(session), false)
})

test('2. Online renewal extends 30-day window from current time while preserving initial authentication time', () => {
  const t0 = Date.now()
  const t1 = t0 + 5 * 86400000 // 5 days later
  const original = createDurableSession({ sub: 'owner-1', email: 'jlopez3rd@gmail.com' }, 'token-1', t0)
  const renewed = renewDurableSession(original, t1)

  assert.equal(renewed.authenticatedAt, t0)
  assert.equal(renewed.lastVerifiedAt, t1)
  assert.equal(renewed.localExpiresAt, t1 + DURABLE_SESSION_DURATION_MS)
  assert.equal(renewed.expiresAt, renewed.localExpiresAt)
  assert.equal(validSession(renewed), true)
})

test('3. parseStoredSession strictly validates schema, types, timestamps, and detects expiry', () => {
  const now = Date.now()
  // Valid modern session
  const validModern = {
    version: 1,
    user: { sub: 'sub-1', email: 'user@example.com' },
    authenticatedAt: now,
    lastVerifiedAt: now,
    localExpiresAt: now + 86400000,
  }
  const resValid = parseStoredSession(validModern)
  assert.equal(resValid.session !== null, true)
  assert.equal(resValid.isExpired, false)

  // Expired session (> 30 days)
  const expiredSession = {
    version: 1,
    user: { sub: 'sub-1', email: 'user@example.com' },
    authenticatedAt: now - 35 * 86400000,
    lastVerifiedAt: now - 35 * 86400000,
    localExpiresAt: now - 5 * 86400000,
  }
  const resExpired = parseStoredSession(expiredSession)
  assert.equal(resExpired.session !== null, true)
  assert.equal(resExpired.isExpired, true)

  // Legacy format backwards compatibility
  const legacySession = {
    token: 'ya29.legacy',
    expiresAt: now + 3600000,
    user: { sub: 'legacy-sub', email: 'legacy@example.com' },
  }
  const resLegacy = parseStoredSession(legacySession)
  assert.equal(resLegacy.session !== null, true)
  assert.equal(resLegacy.session.user.email, 'legacy@example.com')
  assert.equal(resLegacy.isExpired, false)

  // Missing or malformed user identity
  assert.equal(parseStoredSession(null).session, null)
  assert.equal(parseStoredSession({}).session, null)
  assert.equal(parseStoredSession({ user: {} }).session, null)
  assert.equal(parseStoredSession({ user: { sub: '', email: 'valid@example.com' } }).session, null)
  assert.equal(parseStoredSession({ user: { sub: 'sub', email: '' } }).session, null)
  assert.equal(parseStoredSession({ user: { sub: 123, email: 'valid@example.com' } }).session, null)
  assert.equal(parseStoredSession({ user: { sub: 'sub', email: 'valid@example.com' }, localExpiresAt: 'invalid' }).session, null)
})

test('4. Storage targets, dual-key migration, and malformed JSON resilience', () => {
  const memStorage = createMemoryStorage()
  const prevLocal = global.localStorage
  const prevSession = global.sessionStorage
  try {
    global.localStorage = memStorage
    global.sessionStorage = createMemoryStorage()

    // 1. Initial state is empty
    assert.equal(readGoogleSession(), null)
    const emptyStatus = getStoredSessionStatus()
    assert.equal(emptyStatus.session, null)
    assert.equal(emptyStatus.isMalformed, false)

    // 2. Save session writes to both primary and legacy storage keys
    const session = createDurableSession({ sub: 'user-sub', email: 'bandmate@gmail.com' }, 'token-abc')
    saveGoogleSession(session)
    assert.ok(memStorage.getItem(SESSION_STORAGE_KEY))
    assert.ok(memStorage.getItem(LEGACY_STORAGE_KEY))
    assert.deepEqual(readGoogleSession().user.email, 'bandmate@gmail.com')

    // 3. Purge clears both keys
    saveGoogleSession(null)
    assert.equal(memStorage.getItem(SESSION_STORAGE_KEY), null)
    assert.equal(memStorage.getItem(LEGACY_STORAGE_KEY), null)
    assert.equal(readGoogleSession(), null)

    // 4. Malformed JSON handling
    memStorage.setItem(SESSION_STORAGE_KEY, '{ invalid json string ...')
    const malformedStatus = getStoredSessionStatus()
    assert.equal(malformedStatus.isMalformed, true)
    assert.equal(malformedStatus.session, null)
    assert.equal(readGoogleSession(), null) // gracefully discards malformed data
  } finally {
    global.localStorage = prevLocal
    global.sessionStorage = prevSession
  }
})

test('5. App mount with valid session unlocks immediately and renders songbook children', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar-web.pages.dev/' })
  const prevWindow = global.window
  const prevDoc = global.document
  const prevLocal = global.localStorage
  const prevSession = global.sessionStorage
  const prevAct = global.IS_REACT_ACT_ENVIRONMENT
  const prevFetch = global.fetch

  try {
    Object.assign(global, {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      sessionStorage: dom.window.sessionStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
      fetch: async () => new Response(JSON.stringify({ sub: 'admin-sub', email: 'jlopez3rd@gmail.com', email_verified: true })),
    })

    const session = createDurableSession({ sub: 'admin-sub', email: 'jlopez3rd@gmail.com' })
    dom.window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))

    function SongbookApp() {
      return React.createElement('div', { id: 'songbook' }, 'Active Musician Songbook')
    }

    const root = createRoot(dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(SongbookApp)))
    })

    assert.match(dom.window.document.body.textContent, /Active Musician Songbook/)
    assert.doesNotMatch(dom.window.document.body.textContent, /Owner Access/)
    await act(async () => root.unmount())
  } finally {
    dom.window.close()
    global.window = prevWindow
    global.document = prevDoc
    global.localStorage = prevLocal
    global.sessionStorage = prevSession
    global.IS_REACT_ACT_ENVIRONMENT = prevAct
    global.fetch = prevFetch
  }
})

test('6. Whitelist revocation locks gate and purges unauthorized session', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar-web.pages.dev/' })
  const prevWindow = global.window
  const prevDoc = global.document
  const prevLocal = global.localStorage
  const prevSession = global.sessionStorage
  const prevAct = global.IS_REACT_ACT_ENVIRONMENT

  try {
    Object.assign(global, {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      sessionStorage: dom.window.sessionStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
    })

    // Session exists for unapproved outsider
    const outsiderSession = createDurableSession({ sub: 'outsider-sub', email: 'stranger@example.com' })
    dom.window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(outsiderSession))

    function SongbookApp() {
      return React.createElement('div', { id: 'songbook' }, 'Should Not Render')
    }

    const root = createRoot(dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(SongbookApp)))
    })

    assert.match(dom.window.document.body.textContent, /Owner Access/)
    assert.match(dom.window.document.body.textContent, /Access revoked/)
    assert.doesNotMatch(dom.window.document.body.textContent, /Should Not Render/)
    assert.equal(dom.window.localStorage.getItem(SESSION_STORAGE_KEY), null)
    await act(async () => root.unmount())
  } finally {
    dom.window.close()
    global.window = prevWindow
    global.document = prevDoc
    global.localStorage = prevLocal
    global.sessionStorage = prevSession
    global.IS_REACT_ACT_ENVIRONMENT = prevAct
  }
})

test('7. Expired session locks gate without wiping stored user library data', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar-web.pages.dev/' })
  const prevWindow = global.window
  const prevDoc = global.document
  const prevLocal = global.localStorage
  const prevSession = global.sessionStorage
  const prevAct = global.IS_REACT_ACT_ENVIRONMENT

  try {
    Object.assign(global, {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      sessionStorage: dom.window.sessionStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
    })

    // User's valuable local library is in storage
    dom.window.localStorage.setItem('gtar_library_v1', JSON.stringify({ version: 1, songs: [{ title: 'Hotel California' }] }))

    // Expired session (> 30 days old)
    const expiredSession = {
      version: 1,
      user: { sub: 'user-sub', email: 'jlopez3rd@gmail.com' },
      authenticatedAt: Date.now() - 40 * 86400000,
      lastVerifiedAt: Date.now() - 40 * 86400000,
      localExpiresAt: Date.now() - 10 * 86400000,
    }
    dom.window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(expiredSession))

    function SongbookApp() {
      return React.createElement('div', { id: 'songbook' }, 'Should Not Render')
    }

    const root = createRoot(dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(SongbookApp)))
    })

    assert.match(dom.window.document.body.textContent, /Owner Access/)
    assert.doesNotMatch(dom.window.document.body.textContent, /Should Not Render/)

    // CRITICAL: Local library data must be 100% intact!
    assert.ok(dom.window.localStorage.getItem('gtar_library_v1'))
    const lib = JSON.parse(dom.window.localStorage.getItem('gtar_library_v1'))
    assert.equal(lib.songs[0].title, 'Hotel California')
    await act(async () => root.unmount())
  } finally {
    dom.window.close()
    global.window = prevWindow
    global.document = prevDoc
    global.localStorage = prevLocal
    global.sessionStorage = prevSession
    global.IS_REACT_ACT_ENVIRONMENT = prevAct
  }
})

test('8. Existing dev loopback bypass remains strictly intact on loopback hosts only', () => {
  assert.equal(allowLocalBypass(true, 'localhost'), true)
  assert.equal(allowLocalBypass(true, '127.0.0.1'), true)
  assert.equal(allowLocalBypass(true, '[::1]'), true)
  assert.equal(allowLocalBypass(true, '::1'), true)

  // Disallowed in non-dev or non-loopback hosts
  assert.equal(allowLocalBypass(false, 'localhost'), false)
  assert.equal(allowLocalBypass(true, 'gtar-web.pages.dev'), false)
  assert.equal(allowLocalBypass(true, 'dev.gtar-web.pages.dev'), false)
  assert.equal(allowLocalBypass(true, '192.168.1.50'), false)
})
