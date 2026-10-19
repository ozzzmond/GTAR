const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { Cast2Client } = require('../src/utils/stageCast2Client.ts')
const { StageCast2Hub, digest, POLICY } = require('../workers/stageCast2Backend.ts')
const { projectCast2Presentation } = require('../src/utils/stageCast2Projection.ts')

async function fixture() {
  let now = 1000000
  const storage = { async get() {}, async put() {}, async setAlarm() {} }
  let bridge
  const hub = new StageCast2Hub({ storage }, undefined, { now: () => now, upgrade: () => {
    const events = {}
    const client = bridge
    return { response: new Response(null), server: {
      accept() {}, addEventListener(type, fn) { events[type] = fn },
      send(data) { client.onmessage?.({ data }) },
      close() { client.readyState = 3; client.onclose?.() },
    }, events }
  } })
  // Capture event handlers from the actual P1 socket, keeping client/server deliveries queued.
  const original = hub.rt.upgrade
  const pending = []
  hub.rt.upgrade = () => { const value = original(); bridge.events = value.events; return value }
  const ip = await digest('integration-ip')
  const requests = []
  const io = owner => ({ now: () => now,
    async post(path, data, controller) {
      requests.push({ path, data: structuredClone(data), controller })
      const response = await hub.fetch(new Request('https://internal' + path, { method: 'POST', headers: {
        'x-cast-client': ip, 'x-cast-owner': controller ? owner : '',
      }, body: JSON.stringify(data) }))
      const result = await response.json()
      if (!response.ok) throw Error(result.error)
      return result
    },
    socket(ticket) {
      const ws = { readyState: 0, send(data) { ws.events.message({ data }) }, close() { ws.readyState = 3; ws.events?.close({}) } }
      pending.push(async () => {
        bridge = ws
        const response = await hub.fetch(new Request('https://internal/socket', { headers: {
          'x-cast-client': ip, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `cast2, ticket.${ticket}`,
        } }))
        assert.equal(response.status, 200)
        ws.readyState = 1; ws.onopen?.()
      })
      return ws
    },
  })
  const receiver = new Cast2Client('receiver', io(''), () => {})
  const controller = new Cast2Client('controller', io('owner'), () => {})
  const flush = async () => { while (pending.length) await pending.shift()(); await hub.alarm(); await hub.alarm() }
  const pair = async () => {
    await receiver.start()
    await controller.start(receiver.view.ref, receiver.view.pin)
    await receiver.tick()
    assert.equal(receiver.view.state, 'AWAITING_TV_APPROVAL')
    await receiver.decide(true)
    await receiver.tick(); await flush()
    await controller.tick(); await flush()
  }
  return { receiver, controller, requests, pair, flush, hub, advance(ms) { now += ms } }
}
function snapshot(title = 'Song A', offset = 0, chords = true, fraction = 0) {
  const result = projectCast2Presentation({ song: { id: title, title, rawContent: '[C]Hello\n[G]World', privateNote: 'PRIVATE' },
    transposeOffset: offset, effectiveKey: offset ? 'D' : 'C', isTwoColumn: false },
  { lineIndex: 0, scrollTop: 123, scrollFraction: fraction, chordsVisible: chords })
  assert.equal(result.ok, true)
  return result.value
}
test('P2: controller cannot connect or present until explicit receiver approval', async () => {
  const f = await fixture()
  await f.receiver.start()
  assert.match(f.receiver.view.pin, /^\d{6}$/)
  await f.controller.start(f.receiver.view.ref, f.receiver.view.pin)
  f.controller.publish(snapshot())
  await f.controller.tick(); await f.flush()
  assert.equal(f.controller.view.state, 'AWAITING_TV_APPROVAL')
  assert.equal(f.receiver.view.snapshot, null)
  assert.equal(f.requests.some(r => r.path === '/ticket'), false)
  await f.receiver.tick(); await f.receiver.decide(false)
  await f.controller.tick()
  assert.equal(f.receiver.view.state, 'REVOKED')
  assert.equal(f.controller.view.state, 'ENDED')
})
test('P2: actual P1 relay delivers active projection, transpose, chords, song switch and scroll', async () => {
  const f = await fixture(); await f.pair()
  for (const s of [snapshot(), snapshot('Song B', 2, false, .65)]) {
    f.controller.publish(s); await f.flush()
    assert.deepEqual(f.receiver.view.snapshot, s)
    assert.equal(JSON.stringify(f.receiver.view.snapshot).includes('PRIVATE'), false)
  }
  assert.equal(f.receiver.view.snapshot.chordsVisible, false)
  assert.equal(f.receiver.view.snapshot.lines[0].type, 'LYRIC')
  await f.controller.end(); await f.flush()
  assert.equal(f.receiver.view.snapshot, null)
  assert.equal(f.receiver.view.state, 'REVOKED')
})
test('P2: receiver reconnect obtains full snapshot and heartbeat retains connection', async () => {
  const f = await fixture(); await f.pair()
  f.controller.publish(snapshot()); await f.flush()
  f.receiver.ws.close(); await f.flush()
  await f.receiver.tick(); await f.flush()
  assert.equal(f.receiver.view.snapshot.displayTitle, 'Song A')
  f.advance(20000); await f.controller.tick(); await f.receiver.tick(); await f.flush()
  assert.equal(f.receiver.view.state, 'CONNECTED')
  await f.receiver.end(); await f.flush(); await f.controller.tick()
  assert.equal(f.controller.view.state, 'ENDED')
})
test('P2: pairing and authorized session expire, clearing TV content and credentials', async () => {
  const f = await fixture(); await f.receiver.start(); f.advance(POLICY.pairingMs); await f.receiver.tick()
  assert.equal(f.receiver.view.state, 'EXPIRED'); assert.equal(f.receiver.view.pin, '')
  const g = await fixture(); await g.pair(); g.controller.publish(snapshot()); await g.flush()
  g.advance(POLICY.sessionMs); await g.receiver.tick()
  assert.equal(g.receiver.view.state, 'EXPIRED'); assert.equal(g.receiver.view.snapshot, null)
  assert.equal(g.receiver.credential, '')
})
test('P2: reconnect budget is finite and does not restart after exhaustion', async () => {
  const f = await fixture(); await f.pair()
  f.controller.io.post = async () => { throw Error('UNAVAILABLE') }
  for (let i = 0; i < 10; i++) await f.controller.tick()
  assert.match(f.controller.view.error, /exhausted/)
  assert.equal(f.controller.failures, 3)
  assert.equal(f.controller.credential, '')
})
test('P2: forged cross-session receiver traffic fails closed and clears projection', async () => {
  const f = await fixture(); await f.pair(); f.controller.publish(snapshot()); await f.flush()
  f.receiver.ws.onmessage({ data: JSON.stringify({ version: 1, type: 'PRESENTATION_SNAPSHOT', direction: 'SERVER_TO_RECEIVER',
    sessionId: 'other', timestamp: 0, sequence: 100, payload: { snapshot: snapshot() } }) })
  assert.equal(f.receiver.view.state, 'ERROR'); assert.equal(f.receiver.view.error, 'SESSION_MISMATCH')
  assert.equal(f.receiver.view.snapshot, null)
})
test('P2: late create response after teardown cannot revive session', async () => {
  let resolve
  const client = new Cast2Client('receiver', { now: () => 0, post: () => new Promise(r => { resolve = r }) }, () => {})
  const start = client.start(); client.dispose()
  resolve({ ref: 'a'.repeat(64), receiverCredential: 'b'.repeat(64), pin: '000001', expiresAt: 10000, pairingExpiresAt: 1000 })
  await start
  assert.equal(client.credential, ''); assert.equal(client.view.ref, '')
})
