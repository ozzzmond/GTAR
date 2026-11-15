const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { BandSyncClient } = require('../src/utils/bandSyncClient.ts')
const { onRequest } = require('../functions/bandsync-api/[[path]].ts')
const hash = 'a'.repeat(64), ticket = 'b'.repeat(64), credential = 'c'.repeat(64)
const state = () => ({ songId: 'song', contentHash: hash, displayTitle: 'Leader song', transposeOffset: 2, effectiveKey: 'D', chordsVisible: true,
  setlist: { id: null, index: 0, count: 0 }, lineIndex: 0, scrollFraction: 0, autoscroll: { on: false, speed: 0 }, notation: 'chords' })
const content = () => ({ contentHash: hash, snapshot: { songId: 'song', displayTitle: 'Leader song',
  lines: [{ type: 'CHORD_PRO', raw: '[D]Words', segments: [{ chord: 'D', text: 'Words' }] }], chordsVisible: true,
  transpose: { offset: 2, effectiveKey: 'D' }, position: { lineIndex: 0 }, scroll: { top: 0, fraction: 0 }, mode: { columns: 1, notation: 'chords' } } })
const message = (type, payload, sequence = 1, extra = {}) => JSON.stringify({ version: 1, roomCode: 'ABCDEFGH', direction: 'SERVER_TO_CLIENT', type, payload, sequence, timestamp: 0, ...extra })
class Socket {
  readyState = 0; sent = []; closed = false
  constructor(url, protocols) { this.url = url; this.protocols = protocols }
  open() { this.readyState = 1; this.onopen?.() }
  send(s) { this.sent.push(s === 'ping' ? s : JSON.parse(s)) }
  close() { this.closed = true; this.readyState = 3 }
  receive(s) { this.onmessage?.({ data: s }) }
  drop() { this.readyState = 3; this.onclose?.() }
}
function fixture(responder) {
  const calls = [], sockets = [], timers = new Map(), seen = [], clock = { now: 100000 }, next = { n: 0 }
  const rt = { origin: 'https://gtar.test', now: () => clock.now, later: (fn, ms) => { const id = ++next.n; timers.set(id, { fn, ms }); return id }, cancel: id => timers.delete(id),
    socket: (url, protocols) => { const s = new Socket(url, protocols); sockets.push(s); return s },
    fetch: async (url, init) => {
      calls.push({ url, ...init, json: JSON.parse(init.body) })
      if (responder) { const r = await responder(url, init, calls.length); if (r) return r }
      return Response.json(url.endsWith('/create') ? { roomCode: 'ABCDEFGH', leaderCredential: credential, expiresAt: clock.now + 21600000 } :
        url.endsWith('/end') ? { ended: true } : { ticket, roomCode: 'ABCDEFGH', expiresAt: clock.now + 15000 })
    } }
  const client = new BandSyncClient(view => seen.push(view), rt)
  const tick = async ms => {
    const match = [...timers].find(([, t]) => t.ms === ms); assert.ok(match, `timer ${ms}`)
    timers.delete(match[0]); match[1].fn(); await new Promise(resolve => setImmediate(resolve))
  }
  return { client, calls, sockets, timers, seen, clock, tick }
}
test('construction dormant; leader create/ticket/STATE/CONTENT/end; memory-only secrets and cleanup', async () => {
  const f = fixture(), logs = [], prior = console.log
  console.log = (...values) => logs.push(values.join(' '))
  try {
    assert.equal(f.calls.length, 0); assert.equal(f.sockets.length, 0); assert.equal(f.timers.size, 0)
    f.client.publish(state(), content()); await f.client.create()
    assert.deepEqual(f.calls.map(c => [c.url, c.json]), [['/bandsync-api/create', {}], ['/bandsync-api/ticket', { roomCode: 'ABCDEFGH', leaderCredential: credential }]])
    const s = f.sockets[0]; assert.equal(s.url, 'wss://gtar.test/bandsync-api/socket'); assert.deepEqual(s.protocols, ['bandsync', `ticket.${ticket}`])
    s.open(); assert.deepEqual(s.sent.map(m => m.type), ['HELLO', 'STATE', 'CONTENT'])
    f.client.publish(state(), content()); assert.equal(s.sent.filter(m => m.type === 'CONTENT').length, 1)
    s.receive(message('NEED_CONTENT', { contentHash: hash })); assert.equal(s.sent.filter(m => m.type === 'CONTENT').length, 2)
    await f.tick(45000); assert.equal(s.sent.at(-1), 'ping')
    assert.equal(f.calls.every(c => c.credentials === 'omit' && !c.url.includes(credential)), true)
    assert.ok(!JSON.stringify(f.client.getSnapshot()).includes(credential)); assert.equal(logs.length, 0)
    await f.client.end(); assert.equal(f.calls.at(-1).url, '/bandsync-api/end'); assert.equal(s.closed, true); assert.equal(f.timers.size, 0)
    f.client.dispose(); assert.equal(f.client.getSnapshot().roomCode, '')
  } finally { console.log = prior; f.client.dispose() }
})
test('follower join, gap requests HELLO full snapshot, content demand and terminal end', async () => {
  const f = fixture(); await f.client.join('abcdefgh'); const s = f.sockets[0]; s.open()
  assert.deepEqual(f.calls[0].json, { roomCode: 'ABCDEFGH' })
  s.receive(message('STATE', { state: state() }, 2)); assert.equal(s.sent.at(-1).type, 'HELLO')
  s.receive(message('SNAPSHOT', { state: state(), content: null, leaderOnline: false }, 3))
  assert.equal(s.sent.at(-1).type, 'NEED_CONTENT'); assert.equal(f.client.getSnapshot().follower.leaderOnline, false)
  s.receive(message('CONTENT', content(), 4)); assert.equal(f.client.getSnapshot().follower.content.snapshot.lines[0].segments[0].chord, 'D')
  s.receive(message('STATE', { state: state() }, 6)); assert.equal(f.client.getSnapshot().follower.awaitingSnapshot, true)
  s.receive(message('SNAPSHOT', { state: state(), content: content(), leaderOnline: true }, 6))
  assert.equal(f.client.getSnapshot().follower.awaitingSnapshot, false)
  const before = f.client.getSnapshot()
  s.receive(message('STATE', { state: state() }, 7, { roomCode: 'JKLMNPQR' })); s.receive('{'); assert.equal(f.client.getSnapshot(), before)
  s.receive(message('SESSION_ENDED', { reason: 'EXPIRED' }, 7))
  assert.equal(f.client.getSnapshot().ended, true); assert.equal(f.client.getSnapshot().follower.content, null)
  assert.equal(f.client.getSnapshot().follower.state, null); assert.equal(f.timers.size, 0); assert.equal(s.closed, true)
  s.drop(); assert.equal(f.timers.size, 0)
  f.client.dispose()
})
test('expired ticket retried once; reconnect gets fresh ticket and snapshot; backoff capped at 30s', async () => {
  let attempts = 0
  const f = fixture(url => url.endsWith('/join') && ++attempts === 1 ? Response.json({ ticket, roomCode: 'ABCDEFGH', expiresAt: 100000 }) : null)
  await f.client.join('ABCDEFGH'); assert.equal(f.calls.length, 2)
  const s = f.sockets[0]; s.open(); s.receive(message('SNAPSHOT', { state: state(), content: content(), leaderOnline: true }))
  s.drop(); assert.equal(f.client.getSnapshot().follower.awaitingSnapshot, true); await f.tick(1000)
  assert.equal(f.calls.length, 3); const next = f.sockets.at(-1); next.open()
  next.receive(message('SNAPSHOT', { state: state(), content: content(), leaderOnline: true }))
  assert.equal(f.client.getSnapshot().follower.awaitingSnapshot, false); f.client.dispose()
  const g = fixture(() => { throw Error('network') }); await g.client.join('ABCDEFGH')
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) await g.tick(delay)
  g.client.dispose(); assert.equal(g.timers.size, 0)
})
test('disable cancels pending fetch and late success cannot construct a socket', async () => {
  let release
  const f = fixture(() => new Promise(resolve => { release = resolve }))
  const pending = f.client.create(); assert.equal(f.calls.length, 1)
  f.client.dispose(); assert.equal(f.calls[0].signal.aborted, true)
  release(Response.json({ roomCode: 'ABCDEFGH', leaderCredential: credential })); await pending
  assert.equal(f.sockets.length, 0); assert.equal(f.timers.size, 0); assert.equal(f.calls.length, 1)
})
test('Pages proxy is disabled without binding; forwards HTTP and Upgrade unchanged except route prefix', async () => {
  const absent = await onRequest({ request: new Request('https://gtar.test/bandsync-api/create'), env: {} })
  assert.equal(absent.status, 503); assert.deepEqual(await absent.json(), { error: 'DISABLED' })
  for (const upgrade of [false, true]) {
    let seen
    const request = new Request(`https://gtar.test/bandsync-api/${upgrade ? 'socket' : 'create'}`, { method: upgrade ? 'GET' : 'POST',
      headers: { Origin: 'https://gtar.test', 'CF-Connecting-IP': 'test-client', ...(upgrade ? { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `bandsync, ticket.${ticket}` } : {}) },
      ...(!upgrade ? { body: '{}' } : {}) })
    const expected = Response.json({ ok: true })
    assert.equal(await onRequest({ request, env: { BANDSYNC_WORKER: { fetch: r => { seen = r; return Promise.resolve(expected) } } } }), expected)
    assert.equal(new URL(seen.url).pathname, upgrade ? '/socket' : '/create'); assert.deepEqual([...seen.headers], [...request.headers])
    if (!upgrade) assert.equal(await seen.text(), '{}')
  }
  const config = JSON.parse(fs.readFileSync(require.resolve('../wrangler.jsonc'), 'utf8'))
  assert.deepEqual(config.env.preview.services, [{ binding: 'BANDSYNC_WORKER', service: 'gtar-band-sync-dev' }]); assert.equal(config.env.production.services, undefined)
})
