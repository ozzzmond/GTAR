// #536 Slice 3: the MIDI engine state machine against a fake MIDIAccess. Every state, permission
// denied, no inputs, hot-plug, one listener per port, late answers, wrapped callbacks, no SysEx,
// and device names as cut plain text. No real device and no browser.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)

const { createMidiEngine } = require('../src/midi/engine.ts')
const { fakeInput, fakeAccess, fakeNavigator, domError, deferred, settle, listenerCount } = require('./helpers/fakeMidi.cjs')

/** An engine on a fake navigator; `states` records every status it reports. */
function setup(navOptions = {}, engineOptions = {}) {
  const nav = fakeNavigator(navOptions)
  const states = []
  const engine = createMidiEngine({ navigator: nav, onChange: snapshot => states.push(snapshot.state), ...engineOptions })
  return { nav, engine, states, access: nav.access }
}
const state = engine => engine.getSnapshot().state

test('off until started: creating the engine asks nothing and listens to nothing', async () => {
  const pedal = fakeInput('p1', 'FS-1-WL')
  const { nav, engine, states, access } = setup({ access: fakeAccess([pedal]) })
  await settle()
  assert.deepEqual(engine.getSnapshot(), { state: 'off', devices: [] })
  assert.deepEqual([nav.requests.length, nav.queries.length, listenerCount(access), states.length], [0, 0, 0, 0])
  assert.equal(access.onstatechange, null)
})

test('ask: Starting, then Connected with one listener per port, and SysEx is never requested', async () => {
  const pedal = fakeInput('p1', 'FS-1-WL'), keys = fakeInput('p2', 'Keystation')
  const { nav, engine, states, access } = setup({ access: fakeAccess([pedal, keys]) })
  engine.start('ask')
  assert.equal(state(engine), 'starting', 'Starting until the browser answers')
  await settle()
  assert.deepEqual(states, ['starting', 'connected'])
  assert.deepEqual(engine.getSnapshot(), { state: 'connected', devices: ['FS-1-WL', 'Keystation'] })
  assert.equal(listenerCount(access), 2)
  assert.deepEqual([pedal.sets, keys.sets], [1, 1])
  assert.equal(typeof access.onstatechange, 'function')
  assert.equal(nav.queries.length, 0, 'a tap asks the browser directly')
  assert.deepEqual(nav.requests, [[]], 'requestMIDIAccess() is called once, with no options at all')
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../src/midi/engine.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''), /sysex/i, 'no sysex flag in engine code')
})

test('permission denied is Blocked; any other failure is Error; Try again connects once the block is lifted', async () => {
  for (const name of ['NotAllowedError', 'SecurityError']) {
    const { nav, engine, states, access } = setup({ request: () => Promise.reject(domError(name)) })
    engine.start('ask')
    await settle()
    assert.deepEqual(states, ['starting', 'blocked'], name)
    assert.deepEqual([listenerCount(access), access.onstatechange], [0, null])
    nav.access = fakeAccess([fakeInput('p1', 'FS-1-WL')])
    nav.request = undefined
    engine.start('ask')
    await settle()
    assert.equal(state(engine), 'connected', 'Try again after allowing in site settings')
  }
  for (const failure of [() => Promise.reject(domError('NotSupportedError')), () => Promise.reject(null), () => { throw new Error('sync') }, () => Promise.resolve(null)]) {
    const { engine, states } = setup({ request: failure })
    engine.start('ask')
    await settle()
    assert.deepEqual(states, ['starting', 'error'])
  }
})

test('no inputs is No device; hot-plug in is Connected; out is No device; back in is Connected with one listener', async () => {
  const { engine, states, access } = setup()
  engine.start('ask')
  await settle()
  assert.deepEqual(engine.getSnapshot(), { state: 'no-device', devices: [] })
  assert.equal(typeof access.onstatechange, 'function', 'still waiting for a device')

  const pedal = fakeInput('p1', 'FS-1-WL')
  access.plug(pedal)
  assert.deepEqual(engine.getSnapshot(), { state: 'connected', devices: ['FS-1-WL'] })
  assert.equal(listenerCount(access), 1)

  access.unplug(pedal)
  assert.deepEqual(engine.getSnapshot(), { state: 'no-device', devices: [] })
  assert.equal(pedal.onmidimessage, null, 'a disconnected port keeps no listener')

  access.plug(pedal)
  assert.equal(state(engine), 'connected')
  assert.deepEqual([listenerCount(access), pedal.sets], [1, 2])

  access.remove(pedal)
  assert.equal(state(engine), 'no-device', 'a port that is no longer listed counts as gone')
  assert.equal(pedal.onmidimessage, null)
  assert.deepEqual(states, ['starting', 'no-device', 'connected', 'no-device', 'connected', 'no-device'])
})

test('two devices: one going away leaves the other connected; repeated statechange adds no listener', async () => {
  const pedal = fakeInput('p1', 'FS-1-WL'), keys = fakeInput('p2', 'Keystation')
  const { engine, states, access } = setup({ access: fakeAccess([pedal, keys]) })
  engine.start('ask')
  await settle()
  for (let i = 0; i < 5; i++) access.onstatechange({ port: pedal })
  assert.deepEqual([pedal.sets, keys.sets, listenerCount(access)], [1, 1, 2])
  assert.deepEqual(states, ['starting', 'connected'], 'an unchanged status is not reported again')

  access.unplug(keys)
  assert.deepEqual(engine.getSnapshot(), { state: 'connected', devices: ['FS-1-WL'] })
  assert.deepEqual([pedal.onmidimessage !== null, keys.onmidimessage], [true, null])

  // A replaced port object under the same id is listened to instead of the old one.
  const replacement = fakeInput('p1', 'FS-1-WL v2')
  access.plug(replacement)
  assert.deepEqual(engine.getSnapshot().devices, ['FS-1-WL v2'])
  assert.deepEqual([pedal.onmidimessage, replacement.sets], [null, 1])
})

test('quiet start: connects only when already granted; otherwise Allow or Blocked with no access request', async () => {
  const granted = setup({ access: fakeAccess([fakeInput('p1', 'FS-1-WL')]), permission: 'granted' })
  granted.engine.start('quiet')
  await settle()
  assert.deepEqual(granted.states, ['starting', 'connected'])
  assert.deepEqual(granted.nav.queries, [{ name: 'midi' }], 'the midi permission is queried without sysex')
  assert.deepEqual(granted.nav.requests, [[]])

  for (const [permission, expected] of [['prompt', 'allow'], ['denied', 'blocked'], [null, 'allow'], ['something-new', 'allow']]) {
    const { nav, engine, states, access } = setup({ access: fakeAccess([fakeInput('p1', 'FS-1-WL')]), permission })
    engine.start('quiet')
    await settle()
    assert.deepEqual(states, ['starting', expected], String(permission))
    assert.equal(nav.requests.length, 0, `${permission}: no prompt at app start`)
    assert.equal(listenerCount(access), 0)
    // Allow MIDI (a tap) then asks.
    engine.start('ask')
    await settle()
    assert.equal(state(engine), 'connected')
    assert.equal(nav.requests.length, 1)
  }

  const noPermissions = setup({ permissions: undefined })
  noPermissions.engine.start('quiet')
  await settle()
  assert.equal(state(noPermissions.engine), 'allow', 'no permissions API: wait for a tap')
  assert.equal(noPermissions.nav.requests.length, 0)
})

test('stop: no listener, ports closed, statechange removed, access dropped', async () => {
  const pedal = fakeInput('p1', 'FS-1-WL'), keys = fakeInput('p2', 'Keystation')
  const { engine, states, access } = setup({ access: fakeAccess([pedal, keys]) })
  engine.start('ask')
  await settle()
  engine.stop()
  assert.deepEqual(engine.getSnapshot(), { state: 'off', devices: [] })
  assert.equal(listenerCount(access), 0)
  assert.deepEqual([pedal.closes, keys.closes, access.onstatechange], [1, 1, null])
  access.plug(fakeInput('p3', 'Late'))
  assert.equal(state(engine), 'off', 'nothing reacts after OFF')
  assert.equal(listenerCount(access), 0)
  assert.deepEqual(states, ['starting', 'connected', 'off'])
  engine.stop()
  assert.deepEqual(states, ['starting', 'connected', 'off'], 'stopping twice is harmless')
})

test('a late answer after OFF or a restart is ignored', async () => {
  const pedal = fakeInput('p1', 'FS-1-WL')
  const first = deferred()
  const { nav, engine, access } = setup({ access: fakeAccess([pedal]), request: () => first.promise })
  engine.start('ask')
  engine.stop()
  first.resolve(access)
  await settle()
  assert.equal(state(engine), 'off')
  assert.deepEqual([listenerCount(access), access.onstatechange, pedal.sets], [0, null, 0])

  // Restart while the first answer is still pending: only the newer answer is used.
  const slow = deferred(), fresh = fakeAccess([fakeInput('p2', 'Keystation')])
  nav.request = () => slow.promise
  engine.start('ask')
  nav.request = () => Promise.resolve(fresh)
  engine.start('ask')
  await settle()
  slow.resolve(access)
  await settle()
  assert.deepEqual(engine.getSnapshot(), { state: 'connected', devices: ['Keystation'] })
  assert.deepEqual([listenerCount(access), listenerCount(fresh)], [0, 1])

  const lateDenied = deferred()
  nav.request = () => lateDenied.promise
  engine.start('ask')
  engine.stop()
  lateDenied.reject(domError('NotAllowedError'))
  await settle()
  assert.equal(state(engine), 'off', 'a late denial after OFF changes nothing')

  const lateQuery = deferred()
  nav.permissions.query = () => lateQuery.promise
  nav.requests.length = 0
  engine.start('quiet')
  engine.stop()
  lateQuery.resolve({ state: 'granted' })
  await settle()
  assert.deepEqual([state(engine), nav.requests.length], ['off', 0])
})

test('starting again never leaves a second listener or a second statechange handler', async () => {
  const pedal = fakeInput('p1', 'FS-1-WL')
  const { engine, access } = setup({ access: fakeAccess([pedal]) })
  for (let i = 0; i < 4; i++) { engine.start('ask'); await settle() }
  assert.deepEqual([listenerCount(access), pedal.sets, pedal.closes], [1, 4, 3], 'each restart detaches before it attaches')
  engine.stop()
  engine.start('ask')
  await settle()
  assert.equal(listenerCount(access), 1)
})

test('a statechange callback that throws sets Error and detaches', async () => {
  const pedal = fakeInput('p1', 'FS-1-WL')
  const { engine, states, access } = setup({ access: fakeAccess([pedal]) })
  engine.start('ask')
  await settle()
  const handler = access.onstatechange
  access.inputs = { forEach() { throw new Error('broken port list') } }
  assert.doesNotThrow(() => handler({ port: pedal }))
  assert.deepEqual(engine.getSnapshot(), { state: 'error', devices: [] })
  assert.deepEqual([pedal.onmidimessage, pedal.closes, access.onstatechange], [null, 1, null])
  assert.deepEqual(states, ['starting', 'connected', 'error'])
  assert.doesNotThrow(() => handler({ port: pedal }), 'the old handler is dead')
  assert.equal(state(engine), 'error')

  // Off and on again recovers.
  access.inputs = new Map([[pedal.id, pedal]])
  engine.stop()
  engine.start('ask')
  await settle()
  assert.equal(state(engine), 'connected')
})

test('an error while attaching is Error, not a crash; a failing status subscriber does not break the engine', async () => {
  // A Stage handler that throws while a press is dispatched is covered in midiDispatch.test.cjs.
  const broken = fakeInput('p3', 'Broken')
  Object.defineProperty(broken, 'state', { get() { throw new Error('port getter') } })
  const attach = setup({ access: fakeAccess([broken]) })
  attach.engine.start('ask')
  await settle()
  assert.equal(state(attach.engine), 'error', 'an error while attaching is Error, not a crash')

  const loud = createMidiEngine({ navigator: fakeNavigator({ access: fakeAccess([fakeInput('p1', 'FS-1-WL')]) }), onChange: () => { throw new Error('subscriber') } })
  assert.doesNotThrow(() => loud.start('ask'))
  await settle()
  assert.equal(loud.getSnapshot().state, 'connected')
})

test('with nothing mapped a message goes nowhere, and a bad one is not an error', async () => {
  const pedal = fakeInput('p1', 'FS-1-WL')
  const { engine, states } = setup({ access: fakeAccess([pedal]) })
  engine.start('ask')
  await settle()
  for (const bytes of [[0x90, 60, 100], [0xb0, 64, 127], [0xc0, 5], [0xf8], []]) assert.doesNotThrow(() => pedal.send(bytes))
  assert.doesNotThrow(() => pedal.onmidimessage({ data: null }))
  assert.deepEqual(states, ['starting', 'connected'])
})

test('device names are plain text cut to 128 characters', async () => {
  const markup = '<img src=x onerror=alert(1)>'
  const long = `  ${markup}${'x'.repeat(300)}  `
  const ports = [fakeInput('p1', long), fakeInput('p2', markup), fakeInput('p3', ''), fakeInput('p4', '   '), fakeInput('p5', null), fakeInput('p6', { toString: () => 'object' })]
  const { engine } = setup({ access: fakeAccess(ports) })
  engine.start('ask')
  await settle()
  const { devices } = engine.getSnapshot()
  assert.equal(devices[0].length, 128)
  assert.equal(devices[0], long.trim().slice(0, 128))
  assert.equal(devices[1], markup, 'kept as the same characters; the UI shows it as text')
  assert.deepEqual(devices.slice(2), ['MIDI device', 'MIDI device', 'MIDI device', 'MIDI device'])
  for (const name of devices) assert.equal(typeof name, 'string')
})
