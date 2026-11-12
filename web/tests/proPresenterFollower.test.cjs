const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, filename)
const { ObjectFrames, SlideDedupe, buildUrl, paths, activate, retryDelay } = require('../src/extensions/propresenter-follower/index.ts')
const { registry, proPresenterAvailability } = require('../src/extensions/registry.ts')
const { ExtensionHost } = require('../src/extensions/host/ExtensionHost.ts')
const { validSetting } = require('../src/extensions/host/settings.ts')
globalThis.document = undefined
globalThis.isSecureContext = undefined
const savedProperties = new WeakMap()
function property(t, object, key, value) {
  let saved = savedProperties.get(t)
  if (!saved) {
    saved = []
    savedProperties.set(t, saved)
    t.after(() => { for (const restore of saved.reverse()) restore() })
  }
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  Object.defineProperty(object, key, { configurable: true, writable: true, value })
  const restore = () => descriptor ? Object.defineProperty(object, key, descriptor) : delete object[key]
  saved.push(restore)
  return { mock: { restore } }
}
const bytes = text => new TextEncoder().encode(text)
const state = (a = '', b = '', text = a) => ({ current: { uuid: a, text }, next: { uuid: b, text: b } })
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

test('object framing: pretty multiline, multiple objects, arbitrary byte splits, UTF-8 and escaped braces', () => {
  const objects = [{ text: 'é🎸 { [ } \\" quote " end', nested: [{ a: 1 }] }, state('A', 'B')]
  const encoded = bytes(objects.map(o => JSON.stringify(o, null, 2)).join('\r\n\r\n'))
  for (let split = 0; split <= encoded.length; split++) {
    const parser = new ObjectFrames()
    assert.deepEqual([...parser.push(encoded.slice(0, split)), ...parser.push(encoded.slice(split))], objects)
    parser.finish()
  }
  const parser = new ObjectFrames(), output = []
  for (const byte of encoded) output.push(...parser.push(Uint8Array.of(byte)))
  assert.deepEqual(output, objects)
})
test('malformed, incomplete, oversized and invalid UTF-8 frames fail', () => {
  for (const text of ['[]', 'garbage', '{"x":}', '{]', '{"x":1} nope', '{"x":"\n"}', '{"x":"' + 'a'.repeat(1024 * 1024)]) {
    assert.throws(() => new ObjectFrames().push(bytes(text)))
  }
  const parser = new ObjectFrames(); parser.push(bytes('{"x":'))
  assert.throws(() => parser.finish())
  assert.throws(() => new ObjectFrames().push(Uint8Array.of(0xff)))
})
test('dedupe accepts initial empty, A/B/A, backward and either UUID change; suppresses repeats', () => {
  const d = new SlideDedupe()
  assert.deepEqual([state(), state(), state('A', 'B'), state('B', 'C'), state('A', 'B'), state('A', 'C'), state('A', 'C')].map(s => d.accept(s)), [true, false, true, true, true, true, false])
})
test('validated host and fixed URL allowlist reject URL injection and invalid IPv4 in settings and transport', () => {
  for (const host of ['http://abc', 'abc/path', 'abc:1025', 'u@abc', 'abc?q=x', 'abc#x', '', ' abc', 'abc\\x', '256.1.1.1', '127.1', '0x7f000001', '0127.0.0.1', '-bad', 'bad.', '[::1]']) {
    assert.throws(() => buildUrl(host, paths[0]), host)
    assert.equal(validSetting(registry[0].manifest.settings[0], host), false, host)
  }
  for (const host of ['192.168.1.2', 'propresenter.local', 'my-host', 'localhost']) {
    for (const path of paths) assert.equal(buildUrl(host, path), `http://${host}:1025${path}?chunked=true`)
  }
  assert.throws(() => buildUrl('abc', '/v1/presentation/active'))
  assert.equal(validSetting(registry[0].manifest.settings[1], 1026), false)
})
test('capability detection excludes iOS, desktop iPadOS, Firefox, insecure or missing APIs', t => {
  property(t, globalThis, 'isSecureContext', true)
  for (const [ua, platform, touch, expected] of [
    ['Chrome/157 Android', 'Linux', 5, true], ['Chrome/157 Windows', 'Win32', 0, true],
    ['CriOS/157 iPhone', 'iPhone', 5, false], ['Chrome/157 iPad', 'iPad', 5, false],
    ['Chrome/157 Macintosh', 'MacIntel', 5, false], ['Version/18 Safari/605 Macintosh', 'MacIntel', 5, false],
    ['Firefox/140', 'Linux', 0, false],
  ]) {
    property(t, globalThis, 'navigator', { userAgent: ua, platform, maxTouchPoints: touch })
    assert.equal(proPresenterAvailability().available, expected)
  }
  property(t, globalThis, 'navigator', { userAgent: 'Chrome/157' })
  property(t, globalThis, 'isSecureContext', false)
  assert.equal(proPresenterAvailability().available, false)
  property(t, globalThis, 'isSecureContext', true)
  for (const api of ['fetch', 'ReadableStream']) {
    const mock = property(t, globalThis, api, undefined)
    assert.equal(proPresenterAvailability().available, false)
    mock.mock.restore()
  }
})

function fixture(t, fetcher) {
  const doc = new EventTarget(); doc.hidden = false
  property(t, globalThis, 'document', doc)
  const requests = [], streams = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options })
    if (fetcher) return fetcher(url, options)
    let stream
    const body = new ReadableStream({ start(c) { stream = c }, cancel() {} })
    streams.push(stream)
    return { ok: true, body }
  })
  const controller = new AbortController()
  let panel, settings = { host: '192.168.1.2', port: 1025 }, settingsListener
  const reports = []
  const ctx = { signal: controller.signal, settings: { read: () => settings, subscribe: fn => { settingsListener = fn; return () => { settingsListener = undefined } } }, reportStatus: (...args) => reports.push(args), log() { throw Error('No slide logging') }, setPanel: value => { panel = value } }
  const dispose = activate(ctx)
  t.after(dispose)
  return { requests, streams, reports, controller, dispose, get panel() { return panel }, value: label => panel.fields.find(f => f.label === label).value,
    hide(value) { doc.hidden = value; doc.dispatchEvent(new Event('visibilitychange')) },
    settings(value) { settings = value; settingsListener() }, send(index, value) { streams[index].enqueue(bytes(JSON.stringify(value))) } }
}
test('only allowlisted GETs, no body/headers, redirect error; empty next and identity; stale retains display and dedupe survives reconnect', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(Math, 'random', () => 0.5)
  const f = fixture(t); await flush()
  f.send(0, state('A', '', 'last slide')); f.send(1, { presentation: { index: 3, presentation_id: { name: 'Sunday' } } }); await flush()
  assert.equal(f.value('Status'), 'Live'); assert.equal(f.value('Next slide'), '')
  assert.equal(f.value('Presentation'), 'Sunday')
  for (const r of f.requests) {
    assert.ok(paths.some(path => r.url === buildUrl('192.168.1.2', path)))
    assert.deepEqual(Object.keys(r.options).sort(), ['cache', 'credentials', 'method', 'redirect', 'signal'])
    assert.equal(r.options.method, 'GET'); assert.equal(r.options.redirect, 'error')
    assert.equal(r.options.credentials, 'omit'); assert.equal(r.options.cache, 'no-store')
  }
  f.streams[0].close(); await flush()
  assert.equal(f.requests[0].options.signal.aborted, true)
  assert.equal(f.value('Status'), 'Stale / Offline'); assert.equal(f.value('Current slide'), 'last slide')
  t.mock.timers.tick(999); await flush(); assert.equal(f.requests.length, 2)
  t.mock.timers.tick(1); await flush(); assert.equal(f.requests.length, 3)
  f.send(2, state('A', '', 'repeat should not replace')); await flush()
  assert.equal(f.value('Current slide'), 'last slide'); assert.equal(f.value('Status'), 'Live')
  f.send(2, state('B', 'C')); await flush(); f.send(2, state('A', 'B')); await flush()
  assert.equal(f.value('Current slide'), 'A')
  f.dispose(); assert.ok(f.requests.every(r => r.options.signal.aborted))
  t.mock.timers.tick(100000); await flush(); assert.equal(f.requests.length, 3)
})
test('network rejection retries 1/2/4/8/16/30 seconds, bounded jitter, one attempt per endpoint', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); t.mock.method(Math, 'random', () => 0.5)
  const f = fixture(t, async () => { throw Error('network lost') }); await flush()
  let count = 2
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    t.mock.timers.tick(delay - 1); await flush(); assert.equal(f.requests.length, count)
    t.mock.timers.tick(1); await flush(); count += 2; assert.equal(f.requests.length, count)
  }
  for (let n = 0; n < 20; n++) {
    assert.ok(retryDelay(n, () => 0) > 0)
    assert.ok(retryDelay(n, () => 1) <= 30000)
  }
})
test('read rejection and malformed frame abort old reader and discard partial frames on recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); t.mock.method(Math, 'random', () => 0.5)
  const f = fixture(t); await flush()
  f.streams[0].enqueue(bytes('{"current":')); f.streams[0].error(Error('read failed')); await flush()
  assert.equal(f.requests[0].options.signal.aborted, true)
  t.mock.timers.tick(1000); await flush()
  f.send(2, state('fresh')); await flush(); assert.equal(f.value('Current slide'), 'fresh')
  f.streams[2].enqueue(bytes('{"bad":}')); await flush()
  assert.equal(f.requests[2].options.signal.aborted, true)
  assert.equal(f.value('Status'), 'Stale / Offline')
  assert.equal(f.value('Current slide'), 'fresh')
})
test('hidden stops requests/readers/retries/test, visible resumes; abort/dispose prevents all later work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture(t); await flush()
  f.send(0, state('A')); await flush()
  f.hide(true); await flush()
  assert.ok(f.requests.every(r => r.options.signal.aborted))
  assert.equal(f.value('Current slide'), 'A')
  t.mock.timers.tick(100000); await flush(); assert.equal(f.requests.length, 2)
  f.hide(false); await flush(); assert.equal(f.requests.length, 4)
  f.panel.actions[0].run(); await flush(); assert.equal(f.requests.length, 5)
  f.hide(true); await flush(); assert.ok(f.requests.every(r => r.options.signal.aborted))
  f.controller.abort(); f.hide(false); t.mock.timers.tick(100000); await flush()
  assert.equal(f.requests.length, 5)
})
test('connection test uses one snapshot GET, cancels it, reports result and resumes follower; wrong host gives useful hint', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture(t); await flush()
  f.panel.actions[0].run(); await flush()
  assert.equal(f.requests.length, 3)
  assert.ok(f.requests.slice(0, 2).every(r => r.options.signal.aborted))
  f.send(2, state()); await flush()
  assert.equal(f.value('Connection test'), 'Connected')
  assert.equal(f.requests[2].options.signal.aborted, true)
  assert.equal(f.requests.length, 5)
  f.panel.actions[0].run(); await flush()
  f.streams[5].error(Error('unreachable')); await flush()
  assert.match(f.value('Connection test'), /Cannot reach ProPresenter.*same Wi-Fi.*network setting.*local network access/)
})
test('production disabled registry has zero load/network/timer/listener/storage-write effects', async t => {
  const effects = []
  const entry = { ...registry[0], load: async () => { effects.push('load'); throw Error('disabled') } }
  t.mock.method(globalThis, 'fetch', () => { effects.push('fetch') })
  t.mock.method(globalThis, 'setTimeout', () => { effects.push('timer') })
  const host = new ExtensionHost([entry], { getItem: () => null, setItem: () => effects.push('write') })
  await host.start(); host.dispose()
  assert.deepEqual(effects, [])
  assert.equal(host.getSnapshot(entry.manifest.id).panel, undefined)
})

test('real follower panel in host row: default off, read-only port, current/next text, connection action and disable cleanup', async t => {
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.example/' })
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true, navigator: { userAgent: 'Chrome/157 Android', platform: 'Linux', maxTouchPoints: 5 }, isSecureContext: true })) property(t, globalThis, key, value)
  Object.defineProperty(document, 'hidden', { value: false })
  const React = require('react'), { act } = React
  const { createRoot } = require('react-dom/client')
  const { ExtensionRows } = require('../src/extensions/host/ExtensionRows.tsx')
  const streams = [], requests = [], writes = new Map()
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options })
    return { ok: true, body: new ReadableStream({ start(c) { streams.push(c) } }) }
  })
  const host = new ExtensionHost(registry, { getItem: key => writes.get(key) ?? null, setItem: (key, value) => writes.set(key, value) }, { capabilities: ['net:lan', 'ui:panel'] })
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => { await host.start(); root.render(React.createElement(ExtensionRows, { host, rowClass: 'text-app-heading' })) })
    assert.equal(requests.length, 0); assert.equal(writes.size, 0)
    await act(async () => document.querySelector('button').click())
    assert.equal(document.querySelector('input[name="port"]').readOnly, true)
    assert.match(document.body.textContent, /current CSP permits only port 1025/)
    assert.equal(document.querySelector('input[type="checkbox"]').checked, false)
    await act(async () => {
      assert.equal(host.saveSettings('propresenter-follower', { host: '192.168.1.2', port: 1025 }), true)
      document.querySelector('input[type="checkbox"]').click()
      await flush()
    })
    await act(async () => {
      streams[0].enqueue(bytes(JSON.stringify(state('A', '', '<last slide>'))))
      streams[1].enqueue(bytes(JSON.stringify({ presentation: { presentation_id: { name: 'Sunday' } } })))
      await flush()
    })
    const panel = document.querySelector('[aria-label="ProPresenter follower"]')
    assert.match(panel.textContent, /Live.*192.168.1.2.*Sunday.*<last slide>/)
    assert.equal(panel.querySelector('last'), null, 'slide text is rendered as text')
    assert.ok([...panel.querySelectorAll('div')].some(el => el.textContent === 'Next slide'))
    assert.equal(panel.querySelector('button').textContent, 'Test connection')
    assert.ok([...writes.values()].every(value => !value.includes('<last slide>') && !value.includes('Sunday')))
    await act(async () => document.querySelector('input[type="checkbox"]').click())
    assert.equal(document.querySelector('[aria-label="ProPresenter follower"]'), null)
    assert.ok(requests.every(r => r.options.signal.aborted))
    assert.equal(JSON.parse([...writes.values()][0]).enabled, false)
  } finally {
    await act(async () => { host.dispose(); root.unmount() })
    dom.window.close()
  }
})
