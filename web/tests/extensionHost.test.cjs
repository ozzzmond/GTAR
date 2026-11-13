const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, filename)
const { ExtensionHost } = require('../src/extensions/host/ExtensionHost.ts')
const { registry } = require('../src/extensions/registry.ts')
function storage() {
  const data = new Map(), writes = []
  return { data, writes, getItem: key => data.get(key) ?? null, setItem: (key, value) => { writes.push(key); data.set(key, value) } }
}
function fixture(options = {}) {
  const counts = { loads: 0, activations: 0, disposals: 0 }
  let context
  const manifest = { id: 'test-only', name: 'Test only', version: '1.0.0', contractVersion: 1, summary: 'Fixture', capabilities: [], settings: [], ...options.manifest }
  const entry = { manifest, checkAvailability: () => ({ available: true }), load: async () => {
    counts.loads++
    return { manifest, checkAvailability: () => ({ available: true }), activate: ctx => {
      counts.activations++; context = ctx
      return () => { counts.disposals++ }
    }, ...options.module }
  }, ...options.entry }
  return { entry, counts, get context() { return context } }
}

test('empty host boots without storage access and unknown ids are absent', async () => {
  const host = new ExtensionHost([], { getItem() { throw Error('must not read') }, setItem() { throw Error('must not write') } })
  await host.start()
  assert.equal(host.getSnapshot('missing').state, 'absent')
  await host.enable('missing'); host.disable('missing'); host.dispose()
})

test('disabled test-only lazy fixture has zero code/listener/timer/network/storage-write side effects (I2/I7)', async () => {
  const effects = []
  const data = storage()
  const f = fixture({ entry: { load: async () => {
    effects.push('code', 'listener', 'timer', 'network')
    throw Error('disabled implementation must never load')
  }, checkAvailability() { throw Error('disabled check must not run') } } })
  const host = new ExtensionHost([f.entry], data)
  await host.start()
  assert.equal(host.getSnapshot('test-only').state, 'disabled')
  assert.deepEqual(effects, [])
  assert.deepEqual(data.writes, [])
  assert.ok(!registry.some(entry => entry.manifest.id === 'test-only'))
  host.dispose()
  assert.deepEqual(data.writes, [])
})

test('capability denial and pure availability denial never load a chunk or enable the toggle', async () => {
  for (const options of [{ manifest: { capabilities: ['device:midi'] } }, { entry: { checkAvailability: () => ({ available: false, reason: 'Not available on this device/browser' }) } }, { manifest: { contractVersion: 2 } }]) {
    const f = fixture(options), data = storage(), host = new ExtensionHost([f.entry], data)
    await host.enable('test-only')
    assert.equal(host.getSnapshot('test-only').state, 'unavailable')
    assert.match(host.getSnapshot('test-only').message, /Not available/)
    assert.equal(f.counts.loads, 0)
    assert.deepEqual(data.writes, [])
  }
})

test('explicit enable lazily activates, persists, reports offline, and disables with abort and one disposal', async () => {
  const f = fixture(), data = storage(), host = new ExtensionHost([f.entry], data)
  await host.start()
  const pending = host.enable('test-only')
  assert.equal(host.getSnapshot('test-only').state, 'starting')
  await pending
  assert.equal(host.getSnapshot('test-only').state, 'active')
  assert.equal(f.counts.loads, 1)
  f.context.reportStatus('offline', 'Service unreachable')
  assert.equal(host.getSnapshot('test-only').state, 'offline')
  host.disable('test-only'); host.disable('test-only')
  assert.equal(f.context.signal.aborted, true)
  assert.equal(f.counts.disposals, 1)
  f.context.reportStatus('active')
  assert.equal(host.getSnapshot('test-only').state, 'disabled')
  assert.equal(JSON.parse(data.getItem('gtar_ext_test-only_v1')).enabled, false)
})

test('disable during chunk loading ignores late success and late failure', async () => {
  for (const rejectLoad of [false, true]) {
    let resolve, reject
    const f = fixture({ entry: { load: () => new Promise((yes, no) => { resolve = yes; reject = no }) } })
    const host = new ExtensionHost([f.entry], storage())
    const pending = host.enable('test-only')
    host.disable('test-only')
    if (rejectLoad) reject(Error('late')); else resolve({ activate() { throw Error('must not activate') } })
    await pending
    assert.equal(host.getSnapshot('test-only').state, 'disabled')
  }
})

test('faults are isolated and stale settings subscriptions are dropped', async () => {
  const f = fixture(), host = new ExtensionHost([f.entry], storage())
  await host.enable('test-only')
  let calls = 0
  f.context.settings.subscribe(() => calls++)
  f.context.reportStatus('error', 'Stopped')
  assert.equal(f.counts.disposals, 1)
  assert.equal(host.getSnapshot('test-only').state, 'error')
  assert.ok(host.saveSettings('test-only', {}))
  assert.equal(calls, 0)
  const broken = fixture({ module: { activate() { throw Error('secret failure') } } })
  const isolated = new ExtensionHost([broken.entry], storage())
  await isolated.enable('test-only')
  assert.equal(isolated.getSnapshot('test-only').state, 'error')
})

test('settings validate, fall back safely, redact secrets, and survive restart only when enabled', async () => {
  const f = fixture({ manifest: { settings: [
    { key: 'port', label: 'Port', type: 'port', default: 1025 },
    { key: 'token', label: 'Token', type: 'secret' },
  ] } }), data = storage(), logs = []
  data.data.set('gtar_ext_test-only_v1', JSON.stringify({ enabled: false, settings: { port: -1, token: 'private', unknown: 'drop' } }))
  const host = new ExtensionHost([f.entry], data, { capabilities: [] }, message => logs.push(message))
  await host.start()
  assert.deepEqual(host.getSnapshot('test-only').settings, { port: 1025, token: 'private' })
  assert.equal(host.saveSettings('test-only', { port: 65536, token: 'private' }), false)
  assert.equal(host.saveSettings('test-only', { port: 5000, token: 'private' }), true)
  await host.enable('test-only')
  f.context.log('token private')
  f.context.reportStatus('offline', 'private unavailable')
  assert.deepEqual(logs, ['token [REDACTED]'])
  assert.equal(host.getSnapshot('test-only').message, '[REDACTED] unavailable')
  host.dispose()
  const restarted = new ExtensionHost([f.entry], data)
  await restarted.start()
  assert.equal(restarted.getSnapshot('test-only').state, 'active')
  assert.equal(restarted.getSnapshot('test-only').settings.port, 5000)
  restarted.dispose()
})

test('unreadable or unwritable storage stays disabled without loading code', async () => {
  for (const data of [{ getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') } }, { getItem: () => null, setItem() { throw Error('quota') } }]) {
    const f = fixture(), host = new ExtensionHost([f.entry], data)
    await host.start(); await host.enable('test-only')
    assert.equal(host.getSnapshot('test-only').state, 'disabled')
    assert.equal(f.counts.loads, 0)
  }
})

test('production registry denies unsupported devices without loading its lazy connector', async () => {
  assert.deepEqual(registry.map(entry => entry.manifest.id), ['propresenter-follower'])
  const data = storage(), host = new ExtensionHost(registry, data)
  await host.start(); await host.enable('propresenter-follower')
  assert.equal(host.getSnapshot('propresenter-follower').state, 'unavailable')
  assert.equal(host.getSnapshot('propresenter-follower').message, 'Not available on this device/browser')
  assert.equal(typeof registry[0].load, 'function')
  assert.deepEqual(data.writes, [])
})


test('real test-only import stays unloaded when disabled and cleans its timer and listener on disable', async () => {
  const symbol = Symbol.for('gtar.extension-host.fixture')
  const probe = { loads: 0, activations: 0, listeners: 0, timers: 0, ticks: 0, events: 0, settingsChanges: 0, disposals: 0, target: new EventTarget() }
  globalThis[symbol] = probe
  const manifest = { id: 'lazy-fixture', name: 'Lazy fixture', version: '1.0.0', contractVersion: 1, summary: 'Test-only chunk', capabilities: [], settings: [] }
  const data = storage()
  const host = new ExtensionHost([{ manifest, checkAvailability: () => ({ available: true }), load: () => import('./fixtures/extensionHostModule.cjs') }], data)
  try {
    await host.start()
    probe.target.dispatchEvent(new Event('ping'))
    assert.deepEqual([probe.loads, probe.activations, probe.listeners, probe.timers, probe.events, data.writes.length], [0, 0, 0, 0, 0, 0])
    await host.enable('lazy-fixture')
    assert.equal(host.getSnapshot('lazy-fixture').state, 'active')
    assert.deepEqual([probe.loads, probe.activations, probe.listeners, probe.timers], [1, 1, 1, 1])
    probe.target.dispatchEvent(new Event('ping'))
    assert.equal(probe.events, 1)
    host.disable('lazy-fixture')
    probe.target.dispatchEvent(new Event('ping'))
    assert.equal(probe.events, 1)
    assert.deepEqual([probe.listeners, probe.timers, probe.disposals], [0, 0, 1])
  } finally { host.dispose(); delete globalThis[symbol] }
})


test('follower-only memory output is generation scoped, frozen, projected and invalidated on identity, settings and disable', async () => {
  const data = storage(), messages = []
  const f = fixture({ manifest: { id: 'propresenter-follower' } })
  const other = fixture()
  const host = new ExtensionHost([f.entry, other.entry], data, undefined, message => messages.push(message))
  await host.enable('propresenter-follower'); await host.enable('test-only')
  assert.equal(other.context.publishFollowSnapshot, undefined)
  const value = { live: true, presentation: { uuid: 'presentation-a', title: 'Synthetic', slideIndex: 0, notes: 'discard' }, current: { uuid: 'slide-a', text: 'Synthetic lyric content', notes: 'discard' }, extra: 'discard' }
  f.context.publishFollowSnapshot(value)
  const first = host.getFollowSnapshot()
  assert.equal(Object.isFrozen(first), true); assert.equal(Object.isFrozen(first.current), true)
  assert.equal(JSON.stringify(first).includes('discard'), false)
  value.current.text = 'Edited lyric content'
  assert.equal(first.current.text, 'Synthetic lyric content')
  f.context.publishFollowSnapshot(value)
  assert.equal(host.getFollowSnapshot().session, first.session)
  f.context.publishFollowSnapshot({ ...value, presentation: { ...value.presentation, uuid: 'presentation-b' } })
  assert.notEqual(host.getFollowSnapshot().session, first.session)
  f.context.publishFollowSnapshot({ ...value, live: false })
  const offline = host.getFollowSnapshot().session
  f.context.publishFollowSnapshot(value)
  assert.notEqual(host.getFollowSnapshot().session, offline)
  host.saveSettings('propresenter-follower', {})
  assert.equal(host.getFollowSnapshot(), null)
  f.context.publishFollowSnapshot(value)
  const oldContext = f.context
  host.disable('propresenter-follower')
  assert.equal(host.getFollowSnapshot(), null)
  oldContext.publishFollowSnapshot(value)
  assert.equal(host.getFollowSnapshot(), null)
  await host.enable('propresenter-follower')
  oldContext.publishFollowSnapshot(value)
  assert.equal(host.getFollowSnapshot(), null)
  assert.equal([...data.data.values()].some(text => text.includes('lyric')), false)
  assert.deepEqual(messages, [])
  host.dispose()
})
