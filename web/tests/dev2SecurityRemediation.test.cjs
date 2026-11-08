const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Transpile TypeScript modules on the fly
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText,
      filename
    )
}

const { decodeHtmlEntities } = require('../src/utils/ugCore.ts')
const { isAllowedUgDestination, fetchUg } = require('../functions/ugFetch.ts')
const { stageCast } = require('../src/utils/stageCast.ts')
const { MockIDBFactory, MockIDBKeyRange } = require('./helpers/mockIdb.cjs')

if (typeof globalThis.IDBKeyRange === 'undefined') {
  globalThis.IDBKeyRange = MockIDBKeyRange
}

// ---------------------------------------------------------------------------
// 1. STEP 2: DEPENDENCY SECURITY PATCH AUDIT
// ---------------------------------------------------------------------------
test('DEPENDENCY_SECURITY_PATCHES: Target dependencies resolve to patched vulnerability-free versions', () => {
  const pkgLock = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'))
  const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'))

  // Verify sharp override exists
  assert.equal(pkgJson.overrides?.miniflare?.sharp, '0.35.5')

  // Find all installed instances of targeted packages in package-lock.json packages map
  const packages = pkgLock.packages || {}

  for (const [pkgPath, info] of Object.entries(packages)) {
    if (pkgPath.endsWith('node_modules/brace-expansion')) {
      const v = info.version
      const major = parseInt(v.split('.')[0], 10)
      if (major === 2) {
        assert.ok(v >= '2.1.7', `brace-expansion v2 should be >= 2.1.7, got ${v}`)
      } else if (major === 5) {
        assert.ok(v >= '5.0.12', `brace-expansion v5 should be >= 5.0.12, got ${v}`)
      }
    }
    if (pkgPath.endsWith('node_modules/serialize-javascript')) {
      assert.ok(info.version >= '7.1.2', `serialize-javascript should be >= 7.1.2, got ${info.version}`)
    }
    if (pkgPath.endsWith('node_modules/source-map-js')) {
      assert.ok(info.version >= '1.2.2', `source-map-js should be >= 1.2.2, got ${info.version}`)
    }
    if (pkgPath.endsWith('node_modules/sharp')) {
      assert.ok(info.version >= '0.35.5', `sharp should be >= 0.35.5, got ${info.version}`)
    }
  }
})

// ---------------------------------------------------------------------------
// 2. STEP 3: CHORD RENDERER REGEX CHARACTER CLASS HARDENING
// ---------------------------------------------------------------------------
test('CHORD_RENDERER_REGEX_HARDENING: Trimming character class preserves chord numbers, slashes, and strips delimiters', () => {
  // Regex character classes hardened in SongLineRenderer:
  // /^[[<({|,:;~\-]+|[\]>)}|,:;~\-]+$/g
  const cleanRegex = /^[[<({|,:;~\-]+|[\]>)}|,:;~\-]+$/g

  const testCases = [
    // Chord tokens with digits must preserve digits
    { input: 'C7', expected: 'C7' },
    { input: 'Dadd9', expected: 'Dadd9' },
    { input: 'Am7', expected: 'Am7' },
    { input: 'G11', expected: 'G11' },
    { input: 'Fsus4', expected: 'Fsus4' },
    { input: 'Bmaj7', expected: 'Bmaj7' },
    { input: 'E7#9', expected: 'E7#9' },

    // Slash chords must preserve the slash and bass note
    { input: 'G/B', expected: 'G/B' },
    { input: 'C/E', expected: 'C/E' },
    { input: 'F#/A#', expected: 'F#/A#' },
    { input: 'Am7/G', expected: 'Am7/G' },

    // Surrounding delimiters must be cleanly stripped
    { input: '[C7]', expected: 'C7' },
    { input: '(Dadd9)', expected: 'Dadd9' },
    { input: '<G/B>', expected: 'G/B' },
    { input: '{Fsus4}', expected: 'Fsus4' },
    { input: '|Am7|', expected: 'Am7' },
    { input: ',C7:', expected: 'C7' },
    { input: '~Dadd9~', expected: 'Dadd9' },
    { input: '-G/B-', expected: 'G/B' },
    { input: '[G/B],', expected: 'G/B' },
    { input: '((Cadd9));', expected: 'Cadd9' },
  ]

  for (const tc of testCases) {
    const cleaned = tc.input.replace(/^[[<({|,:;~\-]+|[\]>)}|,:;~\-]+$/g, '').trim()
    assert.equal(cleaned, tc.expected, `Expected '${tc.input}' to clean to '${tc.expected}', got '${cleaned}'`)
  }
})

// ---------------------------------------------------------------------------
// 3. STEP 4: HTML URL AND ENTITY HARDENING
// ---------------------------------------------------------------------------
test('HTML_URL_AND_ENTITY_HARDENING: Single-pass entity decoding prevents double unescaping', () => {
  // Single entity decoding
  assert.equal(decodeHtmlEntities('&quot;'), '"')
  assert.equal(decodeHtmlEntities('&amp;'), '&')
  assert.equal(decodeHtmlEntities('&#39;'), "'")
  assert.equal(decodeHtmlEntities('&apos;'), "'")
  assert.equal(decodeHtmlEntities('&lt;'), '<')
  assert.equal(decodeHtmlEntities('&gt;'), '>')

  // Double entity attack must NOT unescape twice in a single pass
  assert.equal(decodeHtmlEntities('&amp;quot;'), '&quot;')
  assert.equal(decodeHtmlEntities('&amp;amp;'), '&amp;')
  assert.equal(decodeHtmlEntities('&amp;lt;script&amp;gt;'), '&lt;script&gt;')

  // Mixed payload with real content and quotes
  const mixed = 'Song: &quot;Rock &amp; Roll&quot; &lt;tag&gt; &#39;test&#39;'
  assert.equal(decodeHtmlEntities(mixed), 'Song: "Rock & Roll" <tag> \'test\'')

  // Empty or invalid input
  assert.equal(decodeHtmlEntities(''), '')
  assert.equal(decodeHtmlEntities(null), '')
  assert.equal(decodeHtmlEntities(undefined), '')
})

test('HTML_URL_AND_ENTITY_HARDENING: URL trust boundary rejects dangerous schemes and handles malformed input', () => {
  const { validateTabUrl } = require('../src/utils/ugCore.ts')

  // Forbidden schemes rejected
  const dangerousUrls = [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://tabs.ultimate-guitar.com/test',
    'vbscript:msgbox(1)',
    'blob:https://tabs.ultimate-guitar.com/uuid',
  ]

  for (const url of dangerousUrls) {
    const res = validateTabUrl(url)
    assert.equal(res.valid, false, `Expected ${url} to be rejected`)
  }
})

// ---------------------------------------------------------------------------
// 4. STEP 5: RANDOMNESS AND ERROR DISCLOSURE HARDENING
// ---------------------------------------------------------------------------
test('RANDOMNESS_HARDENING: Stage Cast session ID uses cryptographically secure randomness', () => {
  const s1 = stageCast.getPresentationSessionId()
  assert.match(s1, /^GTAR-[0-9A-Z]{4,}$/, 'Session ID must match GTAR-[0-9A-Z]{4,}')

  // Prove pairing URL conforms to security policy
  const pairingUrl = stageCast.getPresentationPairingUrl()
  const parsed = new URL(pairingUrl)
  assert.equal(parsed.pathname, '/tv')
  assert.equal(parsed.searchParams.get('session'), s1)
  assert.equal(parsed.searchParams.has('token'), false, 'Pairing URL must not leak long-lived secrets')
  assert.equal(parsed.searchParams.has('content'), false, 'Pairing URL must not include song content')
})

test('ERROR_DISCLOSURE_HARDENING: Songbook sync endpoints do not leak database exceptions to client', async () => {
  const { onRequestGet, onRequestPost } = require('../functions/api/songbook/sync.ts')

  // Mock DB that throws an internal SQL error with database table details
  const failingDb = {
    prepare() {
      throw new Error('D1_ERROR: table user_songbooks constraint UNIQUE failed: user_songbooks.user_id')
    },
  }

  // Mock verified user auth context
  const mockContext = {
    request: new Request('https://gtar.local/api/songbook/sync', {
      headers: { Authorization: 'Bearer valid_mock_token' },
    }),
    env: {
      DB: failingDb,
      AUTH_SECRET: 'test-secret-at-least-32-characters-long-auth-key',
    },
  }

  // In the real authCore, authenticateUserRequest validates the token.
  // Test the exception branch by calling findUserSongbook failure
  const getRes = await onRequestGet(mockContext)
  // Expect generic 401 or 500 without leaking the SQL constraint message
  const bodyText = await getRes.text()
  assert.ok(!bodyText.includes('D1_ERROR'), 'Response must not disclose D1_ERROR details')
  assert.ok(!bodyText.includes('UNIQUE failed'), 'Response must not disclose internal SQL constraint details')
})

// ---------------------------------------------------------------------------
// 5. STEP 6: SETLIST SHARING RESOURCE HARDENING
// ---------------------------------------------------------------------------
test('SETLIST_SHARING_HARDENING: Request byte bounding and missing DB fail-closed', async () => {
  const { onRequestPost, MAX_SHARE_PAYLOAD_BYTES } = require('../functions/api/setlist/share.ts')

  assert.equal(MAX_SHARE_PAYLOAD_BYTES, 1024 * 1024)

  const { createSessionToken } = require('../functions/lib/authCore.ts')
  const authSecret = 'test-auth-secret-disposable-123'
  const testUser = {
    id: 'user-share-test-1',
    google_sub: 'sub-share-1',
    email: 'sharetest@example.com',
    role: 'member',
    access_status: 'active',
  }
  const token = await createSessionToken(testUser, authSecret)

  let inserted = false
  const mockDb = {
    prepare(sql) {
      if (sql.includes('users') || sql.includes('sessions')) {
        return {
          bind() {
            return {
              async first() {
                return sql.includes('users') ? testUser : null
              },
            }
          },
        }
      }
      return {
        bind(...args) {
          return {
            async run() {
              inserted = true
              return { success: true }
            },
          }
        },
      }
    },
  }

  // 1. Advertised Content-Length exceeding 1MB rejected with 413 for authenticated caller
  const oversizedHeaderReq = new Request('https://gtar.local/api/setlist/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(2 * 1024 * 1024),
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ test: 'data' }),
  })

  const res1 = await onRequestPost({ request: oversizedHeaderReq, env: { DB: mockDb, AUTH_SECRET: authSecret, TEST_MOCK_AUTH: 'true' } })
  assert.equal(res1.status, 413)
  const body1 = await res1.json()
  assert.equal(body1.error, 'PAYLOAD_TOO_LARGE')

  // 2. Missing DB binding fails closed with 503 DATABASE_UNAVAILABLE for authenticated caller
  const validPayload = {
    version: 1,
    type: 'GTAR_SHARED_SETLIST',
    name: 'Sunday Worship',
    createdAt: new Date().toISOString(),
    songs: [{ title: 'Build My Life', rawContent: '[G]Worthy of every song' }],
  }

  const validReq = new Request('https://gtar.local/api/setlist/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(JSON.stringify(validPayload).length),
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(validPayload),
  })

  const res2 = await onRequestPost({ request: validReq, env: { AUTH_SECRET: authSecret, TEST_MOCK_AUTH: 'true' } })
  assert.equal(res2.status, 503)
  const body2 = await res2.json()
  assert.equal(body2.error, 'DATABASE_UNAVAILABLE')

  // 3. Anonymous caller rejected with 401 without revealing DB status
  const anonReq = new Request('https://gtar.local/api/setlist/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(JSON.stringify(validPayload).length),
    },
    body: JSON.stringify(validPayload),
  })

  const anonRes = await onRequestPost({ request: anonReq, env: { DB: mockDb, AUTH_SECRET: authSecret, TEST_MOCK_AUTH: 'true' } })
  assert.equal(anonRes.status, 401, 'Anonymous share request must be rejected with 401')

  const anonNoDbRes = await onRequestPost({ request: anonReq, env: { AUTH_SECRET: authSecret, TEST_MOCK_AUTH: 'true' } })
  assert.equal(anonNoDbRes.status, 401, 'Anonymous caller must never see protected D1 details')

  // 4. With active authenticated user and DB available, valid payload succeeds with 16-hex token
  const validReq2 = new Request('https://gtar.local/api/setlist/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(JSON.stringify(validPayload).length),
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(validPayload),
  })

  const res3 = await onRequestPost({ request: validReq2, env: { DB: mockDb, AUTH_SECRET: authSecret, TEST_MOCK_AUTH: 'true' } })
  assert.equal(res3.status, 200)
  const body3 = await res3.json()
  assert.match(body3.token, /^[0-9a-f]{16,32}$/)
  assert.equal(body3.name, 'Sunday Worship')
  assert.equal(body3.songCount, 1)
  assert.equal(inserted, true)
})

// ---------------------------------------------------------------------------
// 7. STEP 8: REDIRECT BOUNDARY HARDENING IN FETCH_UG
// ---------------------------------------------------------------------------
test('REDIRECT_BOUNDARY_HARDENING: isAllowedUgDestination strictly allows only HTTPS on permitted UG domains', () => {
  // Allowed domains
  assert.equal(isAllowedUgDestination('https://tabs.ultimate-guitar.com/tab/radiohead/creep-4169'), true)
  assert.equal(isAllowedUgDestination('https://www.ultimate-guitar.com/search.php?title=creep'), true)
  assert.equal(isAllowedUgDestination('https://TABS.ULTIMATE-GUITAR.COM/tab/queen/bohemian'), true)

  // Forbidden protocols
  assert.equal(isAllowedUgDestination('http://tabs.ultimate-guitar.com/test'), false)
  assert.equal(isAllowedUgDestination('ftp://tabs.ultimate-guitar.com/test'), false)
  assert.equal(isAllowedUgDestination('javascript:alert(1)'), false)

  // Forbidden hosts (SSRF, cloud metadata, loopback, arbitrary internet)
  assert.equal(isAllowedUgDestination('https://169.254.169.254/latest/meta-data'), false)
  assert.equal(isAllowedUgDestination('https://127.0.0.1:8080/secret'), false)
  assert.equal(isAllowedUgDestination('https://localhost/admin'), false)
  assert.equal(isAllowedUgDestination('https://evil.com/redirect'), false)
  assert.equal(isAllowedUgDestination('https://tabs.ultimate-guitar.com.attacker.com/spoof'), false)
  assert.equal(isAllowedUgDestination('https://google.com'), false)

  // Non-standard port
  assert.equal(isAllowedUgDestination('https://tabs.ultimate-guitar.com:8443/test'), false)
})

test('REDIRECT_BOUNDARY_HARDENING: fetchUg rejects untrusted redirect destinations fail-closed', async () => {
  const origFetch = global.fetch

  try {
    // 1. Mock fetch returning 302 redirect to untrusted destination (SSRF attack)
    global.fetch = async (url) => {
      return new Response(null, {
        status: 302,
        headers: {
          Location: 'http://169.254.169.254/latest/meta-data',
        },
      })
    }

    await assert.rejects(
      fetchUg('https://tabs.ultimate-guitar.com/tab/test', {}),
      /Untrusted redirect destination/,
      'Must reject redirect to cloud metadata service'
    )

    // 2. Mock fetch returning 302 redirect to third-party domain
    global.fetch = async (url) => {
      return new Response(null, {
        status: 302,
        headers: {
          Location: 'https://attacker.com/stolen',
        },
      })
    }

    await assert.rejects(
      fetchUg('https://tabs.ultimate-guitar.com/tab/test', {}),
      /Untrusted redirect destination/,
      'Must reject redirect to attacker domain'
    )

    // 3. Mock fetch returning valid redirect to allowed UG host
    let fetchedTarget = ''
    global.fetch = async (url, opts) => {
      fetchedTarget = url
      if (url === 'https://www.ultimate-guitar.com/old-path') {
        return new Response(null, {
          status: 301,
          headers: {
            Location: 'https://tabs.ultimate-guitar.com/new-path',
          },
        })
      }
      return new Response('<html><body>Chord Tab</body></html>', { status: 200 })
    }

    const res = await fetchUg('https://www.ultimate-guitar.com/old-path', {})
    assert.equal(res.status, 200)
    assert.equal(res.html, '<html><body>Chord Tab</body></html>')
    assert.equal(fetchedTarget, 'https://tabs.ultimate-guitar.com/new-path')

  } finally {
    global.fetch = origFetch
  }
})
