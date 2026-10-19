const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { build } = require('esbuild')
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

test('P2 UI: labelled mobile/tablet/TV controls, QR, clean projection, possession pairing, safe controller auth', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/tv/cast2' })
  const keys = ['window', 'document', 'history', 'navigator', 'fetch', 'IS_REACT_ACT_ENVIRONMENT', 'setInterval', 'clearInterval', 'WebSocket']
  const prior = Object.fromEntries(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  const timers = new Map()
  let nextTimer = 0
  const calls = [], sockets = []
  const ref = 'a'.repeat(64), requestId = 'c'.repeat(64)
  let state = 'WAITING_FOR_CONTROLLER'
  for (const [k, value] of Object.entries({ window: dom.window, document: dom.window.document, history: dom.window.history,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id },
    clearInterval: id => timers.delete(id),
    WebSocket: class { readyState = 0; send() {} close() {} constructor() { sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.() }) } },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ url, options, body })
      const data = url.endsWith('/create') ? { ref, pin: '000123', receiverCredential: 'b'.repeat(64), pairingExpiresAt: Date.now() + 120000, expiresAt: Date.now() + 600000 }
        : url.endsWith('/claim') ? { state: 'PAIRED', sessionId: ref, controllerCredential: 'd'.repeat(64), expiresAt: Date.now() + 600000 }
          : url.endsWith('/status') ? { sessionId: ref, state, requestId, inboundSequence: 0 }
            : url.endsWith('/ticket') ? { ticket: 'e'.repeat(64) } : { state: 'REVOKED' }
      return Response.json(data)
    },
  })) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value })
  const root = createRoot(document.getElementById('root'))
  try {
    const bundled = await build({ stdin: { contents: `export { StageCast2Panel } from './src/components/StageCast2Panel'; export { AuthContext } from './src/utils/authContext';`,
      resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs',
      packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env.DEV': 'true', 'import.meta.env.VITE_CAST2_LOCAL_REVIEW': '"true"' } })
    const compiled = new Module(path.join(__dirname, 'cast2-ui-memory.cjs'), module)
    compiled.filename = path.join(__dirname, 'cast2-ui-memory.cjs'); compiled.paths = module.paths
    compiled._compile(bundled.outputFiles[0].text, compiled.filename)
    const { StageCast2Panel, AuthContext } = compiled.exports
    await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(StageCast2Panel, { receiver: true }))))
    await act(async () => [...document.querySelectorAll('button')].find(b => /Create TV/.test(b.textContent)).click())
    // QR generation uses existing qrcode dependency (asynchronous zlib callback).
    for (let i = 0; i < 10 && !document.querySelector('img'); i++) await act(async () => new Promise(r => setTimeout(r, 10)))
    assert.equal(document.querySelector('img').alt, 'Scan to open the authenticated GTAR controller')
    assert.match(document.querySelector('img').src, /^data:image\/png;base64,/)
    assert.match(document.body.textContent, /000123/)
    assert.match(document.body.textContent, /Pairing expires in/)
    assert.equal(calls[0].options.headers.Authorization, undefined)
    for (const width of [390, 768, 1920]) {
      dom.window.innerWidth = width; dom.window.dispatchEvent(new dom.window.Event('resize'))
      assert.ok([...document.querySelectorAll('input')].every(input => input.closest('label')))
      assert.ok(document.querySelector('main'))
    }
    state = 'PAIRED'
    await act(async () => { for (const t of timers.values()) if (t.delay === 5000) await t.fn() })
    assert.equal(calls.some(c => c.url.endsWith('/decide')), false)
    const snapshot = { songId: 'song', displayTitle: 'Amazing Grace', lines: [{ type: 'LYRIC', lyrics: 'How sweet the sound' }],
      chordsVisible: false, transpose: { offset: 2, effectiveKey: 'D' }, position: { lineIndex: 0 },
      scroll: { top: 10, fraction: .5 }, mode: { columns: 1, notation: 'chords' } }
    await act(async () => sockets[0].onmessage({ data: JSON.stringify({ version: 1, type: 'PRESENTATION_SNAPSHOT',
      direction: 'SERVER_TO_RECEIVER', sessionId: ref, timestamp: Date.now(), sequence: 1, payload: { snapshot } }) }))
    assert.match(document.body.textContent, /Amazing Grace|How sweet the sound/)
    assert.doesNotMatch(document.body.textContent, /Transpose/)
    const viewport = document.querySelector('.cast2-lyrics')
    Object.defineProperty(viewport, 'scrollHeight', { value: 1000 })
    Object.defineProperty(viewport, 'clientHeight', { value: 400 })
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('resize')))
    assert.equal(viewport.scrollTop, 300)

    assert.doesNotMatch(document.body.textContent, /TV Browser Presentation Page|remaining|End session|Approve|Reject/)
    await act(async () => dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })))
    assert.match(document.body.textContent, /End session|Return to presentation/)
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Return to presentation').click())
    assert.doesNotMatch(document.body.textContent, /End session/)
    await act(async () => root.render(null))
    dom.window.history.replaceState(null, '', '/#cast2=' + ref)
    const session = { version: 1, sessionToken: 'gtar-session-only', token: 'OAUTH_NEVER_FORWARD', idToken: 'ID_NEVER_FORWARD',
      user: { id: 'owner', sub: 'owner', email: 'owner@example.test', access_status: 'active' }, access_status: 'active', localExpiresAt: Date.now() + 600000 }
    await act(async () => root.render(React.createElement(React.StrictMode, null,
      React.createElement(AuthContext.Provider, { value: { session } }, React.createElement(StageCast2Panel)))))
    assert.equal(dom.window.location.hash, '')
    assert.equal(document.querySelector('input[pattern="[a-f0-9]{64}"]').value, ref)
    assert.match(document.body.textContent, /Scan TV QR|Choose QR photo/);
    const pinInput = document.querySelector('input[inputmode=numeric]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(pinInput, '000123')
      // React's event implementation was imported before the DOM; invoke controlled onChange through the element props.
      const key = Object.keys(pinInput).find(k => k.startsWith('__reactProps'))
      pinInput[key].onChange({ target: { value: '000123' } })
    })
    await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
    const claim = calls.find(c => c.url.endsWith('/claim'))
    assert.equal(claim.options.headers.Authorization, 'Bearer gtar-session-only')
    assert.equal(JSON.stringify(calls).includes('OAUTH_NEVER_FORWARD'), false)
    assert.equal(JSON.stringify(calls).includes('ID_NEVER_FORWARD'), false)
    assert.equal(claim.options.credentials, 'omit')
    assert.equal(claim.options.redirect, 'error')
    assert.equal(claim.body.pin, '000123')
    assert.equal(document.querySelector('input[inputmode=numeric]'), null)
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const k of keys) { if (prior[k]) Object.defineProperty(globalThis, k, prior[k]); else delete globalThis[k] }
  }
})
