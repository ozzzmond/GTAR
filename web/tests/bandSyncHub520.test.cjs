const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { BandSyncHub, BandSyncDirectory, generateRoomCode } = require('../workers/bandSyncBackend.ts')
const worker = require('../workers/bandSyncWorker.ts').default
const { BAND_SYNC_LIMITS: L, ROOM_ALPHABET } = require('../src/utils/bandSyncProtocol.ts')
const { initialBandSyncState: initial, applyBandSyncMessage: apply } = require('../src/utils/bandSyncSync.ts')
const { digest } = require('../workers/stageCast2Backend.ts')
class Storage {
  data = new Map(); fail = false
  async get(k) { if (this.fail) throw Error('storage'); return structuredClone(this.data.get(k)) }
  async put(k, v) { if (this.fail) throw Error('storage'); this.data.set(k, structuredClone(v)) }
  async deleteAll() { if (this.fail) throw Error('storage'); this.data.clear() }
  async setAlarm(time) { this.alarm = time }
}
class Socket {
  sent = []; closed = false
  send(s) { if (this.closed) throw Error('closed'); this.sent.push(JSON.parse(s)) }
  close(code, reason) { this.closed = true; this.code = code; this.reason = reason }
  serializeAttachment(a) { this.a = structuredClone(a) }
  deserializeAttachment() { return structuredClone(this.a) }
}
const state = (overrides = {}) => ({ songId: 'song', contentHash: 'a'.repeat(64), displayTitle: 'Title', transposeOffset: 0, effectiveKey: 'C',
  chordsVisible: false, setlist: { id: null, index: 0, count: 0 }, lineIndex: 0, scrollFraction: 0,
  autoscroll: { on: false, speed: 1 }, notation: 'chords', ...overrides })
const content = () => ({ contentHash: 'a'.repeat(64), snapshot: { songId: 'song', displayTitle: 'Title',
  lines: [{ type: 'LYRIC', lyrics: 'Ephemeral chart' }], chordsVisible: false, transpose: { offset: 0, effectiveKey: 'C' },
  position: { lineIndex: 0 }, scroll: { top: 0, fraction: 0 }, mode: { columns: 1, notation: 'chords' } } })
const envelope = (type, payload, role = 'leader', sequence = 1) => ({ version: 1, roomCode: 'ABCDEFGH', direction: role === 'leader' ? 'LEADER_TO_SERVER' : 'FOLLOWER_TO_SERVER',
  type, payload, sequence, timestamp: 0 })
function fixture(existing, env = existing?.env || {}) {
  const storage = existing?.storage || new Storage(), sockets = existing?.sockets || [], clock = existing?.clock || { now: 1000000 }
  const ctx = { storage, acceptWebSocket: s => sockets.push(s), getWebSockets: () => sockets,
    setWebSocketAutoResponse: pair => { ctx.auto = pair } }
  const runtime = { now: () => clock.now, heartbeat: () => ({ request: 'ping', response: 'pong' }), upgrade: () => ({ server: new Socket(), response: new Response(null, { status: 200 }) }) }
  const hub = new BandSyncHub(ctx, env, runtime)
  const call = async (path, data = {}) => {
    const response = await hub.fetch(new Request('https://internal' + path, { method: 'POST', body: JSON.stringify(data) }))
    return { status: response.status, ...await response.json() }
  }
  const create = () => call('/create', { roomCode: 'ABCDEFGH' })
  const ticket = (s, role = 'leader') => role === 'leader' ? call('/ticket', { roomCode: s.roomCode, leaderCredential: s.leaderCredential }) : call('/join', { roomCode: s.roomCode })
  const upgrade = async ticket => {
    const response = await hub.fetch(new Request('https://internal/socket', { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `bandsync, ticket.${ticket}` } }))
    return { status: response.status, socket: response.status === 200 ? sockets.at(-1) : null }
  }
  const connect = async (s, role = 'leader') => { const t = await ticket(s, role); assert.equal(t.status, 200); const u = await upgrade(t.ticket); assert.equal(u.status, 200); return u.socket }
  const send = (socket, type, payload, seq, role = socket.a.role) => hub.webSocketMessage(socket, JSON.stringify(envelope(type, payload, role, seq)))
  return { hub, ctx, storage, sockets, clock, call, create, ticket, upgrade, connect, send, env }
}
test('room code: 32 nonambiguous symbols, cryptographic generation; stored leader secret hash only', async () => {
  assert.equal(ROOM_ALPHABET.length, 32); assert.equal(new Set(ROOM_ALPHABET).size, 32)
  const original = crypto.getRandomValues.bind(crypto)
  crypto.getRandomValues = a => { a.fill(255); return a }
  try { assert.equal(generateRoomCode(), 'ZZZZZZZZ') } finally { crypto.getRandomValues = original }
  const codes = new Set(Array.from({ length: 200 }, generateRoomCode)); assert.equal(codes.size, 200)
  for (const code of codes) assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/)
  const f = fixture(), s = await f.create()
  assert.match(s.leaderCredential, /^[a-f0-9]{64}$/)
  assert.equal(f.storage.data.get('room').leaderHash, await digest(s.leaderCredential))
  const t = await f.ticket(s)
  const stored = JSON.stringify([...f.storage.data]); assert.ok(!stored.includes(s.leaderCredential)); assert.ok(!stored.includes(t.ticket))
  assert.deepEqual(f.ctx.auto, { request: 'ping', response: 'pong' }); assert.equal(L.heartbeatMs, 45000)
})
test('read-only followers, single leader replacement and all follower slots', async () => {
  const f = fixture(), s = await f.create(), leader = await f.connect(s), followers = []
  for (let i = 0; i < 12; i++) followers.push(await f.connect(s, 'follower'))
  assert.equal((await f.ticket(s, 'follower')).status, 409)
  const next = await f.connect(s); assert.equal(leader.closed, true); assert.equal(leader.reason, 'REPLACED'); assert.equal(next.closed, false)
  await f.send(leader, 'STATE', { state: state() }, 1); assert.equal(f.storage.data.get('room').state, null)
  await f.send(next, 'STATE', { state: state() }, 1)
  for (const [i, type] of ['STATE', 'CONTENT'].entries()) {
    const follower = followers[i], before = followers[2].sent.length
    await f.send(follower, type, type === 'STATE' ? { state: state() } : content(), 1)
    assert.equal(follower.closed, true); assert.equal(follower.code, 1008); assert.equal(followers[2].sent.length, before)
  }
})
test('socket tickets: one use, exact 15s expiry, malformed protocols, role reservations bounded', async () => {
  const f = fixture(), s = await f.create(), t = await f.ticket(s)
  assert.equal((await f.upgrade(t.ticket)).status, 200); assert.equal((await f.upgrade(t.ticket)).status, 403)
  const t2 = await f.ticket(s); f.clock.now += L.ticketMs
  assert.equal((await f.upgrade(t2.ticket)).status, 403)
  const restarted = fixture(f); assert.equal((await restarted.upgrade(t.ticket)).status, 403)
  const bad = await f.hub.fetch(new Request('https://internal/socket', { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'bandsync, ticket.bad' } }))
  assert.equal(bad.status, 403)
  const g = fixture(), gs = await g.create()
  for (let i = 0; i < L.tickets; i++) assert.equal((await g.ticket(gs)).status, 200)
  assert.equal((await g.ticket(gs)).status, 429)
})
test('pending join tickets cannot bypass follower cap at socket upgrade', async () => {
  const f = fixture(), s = await f.create(), tickets = []
  for (let i = 0; i < 13; i++) tickets.push((await f.ticket(s, 'follower')).ticket)
  for (const ticket of tickets.slice(0, 12)) assert.equal((await f.upgrade(ticket)).status, 200)
  assert.equal((await f.upgrade(tickets[12])).status, 409)
})
test('failed credentials, joins and tickets never mutate room state, chart or live sockets', async () => {
  const f = fixture(), s = await f.create(), leader = await f.connect(s), follower = await f.connect(s, 'follower')
  await f.send(leader, 'STATE', { state: state() }, 1); await f.send(leader, 'CONTENT', content(), 2)
  const before = structuredClone(f.storage.data.get('room')), frames = follower.sent.length, alarm = f.storage.alarm
  for (let i = 0; i < 50; i++) {
    assert.equal((await f.call(i % 2 ? '/end' : '/ticket', { roomCode: s.roomCode, leaderCredential: 'f'.repeat(64) })).status, 403)
    assert.equal((await f.call('/join', { roomCode: s.roomCode, extra: true })).status, 403)
    assert.equal((await f.upgrade('f'.repeat(64))).status, 403)
  }
  assert.deepEqual(f.storage.data.get('room'), before); assert.equal(f.storage.alarm, alarm)
  assert.equal(leader.closed, false); assert.equal(follower.closed, false); assert.equal(follower.sent.length, frames)
  assert.deepEqual(f.storage.data.get('room').content, content())
  assert.equal((await fixture(f).ticket(s)).status, 200)
})
test('idle and absolute expiry alarms erase chart; activity cannot extend absolute deadline', async () => {
  for (const absolute of [false, true]) {
    const f = fixture(), s = await f.create(), leader = await f.connect(s), follower = await f.connect(s, 'follower')
    await f.send(leader, 'STATE', { state: state() }, 1); await f.send(leader, 'CONTENT', content(), 2)
    if (absolute) {
      for (let i = 1; i < 12; i++) { f.clock.now += L.idleMs - 1; await f.send(leader, 'HELLO', { role: 'leader' }, i + 2) }
      f.clock.now = s.expiresAt
    } else f.clock.now += L.idleMs
    await f.hub.alarm()
    assert.equal(follower.sent.at(-1).payload.reason, 'EXPIRED'); assert.equal(f.storage.data.has('room'), false)
    assert.ok(!JSON.stringify([...f.storage.data]).includes('Ephemeral chart'))
    assert.equal((await f.ticket(s)).status, 403)
  }
})
test('leader absent retains state/content; hibernation and reconnect send current full snapshot', async () => {
  const f = fixture(), s = await f.create(), leader = await f.connect(s), follower = await f.connect(s, 'follower')
  await f.send(leader, 'STATE', { state: state() }, 1); await f.send(leader, 'CONTENT', content(), 2)
  await f.hub.webSocketClose(leader)
  const offline = follower.sent.at(-1); assert.equal(offline.type, 'SNAPSHOT'); assert.equal(offline.payload.leaderOnline, false)
  assert.deepEqual(offline.payload.content, content())
  const g = fixture(f), follower2 = await g.connect(s, 'follower')
  assert.equal(follower2.sent[0].payload.leaderOnline, false); assert.deepEqual(follower2.sent[0].payload.content, content())
  const leader2 = await g.connect(s)
  assert.equal(follower2.sent.at(-1).payload.leaderOnline, true); assert.deepEqual(leader2.sent[0].payload.state, state())
  await g.hub.webSocketError(leader2); assert.equal(follower2.sent.at(-1).payload.leaderOnline, false)
})
test('coalesces STATE at 4/s; last pending wins; content only on hash change or demand; stream feeds reducer', async () => {
  const f = fixture(), s = await f.create(), leader = await f.connect(s), follower = await f.connect(s, 'follower')
  await f.send(leader, 'STATE', { state: state() }, 1)
  await f.send(leader, 'CONTENT', content(), 2)
  await f.send(leader, 'CONTENT', content(), 3)
  for (let i = 4; i < 14; i++) await f.send(leader, 'STATE', { state: state({ scrollFraction: i / 20 }) }, i)
  assert.equal(follower.sent.filter(m => m.type === 'STATE').length, 1)
  assert.equal(follower.sent.filter(m => m.type === 'CONTENT').length, 1)
  f.clock.now += 249; await f.hub.alarm(); assert.equal(follower.sent.filter(m => m.type === 'STATE').length, 1)
  f.clock.now++; await f.hub.alarm(); assert.equal(follower.sent.filter(m => m.type === 'STATE').length, 2)
  assert.equal(follower.sent.at(-1).payload.state.scrollFraction, 13 / 20)
  await f.send(follower, 'NEED_CONTENT', { contentHash: 'a'.repeat(64) }, 1)
  assert.equal(follower.sent.at(-1).type, 'SNAPSHOT')
  let reduced = initial(s.roomCode)
  for (const frame of follower.sent) { const next = apply(reduced, frame); assert.equal(next.error, null, JSON.stringify(frame)); reduced = next.state }
  assert.deepEqual(reduced.content, content())
  f.clock.now += 250
  await f.send(leader, 'STATE', { state: state({ contentHash: 'b'.repeat(64) }) }, 14)
  await f.send(follower, 'NEED_CONTENT', { contentHash: 'b'.repeat(64) }, 2)
  assert.equal(leader.sent.at(-1).type, 'NEED_CONTENT')
  assert.equal(f.storage.data.get('room').content, null)
})
test('per-socket rate and inbound replay persist in hibernation attachments', async () => {
  const f = fixture(), s = await f.create(), leader = await f.connect(s)
  for (let i = 1; i <= 30; i++) await f.send(leader, 'HELLO', { role: 'leader' }, i)
  assert.equal(leader.closed, false)
  const g = fixture(f); await g.send(leader, 'HELLO', { role: 'leader' }, 31); assert.equal(leader.closed, true)
  const next = await g.connect(s); await g.send(next, 'HELLO', { role: 'leader' }, 1); await g.send(next, 'HELLO', { role: 'leader' }, 1)
  assert.equal(next.closed, true)
})
test('HTTP exact shapes and bounded bodies; invalid frames close with policy code, no reflection', async () => {
  const f = fixture(), s = await f.create()
  const huge = await f.call('/join', { roomCode: s.roomCode, extra: 'x'.repeat(2048) }); assert.equal(huge.status, 413)
  assert.equal((await f.call('/unknown', { roomCode: s.roomCode })).status, 400)
  for (const mutation of [m => ({ ...m, roomCode: 'JKLMNPQR' }), m => ({ ...m, version: 2 }), () => ' '.repeat(L.bytes + 1),
    () => new ArrayBuffer(5), () => '{', m => ({ ...m, payload: { state: { ...state(), ORIGINAL_KEY: 'C' } } })]) {
    const leader = await f.connect(s), m = mutation(envelope('STATE', { state: state() }))
    await f.hub.webSocketMessage(leader, typeof m === 'object' && !(m instanceof ArrayBuffer) ? JSON.stringify(m) : m)
    assert.equal(leader.closed, true); assert.equal(leader.code, 1008)
  }
})
test('leader /end or BYE terminal; follower BYE only leaves; storage failure fails closed', async () => {
  for (const route of ['end', 'bye']) {
    const f = fixture(), s = await f.create(), leader = await f.connect(s), follower = await f.connect(s, 'follower')
    const leaver = await f.connect(s, 'follower'); await f.send(leaver, 'BYE', {}, 1); assert.equal(leaver.closed, true); assert.equal(leader.closed, false)
    if (route === 'end') assert.equal((await f.call('/end', { roomCode: s.roomCode, leaderCredential: s.leaderCredential })).status, 200)
    else await f.send(leader, 'BYE', {}, 1)
    assert.equal(follower.sent.at(-1).payload.reason, 'LEADER_ENDED')
    const reduced = apply(initial(s.roomCode), follower.sent.at(-1)); assert.equal(reduced.state.revoked, true)
    assert.equal((await f.ticket(s)).status, 403)
  }
  const f = fixture(), s = await f.create(), leader = await f.connect(s)
  f.storage.fail = true; assert.equal((await f.ticket(s)).status, 503); assert.equal(leader.closed, true)
  f.storage.fail = false; assert.equal((await f.ticket(s)).status, 503)
})
function directoryFixture() {
  const storage = new Storage(), clock = { now: 1000000 }, ctx = { storage }
  const d = new BandSyncDirectory(ctx, {}, { now: () => clock.now })
  const call = async (path, data) => {
    const r = await d.fetch(new Request('https://internal' + path, { method: 'POST', body: JSON.stringify(data) }))
    return { status: r.status, ...await r.json() }
  }
  return { storage, clock, d, call }
}
test('directory per-IP admission, global cap, ticket routing one-use/expiry and bounded cleanup', async () => {
  const f = directoryFixture(), client = await digest('test-client'), rooms = []
  for (let i = 0; i < 2; i++) rooms.push(await f.call('/create', { client }))
  assert.equal((await f.call('/create', { client })).status, 429)
  const t = { roomCode: rooms[0].roomCode, hash: 'a'.repeat(64) }
  assert.equal((await f.call('/register', t)).status, 200)
  assert.equal((await f.call('/resolve', { hash: t.hash })).roomCode, t.roomCode)
  assert.equal((await f.call('/resolve', { hash: t.hash })).status, 403)
  await f.call('/register', t); f.clock.now += L.ticketMs
  assert.equal((await f.call('/resolve', { hash: t.hash })).status, 403)
  for (let i = rooms.length; i < L.rooms; i++) assert.equal((await f.call('/create', { client: await digest('client-' + i) })).status, 200)
  assert.equal((await f.call('/create', { client: await digest('new-client') })).status, 429)
  f.clock.now += L.lifetimeMs; await f.d.alarm(); assert.equal(f.storage.data.size, 0)
  assert.equal((await f.call('/create', { client })).status, 200)
})
test('gateway disabled/origin/cookie/query guards; sanitized room routing and socket directory integration', async () => {
  const seen = [], names = [], directory = directoryFixture()
  const env = { BANDSYNC_MODE: 'reviewed-v1', BANDSYNC_ORIGIN: 'https://gtar.test',
    BANDSYNC_DIRECTORY: { idFromName: n => { names.push(n); return n }, get: () => directory.d },
    BANDSYNC_HUB: { idFromName: n => { names.push(n); return n }, get: () => ({ fetch: async r => {
      seen.push(r); return Response.json(new URL(r.url).pathname === '/ticket' ? { ticket: 'c'.repeat(64) } : { ok: true })
    } }) } }
  const req = (path = '/create', payload = {}, headers = {}, method = 'POST') => new Request('https://worker.test' + path, {
    method, headers: { Origin: 'https://gtar.test', 'CF-Connecting-IP': 'test-ip', Authorization: 'Bearer forged-test', 'x-band-owner': 'forged', ...headers },
    ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
  })
  assert.equal((await worker.fetch(req(), {})).status, 503)
  for (const r of [req('/create?x=1'), req('/create', {}, { Origin: 'https://evil.test' }), req('/create', {}, { Cookie: 'test' }), req('/create', {}, { Origin: 'http://gtar.test' })]) {
    assert.equal((await worker.fetch(r, env)).status, 403)
  }
  assert.equal((await worker.fetch(req(), { ...env, BANDSYNC_ORIGIN: 'http://gtar.test' })).status, 403)
  assert.equal((await worker.fetch(req('/create', { extra: true }), env)).status, 400)
  assert.equal((await worker.fetch(req('/join', { roomCode: 'ABCDEFGH', extra: 'x'.repeat(2048) }), env)).status, 413)
  assert.equal((await worker.fetch(req(), env)).status, 200)
  assert.deepEqual([...seen[0].headers.keys()], ['content-type'])
  const roomCode = names.at(-1); assert.match(roomCode, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/); assert.ok(names.includes('directory'))
  assert.equal((await worker.fetch(req('/ticket', { roomCode, leaderCredential: 'b'.repeat(64) }), env)).status, 200)
  const socket = req('/socket', null, { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `bandsync, ticket.${'c'.repeat(64)}` }, 'GET')
  assert.equal((await worker.fetch(socket, env)).status, 200)
  assert.deepEqual([...seen.at(-1).headers.keys()], ['sec-websocket-protocol', 'upgrade'])
  assert.equal((await worker.fetch(socket, env)).status, 403)
})
test('dormant worker has no authenticate/D1 imports or deployment integration; SQLite classes only', () => {
  const sources = ['../workers/bandSyncBackend.ts', '../workers/bandSyncWorker.ts'].map(p => fs.readFileSync(require.resolve(p), 'utf8')).join('\n')
  assert.doesNotMatch(sources, /authenticate|authCore|D1Database|\bDB\b|functions\//)
  const config = JSON.parse(fs.readFileSync(require.resolve('../wrangler.band-sync-dev.jsonc'), 'utf8'))
  assert.equal(config.name, 'gtar-band-sync-dev'); assert.equal(config.vars.BANDSYNC_MODE, 'disabled')
  assert.equal(config.d1_databases, undefined)
  assert.deepEqual(config.migrations, [{ tag: 'v1', new_sqlite_classes: ['BandSyncHub', 'BandSyncDirectory'] }])
})
test('gateway + directory + room: anonymous create/join/reconnect/end without UI or account', async () => {
  const directory = directoryFixture(), rooms = new Map()
  const env = { BANDSYNC_MODE: 'reviewed-v1', BANDSYNC_ORIGIN: 'https://gtar.test',
    BANDSYNC_DIRECTORY: { idFromName: n => n, get: () => directory.d },
    BANDSYNC_HUB: { idFromName: n => n, get: code => {
      if (!rooms.has(code)) rooms.set(code, fixture(undefined, env))
      return rooms.get(code).hub
    } } }
  const call = async (path, payload) => {
    const response = await worker.fetch(new Request('https://worker.test' + path, {
      method: 'POST', headers: { Origin: 'https://gtar.test', 'CF-Connecting-IP': 'test-client' }, body: JSON.stringify(payload),
    }), env)
    assert.equal(response.status, 200)
    return response.json()
  }
  const s = await call('/create', {}), scope = { roomCode: s.roomCode, leaderCredential: s.leaderCredential }
  const connect = async t => {
    const response = await worker.fetch(new Request('https://worker.test/socket', { headers: {
      Origin: 'https://gtar.test', 'CF-Connecting-IP': 'test-client', Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `bandsync, ticket.${t.ticket}`,
    } }), env)
    assert.equal(response.status, 200)
    return rooms.get(s.roomCode).sockets.at(-1)
  }
  const leader = await connect(await call('/ticket', scope)), follower = await connect(await call('/join', { roomCode: s.roomCode }))
  const f = rooms.get(s.roomCode)
  const publish = (type, payload, sequence) => f.hub.webSocketMessage(leader, JSON.stringify({ ...envelope(type, payload, 'leader', sequence), roomCode: s.roomCode }))
  await publish('STATE', { state: state() }, 1); await publish('CONTENT', content(), 2)
  assert.deepEqual(follower.sent.at(-1).payload, content())
  const reconnected = await connect(await call('/join', { roomCode: s.roomCode }))
  assert.deepEqual(reconnected.sent[0].payload.content, content())
  await call('/end', scope)
  assert.equal(follower.sent.at(-1).payload.reason, 'LEADER_ENDED'); assert.equal(reconnected.closed, true)
  assert.equal(directory.storage.data.get('directory').rooms.length, 0)
})

function gatewayFixture() {
  const directory = directoryFixture(), rooms = new Map(), calls = { hub: 0, release: 0 }
  const env = { BANDSYNC_MODE: 'reviewed-v1', BANDSYNC_ORIGIN: 'https://gtar.test',
    BANDSYNC_DIRECTORY: { idFromName: n => n, get: () => ({ fetch: r => {
      if (new URL(r.url).pathname === '/release') calls.release++
      return directory.d.fetch(r)
    } }) },
    BANDSYNC_HUB: { idFromName: n => n, get: code => {
      if (!rooms.has(code)) rooms.set(code, fixture(undefined, env))
      return { fetch: r => { calls.hub++; return rooms.get(code).hub.fetch(r) } }
    } } }
  const post = (path, payload = {}, ip = 'leader-client') => worker.fetch(new Request('https://worker.test' + path, {
    method: 'POST', headers: { Origin: 'https://gtar.test', 'CF-Connecting-IP': ip }, body: JSON.stringify(payload),
  }), env)
  const connect = async (ticket, ip = 'leader-client') => {
    const response = await worker.fetch(new Request('https://worker.test/socket', { headers: {
      Origin: 'https://gtar.test', 'CF-Connecting-IP': ip, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `bandsync, ticket.${ticket.ticket}`,
    } }), env)
    assert.equal(response.status, 200); return rooms.get(ticket.roomCode).sockets.at(-1)
  }
  return { directory, rooms, calls, env, post, connect }
}
test('50 wrong credentials only throttle the attacking client; room/chart/leader survive', async () => {
  const g = gatewayFixture(), s = await (await g.post('/create')).json(), scope = { roomCode: s.roomCode, leaderCredential: s.leaderCredential }
  const leader = await g.connect(await (await g.post('/ticket', scope)).json())
  const follower = await g.connect(await (await g.post('/join', { roomCode: s.roomCode })).json())
  const f = g.rooms.get(s.roomCode)
  for (const [i, type] of ['STATE', 'CONTENT'].entries()) await f.hub.webSocketMessage(leader, JSON.stringify({
    ...envelope(type, type === 'STATE' ? { state: state() } : content(), 'leader', i + 1), roomCode: s.roomCode,
  }))
  const before = structuredClone(f.storage.data.get('room')), hubBefore = g.calls.hub, frames = follower.sent.length
  for (let i = 0; i < 50; i++) {
    const response = await g.post(i % 2 ? '/end' : '/ticket', { ...scope, leaderCredential: 'f'.repeat(64) }, 'attacker-client')
    assert.equal(response.status, i < 20 ? 403 : 429)
  }
  assert.equal(g.calls.hub - hubBefore, 20)
  assert.deepEqual(f.storage.data.get('room'), before); assert.equal(follower.sent.length, frames)
  assert.equal(leader.closed, false); assert.equal(follower.closed, false)
  assert.equal((await g.post('/join', { roomCode: s.roomCode }, 'another-client')).status, 200)
  assert.equal((await g.post('/ticket', scope)).status, 200)
  // Failure budget expires independently of room lifetime.
  assert.equal((await g.directory.call('/attempt', { client: await digest('attacker-client') })).status, 429)
  g.directory.clock.now += 60000
  assert.equal((await g.post('/ticket', scope, 'attacker-client')).status, 200)
  assert.equal((await g.post('/end', scope)).status, 200)
})
test('directory failure reservations bound concurrent guesses, refund successes once, and isolate clients', async () => {
  const f = directoryFixture(), client = await digest('attacker'), other = await digest('other')
  const reservations = await Promise.all(Array.from({ length: 50 }, () => f.call('/attempt', { client })))
  assert.equal(reservations.filter(r => r.status === 200).length, 20)
  assert.equal(reservations.filter(r => r.status === 429).length, 30)
  assert.equal((await f.call('/attempt', { client: other })).status, 200)
  const result = { client, attemptId: reservations[0].attemptId, failed: false }
  await f.call('/result', result); await f.call('/result', result)
  assert.equal((await f.call('/attempt', { client })).status, 200)
  assert.equal((await f.call('/attempt', { client })).status, 429)
  const restarted = new BandSyncDirectory({ storage: f.storage }, {}, { now: () => f.clock.now })
  const denied = await restarted.fetch(new Request('https://internal/attempt', { method: 'POST', body: JSON.stringify({ client }) }))
  assert.equal(denied.status, 429)
})
test('live room cap is two per client, cannot fill global capacity; release is idempotent and frees routes', async () => {
  const f = directoryFixture(), client = await digest('creator'), rooms = []
  for (let i = 0; i < 2; i++) rooms.push(await f.call('/create', { client }))
  for (let i = 0; i < 50; i++) assert.equal((await f.call('/create', { client })).status, 429)
  f.clock.now += 60000
  assert.equal((await f.call('/create', { client })).status, 429)
  for (let i = 2; i < 32; i++) assert.equal((await f.call('/create', { client: await digest('other-' + i) })).status, 200)
  assert.equal((await f.call('/create', { client: await digest('overflow') })).status, 429)
  const hash = 'a'.repeat(64)
  await f.call('/register', { roomCode: rooms[0].roomCode, hash })
  for (let i = 0; i < 2; i++) assert.equal((await f.call('/release', { roomCode: rooms[0].roomCode })).status, 200)
  assert.equal((await f.call('/resolve', { hash })).status, 403)
  assert.equal((await f.call('/create', { client })).status, 200)
  assert.equal((await f.call('/create', { client: await digest('overflow') })).status, 429)
})
test('five creates per minute still enforced after rooms end and release', async () => {
  const f = directoryFixture(), client = await digest('creator')
  for (let i = 0; i < 5; i++) {
    const room = await f.call('/create', { client }); assert.equal(room.status, 200)
    await f.call('/release', { roomCode: room.roomCode })
  }
  assert.equal((await f.call('/create', { client })).status, 429)
  f.clock.now += 60000; assert.equal((await f.call('/create', { client })).status, 200)
})
test('end and expiry release directory slot through hub without worker; /end also releases through worker', async () => {
  for (const reason of ['http', 'bye', 'idle', 'absolute']) {
    const g = gatewayFixture(), s = await (await g.post('/create')).json(), f = g.rooms.get(s.roomCode)
    assert.equal(g.directory.storage.data.get('directory').rooms.length, 1)
    if (reason === 'http') {
      assert.equal((await g.post('/end', { roomCode: s.roomCode, leaderCredential: s.leaderCredential })).status, 200)
      assert.equal(g.calls.release, 2)
    } else if (reason === 'bye') {
      const leader = await g.connect(await (await g.post('/ticket', { roomCode: s.roomCode, leaderCredential: s.leaderCredential })).json())
      await f.hub.webSocketMessage(leader, JSON.stringify({ ...envelope('BYE', {}), roomCode: s.roomCode }))
    } else {
      f.clock.now += reason === 'idle' ? L.idleMs : L.lifetimeMs
      await f.hub.alarm()
    }
    assert.ok(g.calls.release >= 1)
    assert.equal(g.directory.storage.data.get('directory').rooms.length, 0)
    assert.equal((await g.post('/create')).status, 200)
  }
})

test('production Worker configs are isolated, fail closed and carry the SQLite DO migration', () => {
  const read = f => JSON.parse(fs.readFileSync(require.resolve('../' + f), 'utf8'))
  const dev = read('wrangler.band-sync-dev.jsonc'), gtar = read('wrangler.band-sync-prod.jsonc'), gtar1 = read('wrangler.band-sync-gtar1-prod.jsonc')
  assert.deepEqual([gtar.name, gtar1.name], ['gtar-band-sync-prod', 'gtar1-band-sync-prod'])
  assert.equal(new Set([dev.name, gtar.name, gtar1.name]).size, 3)
  for (const c of [gtar, gtar1]) {
    assert.equal(c.vars.BANDSYNC_MODE, 'disabled'); assert.equal(c.vars.BANDSYNC_ORIGIN, undefined)
    assert.equal(c.main, 'workers/bandSyncWorker.ts'); assert.deepEqual(c.durable_objects, dev.durable_objects)
    assert.deepEqual(c.migrations, dev.migrations); assert.equal(c.durable_objects.bindings.some(b => b.script_name), false)
    assert.equal(c.d1_databases, undefined); assert.equal(c.services, undefined)
  }
})
