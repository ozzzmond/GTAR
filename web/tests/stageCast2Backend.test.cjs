const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { StageCast2Hub, POLICY, digest, securePin, transition } = require('../workers/stageCast2Backend.ts')
const { createStageCast2Worker } = require('../workers/stageCast2Worker.ts')
const { applyCast2Message, initialCast2SyncState } = require('../src/utils/stageCast2Sync.ts')
class MemoryStorage {
  data = new Map()
  fail = false
  async get(key) { return structuredClone(this.data.get(key)) }
  async put(key, value) { if (this.fail) throw Error('storage'); this.data.set(key, structuredClone(value)) }
  async setAlarm(time) { this.alarm = time }
}
class FakeSocket {
  events = {}; sent = []; closed = false
  accept() { this.accepted = true }
  addEventListener(type, fn) { this.events[type] = fn }
  send(text) { if (this.closed) throw Error('closed'); this.sent.push(JSON.parse(text)) }
  close() { this.closed = true }
  emit(data) { this.events.message({ data }) }
}
async function fixture(storage = new MemoryStorage()) {
  const clock = { now: 1_000_000 }
  const sockets = []
  const rt = { now: () => clock.now, upgrade: () => {
    const server = new FakeSocket(); sockets.push(server)
    return { server, response: new Response(null, { status: 200 }) } // Node cannot construct Cloudflare's 101 Response.
  } }
  const hub = new StageCast2Hub({ storage }, undefined, rt)
  const ip = await digest('trusted-test-ip')
  const call = async (path, data = {}, owner = '', client = ip) => {
    const response = await hub.fetch(new Request('https://internal' + path, { method: 'POST',
      headers: { 'x-cast-client': client, 'x-cast-owner': owner }, body: JSON.stringify(data) }))
    return { status: response.status, ...await response.json() }
  }
  const create = () => call('/create')
  const claim = (s, owner = 'user-1') => call('/claim', { ref: s.ref, pin: s.pin }, owner)
  const receiver = s => ({ ref: s.ref, role: 'receiver', credential: s.receiverCredential })
  const controller = (s, c) => ({ ref: s.ref, role: 'controller', credential: c.controllerCredential })
  const decide = (s, c, approve = true) => call('/decide', { ...receiver(s), requestId: c.requestId, approve })
  const paired = async () => {
    const s = await create(), c = await claim(s)
    assert.equal((await call('/status', receiver(s))).state, 'PAIRED')
    return { s, c }
  }
  const connectTicket = async ticket => {
    const response = await hub.fetch(new Request('https://internal/socket', { headers: {
      'x-cast-client': ip, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `cast2, ticket.${ticket}`,
    } }))
    return { response, socket: sockets.at(-1) }
  }
  const connect = async (s, c, role) => {
    const scoped = role === 'receiver' ? receiver(s) : controller(s, c)
    const ticket = await call('/ticket', scoped, role === 'controller' ? 'user-1' : '')
    assert.equal(ticket.status, 200)
    return (await connectTicket(ticket.ticket)).socket
  }
  // Serial alarm is a deterministic event barrier; no sleeps or production credentials.
  const flush = () => hub.alarm()
  return { storage, clock, sockets, rt, hub, ip, call, create, claim, receiver, controller, decide, paired, connect, connectTicket, flush }
}
const snapshot = () => ({ songId: 'song', displayTitle: 'Title', lines: [{ type: 'LYRIC', lyrics: 'Words' }],
  chordsVisible: false, transpose: { offset: 0, effectiveKey: 'C' }, position: { lineIndex: 0 },
  scroll: { top: 0, fraction: 0 }, mode: { columns: 1, notation: 'chords' } })
const message = (s, sequence = 1, type = 'PRESENTATION_SNAPSHOT', payload = { snapshot: snapshot() }, direction = 'CONTROLLER_TO_SERVER') => ({
  version: 1, sessionId: s.ref, type, direction, sequence, timestamp: 0, payload,
})
test('SESSION_CREATION: cryptographic PIN/reference, isolated scopes, no plaintext persisted', async () => {
  const f = await fixture(), s = await f.create()
  assert.equal(s.status, 200); assert.match(s.pin, /^\d{6}$/); assert.match(s.ref, /^[a-f0-9]{64}$/)
  assert.notEqual(s.ref, s.receiverCredential)
  assert.equal(s.pairingExpiresAt, f.clock.now + POLICY.pairingMs)
  assert.equal((await f.call('/status', f.receiver(s))).state, 'WAITING_FOR_CONTROLLER')
  const c = await f.claim(s)
  assert.notEqual(c.controllerCredential, s.receiverCredential)
  const saved = JSON.stringify(f.storage.data.get('hub'))
  for (const value of [s.receiverCredential, c.controllerCredential]) assert.ok(!saved.includes(value))
  assert.equal(f.storage.data.get('hub').sessions[0].pinHash, '')
  assert.equal(saved.includes('Words'), false)
})
test('PIN_FORMAT: rejection sampling, leading zeros, cryptographic distinct references', async () => {
  const original = crypto.getRandomValues.bind(crypto)
  const values = [4_294_000_000, 0]
  crypto.getRandomValues = array => { array[0] = values.shift(); return array }
  try { assert.equal(securePin(), '000000'); assert.equal(values.length, 0) }
  finally { crypto.getRandomValues = original }
  const f = await fixture(), a = await f.create(), b = await f.create()
  assert.notEqual(a.ref, b.ref)
})
test('POSSESSION_PAIRING: active owner plus one-time PIN authorizes; QR reference alone cannot', async () => {
  const f = await fixture(), s = await f.create()
  assert.equal((await f.claim(s, '')).status, 401)
  assert.equal((await f.call('/claim', { ref: s.ref }, 'user-1')).status, 400)
  assert.equal((await f.call('/claim', { ref: s.ref, pin: 'bad' }, 'user-1')).status, 403)
  const c = await f.claim(s)
  assert.equal((await f.call('/status', f.receiver(s))).state, 'PAIRED')
  assert.equal((await f.call('/ticket', f.controller(s, c), 'user-1')).status, 200)
  assert.equal((await f.call('/decide', { ...f.controller(s, c), requestId: c.requestId, approve: true }, 'user-1')).status, 400)
  assert.equal((await f.claim(s)).status, 403)
})

test('RECEIVER_EXIT: revocation destroys scopes and prevents replay', async () => {
  const f = await fixture(), s = await f.create(), c = await f.claim(s)
  assert.equal((await f.call('/revoke', f.receiver(s))).state, 'REVOKED')
  for (const scope of [f.receiver(s), f.controller(s, c)]) assert.equal((await f.call('/status', scope, 'user-1')).status, 403)
  assert.equal((await f.claim(s)).status, 403)
})

test('PIN_RATE_LIMIT: durable attempt budget survives object restart', async () => {
  const f = await fixture(), s = await f.create(), wrong = s.pin === '111111' ? '222222' : '111111'
  for (let i = 0; i < POLICY.guesses; i++) assert.equal((await f.call('/claim', { ref: s.ref, pin: wrong }, 'user-1')).status, 403)
  const restarted = await fixture(f.storage)
  assert.equal((await restarted.claim(s)).status, 403)
  assert.equal((await restarted.call('/status', restarted.receiver(s))).status, 403)
})
test('PIN / QR_REFERENCE_EXPIRY: unclaimed credentials expire at exact deadline', async () => {
  const f = await fixture(), s = await f.create()
  f.clock.now = s.pairingExpiresAt
  assert.equal((await f.claim(s)).status, 403)
  assert.equal((await f.call('/status', f.receiver(s))).status, 403)
  assert.equal(f.storage.data.get('hub').sessions[0].state, 'EXPIRED')
})

test('ATOMIC_CLAIM: concurrent owners cannot reuse PIN; replay remains denied after restart', async () => {
  const f = await fixture(), s = await f.create()
  const claims = await Promise.all([f.claim(s, 'user-1'), f.claim(s, 'user-2')])
  assert.deepEqual(claims.map(c => c.status), [200, 403])
  const restarted = await fixture(f.storage)
  assert.equal((await restarted.claim(s, 'user-2')).status, 403)
  assert.equal((await restarted.call('/status', restarted.controller(s, claims[0]), 'user-2')).status, 403)
  assert.equal((await restarted.call('/status', restarted.controller(s, claims[0]), 'user-1')).state, 'DISCONNECTED')
})

test('ROLE_ISOLATION / CROSS_SESSION_DENIAL / UNAUTHORIZED_ACCESS: owner and secret required', async () => {
  const f = await fixture(), { s, c } = await f.paired(), other = await f.create()
  for (const b of [f.controller(s, { controllerCredential: s.receiverCredential }),
    { ...f.receiver(s), credential: c.controllerCredential }, { ...f.receiver(other), credential: s.receiverCredential },
    { ref: 'unknown', role: 'receiver', credential: s.receiverCredential }, { ...f.receiver(s), credential: '' }]) {
    assert.equal((await f.call('/status', b, 'user-1')).status, 403)
  }
  assert.equal((await f.call('/status', f.controller(s, c), 'user-2')).status, 403)
  assert.equal((await f.call('/status', f.controller(s, c))).status, 403)
})
test('ORDERED_DELIVERY / RECONNECT: server sequences, atomic projection and P0 reducer compatibility', async () => {
  const f = await fixture(), { s, c } = await f.paired()
  const r = await f.connect(s, c, 'receiver'), ctl = await f.connect(s, c, 'controller')
  assert.ok(ctl.sent.some(m => m.type === 'SYNC_ERROR'))
  ctl.emit(JSON.stringify(message(s, 50))); await f.flush()
  assert.equal(r.sent[0].sequence, 1)
  let reducer = applyCast2Message(initialCast2SyncState(s.ref), r.sent[0])
  assert.equal(reducer.error, null)
  ctl.emit(JSON.stringify(message(s, 51, 'PRESENTATION_UPDATE', { baseSequence: 1, snapshot: { ...snapshot(), displayTitle: 'Next' } })))
  await f.flush()
  reducer = applyCast2Message(reducer.state, r.sent[1]); assert.equal(reducer.error, null)
  assert.equal(reducer.state.snapshot.displayTitle, 'Next')
  const r2 = await f.connect(s, c, 'receiver')
  assert.equal(r.closed, true); assert.equal(r2.sent[0].type, 'PRESENTATION_SNAPSHOT'); assert.equal(r2.sent[0].sequence, 3)
  assert.equal(applyCast2Message(reducer.state, r2.sent[0]).error, null)
  assert.equal(f.storage.data.get('hub').sessions[0].sequence, 3)
  assert.equal(JSON.stringify(f.storage.data.get('hub')).includes('Next'), false)
})
test('REPLAY_REJECTION: tickets single use, expire, invalidate older tickets, survive restart', async () => {
  const f = await fixture(), { s, c } = await f.paired()
  const t = await f.call('/ticket', f.receiver(s))
  assert.equal((await f.connectTicket(t.ticket)).response.status, 200)
  assert.equal((await f.connectTicket(t.ticket)).response.status, 403)
  const t2 = await f.call('/ticket', f.controller(s, c), 'user-1')
  f.clock.now += POLICY.ticketMs
  assert.equal((await f.connectTicket(t2.ticket)).response.status, 403)
  const t3 = await f.call('/ticket', f.receiver(s))
  await f.call('/ticket', f.receiver(s))
  assert.equal((await f.connectTicket(t3.ticket)).response.status, 403)
  const restarted = await fixture(f.storage)
  assert.equal((await restarted.connectTicket(t.ticket)).response.status, 403)
})
test('MESSAGE_VALIDATION / OVERSIZED_PAYLOADS / REPLAY: malicious frames close without broadcast', async () => {
  const mutations = [m => ({ ...m, version: 2 }), m => ({ ...m, sessionId: 'other' }), m => ({ ...m, direction: 'SERVER_TO_RECEIVER' }),
    m => ({ ...m, payload: { snapshot: { ...snapshot(), token: 'secret' } } }), m => ({ ...m, type: 'PAIRING_APPROVAL', payload: { requestId: 'x' } }),
    () => ' '.repeat(262145), () => new Uint8Array(3), () => '{']
  for (const mutate of mutations) {
    const f = await fixture(), { s, c } = await f.paired(), r = await f.connect(s, c, 'receiver'), ctl = await f.connect(s, c, 'controller')
    const m = mutate(message(s)); ctl.emit(typeof m === 'object' && !ArrayBuffer.isView(m) ? JSON.stringify(m) : m)
    await f.flush(); assert.equal(ctl.closed, true); assert.equal(r.sent.length, 0)
  }
  const f = await fixture(), { s, c } = await f.paired(), r = await f.connect(s, c, 'receiver'), ctl = await f.connect(s, c, 'controller')
  ctl.emit(JSON.stringify(message(s))); await f.flush()
  ctl.emit(JSON.stringify(message(s))); await f.flush()
  assert.equal(ctl.closed, true); assert.equal(r.sent.length, 1)
})
test('ROLE_ISOLATION: receiver cannot inject presentation or forward arbitrary sync errors', async () => {
  for (const frame of [s => message(s, 1, 'PRESENTATION_SNAPSHOT', { snapshot: snapshot() }, 'RECEIVER_TO_SERVER'),
    s => message(s, 1, 'SYNC_ACK', { appliedSequence: 999 }, 'RECEIVER_TO_SERVER'),
    s => message(s, 1, 'SYNC_ERROR', { code: 'SESSION_REVOKED' }, 'RECEIVER_TO_SERVER')]) {
    const f = await fixture(), { s, c } = await f.paired(), r = await f.connect(s, c, 'receiver')
    const ctl = await f.connect(s, c, 'controller'), before = ctl.sent.length
    r.emit(JSON.stringify(frame(s))); await f.flush()
    assert.equal(r.closed, true); assert.equal(ctl.sent.length, before)
  }
})
test('HEARTBEAT / RECONNECT / EVICTION: idle disconnect, snapshot loss requires fresh controller snapshot', async () => {
  const f = await fixture(), { s, c } = await f.paired(), r = await f.connect(s, c, 'receiver'), ctl = await f.connect(s, c, 'controller')
  ctl.emit(JSON.stringify(message(s))); await f.flush()
  f.clock.now += 30_000; r.emit('ping'); await f.flush(); assert.equal(r.sent.at(-1), 'pong')
  f.clock.now += 15_000; await f.flush()
  assert.equal(ctl.closed, true); assert.equal(r.closed, false)
  const restarted = await fixture(f.storage), ctl2 = await restarted.connect(s, c, 'controller')
  assert.ok(ctl2.sent.some(m => m.payload.code === 'RESYNC_REQUIRED'))
  const r2 = await restarted.connect(s, c, 'receiver')
  ctl2.emit(JSON.stringify(message(s, 2))); await restarted.flush()
  assert.equal(r2.sent[0].sequence, 2)
})
test('SESSION_REVOCATION / SESSION_EXPIRY: revocation clears P0 display and invalidates live sockets/tickets', async () => {
  for (const expire of [false, true]) {
    const f = await fixture(), { s, c } = await f.paired(), r = await f.connect(s, c, 'receiver'), ctl = await f.connect(s, c, 'controller')
    ctl.emit(JSON.stringify(message(s))); await f.flush()
    const t = await f.call('/ticket', f.receiver(s))
    if (expire) { f.clock.now = s.expiresAt; await f.flush() }
    else assert.equal((await f.call('/revoke', f.controller(s, c), 'user-1')).state, 'REVOKED')
    assert.equal(r.closed, true); assert.equal(ctl.closed, true)
    const state = applyCast2Message(initialCast2SyncState(s.ref), r.sent[0]).state
    const revoked = applyCast2Message(state, r.sent.at(-1))
    assert.equal(revoked.error, null); assert.equal(revoked.state.revoked, true); assert.equal(revoked.state.snapshot, null)
    assert.equal((await f.connectTicket(t.ticket)).response.status, 403)
  }
})
test('FAIL_CLOSED: durable storage failure returns unavailable, no in-memory authorization afterward', async () => {
  const f = await fixture(), s = await f.create()
  f.storage.fail = true
  assert.equal((await f.claim(s)).status, 503)
  f.storage.fail = false
  assert.equal((await f.call('/status', f.receiver(s))).status, 503)
})
test('INVALID_TRANSITIONS: all state pairs deterministic; terminal states immutable', () => {
  const legal = { CREATED: ['WAITING_FOR_CONTROLLER'], WAITING_FOR_CONTROLLER: ['PAIRED', 'EXPIRED', 'REVOKED'],
    AWAITING_TV_APPROVAL: ['EXPIRED', 'REVOKED'], PAIRED: ['DISCONNECTED', 'EXPIRED', 'REVOKED'],
    DISCONNECTED: ['PAIRED', 'EXPIRED', 'REVOKED'], EXPIRED: [], REVOKED: [] }
  for (const from of Object.keys(legal)) for (const to of Object.keys(legal)) {
    if (legal[from].includes(to)) assert.equal(transition(from, to), to)
    else assert.throws(() => transition(from, to), /INVALID_STATE/)
  }
})
test('BOUNDED_ABUSE: global admission, per-client creation, per-owner and websocket flood limits', async () => {
  const f = await fixture()
  for (let i = 0; i < 5; i++) assert.equal((await f.create()).status, 200)
  assert.equal((await f.create()).status, 429)
  const f2 = await fixture(), { s, c } = await f2.paired(), ctl = await f2.connect(s, c, 'controller')
  for (let i = 0; i < 31; i++) ctl.emit('ping')
  await f2.flush(); assert.equal(ctl.closed, true)
  const f3 = await fixture()
  for (let i = 0; i < POLICY.requests; i++) await f3.call('/status', {}, '', await digest('ip-' + i))
  assert.equal((await f3.create()).status, 429)
})
test('GATEWAY: disabled by default, strict Origin, real auth adapter, no identity/token forwarding', async () => {
  const seen = []; let calls = 0
  const auth = async request => {
    calls++
    return request.headers.get('Authorization') === 'Bearer valid' ? { user: { id: 'verified-owner', access_status: 'active' } } : { error: 'denied', status: 401 }
  }
  const worker = createStageCast2Worker(auth)
  const env = { CAST2_MODE: 'reviewed-v1', CAST2_ORIGIN: 'https://gtar.test', CAST2_HUB: {
    idFromName: n => n, get: () => ({ fetch: async r => { seen.push(r); return Response.json({ ok: true }) } }),
  } }
  const req = (path, payload, overrides = {}) => new Request('https://backend.test' + path, { method: 'POST',
    headers: { Origin: 'https://gtar.test', 'CF-Connecting-IP': '127.0.0.1', 'x-cast-owner': 'forged', Authorization: 'Bearer valid', ...overrides }, body: JSON.stringify(payload) })
  assert.equal((await worker.fetch(req('/create', {}), {})).status, 503)
  assert.equal((await worker.fetch(req('/claim', {}, { Origin: 'https://evil.test' }), env)).status, 403)
  assert.equal((await worker.fetch(req('/claim', {}, { Authorization: 'Bearer invalid' }), env)).status, 401)
  assert.equal((await worker.fetch(req('/claim', {}), env)).status, 200)
  assert.equal(seen.at(-1).headers.get('x-cast-owner'), 'verified-owner')
  assert.equal(seen.at(-1).headers.has('Authorization'), false)
  assert.equal((await worker.fetch(req('/create', {}), env)).status, 200)
  assert.equal(seen.at(-1).headers.has('x-cast-owner'), false)
  assert.equal((await worker.fetch(req('/ticket', { role: 'controller' }, { Authorization: '' }), env)).status, 401)
  assert.equal((await worker.fetch(req('/create?credential=secret', {}), env)).status, 403)
  assert.equal((await worker.fetch(req('/create', { x: 'a'.repeat(2048) }), env)).status, 413)
  assert.ok(calls >= 3)
})

test('PAIRING_ABUSE: distributed guesses share a durable session budget and burn PIN on final failure', async () => {
  const f = await fixture(), s = await f.create()
  const wrong = s.pin === '111111' ? '222222' : '111111'
  const attempts = await Promise.all(Array.from({ length: POLICY.guesses }, async (_, index) =>
    f.call('/claim', { ref: s.ref, pin: wrong }, 'owner-' + index, await digest('ip-' + index))))
  assert.ok(attempts.every(attempt => attempt.status === 403))
  assert.equal(f.storage.data.get('hub').sessions[0].state, 'REVOKED')
  assert.equal((await f.claim(s)).status, 403)
})

test('OWNER_RATE_LIMIT: persists across restart and bounds attempts over different TVs', async () => {
  const f = await fixture(), a = await f.create(), b = await f.create(), c = await f.create()
  const wrong = s => s.pin === '111111' ? '222222' : '111111'
  for (const s of [a, b]) for (let i = 0; i < POLICY.guesses; i++)
    assert.equal((await f.call('/claim', { ref: s.ref, pin: wrong(s) }, 'same-owner')).status, 403)
  const restarted = await fixture(f.storage)
  assert.equal((await restarted.claim(c, 'same-owner')).status, 429)
})

test('GATEWAY_AUTHORIZATION: pending/denied/absent identities cannot claim or use controller scopes', async () => {
  for (const access_status of ['pending', 'denied', 'active']) {
    let forwarded = 0
    const worker = createStageCast2Worker(async () => ({ user: { id: 'owner', access_status } }))
    const env = { CAST2_MODE: 'reviewed-v1', CAST2_ORIGIN: 'https://gtar.test', CAST2_HUB: {
      idFromName: n => n, get: () => ({ fetch: async () => { forwarded++; return Response.json({ ok: true }) } }),
    } }
    for (const [route, payload] of [['/claim', {}], ['/ticket', { role: 'controller' }], ['/revoke', { role: 'controller' }]]) {
      const response = await worker.fetch(new Request('https://worker.test' + route, { method: 'POST', headers: {
        Origin: 'https://gtar.test', 'CF-Connecting-IP': '127.0.0.1', Authorization: 'Bearer test',
      }, body: JSON.stringify(payload) }), env)
      assert.equal(response.status, access_status === 'active' ? 200 : 401)
    }
    assert.equal(forwarded, access_status === 'active' ? 3 : 0)
  }
})
