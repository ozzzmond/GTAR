const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { JSDOM } = require('jsdom')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename)
const { BandSyncClient, BandSyncHttpError } = require('../src/utils/bandSyncClient.ts')
const { BandSyncPublicationGate } = require('../src/utils/bandSyncPublication.ts')
const { createBandSyncScroll } = require('../src/utils/bandSyncScroll.ts')
const { parseBandSyncQr, bandSyncJoinUrl, createBandSyncQr, consumeBandSyncHash } = require('../src/utils/bandSyncQr.ts')
const { BandSyncRemoteView } = require('../src/components/BandSyncRemoteView.tsx')
const React = require('react'), { act } = React
const { createRoot } = require('react-dom/client')
const state = (extra = {}) => ({ songId: 'song', contentHash: 'a'.repeat(64), displayTitle: 'Song', transposeOffset: 2, effectiveKey: 'D', chordsVisible: false,
  setlist: { id: null, index: 0, count: 0 }, lineIndex: 0, scrollFraction: 0, autoscroll: { on: false, speed: 10 }, notation: 'chords', ...extra })
const content = () => ({ contentHash: 'a'.repeat(64), snapshot: { songId: 'song', displayTitle: 'Song', lines: [{ type: 'LYRIC', lyrics: 'Words' }],
  chordsVisible: false, transpose: { offset: 2, effectiveKey: 'D' }, position: { lineIndex: 0 }, scroll: { top: 0, fraction: 0 }, mode: { columns: 1, notation: 'chords' } } })
function clock() {
  let now = 0, id = 0
  const timers = new Map()
  return { timers, now: () => now, later: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id }, cancel: id => timers.delete(id),
    advance(ms) { const end = now + ms; let item; while ((item = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, t]) => t.at <= end))) {
      timers.delete(item[0]); now = item[1].at; item[1].fn()
    } now = end },
  }
}
function clientFixture(respond) {
  const time = clock(), requests = [], sockets = []
  const client = new BandSyncClient(() => {}, { ...time, origin: 'https://gtar.test', socket: (url, protocols) => {
    const s = { url, protocols, readyState: 0, sent: [], close() { this.closed = true; this.readyState = 3 },
      send(value) { this.sent.push({ at: time.now(), value: value === 'ping' ? value : JSON.parse(value) }) },
      open() { this.readyState = 1; this.onopen?.() }, drop() { this.readyState = 3; this.onclose?.() } }
    sockets.push(s); return s
  }, fetch: async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) })
    const response = respond?.(url)
    if (response) return response
    return Response.json(url.endsWith('/create') ? { roomCode: 'ABCDEFGH', leaderCredential: 'c'.repeat(64) } :
      url.endsWith('/end') ? { ended: true } : { roomCode: 'ABCDEFGH', ticket: 'b'.repeat(64), expiresAt: -60000 })
  } })
  const advance = async ms => { time.advance(ms); await new Promise(resolve => setImmediate(resolve)) }
  return { client, time, requests, sockets, advance }
}
test('403/404 join and ticket errors stop retries without reading the body; leave/retry remains possible', async () => {
  for (const status of [403, 404]) for (const role of ['leader', 'follower']) {
    const f = clientFixture(url => url.endsWith(role === 'leader' ? '/ticket' : '/join') ? {
      ok: false, status, json() { throw Error('Response body must not be read') },
    } : null)
    if (role === 'leader') await f.client.create(); else await f.client.join('ABCDEFGH')
    assert.equal(f.client.getSnapshot().status, 'error'); assert.equal(f.client.getSnapshot().message, 'Room not found or ended')
    assert.equal(f.time.timers.size, 0); assert.equal(f.sockets.length, 0)
    const calls = f.requests.length; await f.advance(300000); assert.equal(f.requests.length, calls)
    await f.client.end(); assert.equal(f.client.getSnapshot().role, null); assert.equal(f.requests.length, calls)
    if (role === 'leader') await f.client.create(); else await f.client.join('ABCDEFGH')
    assert.equal(f.client.getSnapshot().status, 'error')
    f.client.dispose()
  }
  const error = new BandSyncHttpError(403); assert.equal(error.status, 403); assert.equal(error.message, 'Room request failed')
})
test('5xx/network backoff continues to 30 seconds; rejected socket opens fetch a fresh one-use ticket', async () => {
  const f = clientFixture(() => Response.json({ error: 'not echoed' }, { status: 503 }))
  await f.client.join('ABCDEFGH')
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) { const before = f.requests.length; await f.advance(delay); assert.equal(f.requests.length, before + 1) }
  f.client.dispose(); assert.equal(f.time.timers.size, 0)
  const g = clientFixture(); await g.client.join('ABCDEFGH')
  g.sockets[0].drop(); await g.advance(1000)
  assert.equal(g.requests.length, 2); assert.equal(g.sockets.length, 2); g.sockets[1].open()
  assert.equal(g.client.getSnapshot().status, 'active'); g.client.dispose()
})
test('source gate and outgoing STATE stay <=4/s; line changes use a free slot immediately; latest fraction wins', async () => {
  const time = clock(), gate = new BandSyncPublicationGate(time), published = []
  const emit = line => gate.publish(() => published.push({ at: time.now(), line }))
  emit(0); time.advance(20); emit(1); time.advance(100); emit(2); assert.equal(published.length, 1)
  time.advance(130); assert.deepEqual(published, [{ at: 0, line: 0 }, { at: 250, line: 2 }])
  time.advance(250); emit(3); assert.equal(published.at(-1).at, 500)
  gate.publish(() => { throw Error('must be canceled') }); gate.clear(); time.advance(1000)
  const f = clientFixture(); f.client.publish(state(), content()); await f.client.create(); f.sockets[0].open()
  for (let i = 1; i <= 100; i++) { await f.advance(10); f.client.publish(state({ lineIndex: i, scrollFraction: i / 100 }), content()) }
  await f.advance(250)
  const messages = f.sockets[0].sent.filter(m => m.value.type === 'STATE')
  for (let i = 1; i < messages.length; i++) assert.ok(messages[i].at - messages[i - 1].at >= 250)
  assert.ok(messages.filter(m => m.at < 1000).length <= 4)
  assert.equal(messages.at(-1).value.payload.state.scrollFraction, 1)
  assert.equal(f.sockets[0].sent.filter(m => m.value.type === 'CONTENT').length, 1)
  f.client.dispose(); assert.equal(f.time.timers.size, 0)
  const follower = clientFixture(); await follower.client.join('ABCDEFGH'); follower.sockets[0].open()
  follower.client.publish(state({ lineIndex: 10, scrollFraction: 0.8 }), content()); await follower.advance(1000)
  assert.equal(follower.sockets[0].sent.some(m => m.value.type === 'STATE' || m.value.type === 'CONTENT'), false)
  follower.client.dispose()
})
test('follower scroll fractions and line anchors, local speed clamp, hand scrolling, offline/stop/dispose cancellation', () => {
  const frames = new Map(), calls = []; let id = 0
  const viewport = { scrollTop: 0, scrollHeight: 1000, clientHeight: 100, anchor: null,
    querySelector() { return this.anchor }, getBoundingClientRect: () => ({ top: 0 }),
    scrollTo(value) { calls.push(value); this.scrollTop = value.top } }
  const controller = createBandSyncScroll(viewport, { frame: fn => { frames.set(++id, fn); return id }, cancel: id => frames.delete(id) })
  const frame = now => { const [key, fn] = [...frames][0]; frames.delete(key); fn(now) }
  controller.apply(state({ scrollFraction: 0.5 }), true); assert.deepEqual(calls.at(-1), { top: 450, behavior: 'smooth' })
  viewport.anchor = { getBoundingClientRect: () => ({ top: 10, bottom: 30 }) }
  viewport.scrollTop = 0; controller.apply(state({ lineIndex: 7, scrollFraction: 0.9 }), true); assert.equal(calls.at(-1).top, 10)
  viewport.anchor = null
  controller.apply(state({ scrollFraction: 0.2, autoscroll: { on: true, speed: 999 } }), true)
  frame(0); frame(100); assert.equal(viewport.scrollTop, 195) // 180 + 150 px/s * .1 s.
  viewport.scrollTop = 50; frame(200); assert.equal(viewport.scrollTop, 65)
  controller.apply(state({ scrollFraction: 0.3, autoscroll: { on: true, speed: 0 } }), true)
  frame(300); assert.equal(viewport.scrollTop, 271) // New STATE re-syncs hand scroll, speed clamped to 10.
  controller.apply(state({ autoscroll: { on: false, speed: 10 } }), true); assert.equal(frames.size, 0)
  controller.apply(state({ autoscroll: { on: true, speed: 30 } }), true); assert.equal(frames.size, 1)
  controller.apply(state({ autoscroll: { on: true, speed: 30 } }), false); assert.equal(frames.size, 0)
  controller.apply(state({ autoscroll: { on: true, speed: 30 } }), true); controller.dispose(); assert.equal(frames.size, 0)
  controller.apply(state(), true); assert.equal(frames.size, 0)
})
test('QR accept/reject table, room-code-only encoder and scrubbed history', async t => {
  const origin = 'https://gtar.test', valid = origin + '/#bandsync=ABCDEFGH'
  assert.equal(parseBandSyncQr(valid, origin), 'ABCDEFGH')
  for (const value of [valid.replace('gtar.test', 'evil.test'), valid.replace('https:', 'http:'), valid.replace('/#', '/path/#'),
    valid.replace('/#', '/?ticket=x#'), valid + '&extra=x', valid + '&bandsync=ABCDEFGH', valid.replace('https://', 'https://user:pass@'),
    origin + '/#bandsync=0I1O2345', origin + '/#bandsync=' + 'c'.repeat(64), origin + '/#bandsync=ticket.' + 'b'.repeat(64),
    origin + '/#bandsync=abcdefgh', 'ABCDEFGH']) assert.equal(parseBandSyncQr(value, origin), null, value)
  assert.equal(bandSyncJoinUrl(origin, 'ABCDEFGH'), valid)
  assert.throws(() => bandSyncJoinUrl(origin, 'c'.repeat(64)), /Invalid room code/)
  const input = [], qr = require('qrcode'), original = qr.toDataURL
  t.mock.method(qr, 'toDataURL', (value, options) => { input.push(value); return original(value, options) })
  assert.match(await createBandSyncQr(origin, 'ABCDEFGH'), /^data:image\/png;base64,/)
  assert.deepEqual(input, [valid]); assert.equal(input.join('').includes('c'.repeat(64)), false)
  for (const enabled of [false, true]) {
    const dom = new JSDOM('', { url: valid }); dom.window.history.replaceState({ keep: true }, '')
    assert.equal(consumeBandSyncHash(dom.window.location, dom.window.history, enabled), enabled ? 'ABCDEFGH' : null)
    assert.equal(dom.window.location.hash, ''); assert.deepEqual(dom.window.history.state, { keep: true }); dom.window.close()
  }
})
test('remote view shows setlist position and cancels animation on offline/unmount without storage or key writes', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.test' }), frames = new Map(); let next = 0
  const prior = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT', 'requestAnimationFrame', 'cancelAnimationFrame'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: fn => { frames.set(++next, fn); return next }, cancelAnimationFrame: id => frames.delete(id) })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  dom.window.HTMLElement.prototype.scrollTo = function (value) { this.scrollTop = value.top }
  dom.window.localStorage.setItem('saved-song', JSON.stringify({ transposeOffset: 3, ORIGINAL_KEY: 'C', CHART_KEY: 'C', PERFORMANCE_KEY: 'Eb' }))
  const before = dom.window.localStorage.getItem('saved-song')
  const root = createRoot(document.getElementById('root'))
  const view = { roomCode: 'ABCDEFGH', sequence: 1, revoked: false, awaitingSnapshot: false, leaderOnline: true,
    state: state({ setlist: { id: 'list-test', index: 1, count: 5 }, autoscroll: { on: true, speed: 20 } }), content: content() }
  try {
    await act(async () => root.render(React.createElement(BandSyncRemoteView, { view })))
    assert.match(document.body.textContent, /Song 2 of 5/); assert.equal(frames.size, 1)
    await act(async () => root.render(React.createElement(BandSyncRemoteView, { view: { ...view, leaderOnline: false } })))
    assert.equal(frames.size, 0)
    await act(async () => root.render(React.createElement(BandSyncRemoteView, { view }))); assert.equal(frames.size, 1)
    await act(async () => root.unmount()); assert.equal(frames.size, 0)
    assert.equal(dom.window.localStorage.getItem('saved-song'), before)
  } finally {
    dom.window.close()
    for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  }
})
