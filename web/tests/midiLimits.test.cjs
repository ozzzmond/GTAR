// #536 Slice 1: press detection and rate limits, on a fake clock with no real device.
// CC fires once per press and re-arms below 64; note-off ignored; 150 ms debounce;
// 8 per second cap; 500 ms settle; no repeat on hold.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)

const limitsModule = require('../src/midi/limits.ts')
const { createMidiLimits } = limitsModule
const { parseMidiMessage } = require('../src/midi/message.ts')
const { findMidiAction } = require('../src/midi/mapping.ts')

const message = (...bytes) => parseMidiMessage(Uint8Array.from(bytes))
const ccMsg = (value, number = 64, channel = 1) => message(0xb0 + channel - 1, number, value)
const noteOn = (number = 60, velocity = 100, channel = 1) => message(0x90 + channel - 1, number, velocity)
const noteOff = (number = 60, channel = 1) => message(0x80 + channel - 1, number, 0)
const program = (number = 5, channel = 1) => message(0xc0 + channel - 1, number)
const CC64 = { type: 'cc', channel: 1, number: 64 }
const NOTE60 = { type: 'note', channel: 1, number: 60 }

function fake(options = {}) {
  const clock = { at: 10_000 }
  const limits = createMidiLimits({ now: () => clock.at, ...options })
  return { clock, limits, tick: ms => { clock.at += ms } }
}
/** The whole pipeline a later engine runs for one message: press → lookup → limits. */
function dispatcher(mappings, options) {
  const { clock, limits, tick } = fake(options)
  const fired = []
  const send = (msg, port = 'port-1') => {
    const input = limits.press(port, msg)
    const action = input && findMidiAction(mappings, input)
    if (action && limits.allow(input)) fired.push(action)
  }
  return { clock, limits, tick, send, fired }
}

test('starting values match the design', () => {
  assert.equal(limitsModule.MIDI_DEBOUNCE_MS, 150)
  assert.equal(limitsModule.MIDI_BURST_LIMIT, 8)
  assert.equal(limitsModule.MIDI_BURST_WINDOW_MS, 1000)
  assert.equal(limitsModule.MIDI_SETTLE_MS, 500)
})

test('CC fires once when it rises to 64 or more, and re-arms below 64', () => {
  const { limits } = fake()
  assert.equal(limits.press('p', ccMsg(0)), null)
  assert.equal(limits.press('p', ccMsg(63)), null, '63 is not a press')
  assert.deepEqual(limits.press('p', ccMsg(64)), CC64, '64 is a press')
  assert.equal(limits.press('p', ccMsg(127)), null, 'still down: no second press')
  assert.equal(limits.press('p', ccMsg(64)), null)
  assert.equal(limits.press('p', ccMsg(63)), null, 'release fires nothing')
  assert.deepEqual(limits.press('p', ccMsg(127)), CC64, 're-armed after dropping below 64')
  assert.equal(limits.press('p', ccMsg(0)), null)
  assert.deepEqual(limits.press('p', ccMsg(100)), CC64)
})

test('expression pedal or knob: one press on the way up, none while it stays up or comes down', () => {
  const { limits } = fake()
  const sweepUp = Array.from({ length: 128 }, (_, value) => limits.press('p', ccMsg(value)))
  assert.deepEqual(sweepUp.filter(Boolean), [CC64])
  assert.equal(sweepUp.findIndex(Boolean), 64)
  const sweepDown = Array.from({ length: 128 }, (_, index) => limits.press('p', ccMsg(127 - index)))
  assert.deepEqual(sweepDown.filter(Boolean), [], 'nothing on the way down')
  // Jitter around the top never repeats; jitter across 64 presses each time it rises.
  assert.deepEqual([70, 90, 64, 127, 65].map(value => limits.press('p', ccMsg(value))).filter(Boolean), [CC64])
})

test('CC press state is per control, per channel and per port', () => {
  const { limits } = fake()
  assert.deepEqual(limits.press('a', ccMsg(127, 64, 1)), CC64)
  assert.deepEqual(limits.press('a', ccMsg(127, 65, 1)), { type: 'cc', channel: 1, number: 65 }, 'another control')
  assert.deepEqual(limits.press('a', ccMsg(127, 64, 2)), { type: 'cc', channel: 2, number: 64 }, 'another channel')
  assert.deepEqual(limits.press('b', ccMsg(127, 64, 1)), CC64, 'another port')
  assert.equal(limits.press('a', ccMsg(127, 64, 1)), null)
  assert.equal(limits.press('a', ccMsg(0, 65, 1)), null, 'releasing one control…')
  assert.equal(limits.press('a', ccMsg(127, 64, 1)), null, '…does not re-arm another')
})

test('note on is a press; note off and velocity 0 are ignored; program change is a press per message', () => {
  const { limits } = fake()
  assert.deepEqual(limits.press('p', noteOn(60, 1)), NOTE60)
  assert.equal(limits.press('p', noteOff(60)), null)
  assert.equal(limits.press('p', noteOn(60, 0)), null, 'note on with velocity 0 is a note off')
  assert.deepEqual(limits.press('p', noteOn(60, 127)), NOTE60)
  assert.deepEqual(limits.press('p', noteOn(61, 5, 16)), { type: 'note', channel: 16, number: 61 })
  assert.deepEqual(limits.press('p', program(5)), { type: 'pc', channel: 1, number: 5 })
  assert.deepEqual(limits.press('p', program(5)), { type: 'pc', channel: 1, number: 5 })
  assert.deepEqual(Object.keys(limits.press('p', noteOn(60, 99))).sort(), ['channel', 'number', 'type'], 'no velocity in the input')
})

test('no repeat on hold: time passing with the pedal down never fires again', () => {
  const pipeline = dispatcher({ nextSection: CC64, scrollDown: NOTE60 })
  pipeline.send(ccMsg(127))
  pipeline.send(noteOn(60))
  for (let second = 0; second < 30; second++) {
    pipeline.tick(1000)
    pipeline.send(ccMsg(127)) // some pedals resend their position while held
  }
  assert.deepEqual(pipeline.fired, ['nextSection', 'scrollDown'])
  pipeline.send(ccMsg(0))
  pipeline.send(noteOff(60))
  assert.deepEqual(pipeline.fired, ['nextSection', 'scrollDown'], 'release does nothing')
})

test('debounce: the same input is ignored for 150 ms after it fires', () => {
  const { limits, tick } = fake()
  assert.equal(limits.allow(NOTE60), true)
  assert.equal(limits.allow(NOTE60), false, 'same instant')
  tick(149)
  assert.equal(limits.allow(NOTE60), false, '149 ms')
  tick(1)
  assert.equal(limits.allow(NOTE60), true, '150 ms')
  // Dropped presses do not extend the window: it is measured from the last press that fired.
  tick(100)
  assert.equal(limits.allow(NOTE60), false)
  tick(49)
  assert.equal(limits.allow(NOTE60), false)
  tick(1)
  assert.equal(limits.allow(NOTE60), true)
})

test('debounce is per input: a different input fires right away', () => {
  const { limits } = fake()
  assert.equal(limits.allow(NOTE60), true)
  assert.equal(limits.allow({ type: 'note', channel: 1, number: 61 }), true, 'another note')
  assert.equal(limits.allow({ type: 'note', channel: 2, number: 60 }), true, 'another channel')
  assert.equal(limits.allow({ type: 'cc', channel: 1, number: 60 }), true, 'another type')
  assert.equal(limits.allow({ type: 'pc', channel: 1, number: 60 }), true)
  assert.equal(limits.allow(NOTE60), false)
})

test('switch bounce and double sends fire one action', () => {
  const pipeline = dispatcher({ nextSong: CC64, prevSong: NOTE60, toggleAutoScroll: { type: 'pc', channel: 1, number: 5 } })
  for (const value of [127, 0, 127, 0, 127]) { pipeline.send(ccMsg(value)); pipeline.tick(5) }
  pipeline.send(noteOn(60)); pipeline.send(noteOn(60)); pipeline.tick(20); pipeline.send(noteOn(60))
  pipeline.send(program(5)); pipeline.send(program(5))
  assert.deepEqual(pipeline.fired, ['nextSong', 'prevSong', 'toggleAutoScroll'])
  pipeline.tick(150)
  pipeline.send(ccMsg(0)); pipeline.send(ccMsg(127)); pipeline.send(noteOn(60)); pipeline.send(program(5))
  assert.deepEqual(pipeline.fired.slice(3), ['nextSong', 'prevSong', 'toggleAutoScroll'], 'a real second press after 150 ms fires')
})

test('burst cap: at most 8 actions per second across all inputs; extras are dropped, never queued', () => {
  const { limits, tick } = fake()
  const input = number => ({ type: 'note', channel: 1, number })
  const results = Array.from({ length: 20 }, (_, number) => limits.allow(input(number)))
  assert.deepEqual(results, [...Array(8).fill(true), ...Array(12).fill(false)])
  tick(999)
  assert.equal(limits.allow(input(30)), false, 'still inside the one-second window')
  tick(1)
  // The window slid past all eight: exactly eight more are allowed, and none of the twelve dropped ones come back.
  const next = Array.from({ length: 12 }, (_, number) => limits.allow(input(40 + number)))
  assert.deepEqual(next, [...Array(8).fill(true), ...Array(4).fill(false)])
})

test('burst cap is a sliding window', () => {
  const { limits, tick } = fake()
  const input = number => ({ type: 'cc', channel: 1, number })
  for (let number = 0; number < 8; number++) { assert.equal(limits.allow(input(number)), true); tick(100) } // fires at 0…700 ms
  assert.equal(limits.allow(input(50)), false, '800 ms: eight fires in the last second')
  tick(200)
  assert.equal(limits.allow(input(51)), true, '1000 ms: the first fire has left the window')
  assert.equal(limits.allow(input(52)), false, 'and the window is full again')
  tick(100)
  assert.equal(limits.allow(input(53)), true, '1100 ms: the second fire has left')
})

test('a dropped press neither fires later nor starts a debounce', () => {
  const { limits, tick } = fake()
  for (let number = 0; number < 8; number++) limits.allow({ type: 'note', channel: 1, number })
  assert.equal(limits.allow({ type: 'note', channel: 1, number: 60 }), false, 'over the cap')
  tick(1000)
  assert.equal(limits.allow({ type: 'note', channel: 1, number: 60 }), true, 'not debounced by the dropped press')
})

test('only mapped presses count against the burst cap', () => {
  const pipeline = dispatcher({ nextSection: CC64 })
  for (let number = 0; number < 40; number++) pipeline.send(noteOn(number)) // a keyboard part, not mapped
  pipeline.send(ccMsg(127))
  assert.deepEqual(pipeline.fired, ['nextSection'])
})

test('settle: nothing fires for 500 ms after a port connects', () => {
  const { limits, tick } = fake()
  limits.portConnected('p')
  assert.equal(limits.press('p', noteOn(60)), null)
  assert.equal(limits.press('p', program(5)), null)
  assert.equal(limits.press('p', ccMsg(127, 10)), null)
  tick(499)
  assert.equal(limits.press('p', noteOn(60)), null, '499 ms')
  tick(1)
  assert.deepEqual(limits.press('p', noteOn(60)), NOTE60, '500 ms')
  assert.deepEqual(limits.press('p', program(5)), { type: 'pc', channel: 1, number: 5 })
})

test('settling() says whether a port is still inside its settle time (Learn skips such a port)', () => {
  const { limits, tick } = fake()
  assert.equal(limits.settling('p'), false, 'a port that never connected here is not settling')
  limits.portConnected('p')
  assert.equal(limits.settling('p'), true)
  assert.equal(limits.settling('other'), false, 'per port')
  tick(499)
  assert.equal(limits.settling('p'), true)
  tick(1)
  assert.equal(limits.settling('p'), false)
  limits.portConnected('p')
  assert.equal(limits.settling('p'), true, 'a reconnect starts it again')
  limits.portDisconnected('p')
  assert.equal(limits.settling('p'), false)
  limits.portConnected('p')
  limits.reset()
  assert.equal(limits.settling('p'), false)
})

test('settle: a control reported down at power-up must come back up before it can fire', () => {
  const { limits, tick } = fake()
  limits.portConnected('p')
  assert.equal(limits.press('p', ccMsg(127)), null, 'power-up burst')
  tick(600)
  assert.equal(limits.press('p', ccMsg(127)), null, 'still down after the settle time: not a new press')
  assert.equal(limits.press('p', ccMsg(0)), null)
  assert.deepEqual(limits.press('p', ccMsg(127)), CC64, 'a real press')
})

test('settle is per port, and a reconnect starts it again', () => {
  const { limits, tick } = fake()
  limits.portConnected('a')
  tick(400)
  limits.portConnected('b')
  tick(100)
  assert.deepEqual(limits.press('a', noteOn(60)), NOTE60, 'a has settled')
  assert.equal(limits.press('b', noteOn(60)), null, 'b has not')
  assert.deepEqual(limits.press('never-announced', noteOn(60)), NOTE60, 'a port with no settle time is not blocked')
  tick(400)
  assert.deepEqual(limits.press('b', noteOn(60)), NOTE60)
  limits.portDisconnected('a')
  limits.portConnected('a')
  assert.equal(limits.press('a', noteOn(60)), null, 'reconnect: settle again')
  tick(500)
  assert.deepEqual(limits.press('a', noteOn(60)), NOTE60)
})

test('disconnect clears that port\'s press state only', () => {
  const { limits, tick } = fake()
  limits.press('a', ccMsg(127))
  limits.press('b', ccMsg(127))
  limits.portDisconnected('a')
  assert.deepEqual(limits.press('a', ccMsg(127)), CC64, 'a starts clean')
  assert.equal(limits.press('b', ccMsg(127)), null, 'b still held')
  limits.portConnected('b')
  tick(500)
  assert.deepEqual(limits.press('b', ccMsg(127)), CC64, 'connect also starts clean')
})

test('reset clears press, debounce, burst and settle state', () => {
  const { limits } = fake()
  limits.portConnected('p')
  limits.press('q', ccMsg(127))
  for (let number = 0; number < 8; number++) limits.allow({ type: 'note', channel: 1, number })
  assert.equal(limits.allow(CC64), false)
  limits.reset()
  assert.deepEqual(limits.press('p', noteOn(60)), NOTE60, 'no settle time left')
  assert.deepEqual(limits.press('q', ccMsg(127)), CC64, 'no held control left')
  assert.equal(limits.allow({ type: 'note', channel: 1, number: 0 }), true, 'no debounce and no burst history left')
})

test('two limiters share nothing, and limits can be tuned per instance', () => {
  const first = fake()
  const second = fake({ debounceMs: 10, burstLimit: 2, burstWindowMs: 100, settleMs: 50 })
  first.limits.allow(NOTE60)
  assert.equal(second.limits.allow(NOTE60), true)
  second.tick(10)
  assert.equal(second.limits.allow(NOTE60), true)
  second.tick(10)
  assert.equal(second.limits.allow(NOTE60), false, 'burst limit 2')
  second.tick(80)
  assert.equal(second.limits.allow(NOTE60), true)
  second.limits.portConnected('p')
  second.tick(50)
  assert.deepEqual(second.limits.press('p', noteOn(60)), NOTE60)
  // Default clock: usable without options.
  const real = createMidiLimits()
  assert.equal(real.allow(NOTE60), true)
  assert.equal(real.allow(NOTE60), false)
})
