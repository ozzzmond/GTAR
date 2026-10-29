const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs
          .readFileSync(filename, 'utf8')
          .replaceAll('import.meta.env', '({DEV:true,VITE_GOOGLE_CLIENT_ID:"test-client-id"})'),
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
const { createRoot } = require('react-dom/client')
const { JSDOM } = require('jsdom')

const { AuthGate, useGoogleAuth } = require('../src/components/AuthGate.tsx')
const {
  requestGoogleCredential,
  resetGoogleIdentityLoader,
  initializeGoogleIdentity,
  GooglePromptSuppressedError,
  GooglePromptDismissedError,
  isPromptSuppressedOrDismissed,
  createDurableSession,
  saveGoogleSession,
  SESSION_STORAGE_KEY,
} = require('../src/utils/googleAuth.ts')

function setupTestEnvironment() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173' })
  const previous = Object.fromEntries(
    ['window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'].map(
      (k) => [k, global[k]]
    )
  )

  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })

  resetGoogleIdentityLoader()

  let gisInitCallback = null
  let gisInitCount = 0
  let gisPromptListener = null
  let buttonCredential = 'mock-gis-button-jwt-credential'

  dom.window.google = {
    accounts: {
      id: {
        initialize(config) {
          gisInitCount++
          gisInitCallback = config.callback
        },
        prompt(listener) {
          gisPromptListener = listener
        },
        renderButton(container, options) {
          if (container) {
            container.innerHTML = '<button type="button" aria-label="Sign in with Google">Sign in with Google</button>'
            const btn = container.querySelector('button')
            btn.onclick = () => {
              if (options?.click_listener) options.click_listener()
              if (gisInitCallback) {
                gisInitCallback({ credential: buttonCredential })
              }
            }
          }
        },
        cancel() {},
      },
    },
  }

  const teardown = () => {
    dom.window.close()
    Object.assign(global, previous)
    resetGoogleIdentityLoader()
  }

  return {
    dom,
    teardown,
    getGisInitCallback: () => gisInitCallback,
    getGisInitCount: () => gisInitCount,
    getGisPromptListener: () => gisPromptListener,
    setGisInitCallback: (cb) => {
      gisInitCallback = cb
    },
    setGisPromptListener: (l) => {
      gisPromptListener = l
    },
    setButtonCredential: (token) => {
      buttonCredential = token
    },
  }
}

function ChildApp() {
  const auth = useGoogleAuth()
  if (!auth.session) {
    return React.createElement('div', { id: 'signed-out-core' }, 'GTAR Core (Signed Out)')
  }
  return React.createElement(
    'div',
    { id: 'protected-app' },
    `Protected Songbook Unlocked: ${auth.session?.user?.email || ''}`
  )
}

test('TEST_ONETAP_SUCCESS: One Tap prompt returns credential and unlocks AuthGate with server-verified session', async () => {
  const env = setupTestEnvironment()
  let sessionApiCalled = false

  global.fetch = async (url, init) => {
    if (String(url).includes('/api/auth/session') && init?.method === 'POST') {
      sessionApiCalled = true
      return new Response(
        JSON.stringify({
          success: true,
          sessionToken: 'onetap-valid-token',
          user: {
            id: 'usr-onetap',
            google_sub: 'sub-onetap',
            email: 'onetap@example.com',
            display_name: 'One Tap User',
            role: 'member',
            access_status: 'active',
          },
        }),
        { status: 200 }
      )
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }

  try {
    const root = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(ChildApp)))
    })

    const callback = env.getGisInitCallback()
    assert.ok(callback, 'GIS callback must be registered')

    await act(async () => {
      callback({ credential: 'mock-onetap-jwt-credential' })
    })

    assert.equal(sessionApiCalled, true, 'POST /api/auth/session must be called')
    assert.ok(
      env.dom.window.document.getElementById('protected-app'),
      'Child app must be rendered after successful One Tap login'
    )
    const stored = JSON.parse(env.dom.window.localStorage.getItem(SESSION_STORAGE_KEY))
    assert.equal(stored.sessionToken, 'onetap-valid-token')
    assert.equal(stored.user.email, 'onetap@example.com')

    await act(async () => root.unmount())
  } finally {
    env.teardown()
  }
})

test('TEST_ONETAP_COOLDOWN_FALLBACK: Cooldown onetap.card.prompt.cooldown.2 rejects promptly without 60s hang; GIS button remains fully functional and unlocks app', async () => {
  const env = setupTestEnvironment()
  env.setButtonCredential('cooldown-fallback-token')

  env.dom.window.google.accounts.id.prompt = (listener) => {
    if (listener) {
      listener({
        isNotDisplayed: () => true,
        getNotDisplayedReason: () => 'suppressed_by_user',
        isSkippedMoment: () => false,
        isDismissedMoment: () => false,
      })
    }
  }

  global.fetch = async (url, init) => {
    if (String(url).includes('/api/auth/session') && init?.method === 'POST') {
      return new Response(
        JSON.stringify({
          success: true,
          sessionToken: 'cooldown-session-token',
          user: {
            id: 'usr-cooldown',
            google_sub: 'sub-cooldown',
            email: 'cooldown@example.com',
            role: 'member',
            access_status: 'active',
          },
        }),
        { status: 200 }
      )
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }

  try {
    const startTime = Date.now()
    await assert.rejects(
      async () => {
        await requestGoogleCredential('test-client-id')
      },
      (err) => {
        assert.ok(err instanceof GooglePromptSuppressedError)
        assert.equal(err.reason, 'suppressed_by_user')
        assert.ok(isPromptSuppressedOrDismissed(err))
        return true
      }
    )
    const elapsed = Date.now() - startTime
    assert.ok(elapsed < 2000, `Must reject promptly instead of hanging 60s (took ${elapsed}ms)`)

    const root = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(ChildApp)))
    })

    const signInBtn = Array.from(env.dom.window.document.querySelectorAll('button')).find((b) =>
      /Sign in with Google/i.test(b.textContent || '')
    )
    assert.ok(signInBtn, 'GIS Sign In button must be rendered')
    assert.equal(signInBtn.disabled, false, 'GIS Sign In button must not be disabled')

    // Click GIS button during One Tap cooldown -> authentication succeeds!
    await act(async () => {
      signInBtn.click()
    })

    assert.ok(
      env.dom.window.document.getElementById('protected-app'),
      'Child app must unlock via GIS button even when One Tap is in cooldown'
    )
    const statusMsg = env.dom.window.document.querySelector('[role="status"]')
    assert.doesNotMatch(
      statusMsg?.textContent || '',
      /Sign-in failed/i,
      'Prompt cooldown must not display false Sign-in failed error'
    )

    await act(async () => root.unmount())
  } finally {
    env.teardown()
  }
})

test('TEST_ONETAP_NOT_DISPLAYED: Handles opt_out_or_no_session promptly and cleanly', async () => {
  const env = setupTestEnvironment()

  env.dom.window.google.accounts.id.prompt = (listener) => {
    if (listener) {
      listener({
        isNotDisplayed: () => true,
        getNotDisplayedReason: () => 'opt_out_or_no_session',
        isSkippedMoment: () => false,
        isDismissedMoment: () => false,
      })
    }
  }

  try {
    await assert.rejects(
      async () => {
        await requestGoogleCredential('test-client-id')
      },
      (err) => {
        assert.ok(err instanceof GooglePromptSuppressedError)
        assert.equal(err.reason, 'opt_out_or_no_session')
        return true
      }
    )
  } finally {
    env.teardown()
  }
})

test('TEST_ONETAP_SKIPPED: Handles user_cancel and tap_outside promptly', async () => {
  const env = setupTestEnvironment()

  env.dom.window.google.accounts.id.prompt = (listener) => {
    if (listener) {
      listener({
        isNotDisplayed: () => false,
        isSkippedMoment: () => true,
        getSkippedReason: () => 'tap_outside',
        isDismissedMoment: () => false,
      })
    }
  }

  try {
    await assert.rejects(
      async () => {
        await requestGoogleCredential('test-client-id')
      },
      (err) => {
        assert.ok(err instanceof GooglePromptSuppressedError)
        assert.equal(err.reason, 'tap_outside')
        return true
      }
    )
  } finally {
    env.teardown()
  }
})

test('TEST_ONETAP_DISMISSED: Handles dismissal without treating it as fatal backend failure', async () => {
  const env = setupTestEnvironment()

  env.dom.window.google.accounts.id.prompt = (listener) => {
    if (listener) {
      listener({
        isNotDisplayed: () => false,
        isSkippedMoment: () => false,
        isDismissedMoment: () => true,
        getDismissedReason: () => 'cancel',
      })
    }
  }

  try {
    await assert.rejects(
      async () => {
        await requestGoogleCredential('test-client-id')
      },
      (err) => {
        assert.ok(err instanceof GooglePromptDismissedError)
        assert.equal(err.reason, 'cancel')
        return true
      }
    )
  } finally {
    env.teardown()
  }
})

test('TEST_GIS_SCRIPT_FAILURE: Script load failure does not block Core app mount', async () => {
  const env = setupTestEnvironment()
  delete env.dom.window.google

  const originalAppend = env.dom.window.document.head.appendChild.bind(env.dom.window.document.head)
  env.dom.window.document.head.appendChild = (el) => {
    if (el.tagName === 'SCRIPT') {
      setTimeout(() => {
        el.onerror?.(new Event('error'))
      }, 5)
    }
    return originalAppend(el)
  }

  try {
    const root = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(ChildApp)))
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    assert.ok(env.dom.window.document.getElementById('signed-out-core'), 'Signed-out Core mounts even if GIS script fails')

    await act(async () => root.unmount())
  } finally {
    env.teardown()
  }
})

test('TEST_MANUAL_SIGNIN_BUTTON: Official GIS button triggers authentication exchange and unlocks app without requiring One Tap prompt', async () => {
  const env = setupTestEnvironment()
  let promptCalled = false
  env.setButtonCredential('manual-id-token')

  env.dom.window.google.accounts.id.prompt = () => {
    promptCalled = true
  }

  global.fetch = async (url, init) => {
    if (String(url).includes('/api/auth/session') && init?.method === 'POST') {
      return new Response(
        JSON.stringify({
          success: true,
          sessionToken: 'manual-session-token',
          user: {
            id: 'usr-manual',
            google_sub: 'sub-manual',
            email: 'manual@example.com',
            role: 'member',
            access_status: 'active',
          },
        }),
        { status: 200 }
      )
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }

  try {
    const root = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(ChildApp)))
    })

    const gisContainer = env.dom.window.document.getElementById('google-signin-button')
    assert.ok(gisContainer, '#google-signin-button container must be in DOM')

    const signInBtn = gisContainer.querySelector('button')
    assert.ok(signInBtn, 'Official GIS button must be rendered inside container')

    await act(async () => {
      signInBtn.click()
    })

    assert.equal(promptCalled, false, 'One Tap prompt must NOT be required for manual button authentication')
    assert.ok(env.dom.window.document.getElementById('protected-app'), 'Child app must unlock on GIS button click')

    await act(async () => root.unmount())
  } finally {
    env.teardown()
  }
})

test('TEST_RETRY_AFTER_FAILURE: Server failure displays error, retry succeeds and unlocks AuthGate', async () => {
  const env = setupTestEnvironment()
  let shouldFail = true
  env.setButtonCredential('retry-token')

  global.fetch = async (url, init) => {
    if (String(url).includes('/api/auth/session') && init?.method === 'POST') {
      if (shouldFail) {
        return new Response(
          JSON.stringify({ success: false, error: 'Database connection failed' }),
          { status: 500 }
        )
      }
      return new Response(
        JSON.stringify({
          success: true,
          sessionToken: 'recovered-session-token',
          user: {
            id: 'usr-retry',
            google_sub: 'sub-retry',
            email: 'retry@example.com',
            role: 'admin',
            access_status: 'active',
          },
        }),
        { status: 200 }
      )
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }

  try {
    const root = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(ChildApp)))
    })

    const signInBtn = Array.from(env.dom.window.document.querySelectorAll('button')).find((b) =>
      /Sign in with Google/i.test(b.textContent || '')
    )

    // Attempt 1: Server fails
    await act(async () => {
      signInBtn.click()
    })

    assert.equal(env.dom.window.document.getElementById('protected-app'), null)
    assert.match(env.dom.window.document.body.textContent || '', /Database connection failed/)

    // Attempt 2: Server recovers
    shouldFail = false
    await act(async () => {
      signInBtn.click()
    })

    assert.ok(
      env.dom.window.document.getElementById('protected-app'),
      'Child app must unlock on successful retry'
    )

    await act(async () => root.unmount())
  } finally {
    env.teardown()
  }
})

test('TEST_NO_DUPLICATE_SESSION_EXCHANGE: Concurrent credential responses trigger exactly one session exchange', async () => {
  const env = setupTestEnvironment()
  let exchangeCount = 0

  global.fetch = async (url, init) => {
    if (String(url).includes('/api/auth/session') && init?.method === 'POST') {
      exchangeCount++
      await new Promise((r) => setTimeout(r, 10))
      return new Response(
        JSON.stringify({
          success: true,
          sessionToken: 'dedup-session-token',
          user: {
            id: 'usr-dedup',
            google_sub: 'sub-dedup',
            email: 'dedup@example.com',
            role: 'member',
            access_status: 'active',
          },
        }),
        { status: 200 }
      )
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }

  try {
    const root = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(ChildApp)))
    })

    const callback = env.getGisInitCallback()
    assert.ok(callback)

    // Dispatch two identical credential responses concurrently
    await act(async () => {
      callback({ credential: 'same-jwt-token' })
      callback({ credential: 'same-jwt-token' })
      await new Promise((r) => setTimeout(r, 40))
    })

    assert.equal(exchangeCount, 1, 'Deduplication must prevent duplicate session API requests')
    assert.ok(env.dom.window.document.getElementById('protected-app'))

    await act(async () => root.unmount())
  } finally {
    env.teardown()
  }
})

test('TEST_STALE_CALLBACK_PROTECTION: Slow exchange completed after user signs out is discarded', async () => {
  const env = setupTestEnvironment()
  let resolveSessionApi
  const sessionPromise = new Promise((resolve) => {
    resolveSessionApi = resolve
  })

  global.fetch = async (url, init) => {
    if (String(url).includes('/api/auth/session') && init?.method === 'POST') {
      await sessionPromise
      return new Response(
        JSON.stringify({
          success: true,
          sessionToken: 'stale-token',
          user: {
            id: 'usr-stale',
            google_sub: 'sub-stale',
            email: 'stale@example.com',
            role: 'member',
            access_status: 'active',
          },
        }),
        { status: 200 }
      )
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }

  try {
    const root = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(ChildApp)))
    })

    const callback = env.getGisInitCallback()
    assert.ok(callback)

    // Start slow sign-in
    await act(async () => {
      callback({ credential: 'slow-id-token' })
    })

    // User unmounts before slow response arrives
    await act(async () => {
      root.unmount()
    })

    // Resolve delayed response
    resolveSessionApi()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40))
    })

    // Verify localStorage has not stored the stale session
    assert.equal(env.dom.window.localStorage.getItem(SESSION_STORAGE_KEY), null)
  } finally {
    env.teardown()
  }
})

test('TEST_ACCOUNT_SWITCHING: Sign out followed by sign-in switches account identity cleanly', async () => {
  const env = setupTestEnvironment()
  let currentUser = {
    id: 'usr-alice',
    google_sub: 'sub-alice',
    email: 'alice@example.com',
    role: 'member',
    access_status: 'active',
  }

  global.fetch = async (url, init) => {
    if (String(url).includes('/api/auth/session') && init?.method === 'POST') {
      return new Response(
        JSON.stringify({
          success: true,
          sessionToken: `token-${currentUser.id}`,
          user: currentUser,
        }),
        { status: 200 }
      )
    }
    if (String(url).includes('/api/auth/logout')) {
      return new Response(JSON.stringify({ success: true, revoked: true }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }

  try {
    let auth
    function ContextProbe() {
      auth = useGoogleAuth()
      return React.createElement('div', { id: 'probe' }, auth.session?.user?.email)
    }

    const root = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(ContextProbe)))
    })

    // Sign in Alice
    await act(async () => {
      env.getGisInitCallback()({ credential: 'token-alice' })
    })
    assert.equal(auth.session?.user?.email, 'alice@example.com')

    // Sign out
    await act(async () => {
      auth.signOut()
    })
    assert.equal(auth.session, null, 'Session is null upon signOut')
    assert.equal(env.dom.window.document.getElementById('probe').textContent, '', 'Child probe remains mounted in signed-out state')
    assert.equal(env.dom.window.localStorage.getItem(SESSION_STORAGE_KEY), null)

    // Sign in Bob
    currentUser = {
      id: 'usr-bob',
      google_sub: 'sub-bob',
      email: 'bob@example.com',
      role: 'admin',
      access_status: 'active',
    }
    await act(async () => {
      env.getGisInitCallback()({ credential: 'token-bob' })
    })
    assert.ok(env.dom.window.document.getElementById('probe'), 'Child probe mounted for Bob')
    assert.equal(auth.session?.user?.email, 'bob@example.com')
    assert.equal(auth.role, 'SUPER_ADMIN')

    await act(async () => root.unmount())
  } finally {
    env.teardown()
  }
})

test('TEST_LOGOUT_AND_SESSION_EXPIRY: Sign out revokes session and expired session allows Core startup without auth', async () => {
  const env = setupTestEnvironment()

  global.fetch = async (url, init) => {
    if (String(url).includes('/api/auth/logout') && init?.method === 'POST') {
      return new Response(JSON.stringify({ success: true, revoked: true }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }

  // Pre-seed expired durable session
  const expiredSession = createDurableSession(
    {
      id: 'usr-exp',
      sub: 'sub-exp',
      email: 'expired@example.com',
      role: 'member',
      access_status: 'active',
    },
    undefined,
    Date.now() - 31 * 86400 * 1000,
    {
      sessionToken: 'expired-token',
      role: 'member',
      access_status: 'active',
    }
  )
  saveGoogleSession(expiredSession)

  try {
    const root = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(ChildApp)))
    })

    // Expired offline session does NOT block Core
    assert.equal(env.dom.window.document.getElementById('protected-app'), null)
    assert.ok(env.dom.window.document.getElementById('signed-out-core'), 'Signed-out Core mounts on expired session')

    await act(async () => root.unmount())
  } finally {
    env.teardown()
  }
})

test('TEST_REVOKED_AND_PENDING_ACCESS: Pending accounts show pending screen and denied accounts show access denied', async () => {
  const env = setupTestEnvironment()

  global.fetch = async () => {
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }

  try {
    // 1. Pending session
    const pendingSession = createDurableSession(
      {
        id: 'usr-pending',
        sub: 'sub-pending',
        email: 'pending@example.com',
        role: 'member',
        access_status: 'pending',
      },
      undefined,
      Date.now(),
      {
        sessionToken: 'pending-token',
        role: 'member',
        access_status: 'pending',
      }
    )
    saveGoogleSession(pendingSession)

    const root = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(ChildApp)))
    })

    assert.match(env.dom.window.document.body.textContent || '', /Access Approval Pending/)
    const checkStatusBtn = Array.from(env.dom.window.document.querySelectorAll('button')).find((b) =>
      /Check Status/i.test(b.textContent || '')
    )
    assert.ok(checkStatusBtn, 'Check Status button must be present on pending screen')
    await act(async () => root.unmount())

    // 2. Denied session
    const deniedSession = createDurableSession(
      {
        id: 'usr-denied',
        sub: 'sub-denied',
        email: 'denied@example.com',
        role: 'member',
        access_status: 'denied',
      },
      undefined,
      Date.now(),
      {
        sessionToken: 'denied-token',
        role: 'member',
        access_status: 'denied',
      }
    )
    saveGoogleSession(deniedSession)

    const root2 = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => {
      root2.render(React.createElement(AuthGate, null, React.createElement(ChildApp)))
    })

    assert.match(env.dom.window.document.body.textContent || '', /Access Denied/)

    await act(async () => root2.unmount())
  } finally {
    env.teardown()
  }
})

test('TEST_AUTH_SESSION_API_FAILURE: Server rejection shows specific error and prevents invalid session storage', async () => {
  const env = setupTestEnvironment()

  global.fetch = async (url, init) => {
    if (String(url).includes('/api/auth/session') && init?.method === 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized domain' }),
        { status: 403 }
      )
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }

  try {
    const root = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(ChildApp)))
    })

    await act(async () => {
      env.getGisInitCallback()({ credential: 'unauthorized-token' })
    })

    assert.equal(env.dom.window.document.getElementById('protected-app'), null)
    assert.match(env.dom.window.document.body.textContent || '', /Unauthorized domain/)
    assert.equal(env.dom.window.localStorage.getItem(SESSION_STORAGE_KEY), null)

    await act(async () => root.unmount())
  } finally {
    env.teardown()
  }
})

test('TEST_KEYBOARD_AND_MOBILE_COMPATIBILITY: Sign-in buttons and GIS container are accessible and touch-friendly', async () => {
  const env = setupTestEnvironment()

  try {
    const root = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(ChildApp)))
    })

    const gisContainer = env.dom.window.document.getElementById('google-signin-button')
    assert.ok(gisContainer, '#google-signin-button container must be in DOM')
    assert.equal(
      gisContainer.getAttribute('aria-label'),
      'Google Sign-In',
      'Container must have descriptive aria-label'
    )
    assert.ok(
      gisContainer.className.includes('min-h-[44px]'),
      'Container must meet minimum 44px touch target guidelines'
    )

    const manualBtn = Array.from(env.dom.window.document.querySelectorAll('button')).find((b) =>
      /Sign in with Google/i.test(b.textContent || '')
    )
    assert.ok(manualBtn, 'Manual button must be a native <button>')
    assert.equal(manualBtn.tagName, 'BUTTON', 'Must be interactive button element for keyboard accessibility')

    await act(async () => root.unmount())
  } finally {
    env.teardown()
  }
})

test('TEST_INITIALIZE_ONCE_AND_LISTENERS (#238): initialize runs once per client id; handlers come from addCredentialListener and are removable', async () => {
  const env = setupTestEnvironment()
  const { addCredentialListener } = require('../src/utils/googleAuth.ts')
  const seen = []
  try {
    const off1 = addCredentialListener(res => seen.push(['a', res.credential]))
    addCredentialListener(res => seen.push(['b', res.credential]))
    assert.equal(initializeGoogleIdentity({ client_id: 'test-client-id' }), true)
    assert.equal(initializeGoogleIdentity({ client_id: 'test-client-id' }), true, 'second call is a no-op that still reports ready')
    assert.equal(env.getGisInitCount(), 1, 'GIS initialize() called once')
    env.getGisInitCallback()({ credential: 'test-token' })
    assert.deepEqual(seen, [['a', 'test-token'], ['b', 'test-token']])
    off1()
    env.getGisInitCallback()({ credential: 'again' })
    assert.deepEqual(seen.slice(2), [['b', 'again']], 'a removed listener is not called')
    initializeGoogleIdentity({ client_id: 'other-client-id' })
    assert.equal(env.getGisInitCount(), 2, 'a different client id initializes again')
  } finally {
    env.teardown()
  }
})

test('TEST_AUTHGATE_SIGNOUT_SIGNIN_CYCLE (#238): sign in, sign out, sign in: initialize once, one session request per credential', async () => {
  const env = setupTestEnvironment()
  let posts = 0
  global.fetch = async (url, init) => {
    if (String(url).includes('/api/auth/session') && init?.method === 'POST') {
      posts++
      return new Response(JSON.stringify({ success: true, sessionToken: `token-${posts}`,
        user: { id: 'usr-1', google_sub: 'sub-1', email: 'one@example.com', role: 'member', access_status: 'active' } }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: true, revoked: true }), { status: 200 })
  }
  try {
    let auth
    function Probe() { auth = useGoogleAuth(); return React.createElement('div', { id: 'probe' }) }
    const root = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => { root.render(React.createElement(AuthGate, null, React.createElement(Probe))) })
    for (let round = 1; round <= 3; round++) {
      await act(async () => { env.getGisInitCallback()({ credential: `cred-${round}` }) })
      assert.ok(env.dom.window.document.getElementById('probe'), `signed in, round ${round}`)
      assert.equal(posts, round, 'one session request per credential')
      await act(async () => { auth.signOut() })
      await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    }
    assert.equal(env.getGisInitCount(), 1, 'GIS initialize() called once across the sign-out / sign-in cycles')
    await act(async () => root.unmount())
  } finally {
    env.teardown()
  }
})

test('TEST_NO_DUPLICATE_CONTROLS: Only the official GIS button is displayed; duplicate legacy button is suppressed', async () => {
  const env = setupTestEnvironment()

  try {
    const root = createRoot(env.dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthGate, null, React.createElement(ChildApp)))
    })

    const buttons = Array.from(env.dom.window.document.querySelectorAll('button')).filter((b) =>
      /Sign in with Google/i.test(b.textContent || b.getAttribute('aria-label') || '')
    )
    assert.equal(buttons.length, 1, 'Exactly one primary Google Sign-In control must be rendered')
    assert.ok(
      env.dom.window.document.getElementById('google-signin-button')?.contains(buttons[0]),
      'Rendered button must reside inside #google-signin-button'
    )

    await act(async () => root.unmount())
  } finally {
    env.teardown()
  }
})
