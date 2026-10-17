const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, filename)

const protection = require('../functions/lib/abuseProtection.ts')
const auth = require('../functions/lib/authCore.ts')
const share = require('../functions/api/setlist/share.ts')
const sync = require('../functions/api/songbook/sync.ts')
const metadata = require('../functions/api/songbook/metadata.ts')
const session = require('../functions/api/auth/session.ts')
const { createSongbookSqlite } = require('./helpers/songbookSqlite.cjs')
const secret = 'synthetic-g2-abuse-secret-at-least-32-characters'
const wallClock = Date.now
before(() => { Date.now = () => 1_800_000_000_000 })
after(() => { Date.now = wallClock })

// Deterministic model of durable atomic storage, shared by reconstructed DO instances.
// This is a fixture, never an application limiter or proof of live CF configuration.
function namespace() {
  const stores = new Map()
  const names = []
  const paths = []
  return { names, paths, idFromName(name) { names.push(name); return name }, get(id) {
    if (!stores.has(id)) {
      const data = new Map()
      let tail = Promise.resolve()
      stores.set(id, { transaction(callback) {
        const result = tail.then(async () => {
          const pending = new Map(data)
          const result = await callback({ get: async key => structuredClone(pending.get(key)),
            put: async (key, value) => { pending.set(key, structuredClone(value)) } })
          data.clear(); for (const [key, value] of pending) data.set(key, value)
          return result
        })
        tail = result.catch(() => {})
        return result
      } })
    }
    return { fetch(request) { paths.push(new URL(request.url).pathname)
      return new protection.ApiAbuseLimiter({ storage: stores.get(id) }).fetch(request) } }
  } }
}
const enabled = ns => ({ AUTH_SECRET: secret, API_ABUSE_MODE: 'durable-v1', API_ABUSE_LIMITER: ns })

test('all policies enforce exactly their quotas across concurrent reconstructed instances and reset', async () => {
  const original = Date.now
  let now = 3_600_000 + 500
  Date.now = () => now
  try {
    for (const [policy, { limit, windowMs, identity }] of Object.entries(protection.ABUSE_POLICIES)) {
      now = 3_600_000 + 500
      const ns = namespace()
      const instances = [enabled(ns), enabled(ns)]
      const results = await Promise.all(Array.from({ length: limit + 7 }, (_, i) =>
        protection.enforceAbuseLimit(instances[i % 2], policy, identity === 'account' ? 'user-a' : undefined)))
      assert.equal(results.filter(r => r === null).length, limit, policy)
      for (const response of results.filter(Boolean)) {
        assert.equal(response.status, 429)
        assert.equal(response.headers.get('Retry-After'), String(Math.ceil(windowMs / 1000)))
        assert.equal(response.headers.get('Cache-Control'), 'no-store')
        assert.equal((await response.json()).error, 'RATE_LIMIT_EXCEEDED')
      }
      if (identity === 'account') assert.equal(await protection.enforceAbuseLimit(instances[0], policy, 'user-b'), null)
      now += windowMs
      assert.equal(await protection.enforceAbuseLimit(instances[0], policy, identity === 'account' ? 'user-a' : undefined), null)
      assert.ok(ns.names.every(name => /^[a-f0-9]{64}$/.test(name)))
    }
  } finally { Date.now = original }
})

test('single caller expires on the exact boundary with positive rounded Retry-After', async () => {
  const original = Date.now
  let now = 119_999
  Date.now = () => now
  try {
    const env = enabled(namespace())
    for (let i = 0; i < 10; i++) assert.equal(await protection.enforceAbuseLimit(env, 'metadata', 'a'), null)
    assert.equal((await protection.enforceAbuseLimit(env, 'metadata', 'a')).headers.get('Retry-After'), '1')
    now = 120_000
    assert.equal(await protection.enforceAbuseLimit(env, 'metadata', 'a'), null)
  } finally { Date.now = original }
})

test('disabled stays dormant; explicit invalid configuration and backend failures fail closed without logging', async () => {
  const ns = namespace()
  assert.equal(protection.abuseConfiguration({}), 'disabled')
  assert.equal(await protection.enforceAbuseLimit(undefined, 'metadata'), null)
  assert.equal(await protection.enforceAbuseLimit({ API_ABUSE_LIMITER: ns }, 'metadata'), null)
  assert.equal(ns.names.length, 0)
  const saved = console.error
  let logs = 0
  console.error = () => { logs++ }
  try {
    for (const env of [
      { API_ABUSE_MODE: 'durable-v1' },
      { ...enabled(ns), AUTH_SECRET: 'short' },
      { ...enabled(ns), API_ABUSE_MODE: 'typo' },
      enabled({ idFromName() { throw new Error('private identity') }, get() {} }),
      ...[new Response(null, { status: 500 }), Response.json({ allowed: false, retryAfter: 0 }),
        Response.json({ allowed: true }), Response.json({ allowed: false, retryAfter: 999999 }),
        new Response('broken')].map(response => enabled({ idFromName: n => n, get: () => ({ fetch: async () => response }) })),
      enabled({ idFromName: n => n, get: () => ({ fetch: async () => { throw new Error('secret backend') } }) }),
    ]) {
      const result = await protection.enforceAbuseLimit(env, 'metadata', 'a')
      assert.equal(result.status, 503)
      assert.equal(result.headers.get('Retry-After'), '5')
      assert.equal((await result.json()).error, 'ABUSE_PROTECTION_UNAVAILABLE')
    }
    assert.equal((await protection.enforceAbuseLimit(enabled(ns), 'metadata')).status, 503)
    assert.equal(logs, 0)
  } finally { console.error = saved }
})

test('stalled backend headers and body fail closed even when transport ignores abort', async () => {
  for (const stalled of [() => new Promise(() => {}), async () =>
    new Response(new ReadableStream({ start() {} }))]) {
    const env = enabled({ idFromName: n => n, get: () => ({ fetch: stalled }) })
    const result = await protection.enforceAbuseLimit(env, 'metadata', 'synthetic-timeout-user')
    assert.equal(result.status, 503)
    assert.equal(result.headers.get('Retry-After'), '5')
  }
})

async function fixture(ns = namespace()) {
  const user = { id: 'synthetic-user', google_sub: 'synthetic-sub', email: 'synthetic@example.invalid',
    role: 'member', access_status: 'active' }
  const db = createSongbookSqlite()
  const prepared = db.prepare.bind(db)
  const operations = []
  const shares = new Map()
  db.prepare = sql => {
    if (sql.includes('FROM users WHERE id = ?')) return { bind: () => ({ first: async () => user }) }
    if (sql.includes('sessions')) return { bind: () => ({ first: async () => null }) }
    operations.push(sql)
    if (sql.includes('shared_setlists')) return { bind(...args) { return {
      run: async () => { shares.set(args[0], { payload_json: args[2], expires_at: args[4] }); return { success: true } },
      first: async () => shares.get(args[0]) || null,
    } } }
    return prepared(sql)
  }
  const env = { ...enabled(ns), DB: db, AI: { run: async () => ({ response: '{}' }) } }
  const token = await auth.createSessionToken(user, secret)
  const request = (method, body, url = 'https://example.invalid', headers = {}) => new Request(url, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { env, request, user, operations, db }
}

test('denied routes do no AI, storage, or upstream work; auth/permission remains authoritative', async () => {
  let calls = 0
  const reject = { idFromName: n => n, get: () => ({ fetch: async () => { calls++; return Response.json({ allowed: false, retryAfter: 5 }) } }) }
  const f = await fixture(reject)
  let inference = 0
  f.env.AI.run = async () => { inference++ }
  const endpoints = [
    [share, 'onRequestPost', {}], [share, 'onRequestGet', undefined, 'https://example.invalid?token=0123456789abcdef'],
    [sync, 'onRequestPost', {}], [sync, 'onRequestGet'],
    [metadata, 'onRequestPost', { title: 'Synthetic Song' }],
    [require('../functions/api/ug-search.ts'), 'onRequestGet', undefined, 'https://example.invalid?q=Song'],
    [require('../functions/api/ug-tab.ts'), 'onRequestGet', undefined, 'https://example.invalid?url=https://tabs.ultimate-guitar.com/tab/test/song-chords-1234'],
  ]
  const savedFetch = global.fetch
  global.fetch = async () => { throw new Error('unexpected downstream network') }
  try {
    for (const [api, handler, body, url] of endpoints) {
      assert.equal((await api[handler]({ env: f.env, request: f.request(body === undefined ? 'GET' : 'POST', body, url) })).status, 429)
      const before = calls
      const anonymous = new Request(url || 'https://example.invalid', { method: body === undefined ? 'GET' : 'POST' })
      assert.equal((await api[handler]({ env: f.env, request: anonymous })).status, 401)
      assert.equal(calls, before)
    }
    delete f.env.API_ABUSE_LIMITER
    for (const [api, handler, body, url] of endpoints) {
      assert.equal((await api[handler]({ env: f.env,
        request: f.request(body === undefined ? 'GET' : 'POST', body, url) })).status, 503)
    }
    f.user.access_status = 'denied'
    assert.equal((await metadata.onRequestPost({ env: f.env, request: f.request('POST', { title: 'Song' }) })).status, 403)
    assert.equal(inference, 0)
    assert.equal(f.operations.length, 0)
  } finally { global.fetch = savedFetch; f.db.sqlite.close() }
})

test('session account quota uses verified Google subject and rejects before profile writes or session issuance', async () => {
  const paths = []
  const ns = { idFromName: n => n, get: () => ({ fetch: async request => {
    const path = new URL(request.url).pathname
    paths.push(path)
    return Response.json(path === '/session-account' ? { allowed: false, retryAfter: 5 } : { allowed: true, retryAfter: 0 })
  } }) }
  const f = await fixture(ns)
  try {
    f.env.TEST_MOCK_AUTH = 'true'
    const result = await session.onRequestPost({ env: f.env, request: f.request('POST',
      { credential: 'test_token:synthetic-sub:synthetic@example.invalid:Synthetic', userId: 'spoofed' },
      'http://localhost/api/auth/session') })
    assert.equal(result.status, 429)
    assert.deepEqual(paths, ['/session-issue', '/session-account'])
    assert.equal(f.operations.length, 0)
  } finally { f.db.sqlite.close() }
})

test('anonymous session callers share admission despite spoofed IP/account headers; rejection skips verification', async () => {
  const ns = namespace()
  const f = await fixture(ns)
  try {
    for (let i = 0; i < 300; i++) await protection.enforceAbuseLimit(f.env, 'session-issue')
    const result = await session.onRequestPost({ env: f.env, request: f.request('POST', { idToken: 'unverified' },
      'https://example.invalid', { 'CF-Connecting-IP': '192.0.2.1', 'X-Forwarded-For': '192.0.2.2', 'X-User-ID': 'other' }) })
    assert.equal(result.status, 429)
    assert.equal(f.operations.length, 0)
    for (let i = 0; i < 600; i++) await protection.enforceAbuseLimit(f.env, 'session-read')
    assert.equal((await session.onRequestGet({ env: f.env, request: f.request('GET') })).status, 429)
  } finally { f.db.sqlite.close() }
})

test('enabled QR round trip, Sync CAS conflict, body limits, and AI budgets remain compatible', async () => {
  share._resetRateLimitsForTesting()
  const ns = namespace()
  const f = await fixture(ns)
  try {
    const payload = { type: 'GTAR_SHARED_SETLIST', name: 'Synthetic service', songs: [{ title: 'Song', rawContent: '[G]Test' }] }
    const created = await share.onRequestPost({ env: f.env, request: f.request('POST', payload) })
    assert.equal(created.status, 200)
    const { token } = await created.json()
    assert.match(token, /^[a-f0-9]{16,32}$/)
    assert.equal((await share.onRequestGet({ env: f.env, request: f.request('GET', undefined, `https://example.invalid?token=${token}`) })).status, 200)
    const data = { songs: [], setlists: [] }
    const body = { data, expectedVersion: 0, expectedChecksum: null }
    assert.equal((await sync.onRequestPost({ env: f.env, request: f.request('POST', body) })).status, 200)
    assert.equal((await sync.onRequestPost({ env: f.env, request: f.request('POST', body) })).status, 409)
    for (const [api, bytes, body] of [[share, share.MAX_SHARE_PAYLOAD_BYTES, payload],
      [sync, sync.MAX_SONGBOOK_PAYLOAD_BYTES, { data }], [metadata, metadata.MAX_METADATA_PAYLOAD_BYTES, { title: 'Song' }],
      [session, session.MAX_SESSION_PAYLOAD_BYTES, {}]]) {
      assert.equal((await api.onRequestPost({ env: f.env, request: f.request('POST', body, undefined, { 'Content-Length': String(bytes + 1) }) })).status, 413)
    }
    let runs = 0
    f.env.AI.run = async (model, input) => { runs++; assert.equal(input.max_tokens, 300); return { response: '{}' } }
    for (let i = 0; i < 10; i++) await metadata.onRequestPost({ env: f.env, request: f.request('POST', { title: 'Song' }) })
    assert.equal((await metadata.onRequestPost({ env: f.env, request: f.request('POST', { title: 'Song' }) })).status, 429)
    assert.equal(runs, 10)
    assert.equal(ns.paths.filter(p => p === '/metadata-budget').length, 10)
  } finally { f.db.sqlite.close() }
})
