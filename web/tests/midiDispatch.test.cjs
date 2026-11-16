// #536 Slice 4: dispatch. The engine turns a new press of a mapped input into one Stage command,
// through stageCommands.run() and nothing else, inside the section 4 limits. Learn takes an input
// instead of Stage. Fake MIDIAccess, fake clock, fake Stage runner; no real device, no browser.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)

// Just enough of a page for the settings store: one storage and one event target.
const stored = new Map()
global.localStorage = { getItem: key => (stored.has(key) ? stored.get(key) : null), setItem: (key, value) => { stored.set(key, String(value)) } }
global.window = new EventTarget()

const { createMidiEngine } = require('../src/midi/engine.ts')
const settings = require('../src/midi/settings.ts')
const { STAGE_COMMANDS, registerStageCommandRunner } = require('../src/utils/stageCommands.ts')
const { fakeInput, fakeAccess, fakeNavigator, settle, listenerCount } = require('./helpers/fakeMidi.cjs')

const NINE = ['nextSong', 'prevSong', 'nextSection', 'prevSection', 'toggleAutoScroll', 'scrollUp', 'scrollDown', 'transposeUp', 'transposeDown']
const cc = (number, channel = 1) => ({ type: 'cc', channel, number })
const note = (number, channel = 1) => ({ type: 'note', channel, number })
const pc = (number, channel = 1) => ({ type: 'pc', channel, number })
const ccOn = (number = 64, channel = 1) => [0xb0 + channel - 1, number, 127]
const ccOff = (number = 64, channel = 1) => [0xb0 + channel - 1, number, 0]
const noteOn = (number = 60, channel = 1, velocity = 100) => [0x90 + channel - 1, number, velocity]
const program = (number = 5, channel = 1) => [0xc0 + channel - 1, number]

const save = mappings => settings.writeMidiSettings({ version: 1, enabled: true, device: 'all', channel: 'all', mappings })

/**
 * A connected engine on a fake clock, already past the settle time, with a fake Stage that
 * records every command it is given. `stage: false` means Stage is not on screen.
 */
async function connected(mappings, { ports = [fakeInput('p1', 'FS-1-WL')], stage = true, answer = true } = {}) {
  stored.clear()
  if (mappings) save(mappings)
  const clock = { at: 50_000 }
  const fired = []
  const remove = stage ? registerStageCommandRunner(command => { fired.push(command); return answer }) : () => {}
  const nav = fakeNavigator({ access: fakeAccess(ports) })
  const states = []
  const engine = createMidiEngine({ navigator: nav, now: () => clock.at, onChange: snapshot => states.push(snapshot.state) })
  engine.start('ask')
  await settle()
  assert.equal(engine.getSnapshot().state, 'connected')
  clock.at += 500
  const tick = ms => { clock.at += ms }
  return { engine, access: nav.access, pedal: ports[0], ports, fired, states, tick, close: () => { engine.stop(); remove() } }
}

test('a mapped Note On, Control Change and Program Change each fire their action once', async () => {
  const { pedal, fired, tick, close } = await connected({ nextSong: cc(64), prevSong: note(60), nextSection: pc(5) })
  try {
    pedal.send(ccOn(64))
    assert.deepEqual(fired, ['nextSong'])
    tick(200)
    pedal.send(noteOn(60))
    assert.deepEqual(fired, ['nextSong', 'prevSong'])
    tick(200)
    pedal.send(program(5))
    assert.deepEqual(fired, ['nextSong', 'prevSong', 'nextSection'])
  } finally { close() }
})

test('each of the nine actions is reached by its own input, and by nothing else', async () => {
  const mappings = Object.fromEntries(NINE.map((id, index) => [id, cc(20 + index)]))
  const { pedal, fired, tick, close } = await connected(mappings)
  try {
    assert.deepEqual([...STAGE_COMMANDS], NINE)
    for (const [index, id] of NINE.entries()) {
      tick(200)
      pedal.send(ccOn(20 + index))
      assert.equal(fired.at(-1), id)
      assert.equal(fired.length, index + 1, `${id}: one press, one command`)
    }
    tick(200)
    for (const unmapped of [ccOn(19), ccOn(29), ccOn(20, 2), noteOn(20), program(20)]) pedal.send(unmapped)
    assert.equal(fired.length, 9, 'an input that is not mapped does nothing')
    assert.ok(fired.every(command => NINE.includes(command)))
  } finally { close() }
})

test('nothing is mapped by default: a pedal does nothing until Learn, and transpose is never preset', async () => {
  const { pedal, fired, close } = await connected(null)
  try {
    assert.deepEqual(settings.readMidiSettings().mappings, {})
    for (let number = 0; number < 120; number++) { pedal.send(ccOn(number)); pedal.send(noteOn(number)); pedal.send(program(number)) }
    assert.deepEqual(fired, [])
  } finally { close() }
})

test('messages that do not count fire nothing', async () => {
  const { pedal, fired, engine, close } = await connected({ nextSong: cc(64), prevSong: note(60), nextSection: pc(5), scrollUp: cc(1) })
  try {
    const ignored = [
      [0x80, 60, 0], [0x80, 60, 64], // Note Off
      [0x90, 60, 0], // Note On with velocity 0
      [0xb0, 64, 0], [0xb0, 64, 63], // Control Change below 64
      [0xb0, 120, 127], [0xb0, 123, 0], [0xb0, 127, 127], // channel mode, e.g. All Notes Off
      [0xf8], [0xfa], [0xfc], [0xfe], [0xff], // clock, start, stop, active sensing, reset
      [0xe0, 0, 64], [0xa0, 60, 100], [0xd0, 100], // pitch bend, aftertouch, channel pressure
      [0xf0, 0x7e, 0x7f, 0xf7], // SysEx
      [], [0x90], [0x90, 60], [0xb0, 64], [0xc0], [0xc0, 5, 0], [0x40, 60, 100], [0x90, 200, 100], [0x90, 60, 128], [0xb0, 64, 127, 0], // malformed
    ]
    for (const bytes of ignored) pedal.send(bytes)
    for (const data of [null, undefined, 'text', [0xb0, 64, 127.5], { 0: 0xb0, 1: 64, 2: 127, length: 3 }]) pedal.onmidimessage({ data })
    assert.deepEqual(fired, [])
    assert.equal(engine.getSnapshot().state, 'connected', 'a bad message is dropped; it is not an error')
  } finally { close() }
})

test('one press, one step: releasing does nothing and holding never repeats', async () => {
  const { pedal, fired, tick, close } = await connected({ nextSong: cc(64), prevSong: note(60) })
  try {
    pedal.send(ccOn(64))
    for (let i = 0; i < 20; i++) { tick(500); pedal.send(ccOn(64)) }
    assert.deepEqual(fired, ['nextSong'], 'a held pedal that keeps reporting "down" fires once')
    pedal.send(ccOff(64))
    assert.deepEqual(fired, ['nextSong'], 'release fires nothing')
    tick(200)
    pedal.send(ccOn(64))
    assert.deepEqual(fired, ['nextSong', 'nextSong'], 'pressed again after coming back below 64')

    pedal.send(noteOn(60))
    tick(5000)
    pedal.send([0x80, 60, 0])
    assert.deepEqual(fired, ['nextSong', 'nextSong', 'prevSong'], 'a held note fires once; Note Off fires nothing')
  } finally { close() }
})

test('an expression pedal or knob fires once on the way up past 64, and again only after coming back below', async () => {
  const { pedal, fired, tick, close } = await connected({ scrollDown: cc(11) })
  try {
    for (const value of [0, 20, 63, 64, 90, 127, 100, 64]) { pedal.send([0xb0, 11, value]); tick(30) }
    assert.deepEqual(fired, ['scrollDown'])
    for (const value of [63, 10, 70]) { pedal.send([0xb0, 11, value]); tick(200) }
    assert.deepEqual(fired, ['scrollDown', 'scrollDown'])
  } finally { close() }
})

test('debounce: the same input is ignored for 150 ms after it fires', async () => {
  const { pedal, fired, tick, close } = await connected({ nextSong: note(60), prevSong: note(62) })
  try {
    pedal.send(noteOn(60))
    tick(149)
    pedal.send(noteOn(60))
    assert.deepEqual(fired, ['nextSong'], 'switch bounce or a double send')
    pedal.send(noteOn(62))
    assert.deepEqual(fired, ['nextSong', 'prevSong'], 'a different input is not held back')
    tick(1)
    pedal.send(noteOn(60))
    assert.deepEqual(fired, ['nextSong', 'prevSong', 'nextSong'], '150 ms')
  } finally { close() }
})

test('burst cap: at most 8 actions per second; extra presses are dropped, never queued', async () => {
  const mappings = Object.fromEntries(NINE.map((id, index) => [id, note(40 + index)]))
  const { pedal, fired, tick, close } = await connected(mappings)
  try {
    for (let round = 0; round < 3; round++) for (let index = 0; index < 9; index++) { pedal.send(noteOn(40 + index)); tick(10) }
    assert.equal(fired.length, 8)
    tick(5000)
    assert.equal(fired.length, 8, 'nothing was queued')
    pedal.send(noteOn(40))
    assert.equal(fired.length, 9, 'fires again once the second has passed')
  } finally { close() }
})

test('settle: a port is ignored for 500 ms after it connects, and again after it reconnects', async () => {
  stored.clear()
  save({ nextSong: cc(64), prevSong: note(60) })
  const clock = { at: 1000 }
  const fired = []
  const remove = registerStageCommandRunner(command => { fired.push(command); return true })
  const pedal = fakeInput('p1', 'FS-1-WL')
  const access = fakeAccess([pedal])
  const engine = createMidiEngine({ navigator: fakeNavigator({ access }), now: () => clock.at, onChange: () => {} })
  try {
    engine.start('ask')
    await settle()
    // A controller's power-up burst.
    for (const bytes of [ccOn(64), noteOn(60), program(1), ccOff(64)]) pedal.send(bytes)
    clock.at += 499
    pedal.send(noteOn(60))
    assert.deepEqual(fired, [], 'still settling')
    clock.at += 1
    pedal.send(noteOn(60))
    assert.deepEqual(fired, ['prevSong'], '500 ms')

    access.unplug(pedal)
    assert.equal(engine.getSnapshot().state, 'no-device')
    clock.at += 10_000
    access.plug(pedal)
    assert.equal(listenerCount(access), 1, 'attached once')
    pedal.send(ccOn(64))
    clock.at += 600
    assert.deepEqual(fired, ['prevSong'], 'the burst after a reconnect is ignored')
    pedal.send(ccOn(64))
    assert.deepEqual(fired, ['prevSong'], 'reported down during the burst: it must come back up first')
    pedal.send(ccOff(64))
    pedal.send(ccOn(64))
    assert.deepEqual(fired, ['prevSong', 'nextSong'], 'still one action per press after a reconnect')
  } finally { engine.stop(); remove() }
})

test('a mapping matches its own channel, on any listened device', async () => {
  const pedal = fakeInput('p1', 'FS-1-WL'), spare = fakeInput('p2', 'FS-1-WL spare')
  const { fired, tick, close } = await connected({ nextSong: cc(64, 3) }, { ports: [pedal, spare] })
  try {
    for (let channel = 1; channel <= 16; channel++) if (channel !== 3) pedal.send(ccOn(64, channel))
    assert.deepEqual(fired, [])
    pedal.send(ccOn(64, 3))
    assert.deepEqual(fired, ['nextSong'])
    tick(200)
    spare.send(ccOn(64, 3))
    assert.deepEqual(fired, ['nextSong', 'nextSong'], 'a spare pedal of the same kind works without relearning')
  } finally { close() }
})

test('Learn, Clear and Reset saved by the dialog take effect at once, with no restart and no new listener', async () => {
  const { pedal, access, fired, tick, close } = await connected({ nextSong: cc(64) })
  try {
    pedal.send(ccOn(64)); pedal.send(ccOff(64)); tick(200)
    assert.deepEqual(fired, ['nextSong'])

    save({ prevSong: cc(64), scrollUp: note(60) })
    pedal.send(ccOn(64)); pedal.send(ccOff(64)); tick(200)
    pedal.send(noteOn(60)); tick(200)
    assert.deepEqual(fired, ['nextSong', 'prevSong', 'scrollUp'], 'a replaced mapping moves to the other action')

    save({ scrollUp: note(60) })
    pedal.send(ccOn(64)); pedal.send(ccOff(64)); tick(200)
    assert.equal(fired.length, 3, 'a cleared input does nothing')

    save({})
    pedal.send(noteOn(60))
    assert.equal(fired.length, 3, 'after Reset nothing fires')
    assert.deepEqual([listenerCount(access), pedal.sets], [1, 1])
  } finally { close() }
})

test('stored junk never reaches Stage: only a valid mapping for one of the nine actions can fire', async () => {
  stored.clear()
  stored.set(settings.MIDI_SETTINGS_KEY, JSON.stringify({ version: 1, enabled: true, device: 'all', channel: 'all', mappings: {
    deleteSong: cc(1), exitStage: cc(2), fullscreen: cc(3), constructor: cc(4), __proto__: cc(5), toString: cc(6), NextSong: cc(7),
    nextSong: { type: 'cc', channel: 1, number: 125 }, prevSong: { type: 'sysex', channel: 1, number: 9 }, scrollUp: cc(10), scrollDown: cc(10),
  } }))
  const calls = []
  const remove = registerStageCommandRunner(command => { calls.push(command); return true })
  const pedal = fakeInput('p1', 'FS-1-WL')
  const clock = { at: 0 }
  const engine = createMidiEngine({ navigator: fakeNavigator({ access: fakeAccess([pedal]) }), now: () => clock.at, onChange: () => {} })
  try {
    engine.start('ask')
    await settle()
    clock.at += 500
    for (let number = 0; number < 120; number++) { pedal.send(ccOn(number)); clock.at += 200 }
    assert.deepEqual(calls, ['scrollUp'], 'one input, one action: the first in allowlist order keeps a doubled input')
  } finally { engine.stop(); remove() }
})

test('Stage not on screen, or a Stage guard saying no: the press is dropped and MIDI stays connected', async () => {
  const none = await connected({ nextSong: cc(64) }, { stage: false })
  try {
    assert.doesNotThrow(() => none.pedal.send(ccOn(64)))
    assert.equal(none.engine.getSnapshot().state, 'connected')
  } finally { none.close() }

  // An open dialog, a drawer or a Band Sync follower: the runner answers false.
  const blocked = await connected({ nextSong: cc(64) }, { answer: false })
  try {
    blocked.pedal.send(ccOn(64))
    assert.deepEqual(blocked.fired, ['nextSong'], 'the guard is asked')
    assert.equal(blocked.engine.getSnapshot().state, 'connected')
    blocked.tick(5000)
    assert.equal(blocked.fired.length, 1, 'a blocked press is never retried or queued')
  } finally { blocked.close() }
})

test('switch OFF: nothing fires afterwards, not even through a listener from before', async () => {
  const { engine, pedal, access, fired, tick, close } = await connected({ nextSong: cc(64) })
  try {
    const stale = pedal.onmidimessage
    engine.stop()
    assert.deepEqual([listenerCount(access), access.onstatechange], [0, null])
    pedal.send(ccOn(64))
    stale({ data: Uint8Array.from(ccOn(64)) })
    assert.deepEqual(fired, [])

    // Off clears press and debounce state: on again starts clean, with a new settle time.
    engine.start('ask')
    await settle()
    pedal.send(noteOn(1))
    tick(500)
    pedal.send(ccOn(64))
    assert.deepEqual(fired, ['nextSong'])
    assert.equal(listenerCount(access), 1)
  } finally { close() }
})

test('a settings change after OFF is not followed: the engine keeps no subscription while off', async () => {
  const { engine, pedal, fired, tick, close } = await connected({ nextSong: cc(64) })
  try {
    let subscribed = 0
    const add = window.addEventListener.bind(window), drop = window.removeEventListener.bind(window)
    window.addEventListener = (...args) => { subscribed++; add(...args) }
    window.removeEventListener = (...args) => { subscribed--; drop(...args) }
    try {
      engine.stop()
      assert.equal(subscribed, -2, 'off drops both listeners of the settings subscription')
      subscribed = 0
      engine.start('ask')
      await settle()
      const whileOn = subscribed
      assert.ok(whileOn > 0, 'follows settings while on')
      engine.start('ask')
      await settle()
      assert.equal(subscribed, whileOn, 'a restart does not add a second subscription')
      engine.stop()
      assert.equal(subscribed, 0)
    } finally { window.addEventListener = add; window.removeEventListener = drop }
    tick(500)
    pedal.send(ccOn(64))
    assert.deepEqual(fired, [])
  } finally { close() }
})

test('a Stage handler that throws sets Error and detaches; off and on again recovers', async () => {
  stored.clear()
  save({ nextSong: cc(64), prevSong: note(60) })
  const calls = []
  const remove = registerStageCommandRunner(command => { calls.push(command); if (command === 'prevSong') throw new Error('stage handler'); return true })
  const pedal = fakeInput('p1', 'FS-1-WL'), keys = fakeInput('p2', 'Keystation')
  const access = fakeAccess([pedal, keys])
  const clock = { at: 0 }
  const engine = createMidiEngine({ navigator: fakeNavigator({ access }), now: () => clock.at, onChange: () => {} })
  try {
    engine.start('ask')
    await settle()
    clock.at += 500
    const stale = pedal.onmidimessage
    pedal.send(ccOn(64))
    assert.deepEqual(calls, ['nextSong'])
    assert.doesNotThrow(() => keys.send(noteOn(60)))
    assert.equal(engine.getSnapshot().state, 'error')
    assert.deepEqual([listenerCount(access), access.onstatechange, pedal.closes, keys.closes], [0, null, 1, 1])
    clock.at += 1000
    stale({ data: Uint8Array.from(ccOn(64)) })
    assert.equal(calls.length, 2, 'a listener from the failed run delivers nothing')

    engine.stop()
    engine.start('ask')
    await settle()
    clock.at += 500
    pedal.send(ccOff(64)); pedal.send(ccOn(64))
    assert.equal(calls.at(-1), 'nextSong')
    assert.equal(engine.getSnapshot().state, 'connected')
  } finally { engine.stop(); remove() }
})

test('Learn takes the first input that counts, once, and it never reaches Stage', async () => {
  const { engine, pedal, fired, tick, close } = await connected({ nextSong: cc(64) })
  try {
    const learned = []
    engine.learn(input => learned.push(input))
    for (const bytes of [[0x80, 60, 0], [0x90, 60, 0], [0xb0, 64, 63], [0xb0, 121, 127], [0xf8], [0xe0, 0, 64], [0x90, 60]]) pedal.send(bytes)
    assert.deepEqual(learned, [], 'Note Off, velocity 0, CC below 64, channel mode, clock, pitch bend and malformed are not captured')
    pedal.send(ccOn(64))
    assert.deepEqual(learned, [cc(64)], 'type, channel and number only: no value')
    assert.deepEqual(Object.keys(learned[0]).sort(), ['channel', 'number', 'type'])
    assert.deepEqual(fired, [], 'the learned press does not also fire its old action')

    tick(1000)
    pedal.send(noteOn(60))
    assert.equal(learned.length, 1, 'Learn ended on capture')
    pedal.send(ccOn(64))
    assert.deepEqual(fired, [], 'the pedal is still down from Learn: not a new press')
    pedal.send(ccOff(64)); pedal.send(ccOn(64))
    assert.deepEqual(fired, ['nextSong'], 'play continues after Learn')
  } finally { close() }
})

test('Learn captures a note with its channel, a program change, and a mapped input alike', async () => {
  const { engine, pedal, tick, fired, close } = await connected({ nextSong: note(60, 10) })
  try {
    for (const [bytes, expected] of [[noteOn(60, 10, 1), note(60, 10)], [program(5, 16), pc(5, 16)], [[0xb0, 119, 64], cc(119)], [noteOn(127), note(127)], [program(0), pc(0)]]) {
      const learned = []
      engine.learn(input => learned.push(input))
      pedal.send(bytes)
      assert.deepEqual(learned, [expected])
      tick(200)
    }
    assert.deepEqual(fired, [])
  } finally { close() }
})

test('Learn ends on Cancel, on MIDI off and on a restart; a second Learn replaces the first', async () => {
  const { engine, pedal, fired, tick, close } = await connected({ nextSong: cc(64) })
  try {
    const first = [], second = []
    const cancelFirst = engine.learn(input => first.push(input))
    const cancelSecond = engine.learn(input => second.push(input))
    cancelFirst() // stale: must not cancel the Learn that replaced it
    pedal.send(noteOn(60))
    assert.deepEqual([first.length, second.length], [0, 1], 'one action learns at a time')

    const cancelled = []
    const cancel = engine.learn(input => cancelled.push(input))
    cancel()
    tick(200)
    pedal.send(ccOn(64))
    assert.deepEqual(cancelled, [])
    assert.deepEqual(fired, ['nextSong'], 'after Cancel the pedal plays again')
    cancelSecond()

    const off = []
    engine.learn(input => off.push(input))
    engine.stop()
    pedal.send(noteOn(61))
    engine.start('ask')
    await settle()
    tick(500)
    pedal.send(noteOn(61))
    assert.deepEqual(off, [], 'MIDI off cancels Learn; on again does not resume it')

    engine.learn(input => off.push(input))
    engine.start('ask')
    await settle()
    tick(500)
    pedal.send(noteOn(61))
    assert.deepEqual(off, [], 'a restart cancels Learn')
  } finally { close() }
})

test('Learn ignores a port that is still settling', async () => {
  const { engine, access, pedal, tick, close } = await connected({})
  try {
    const learned = []
    engine.learn(input => learned.push(input))
    const late = fakeInput('p2', 'Just powered on')
    access.plug(late)
    for (const bytes of [ccOn(7), noteOn(1), program(3)]) late.send(bytes)
    assert.deepEqual(learned, [], 'a power-up burst is not learned')
    tick(500)
    pedal.send(program(9))
    assert.deepEqual(learned, [pc(9)])
  } finally { close() }
})

test('source: the engine reaches Stage through stageCommands.run only, and sends nothing anywhere else', () => {
  const engine = fs.readFileSync(path.join(__dirname, '../src/midi/engine.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')
  assert.equal(engine.match(/stageCommands\.\w+/g).join(), 'stageCommands.run', 'one call, to run()')
  assert.match(engine, /const action = findMidiAction\(mappings, pressed\)\s+if \(action && limits\.allow\(pressed\)\) stageCommands\.run\(action\)/)
  assert.doesNotMatch(engine, /registerStageCommandRunner|StageView|document\.|dispatchEvent|KeyboardEvent|localStorage|writeMidiSettings|setItem/)
  assert.doesNotMatch(engine, /appLogger|console\.|fetch\(|sendBeacon|\.send\(|sysex/i)
})
