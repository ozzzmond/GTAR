const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    let content = fs.readFileSync(filename, 'utf8')
    content = content.replaceAll('import.meta.env', '({DEV:true,VITE_GOOGLE_CLIENT_ID:"client-id-123"})')
    const transpiled = ts.transpileModule(content, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    })
    module._compile(transpiled.outputText, filename)
  }
}
require.extensions['.png'] = (module) => { module.exports = '/assets/dev-logo.png' }

const { appLogger, redactSensitiveData, STORAGE_KEY } = require('../src/utils/logger.ts')
const React = require('react')
const { renderToString } = require('react-dom/server')
const { AuthGate } = require('../src/components/AuthGate.tsx')

// =========================================================================
// 1. STRICT REDACTION & SECURITY
// =========================================================================
test('redactSensitiveData redacts Bearer tokens, ya29 tokens, secrets, cookies, and auth headers', () => {
  // Bearer tokens
  const bearerInput = 'Authorization failed for Bearer ya29.a0AfH6SMD_secretToken123456789. Test details.'
  const bearerRedacted = redactSensitiveData(bearerInput)
  assert.doesNotMatch(bearerRedacted, /ya29\.a0AfH6SMD/)
  assert.match(bearerRedacted, /Bearer \[REDACTED\]/)

  // Google OAuth access tokens
  const ya29Input = 'Token received: ya29.a0AXooCguABCDEFGHIJKL-123456789_xyz'
  const ya29Redacted = redactSensitiveData(ya29Input)
  assert.doesNotMatch(ya29Redacted, /ya29\./)
  assert.match(ya29Redacted, /\[REDACTED_OAUTH_TOKEN\]/)

  // Access tokens & client secrets in JSON
  const jsonInput = '{"access_token":"secret_access_xyz","client_secret":"GOCSPX-secret123","id_token":"jwt.body.sig"}'
  const jsonRedacted = redactSensitiveData(jsonInput)
  assert.doesNotMatch(jsonRedacted, /secret_access_xyz/)
  assert.doesNotMatch(jsonRedacted, /GOCSPX-secret123/)
  assert.doesNotMatch(jsonRedacted, /jwt\.body\.sig/)
  assert.match(jsonRedacted, /"access_token":"\[REDACTED\]"/)
  assert.match(jsonRedacted, /"client_secret":"\[REDACTED\]"/)
  assert.match(jsonRedacted, /"id_token":"\[REDACTED\]"/)

  // Access tokens & client secrets in URL query strings
  const queryInput = 'https://example.com/oauth?access_token=secret_xyz&client_secret=sec_abc123'
  const queryRedacted = redactSensitiveData(queryInput)
  assert.doesNotMatch(queryRedacted, /secret_xyz/)
  assert.doesNotMatch(queryRedacted, /sec_abc123/)
  assert.match(queryRedacted, /access_token=\[REDACTED\]/)
  assert.match(queryRedacted, /client_secret=\[REDACTED\]/)

  // Authorization headers
  const headerInput = 'Failed fetch: Authorization: Bearer token-value-xyz\r\nHost: example.com'
  const headerRedacted = redactSensitiveData(headerInput)
  assert.doesNotMatch(headerRedacted, /token-value-xyz/)
  assert.match(headerRedacted, /Authorization: \[REDACTED\]/)

  // Auth cookies
  const cookieInput = 'Headers: Cookie: session=abc123secret; auth_token=tok456\r\nAccept: */*'
  const cookieRedacted = redactSensitiveData(cookieInput)
  assert.doesNotMatch(cookieRedacted, /abc123secret/)
  assert.match(cookieRedacted, /Cookie: \[REDACTED\]/)
})

test('appLogger sanitizes entries when added and when exported', () => {
  appLogger.clearLogs()

  // Log error containing sensitive OAuth tokens and secrets
  appLogger.error('AuthTest', 'Sign-in failed with token: ya29.a0AXooCgu123456 and secret client_secret=very_secret_key', new Error('Stack with Bearer my-raw-bearer-token'))

  const logs = appLogger.getLogs()
  const entry = logs.find(l => l.tag === 'AuthTest')
  assert.ok(entry, 'Log entry should be recorded')
  assert.doesNotMatch(entry.message, /ya29\./)
  assert.doesNotMatch(entry.message, /very_secret_key/)
  assert.match(entry.message, /\[REDACTED_OAUTH_TOKEN\]/)
  assert.match(entry.message, /client_secret=\[REDACTED\]/)
  if (entry.stack) {
    assert.doesNotMatch(entry.stack, /my-raw-bearer-token/)
    assert.match(entry.stack, /Bearer \[REDACTED\]/)
  }

  const exported = appLogger.exportLogsAsText()
  assert.doesNotMatch(exported, /ya29\./)
  assert.doesNotMatch(exported, /very_secret_key/)
  assert.doesNotMatch(exported, /my-raw-bearer-token/)
})

// =========================================================================
// 2. CLEAR LOGS SAFETY: ZERO IMPACT ON CANONICAL LIBRARY DATA
// =========================================================================
test('clearLogs safely deletes only gtar_web_debug_logs without mutating library data', () => {
  const store = new Map()
  const prevLocalStorage = global.localStorage

  global.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  }

  try {
    // Setup canonical library and other app data
    const mockLibrary = JSON.stringify({ songs: [{ id: 's1', title: 'Protected Song' }], setlists: [] })
    global.localStorage.setItem('gtar_library', mockLibrary)
    global.localStorage.setItem('gtar_songs_store', mockLibrary)
    global.localStorage.setItem('gtar_setlists_store', '[]')
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: '1', message: 'test log' }]))

    assert.ok(global.localStorage.getItem('gtar_library'))
    assert.ok(global.localStorage.getItem(STORAGE_KEY))

    // Clear logs
    appLogger.clearLogs()

    // Debug logs should be wiped
    assert.equal(global.localStorage.getItem(STORAGE_KEY), null)
    assert.equal(appLogger.getLogs().length, 0)

    // Canonical library and other stores MUST remain completely intact
    assert.equal(global.localStorage.getItem('gtar_library'), mockLibrary)
    assert.equal(global.localStorage.getItem('gtar_songs_store'), mockLibrary)
    assert.equal(global.localStorage.getItem('gtar_setlists_store'), '[]')
  } finally {
    global.localStorage = prevLocalStorage
  }
})

// =========================================================================
// 3. ZERO SYSTEM DEPENDENCY (OFFLINE / NO GOOGLE / NO DRIVE SDK)
// =========================================================================
test('logger and debug log export work with zero Google SDK, zero Drive SDK, and offline', () => {
  const prevWindow = global.window
  const prevGoogle = global.google

  // Ensure window.google is completely undefined
  delete global.google
  global.window = {
    navigator: { onLine: false, userAgent: 'Node-Test-Offline' },
  }

  try {
    appLogger.clearLogs()
    appLogger.warn('Network', 'Offline mode active. No Google SDK loaded.')
    appLogger.error('AuthGate', 'Sign-in cancelled or popup blocked.')

    const logs = appLogger.getLogs()
    assert.equal(logs.length, 2)
    assert.equal(logs[0].tag, 'Network')
    assert.equal(logs[1].tag, 'AuthGate')

    const exported = appLogger.exportLogsAsText()
    assert.match(exported, /GTAR WEB DEBUG LOG EXPORT/)
    assert.match(exported, /Offline mode active/)
    assert.match(exported, /Sign-in cancelled or popup blocked/)
  } finally {
    global.window = prevWindow
    if (prevGoogle) global.google = prevGoogle
  }
})

// =========================================================================
// 4. ENVIRONMENT FLAG GATING ON AUTHGATE SCREEN
// =========================================================================
function compileAuthGateWithEnv(envObj) {
  const authGatePath = require.resolve('../src/components/AuthGate.tsx')
  delete require.cache[authGatePath]
  const envStr = JSON.stringify(envObj)
  const prevExt = require.extensions['.tsx']
  require.extensions['.tsx'] = (module, filename) => {
    let content = fs.readFileSync(filename, 'utf8')
    content = content.replaceAll('import.meta.env', `(${envStr})`)
    const transpiled = ts.transpileModule(content, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    })
    module._compile(transpiled.outputText, filename)
  }
  const { AuthGate: Component } = require('../src/components/AuthGate.tsx')
  require.extensions['.tsx'] = prevExt
  return Component
}

test('1. Vite DEV mode -> "View Debug Logs" trigger is visible', () => {
  const DevAuthGate = compileAuthGateWithEnv({ DEV: true, VITE_GOOGLE_CLIENT_ID: 'client-id-123' })
  const html = renderToString(React.createElement(DevAuthGate, null, React.createElement('div', null, 'Secret App')))
  assert.match(html, /View Debug Logs/)
  assert.doesNotMatch(html, /Secret App/)
})

test('2. Production build + VITE_ENABLE_DEV_LOGS=true -> "View Debug Logs" trigger is visible', () => {
  const ProdWithFlagAuthGate = compileAuthGateWithEnv({
    DEV: false,
    VITE_ENABLE_DEV_LOGS: 'true',
    VITE_GOOGLE_CLIENT_ID: 'client-id-123',
  })
  const html = renderToString(React.createElement(ProdWithFlagAuthGate, null, React.createElement('div', null, 'Secret App')))
  assert.match(html, /View Debug Logs/)
  assert.doesNotMatch(html, /Secret App/)
})

test('3. Production build + flag absent or false -> "View Debug Logs" trigger is strictly hidden', () => {
  // Case 3a: Flag absent
  const ProdNoFlagAuthGate = compileAuthGateWithEnv({
    DEV: false,
    VITE_GOOGLE_CLIENT_ID: 'client-id-123',
  })
  const htmlNoFlag = renderToString(React.createElement(ProdNoFlagAuthGate, null, React.createElement('div', null, 'Secret App')))
  assert.doesNotMatch(htmlNoFlag, /View Debug Logs/)
  assert.doesNotMatch(htmlNoFlag, /Secret App/)

  // Case 3b: Flag explicitly 'false'
  const ProdFalseFlagAuthGate = compileAuthGateWithEnv({
    DEV: false,
    VITE_ENABLE_DEV_LOGS: 'false',
    VITE_GOOGLE_CLIENT_ID: 'client-id-123',
  })
  const htmlFalseFlag = renderToString(React.createElement(ProdFalseFlagAuthGate, null, React.createElement('div', null, 'Secret App')))
  assert.doesNotMatch(htmlFalseFlag, /View Debug Logs/)
  assert.doesNotMatch(htmlFalseFlag, /Secret App/)
})

// =========================================================================
// 5. PRE-AUTH ERROR CAPTURE ON SIGN-IN FAILURE / POPUP BLOCKED
// =========================================================================
test('pre-auth errors (popup blocked, offline) are recorded in appLogger', () => {
  appLogger.clearLogs()

  // Simulate popup blocked error event
  appLogger.error('AuthGate', 'Google sign-in attempt failed: Sign-in cancelled or popup blocked.')

  // Simulate offline GIS script load failure
  appLogger.warn('AuthGate', 'Google Identity Services script load failed (offline or blocked).', 'NetworkError: Failed to fetch')

  const entries = appLogger.getLogs()
  const popupEntry = entries.find(e => e.message.includes('popup blocked'))
  assert.ok(popupEntry, 'Popup blocked error must be logged')
  assert.equal(popupEntry.level, 'ERROR')

  const offlineEntry = entries.find(e => e.message.includes('Google Identity Services'))
  assert.ok(offlineEntry, 'Offline GIS script load warning must be logged')
  assert.equal(offlineEntry.level, 'WARN')
})
