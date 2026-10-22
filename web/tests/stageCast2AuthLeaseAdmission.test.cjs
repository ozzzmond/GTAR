// Regressions for the 2026-10-22 Cast Sync 2.0 readiness audit (#84):
// live controller sockets must lose authority when authenticated HTTP stops renewing it,
// and anonymous floods must not exhaust admission for other clients or authenticated users.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { StageCast2Hub, POLICY, digest } = require('../workers/stageCast2Backend.ts')

class MemoryStorage {
  data = new Map()
  async get(key) { return structuredClone(this.data.get(key)) }
  async put(key, value) { this.data.set(key, structuredClone(value)) }
  async setAlarm(time) { this.alarm = time }
}
class FakeSocket {
  events = {}; sent = []; closed = false; reason = ''
  accept() {}
  addEventListener(type, fn) { this.events[type] = fn }
  send(text) { if (this.closed) throw Error('closed'); this.sent.push(JSON.parse(text)) }
  close(_code, reason) { this.closed = true; this.reason = reason }
  emit(data) { this.events.message({ data }) }
}
async function fixture() {
  const clock = { now: 1_000_000 }
  const sockets = []
  const rt = { now: () => clock.now, upgrade: () => {
    const server = new FakeSocket(); sockets.push(server)
    return { server, response: new Response(null, { status: 200 }) }
  } }
  const hub = new StageCast2Hub({ storage: new MemoryStorage() }, undefined, rt)
  const ip = await digest('trusted-test-ip')
  const call = async (path, data = {}, owner = '', client = ip) => {
    const response = await hub.fetch(new Request('https://internal' + path, { method: 'POST',
      headers: { 'x-cast-client': client, 'x-cast-owner': owner }, body: JSON.stringify(data) }))
    return { status: response.status, ...await response.json() }
  }
  const receiver = s => ({ ref: s.ref, role: 'receiver', credential: s.receiverCredential })
  const controller = (s, c) => ({ ref: s.ref, role: 'controller', credential: c.controllerCredential })
  const paired = async () => {
    const s = await call('/create'), c = await call('/claim', { ref: s.ref, pin: s.pin }, 'user-1')
    assert.equal(c.status, 200)
    return { s, c }
  }
  const connect = async (scope, owner = '') => {
    const ticket = await call('/ticket', scope, owner)
    assert.equal(ticket.status, 200)
    await hub.fetch(new Request('https://internal/socket', { headers: {
      'x-cast-client': ip, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `cast2, ticket.${ticket.ticket}`,
    } }))
    return sockets.at(-1)
  }
  return { clock, hub, ip, call, receiver, controller, paired, connect, flush: () => hub.alarm() }
}
const snapshot = title => ({ songId: 'song', displayTitle: title, lines: [{ type: 'LYRIC', lyrics: 'Words' }],
  chordsVisible: false, transpose: { offset: 0, effectiveKey: 'C' }, position: { lineIndex: 0 },
  scroll: { top: 0, fraction: 0 }, mode: { columns: 1, notation: 'chords' } })
const frame = (s, sequence, title) => JSON.stringify({ version: 1, sessionId: s.ref, type: 'PRESENTATION_SNAPSHOT',
  direction: 'CONTROLLER_TO_SERVER', sequence, timestamp: 0, payload: { snapshot: snapshot(title) } })
const titles = socket => socket.sent.filter(m => m && m.type === 'PRESENTATION_SNAPSHOT').map(m => m.payload.snapshot.displayTitle)

test('AUTH_LEASE: a controller that stops authenticating cannot keep publishing over its open socket', async () => {
  const f = await fixture(), { s, c } = await f.paired()
  const tv = await f.connect(f.receiver(s)), ctl = await f.connect(f.controller(s, c), 'user-1')
  ctl.emit(frame(s, 1, 'Authorized')); await f.flush()
  assert.deepEqual(titles(tv), ['Authorized'])

  // Account denied: the gateway now rejects this controller's HTTP polling, so nothing renews the lease.
  // Pings keep the socket alive but must not extend authorization.
  for (let i = 0; i < 3; i++) { f.clock.now += 10_000; ctl.emit('ping'); await f.flush() }
  f.clock.now += 1_000
  ctl.emit(frame(s, 2, 'After revocation')); await f.flush()
  assert.equal(ctl.closed, true)
  assert.equal(ctl.reason, 'AUTH_EXPIRED')
  assert.deepEqual(titles(tv), ['Authorized'], 'TV must not receive frames after authorization lapses')
  assert.equal(tv.closed, false, 'receiver stays connected for a re-authorized controller')

  // A new controller socket needs fresh authenticated HTTP first.
  assert.equal((await f.call('/status', f.controller(s, c), 'user-1')).status, 200)
  const ctl2 = await f.connect(f.controller(s, c), 'user-1')
  ctl2.emit(frame(s, 3, 'Re-authorized')); await f.flush()
  assert.equal(titles(tv).at(-1), 'Re-authorized')
  assert.equal(titles(tv).includes('After revocation'), false)
})

test('AUTH_LEASE: alarm sweep closes an idle controller socket once its lease lapses', async () => {
  const f = await fixture(), { s, c } = await f.paired()
  const ctl = await f.connect(f.controller(s, c), 'user-1')
  f.clock.now += POLICY.authLeaseMs - 1; await f.flush()
  assert.equal(ctl.closed, false)
  f.clock.now += 1; await f.flush()
  assert.equal(ctl.closed, true)
  assert.equal(ctl.reason, 'AUTH_EXPIRED')
})

test('AUTH_LEASE: authenticated polling keeps a legitimate controller connected beyond one lease', async () => {
  const f = await fixture(), { s, c } = await f.paired()
  const tv = await f.connect(f.receiver(s)), ctl = await f.connect(f.controller(s, c), 'user-1')
  for (let i = 0; i < 6; i++) {
    f.clock.now += 5_000
    assert.equal((await f.call('/status', f.controller(s, c), 'user-1')).status, 200)
    ctl.emit('ping'); await f.flush()
  }
  ctl.emit(frame(s, 1, 'Still live')); await f.flush()
  assert.equal(ctl.closed, false)
  assert.deepEqual(titles(tv), ['Still live'])
})

test('AUTH_LEASE: a controller ticket without a live lease (e.g. legacy persisted session) is refused', async () => {
  const f = await fixture(), { s, c } = await f.paired()
  const ticket = await f.call('/ticket', f.controller(s, c), 'user-1')
  // Sessions persisted before the lease existed carry no authorizedUntil and must fail closed.
  for (const session of f.hub.db.sessions) delete session.authorizedUntil
  const response = await f.hub.fetch(new Request('https://internal/socket', { headers: {
    'x-cast-client': f.ip, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `cast2, ticket.${ticket.ticket}`,
  } }))
  assert.equal(response.status, 401)
})

test('ADMISSION: one client\'s rejected flood does not consume shared admission', async () => {
  const f = await fixture()
  const attacker = await digest('attacker-ip')
  for (let i = 0; i < POLICY.requests; i++) await f.call('/status', {}, '', attacker)
  assert.equal((await f.call('/create', {}, '', await digest('other-ip'))).status, 200)
})

test('ADMISSION: an anonymous global flood does not starve authenticated controllers', async () => {
  const f = await fixture(), { s, c } = await f.paired()
  for (let i = 0; i < POLICY.requests; i++) await f.call('/status', {}, '', await digest('anon-' + i))
  assert.equal((await f.call('/create', {}, '', await digest('late-tv'))).status, 429, 'anonymous pool is bounded')
  assert.equal((await f.call('/status', f.controller(s, c), 'user-1', await digest('phone'))).status, 200)
})

test('ADMISSION: a full bucket table does not lock out authenticated traffic', async () => {
  const f = await fixture(), { s, c } = await f.paired()
  for (let i = 0; i < POLICY.buckets; i++) await f.call('/status', {}, '', await digest('bucket-' + i))
  assert.equal((await f.call('/status', {}, '', await digest('one-more'))).status, 429)
  assert.equal((await f.call('/status', f.controller(s, c), 'user-1', await digest('phone'))).status, 200)
})

test('CAPACITY: expired unclaimed pairings stop holding live slots after the pairing window', async () => {
  const f = await fixture()
  for (let i = 0; i < POLICY.sessions; i++) {
    assert.equal((await f.call('/create', {}, '', await digest('tv-' + Math.floor(i / 5)))).status, 200)
  }
  assert.equal((await f.call('/create', {}, '', await digest('fresh-tv'))).status, 503)
  f.clock.now += POLICY.pairingMs; await f.flush()
  f.clock.now += 60_000 // next rate window
  assert.equal((await f.call('/create', {}, '', await digest('fresh-tv'))).status, 200)
})
