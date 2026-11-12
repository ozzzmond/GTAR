const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const path = require('node:path')
const Module = require('node:module')

function load(source, define = {}) {
  const result = buildSync({ stdin: { contents: source, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    jsx: 'automatic', define: { 'import.meta.env.DEV': 'true', 'import.meta.env.VITE_CAST2_LOCAL_REVIEW': '"true"', ...define } })
  const mod = new Module(__filename, module)
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, __filename)
  return mod.exports
}
const { chromecastAppId, supportsChromecastSender } = load(`export * from './src/utils/chromecastConfig'`)

test('Chromecast: public configuration fails closed without a GTAR App ID and DEV Cast2', () => {
  for (const value of [undefined, '', 'EF1A139F', 'ef1a139f', 'CC1AD845', '00000000', 'not-an-id']) {
    assert.equal(chromecastAppId(value, true), '')
  }
  assert.equal(chromecastAppId('ABCD1234', false), '')
  assert.equal(chromecastAppId('abcd1234', true), 'ABCD1234')
})

const { parseChromecastHandoff, attachChromecastReceiver, CHROMECAST_NAMESPACE, Cast2Client, middleware } = load(`
  export * from './src/utils/chromecastHandoff';
  export { Cast2Client } from './src/utils/stageCast2Client';
  export { onRequest as middleware } from './functions/_middleware';
`)
const ref = 'a'.repeat(64), nonce = 'b'.repeat(64)

test('Chromecast: pairing handoff rejects expiry, wrong nonce, snapshots, credentials and arbitrary URLs', () => {
  const valid = { version: 1, type: 'PAIR', ref, nonce, pin: '000123', expiresAt: 100001 }
  assert.deepEqual(parseChromecastHandoff(JSON.stringify(valid), nonce, 100000), valid)
  for (const patch of [{ expiresAt: 100000 }, { expiresAt: 220001 }, { expiresAt: Infinity },
    { nonce: 'c'.repeat(64) }, { pin: 123 }, { ref: '../api' }, { version: 2 }, { type: 'PRESENTATION_SNAPSHOT' },
    { credential: 'secret' }, { snapshot: {} }, { url: 'https://evil.example' }]) {
    assert.equal(parseChromecastHandoff({ ...valid, ...patch }, nonce, 100000), null)
  }
  assert.equal(parseChromecastHandoff('x'.repeat(513), nonce, 100000), null)
  assert.equal(parseChromecastHandoff('{', nonce, 100000), null)
})

test('Chromecast: receiver creates Cast2 pairing once and targets only the bound sender without forwarding credentials', async () => {
  const sent = [], calls = []
  const client = new Cast2Client('receiver', { now: Date.now,
    post: async (path, data, controller) => {
      calls.push({ path, data, controller })
      return { ref, pin: '000123', receiverCredential: 'c'.repeat(64), expiresAt: Date.now() + 600000, pairingExpiresAt: Date.now() + 120000 }
    }, socket() { throw Error('Unexpected socket') },
  }, () => {})
  let listener
  const context = { addCustomMessageListener(ns, fn) { assert.equal(ns, CHROMECAST_NAMESPACE); listener = fn },
    removeCustomMessageListener(ns, fn) { assert.equal(fn, listener); listener = null },
    sendCustomMessage(ns, sender, data) { sent.push({ ns, sender, data }) },
    start(options) { assert.equal(options.disableIdleTimeout, true) },
  }
  const detach = attachChromecastReceiver(context, client)
  listener({ senderId: 'bad', data: { version: 1, type: 'HELLO', nonce, url: '/api' } })
  const hello = { senderId: 'controller', data: { version: 1, type: 'HELLO', nonce } }
  listener(hello); listener(hello)
  listener({ ...hello, senderId: 'other-controller' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { path: '/create', data: {}, controller: false })
  assert.equal(sent.length, 1)
  assert.ok(sent.every(message => message.sender === 'controller'))
  assert.deepEqual(Object.keys(sent[0].data).sort(), ['expiresAt', 'nonce', 'pin', 'ref', 'type', 'version'])
  assert.equal(JSON.stringify(sent).includes('c'.repeat(64)), false)
  detach()
  assert.equal(listener, null)
})

test('Chromecast: receiver-only headers replace broad permissions and leave normal routes untouched', async () => {
  const next = async () => new Response('receiver', { headers: { 'Permissions-Policy': 'camera=(self)', 'Content-Security-Policy': "default-src *" } })
  const response = await middleware({ request: new Request('https://dev.example/cast-receiver.html'), next })
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer')
  assert.match(response.headers.get('Permissions-Policy'), /camera=\(\)/)
  const csp = response.headers.get('Content-Security-Policy')
  assert.match(csp, /connect-src 'self'; frame-src 'none'; frame-ancestors 'none'/)
  assert.match(csp, /https:\/\/www\.gstatic\.com\/cast\/sdk\/libs\/caf_receiver\//)
  assert.doesNotMatch(csp, /unsafe-eval|accounts\.google\.com|https:\/\/www\.gstatic\.com;/)
  const normal = await middleware({ request: new Request('https://dev.example/tv'), next })
  assert.equal(normal.headers.get('Permissions-Policy'), 'camera=(self)')
})

test('Chromecast: Web Sender SDK lifecycle preserves the controller, rejects replay, revokes on disconnect and pairs freshly', async () => {
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.example/' })
  const keys = ['window', 'document', 'navigator', 'fetch', 'WebSocket']
  const prior = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const calls = [], messages = [], events = new Map()
  let current = null, receive, ended = 0
  const session = {
    addMessageListener(ns, fn) { receive = fn }, removeMessageListener() { receive = null },
    async sendMessage(ns, data) { messages.push({ ns, data }) }, endSession(stop) { assert.equal(stop, true); ended++; current = null },
    getCastDevice() { return { friendlyName: 'Realme test double' } },
  }
  const context = {
    setOptions(options) { assert.deepEqual(options, { receiverApplicationId: 'ABCD1234', autoJoinPolicy: 'page_scoped', resumeSavedSession: false }) },
    async requestSession() { current = session }, getCurrentSession: () => current,
    getCastState: () => 'NOT_CONNECTED', addEventListener(name, fn) { events.set(name, fn) }, removeEventListener() {},
  }
  Object.defineProperty(dom.window, 'isSecureContext', { value: true })
  dom.window.PresentationRequest = function () {}
  dom.window.cast = { framework: { CastContext: { getInstance: () => context } } }
  const values = { window: dom.window, document: dom.window.document,
    navigator: { userAgent: 'Android Chrome/140.0', vendor: 'Google Inc.', maxTouchPoints: 5 },
    fetch: async (url, options) => {
      const data = JSON.parse(options.body); calls.push({ url, data })
      return Response.json(url.endsWith('/claim') ? { state: 'PAIRED', sessionId: data.ref, controllerCredential: 'd'.repeat(64), expiresAt: Date.now() + 600000 }
        : url.endsWith('/status') ? { sessionId: ref, state: 'PAIRED', inboundSequence: 0, expiresAt: Date.now() + 600000 }
          : url.endsWith('/ticket') ? { ticket: 'e'.repeat(64) } : { state: 'REVOKED' })
    },
    WebSocket: class { readyState = 0; close() {}; send() {} },
  }
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  let controller, sender
  try {
    const loaded = load(`export { chromecastSender } from './src/utils/chromecastSender'; export { stageCast2Controller } from './src/utils/stageCast2Controller'; export { ChromecastOutput } from './src/components/ChromecastOutput'`, { __GTAR_CHROMECAST_APP_ID__: '"ABCD1234"' })
    sender = loaded.chromecastSender; controller = loaded.stageCast2Controller
    assert.equal(sender.supported(), true)
    const init = sender.initialize()
    assert.match(document.querySelector('script').src, /^https:\/\/www\.gstatic\.com\/cv\/js\/sender\//)
    window.__onGCastApiAvailable(true); await init
    assert.equal(sender.getView().state, 'ready')
    const React = require('react')
    const { renderToStaticMarkup } = require('react-dom/server')
    const markup = () => renderToStaticMarkup(React.createElement(loaded.ChromecastOutput))
    assert.match(markup(), /Google Chromecast|Connect Chromecast/)
    values.navigator.userAgent = 'iPhone CriOS/140.0'
    assert.equal(markup(), '', 'unsupported platforms retain only existing TV controls')
    values.navigator.userAgent = 'Android Chrome/140.0'
    await sender.connect()
    assert.equal(window.location.pathname, '/')
    assert.equal(sender.getView().state, 'connecting')
    const hello = messages.at(-1)
    assert.deepEqual(Object.keys(hello.data).sort(), ['nonce', 'type', 'version'])
    const response = JSON.stringify({ version: 1, type: 'PAIR', ref, nonce: hello.data.nonce, pin: '000123', expiresAt: Date.now() + 60000 })
    const deliver = receive
    deliver(CHROMECAST_NAMESPACE, response); deliver(CHROMECAST_NAMESPACE, response)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(calls.filter(call => call.url.endsWith('/claim')).length, 1)
    assert.equal(sender.getView().state, 'connected')
    assert.equal(sender.getView().device, 'Realme test double')
    assert.doesNotMatch(JSON.stringify(messages), /credential|snapshot|lyrics|Bearer/)
    await sender.disconnect()
    context.getCastState = () => 'NO_DEVICES_AVAILABLE'
    events.get('caststatechanged')()
    assert.doesNotMatch(markup(), /<button/, 'no inert picker when the SDK reports no devices')
    assert.match(markup(), /Browser \/ QR pairing/)
    context.getCastState = () => 'NOT_CONNECTED'
    events.get('caststatechanged')()
    assert.equal(sender.getView().state, 'ready')
    assert.equal(controller.getView().state, 'ENDED')
    assert.equal(calls.filter(call => call.url.endsWith('/revoke')).length, 1)
    assert.equal(ended, 1)
    assert.match(markup(), /Reconnect Chromecast/)
    context.requestSession = async () => { throw 'cancel' }
    await sender.connect()
    assert.equal(sender.getView().state, 'ready')
    assert.equal(sender.getView().error, '')
    context.requestSession = async () => { current = session }
    await sender.connect()
    assert.notEqual(messages.at(-1).data.nonce, hello.data.nonce)
    receive(CHROMECAST_NAMESPACE, response)
    assert.equal(calls.filter(call => call.url.endsWith('/claim')).length, 1, 'old handoff cannot authorize a new launch')
    await sender.disconnect()
    // A disconnect racing a successful HTTP claim must revoke the result, not revive the session.
    const originalFetch = globalThis.fetch
    let releaseClaim
    globalThis.fetch = async (url, options) => {
      if (url.endsWith('/claim')) await new Promise(resolve => { releaseClaim = resolve })
      return originalFetch(url, options)
    }
    await sender.connect()
    receive(CHROMECAST_NAMESPACE, JSON.stringify({ version: 1, type: 'PAIR', ref, nonce: messages.at(-1).data.nonce, pin: '000123', expiresAt: Date.now() + 60000 }))
    const stopping = sender.disconnect()
    releaseClaim()
    await stopping
    assert.equal(sender.getView().state, 'ready')
    assert.equal(controller.getView().state, 'ENDED')
    assert.equal(calls.filter(call => call.url.endsWith('/revoke')).length, 2)
    let finishPicker
    context.requestSession = () => new Promise(resolve => { finishPicker = () => {
      current = session
      events.get('sessionstatechanged')({ sessionState: 'SESSION_STARTED' })
      resolve()
    } })
    const picking = sender.connect()
    await sender.disconnect()
    finishPicker(); await picking
    assert.equal(sender.getView().state, 'ready', 'late picker result cannot restart a stopped presentation')
    const dormant = load(`export { chromecastSender } from './src/utils/chromecastSender'`, { __GTAR_CHROMECAST_APP_ID__: '""' }).chromecastSender
    const scriptsBefore = document.scripts.length
    await dormant.initialize()
    assert.equal(dormant.getView().state, 'idle')
    assert.equal(document.scripts.length, scriptsBefore, 'missing registration must not fetch Google SDK')
  } finally {
    await sender?.disconnect()
    controller?.resetForTesting()
    dom.window.close()
    for (const key of keys) { if (prior[key]) Object.defineProperty(globalThis, key, prior[key]); else delete globalThis[key] }
  }
})

test('Chromecast: Android Chrome requires secure Presentation capability, not only UA', () => {
  const supported = { secure: true, android: true, presentation: true, userAgent: 'Android Chrome/140.0', vendor: 'Google Inc.' }
  assert.equal(supportsChromecastSender(supported), true)
  for (const patch of [{ secure: false }, { android: false }, { presentation: false }, { vendor: '' },
    { userAgent: 'iPhone CriOS/140.0' }, { userAgent: 'Android Chrome/140.0 EdgA/140' },
    { userAgent: 'Android; wv) Chrome/140.0' }, { userAgent: 'Android Firefox/140.0' }]) {
    assert.equal(supportsChromecastSender({ ...supported, ...patch }), false)
  }
})
