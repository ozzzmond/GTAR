const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { generateKeyPairSync, sign } = require('node:crypto')

require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename)

// Real RSA signatures, disposable keys, and intercepted network only.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'disposable-google-key', alg: 'RS256' }
const now = Date.now()
const claims = {
  iss: 'https://accounts.google.com', aud: 'disposable-client',
  exp: Math.floor(now / 1000) + 3600, sub: 'disposable-sub',
  email: 'user@example.invalid', email_verified: true,
}
const env = { GOOGLE_CLIENT_ID: claims.aud }
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
function token(overrides = {}, header = { alg: 'RS256', kid: jwk.kid }) {
  const message = `${encode(header)}.${encode({ ...claims, ...overrides })}`
  return `${message}.${sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64url')}`
}
function fixture(t, { jwks = true, info, unavailable = false } = {}) {
  delete require.cache[require.resolve('../functions/lib/authCore.ts')]
  delete require.cache[require.resolve('../functions/api/auth/session.ts')]
  const core = require('../functions/lib/authCore.ts')
  const calls = []
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url))
    if (unavailable) throw new Error('Disposable network failure')
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
      return Response.json({ keys: jwks ? [jwk] : [] })
    }
    assert.ok(String(url).startsWith('https://oauth2.googleapis.com/tokeninfo?id_token='))
    return info ? Response.json(info) : new Response('', { status: 400 })
  })
  return { core, calls, session: require('../functions/api/auth/session.ts') }
}

test('valid RSA Google credential accepts canonical and explicitly bound VITE alias', async t => {
  const { core } = fixture(t)
  for (const bindings of [env, { VITE_GOOGLE_CLIENT_ID: claims.aud },
    { ...env, TEST_MOCK_AUTH: 'true', CF_PAGES: '1' }]) {
    const profile = await core.verifyGoogleIdToken(token(), bindings, now)
    assert.equal(profile.sub, claims.sub)
    assert.equal(profile.email, claims.email)
  }
  assert.equal((await core.verifyGoogleIdToken(token({ iss: 'accounts.google.com' }), env, now)).sub, claims.sub)
})

for (const [label, bindings] of [
  ['missing', {}], ['empty', { GOOGLE_CLIENT_ID: '' }],
  ['whitespace', { VITE_GOOGLE_CLIENT_ID: ' \t' }],
  ['non-string', { GOOGLE_CLIENT_ID: 123 }],
  ['padded', { GOOGLE_CLIENT_ID: ` ${claims.aud} ` }],
  ['invalid canonical cannot fall back', { GOOGLE_CLIENT_ID: '', VITE_GOOGLE_CLIENT_ID: claims.aud }],
]) {
  test(`OAuth audience binding fails closed: ${label}`, async t => {
    const { core, calls } = fixture(t)
    await assert.rejects(core.verifyGoogleIdToken(token(), bindings, now), /audience binding/)
    assert.equal(calls.length, 0)
  })
}

for (const aud of ['other-client', undefined, '', ['disposable-client']]) {
  test(`signed wrong or invalid audience rejected: ${JSON.stringify(aud)}`, async t => {
    const { core, calls } = fixture(t)
    await assert.rejects(core.verifyGoogleIdToken(token({ aud }), env, now), /audience mismatch/)
    assert.equal(calls.length, 0)
  })
}

test('canonical server audience takes precedence over frontend alias', async t => {
  const { core } = fixture(t)
  await assert.rejects(core.verifyGoogleIdToken(token(), {
    GOOGLE_CLIENT_ID: 'other-client', VITE_GOOGLE_CLIENT_ID: claims.aud,
  }, now), /audience mismatch/)
})

for (const exp of [Math.floor(now / 1000) - 1, now / 1000, undefined, '9999999999', null]) {
  test(`signed invalid or expired expiration rejected: ${exp}`, async t => {
    const { core } = fixture(t)
    await assert.rejects(core.verifyGoogleIdToken(token({ exp }), env, now), /expired/)
  })
}

test('expiration boundary, infinity and invalid issuers fail closed', async t => {
  const { core } = fixture(t)
  await assert.rejects(core.verifyGoogleIdToken(token({ exp: 100 }), env, 100000), /expired/)
  const nonFinite = `${encode({ alg: 'RS256', kid: jwk.kid })}.${Buffer.from(JSON.stringify(claims).replace(String(claims.exp), '1e400')).toString('base64url')}.invalid`
  await assert.rejects(core.verifyGoogleIdToken(nonFinite, env, now), /expired/)
  for (const iss of ['https://attacker.invalid', undefined, '']) {
    await assert.rejects(core.verifyGoogleIdToken(token({ iss }), env, now), /issuer/)
  }
})

test('tampered payload, signature, unknown key and non-RS256 algorithms rejected', async t => {
  const { core } = fixture(t)
  const valid = token()
  const parts = valid.split('.')
  for (const invalid of [
    `${parts[0]}.${encode({ ...claims, email: 'attacker@example.invalid' })}.${parts[2]}`,
    `${parts[0]}.${parts[1]}.${Buffer.alloc(256).toString('base64url')}`,
    token({}, { alg: 'RS256', kid: 'unknown-key' }),
  ]) await assert.rejects(core.verifyGoogleIdToken(invalid, env, now), /signature/)
  for (const alg of ['none', 'HS256']) {
    await assert.rejects(core.verifyGoogleIdToken(token({}, { alg, kid: jwk.kid }), env, now), /algorithm/)
  }
})

test('Google tokeninfo fallback accepts matching independently verified claims', async t => {
  const { core } = fixture(t, { jwks: false, info: { ...claims, exp: String(claims.exp), email_verified: 'true' } })
  assert.equal((await core.verifyGoogleIdToken(token(), env, now)).sub, claims.sub)
})

for (const [field, value] of [
  ['aud', 'other-client'], ['iss', 'https://attacker.invalid'], ['exp', '1'],
  ['exp', undefined], ['sub', 'other-sub'], ['email', 'attacker@example.invalid'],
  ['email_verified', 'false'],
]) {
  test(`tokeninfo fallback rejects inconsistent ${field}=${value}`, async t => {
    const { core } = fixture(t, { jwks: false, info: { ...claims, [field]: value } })
    await assert.rejects(core.verifyGoogleIdToken(token(), env, now), /signature/)
  })
}

test('JWKS and tokeninfo unavailability fail closed', async t => {
  const { core } = fixture(t, { unavailable: true })
  await assert.rejects(core.verifyGoogleIdToken(token(), env, now), /signature/)
})

test('mock identity requires exact explicit flag; flag never bypasses real JWT validation', async t => {
  const { core, calls } = fixture(t)
  for (const flag of [undefined, 'false', 'TRUE', true]) {
    await assert.rejects(core.verifyGoogleIdToken('test_token:sub:user@example.invalid', {
      ...env, TEST_MOCK_AUTH: flag,
    }, now, new Request('http://localhost')), /Malformed/)
  }
  assert.equal((await core.verifyGoogleIdToken('test_token:sub:user@example.invalid', {
    TEST_MOCK_AUTH: 'true',
  }, now, new Request('http://localhost'))).sub, 'sub')
  await assert.rejects(core.verifyGoogleIdToken(token({ aud: 'other-client' }), {
    ...env, TEST_MOCK_AUTH: 'true',
  }, now), /audience mismatch/)
  assert.equal(calls.length, 0)
})

test('session endpoint preserves valid Google login; missing audience and mock attempts do no D1 work', async t => {
  const { core, session } = fixture(t)
  let reads = 0
  let writes = 0
  const user = {
    id: 'disposable-user', google_sub: claims.sub, email: claims.email,
    role: 'member', access_status: 'active', display_name: null, picture_url: null,
    created_at: '', updated_at: '', last_login_at: '',
  }
  const DB = { prepare() { return {
    bind() { return this },
    async first() { reads++; return { ...user } },
    async run() { writes++; return { success: true } },
  } } }
  const bindings = { DB, AUTH_SECRET: 'disposable-private-key', ...env }
  const post = credential => new Request('https://disposable.invalid/api/auth/session', {
    method: 'POST', body: JSON.stringify({ idToken: credential }),
  })
  const response = await session.onRequestPost({ request: post(token()), env: bindings })
  assert.equal(response.status, 200)
  const { sessionToken } = await response.json()
  assert.equal((await core.verifySessionToken(sessionToken, bindings.AUTH_SECRET)).uid, user.id)
  reads = writes = 0
  const withoutAudience = { DB, AUTH_SECRET: bindings.AUTH_SECRET }
  for (const credential of [token(), 'test_token:sub:user@example.invalid']) {
    const rejected = await session.onRequestPost({ request: post(credential), env: withoutAudience })
    assert.equal(rejected.status, 401)
    assert.deepEqual(await rejected.json(), { success: false, error: 'Authentication failed' })
  }
  assert.deepEqual({ reads, writes }, { reads: 0, writes: 0 })
  // Audience config must not invalidate a private-key session already issued.
  assert.equal((await core.authenticateUserRequest(new Request('https://disposable.invalid', {
    headers: { Authorization: `Bearer ${sessionToken}` },
  }), withoutAudience)).user.id, user.id)
})


test('mock identity fails closed without local request context or with any Pages marker', async t => {
  const { core, calls } = fixture(t)
  const mock = 'test_token:disposable-sub:user@example.invalid'
  const bindings = { TEST_MOCK_AUTH: 'true' }
  for (const request of [undefined, { url: 'invalid-url' }, { url: 'https://localhost@attacker.invalid' }, new Request('file:///localhost')]) {
    await assert.rejects(core.verifyGoogleIdToken(mock, bindings, now, request), /Malformed/)
  }
  for (const marker of ['CF_PAGES', 'CF_PAGES_URL', 'CF_PAGES_BRANCH', 'CF_PAGES_COMMIT_SHA']) {
    for (const value of ['1', 'true', 'false', '', null]) {
      await assert.rejects(core.verifyGoogleIdToken(mock, { ...bindings, [marker]: value },
        now, new Request('http://localhost')), /Malformed/)
    }
  }
  for (const url of ['http://localhost:8788', 'http://127.0.0.1:8788', 'http://[::1]:8788']) {
    assert.equal((await core.verifyGoogleIdToken(mock, bindings, now, new Request(url))).sub, 'disposable-sub')
  }
  assert.equal(calls.length, 0)
})

test('hosted mock tokens cannot bootstrap, mint sessions, read users or authorize user/admin access', async t => {
  const { core, session, calls } = fixture(t)
  const admin = require('../functions/api/admin/users.ts')
  const approve = require('../functions/api/admin/approve.ts')
  let databaseCalls = 0
  const bindings = {
    TEST_MOCK_AUTH: 'true', AUTH_SECRET: 'disposable-private-key',
    GOOGLE_CLIENT_ID: claims.aud, BOOTSTRAP_ADMIN_GOOGLE_SUB: 'disposable-sub',
    BOOTSTRAP_ADMIN_EMAIL: 'owner@example.invalid',
    DB: { prepare() { databaseCalls++; throw new Error('Rejected identity must not reach D1') } },
  }
  const mock = 'test_token:disposable-sub:owner@example.invalid:Owner'
  const headers = {
    Authorization: `Bearer ${mock}`, Host: 'localhost', Origin: 'http://localhost',
    'X-Forwarded-Host': '127.0.0.1', 'X-Forwarded-Proto': 'http',
    Forwarded: 'host=localhost;proto=http',
  }
  const cases = [
    ['https://gtar-web.pages.dev', {}],
    ['https://dev.gtar-web.pages.dev', {}],
    ['https://checkpoint.gtar-web.pages.dev', { CF_PAGES: '1', CF_PAGES_BRANCH: 'dev' }],
    ['https://gtar.example.invalid', {}],
    ['http://192.168.1.2:8788', {}],
    ['https://localhost.attacker.invalid', {}],
    ['http://localhost:8788', { CF_PAGES: '1' }],
  ]
  for (const [url, markers] of cases) {
    const env = { ...bindings, ...markers }
    const post = await session.onRequestPost({ env, request: new Request(`${url}/api/auth/session`, {
      method: 'POST', headers, body: JSON.stringify({ idToken: mock }),
    }) })
    assert.equal(post.status, 401, url)
    assert.deepEqual(await post.json(), { success: false, error: 'Authentication failed' })
    const request = new Request(`${url}/api/auth/session`, { headers })
    assert.equal((await session.onRequestGet({ request, env })).status, 401, url)
    assert.equal((await core.authenticateUserRequest(request, env)).status, 401, url)
    assert.equal((await core.authenticateAdminRequest(request, env)).status, 401, url)
    assert.equal((await admin.onRequestGet({ request, env })).status, 401, url)
    assert.equal((await approve.onRequestPost({ env, request: new Request(`${url}/api/admin/approve`, {
      method: 'POST', headers, body: JSON.stringify({ userId: 'target-user' }),
    }) })).status, 401, url)
  }
  assert.equal(databaseCalls, 0)
  assert.equal(calls.length, 0)
})

test('local mock and private-key session remain compatible across all authentication entry points', async t => {
  const { core, session } = fixture(t)
  const user = {
    id: 'disposable-user', google_sub: 'disposable-sub', email: 'user@example.invalid',
    role: 'admin', access_status: 'active', display_name: null, picture_url: null,
    created_at: '', updated_at: '', last_login_at: '',
  }
  const env = {
    TEST_MOCK_AUTH: 'true', AUTH_SECRET: 'disposable-private-key',
    DB: { prepare() { return {
      bind() { return this }, async first() { return { ...user } },
      async run() { return { success: true } },
    } } },
  }
  const mock = 'test_token:disposable-sub:user@example.invalid'
  const post = await session.onRequestPost({ env, request: new Request('http://localhost/api/auth/session', {
    method: 'POST', body: JSON.stringify({ idToken: mock }),
  }) })
  assert.equal(post.status, 200)
  const { sessionToken } = await post.json()
  for (const [url, credential, markers] of [
    ['http://localhost', mock, {}],
    ['https://disposable.invalid', sessionToken, { CF_PAGES: '1' }],
  ]) {
    const request = new Request(`${url}/api/auth/session`, { headers: { Authorization: `Bearer ${credential}` } })
    const bindings = { ...env, ...markers }
    assert.equal((await session.onRequestGet({ request, env: bindings })).status, 200)
    assert.equal((await core.authenticateUserRequest(request, bindings)).user?.id, user.id)
    assert.equal((await core.authenticateAdminRequest(request, bindings)).user?.id, user.id)
  }
})
