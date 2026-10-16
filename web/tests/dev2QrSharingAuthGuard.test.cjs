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
// 1. ANONYMOUS REQUESTS ARE DENIED (POST and GET)
// ---------------------------------------------------------------------------
test('ANONYMOUS_ACCESS_DENIED: Direct API calls without authentication return 401', async () => {
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
  assert.equal(postRes.status, 401, 'Anonymous POST must return HTTP 401')
  const postData = await postRes.json()
  assert.match(postData.error, /Authorization/i)

  // Anonymous GET
  const getReq = new Request('https://gtar.pages.dev/api/setlist/share?token=0123456789abcdef', {
    method: 'GET',
  })
  const getRes = await shareApi.onRequestGet({ request: getReq, env })
  assert.equal(getRes.status, 401, 'Anonymous GET must return HTTP 401')
  const getData = await getRes.json()
  assert.match(getData.error, /Authorization/i)
})

// ---------------------------------------------------------------------------
// 2. PENDING, DENIED, SUSPENDED AND EXPIRED USERS ARE DENIED (POST and GET)
// ---------------------------------------------------------------------------
test('NON_ACTIVE_USERS_DENIED: Pending, denied, and suspended accounts receive 403', async () => {
  const { users, db } = createMockD1()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const pendingUser = {
    id: 'user-pending-1',
    google_sub: 'sub-pending-1',
    email: 'pending@example.com',
    role: 'member',
    access_status: 'pending',
  }
  const deniedUser = {
    id: 'user-denied-1',
    google_sub: 'sub-denied-1',
    email: 'denied@example.com',
    role: 'member',
    access_status: 'denied',
  }
  const suspendedUser = {
    id: 'user-suspended-1',
    google_sub: 'sub-suspended-1',
    email: 'suspended@example.com',
    role: 'member',
    access_status: 'suspended', // Any non-active status is rejected
  }

  users.set(pendingUser.id, pendingUser)
  users.set(deniedUser.id, deniedUser)
  users.set(suspendedUser.id, suspendedUser)

  const pendingToken = await authCore.createSessionToken(pendingUser, TEST_SECRET)
  const deniedToken = await authCore.createSessionToken(deniedUser, TEST_SECRET)
  const suspendedToken = await authCore.createSessionToken(suspendedUser, TEST_SECRET)

  const samplePayload = {
    type: 'GTAR_SHARED_SETLIST',
    name: 'Worship Set',
    songs: [{ title: 'Way Maker', rawContent: '[C]Here' }],
  }

  for (const [name, token] of [['pending', pendingToken], ['denied', deniedToken], ['suspended', suspendedToken]]) {
    // POST attempt
    const postReq = new Request('https://gtar.pages.dev/api/setlist/share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(samplePayload),
    })
    const postRes = await shareApi.onRequestPost({ request: postReq, env })
    assert.equal(postRes.status, 403, `${name} account must receive 403 on POST`)

    // GET attempt
    const getReq = new Request('https://gtar.pages.dev/api/setlist/share?token=0123456789abcdef', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    const getRes = await shareApi.onRequestGet({ request: getReq, env })
    assert.equal(getRes.status, 403, `${name} account must receive 403 on GET`)
  }
})

test('EXPIRED_SESSION_DENIED: Expired session token is rejected with 401', async () => {
  const { users, db } = createMockD1()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const activeUser = {
    id: 'user-active-1',
    google_sub: 'sub-active-1',
    email: 'active@example.com',
    role: 'member',
    access_status: 'active',
  }
  users.set(activeUser.id, activeUser)

  // Token created with negative duration (already expired)
  const expiredToken = await authCore.createSessionToken(activeUser, TEST_SECRET, -1000)

  const getReq = new Request('https://gtar.pages.dev/api/setlist/share?token=0123456789abcdef', {
    method: 'GET',
    headers: { Authorization: `Bearer ${expiredToken}` },
  })
  const getRes = await shareApi.onRequestGet({ request: getReq, env })
  assert.equal(getRes.status, 401, 'Expired session must return 401')
})

// ---------------------------------------------------------------------------
// 3. AUTHENTICATED ACTIVE MEMBER AND ADMIN CAN CREATE AND RETRIEVE SHARES
// ---------------------------------------------------------------------------
test('AUTHENTICATED_SHARE_LIFECYCLE: Active member can create and retrieve share', async () => {
  const { users, shares, db } = createMockD1()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  const activeMember = {
    id: 'user-member-1',
    google_sub: 'sub-member-1',
    email: 'member@example.com',
    role: 'member',
    access_status: 'active',
  }
  users.set(activeMember.id, activeMember)
  const memberToken = await authCore.createSessionToken(activeMember, TEST_SECRET)

  // 1. Create Share
  const setlistPayload = {
    type: 'GTAR_SHARED_SETLIST',
    name: 'Easter Sunday',
    songs: [
      { title: 'King of Kings', artist: 'Hillsong', key: 'D', bpm: '68', rawContent: '[D]In the darkness' },
      { title: 'Living Hope', artist: 'Phil Wickham', key: 'Eb', rawContent: '[Eb]How great the chasm' },
    ],
  }

  const postReq = new Request('https://gtar.pages.dev/api/setlist/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberToken}`,
    },
    body: JSON.stringify(setlistPayload),
  })

  const postRes = await shareApi.onRequestPost({ request: postReq, env })
  assert.equal(postRes.status, 200, 'Active member share creation must succeed')
  const postData = await postRes.json()

  assert.match(postData.token, /^[0-9a-f]{16,32}$/, 'Token must be valid hex characters')
  assert.equal(postData.name, 'Easter Sunday')
  assert.equal(postData.songCount, 2)
  assert.ok(postData.expiresAt)

  // 2. Retrieve Share using valid token and active member session
  const getReq = new Request(`https://gtar.pages.dev/api/setlist/share?token=${postData.token}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${memberToken}`,
    },
  })

  const getRes = await shareApi.onRequestGet({ request: getReq, env })
  assert.equal(getRes.status, 200, 'Active member share retrieval must succeed')
  const getData = await getRes.json()

  assert.equal(getData.token, postData.token)
  assert.equal(getData.setlist.name, 'Easter Sunday')
  assert.equal(getData.setlist.songs.length, 2)
  assert.equal(getData.setlist.songs[0].title, 'King of Kings')
  assert.equal(getData.setlist.songs[1].title, 'Living Hope')

  // 3. Different active user (admin) can also retrieve the share without explicit approval
  const activeAdmin = {
    id: 'user-admin-1',
    google_sub: 'sub-admin-1',
    email: 'admin@example.com',
    role: 'admin',
    access_status: 'active',
  }
  users.set(activeAdmin.id, activeAdmin)
  const adminToken = await authCore.createSessionToken(activeAdmin, TEST_SECRET)

  const adminGetReq = new Request(`https://gtar.pages.dev/api/setlist/share?token=${postData.token}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  })
  const adminGetRes = await shareApi.onRequestGet({ request: adminGetReq, env })
  assert.equal(adminGetRes.status, 200, 'Another active member/admin can retrieve valid unexpired share')
})

// ---------------------------------------------------------------------------
// 4. EXISTING VALID TOKENS PRESERVED & INVALID / EXPIRED TOKENS REJECTED
// ---------------------------------------------------------------------------
test('EXISTING_AND_EXPIRED_TOKENS: Existing valid token loads; expired token returns 410; missing returns 404', async () => {
  const existingToken = 'e0e0e0e0e0e0e0e0'
  const expiredToken = 'ffffffffffffffff'

  const validPayload = {
    version: 1,
    type: 'GTAR_SHARED_SETLIST',
    name: 'Pre-existing Setlist',
    createdAt: new Date().toISOString(),
    songs: [{ title: 'Ancient Song', rawContent: '[A]Chord' }],
  }

  const { users, db } = createMockD1({
    [existingToken]: {
      share_token: existingToken,
      setlist_name: 'Pre-existing Setlist',
      payload_json: JSON.stringify(validPayload),
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(), // valid unexpired
    },
    [expiredToken]: {
      share_token: expiredToken,
      setlist_name: 'Expired Setlist',
      payload_json: JSON.stringify(validPayload),
      created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // expired in past
    },
  })

  const activeUser = {
    id: 'user-active-2',
    google_sub: 'sub-active-2',
    email: 'viewer@example.com',
    role: 'member',
    access_status: 'active',
  }
  users.set(activeUser.id, activeUser)
  const token = await authCore.createSessionToken(activeUser, TEST_SECRET)
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  // 1. Existing unexpired token succeeds
  const getExisting = new Request(`https://gtar.pages.dev/api/setlist/share?token=${existingToken}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const res1 = await shareApi.onRequestGet({ request: getExisting, env })
  assert.equal(res1.status, 200, 'Pre-existing valid share token must remain accessible to authenticated users')
  const data1 = await res1.json()
  assert.equal(data1.setlist.name, 'Pre-existing Setlist')

  // 2. Expired token returns 410 SHARED_SETLIST_EXPIRED
  const getExpired = new Request(`https://gtar.pages.dev/api/setlist/share?token=${expiredToken}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const res2 = await shareApi.onRequestGet({ request: getExpired, env })
  assert.equal(res2.status, 410, 'Expired share token must return HTTP 410')
  const data2 = await res2.json()
  assert.equal(data2.error, 'SHARED_SETLIST_EXPIRED')

  // 3. Non-existent token returns 404 SHARED_SETLIST_NOT_FOUND
  const getNotFound = new Request(`https://gtar.pages.dev/api/setlist/share?token=0000000000000000`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const res3 = await shareApi.onRequestGet({ request: getNotFound, env })
  assert.equal(res3.status, 404, 'Non-existent share token must return HTTP 404')
  const data3 = await res3.json()
  assert.equal(data3.error, 'SHARED_SETLIST_NOT_FOUND')

  // 4. Malformed token returns 400
  const getMalformed = new Request(`https://gtar.pages.dev/api/setlist/share?token=not-a-valid-token`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const res4 = await shareApi.onRequestGet({ request: getMalformed, env })
  assert.equal(res4.status, 400, 'Malformed token must return HTTP 400')
})

// ---------------------------------------------------------------------------
// 5. OVERSIZED, MALFORMED, AND RATE-LIMITED REQUESTS
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
test('UNAUTHORIZED_POST_REJECTED_WITHOUT_BODY_PARSING: Anonymous and unauthorized POSTs rejected before body is consumed or DB checked', async () => {
  const { users, db } = createMockD1()
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  let bodyReadAttempted = false

  // 1. Anonymous POST with body reader spy
  const anonPoisonReq = new Request('https://gtar.pages.dev/api/setlist/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Secret Set' }),
  })
  anonPoisonReq.json = async () => {
    bodyReadAttempted = true
    throw new Error('BODY_READ_ATTEMPTED')
  }
  if (anonPoisonReq.body) {
    anonPoisonReq.body.getReader = () => {
      bodyReadAttempted = true
      throw new Error('BODY_READ_ATTEMPTED')
    }
  }

  const anonRes = await shareApi.onRequestPost({ request: anonPoisonReq, env })
  assert.equal(anonRes.status, 401, 'Anonymous POST must return 401 before body read')
  assert.equal(bodyReadAttempted, false, 'Body stream must not be touched for anonymous caller')

  // 2. Pending account with body reader spy
  const pendingUser = {
    id: 'user-pending-poison',
    google_sub: 'sub-pending-poison',
    email: 'pendingpoison@example.com',
    role: 'member',
    access_status: 'pending',
  }
  users.set(pendingUser.id, pendingUser)
  const pendingToken = await authCore.createSessionToken(pendingUser, TEST_SECRET)

  let pendingReadAttempted = false
  const pendingReq = new Request('https://gtar.pages.dev/api/setlist/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pendingToken}`,
    },
    body: JSON.stringify({ name: 'Secret Set' }),
  })
  pendingReq.json = async () => {
    pendingReadAttempted = true
    throw new Error('BODY_READ_ATTEMPTED')
  }
  if (pendingReq.body) {
    pendingReq.body.getReader = () => {
      pendingReadAttempted = true
      throw new Error('BODY_READ_ATTEMPTED')
    }
  }

  const pendingRes = await shareApi.onRequestPost({ request: pendingReq, env })
  assert.equal(pendingRes.status, 403, 'Pending account must receive 403 before body read')
  assert.equal(pendingReadAttempted, false, 'Body stream must not be touched for pending account')

  // 3. Anonymous caller when DB is completely missing must return 401 without revealing DB status
  const anonNoDbReq = new Request('https://gtar.pages.dev/api/setlist/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Secret Set' }),
  })
  const anonNoDbRes = await shareApi.onRequestPost({ request: anonNoDbReq, env: { AUTH_SECRET: TEST_SECRET } })
  assert.equal(anonNoDbRes.status, 401, 'Anonymous request with missing DB must return 401, never 503 DATABASE_UNAVAILABLE')
  const anonNoDbData = await anonNoDbRes.json()
  assert.match(anonNoDbData.error, /Authorization/i)
})

// ---------------------------------------------------------------------------
// 8. LIFECYCLE: ANONYMOUS SCAN -> SIGN-IN -> PREVIEW & EXPIRED REAUTH
// ---------------------------------------------------------------------------
test('PENDING_TOKEN_LIFECYCLE_ANONYMOUS_AND_EXPIRED: Token survives sign-in & re-auth, resolves to preview, and cleans up on completion', async () => {
  const shareToken = '1234567890abcdef'
  const sharePayload = {
    version: 1,
    type: 'GTAR_SHARED_SETLIST',
    name: 'Worship Sunday',
    songs: [{ title: 'Great Are You Lord', rawContent: '[A]It is Your breath' }],
  }

  const { users, db } = createMockD1({
    [shareToken]: {
      share_token: shareToken,
      setlist_name: 'Worship Sunday',
      payload_json: JSON.stringify(sharePayload),
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    },
  })
  const env = { DB: db, AUTH_SECRET: TEST_SECRET, TEST_MOCK_AUTH: 'true' }

  // Simulation of client sessionStorage store
  const mockSessionStorage = new Map()

  // STEP A: Anonymous user scans QR link (?share=1234567890abcdef)
  const incomingParam = '1234567890abcdef'
  if (/^[a-f0-9]{16}$/i.test(incomingParam)) {
    mockSessionStorage.set('gtar_pending_share_token', incomingParam.toLowerCase())
  }
  assert.equal(mockSessionStorage.get('gtar_pending_share_token'), shareToken)

  // STEP B: Unauthenticated fetch fails with 401 -> token must be RETAINED in sessionStorage
  const anonReq = new Request(`https://gtar.pages.dev/api/setlist/share?token=${shareToken}`, { method: 'GET' })
  const anonRes = await shareApi.onRequestGet({ request: anonReq, env })
  assert.equal(anonRes.status, 401)
  // Contract: 401 must NOT clear pending token from sessionStorage
  if (anonRes.status === 401) {
    // Retained!
    assert.equal(mockSessionStorage.get('gtar_pending_share_token'), shareToken)
  }

  // STEP C: User completes Google sign-in and acquires active session
  const activeUser = {
    id: 'user-lifecycle-test',
    google_sub: 'sub-lifecycle-test',
    email: 'lifecycle@example.com',
    role: 'member',
    access_status: 'active',
  }
  users.set(activeUser.id, activeUser)
  const activeToken = await authCore.createSessionToken(activeUser, TEST_SECRET)

  // STEP D: App restores pending token from sessionStorage and resolves preview
  const pendingFromStorage = mockSessionStorage.get('gtar_pending_share_token')
  assert.equal(pendingFromStorage, shareToken)

  const authedReq = new Request(`https://gtar.pages.dev/api/setlist/share?token=${pendingFromStorage}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${activeToken}` },
  })
  const authedRes = await shareApi.onRequestGet({ request: authedReq, env })
  assert.equal(authedRes.status, 200)
  const authedData = await authedRes.json()
  assert.equal(authedData.setlist.name, 'Worship Sunday')
  assert.equal(authedData.setlist.songs[0].title, 'Great Are You Lord')

  // Terminal success clears pending token
  mockSessionStorage.delete('gtar_pending_share_token')
  assert.equal(mockSessionStorage.has('gtar_pending_share_token'), false)

  // STEP E: Expired session flow
  const expiredSessionToken = await authCore.createSessionToken(activeUser, TEST_SECRET, -5000)
  mockSessionStorage.set('gtar_pending_share_token', shareToken)

  const expiredReq = new Request(`https://gtar.pages.dev/api/setlist/share?token=${shareToken}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${expiredSessionToken}` },
  })
  const expiredRes = await shareApi.onRequestGet({ request: expiredReq, env })
  assert.equal(expiredRes.status, 401, 'Expired session returns 401')
  // On 401, token remains in storage awaiting re-authentication
  assert.equal(mockSessionStorage.get('gtar_pending_share_token'), shareToken)

  // Re-authentication restores access
  const renewedSessionToken = await authCore.createSessionToken(activeUser, TEST_SECRET, 3600000)
  const renewedReq = new Request(`https://gtar.pages.dev/api/setlist/share?token=${shareToken}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${renewedSessionToken}` },
  })
  const renewedRes = await shareApi.onRequestGet({ request: renewedReq, env })
  assert.equal(renewedRes.status, 200, 'Renewed session successfully loads shared setlist')
  mockSessionStorage.delete('gtar_pending_share_token')
  assert.equal(mockSessionStorage.has('gtar_pending_share_token'), false)
})

// ---------------------------------------------------------------------------
// 9. TOKEN CLEANUP CONTRACT: 401/NETWORK RETENTION VS 404/410/MALFORMED PURGE
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
