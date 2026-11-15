const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { JSDOM } = require('jsdom')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename)
const { BandSyncClient } = require('../src/utils/bandSyncClient.ts')
const { BandSyncRemoteView } = require('../src/components/BandSyncRemoteView.tsx')
const React = require('react'), { act } = React
const { createRoot } = require('react-dom/client')
const credential = 'c'.repeat(64), ticket = 'b'.repeat(64), KEY = 'gtar_band_sync_session_v1'
function fixture(initial, respond) {
  let saved = initial ?? null, now = 1_000_000
  const requests = [], sockets = [], store = { get: () => saved, set: v => { saved = v }, remove: () => { saved = null } }
  const client = new BandSyncClient(() => {}, { store, origin: 'https://gtar.test', now: () => now, later: () => 0, cancel: () => {},
    socket: (url, protocols) => { const s = { url, protocols, readyState: 0, sent: [], close() { this.readyState = 3 }, send(v) { this.sent.push(v) } }; sockets.push(s); return s },
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) })
      const response = respond?.(url); if (response) return response
      return Response.json(url.endsWith('/create') ? { roomCode: 'ABCDEFGH', leaderCredential: credential } : { roomCode: 'ABCDEFGH', ticket, expiresAt: now + 15000 })
    } })
  return { client, requests, sockets, saved: () => (saved ? JSON.parse(saved) : null), raw: () => saved, advance: ms => { now += ms }, now: () => now }
}
const stored = (extra = {}) => JSON.stringify({ v: 1, role: 'leader', roomCode: 'ABCDEFGH', savedAt: 1_000_000, leaderCredential: credential, ...extra })

test('leader create saves this tab session; end, leave and dispose forget it', async () => {
  const f = fixture(); await f.client.create()
  assert.deepEqual(f.saved(), { v: 1, role: 'leader', roomCode: 'ABCDEFGH', savedAt: 1_000_000, leaderCredential: credential })
  await f.client.end(); assert.equal(f.raw(), null)
  const g = fixture(); await g.client.join('abcd-efgh'); assert.deepEqual(g.saved(), { v: 1, role: 'follower', roomCode: 'ABCDEFGH', savedAt: 1_000_000 })
  assert.equal(g.raw().includes(credential), false)
  g.client.dispose(); assert.equal(g.raw(), null)
})
test('resume: leader reconnects with its credential, follower rejoins by code; nothing is created', async () => {
  const l = fixture(stored()); await l.client.resume()
  assert.deepEqual(l.requests, [{ url: '/bandsync-api/ticket', body: { roomCode: 'ABCDEFGH', leaderCredential: credential } }])
  assert.equal(l.client.getSnapshot().role, 'leader'); assert.equal(l.client.getSnapshot().roomCode, 'ABCDEFGH'); assert.equal(l.sockets.length, 1)
  const f = fixture(stored({ role: 'follower', leaderCredential: undefined })); await f.client.resume()
  assert.deepEqual(f.requests, [{ url: '/bandsync-api/join', body: { roomCode: 'ABCDEFGH' } }]); assert.equal(f.client.getSnapshot().role, 'follower')
})
test('resume drops malformed, old or credential-less data without any request', async () => {
  for (const raw of ['not json', '{}', stored({ v: 2 }), stored({ roomCode: 'abc' }), stored({ leaderCredential: 'short' }), stored({ leaderCredential: undefined }),
    stored({ savedAt: 1_000_000 - 6 * 60 * 60 * 1000 - 1 }), stored({ role: 'admin' })]) {
    const f = fixture(raw); f.advance(0); await f.client.resume()
    assert.equal(f.requests.length, 0, raw); assert.equal(f.sockets.length, 0); assert.equal(f.raw(), null, raw)
  }
  const f = fixture(stored()); f.advance(6 * 60 * 60 * 1000 + 1); await f.client.resume(); assert.equal(f.requests.length, 0); assert.equal(f.raw(), null)
})
test('resume into an ended room (403/404) stops, says so and forgets; a live client is not resumed twice', async () => {
  for (const status of [403, 404]) {
    const f = fixture(stored(), () => new Response('{}', { status })); await f.client.resume()
    assert.equal(f.client.getSnapshot().status, 'error'); assert.equal(f.client.getSnapshot().message, 'Room not found or ended'); assert.equal(f.raw(), null)
  }
  const f = fixture(); await f.client.create(); const before = f.requests.length; await f.client.resume(); assert.equal(f.requests.length, before)
})
test('session store never holds anything but the room session and the credential never reaches the view', async () => {
  const f = fixture(); await f.client.create()
  assert.deepEqual(Object.keys(f.saved()).sort(), ['leaderCredential', 'role', 'roomCode', 'savedAt', 'v'])
  assert.equal(JSON.stringify(f.client.getSnapshot()).includes(credential), false)
})

test('follower full screen: overlay toggle keeps the same scroll viewport, asks the browser, Esc exits, nothing is stored', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.test', pretendToBeVisual: true })
  const keys = ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT', 'requestAnimationFrame', 'cancelAnimationFrame']
  const prior = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  dom.window.HTMLElement.prototype.scrollTo = function (v) { this.scrollTop = v.top }
  let asked = 0; dom.window.document.documentElement.requestFullscreen = () => { asked++; return Promise.resolve() }
  const root = createRoot(document.getElementById('root'))
  const view = { roomCode: 'ABCDEFGH', sequence: 1, revoked: false, awaitingSnapshot: false, leaderOnline: true, content: null,
    state: { songId: 's', contentHash: 'a'.repeat(64), displayTitle: 'Song', transposeOffset: 0, effectiveKey: 'D', chordsVisible: false,
      setlist: { id: null, index: 0, count: 0 }, lineIndex: 0, scrollFraction: 0, autoscroll: { on: false, speed: 10 }, notation: 'chords' } }
  const section = () => document.querySelector('section'), button = () => document.querySelector('button')
  try {
    await act(async () => root.render(React.createElement(BandSyncRemoteView, { view })))
    const viewport = document.querySelector('[data-testid="band-sync-viewport"]')
    assert.equal(button().textContent.trim(), 'Full screen'); assert.equal(section().className.includes('fixed'), false)
    await act(async () => button().click())
    assert.equal(section().className.includes('fixed inset-0'), true); assert.equal(button().textContent.trim(), 'Exit full screen'); assert.equal(asked, 1)
    assert.equal(document.querySelector('[data-testid="band-sync-viewport"]'), viewport)
    await act(async () => button().click()); assert.equal(section().className.includes('fixed'), false)
    await act(async () => button().click()); assert.equal(section().className.includes('fixed'), true)
    await act(async () => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })) })
    assert.equal(section().className.includes('fixed'), false)
    assert.equal(dom.window.localStorage.length, 0); assert.equal(dom.window.sessionStorage.length, 0)
    await act(async () => root.unmount())
  } finally {
    dom.window.close()
    for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  }
})
