// #536 Slice 5: the saved device choice and channel filter applied in the engine, and the input
// monitor tap. Device by id with name and manufacturer as fallback, a missing device is waited
// for and never replaced, hot-plug, channel filter before Learn, play and the monitor, press
// state cleared on a device or channel change, settle on reconnect, another tab's changes, and
// a monitor that changes nothing about what fires. Fake MIDIAccess, fake clock, fake Stage.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)

// Just enough of a page for the settings store: one storage and one event target.
const stored = new Map()
global.localStorage = { getItem: key => (stored.has(key) ? stored.get(key) : null), setItem: (key, value) => { stored.set(key, String(value)) } }
global.window = new EventTarget()

const { createMidiEngine } = require('../src/midi/engine.ts')
const settings = require('../src/midi/settings.ts')
const { midiMonitorLabel, MIDI_MONITOR_LINES } = require('../src/midi/mapping.ts')
const { registerStageCommandRunner } = require('../src/utils/stageCommands.ts')
const { brief, fakeInput, fakeAccess, fakeNavigator, settle, listenerCount } = require('./helpers/fakeMidi.cjs')

const KEY = settings.MIDI_SETTINGS_KEY
const cc = (number, channel = 1) => ({ type: 'cc', channel, number })
const note = (number, channel = 1) => ({ type: 'note', channel, number })
const pc = (number, channel = 1) => ({ type: 'pc', channel, number })
const ccOn = (number = 64, channel = 1, value = 127) => [0xb0 + channel - 1, number, value]
const ccOff = (number = 64, channel = 1) => [0xb0 + channel - 1, number, 0]
const noteOn = (number = 60, channel = 1, velocity = 100) => [0x90 + channel - 1, number, velocity]
const noteOff = (number = 60, channel = 1) => [0x80 + channel - 1, number, 0]
const program = (number = 5, channel = 1) => [0xc0 + channel - 1, number]
const choice = (id, name, manufacturer = 'Fake') => ({ id, name, manufacturer })
const PEDAL = choice('p1', 'FS-1-WL'), KEYS = choice('p2', 'Keystation')

const write = change => settings.writeMidiSettings({ ...settings.readMidiSettings(), ...change })
/** A change made in another tab: the value is already stored and only a storage event arrives. */
const fromOtherTab = change => {
  stored.set(KEY, JSON.stringify({ ...settings.readMidiSettings(), ...change }))
  window.dispatchEvent(Object.assign(new Event('storage'), { key: KEY }))
}

/** A started engine on a fake clock, past the settle time, with a fake Stage recording every command. */
async function started({ ports = [fakeInput('p1', 'FS-1-WL'), fakeInput('p2', 'Keystation')], device = 'all', channel = 'all', mappings = { nextSong: cc(64) } } = {}) {
  stored.clear()
  settings.writeMidiSettings({ version: 1, enabled: true, device, channel, mappings })
  const clock = { at: 50_000 }
  const fired = []
  const remove = registerStageCommandRunner(command => { fired.push(command); return true })
  const nav = fakeNavigator({ access: fakeAccess(ports) })
  const states = []
  const engine = createMidiEngine({ navigator: nav, now: () => clock.at, onChange: snapshot => states.push(snapshot.state) })
  engine.start('ask')
  await settle()
  clock.at += 500
  const tick = ms => { clock.at += ms }
  return { engine, access: nav.access, ports, fired, states, tick, close: () => { engine.stop(); remove() } }
}

test('default All devices: every input is listened to and listed for the choice, names cut as plain text', async () => {
  const long = fakeInput('p3', `  ${'x'.repeat(200)}  `, { manufacturer: 'm'.repeat(200) })
  const nameless = fakeInput('p4', undefined, { manufacturer: null })
  const { engine, access, ports, close } = await started({ ports: [fakeInput('p1', 'FS-1-WL'), fakeInput('p2', '<b>Keystation</b>'), long, nameless] })
  try {
    assert.equal(listenerCount(access), 4)
    assert.deepEqual(engine.getSnapshot().inputs, [PEDAL, choice('p2', '<b>Keystation</b>'), choice('p3', 'x'.repeat(128), 'm'.repeat(128)), choice('p4', '', '')])
    assert.deepEqual(engine.getSnapshot().devices, ['FS-1-WL', '<b>Keystation</b>', 'x'.repeat(128), 'MIDI device'])
    assert.equal(settings.MIDI_DEVICE_TEXT_MAX, 128)

    // A disconnected port is not listed.
    access.unplug(ports[1])
    assert.deepEqual(engine.getSnapshot().inputs.map(input => input.id), ['p1', 'p3', 'p4'])
  } finally { close() }
  assert.deepEqual(engine.getSnapshot(), { state: 'off', devices: [], inputs: [] })
})

test('a chosen device is found by id: only it is listened to, and only it fires', async () => {
  const { engine, access, ports: [pedal, keys], fired, tick, close } = await started({ device: KEYS })
  try {
    assert.deepEqual(brief(engine.getSnapshot()), { state: 'connected', devices: ['Keystation'] })
    assert.deepEqual(engine.getSnapshot().inputs, [PEDAL, KEYS], 'the other device stays listed for the choice')
    assert.deepEqual([pedal.onmidimessage, pedal.sets, keys.sets, listenerCount(access)], [null, 0, 1, 1])
    pedal.send(ccOn())
    assert.deepEqual(fired, [], 'the other device has no listener at all')
    keys.send(ccOn())
    assert.deepEqual(fired, ['nextSong'])
    tick(200)
    // The id wins even when name and manufacturer no longer match.
    assert.deepEqual(settings.findMidiDevice(choice('p2', 'Renamed', 'Other'), engine.getSnapshot().inputs), KEYS)
  } finally { close() }
})

test('fallback to name and manufacturer when the id changed; never a guess', async () => {
  const saved = choice('old-id', 'FS-1-WL')
  const fresh = fakeInput('new-id', 'FS-1-WL'), keys = fakeInput('p2', 'Keystation')
  const { engine, fired, close } = await started({ ports: [keys, fresh], device: saved })
  try {
    assert.deepEqual(brief(engine.getSnapshot()), { state: 'connected', devices: ['FS-1-WL'] })
    assert.deepEqual([fresh.sets, keys.sets], [1, 0])
    fresh.send(ccOn())
    assert.deepEqual(fired, ['nextSong'])
    assert.deepEqual(settings.readMidiSettings().device, saved, 'the engine never rewrites the saved choice')
  } finally { close() }

  const inputs = [choice('a', 'FS-1-WL'), choice('b', 'FS-1-WL'), choice('c', 'Keystation'), choice('d', 'Pad', 'Acme'), choice('e', '', 'Fake')]
  const find = saved => settings.findMidiDevice(saved, inputs)
  assert.equal(find(choice('gone', 'FS-1-WL')), null, 'two inputs look the same: none is picked')
  assert.deepEqual(find(choice('gone', 'Keystation')), inputs[2])
  assert.equal(find(choice('gone', 'Pad', 'Other maker')), null, 'the manufacturer must match too')
  assert.equal(find(choice('gone', 'Keystation', '')), null)
  assert.equal(find(choice('gone', '', 'Fake')), null, 'a device without a name is found by id only')
  assert.equal(find(choice('gone', 'Unknown')), null)
  assert.deepEqual(find(choice('b', 'whatever', 'whoever')), inputs[1])

  const twins = await started({ ports: [fakeInput('a', 'FS-1-WL'), fakeInput('b', 'FS-1-WL')], device: saved })
  try {
    assert.deepEqual(brief(twins.engine.getSnapshot()), { state: 'no-device', devices: [] })
    assert.equal(listenerCount(twins.access), 0)
  } finally { twins.close() }
})

test('chosen device missing: No device, nothing listened to, and no silent switch to another device', async () => {
  const pedal = fakeInput('p1', 'FS-1-WL')
  const { engine, access, fired, states, tick, close } = await started({ ports: [pedal], device: KEYS })
  try {
    assert.deepEqual(engine.getSnapshot(), { state: 'no-device', devices: [], inputs: [PEDAL] })
    assert.deepEqual([listenerCount(access), pedal.sets, typeof access.onstatechange], [0, 0, 'function'], 'waiting, with the other device untouched')
    pedal.send(ccOn())
    assert.deepEqual(fired, [])

    // Another device arriving changes nothing either.
    const pad = fakeInput('p3', 'Pad')
    access.plug(pad)
    assert.equal(engine.getSnapshot().state, 'no-device')
    assert.deepEqual([listenerCount(access), pad.sets], [0, 0])

    // Hot-plug of the chosen device: attached once, with the 500 ms settle.
    const keys = fakeInput('p2', 'Keystation')
    access.plug(keys)
    assert.deepEqual(brief(engine.getSnapshot()), { state: 'connected', devices: ['Keystation'] })
    assert.deepEqual([keys.sets, listenerCount(access)], [1, 1])
    tick(499)
    keys.send(noteOn(1)); keys.send(ccOn()); keys.send(ccOff())
    assert.deepEqual(fired, [], 'still settling')
    tick(1)
    keys.send(ccOn())
    assert.deepEqual(fired, ['nextSong'])

    // It goes away again: back to waiting, still not the pedal.
    access.unplug(keys)
    assert.deepEqual(brief(engine.getSnapshot()), { state: 'no-device', devices: [] })
    assert.deepEqual([keys.onmidimessage, listenerCount(access)], [null, 0])
    tick(1000)
    pedal.send(ccOn()); pad.send(ccOn())
    assert.deepEqual(fired, ['nextSong'])

    // Reconnect: one listener, settle again, repeated statechange adds nothing.
    access.plug(keys)
    for (let i = 0; i < 4; i++) access.onstatechange({ port: keys })
    assert.deepEqual([keys.sets, listenerCount(access)], [2, 1])
    keys.send(ccOff()); keys.send(ccOn())
    assert.deepEqual(fired, ['nextSong'], 'settle after the reconnect')
    tick(500)
    keys.send(ccOff()); keys.send(ccOn())
    assert.deepEqual(fired, ['nextSong', 'nextSong'])
    // The status is reported again when only the device list changed (the pad arriving).
    assert.deepEqual(states, ['starting', 'no-device', 'no-device', 'connected', 'no-device', 'connected'])
  } finally { close() }
})

test('reconnect under All devices: attached once, 500 ms settle', async () => {
  const { access, ports: [pedal], fired, tick, close } = await started()
  try {
    access.unplug(pedal)
    access.plug(pedal)
    assert.equal(pedal.sets, 2)
    tick(400)
    pedal.send(ccOn()); pedal.send(ccOff())
    assert.deepEqual(fired, [])
    tick(100)
    pedal.send(ccOn())
    assert.deepEqual(fired, ['nextSong'])
  } finally { close() }
})

test('device changed: all ports detached, the new choice attached, press state cleared, unused ports closed', async () => {
  const { engine, access, ports: [pedal, keys], fired, tick, close } = await started()
  try {
    keys.send(ccOn())
    assert.deepEqual(fired, ['nextSong'])
    keys.send(ccOn())
    assert.deepEqual(fired, ['nextSong'], 'held: no repeat')

    write({ device: KEYS })
    assert.deepEqual(brief(engine.getSnapshot()), { state: 'connected', devices: ['Keystation'] })
    assert.deepEqual([pedal.onmidimessage, pedal.closes, listenerCount(access)], [null, 1, 1], 'the port no longer chosen is released and closed')
    assert.deepEqual([keys.sets, keys.closes, keys.connection], [2, 0, 'open'], 'the chosen port was detached and attached again, never closed')
    tick(500)
    keys.send(ccOn())
    assert.deepEqual(fired, ['nextSong', 'nextSong'], 'press state was cleared: the control is not still held')
    pedal.send(ccOn())
    assert.equal(fired.length, 2)

    // Back to all devices: both listened to again, one listener each.
    tick(200)
    write({ device: 'all' })
    assert.deepEqual(brief(engine.getSnapshot()), { state: 'connected', devices: ['FS-1-WL', 'Keystation'] })
    assert.deepEqual([pedal.sets, keys.sets, keys.closes, listenerCount(access)], [2, 3, 0, 2])
    tick(500)
    pedal.send(ccOn())
    assert.equal(fired.length, 3)

    // To a device that is not there: everything detached, nothing attached.
    write({ device: choice('p9', 'Missing') })
    assert.deepEqual(brief(engine.getSnapshot()), { state: 'no-device', devices: [] })
    assert.deepEqual([listenerCount(access), pedal.closes, keys.closes], [0, 2, 1])
    assert.equal(typeof access.onstatechange, 'function')

    // A mapping change alone detaches nothing and keeps press state.
    write({ device: 'all' })
    tick(500)
    keys.send(ccOn())
    const sets = [pedal.sets, keys.sets]
    write({ mappings: { nextSong: cc(64), prevSong: cc(65) } })
    assert.deepEqual([pedal.sets, keys.sets], sets)
    keys.send(ccOn())
    assert.equal(fired.length, 4, 'still held')
  } finally { close() }
})

test('channel filter: every other channel is dropped before Learn, play and the monitor', async () => {
  const { engine, ports: [pedal], fired, tick, close } = await started({ channel: 2, mappings: { nextSong: cc(64, 1), prevSong: cc(64, 2), nextSection: note(60, 2), prevSection: pc(5, 3) } })
  try {
    const seen = []
    engine.monitor(entry => seen.push(midiMonitorLabel(entry)))
    for (const channel of [1, 3, 16]) { pedal.send(ccOn(64, channel)); pedal.send(noteOn(60, channel)); pedal.send(program(5, channel)); tick(200) }
    assert.deepEqual([fired, seen], [[], []], 'a pedal set to another channel does nothing, even where a mapping has that channel')

    pedal.send(ccOn(64, 2)); tick(200); pedal.send(noteOn(60, 2))
    assert.deepEqual(fired, ['prevSong', 'nextSection'], 'a mapping matches its own learned channel')
    assert.deepEqual(seen, ['CC 64 · value 127 · Ch 2 · FS-1-WL', 'Note 60 (C4) · Ch 2 · FS-1-WL'])

    // Learn: channel 1 is not captured and does not end Learn; channel 2 is.
    const learned = []
    engine.learn(input => learned.push(input))
    tick(200)
    pedal.send(noteOn(61, 1)); pedal.send(program(1, 5))
    assert.deepEqual(learned, [])
    pedal.send(noteOn(61, 2))
    assert.deepEqual(learned, [note(61, 2)])
    assert.equal(fired.length, 2)
  } finally { close() }

  // All channels: each mapping fires on its own channel only.
  const all = await started({ mappings: { nextSong: cc(64, 1), prevSong: cc(64, 2) } })
  try {
    all.ports[0].send(ccOn(64, 2)); all.tick(200); all.ports[0].send(ccOn(64, 1)); all.tick(200); all.ports[0].send(ccOn(64, 3))
    assert.deepEqual(all.fired, ['prevSong', 'nextSong'])
  } finally { all.close() }
})

test('channel changed: press state is cleared and no port is touched', async () => {
  const { access, ports: [pedal, keys], fired, close } = await started()
  try {
    pedal.send(ccOn())
    pedal.send(ccOn())
    assert.deepEqual(fired, ['nextSong'], 'held')
    write({ channel: 1 })
    assert.deepEqual([pedal.sets, keys.sets, pedal.closes, listenerCount(access)], [1, 1, 0, 2])
    pedal.send(ccOn())
    assert.deepEqual(fired, ['nextSong', 'nextSong'], 'held and debounce state were cleared')

    write({ channel: 5 })
    pedal.send(ccOff()); pedal.send(ccOn())
    assert.equal(fired.length, 2, 'channel 1 is now dropped')
    write({ channel: 'all' })
    pedal.send(ccOn())
    assert.equal(fired.length, 3)
  } finally { close() }
})

test('settings changed in another tab are followed: device, channel and back', async () => {
  const { engine, access, ports: [pedal, keys], fired, tick, close } = await started()
  try {
    fromOtherTab({ device: PEDAL })
    assert.deepEqual(brief(engine.getSnapshot()), { state: 'connected', devices: ['FS-1-WL'] })
    assert.deepEqual([keys.onmidimessage, listenerCount(access)], [null, 1])
    tick(500)
    keys.send(ccOn()); pedal.send(ccOn())
    assert.deepEqual(fired, ['nextSong'])

    fromOtherTab({ channel: 9 })
    tick(200)
    pedal.send(ccOff()); pedal.send(ccOn())
    assert.equal(fired.length, 1)
    pedal.send(ccOn(64, 9))
    assert.equal(fired.length, 1, 'channel 9 passes the filter but the mapping is for channel 1')

    fromOtherTab({ device: 'all', channel: 'all' })
    assert.equal(listenerCount(access), 2)
    tick(500)
    keys.send(ccOn())
    assert.equal(fired.length, 2)

    // After OFF nothing follows any more.
    engine.stop()
    fromOtherTab({ device: KEYS })
    assert.deepEqual([engine.getSnapshot().state, listenerCount(access)], ['off', 0])
  } finally { close() }
})

test('monitor: inputs that count, with the device name; nothing else; ends on cancel and on OFF', async () => {
  const { engine, ports: [pedal, keys], close } = await started({ mappings: {} })
  try {
    const seen = []
    const cancel = engine.monitor(entry => seen.push(entry))
    pedal.send(ccOn(64, 1, 127)); keys.send(noteOn(60)); pedal.send(program(5, 3)); pedal.send(ccOn(7, 2, 64))
    assert.deepEqual(seen, [
      { input: cc(64), value: 127, device: 'FS-1-WL' }, { input: note(60), value: 100, device: 'Keystation' },
      { input: pc(5, 3), value: 0, device: 'FS-1-WL' }, { input: cc(7, 2), value: 64, device: 'FS-1-WL' },
    ])
    assert.deepEqual(seen.map(midiMonitorLabel), ['CC 64 · value 127 · Ch 1 · FS-1-WL', 'Note 60 (C4) · Ch 1 · Keystation', 'Program 5 · Ch 3 · FS-1-WL', 'CC 7 · value 64 · Ch 2 · FS-1-WL'])
    assert.equal(MIDI_MONITOR_LINES, 5)

    // Clock, active sensing, start/stop, pitch bend, aftertouch, SysEx, channel mode, releases, malformed.
    for (const bytes of [[0xf8], [0xfe], [0xfa], [0xfc], [0xe0, 0, 64], [0xd0, 5], [0xa0, 60, 5], [0xf0, 1, 0xf7], ccOn(120), ccOn(123), ccOff(), ccOn(64, 1, 63), noteOff(), noteOn(60, 1, 0), [0x90, 60], [0x90, 200, 1]]) pedal.send(bytes)
    assert.equal(seen.length, 4, 'nothing that does not count is shown')

    cancel()
    pedal.send(noteOn(1))
    assert.equal(seen.length, 4, 'cancelled')

    engine.monitor(entry => seen.push(entry))
    engine.stop()
    pedal.send(noteOn(2))
    engine.start('ask')
    await settle()
    pedal.send(noteOn(3))
    assert.equal(seen.length, 4, 'MIDI off ends the monitor; turning it on again does not bring it back')
  } finally { close() }
})

test('monitoring changes nothing: dispatch and Learn are identical with it open, closed or failing, and nothing is stored', async () => {
  const mappings = { nextSong: cc(64), prevSong: note(60), nextSection: pc(5), scrollDown: cc(10, 2) }
  /** One fixed session: presses, holds, bounces, a burst, unmapped input, a Learn, another channel. */
  const session = async watch => {
    const { engine, ports: [pedal, keys], fired, tick, close } = await started({ mappings })
    const learned = []
    const before = stored.get(KEY)
    try {
      watch?.(engine)
      pedal.send(ccOn()); pedal.send(ccOn()); pedal.send(ccOff()); tick(50); pedal.send(ccOn()); pedal.send(ccOff())
      tick(200); keys.send(noteOn()); keys.send(noteOff()); tick(10); keys.send(noteOn())
      tick(200); pedal.send(program()); pedal.send(ccOn(10, 2)); pedal.send(ccOn(11)); pedal.send([0xf8])
      for (let i = 0; i < 12; i++) { tick(160); pedal.send(ccOff()); pedal.send(ccOn()) }
      engine.learn(input => learned.push(input))
      tick(2000); pedal.send(ccOff()); pedal.send(ccOn()); pedal.send(ccOn(10, 2))
      tick(2000); pedal.send(ccOff()); pedal.send(ccOn())
      assert.equal(stored.get(KEY), before, 'nothing is written by input or by the monitor')
      assert.deepEqual([...stored.keys()], [KEY])
      return { fired: [...fired], learned }
    } finally { close() }
  }
  const closed = await session(null)
  assert.ok(closed.fired.length > 8 && closed.fired.includes('scrollDown') && closed.learned.length === 1, 'the session really fires and learns')
  const seen = []
  const open = await session(engine => engine.monitor(entry => seen.push(entry)))
  const failing = await session(engine => engine.monitor(() => { throw new Error('monitor broke') }))
  const cancelled = await session(engine => engine.monitor(() => {})())
  assert.deepEqual(open, closed)
  assert.deepEqual(failing, closed, 'a failing monitor neither stops the engine nor changes what fires')
  assert.deepEqual(cancelled, closed)
  assert.ok(seen.length > closed.fired.length, 'the monitor saw the input, including presses the limits dropped')
})

test('static: the engine keeps no monitor history and nothing in MIDI stores, logs or sends monitor data', () => {
  const code = name => fs.readFileSync(`${__dirname}/../src/midi/${name}`, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')
  const engine = code('engine.ts')
  assert.equal(engine.match(/watcher\(/g).length, 1, 'one call: the entry is handed on, not kept')
  assert.doesNotMatch(engine, /localStorage|writeMidiSettings|sessionStorage|indexedDB/, 'the engine never writes')
  const dialog = code('MidiDialog.tsx')
  assert.doesNotMatch(dialog, /localStorage|sessionStorage|indexedDB|appLogger|console\./)
  assert.doesNotMatch(code('settings.ts'), /monitor/i, 'the stored shape has no monitor field')
})
