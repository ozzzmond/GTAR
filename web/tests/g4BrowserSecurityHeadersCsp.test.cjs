const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
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

const securityHeaders = require('../functions/lib/securityHeaders.ts')
const authCore = require('../functions/lib/authCore.ts')
const abuseProtection = require('../functions/lib/abuseProtection.ts')
const sessionApi = require('../functions/api/auth/session.ts')
const syncApi = require('../functions/api/songbook/sync.ts')
const metadataApi = require('../functions/api/songbook/metadata.ts')
const shareApi = require('../functions/api/setlist/share.ts')
const songsApi = require('../functions/api/catalog/songs.ts')
const songIdApi = require('../functions/api/catalog/songs/[id].ts')
const ugSearchApi = require('../functions/api/ug-search.ts')
const ugTabApi = require('../functions/api/ug-tab.ts')
const middleware = require('../functions/_middleware.ts')
const { generateQrSvgDataUri } = require('../src/utils/qrCode.ts')

const TEST_SECRET = 'g4-test-auth-secret-minimum-32-characters-secure'

function parseHeadersFile(content) {
  const rules = new Map()
  let currentPath = null
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      currentPath = trimmed
      if (!rules.has(currentPath)) rules.set(currentPath, {})
    } else if (currentPath) {
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx > 0) {
        const headerName = trimmed.slice(0, colonIdx).trim()
        const headerVal = trimmed.slice(colonIdx + 1).trim()
        rules.get(currentPath)[headerName] = headerVal
      }
    }
  }
  return rules
}

function parseCspSources(csp) {
  const directives = new Map()
  for (const directive of csp.split(';')) {
    const [name, ...sources] = directive.trim().split(/\s+/)
    if (!name) continue
    assert.ok(!directives.has(name), `Duplicate CSP directive: ${name}`)
    directives.set(name, new Set(sources))
  }
  return directives
}

function createMockDb(users = [], shares = new Map(), songbooks = new Map()) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes('FROM users WHERE id = ?')) {
                const u = users.find((user) => user.id === args[0])
                return u ? { ...u } : null
              }
              if (sql.includes('FROM users WHERE google_sub = ?')) {
                const u = users.find((user) => user.google_sub === args[0])
                return u ? { ...u } : null
              }
              if (sql.includes('FROM shared_setlists WHERE share_token = ?')) {
                const s = shares.get(args[0])
                return s ? { ...s } : null
              }
              if (sql.includes('FROM user_songbooks WHERE user_id = ?')) {
                const sb = songbooks.get(args[0])
                return sb ? { ...sb } : null
              }
              if (sql.includes('INSERT INTO user_songbooks') || sql.includes('UPDATE user_songbooks')) {
                return { version: 1, checksum: args[1] || 'ck_mock', updated_at: new Date().toISOString() }
              }
              return null
            },
            async all() {
              if (sql.includes('FROM catalog_songs')) {
                return { results: [], success: true }
              }
              return { results: [], success: true }
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

// ---------------------------------------------------------------------------
// 1. Static Headers & Cloudflare Pages Configuration
// ---------------------------------------------------------------------------
test('1. STATIC_HEADERS_FILE_COVERAGE: Cloudflare Pages _headers definition integrity', () => {
  const headersPath = path.resolve(__dirname, '../public/_headers')
  assert.ok(fs.existsSync(headersPath), 'web/public/_headers must exist')
  const content = fs.readFileSync(headersPath, 'utf8')
  const rules = parseHeadersFile(content)

  assert.ok(rules.has('/*'), 'Must contain global /* rules')
  const globalHeaders = rules.get('/*')

  // Mandatory safe browser security headers
  assert.equal(globalHeaders['X-Content-Type-Options'], 'nosniff')
  assert.equal(globalHeaders['Referrer-Policy'], 'strict-origin-when-cross-origin')
  assert.equal(globalHeaders['X-Frame-Options'], 'DENY')

  // Permissions-Policy
  const perm = globalHeaders['Permissions-Policy']
  assert.ok(perm, 'Permissions-Policy must be defined')
  assert.ok(perm.includes('camera=(self)'), 'Must allow camera for QR scanning')
  assert.ok(perm.includes('clipboard-read=(self)'), 'Must allow clipboard-read for chord editing')
  assert.ok(perm.includes('clipboard-write=(self)'), 'Must allow clipboard-write for sharing and backup')
  assert.ok(perm.includes('fullscreen=(self)'), 'Must allow fullscreen for stage teleprompter')
  assert.ok(perm.includes('screen-wake-lock=(self)'), 'Must allow screen-wake-lock for stage mode')
  assert.ok(perm.includes('geolocation=()'), 'Must restrict geolocation')
  assert.ok(perm.includes('microphone=()'), 'Must restrict microphone')
  assert.ok(perm.includes('payment=()'), 'Must restrict payment')
  assert.ok(perm.includes('usb=()'), 'Must restrict usb')

  // #160: CSP is enforced (DEV field QA 2026-10-24); no Report-Only copy remains
  assert.equal(globalHeaders['Content-Security-Policy-Report-Only'], undefined, 'Report-Only header replaced by the enforced policy')
  const csp = globalHeaders['Content-Security-Policy']
  assert.ok(csp, 'Content-Security-Policy must be defined')

  const directives = parseCspSources(csp)

  // Check required directives
  assert.deepEqual(directives.get('default-src'), new Set(["'self'"]), 'default-src must be self')
  assert.deepEqual(directives.get('script-src'), new Set(["'self'", 'https://accounts.google.com', 'https://apis.google.com']), 'script-src must explicitly permit GIS')
  assert.deepEqual(directives.get('style-src'), new Set(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com']), 'style-src must allow inline CSS variables and Google Fonts')
  assert.deepEqual(directives.get('font-src'), new Set(["'self'", 'data:', 'https://fonts.gstatic.com']), 'font-src must permit Google Fonts CDN and data URIs')
  assert.deepEqual(directives.get('img-src'), new Set(["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com', 'https://accounts.google.com', 'https://ssl.gstatic.com']), 'img-src must permit data QR, blobs, and Google avatars')
  assert.deepEqual(directives.get('connect-src'), new Set(["'self'", 'https://accounts.google.com', 'https://www.googleapis.com', 'ws:', 'wss:']), 'connect-src must permit GIS, OAuth userinfo, and BandSync WebSockets')
  assert.deepEqual(directives.get('frame-src'), new Set(['https://accounts.google.com']), 'frame-src must permit GIS One-Tap/FedCM iframes')
  assert.deepEqual(directives.get('frame-ancestors'), new Set(["'none'"]), "frame-ancestors must be 'none'")
  assert.deepEqual(directives.get('object-src'), new Set(["'none'"]), "object-src must be 'none'")
  assert.deepEqual(directives.get('base-uri'), new Set(["'self'"]), "base-uri must be 'self'")
  assert.deepEqual(directives.get('form-action'), new Set(["'self'"]), "form-action must be 'self'")
  assert.deepEqual(directives.get('worker-src'), new Set(["'self'", 'blob:']), "worker-src must allow service worker and blobs")
  assert.deepEqual(directives.get('manifest-src'), new Set(["'self'"]), "manifest-src must allow web app manifest")

  // Strictness guards
  assert.ok(![...directives.values()].some((sources) => sources.has("'unsafe-eval'")), 'Must NOT contain unsafe-eval')
  assert.ok(!directives.get('script-src').has('*'), 'Must NOT wildcard script-src')
  assert.ok(!directives.get('connect-src').has('*'), 'Must NOT wildcard connect-src')

  // Cache-Control for PWA lifecycle assets
  assert.ok(rules.has('/index.html'), 'Must configure /index.html')
  assert.equal(rules.get('/index.html')['Cache-Control'], 'no-cache')

  assert.ok(rules.has('/sw.js'), 'Must configure /sw.js')
  assert.equal(rules.get('/sw.js')['Cache-Control'], 'no-cache')

  assert.ok(rules.has('/manifest.webmanifest'), 'Must configure /manifest.webmanifest')
  assert.equal(rules.get('/manifest.webmanifest')['Cache-Control'], 'no-cache')
  assert.ok(rules.get('/manifest.webmanifest')['Content-Type'].includes('application/manifest+json'))

  assert.ok(rules.has('/assets/*'), 'Must configure /assets/* for immutable caching')
  assert.equal(rules.get('/assets/*')['Cache-Control'], 'public, max-age=31536000, immutable')
})

test('2. BUILD_DISTRIBUTION_DIST_HEADERS: Verify Vite emits _headers to dist root', () => {
  const distHeadersPath = path.resolve(__dirname, '../dist/_headers')
  if (fs.existsSync(distHeadersPath)) {
    const distContent = fs.readFileSync(distHeadersPath, 'utf8')
    assert.ok(distContent.includes('X-Content-Type-Options: nosniff'))
    assert.ok(distContent.includes('Content-Security-Policy:'))
    assert.ok(distContent.includes('X-Frame-Options: DENY'))
  }
})

// ---------------------------------------------------------------------------
// 2. Shared Security Headers Library & Helpers
// ---------------------------------------------------------------------------
test('3. SECURITY_HEADERS_HELPER_UNIT_TESTS: Verification of functions/lib/securityHeaders.ts', () => {
  const { API_SECURITY_HEADERS, STATIC_SECURITY_HEADERS, withApiSecurityHeaders, applySecurityHeadersToResponse } = securityHeaders

  assert.equal(API_SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff')
  assert.equal(API_SECURITY_HEADERS['Referrer-Policy'], 'strict-origin-when-cross-origin')
  assert.equal(API_SECURITY_HEADERS['X-Frame-Options'], 'DENY')
  assert.ok(STATIC_SECURITY_HEADERS['Content-Security-Policy'])

  // Helper withApiSecurityHeaders preserves existing headers and injects missing ones
  const headers = withApiSecurityHeaders({
    'Content-Type': 'application/json',
    'Custom-Header': 'gtar-test',
  })
  assert.equal(headers.get('content-type'), 'application/json')
  assert.equal(headers.get('custom-header'), 'gtar-test')
  assert.equal(headers.get('x-content-type-options'), 'nosniff')
  assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
  assert.equal(headers.get('x-frame-options'), 'DENY')

  // Helper applySecurityHeadersToResponse does not mutate existing status or body
  const originalRes = new Response(JSON.stringify({ ok: true }), {
    status: 201,
    statusText: 'Created',
    headers: { 'Cache-Control': 'no-store' },
  })
  const securedRes = applySecurityHeadersToResponse(originalRes)
  assert.equal(securedRes.status, 201)
  assert.equal(securedRes.statusText, 'Created')
  assert.equal(securedRes.headers.get('cache-control'), 'no-store')
  assert.equal(securedRes.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(securedRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
  assert.equal(securedRes.headers.get('x-frame-options'), 'DENY')
})

// ---------------------------------------------------------------------------
// 3. Functions Response Headers Coverage Across Status Codes
// ---------------------------------------------------------------------------
test('4. FUNCTIONS_RESPONSE_SECURITY_HEADERS: 200, 204, 400, 401, 403, 404, 409, 410, 413, 429, 500, 503', async () => {
  const testUser = {
    id: 'user-001',
    google_sub: 'sub-001',
    email: 'musician@example.com',
    role: 'member',
    access_status: 'active',
  }
  const db = createMockDb([testUser])
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }
  const validToken = await authCore.createSessionToken(testUser, TEST_SECRET)

  function assertSecurityHeaders(res, label) {
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', `${label} missing nosniff`)
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', `${label} missing referrer-policy`)
    assert.equal(res.headers.get('x-frame-options'), 'DENY', `${label} missing x-frame-options`)
    assert.equal(res.headers.get('access-control-allow-origin'), null, `${label} must not grant cross-origin reads`)
  }

  // 204: OPTIONS Preflight
  const optRes1 = await sessionApi.onRequestOptions()
  assert.equal(optRes1.status, 204)
  assertSecurityHeaders(optRes1, '204 session options')

  const optRes2 = await shareApi.onRequestOptions()
  assert.equal(optRes2.status, 204)
  assertSecurityHeaders(optRes2, '204 share options')

  const optRes3 = await songIdApi.onRequestOptions()
  assert.equal(optRes3.status, 204)
  assertSecurityHeaders(optRes3, '204 songId options')

  // 400: Bad Request / Malformed JSON
  const badReqRes = await sessionApi.onRequestPost({
    request: new Request('http://localhost/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json',
    }),
    env,
  })
  assert.equal(badReqRes.status, 400)
  assertSecurityHeaders(badReqRes, '400 bad request')

  // 401: Unauthorized (no token)
  const unauthReq = new Request('http://localhost/api/setlist/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setlistName: 'Show', songs: [] }),
  })
  const unauthRes = await shareApi.onRequestPost({ request: unauthReq, env })
  assert.equal(unauthRes.status, 401)
  assertSecurityHeaders(unauthRes, '401 unauthenticated')

  // 403: Forbidden (non-owner revocation)
  const shareMap = new Map()
  shareMap.set('0123456789abcdef0123456789abcdef', {
    share_token: '0123456789abcdef0123456789abcdef',
    creator_user_id: 'other-user',
    payload_json: JSON.stringify({ name: 'Setlist' }),
    revoked_at: null,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  })
  const dbWithShare = createMockDb([testUser], shareMap)
  const nonOwnerReq = new Request('http://localhost/api/setlist/revoke', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validToken}`,
    },
    body: JSON.stringify({ token: '0123456789abcdef0123456789abcdef' }),
  })
  const nonOwnerRes = await shareApi.handleRevokeShare(nonOwnerReq, { DB: dbWithShare, AUTH_SECRET: TEST_SECRET })
  assert.equal(nonOwnerRes.status, 403)
  assertSecurityHeaders(nonOwnerRes, '403 forbidden')

  // 404: Not Found (share not found)
  const notFoundReq = new Request('http://localhost/api/setlist/share?token=fedcba9876543210fedcba9876543210', {
    headers: { Authorization: `Bearer ${validToken}` },
  })
  const notFoundRes = await shareApi.onRequestGet({ request: notFoundReq, env })
  assert.equal(notFoundRes.status, 404)
  assertSecurityHeaders(notFoundRes, '404 not found')

  // 409: Conflict (CAS Songbook Revision Conflict)
  const songbookMap = new Map()
  songbookMap.set('user-001', {
    user_id: 'user-001',
    version: 5,
    checksum: 'ck_curr_5',
    encrypted_data: 'enc_data',
    updated_at: new Date().toISOString(),
  })
  const dbWithSongbook = createMockDb([testUser], new Map(), songbookMap)
  const conflictReq = new Request('http://localhost/api/songbook/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validToken}`,
    },
    body: JSON.stringify({
      data: { songs: [{ title: 'Wonderwall', rawContent: 'Em7 G Dsus4 A7sus4' }], setlists: [] },
      expectedChecksum: 'invalid_checksum',
      expectedVersion: 5,
    }),
  })
  const conflictRes = await syncApi.onRequestPost({ request: conflictReq, env: { DB: dbWithSongbook, AUTH_SECRET: TEST_SECRET } })
  assert.equal(conflictRes.status, 409)
  assertSecurityHeaders(conflictRes, '409 conflict')

  // 410: Gone (Revoked Share)
  shareMap.set('abcdef0123456789abcdef0123456789', {
    share_token: 'abcdef0123456789abcdef0123456789',
    creator_user_id: testUser.id,
    payload_json: JSON.stringify({ name: 'Setlist' }),
    is_revoked: 1,
    revoked_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  })
  const revokedReq = new Request('http://localhost/api/setlist/share?token=abcdef0123456789abcdef0123456789', {
    headers: { Authorization: `Bearer ${validToken}` },
  })
  const revokedRes = await shareApi.onRequestGet({ request: revokedReq, env: { DB: dbWithShare, AUTH_SECRET: TEST_SECRET } })
  assert.equal(revokedRes.status, 410)
  assertSecurityHeaders(revokedRes, '410 revoked share')

  // 413: Payload Too Large
  const largePayload = 'a'.repeat(33 * 1024)
  const largeReq = new Request('http://localhost/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: largePayload }),
  })
  const largeRes = await sessionApi.onRequestPost({ request: largeReq, env })
  assert.equal(largeRes.status, 413)
  assertSecurityHeaders(largeRes, '413 payload too large')

  // 429: Rate Limit Exceeded (with Retry-After semantics)
  const abuse429Res = abuseProtection.abuseResponse(429, 60)
  assert.equal(abuse429Res.status, 429)
  assertSecurityHeaders(abuse429Res, '429 rate limit')
  assert.equal(abuse429Res.headers.get('retry-after'), '60')
  assert.equal(abuse429Res.headers.get('access-control-expose-headers'), 'Retry-After')
  assert.equal(abuse429Res.headers.get('cache-control'), 'no-store')

  // 500: Internal Server Error (Database unavailable)
  const error500Res = await sessionApi.onRequestPost({
    request: new Request('http://localhost/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'valid-looking-token' }),
    }),
    env: { DB: undefined, AUTH_SECRET: TEST_SECRET },
  })
  assert.equal(error500Res.status, 500)
  assertSecurityHeaders(error500Res, '500 database unconfigured')

  // 503: Service Unavailable
  const error503Res = await sessionApi.onRequestPost({
    request: new Request('http://localhost/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'valid-looking-token' }),
    }),
    env: { DB: db, AUTH_SECRET: '' },
  })
  assert.equal(error503Res.status, 503)
  assertSecurityHeaders(error503Res, '503 service unavailable')
})

// ---------------------------------------------------------------------------
// 4. Cloudflare Pages Functions Middleware Verification
// ---------------------------------------------------------------------------
test('5. PAGES_FUNCTIONS_MIDDLEWARE: Uniform edge response enhancement without duplication', async () => {
  // Test case A: Unadorned Response returned by an edge handler
  const unadornedRes = new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
  const edgeRes = await middleware.onRequest({
    request: new Request('http://localhost/api/health'),
    next: async () => unadornedRes,
  })
  assert.equal(edgeRes.status, 200)
  assert.equal(edgeRes.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(edgeRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
  assert.equal(edgeRes.headers.get('x-frame-options'), 'DENY')
  assert.equal(edgeRes.headers.get('content-type'), 'application/json; charset=utf-8')

  // Test case B: Response that already has headers - middleware must not duplicate or clobber
  const alreadySecuredRes = new Response(JSON.stringify({ custom: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Retry-After': '120',
    },
  })
  const preservedRes = await middleware.onRequest({
    request: new Request('http://localhost/api/test'),
    next: async () => alreadySecuredRes,
  })
  assert.equal(preservedRes.headers.get('retry-after'), '120')
  assert.equal(preservedRes.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(preservedRes.headers.get('x-frame-options'), 'DENY')
})

// ---------------------------------------------------------------------------
// 5. Verification of Integration Assumptions & Compatibility Guards
// ---------------------------------------------------------------------------
test('6. COMPATIBILITY_GUARDS: Preserves Google Auth, QR, StageCast, and BandSync requirements', () => {
  // 1. QR Code Data URI compatibility
  const qrUri = generateQrSvgDataUri('https://gtar.app/setlists/shared#token=1234567890abcdef1234567890abcdef')
  assert.ok(qrUri.startsWith('data:image/svg+xml;utf8,'), 'QR generator produces data URI')
  // Verify CSP img-src allows data:
  const headersPath = path.resolve(__dirname, '../public/_headers')
  const content = fs.readFileSync(headersPath, 'utf8')
  const rules = parseHeadersFile(content)
  const csp = rules.get('/*')['Content-Security-Policy']
  const directives = parseCspSources(csp)
  assert.ok(directives.get('img-src').has('data:'), 'CSP must allow data: in img-src for QR codes')

  // 2. Google Identity Services script & frame compatibility
  assert.ok(directives.get('script-src').has('https://accounts.google.com'), 'CSP must allow accounts.google.com in script-src')
  assert.ok(directives.get('frame-src').has('https://accounts.google.com'), 'CSP must allow accounts.google.com in frame-src')
  assert.ok(directives.get('connect-src').has('https://accounts.google.com'), 'CSP must allow accounts.google.com in connect-src')
  assert.ok(directives.get('connect-src').has('https://www.googleapis.com'), 'CSP must allow www.googleapis.com in connect-src')

  // 3. BandSync WebSocket compatibility
  assert.ok(directives.get('connect-src').has('ws:') && directives.get('connect-src').has('wss:'), 'CSP must allow ws: and wss: for local leader BandSync')

  // 4. Google Fonts CDN compatibility
  assert.ok(directives.get('style-src').has('https://fonts.googleapis.com'), 'CSP must allow fonts.googleapis.com in style-src')
  assert.ok(directives.get('font-src').has('https://fonts.gstatic.com'), 'CSP must allow fonts.gstatic.com in font-src')

  // 5. Google Avatar photos compatibility
  assert.ok(directives.get('img-src').has('https://*.googleusercontent.com'), 'CSP must allow *.googleusercontent.com in img-src')

  // 6. Stage teleprompter fullscreen and screen wake-lock permissions
  const perm = rules.get('/*')['Permissions-Policy']
  assert.ok(perm.includes('fullscreen=(self)'), 'Permissions-Policy must allow fullscreen for teleprompter')
  assert.ok(perm.includes('screen-wake-lock=(self)'), 'Permissions-Policy must allow screen-wake-lock')

  // 7. Clickjacking frame protection
  assert.equal(rules.get('/*')['X-Frame-Options'], 'DENY')
  assert.deepEqual(directives.get('frame-ancestors'), new Set(["'none'"]), "CSP must set frame-ancestors 'none'")
})

test('API sources never grant cross-origin reads (GTAR API is same-origin only, #160)', () => {
  const nodeFs = require('node:fs')
  const nodePath = require('node:path')
  const roots = ['functions', 'workers'].map(dir => nodePath.join(__dirname, '..', dir))
  const offenders = []
  const walk = dir => {
    for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
      const full = nodePath.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|js)$/.test(entry.name) && /Access-Control-Allow-Origin/i.test(nodeFs.readFileSync(full, 'utf8'))) offenders.push(nodePath.relative(nodePath.join(__dirname, '..'), full))
    }
  }
  roots.filter(dir => nodeFs.existsSync(dir)).forEach(walk)
  assert.deepEqual(offenders, [])
})

test('#160: the enforced CSP is identical in public/_headers and the Functions security headers, and keeps what DEV QA used', () => {
  const headersFile = fs.readFileSync(path.join(__dirname, '../public/_headers'), 'utf8')
  const fromFile = headersFile.match(/^\s*Content-Security-Policy:\s*(.+)$/m)[1].trim()
  const { STATIC_SECURITY_HEADERS: H } = require('../functions/lib/securityHeaders.ts')
  assert.equal(fromFile, H['Content-Security-Policy'])
  assert.doesNotMatch(headersFile, /Content-Security-Policy-Report-Only/)
  // Google sign-in, profile photos, Stage Cast 2.0 (wss same origin) and BandSync (ws:, owner decision A)
  for (const needle of ["script-src 'self' https://accounts.google.com", 'frame-src https://accounts.google.com', 'https://*.googleusercontent.com', "connect-src 'self'", ' ws: wss:', "frame-ancestors 'none'", "object-src 'none'"]) {
    assert.ok(fromFile.includes(needle), needle)
  }
  assert.doesNotMatch(fromFile, /script-src[^;]*'unsafe-inline'/, 'no inline scripts allowed')
})
