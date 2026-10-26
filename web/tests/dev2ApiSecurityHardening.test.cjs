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
const songbookMetadata = require('../functions/api/songbook/metadata.ts')
const catalogCore = require('../functions/lib/catalogCore.ts')
const catalogSongId = require('../functions/api/catalog/songs/[id].ts')

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

test('UG_PROXY_AUTH: Anonymous, expired, pending, denied, and missing DB fail closed', async () => {
  const activeUser = {
    id: 'user-active-1',
    google_sub: 'sub-active-1',
    email: 'active@gtar.app',
    role: 'member',
    access_status: 'active',
  }
  const pendingUser = {
    id: 'user-pending-1',
    google_sub: 'sub-pending-1',
    email: 'pending@gtar.app',
    role: 'member',
    access_status: 'pending',
  }
  const deniedUser = {
    id: 'user-denied-1',
    google_sub: 'sub-denied-1',
    email: 'denied@gtar.app',
    role: 'member',
    access_status: 'denied',
  }

  const db = createMockDb([activeUser, pendingUser, deniedUser])

  for (const endpoint of [ugSearch, ugTab]) {
    const url = endpoint === ugSearch
      ? 'https://gtar.local/api/ug-search?q=oasis'
      : 'https://gtar.local/api/ug-tab?url=' + encodeURIComponent('https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-27596')

    // 1. Missing Authorization header -> 401
    const noAuthRes = await endpoint.onRequestGet({
      request: new Request(url),
      env: { DB: db, AUTH_SECRET: TEST_SECRET },
    })
    assert.equal(noAuthRes.status, 401)
    const noAuthJson = await noAuthRes.json()
    assert.match(noAuthJson.error, /Authorization/i)

    // 2. Malformed token -> 401
    const badTokenRes = await endpoint.onRequestGet({
      request: new Request(url, { headers: { Authorization: 'Bearer totally-invalid-token' } }),
      env: { DB: db, AUTH_SECRET: TEST_SECRET },
    })
    assert.equal(badTokenRes.status, 401)

    // 3. Expired token -> 401
    const expiredToken = await createSessionToken(activeUser, TEST_SECRET, 10)
    // Fast-forward past expiry
    const oldNow = Date.now
    try {
      Date.now = () => oldNow() + 1000
      const expiredRes = await endpoint.onRequestGet({
        request: new Request(url, { headers: { Authorization: `Bearer ${expiredToken}` } }),
        env: { DB: db, AUTH_SECRET: TEST_SECRET },
      })
      assert.equal(expiredRes.status, 401)
    } finally {
      Date.now = oldNow
    }

    // 4. Pending user -> 403
    const pendingToken = await createSessionToken(pendingUser, TEST_SECRET, 3600000)
    const pendingRes = await endpoint.onRequestGet({
      request: new Request(url, { headers: { Authorization: `Bearer ${pendingToken}` } }),
      env: { DB: db, AUTH_SECRET: TEST_SECRET },
    })
    assert.equal(pendingRes.status, 403)
    const pendingJson = await pendingRes.json()
    assert.match(pendingJson.error, /approval required/i)

    // 5. Denied user -> 403
    const deniedToken = await createSessionToken(deniedUser, TEST_SECRET, 3600000)
    const deniedRes = await endpoint.onRequestGet({
      request: new Request(url, { headers: { Authorization: `Bearer ${deniedToken}` } }),
      env: { DB: db, AUTH_SECRET: TEST_SECRET },
    })
    assert.equal(deniedRes.status, 403)

    // 6. Missing DB binding -> 500
    const noDbRes = await endpoint.onRequestGet({
      request: new Request(url, { headers: { Authorization: `Bearer ${deniedToken}` } }),
      env: { AUTH_SECRET: TEST_SECRET },
    })
    assert.equal(noDbRes.status, 500)
  }
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

test('ERROR_DISCLOSURE: Proxy and AI metadata routes do not disclose internal stack, tokens or URLs', async () => {
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

      // 3. Workers AI metadata error sanitization
      const failingAi = {
        AI: {
          async run() {
            throw new Error('D1_ERROR: table users column secret_token /usr/local/app.ts leaked')
          },
        },
      }
      const aiReq = new Request('https://gtar.local/api/songbook/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Creep' }),
      })
      const aiRes = await songbookMetadata.onRequestPost({ request: aiReq, env: failingAi })
      assert.equal(aiRes.status, 500)
      const aiJson = await aiRes.json()
      assert.equal(aiJson.success, false)
      assert.equal(aiJson.error, 'Workers AI execution failed: Inference service error')
      assert.ok(!JSON.stringify(aiJson).includes('secret_token'))
      assert.ok(!JSON.stringify(aiJson).includes('/usr/local'))
    } finally {
      authCore.authenticateUserRequest = originalAuth
    }
  } finally {
    global.fetch = previousFetch
  }
})

test('REQUEST_SIZE_BOUNDING: Streaming and byte-level limits enforced across endpoints', async () => {
  const authCore = require('../functions/lib/authCore.ts')
  const originalAuth = authCore.authenticateUserRequest
  authCore.authenticateUserRequest = async () => ({ user: { id: 'usr_test', role: 'member', access_status: 'active' } })

  try {
    // 1. Catalog song write bounded reader (MAX_PAYLOAD_BYTES = 256KB)
    assert.equal(catalogCore.MAX_PAYLOAD_BYTES, 256 * 1024)

    // Over-limit via content-length header
    const overLimitReq1 = new Request('https://gtar.local/api/catalog/songs', {
      method: 'POST',
      headers: { 'content-length': String(256 * 1024 + 1), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A' }),
    })
    const readRes1 = await catalogCore.readJsonBody(overLimitReq1)
    assert.equal(readRes1.status, 413)

    // Over-limit streamed bytes without content-length
    const largeChunk = new Uint8Array(256 * 1024 + 10)
    largeChunk.fill(32) // space characters
    const overLimitReq2 = new Request('https://gtar.local/api/catalog/songs', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"title":"'))
          controller.enqueue(largeChunk)
          controller.enqueue(new TextEncoder().encode('"}'))
          controller.close()
        },
      }),
      duplex: 'half',
    })
    const readRes2 = await catalogCore.readJsonBody(overLimitReq2)
    assert.equal(readRes2.status, 413)

    // Empty body
    const emptyReq = new Request('https://gtar.local/api/catalog/songs', { method: 'POST', body: '   ' })
    const readRes3 = await catalogCore.readJsonBody(emptyReq)
    assert.equal(readRes3.status, 400)
    assert.match(readRes3.error, /empty/i)

    // Malformed JSON
    const malformedReq = new Request('https://gtar.local/api/catalog/songs', { method: 'POST', body: '{invalid-json' })
    const readRes4 = await catalogCore.readJsonBody(malformedReq)
    assert.equal(readRes4.status, 400)
    assert.match(readRes4.error, /Malformed/i)

    // 2. Songbook sync size boundary (MAX_SONGBOOK_PAYLOAD_BYTES = 2MB)
    assert.equal(songbookSync.MAX_SONGBOOK_PAYLOAD_BYTES, 2 * 1024 * 1024)
    const overLimitSync = new Request('https://gtar.local/api/songbook/sync', {
      method: 'POST',
      headers: { 'content-length': String(2 * 1024 * 1024 + 1), 'content-type': 'application/json', 'X-GTAR-Library-Owner': 'usr_test' },
      body: JSON.stringify({ data: { songs: [], setlists: [] } }),
    })
    const syncRes = await songbookSync.onRequestPost({ request: overLimitSync, env: { DB: {} } })
    assert.equal(syncRes.status, 413)

    // 3. Songbook metadata size boundary (MAX_METADATA_PAYLOAD_BYTES = 64KB)
    assert.equal(songbookMetadata.MAX_METADATA_PAYLOAD_BYTES, 64 * 1024)
    const overLimitMeta = new Request('https://gtar.local/api/songbook/metadata', {
      method: 'POST',
      headers: { 'content-length': String(64 * 1024 + 1), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A' }),
    })
    const metaRes = await songbookMetadata.onRequestPost({ request: overLimitMeta, env: { AI: {} } })
    assert.equal(metaRes.status, 413)
  } finally {
    authCore.authenticateUserRequest = originalAuth
  }
})
