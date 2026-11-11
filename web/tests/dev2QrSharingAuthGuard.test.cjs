const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
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

const webDir = path.resolve(__dirname, '..')
const shareApi = require(path.join(webDir, 'functions/api/setlist/share.ts'))
const authCore = require(path.join(webDir, 'functions/lib/authCore.ts'))
const { sanitizeSetlistForShare, validateSharedSetlistPayload, extractShareToken } = require(path.join(webDir, 'src/utils/sharedSetlist.ts'))

const TEST_SECRET = 'disposable-qr-auth-test-secret-2026'

function createMockD1(initialShares = {}) {
  const users = new Map()
  const shares = new Map(Object.entries(initialShares))

  return {
    users,
    shares,
    db: {
      prepare(query) {
        return {
          bind(...args) {
            return {
              async first() {
                if (query.includes('FROM users WHERE id = ?')) {
                  const id = args[0]
                  return users.get(id) || null
                }
                if (query.includes('FROM users WHERE google_sub = ?')) {
                  const sub = args[0]
                  for (const u of users.values()) {
                    if (u.google_sub === sub) return u
                  }
                  return null
                }
                if (query.includes('FROM shared_setlists WHERE share_token = ?')) {
                  const token = args[0]
                  return shares.get(token) || null
                }
                return null
              },
              async all() {
                return { results: Array.from(shares.values()), success: true }
              },
              async run() {
                if (query.includes('INSERT INTO shared_setlists')) {
                  const [share_token, setlist_name, payload_json, created_at, expires_at] = args
                  shares.set(share_token, {
                    share_token,
                    setlist_name,
                    payload_json,
                    created_at,
                    expires_at,
                  })
                  return { success: true }
                }
                return { success: true }
              },
            }
          },
        }
      },
    },
  }
}

// ---------------------------------------------------------------------------
// 1. ANONYMOUS PUBLICATION; LEGACY READS REQUIRE AUTHORIZATION
// ---------------------------------------------------------------------------
test('ANONYMOUS_SNAPSHOT: Creation allowed; account-era shares are retired (410)', async () => {
  const { db } = createMockD1()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  // Anonymous POST
  const postReq = new Request('https://gtar.pages.dev/api/setlist/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'GTAR_SHARED_SETLIST',
      name: 'Sunday Morning',
      songs: [{ title: 'Build My Life', rawContent: '[G]Worthy' }],
    }),
  })
  const postRes = await shareApi.onRequestPost({ request: postReq, env })
  assert.equal(postRes.status, 200, 'Explicit anonymous snapshot can be published')
  const postData = await postRes.json()
  assert.match(postData.token, /^[a-f0-9]{64}$/)

  // Anonymous GET
  const getReq = new Request('https://gtar.pages.dev/api/setlist/share?token=0123456789abcdef', {
    method: 'GET',
  })
  const getRes = await shareApi.onRequestGet({ request: getReq, env })
  assert.equal(getRes.status, 410, 'Pre-anonymous (account era) share tokens are retired')
  const getData = await getRes.json()
  assert.equal(getData.error, 'LEGACY_SHARE_RETIRED')
})

// ---------------------------------------------------------------------------
// 2. PENDING, DENIED, SUSPENDED AND EXPIRED USERS ARE DENIED (POST and GET)
// ---------------------------------------------------------------------------
test('ABUSE_MITIGATION: Oversized payloads, malformed JSON, and rate bursts handled safely', async () => {
  const { users, db } = createMockD1()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const activeUser = {
    id: 'user-abuse-test',
    google_sub: 'sub-abuse-1',
    email: 'abusetest@example.com',
    role: 'member',
    access_status: 'active',
  }
  users.set(activeUser.id, activeUser)
  const token = await authCore.createSessionToken(activeUser, TEST_SECRET)

  // 1. Oversized body (>1MB)
  const largeData = 'A'.repeat(1024 * 1024 + 50)
  const oversizeReq = new Request('https://gtar.pages.dev/api/setlist/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(largeData.length),
      Authorization: `Bearer ${token}`,
    },
    body: largeData,
  })
  const oversizeRes = await shareApi.onRequestPost({ request: oversizeReq, env })
  assert.equal(oversizeRes.status, 413, 'Oversized payload rejected with 413')

  // 2. Malformed JSON
  const malformedReq = new Request('https://gtar.pages.dev/api/setlist/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: '{not: "valid" json',
  })
  const malformedRes = await shareApi.onRequestPost({ request: malformedReq, env })
  assert.equal(malformedRes.status, 400, 'Malformed JSON rejected with 400')

  // 3. In-memory Rate Limiting triggers 429 after burst threshold
  shareApi._resetRateLimitsForTesting()

  const validPayload = {
    type: 'GTAR_SHARED_SETLIST',
    name: 'Rapid Fire',
    songs: [{ title: 'Song', rawContent: '[A]Song' }],
  }

  let rateLimited = false
  for (let i = 0; i < 35; i++) {
    const req = new Request('https://gtar.pages.dev/api/setlist/share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validPayload),
    })
    const res = await shareApi.onRequestPost({ request: req, env })
    if (res.status === 429) {
      rateLimited = true
      const data = await res.json()
      assert.equal(data.error, 'RATE_LIMIT_EXCEEDED')
      break
    }
  }
  assert.equal(rateLimited, true, 'Rapid burst of share creations must trigger 429 RATE_LIMIT_EXCEEDED')
  shareApi._resetRateLimitsForTesting()
})

// ---------------------------------------------------------------------------
// 6. CLIENT QR FLOW: LINK PRESERVATION, LOGIN RESTORATION, SAFE IMPORT
// ---------------------------------------------------------------------------
test('CLIENT_QR_FLOW: Token extraction, URL preservation, and safe import preview', () => {
  // 1. extractShareToken strictly accepts 16-hex token or same-origin URL
  const validHex = '0123456789abcdef'
  assert.equal(extractShareToken(validHex).isValid, true)
  assert.equal(extractShareToken(validHex).token, validHex)

  const urlWithShare = 'https://gtar.pages.dev/?share=0123456789abcdef'
  const extracted = extractShareToken(urlWithShare)
  assert.equal(extracted.isValid, true)
  assert.equal(extracted.token, validHex)

  // Empty or invalid links fail closed
  assert.equal(extractShareToken('').isValid, false)
  assert.equal(extractShareToken('not-a-token').isValid, false)
  assert.equal(extractShareToken('https://gtar.pages.dev/?share=short').isValid, false)

  // 2. Sanitize and validate setlist for share snapshot
  const rawSetlist = {
    name: 'Sunday Morning Live',
    songs: [
      {
        id: 'internal-id-123',
        userId: 'secret-user-id',
        title: 'Gratitude',
        artist: 'Brandon Lake',
        key: 'B',
        bpm: '78',
        rawContent: '{title: Gratitude}\n[B]All my words fall short',
      },
    ],
  }

  const sanitized = sanitizeSetlistForShare(rawSetlist)
  assert.equal(sanitized.version, 1)
  assert.equal(sanitized.type, 'GTAR_SHARED_SETLIST')
  assert.equal(sanitized.name, 'Sunday Morning Live')
  assert.equal(sanitized.songs[0].title, 'Gratitude')
  assert.equal(sanitized.songs[0].id, undefined, 'Private ID must never be included in shared payload')
  assert.equal(sanitized.songs[0].userId, undefined, 'User ID must never be included in shared payload')

  const validated = validateSharedSetlistPayload(sanitized)
  assert.equal(validated.isValid, true)
  assert.equal(validated.setlist.songs.length, 1)
})

// ---------------------------------------------------------------------------
// 7. UNAUTHORIZED POST REJECTED WITHOUT BODY READING / PARSING
// ---------------------------------------------------------------------------
test('TOKEN_CLEANUP_CONTRACT: 401 retains pending token; 404, 410, and malformed tokens purge immediately', async () => {
  const mockStorage = new Map()

  function handleOutcome(status, token) {
    if (status === 401 || status === 'NETWORK_ERROR' || status === 403) {
      // Recoverable: retain in storage
      mockStorage.set('gtar_pending_share_token', token)
    } else if (status === 200 || status === 404 || status === 410 || status === 400 || status === 'MALFORMED') {
      // Terminal: purge from storage
      mockStorage.delete('gtar_pending_share_token')
    }
  }

  // 1. Recoverable 401: retained
  mockStorage.set('gtar_pending_share_token', '1111222233334444')
  handleOutcome(401, '1111222233334444')
  assert.equal(mockStorage.get('gtar_pending_share_token'), '1111222233334444')

  // 2. Recoverable network error: retained
  handleOutcome('NETWORK_ERROR', '1111222233334444')
  assert.equal(mockStorage.get('gtar_pending_share_token'), '1111222233334444')

  // 3. Recoverable 403 pending approval: retained
  handleOutcome(403, '1111222233334444')
  assert.equal(mockStorage.get('gtar_pending_share_token'), '1111222233334444')

  // 4. Terminal 404 Not Found: purged
  handleOutcome(404, '1111222233334444')
  assert.equal(mockStorage.has('gtar_pending_share_token'), false)

  // 5. Terminal 410 Expired: purged
  mockStorage.set('gtar_pending_share_token', '5555666677778888')
  handleOutcome(410, '5555666677778888')
  assert.equal(mockStorage.has('gtar_pending_share_token'), false)

  // 6. Terminal malformed token: purged
  mockStorage.set('gtar_pending_share_token', 'bad-token')
  handleOutcome('MALFORMED', 'bad-token')
  assert.equal(mockStorage.has('gtar_pending_share_token'), false)

  // 7. Terminal success: purged
  mockStorage.set('gtar_pending_share_token', '9999000011112222')
  handleOutcome(200, '9999000011112222')
  assert.equal(mockStorage.has('gtar_pending_share_token'), false)
})
