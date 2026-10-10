const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { createHmac } = require('node:crypto')

require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename)

const core = require('../functions/lib/authCore.ts')
const session = require('../functions/api/auth/session.ts')
const admin = require('../functions/api/admin/users.ts')
const SECRET = 'disposable-auth-security-test-key'
const RETIRED_KEY = 'gtar_d1_auth_internal_secret_dev_only'
const user = {
  id: 'disposable-user', google_sub: 'disposable-sub', email: 'user@example.invalid',
  role: 'member', access_status: 'active', display_name: null, picture_url: null,
  created_at: '', updated_at: '', last_login_at: '',
}

function fixture(record = user) {
  let reads = 0
  let writes = 0
  const db = { prepare(sql) {
    let args = []
    return {
      bind(...values) { args = values; return this },
      async first() {
        reads++
        const field = sql.includes('google_sub = ?') ? 'google_sub' : 'id'
        return record && record[field] === args[0] ? { ...record } : null
      },
      async all() { reads++; return { results: record ? [{ ...record }] : [], success: true } },
      async run() { writes++; return { success: true } },
    }
  } }
  return { env: { DB: db, AUTH_SECRET: SECRET }, counts: () => ({ reads, writes }) }
}

// Independent pre-hardening HS256 writer proves compatibility without using the new signer.
function legacyToken(claims = {}, secret = SECRET, header = { alg: 'HS256', typ: 'JWT' }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const payload = {
    uid: user.id, sub: user.google_sub, email: user.email, role: 'admin', status: 'active',
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims,
  }
  const message = `${encode(header)}.${encode(payload)}`
  return `${message}.${createHmac('sha256', secret).update(message).digest('base64url')}`
}
const request = (token) => new Request('https://disposable.invalid/api/auth/session', {
  headers: { Authorization: `Bearer ${token}` },
})

for (const [label, secret] of [
  ['missing', undefined], ['empty', ''], ['whitespace', ' \t\n'],
  ['non-string', 123], ['null', null], ['retired public key', RETIRED_KEY],
]) {
  test(`${label} AUTH_SECRET fails closed across signing, verification and handlers`, async () => {
    await assert.rejects(core.createSessionToken(user, secret), /Authentication service is unavailable/)
    assert.equal(await core.verifySessionToken(legacyToken(), secret), null)
    const { env, counts } = fixture()
    env.AUTH_SECRET = secret
    env.TEST_MOCK_AUTH = 'true'
    const post = new Request('https://disposable.invalid/api/auth/session', {
      method: 'POST', body: JSON.stringify({ idToken: 'test_token:disposable-sub:user@example.invalid' }),
    })
    assert.equal((await session.onRequestPost({ request: post, env })).status, 503)
    assert.equal((await session.onRequestGet({ request: request(legacyToken()), env })).status, 503)
    assert.equal((await core.authenticateUserRequest(request(legacyToken()), env)).status, 503)
    assert.equal((await admin.onRequestGet({ request: request(legacyToken()), env })).status, 503)
    assert.equal((await core.authenticateAdminRequest(request('test_token:disposable-sub'), env)).status, 503)
    assert.deepEqual(counts(), { reads: 0, writes: 0 })
  })
}

test('valid signed session and existing pre-hardening session remain valid with the same key', async () => {
  const { env } = fixture()
  for (const token of [await core.createSessionToken(user, SECRET), legacyToken()]) {
    const verified = await core.verifySessionToken(token, SECRET)
    assert.equal(verified?.uid, user.id)
    assert.equal(verified?.sub, user.google_sub)
    assert.equal((await core.authenticateUserRequest(request(token), env)).user?.id, user.id)
    assert.equal((await session.onRequestGet({ request: request(token), env })).status, 200)
  }
})

test('forged public-fallback session and invalid signature are rejected', async () => {
  const { env } = fixture()
  for (const token of [legacyToken({}, RETIRED_KEY), legacyToken({}, 'different-disposable-key')]) {
    assert.equal(await core.verifySessionToken(token, SECRET), null)
    assert.equal((await core.authenticateUserRequest(request(token), env)).status, 401)
    assert.equal((await session.onRequestGet({ request: request(token), env })).status, 401)
    assert.equal((await admin.onRequestGet({ request: request(token), env })).status, 401)
  }
})

test('malformed claims, expiration and algorithm are rejected', async () => {
  const tokens = [
    'malformed', 'a.b.c', legacyToken({ exp: Math.floor(Date.now() / 1000) - 1 }),
    legacyToken({ exp: undefined }), legacyToken({ exp: '9999999999' }),
    legacyToken({ exp: null }), legacyToken({ exp: 1.5 }),
    legacyToken({ uid: 123 }), legacyToken({ uid: '' }), legacyToken({ sub: [] }),
    legacyToken({ sub: ' ' }), legacyToken({}, SECRET, { alg: 'none', typ: 'JWT' }),
    legacyToken({}, SECRET, null),
  ]
  for (const token of tokens) assert.equal(await core.verifySessionToken(token, SECRET), null)
})

test('uid/sub mismatch and absent user fail without disclosing account existence', async () => {
  const { env } = fixture()
  const mismatch = legacyToken({ sub: 'other-sub' })
  const missing = legacyToken({ uid: 'absent-user' })
  for (const authenticate of [core.authenticateUserRequest, core.authenticateAdminRequest]) {
    const a = await authenticate(request(mismatch), env)
    const b = await authenticate(request(missing), env)
    assert.deepEqual(a, b)
    assert.equal(a.status, 401)
  }
  for (const token of [mismatch, missing]) {
    assert.equal((await session.onRequestGet({ request: request(token), env })).status, 401)
  }
})

test('authoritative inactive and unauthorized records cannot access protected endpoints', async () => {
  for (const record of [
    { ...user, access_status: 'pending' }, { ...user, access_status: 'denied' },
    { ...user, role: 'unknown' },
  ]) {
    const { env } = fixture(record)
    const token = legacyToken()
    assert.equal((await core.authenticateUserRequest(request(token), env)).status, 403)
    assert.equal((await admin.onRequestGet({ request: request(token), env })).status, 403)
  }
})

test('admin endpoint uses D1 role, including demotion and valid existing admin session', async () => {
  const member = fixture()
  assert.equal((await admin.onRequestGet({ request: request(legacyToken()), env: member.env })).status, 403)
  const authorized = fixture({ ...user, role: 'admin' })
  const token = legacyToken({ role: 'member', status: 'pending' })
  assert.equal((await admin.onRequestGet({ request: request(token), env: authorized.env })).status, 200)
})

test('explicit local mock identity with explicit signing key remains compatible', async () => {
  const { env } = fixture()
  env.TEST_MOCK_AUTH = 'true'
  const post = new Request('https://disposable.invalid/api/auth/session', {
    method: 'POST', body: JSON.stringify({ idToken: 'test_token:disposable-sub:user@example.invalid' }),
  })
  const response = await session.onRequestPost({ request: post, env })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal((await core.verifySessionToken(body.sessionToken, SECRET))?.uid, user.id)
})

test('approval status introspection remains available but grants no inactive access', async () => {
  const { env } = fixture({ ...user, access_status: 'pending' })
  const token = legacyToken()
  const response = await session.onRequestGet({ request: request(token), env })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).user.access_status, 'pending')
  assert.equal((await core.authenticateUserRequest(request(token), env)).status, 403)
})

test('authentication errors do not expose submitted identity or token details', async () => {
  const { env } = fixture()
  const post = new Request('https://disposable.invalid/api/auth/session', {
    method: 'POST', body: JSON.stringify({ idToken: 'malformed-private-credential' }),
  })
  const response = await session.onRequestPost({ request: post, env })
  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { success: false, error: 'Authentication failed' })
})

test('Node crypto fallback preserves HS256 compatibility and rejects bad signatures', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined })
  try {
    const token = await core.createSessionToken(user, SECRET)
    assert.equal((await core.verifySessionToken(token, SECRET))?.uid, user.id)
    assert.equal((await core.verifySessionToken(legacyToken(), SECRET))?.uid, user.id)
    assert.equal(await core.verifySessionToken(legacyToken({}, RETIRED_KEY), SECRET), null)
    assert.equal(await core.verifySessionToken('a.b.c', SECRET), null)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor)
    else delete globalThis.crypto
  }
})
