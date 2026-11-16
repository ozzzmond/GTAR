// #536: the MIDI switch, status store and lazy engine loader. OFF loads nothing and asks
// nothing; N/A detection; the saved switch; app start reconnects without a prompt; an engine that
// cannot load leaves the app working. Fake MIDIAccess, no real device.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('', { url: 'https://gtar.app/' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, Event: dom.window.Event, isSecureContext: true })

const { brief, CHROME_DESKTOP, fakeInput, fakeAccess, fakeNavigator, domError, settle, listenerCount, engineLoaded, forgetMidiModules } = require('./helpers/fakeMidi.cjs')
const KEY = 'gtar_midi_v1'
const saved = () => JSON.parse(localStorage.getItem(KEY))
const leftOn = () => localStorage.setItem(KEY, JSON.stringify({ version: 1, enabled: true, device: 'all', channel: 'all', mappings: {} }))

/** A new page: empty storage unless `keep`, the given navigator, and web/src/midi loaded from scratch. */
function page(navOptions = {}, { keep = false } = {}) {
  if (!keep) localStorage.clear()
  forgetMidiModules()
  global.isSecureContext = true
  const nav = fakeNavigator(navOptions)
  Object.defineProperty(global, 'navigator', { configurable: true, value: nav })
  const midi = require('../src/midi/loader.ts')
  const states = []
  midi.subscribeMidi(() => states.push(midi.getMidiSnapshot().state))
  return { nav, midi, states, access: nav.access }
}
/** Makes the lazy engine import fail, as a missing or broken chunk would. */
function breakEngineLoad() {
  const original = Module._load
  Module._load = function (request, parent, ...rest) {
    if (request === './engine' && /[\\/]midi[\\/]loader\.ts$/.test(parent?.filename ?? '')) throw new Error('Failed to fetch dynamically imported module')
    return original.call(this, request, parent, ...rest)
  }
  return () => { Module._load = original }
}

test('default OFF: app start loads no engine, asks nothing and adds no listener', async () => {
  const { nav, midi, states, access } = page({ access: fakeAccess([fakeInput('p1', 'FS-1-WL')]) })
  const stop = midi.startMidi()
  await settle()
  assert.deepEqual(brief(midi.getMidiSnapshot()), { state: 'off', devices: [] })
  assert.equal(engineLoaded(), false, 'the engine module is not loaded')
  assert.deepEqual([nav.requests.length, nav.queries.length, listenerCount(access), access.onstatechange], [0, 0, 0, null])
  assert.equal(localStorage.getItem(KEY), null, 'reading never writes')
  midi.retryMidi()
  await settle()
  assert.equal(engineLoaded(), false, 'a retry while off does nothing')
  stop()
  assert.deepEqual(states, [])
})

test('switch ON saves the choice, loads the engine and connects; OFF detaches and saves', async () => {
  const pedal = fakeInput('p1', 'FS-1-WL')
  const { nav, midi, states, access } = page({ access: fakeAccess([pedal]) })
  const stop = midi.startMidi()
  midi.setMidiEnabled(true)
  assert.equal(midi.getMidiSnapshot().state, 'starting', 'Starting at once, before the engine has loaded')
  assert.equal(saved().enabled, true)
  await settle()
  assert.equal(engineLoaded(), true)
  assert.deepEqual(brief(midi.getMidiSnapshot()), { state: 'connected', devices: ['FS-1-WL'] })
  assert.deepEqual(nav.requests, [[]], 'one request, without options')
  assert.equal(nav.queries.length, 0, 'the tap asks directly; the saved-change event did not start a second, quiet run')
  assert.equal(listenerCount(access), 1)

  midi.setMidiEnabled(true)
  await settle()
  assert.deepEqual([nav.requests.length, pedal.sets], [1, 1], 'switching on twice does nothing more')

  midi.setMidiEnabled(false)
  assert.deepEqual(brief(midi.getMidiSnapshot()), { state: 'off', devices: [] })
  assert.equal(saved().enabled, false)
  assert.deepEqual([listenerCount(access), access.onstatechange, pedal.closes], [0, null, 1])
  assert.deepEqual(states, ['starting', 'connected', 'off'])
  stop()
})

test('switching the setting keeps the rest of the stored MIDI settings', async () => {
  localStorage.clear()
  const mapping = { nextSong: { type: 'cc', channel: 1, number: 64 } }
  localStorage.setItem(KEY, JSON.stringify({ version: 1, enabled: false, device: 'all', channel: 5, mappings: mapping }))
  const { midi } = page({}, { keep: true })
  midi.setMidiEnabled(true)
  await settle()
  assert.deepEqual(saved(), { version: 1, enabled: true, device: 'all', channel: 5, mappings: mapping })
  midi.setMidiEnabled(false)
  assert.deepEqual(saved(), { version: 1, enabled: false, device: 'all', channel: 5, mappings: mapping })
})

test('app start with MIDI left ON and access granted: reconnects without a new prompt', async () => {
  localStorage.clear()
  leftOn()
  const { nav, midi, states, access } = page({ access: fakeAccess([fakeInput('p1', 'FS-1-WL')]), permission: 'granted' }, { keep: true })
  const stop = midi.startMidi()
  await settle()
  assert.deepEqual(brief(midi.getMidiSnapshot()), { state: 'connected', devices: ['FS-1-WL'] })
  assert.deepEqual(nav.queries, [{ name: 'midi' }], 'the permission is checked first')
  assert.equal(nav.requests.length, 1)
  assert.deepEqual(states, ['starting', 'connected'])

  // The cleanup detaches and leaves the saved choice alone.
  stop()
  assert.equal(midi.getMidiSnapshot().state, 'off')
  assert.equal(listenerCount(access), 0)
  assert.equal(saved().enabled, true)
})

test('page put away (pagehide): detaches as for OFF and keeps the saved choice; on return it reattaches without a prompt', async () => {
  localStorage.clear()
  leftOn()
  const pedal = fakeInput('p1', 'FS-1-WL')
  const { nav, midi, access } = page({ access: fakeAccess([pedal]), permission: 'granted' }, { keep: true })
  const stop = midi.startMidi()
  await settle()
  assert.equal(midi.getMidiSnapshot().state, 'connected')
  const learned = []
  midi.learnMidiInput(input => learned.push(input))

  window.dispatchEvent(new window.Event('pagehide'))
  assert.equal(midi.getMidiSnapshot().state, 'off')
  assert.deepEqual([listenerCount(access), access.onstatechange, pedal.closes], [0, null, 1])
  assert.equal(saved().enabled, true, 'the saved choice is untouched')

  window.dispatchEvent(new window.Event('pageshow'))
  await settle()
  assert.deepEqual(brief(midi.getMidiSnapshot()), { state: 'connected', devices: ['FS-1-WL'] })
  assert.deepEqual([listenerCount(access), pedal.sets], [1, 2], 'attached once')
  assert.equal(nav.queries.length, 2, 'quiet: the permission is checked, the player is not asked')
  pedal.send([0x90, 60, 100])
  assert.deepEqual(learned, [], 'a Learn from before the page was put away is gone')

  // The first pageshow of a page view, with MIDI already running, starts nothing twice.
  window.dispatchEvent(new window.Event('pageshow'))
  await settle()
  assert.deepEqual([nav.requests.length, pedal.sets], [2, 2])

  // Switched off: coming back does not turn it on. After the cleanup the events do nothing.
  midi.setMidiEnabled(false)
  window.dispatchEvent(new window.Event('pagehide'))
  window.dispatchEvent(new window.Event('pageshow'))
  await settle()
  assert.equal(midi.getMidiSnapshot().state, 'off')
  midi.setMidiEnabled(true)
  await settle()
  stop()
  window.dispatchEvent(new window.Event('pageshow'))
  await settle()
  assert.equal(midi.getMidiSnapshot().state, 'off', 'no listener left behind by the cleanup')
  assert.equal(listenerCount(access), 0)
  midi.setMidiEnabled(false)
})

test('Learn through the loader: nothing while MIDI is off; one capture while connected', async () => {
  const pedal = fakeInput('p1', 'FS-1-WL')
  const { midi } = page({ access: fakeAccess([pedal]) })
  const learned = []
  const cancelOff = midi.learnMidiInput(input => learned.push(input))
  assert.equal(typeof cancelOff, 'function')
  assert.doesNotThrow(cancelOff)
  assert.equal(engineLoaded(), false, 'Learn never loads the engine')

  const realNow = performance.now
  let at = 1000
  performance.now = () => at
  try {
    midi.setMidiEnabled(true)
    await settle()
    at += 500
    const cancel = midi.learnMidiInput(input => learned.push(input))
    pedal.send([0xb0, 64, 127])
    pedal.send([0x90, 60, 100])
    assert.deepEqual(learned, [{ type: 'cc', channel: 1, number: 64 }])
    cancel()

    midi.learnMidiInput(input => learned.push(input))
    midi.setMidiEnabled(false)
    assert.doesNotThrow(() => pedal.send([0x90, 61, 100]))
    assert.equal(learned.length, 1, 'MIDI off ends Learn')
    assert.equal(typeof midi.learnMidiInput(() => learned.push('off'))(), 'undefined', 'off again: a no-op cancel')
  } finally { performance.now = realNow; midi.setMidiEnabled(false) }
})

test('app start with MIDI left ON and no grant: Allow or Blocked, the browser is not asked until a tap', async () => {
  for (const [permission, expected] of [['prompt', 'allow'], ['denied', 'blocked'], [null, 'allow']]) {
    localStorage.clear()
    leftOn()
    const { nav, midi, access } = page({ access: fakeAccess([fakeInput('p1', 'FS-1-WL')]), permission }, { keep: true })
    const stop = midi.startMidi()
    await settle()
    assert.equal(midi.getMidiSnapshot().state, expected, String(permission))
    assert.equal(nav.requests.length, 0, `${permission}: no prompt at app start`)
    assert.equal(listenerCount(access), 0)

    midi.retryMidi()
    await settle()
    assert.equal(midi.getMidiSnapshot().state, 'connected', 'Allow MIDI / Try again asks from the tap')
    assert.equal(nav.requests.length, 1)
    stop()
  }
})

test('retry: Blocked stays Blocked while denied; No device finds a device plugged in without an event', async () => {
  const { nav, midi } = page({ request: () => Promise.reject(domError('NotAllowedError')) })
  midi.setMidiEnabled(true)
  await settle()
  assert.equal(midi.getMidiSnapshot().state, 'blocked')
  midi.retryMidi()
  await settle()
  assert.equal(midi.getMidiSnapshot().state, 'blocked')
  assert.equal(nav.requests.length, 2)

  nav.request = undefined
  midi.retryMidi()
  await settle()
  assert.equal(midi.getMidiSnapshot().state, 'no-device')
  nav.access.inputs.set('p1', fakeInput('p1', 'FS-1-WL'))
  midi.retryMidi()
  await settle()
  assert.deepEqual(brief(midi.getMidiSnapshot()), { state: 'connected', devices: ['FS-1-WL'] })
  assert.equal(listenerCount(nav.access), 1)
  midi.setMidiEnabled(false)
})

test('N/A: iPhone, iPad, Firefox on Android and desktop, no Web MIDI, or no secure context', async () => {
  const cases = [
    ['iPhone Safari', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 }],
    ['iPhone Chrome', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/157.0.0.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 }],
    ['iPad', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPad', maxTouchPoints: 5 }],
    ['iPad as desktop', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 }],
    ['Firefox iOS', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15', platform: 'iPhone', maxTouchPoints: 5 }],
    ['Firefox Android', { userAgent: 'Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0', platform: 'Linux armv81', maxTouchPoints: 5 }],
    ['Firefox desktop', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0', platform: 'Win32' }],
    ['no Web MIDI', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', platform: 'MacIntel', requestMIDIAccess: undefined }],
    ['not a secure context', {}, false],
  ]
  for (const [label, navOptions, secure = true] of cases) {
    localStorage.clear()
    leftOn()
    const { nav, midi, states } = page(navOptions, { keep: true })
    global.isSecureContext = secure
    assert.deepEqual(midi.midiAvailability(), { available: false, reason: 'Not available on this device/browser' }, label)
    assert.deepEqual(brief(midi.getMidiSnapshot()), { state: 'unavailable', devices: [] }, label)
    const stop = midi.startMidi()
    midi.setMidiEnabled(true)
    midi.retryMidi()
    await settle()
    stop()
    assert.equal(engineLoaded(), false, `${label}: no engine`)
    assert.deepEqual([nav.requests.length, nav.queries.length, states.length], [0, 0, 0], `${label}: nothing asks for permission`)
    assert.equal(midi.getMidiSnapshot().state, 'unavailable')
  }
  global.isSecureContext = true
})

test('available by feature detection: Chrome and Edge on desktop, Chrome on Android, Mac with no touch screen', () => {
  for (const [label, navOptions] of [
    ['Chrome desktop', { userAgent: CHROME_DESKTOP }],
    ['Edge desktop', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0', platform: 'Win32' }],
    ['Chrome Android', { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36', platform: 'Linux armv81', maxTouchPoints: 5 }],
    ['Chrome macOS', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36', platform: 'MacIntel', maxTouchPoints: 0 }],
  ]) {
    const { midi } = page(navOptions)
    assert.deepEqual(midi.midiAvailability(), { available: true }, label)
    assert.equal(midi.getMidiSnapshot().state, 'off', `${label}: default OFF`)
  }
})

test('engine load failure: Error, nothing throws, the page keeps working, off and on tries again', async () => {
  const pedal = fakeInput('p1', 'FS-1-WL')
  const { nav, midi, states, access } = page({ access: fakeAccess([pedal]) })
  const rejections = []
  const onRejection = reason => rejections.push(reason)
  process.on('unhandledRejection', onRejection)
  const restore = breakEngineLoad()
  try {
    const stop = midi.startMidi()
    assert.doesNotThrow(() => midi.setMidiEnabled(true))
    await settle()
    assert.deepEqual(brief(midi.getMidiSnapshot()), { state: 'error', devices: [] })
    assert.equal(saved().enabled, true, 'the switch stays on, showing Error')
    assert.deepEqual([nav.requests.length, listenerCount(access)], [0, 0])
    assert.doesNotThrow(() => midi.retryMidi())
    await settle()
    assert.equal(midi.getMidiSnapshot().state, 'error')

    // Everything outside MIDI is untouched: storage and window events still work.
    localStorage.setItem('gtar_other', '1')
    let heard = 0
    window.addEventListener('gtar-test', () => heard++)
    window.dispatchEvent(new window.Event('gtar-test'))
    assert.deepEqual([localStorage.getItem('gtar_other'), heard], ['1', 1])

    assert.doesNotThrow(() => midi.setMidiEnabled(false))
    assert.equal(midi.getMidiSnapshot().state, 'off')
    restore()
    midi.setMidiEnabled(true)
    await settle()
    assert.deepEqual(brief(midi.getMidiSnapshot()), { state: 'connected', devices: ['FS-1-WL'] }, 'off and on again loads the engine')
    assert.deepEqual(states, ['starting', 'error', 'starting', 'error', 'off', 'starting', 'connected'])
    stop()
    assert.deepEqual(rejections, [], 'no unhandled rejection')
  } finally {
    restore()
    process.off('unhandledRejection', onRejection)
  }
})

test('app start with MIDI left ON and an engine that cannot load: Error, and app start does not throw', async () => {
  localStorage.clear()
  leftOn()
  const { nav, midi } = page({}, { keep: true })
  const restore = breakEngineLoad()
  try {
    let stop
    assert.doesNotThrow(() => { stop = midi.startMidi() })
    await settle()
    assert.equal(midi.getMidiSnapshot().state, 'error')
    assert.equal(nav.requests.length, 0)
    assert.doesNotThrow(() => stop())
    assert.equal(midi.getMidiSnapshot().state, 'off')
  } finally { restore() }
})

test('OFF before the engine has loaded: the late load starts nothing', async () => {
  const pedal = fakeInput('p1', 'FS-1-WL')
  const { nav, midi, states, access } = page({ access: fakeAccess([pedal]) })
  midi.setMidiEnabled(true)
  midi.setMidiEnabled(false)
  await settle()
  assert.equal(midi.getMidiSnapshot().state, 'off')
  assert.deepEqual([nav.requests.length, listenerCount(access), pedal.sets], [0, 0, 0])
  assert.deepEqual(states, ['starting', 'off'])
  assert.equal(saved().enabled, false)

  // On, off, on in one go: exactly one run reaches the browser.
  midi.setMidiEnabled(true)
  midi.setMidiEnabled(false)
  midi.setMidiEnabled(true)
  await settle()
  assert.equal(midi.getMidiSnapshot().state, 'connected')
  assert.deepEqual([nav.requests.length, pedal.sets], [1, 1])
  midi.setMidiEnabled(false)
})

test('the switch in another tab is followed here without a prompt', async () => {
  const { nav, midi, access } = page({ access: fakeAccess([fakeInput('p1', 'FS-1-WL')]), permission: 'prompt' })
  const stop = midi.startMidi()
  leftOn()
  window.dispatchEvent(new window.StorageEvent('storage', { key: KEY }))
  await settle()
  assert.equal(midi.getMidiSnapshot().state, 'allow', 'on, but this tab never prompts by itself')
  assert.equal(nav.requests.length, 0)

  localStorage.setItem(KEY, JSON.stringify({ version: 1, enabled: false, device: 'all', channel: 'all', mappings: {} }))
  window.dispatchEvent(new window.StorageEvent('storage', { key: KEY }))
  assert.equal(midi.getMidiSnapshot().state, 'off')

  nav.permission = 'granted'
  leftOn()
  window.dispatchEvent(new window.StorageEvent('storage', { key: KEY }))
  await settle()
  assert.equal(midi.getMidiSnapshot().state, 'connected')
  stop()
  assert.equal(listenerCount(access), 0)

  // After the cleanup the page no longer follows storage.
  window.dispatchEvent(new window.StorageEvent('storage', { key: KEY }))
  await settle()
  assert.equal(midi.getMidiSnapshot().state, 'off')
})

test('storage that cannot save: the switch still works for this page view', async () => {
  const { midi } = page({ access: fakeAccess([fakeInput('p1', 'FS-1-WL')]) })
  const proto = Object.getPrototypeOf(localStorage), original = proto.setItem
  proto.setItem = () => { throw new Error('QuotaExceededError') }
  try {
    assert.doesNotThrow(() => midi.setMidiEnabled(true))
    await settle()
    assert.equal(midi.getMidiSnapshot().state, 'connected')
    assert.doesNotThrow(() => midi.setMidiEnabled(false))
    assert.equal(midi.getMidiSnapshot().state, 'off')
  } finally { proto.setItem = original }
  assert.equal(localStorage.getItem(KEY), null)
})

test('a failing subscriber does not stop the others; unsubscribe stops updates', async () => {
  const { midi } = page()
  const seen = []
  midi.subscribeMidi(() => { throw new Error('subscriber') })
  const off = midi.subscribeMidi(() => seen.push(midi.getMidiSnapshot().state))
  assert.doesNotThrow(() => midi.setMidiEnabled(true))
  await settle()
  assert.deepEqual(seen, ['starting', 'no-device'])
  off()
  midi.setMidiEnabled(false)
  assert.deepEqual(seen, ['starting', 'no-device'])
})
