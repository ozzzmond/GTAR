// #536 Slice 1: MIDI byte parsing. Only note on/off, Control Change 0–119 and Program Change
// are read; everything else is dropped. Pure logic: no browser MIDI API, no real device.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)

const { parseMidiMessage, midiChannelAllows, MIDI_MAX_CC_NUMBER } = require('../src/midi/message.ts')
const bytes = (...values) => Uint8Array.from(values)

test('note on and note off on every channel', () => {
  for (let channel = 1; channel <= 16; channel++) {
    assert.deepEqual(parseMidiMessage(bytes(0x90 + channel - 1, 60, 100)), { type: 'noteOn', channel, number: 60, value: 100 })
    assert.deepEqual(parseMidiMessage(bytes(0x80 + channel - 1, 60, 64)), { type: 'noteOff', channel, number: 60, value: 64 })
  }
  assert.deepEqual(parseMidiMessage(bytes(0x90, 0, 1)), { type: 'noteOn', channel: 1, number: 0, value: 1 })
  assert.deepEqual(parseMidiMessage(bytes(0x9f, 127, 127)), { type: 'noteOn', channel: 16, number: 127, value: 127 })
  assert.deepEqual(parseMidiMessage(bytes(0x80, 127, 0)), { type: 'noteOff', channel: 1, number: 127, value: 0 })
})

test('note on with velocity 0 is a note off', () => {
  for (let channel = 1; channel <= 16; channel++) {
    assert.deepEqual(parseMidiMessage(bytes(0x90 + channel - 1, 72, 0)), { type: 'noteOff', channel, number: 72, value: 0 })
  }
})

test('control change 0–119 on every channel, any value', () => {
  assert.equal(MIDI_MAX_CC_NUMBER, 119)
  for (let channel = 1; channel <= 16; channel++) {
    assert.deepEqual(parseMidiMessage(bytes(0xb0 + channel - 1, 64, 127)), { type: 'cc', channel, number: 64, value: 127 })
  }
  for (let number = 0; number <= 119; number++) {
    assert.deepEqual(parseMidiMessage(bytes(0xb0, number, 0)), { type: 'cc', channel: 1, number, value: 0 })
    assert.deepEqual(parseMidiMessage(bytes(0xb0, number, 63)), { type: 'cc', channel: 1, number, value: 63 })
  }
})

test('control change 120–127 (channel mode) is dropped', () => {
  for (let number = 120; number <= 127; number++) {
    for (const value of [0, 64, 127]) assert.equal(parseMidiMessage(bytes(0xb0, number, value)), null, `CC ${number}`)
    assert.equal(parseMidiMessage(bytes(0xbf, number, 0)), null)
  }
})

test('program change on every channel', () => {
  for (let channel = 1; channel <= 16; channel++) {
    assert.deepEqual(parseMidiMessage(bytes(0xc0 + channel - 1, 5)), { type: 'pc', channel, number: 5, value: 0 })
  }
  assert.deepEqual(parseMidiMessage(bytes(0xc0, 0)), { type: 'pc', channel: 1, number: 0, value: 0 })
  assert.deepEqual(parseMidiMessage(bytes(0xcf, 127)), { type: 'pc', channel: 16, number: 127, value: 0 })
})

test('clock, real-time, SysEx and other system messages are dropped', () => {
  for (const status of [0xf8, 0xfa, 0xfb, 0xfc, 0xfe, 0xff, 0xf6]) assert.equal(parseMidiMessage(bytes(status)), null, `0x${status.toString(16)}`)
  assert.equal(parseMidiMessage(bytes(0xf0, 0x7e, 0xf7)), null, 'three-byte SysEx')
  assert.equal(parseMidiMessage(bytes(0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7)), null, 'longer SysEx')
  assert.equal(parseMidiMessage(bytes(0xf1, 0x00)), null, 'time code')
  assert.equal(parseMidiMessage(bytes(0xf2, 0x00, 0x00)), null, 'song position')
  assert.equal(parseMidiMessage(bytes(0xf3, 0x01)), null, 'song select')
})

test('aftertouch, channel pressure and pitch bend are dropped', () => {
  for (let channel = 0; channel < 16; channel++) {
    assert.equal(parseMidiMessage(bytes(0xa0 + channel, 60, 100)), null, 'poly aftertouch')
    assert.equal(parseMidiMessage(bytes(0xd0 + channel, 100)), null, 'channel pressure')
    assert.equal(parseMidiMessage(bytes(0xe0 + channel, 0, 64)), null, 'pitch bend')
  }
})

test('short and long messages are dropped', () => {
  assert.equal(parseMidiMessage(bytes()), null)
  assert.equal(parseMidiMessage(bytes(0x90)), null)
  assert.equal(parseMidiMessage(bytes(0x90, 60)), null, 'note on needs three bytes')
  assert.equal(parseMidiMessage(bytes(0x80, 60)), null, 'note off needs three bytes')
  assert.equal(parseMidiMessage(bytes(0xb0, 64)), null, 'control change needs three bytes')
  assert.equal(parseMidiMessage(bytes(0xc0)), null, 'program change needs two bytes')
  assert.equal(parseMidiMessage(bytes(0xc0, 5, 0)), null, 'program change is exactly two bytes')
  assert.equal(parseMidiMessage(bytes(0x90, 60, 100, 0)), null)
  assert.equal(parseMidiMessage(bytes(0x90, 60, 100, 0x90, 62, 100)), null, 'two messages in one event')
})

test('bad bytes are dropped', () => {
  assert.equal(parseMidiMessage(bytes(60, 100, 0)), null, 'no status byte (running status)')
  assert.equal(parseMidiMessage(bytes(0x7f, 60, 100)), null)
  assert.equal(parseMidiMessage(bytes(0x90, 0x80, 100)), null, 'data byte 1 over 127')
  assert.equal(parseMidiMessage(bytes(0x90, 60, 0x80)), null, 'data byte 2 over 127')
  assert.equal(parseMidiMessage(bytes(0xb0, 64, 0xff)), null)
  assert.equal(parseMidiMessage(bytes(0xc0, 0x80)), null)
  for (const data of [[0x90, 60.5, 100], [0x90, -1, 100], [0x90, 60, NaN], [0x90, 60, Infinity], [0x90, '60', 100],
    [0x90, null, 100], [0x90, undefined, 100], [0x190, 60, 100], [-0x70, 60, 100], ['144', 60, 100], [0x90, 60, 256], [0xc0, {}], [0xc0, [5]]]) {
    assert.equal(parseMidiMessage(data), null, JSON.stringify(data))
  }
})

test('anything that is not a byte list is dropped without throwing', () => {
  for (const data of [null, undefined, '', 'abc', 0, 144, true, {}, { 0: 0x90, 1: 60, 2: 100, length: 3 }, () => {},
    new Uint16Array([0x90, 60, 100]), new ArrayBuffer(3), new Map(), Symbol('x')]) {
    assert.doesNotThrow(() => parseMidiMessage(data))
    assert.equal(parseMidiMessage(data), null)
  }
  // A plain array of valid bytes is accepted (a fake device in tests), same as a Uint8Array.
  assert.deepEqual(parseMidiMessage([0x90, 60, 100]), { type: 'noteOn', channel: 1, number: 60, value: 100 })
})

test('every possible status byte: only four message kinds get through', () => {
  const kinds = new Map()
  for (let status = 0; status <= 255; status++) {
    for (const data of [bytes(status), bytes(status, 1), bytes(status, 1, 1)]) {
      const message = parseMidiMessage(data)
      if (message) kinds.set(status & 0xf0, message.type)
    }
  }
  assert.deepEqual([...kinds].sort((a, b) => a[0] - b[0]), [[0x80, 'noteOff'], [0x90, 'noteOn'], [0xb0, 'cc'], [0xc0, 'pc']])
})

test('channel filter: all, or exactly one channel', () => {
  for (let channel = 1; channel <= 16; channel++) {
    const message = parseMidiMessage(bytes(0xb0 + channel - 1, 64, 127))
    assert.equal(midiChannelAllows('all', message), true)
    for (let filter = 1; filter <= 16; filter++) assert.equal(midiChannelAllows(filter, message), filter === channel)
  }
})
