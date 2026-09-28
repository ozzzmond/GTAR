const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs
          .readFileSync(filename, 'utf8')
          .replaceAll(
            'import.meta.env',
            '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client-test-id",VITE_AUTHORIZED_EMAILS:"jlopez3rd@gmail.com",VITE_ROOT_ADMIN_EMAIL:"jlopez3rd@gmail.com"})'
          ),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        }
      ).outputText,
      filename
    )
}
require.extensions['.png'] = (module) => {
  module.exports = '/assets/dev-logo.png'
}

const React = require('react')
const { act } = React
const { JSDOM } = require('jsdom')
const { createRoot } = require('react-dom/client')

const {
  verifyGoogleIdToken,
  isBootstrapAdmin,
  createSessionToken,
  verifySessionToken,
  authenticateAdminRequest,
  insertUser,
  findUserByGoogleSub,
  findUserById,
  updateUserAccessStatus,
  getPendingUsersCount,
  listAllUsers,
} = require('../functions/lib/authCore.ts')

const sessionFunction = require('../functions/api/auth/session.ts')
const usersFunction = require('../functions/api/admin/users.ts')
const pendingCountFunction = require('../functions/api/admin/pending-count.ts')
const approveFunction = require('../functions/api/admin/approve.ts')
const denyFunction = require('../functions/api/admin/deny.ts')
const restoreFunction = require('../functions/api/admin/restore.ts')

const {
  createDurableSession,
  parseStoredSession,
  validSession,
  readGoogleSession,
  saveGoogleSession,
  SESSION_STORAGE_KEY,
} = require('../src/utils/googleAuth.ts')

const { allowLocalBypass } = require('../src/utils/authPolicy.ts')
const { AuthGate } = require('../src/components/AuthGate.tsx')

function createMockD1() {
  const users = new Map()
  return {
    _users: users,
    prepare(sql) {
      let bound = []
      return {
        bind(...args) {
          bound = args
          return this
        },
        async first() {
          if (sql.includes('SELECT * FROM users WHERE google_sub = ?')) {
            const sub = bound[0]
            for (const u of users.values()) {
              if (u.google_sub === sub) return { ...u }
            }
            return null
          }
          if (sql.includes('SELECT * FROM users WHERE id = ?')) {
            const id = bound[0]
            return users.has(id) ? { ...users.get(id) } : null
          }
          if (sql.includes('count(*)')) {
            let c = 0
            for (const u of users.values()) {
              if (u.access_status === 'pending') c++
            }
            return { count: c }
          }
          return null
        },
        async all() {
          const res = Array.from(users.values())
          return { results: res, success: true }
        },
        async run() {
          if (sql.includes('INSERT INTO users')) {
            const [
              id,
              google_sub,
              email,
              display_name,
              picture_url,
              role,
              access_status,
              created_at,
              updated_at,
              last_login_at,
            ] = bound
            users.set(id, {
              id,
              google_sub,
              email,
              display_name,
              picture_url,
              role,
              access_status,
              created_at,
              updated_at,
              last_login_at,
            })
            return { success: true }
          }
          if (sql.includes('UPDATE users SET access_status = ?')) {
            const [status, updated_at, id] = bound
            if (users.has(id)) {
              users.get(id).access_status = status
              users.get(id).updated_at = updated_at
            }
            return { success: true }
          }
          if (sql.includes('UPDATE users\n       SET email = ?')) {
            const [email, display_name, picture_url, updated_at, last_login_at, id] = bound
            if (users.has(id)) {
              const u = users.get(id)
              u.email = email
              if (display_name) u.display_name = display_name
              if (picture_url) u.picture_url = picture_url
              u.updated_at = updated_at
              u.last_login_at = last_login_at
            }
            return { success: true }
          }
          return { success: true }
        },
      }
    },
  }
}

// 1. TARGETED: AUTH_IDENTITY_VERIFICATION
test('TARGETED: AUTH_IDENTITY_VERIFICATION verifies issuer, audience, expiration, and extracts verified google_sub', async () => {
  const env = {
    GOOGLE_CLIENT_ID: 'client-test-id',
    TEST_MOCK_AUTH: 'true',
  }

  // Valid test token
  const validProfile = await verifyGoogleIdToken(
    'test_token:sub_12345:musician@gmail.com:Musician Bob',
    env
  )
  assert.equal(validProfile.sub, 'sub_12345')
  assert.equal(validProfile.email, 'musician@gmail.com')
  assert.equal(validProfile.name, 'Musician Bob')
  assert.equal(validProfile.email_verified, true)

  // Empty or invalid tokens rejected
  await assert.rejects(verifyGoogleIdToken('', env), /missing or invalid/)
  await assert.rejects(verifyGoogleIdToken('invalid.jwt', env), /Malformed JWT/)

  // Issuer verification on real JWT structure
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key-1' })).toString('base64url')
  const expiredPayload = Buffer.from(
    JSON.stringify({
      iss: 'accounts.google.com',
      aud: 'client-test-id',
      sub: 'sub-expired',
      email: 'expired@gmail.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) - 100,
    })
  ).toString('base64url')
  await assert.rejects(
    verifyGoogleIdToken(`${headerB64}.${expiredPayload}.signature`, env),
    /expired/
  )

  const wrongIssuerPayload = Buffer.from(
    JSON.stringify({
      iss: 'https://evil-issuer.com',
      aud: 'client-test-id',
      sub: 'sub-evil',
      email: 'evil@gmail.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString('base64url')
  await assert.rejects(
    verifyGoogleIdToken(`${headerB64}.${wrongIssuerPayload}.signature`, env),
    /Invalid token issuer/
  )
})

// 2. TARGETED: BOOTSTRAP_ADMIN
test('TARGETED: BOOTSTRAP_ADMIN creates admin/active on explicit server match, first-login-wins forbidden', async () => {
  const db = createMockD1()
  const env = {
    DB: db,
    BOOTSTRAP_ADMIN_GOOGLE_SUB: 'bootstrap_google_sub_owner',
    BOOTSTRAP_ADMIN_EMAIL: 'owner@gtar.app',
    TEST_MOCK_AUTH: 'true',
    AUTH_SECRET: 'test-secret',
  }

  // 1. First user to log in is NOT bootstrap admin -> must NOT become admin (first-login-wins forbidden)
  const reqUser1 = new Request('http://localhost/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken: 'test_token:sub_stranger:stranger@gmail.com:Stranger',
    }),
  })
  const resUser1 = await sessionFunction.onRequestPost({ request: reqUser1, env })
  assert.equal(resUser1.status, 200)
  const dataUser1 = await resUser1.json()
  assert.equal(dataUser1.user.role, 'member')
  assert.equal(dataUser1.user.access_status, 'pending')

  // 2. Explicit bootstrap admin logs in -> gets role=admin, access_status=active
  const reqAdmin = new Request('http://localhost/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken: 'test_token:bootstrap_google_sub_owner:owner@gtar.app:App Owner',
    }),
  })
  const resAdmin = await sessionFunction.onRequestPost({ request: reqAdmin, env })
  assert.equal(resAdmin.status, 200)
  const dataAdmin = await resAdmin.json()
  assert.equal(dataAdmin.user.role, 'admin')
  assert.equal(dataAdmin.user.access_status, 'active')
})

// 3. TARGETED: NEW_MEMBER_PENDING
test('TARGETED: NEW_MEMBER_PENDING default new user created with role=member and access_status=pending', async () => {
  const db = createMockD1()
  const env = {
    DB: db,
    BOOTSTRAP_ADMIN_EMAIL: 'root@gtar.app',
    TEST_MOCK_AUTH: 'true',
    AUTH_SECRET: 'test-secret',
  }

  const req = new Request('http://localhost/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken: 'test_token:sub_guitarist_99:guitarist@gmail.com:Guitar Guy',
    }),
  })
  const res = await sessionFunction.onRequestPost({ request: req, env })
  assert.equal(res.status, 200)
  const data = await res.json()

  assert.equal(data.user.role, 'member')
  assert.equal(data.user.access_status, 'pending')
  assert.equal(data.user.email, 'guitarist@gmail.com')
  assert.ok(data.user.id)
  assert.ok(data.sessionToken)
})

// 4. TARGETED: ACTIVE_ACCESS
test('TARGETED: ACTIVE_ACCESS allows application rendering for users with access_status=active', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar-web.pages.dev/' })
  const activeSession = createDurableSession(
    {
      id: 'usr-1',
      sub: 'google-sub-1',
      email: 'jlopez3rd@gmail.com',
      role: 'admin',
      access_status: 'active',
    },
    'token-xyz'
  )

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

    dom.window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(activeSession))

    let rendered = false
    function AppContent() {
      rendered = true
      return React.createElement('div', { id: 'app-root' }, 'Songbook Ready')
    }

    const root = createRoot(dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(AppContent)))
    })

    assert.equal(rendered, true)
    assert.match(dom.window.document.body.textContent, /Songbook Ready/)
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

// 5. TARGETED: DENIED_ACCESS
test('TARGETED: DENIED_ACCESS renders access denied state and blocks app access', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar-web.pages.dev/' })
  const deniedSession = createDurableSession(
    {
      id: 'usr-denied',
      sub: 'google-sub-bad',
      email: 'denied@example.com',
      role: 'member',
      access_status: 'denied',
    },
    'token-xyz',
    Date.now(),
    { access_status: 'denied', role: 'member' }
  )

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

    dom.window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(deniedSession))

    let rendered = false
    function AppContent() {
      rendered = true
      return React.createElement('div', { id: 'app-root' }, 'Songbook Ready')
    }

    const root = createRoot(dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(AppContent)))
    })

    assert.equal(rendered, false)
    assert.match(dom.window.document.body.textContent, /Access Denied/)
    assert.match(dom.window.document.body.textContent, /Sign Out/)
    assert.doesNotMatch(dom.window.document.body.textContent, /Songbook Ready/)
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

// 6. TARGETED: ADMIN_APPROVE_DENY
test('TARGETED: ADMIN_APPROVE_DENY enables admin to approve, deny, and restore users', async () => {
  const db = createMockD1()
  const env = {
    DB: db,
    AUTH_SECRET: 'test-secret',
  }

  // Populate admin and pending member in D1
  const adminUser = {
    id: 'admin-1',
    google_sub: 'sub-admin',
    email: 'admin@gtar.app',
    display_name: 'Admin',
    picture_url: null,
    role: 'admin',
    access_status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  }
  const pendingUser = {
    id: 'user-pending-1',
    google_sub: 'sub-pending-1',
    email: 'newbie@gtar.app',
    display_name: 'Newbie',
    picture_url: null,
    role: 'member',
    access_status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  }
  await insertUser(db, adminUser)
  await insertUser(db, pendingUser)

  const adminToken = await createSessionToken(adminUser, env.AUTH_SECRET)

  // 1. Approve pending user
  const reqApprove = new Request('http://localhost/api/admin/approve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ userId: 'user-pending-1' }),
  })
  const resApprove = await approveFunction.onRequestPost({ request: reqApprove, env })
  assert.equal(resApprove.status, 200)

  const afterApprove = await findUserById(db, 'user-pending-1')
  assert.equal(afterApprove.access_status, 'active')
  assert.equal(afterApprove.role, 'member') // Role escalation forbidden

  // 2. Deny active user
  const reqDeny = new Request('http://localhost/api/admin/deny', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ userId: 'user-pending-1' }),
  })
  const resDeny = await denyFunction.onRequestPost({ request: reqDeny, env })
  assert.equal(resDeny.status, 200)

  const afterDeny = await findUserById(db, 'user-pending-1')
  assert.equal(afterDeny.access_status, 'denied')

  // 3. Restore denied user
  const reqRestore = new Request('http://localhost/api/admin/restore', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ userId: 'user-pending-1' }),
  })
  const resRestore = await restoreFunction.onRequestPost({ request: reqRestore, env })
  assert.equal(resRestore.status, 200)

  const afterRestore = await findUserById(db, 'user-pending-1')
  assert.equal(afterRestore.access_status, 'active')

  // 4. Admin cannot deny themselves
  const reqSelfDeny = new Request('http://localhost/api/admin/deny', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ userId: 'admin-1' }),
  })
  const resSelfDeny = await denyFunction.onRequestPost({ request: reqSelfDeny, env })
  assert.equal(resSelfDeny.status, 400)
  const errSelf = await resSelfDeny.json()
  assert.match(errSelf.error, /forbidden|cannot/i)
})

// 7. TARGETED: NON_ADMIN_ADMIN_API_REJECTION
test('TARGETED: NON_ADMIN_ADMIN_API_REJECTION non-admin or unauthenticated callers rejected', async () => {
  const db = createMockD1()
  const env = {
    DB: db,
    AUTH_SECRET: 'test-secret',
  }

  const memberUser = {
    id: 'member-1',
    google_sub: 'sub-member',
    email: 'member@gtar.app',
    display_name: 'Member',
    picture_url: null,
    role: 'member',
    access_status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  }
  await insertUser(db, memberUser)
  const memberToken = await createSessionToken(memberUser, env.AUTH_SECRET)

  // 1. Unauthenticated request -> 401
  const reqUnauth = new Request('http://localhost/api/admin/users', { method: 'GET' })
  const resUnauth = await usersFunction.onRequestGet({ request: reqUnauth, env })
  assert.equal(resUnauth.status, 401)

  // 2. Member request to admin list -> 403 Forbidden
  const reqMember = new Request('http://localhost/api/admin/users', {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` },
  })
  const resMember = await usersFunction.onRequestGet({ request: reqMember, env })
  assert.equal(resMember.status, 403)

  // 3. Member request to approve endpoint -> 403 Forbidden
  const reqApprove = new Request('http://localhost/api/admin/approve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberToken}`,
    },
    body: JSON.stringify({ userId: 'some-user' }),
  })
  const resApprove = await approveFunction.onRequestPost({ request: reqApprove, env })
  assert.equal(resApprove.status, 403)
})

// 8. TARGETED: PENDING_STATUS_CHECK
test('TARGETED: PENDING_STATUS_CHECK returns pending state and transitions to active when approved', async () => {
  const db = createMockD1()
  const env = {
    DB: db,
    AUTH_SECRET: 'test-secret',
  }

  const user = {
    id: 'user-check-1',
    google_sub: 'sub-check-1',
    email: 'waiting@gtar.app',
    display_name: 'Waiting User',
    picture_url: null,
    role: 'member',
    access_status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  }
  await insertUser(db, user)
  const token = await createSessionToken(user, env.AUTH_SECRET)

  // Status check while pending
  const req1 = new Request('http://localhost/api/auth/session', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const res1 = await sessionFunction.onRequestGet({ request: req1, env })
  assert.equal(res1.status, 200)
  const data1 = await res1.json()
  assert.equal(data1.user.access_status, 'pending')

  // Update in D1 to active
  await updateUserAccessStatus(db, 'user-check-1', 'active', new Date().toISOString())

  // Status check after approval
  const res2 = await sessionFunction.onRequestGet({ request: req1, env })
  assert.equal(res2.status, 200)
  const data2 = await res2.json()
  assert.equal(data2.user.access_status, 'active')
})

// 9. TARGETED: PROFILE_PENDING_BADGE & 10. TARGETED: GREEN_STATUS_DOT_PRESERVED
test('TARGETED: PROFILE_PENDING_BADGE and GREEN_STATUS_DOT_PRESERVED', async () => {
  const { Header } = require('../src/components/Header.tsx')
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar-web.pages.dev/' })

  const adminSession = createDurableSession(
    {
      id: 'admin-1',
      sub: 'google-sub-admin',
      email: 'jlopez3rd@gmail.com',
      role: 'admin',
      access_status: 'active',
    },
    'token-admin',
    Date.now(),
    {
      sessionToken: 'admin-session-token',
      role: 'admin',
      access_status: 'active',
    }
  )

  const prevWindow = global.window
  const prevDoc = global.document
  const prevLocal = global.localStorage
  const prevSession = global.sessionStorage
  const prevAct = global.IS_REACT_ACT_ENVIRONMENT
  const prevFetch = global.fetch

  // Mock server returning pendingCount = 3
  global.fetch = async (url) => {
    if (String(url).includes('/api/admin/pending-count')) {
      return new Response(JSON.stringify({ success: true, count: 3 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }

  dom.window.matchMedia = dom.window.matchMedia || function() {
    return {
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }
  }

  try {
    Object.assign(global, {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      sessionStorage: dom.window.sessionStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
    })

    dom.window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(adminSession))

    const root = createRoot(dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(
        React.createElement(
          AuthGate,
          null,
          React.createElement(Header, {
            activeView: 'songbook',
            onViewChange: () => {},
            song: { id: 1, title: 'Test Song' },
            searchQuery: '',
            onSearchQueryChange: () => {},
            onOpenWebsiteUrlSource: () => {},
            onOpenStageTools: () => {},
            onToggleTheme: () => {},
            onOpenStageSettings: () => {},
            onOpenImportModal: () => {},
            onOpenBackupRestoreModal: () => {},
          })
        )
      )
    })

    // Allow pending-count fetch effect to run and update state
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    const bodyHtml = dom.window.document.body.innerHTML

    // 1. Verify avatar-wrapper exists
    assert.match(bodyHtml, /avatar-wrapper/)

    // 2. Verify green status dot auth-dot synced is preserved at lower-right
    assert.match(bodyHtml, /auth-dot synced/)

    // 3. Verify pending notification badge with count=3 is rendered
    assert.match(bodyHtml, /pending-badge/)
    assert.match(dom.window.document.querySelector('.pending-badge')?.textContent || '', /3/)

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

// 11. TARGETED: OFFLINE_ACTIVE_SESSION
test('TARGETED: OFFLINE_ACTIVE_SESSION keeps existing 30-day session active offline without network', () => {
  const t0 = Date.now()
  const session = createDurableSession(
    {
      id: 'usr-offline',
      sub: 'google-sub-offline',
      email: 'offline@musician.com',
      role: 'member',
      access_status: 'active',
    },
    'cached-token',
    t0
  )

  assert.equal(validSession(session), true)
  const parsed = parseStoredSession(session)
  assert.equal(parsed.session.access_status, 'active')
  assert.equal(parsed.isExpired, false)

  // Corrupting local network does not invalidate valid session
  const prevFetch = global.fetch
  global.fetch = () => Promise.reject(new Error('Network offline'))
  try {
    assert.equal(validSession(session), true)
  } finally {
    global.fetch = prevFetch
  }
})

// 12. TARGETED: LOOPBACK_DEV_BYPASS_CONTAINMENT
test('TARGETED: LOOPBACK_DEV_BYPASS_CONTAINMENT strictly confined to dev loopback, no server admin authority', () => {
  // Loopback allowed only for dev=true on localhost/127.0.0.1/[::1]
  assert.equal(allowLocalBypass(true, 'localhost'), true)
  assert.equal(allowLocalBypass(true, '127.0.0.1'), true)
  assert.equal(allowLocalBypass(true, '[::1]'), true)
  assert.equal(allowLocalBypass(true, '::1'), true)

  // Rejected for production or remote hosts
  assert.equal(allowLocalBypass(false, 'localhost'), false)
  assert.equal(allowLocalBypass(true, 'gtar-web.pages.dev'), false)
  assert.equal(allowLocalBypass(true, 'dev.gtar-web.pages.dev'), false)
  assert.equal(allowLocalBypass(true, '192.168.1.100'), false)

  // Dev bypass does not generate a signed D1 server token
  const db = createMockD1()
  const env = { DB: db, AUTH_SECRET: 'test-secret' }
  const reqBypass = new Request('http://localhost/api/admin/users', {
    method: 'GET',
    headers: { Authorization: 'Bearer dev_bypass_token' },
  })
  return usersFunction.onRequestGet({ request: reqBypass, env }).then((res) => {
    assert.equal(res.status, 401)
  })
})
