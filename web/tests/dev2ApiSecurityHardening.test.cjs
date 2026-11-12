const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
      }).outputText,
      filename
    )
}

const authCore = require('../functions/lib/authCore.ts')
const { createSessionToken } = authCore
const { validateTabUrl, ALLOWED_UG_HOSTS } = require('../src/utils/ugCore.ts')
const ugSearch = require('../functions/api/ug-search.ts')
const ugTab = require('../functions/api/ug-tab.ts')
const songbookSync = require('../functions/api/songbook/sync.ts')

const TEST_SECRET = 'dev2-test-auth-secret-minimum-32-characters-long'

function createMockDb(users = []) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes('FROM users WHERE id = ?')) {
                const u = users.find((user) => user.id === args[0])
                return u || null
              }
              if (sql.includes('FROM users WHERE google_sub = ?')) {
                const u = users.find((user) => user.google_sub === args[0])
                return u || null
              }
              return null
            },
            async all() {
              return { results: [] }
            },
            async run() {
              return { success: true }
            },
          }
        },
      }
    },
  }
}

test('UG_PROXY_OPEN: no account needed; kill switch, input validation and anonymous rate limit stay in force', async () => {
  const { _resetUgGateForTesting } = require('../functions/ugGate.ts')
  const tab = 'https://gtar.local/api/ug-tab?url=' + encodeURIComponent('https://example.com/not-ug')
  for (const headers of [{}, { Authorization: 'Bearer totally-invalid-token' }]) {
    _resetUgGateForTesting()
    // Missing or junk credentials are irrelevant: empty search is a 200 and a non-UG tab URL is refused by host validation, not by auth.
    const search = await ugSearch.onRequestGet({ request: new Request('https://gtar.local/api/ug-search?q=', { headers }), env: {} })
    assert.equal(search.status, 200)
    assert.deepEqual((await search.json()).results, [])
    const bad = await ugTab.onRequestGet({ request: new Request(tab, { headers }), env: {} })
    assert.equal(bad.status, 403)
    assert.match((await bad.json()).error, /Forbidden target host/)
  }
  // Per-deployment kill switch (GTAR1): disabled before any validation or upstream work.
  for (const endpoint of [ugSearch, ugTab]) {
    const off = await endpoint.onRequestGet({ request: new Request('https://gtar.local/api/ug-search?q=oasis'), env: { UG_PROXY_MODE: 'disabled' } })
    assert.equal(off.status, 503)
    assert.equal((await off.json()).error, 'ONLINE_SOURCES_DISABLED')
  }
  // Anonymous per-isolate fallback applies even without the optional distributed limiter.
  _resetUgGateForTesting()
  const statuses = []
  for (let i = 0; i < 61; i++) statuses.push((await ugSearch.onRequestGet({ request: new Request('https://gtar.local/api/ug-search?q='), env: {} })).status)
  assert.equal(statuses.slice(0, 60).every(code => code === 200), true)
  assert.equal(statuses[60], 429)
  _resetUgGateForTesting()
})

test('UG_PROXY_METHOD_ENFORCEMENT: Disallow non-GET/OPTIONS and handle OPTIONS CORS preflight', async () => {
  for (const endpoint of [ugSearch, ugTab]) {
    // OPTIONS returns 204 with CORS
    const optionsRes = await endpoint.onRequestOptions()
    assert.equal(optionsRes.status, 204)
    assert.equal(optionsRes.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS')
    assert.ok(optionsRes.headers.get('Access-Control-Allow-Headers').includes('Authorization'))

    // dispatch via onRequest for OPTIONS
    const dispOptions = await endpoint.onRequest({
      request: new Request('https://gtar.local/api/ug-search', { method: 'OPTIONS' }),
      env: {},
    })
    assert.equal(dispOptions.status, 204)

    // Alternate HTTP methods (POST, PUT, DELETE, PATCH) rejected with 405
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const resp = await endpoint.onRequest({
        request: new Request('https://gtar.local/api/ug-search', { method }),
        env: {},
      })
      assert.equal(resp.status, 405, `Method ${method} should be rejected with 405`)
      assert.equal(resp.headers.get('Allow'), 'GET, OPTIONS')
    }
  }
})

test('EXTERNAL_URL_HARDENING: validateTabUrl enforces strict HTTPS and Ultimate Guitar host boundaries', () => {
  // Safe canonical HTTPS UG tab URLs
  assert.equal(validateTabUrl('https://tabs.ultimate-guitar.com/tab/radiohead/creep-chords-4169').valid, true)
  assert.equal(validateTabUrl('https://www.ultimate-guitar.com/tabs/coldplay_yellow.htm').valid, true)

  // Unsafe schemes rejected
  assert.equal(validateTabUrl('javascript:alert(1)').valid, false)
  assert.equal(validateTabUrl('http://tabs.ultimate-guitar.com/tab/radiohead/creep-chords-4169').valid, false)
  assert.equal(validateTabUrl('file:///etc/passwd').valid, false)
  assert.equal(validateTabUrl('data:text/html,<script>alert(1)</script>').valid, false)

  // Untrusted hosts and spoofing rejected
  assert.equal(validateTabUrl('https://evil-tabs.ultimate-guitar.com/tab').valid, false)
  assert.equal(validateTabUrl('https://tabs.ultimate-guitar.com.evil.com/tab').valid, false)
  assert.equal(validateTabUrl('https://example.com').valid, false)

  // Non-standard port rejected
  assert.equal(validateTabUrl('https://tabs.ultimate-guitar.com:8080/tab').valid, false)

  // Malformed URLs rejected
  assert.equal(validateTabUrl('not a valid url').valid, false)
  assert.equal(validateTabUrl('').valid, false)
  assert.equal(validateTabUrl(null).valid, false)
})

test('ERROR_DISCLOSURE: Proxy routes do not disclose internal stack, tokens or URLs', async () => {
  const previousFetch = global.fetch
  try {
    // 1. UG search throws unexpected internal network error with system paths/tokens
    const { fetchUg } = require('../functions/ugFetch.ts')
    const originalFetchUg = ugSearch.__test_fetchUg || fetchUg

    global.fetch = async () => {
      throw new TypeError('fetch failed at internal /var/run/secrets/token and connection reset to 10.0.0.1:443')
    }

    const authCore = require('../functions/lib/authCore.ts')
    const originalAuth = authCore.authenticateUserRequest
    authCore.authenticateUserRequest = async () => ({ user: { id: 'usr_test', role: 'member', access_status: 'active' } })

    try {
      const searchRes = await ugSearch.onRequestGet({
        request: new Request('https://gtar.local/api/ug-search?q=oasis'),
        env: {},
      })
      assert.equal(searchRes.status, 502)
      const searchJson = await searchRes.json()
      assert.equal(searchJson.success, false)
      assert.equal(searchJson.error, 'Failed to search Ultimate Guitar')
      assert.ok(!JSON.stringify(searchJson).includes('/var/run/secrets'))
      assert.ok(!JSON.stringify(searchJson).includes('10.0.0.1'))

      // 2. UG tab throws unexpected internal network error
      const tabRes = await ugTab.onRequestGet({
        request: new Request('https://gtar.local/api/ug-tab?url=' + encodeURIComponent('https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-27596')),
        env: {},
      })
      assert.equal(tabRes.status, 502)
      const tabJson = await tabRes.json()
      assert.equal(tabJson.success, false)
      assert.equal(tabJson.error, 'Failed to fetch chord sheet from Ultimate Guitar')
      assert.ok(!JSON.stringify(tabJson).includes('/var/run/secrets'))
      assert.ok(!JSON.stringify(tabJson).includes('10.0.0.1'))

    } finally {
      authCore.authenticateUserRequest = originalAuth
    }
  } finally {
    global.fetch = previousFetch
  }
})

