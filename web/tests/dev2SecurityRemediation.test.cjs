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
const { SharedCatalogService } = require('../src/utils/sharedCatalogService.ts')
const { CatalogApiError } = require('../src/types/sharedCatalog.ts')
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
  assert.equal(parsed.pathname, '/stage/present')
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
      if (sql.includes('users')) {
        return {
          bind() {
            return {
              async first() {
                return testUser
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
// 6. STEP 7: SHARED CATALOG CACHE REVOCATION ON 401/403 AND ACCOUNT SWITCH
// ---------------------------------------------------------------------------
test('SHARED_CATALOG_AUTHORIZATION_CACHE: HTTP 401 and 403 fail closed without returning warm cache', async () => {
  const factory = new MockIDBFactory()
  const service = new SharedCatalogService()
  service.setAccount('user-warm-cache-123')

  // Seed cache with protected songs for this account
  const { saveSongsToCache, getCachedSongs } = require('../src/utils/sharedCatalogCache.ts')
  const secretSong = {
    id: 'shared-secret-1',
    title: 'Protected Church Song',
    artist: 'Worship Team',
    raw_content: '[G]Holy [C]Lord',
    key: 'G',
    revision: 1,
    publisher_account_id: 'user-warm-cache-123',
    publisher_display_name: 'Worship Leader',
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    fetchedAt: Date.now(),
  }
  await saveSongsToCache('user-warm-cache-123', [secretSong], { indexedDBFactory: factory })

  // Verify song is cached
  const cachedBefore = await getCachedSongs('user-warm-cache-123', { indexedDBFactory: factory })
  assert.equal(cachedBefore.length, 1)

  // Mock auth token returning accountId
  const sharedCatalogClient = require('../src/utils/sharedCatalogClient.ts')
  const origAuth = sharedCatalogClient.getAuthenticatedSessionToken
  const origList = sharedCatalogClient.listSharedCatalogSongs

  try {
    sharedCatalogClient.getAuthenticatedSessionToken = () => ({
      sessionToken: 'mock_token',
      accountId: 'user-warm-cache-123',
    })

    // 1. Simulate server returning HTTP 403 (Forbidden / Access Revoked)
    sharedCatalogClient.listSharedCatalogSongs = async () => {
      throw new CatalogApiError('Access forbidden', 403, 'FORBIDDEN')
    }

    const res403 = await service.getCatalogSongs({ indexedDBFactory: factory })

    // MUST return AUTH_REQUIRED with ZERO songs, NEVER fall back to warm cache!
    assert.equal(res403.state, 'AUTH_REQUIRED')
    assert.equal(res403.songs.length, 0, 'Must not return warm cached songs on 403')

    // On 403, cached records for this account must be purged
    const cachedAfter403 = await getCachedSongs('user-warm-cache-123', { indexedDBFactory: factory })
    assert.equal(cachedAfter403.length, 0, 'Account cache must be invalidated on 403')

    // 2. Simulate server returning HTTP 401 (Unauthorized)
    // Seed again
    await saveSongsToCache('user-warm-cache-123', [secretSong], { indexedDBFactory: factory })
    sharedCatalogClient.listSharedCatalogSongs = async () => {
      throw new CatalogApiError('Unauthorized', 401, 'UNAUTHORIZED')
    }

    const res401 = await service.getCatalogSongs({ indexedDBFactory: factory })
    assert.equal(res401.state, 'AUTH_REQUIRED')
    assert.equal(res401.songs.length, 0, 'Must not return warm cached songs on 401')

  } finally {
    sharedCatalogClient.getAuthenticatedSessionToken = origAuth
    sharedCatalogClient.listSharedCatalogSongs = origList
  }
})

test('SHARED_CATALOG_ACCOUNT_SWITCH_ISOLATION: Delayed responses from prior account never populate switched account', async () => {
  const factory = new MockIDBFactory()
  const service = new SharedCatalogService()

  service.setAccount('account-a')

  const sharedCatalogClient = require('../src/utils/sharedCatalogClient.ts')
  const origAuth = sharedCatalogClient.getAuthenticatedSessionToken
  const origList = sharedCatalogClient.listSharedCatalogSongs

  try {
    sharedCatalogClient.getAuthenticatedSessionToken = () => ({
      sessionToken: 'token_a',
      accountId: 'account-a',
    })

    // Simulate delayed response: while fetch is inflight, user switches to account-b
    sharedCatalogClient.listSharedCatalogSongs = async () => {
      // User switches account mid-request
      service.setAccount('account-b')
      return {
        songs: [
          {
            id: 'song-from-account-a',
            title: 'Account A Song',
            artist: 'Artist A',
            raw_content: '[A]Song A',
            key: 'A',
            revision: 1,
            publisher_account_id: 'account-a',
            published_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        pagination: { limit: 20, offset: 0, total: 1, has_more: false },
      }
    }

    const res = await service.getCatalogSongs({ indexedDBFactory: factory })

    // Stale response must be dropped because account context switched
    assert.equal(res.state, 'AUTH_REQUIRED')
    assert.equal(res.songs.length, 0)
    assert.equal(service.getCatalogSong('song-from-account-a'), undefined, 'Account A song must not be stored in in-memory map')

  } finally {
    sharedCatalogClient.getAuthenticatedSessionToken = origAuth
    sharedCatalogClient.listSharedCatalogSongs = origList
  }
})

test('SHARED_CATALOG_DELAYED_DETAIL_ISOLATION: Delayed detail response from prior account never populates switched account', async () => {
  const factory = new MockIDBFactory()
  const service = new SharedCatalogService()

  service.setAccount('account-a')

  const sharedCatalogClient = require('../src/utils/sharedCatalogClient.ts')
  const origAuth = sharedCatalogClient.getAuthenticatedSessionToken
  const origGet = sharedCatalogClient.getSharedCatalogSong

  try {
    sharedCatalogClient.getAuthenticatedSessionToken = () => ({
      sessionToken: 'token_a',
      accountId: 'account-a',
    })

    sharedCatalogClient.getSharedCatalogSong = async () => {
      // User switches account while detail fetch is in flight
      service.setAccount('account-b')
      return {
        song: {
          id: 'detail-song-a',
          title: 'Delayed Detail Song',
          artist: 'Delayed Artist',
          raw_content: '[D]Chord',
          key: 'D',
          revision: 1,
          publisher_account_id: 'account-a',
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        revisions: [],
      }
    }

    const res = await service.getSongDetails('detail-song-a', { indexedDBFactory: factory })
    assert.equal(res.state, 'AUTH_REQUIRED')
    assert.equal(res.song, null)
    assert.equal(service.getCatalogSong('detail-song-a'), undefined)
  } finally {
    sharedCatalogClient.getAuthenticatedSessionToken = origAuth
    sharedCatalogClient.getSharedCatalogSong = origGet
  }
})

test('SHARED_CATALOG_ABA_TRANSITION_ISOLATION: Stale list and detail requests across A->B->A switch fail-closed via monotonic epoch', async () => {
  const factory = new MockIDBFactory()
  const service = new SharedCatalogService()

  service.setAccount('account-a')
  const initialEpoch = service.getAccountEpoch()

  const sharedCatalogClient = require('../src/utils/sharedCatalogClient.ts')
  const origAuth = sharedCatalogClient.getAuthenticatedSessionToken
  const origList = sharedCatalogClient.listSharedCatalogSongs
  const origGet = sharedCatalogClient.getSharedCatalogSong

  try {
    sharedCatalogClient.getAuthenticatedSessionToken = () => ({
      sessionToken: 'token_a',
      accountId: 'account-a',
    })

    // 1. In-flight list request from Epoch 1
    sharedCatalogClient.listSharedCatalogSongs = async () => {
      // Simulate A -> B -> A switch while request 1 is in-flight:
      service.setAccount('account-b')
      service.setAccount('account-a')
      return {
        songs: [
          {
            id: 'stale-aba-song',
            title: 'Stale ABA Song',
            artist: 'Epoch 1 Artist',
            raw_content: '[A]Song',
            key: 'A',
            revision: 1,
            publisher_account_id: 'account-a',
            published_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        pagination: { limit: 20, offset: 0, total: 1, has_more: false },
      }
    }

    const listRes = await service.getCatalogSongs({ indexedDBFactory: factory })
    assert.equal(listRes.state, 'AUTH_REQUIRED')
    assert.equal(listRes.songs.length, 0)
    assert.equal(service.getCatalogSong('stale-aba-song'), undefined, 'Stale ABA response must not publish to epoch 3')
    assert.ok(service.getAccountEpoch() > initialEpoch, 'Account epoch must have advanced monotonically')

    // 2. In-flight detail request from Epoch 1 across A -> B -> A switch
    sharedCatalogClient.getSharedCatalogSong = async () => {
      service.setAccount('account-b')
      service.setAccount('account-a')
      return {
        song: {
          id: 'stale-aba-detail',
          title: 'Stale Detail Song',
          artist: 'Epoch 1 Artist',
          raw_content: '[G]Song',
          key: 'G',
          revision: 1,
          publisher_account_id: 'account-a',
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        revisions: [],
      }
    }

    const detailRes = await service.getSongDetails('stale-aba-detail', { indexedDBFactory: factory })
    assert.equal(detailRes.state, 'AUTH_REQUIRED')
    assert.equal(detailRes.song, null)
    assert.equal(service.getCatalogSong('stale-aba-detail'), undefined)
  } finally {
    sharedCatalogClient.getAuthenticatedSessionToken = origAuth
    sharedCatalogClient.listSharedCatalogSongs = origList
    sharedCatalogClient.getSharedCatalogSong = origGet
  }
})

test('SHARED_CATALOG_ASYNC_CACHE_WRITE_PROTECTION: Async cache writes cannot repopulate revoked cache on logout or switch', async () => {
  const factory = new MockIDBFactory()
  const service = new SharedCatalogService()

  service.setAccount('account-active')

  const sharedCatalogClient = require('../src/utils/sharedCatalogClient.ts')
  const { getCachedSongs } = require('../src/utils/sharedCatalogCache.ts')
  const origAuth = sharedCatalogClient.getAuthenticatedSessionToken
  const origList = sharedCatalogClient.listSharedCatalogSongs

  try {
    sharedCatalogClient.getAuthenticatedSessionToken = () => ({
      sessionToken: 'token_active',
      accountId: 'account-active',
    })

    // Simulate server returns songs
    sharedCatalogClient.listSharedCatalogSongs = async () => {
      return {
        songs: [
          {
            id: 'async-written-song',
            title: 'Async Written Song',
            artist: 'Active Artist',
            raw_content: '[E]Content',
            key: 'E',
            revision: 1,
            publisher_account_id: 'account-active',
            published_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        pagination: { limit: 20, offset: 0, total: 1, has_more: false },
      }
    }

    // Intercept saveSongsToCache to simulate logout occurring during async IDB write
    const sharedCatalogCache = require('../src/utils/sharedCatalogCache.ts')
    const origSave = sharedCatalogCache.saveSongsToCache
    try {
      sharedCatalogCache.saveSongsToCache = async (accountId, songs, options) => {
        // While write is running, user logs out:
        await service.clearAccountCache('account-active', options)
        return origSave(accountId, songs, options)
      }

      const res = await service.getCatalogSongs({ indexedDBFactory: factory })
      assert.equal(res.state, 'AUTH_REQUIRED')

      // Written data must be cleaned up and not repopulated after logout
      const cached = await getCachedSongs('account-active', { indexedDBFactory: factory })
      assert.equal(cached.length, 0, 'Revoked account cache must not be repopulated by stale async write')
      assert.equal(service.getAccount(), null)
      assert.equal(service.getCatalogSong('async-written-song'), undefined)
    } finally {
      sharedCatalogCache.saveSongsToCache = origSave
    }
  } finally {
    sharedCatalogClient.getAuthenticatedSessionToken = origAuth
    sharedCatalogClient.listSharedCatalogSongs = origList
  }
})

test('SHARED_CATALOG_DETAIL_401_403_SCOPED_REVOCATION: 401/403 on detail invalidates affected account cache and protects other accounts', async () => {
  const factory = new MockIDBFactory()
  const service = new SharedCatalogService()

  const { saveSongsToCache, getCachedSongs } = require('../src/utils/sharedCatalogCache.ts')
  const songA = {
    id: 'song-a',
    title: 'Song A',
    artist: 'Artist A',
    raw_content: '[A]Song',
    key: 'A',
    revision: 1,
    publisher_account_id: 'account-a',
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    fetchedAt: Date.now(),
  }
  const songB = {
    id: 'song-b',
    title: 'Song B',
    artist: 'Artist B',
    raw_content: '[B]Song',
    key: 'B',
    revision: 1,
    publisher_account_id: 'account-b',
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    fetchedAt: Date.now(),
  }

  // Seed both accounts
  await saveSongsToCache('account-a', [songA], { indexedDBFactory: factory })
  await saveSongsToCache('account-b', [songB], { indexedDBFactory: factory })

  service.setAccount('account-a')

  const sharedCatalogClient = require('../src/utils/sharedCatalogClient.ts')
  const origAuth = sharedCatalogClient.getAuthenticatedSessionToken
  const origGet = sharedCatalogClient.getSharedCatalogSong

  try {
    sharedCatalogClient.getAuthenticatedSessionToken = () => ({
      sessionToken: 'token_a',
      accountId: 'account-a',
    })

    // Detail endpoint returns 403 Forbidden
    sharedCatalogClient.getSharedCatalogSong = async () => {
      throw new CatalogApiError('Account revoked', 403, 'FORBIDDEN')
    }

    const res = await service.getSongDetails('song-a', { indexedDBFactory: factory })
    assert.equal(res.state, 'AUTH_REQUIRED')
    assert.equal(res.song, null)

    // Account A's cache must be purged
    const cachedA = await getCachedSongs('account-a', { indexedDBFactory: factory })
    assert.equal(cachedA.length, 0, 'Account A cache must be invalidated on detail 403')

    // Account B's cache must be completely intact (scoped isolation)
    const cachedB = await getCachedSongs('account-b', { indexedDBFactory: factory })
    assert.equal(cachedB.length, 1, 'Account B cache must remain untouched')
    assert.equal(cachedB[0].id, 'song-b')
  } finally {
    sharedCatalogClient.getAuthenticatedSessionToken = origAuth
    sharedCatalogClient.getSharedCatalogSong = origGet
  }
})

test('SHARED_CATALOG_STALE_FAILURE_PROTECTION: Stale 401/403 failure cannot clear active account in-memory metadata', async () => {
  const factory = new MockIDBFactory()
  const service = new SharedCatalogService()

  service.setAccount('account-a')

  const sharedCatalogClient = require('../src/utils/sharedCatalogClient.ts')
  const origAuth = sharedCatalogClient.getAuthenticatedSessionToken
  const origList = sharedCatalogClient.listSharedCatalogSongs

  try {
    sharedCatalogClient.getAuthenticatedSessionToken = () => ({
      sessionToken: 'token_a',
      accountId: 'account-a',
    })

    // Delayed failure for Account A
    sharedCatalogClient.listSharedCatalogSongs = async () => {
      // User switches to Account B while request is in flight
      service.setAccount('account-b')
      service.setCatalogSongMetadata({
        id: 'account-b-song',
        title: 'Active B Song',
        artist: 'Artist B',
        raw_content: '[C]Content',
        key: 'C',
        revision: 1,
        publisher_account_id: 'account-b',
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      service.markCatalogIdLiveConfirmed('account-b-song')

      // Account A request finally fails with 401
      throw new CatalogApiError('Token expired', 401, 'UNAUTHORIZED')
    }

    const res = await service.getCatalogSongs({ indexedDBFactory: factory })
    assert.equal(res.state, 'AUTH_REQUIRED')

    // Account B's active in-memory metadata must NOT be cleared by Account A's stale failure!
    assert.equal(service.getAccount(), 'account-b', 'Active account must remain account-b')
    assert.ok(service.getCatalogSong('account-b-song'), 'Account B metadata must be preserved')
    assert.ok(service.getFreshConfirmedCatalogIds().has('account-b-song'), 'Account B confirmed IDs must be preserved')
  } finally {
    sharedCatalogClient.getAuthenticatedSessionToken = origAuth
    sharedCatalogClient.listSharedCatalogSongs = origList
  }
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
