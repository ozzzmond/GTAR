// #536 Slice 1: MIDI mapping schema v1. Lookup by type/channel/number; one input one action;
// Replace moves a mapping; Clear and Reset. Pure logic, no device.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)

const mapping = require('../src/midi/mapping.ts')
const { parseMidiMessage } = require('../src/midi/message.ts')
const { MIDI_ACTION_IDS } = require('../src/midi/actions.ts')

const note = (number, channel = 1) => ({ type: 'note', channel, number })
const cc = (number, channel = 1) => ({ type: 'cc', channel, number })
const pc = (number, channel = 1) => ({ type: 'pc', channel, number })

test('validateMidiInput: accepts the three types across their full ranges', () => {
  for (const channel of [1, 8, 16]) {
    for (const number of [0, 60, 127]) {
      assert.deepEqual(mapping.validateMidiInput(note(number, channel)), note(number, channel))
      assert.deepEqual(mapping.validateMidiInput(pc(number, channel)), pc(number, channel))
    }
    for (const number of [0, 64, 119]) assert.deepEqual(mapping.validateMidiInput(cc(number, channel)), cc(number, channel))
  }
})

test('validateMidiInput: rejects every bad field and stores nothing but type, channel, number', () => {
  for (const bad of [null, undefined, 'note', 5, [], ['note', 1, 60], {}, { type: 'note' }, { type: 'note', channel: 1 },
    { type: 'sysex', channel: 1, number: 0 }, { type: 'noteOn', channel: 1, number: 60 }, { type: 'NOTE', channel: 1, number: 60 },
    { type: ['note'], channel: 1, number: 60 }, note(60, 0), note(60, 17), note(60, 1.5), note(60, '1'), note(60, null),
    note(-1), note(128), note(60.5), note('60'), note(NaN), note(Infinity), cc(120), cc(127), cc(-1), pc(128)]) {
    assert.equal(mapping.validateMidiInput(bad), null, JSON.stringify(bad))
  }
  const extra = { type: 'cc', channel: 1, number: 64, value: 127, velocity: 9, device: 'FS-1-WL', __proto__: { polluted: true } }
  const clean = mapping.validateMidiInput(extra)
  assert.deepEqual(Object.keys(clean).sort(), ['channel', 'number', 'type'], 'value and velocity are never stored')
  assert.notEqual(clean, extra, 'a fresh object is returned')
  assert.equal(clean.polluted, undefined)
})

test('learnableMidiInput: note on, CC at 64 or more, and program change are captured; the rest is not', () => {
  const learn = (...bytes) => mapping.learnableMidiInput(parseMidiMessage(Uint8Array.from(bytes)))
  assert.equal(mapping.MIDI_CC_PRESS_THRESHOLD, 64)
  assert.deepEqual(learn(0x90, 60, 1), note(60))
  assert.deepEqual(learn(0x92, 60, 127), note(60, 3))
  assert.equal(learn(0x80, 60, 64), null, 'note off')
  assert.equal(learn(0x90, 60, 0), null, 'note on with velocity 0')
  assert.deepEqual(learn(0xb0, 64, 64), cc(64))
  assert.deepEqual(learn(0xbf, 64, 127), cc(64, 16))
  assert.equal(learn(0xb0, 64, 63), null, 'CC below 64')
  assert.equal(learn(0xb0, 64, 0), null)
  assert.deepEqual(learn(0xc4, 5), pc(5, 5))
  assert.deepEqual(Object.keys(learn(0xb0, 64, 127)).sort(), ['channel', 'number', 'type'], 'the captured input carries no value')
})

test('midiInputLabel: on-screen text with numbers as sent and note names at C4 = 60', () => {
  assert.equal(mapping.midiInputLabel(note(60)), 'Note 60 (C4) · Ch 1')
  assert.equal(mapping.midiInputLabel(cc(64)), 'CC 64 · Ch 1')
  assert.equal(mapping.midiInputLabel(pc(5)), 'Program 5 · Ch 1')
  assert.equal(mapping.midiInputLabel(note(69, 16)), 'Note 69 (A4) · Ch 16')
  assert.equal(mapping.midiInputLabel(note(0)), 'Note 0 (C-1) · Ch 1')
  assert.equal(mapping.midiInputLabel(note(127)), 'Note 127 (G9) · Ch 1')
  assert.equal(mapping.midiInputLabel(note(70)), 'Note 70 (A#4) · Ch 1', 'sharps, as the Tuner spells them')
  assert.equal(mapping.midiInputLabel(pc(0, 9)), 'Program 0 · Ch 9', 'zero-based, as the controller sends it')
})

test('lookup by type, channel and number', () => {
  const mappings = { nextSong: cc(64), prevSong: note(60), toggleAutoScroll: pc(5, 2) }
  assert.equal(mapping.findMidiAction(mappings, cc(64)), 'nextSong')
  assert.equal(mapping.findMidiAction(mappings, note(60)), 'prevSong')
  assert.equal(mapping.findMidiAction(mappings, pc(5, 2)), 'toggleAutoScroll')
  // Same number, different type; same type, different channel or number: no match.
  assert.equal(mapping.findMidiAction(mappings, note(64)), null)
  assert.equal(mapping.findMidiAction(mappings, pc(64)), null)
  assert.equal(mapping.findMidiAction(mappings, cc(64, 2)), null, 'a mapping matches only its learned channel')
  assert.equal(mapping.findMidiAction(mappings, cc(65)), null)
  assert.equal(mapping.findMidiAction(mappings, pc(5, 1)), null)
  assert.equal(mapping.findMidiAction({}, cc(64)), null)
  assert.equal(mapping.sameMidiInput(cc(64), { type: 'cc', channel: 1, number: 64 }), true)
  assert.equal(mapping.midiInputKey(cc(64, 3)), 'cc:3:64')
  assert.notEqual(mapping.midiInputKey(note(1, 11)), mapping.midiInputKey(note(11, 1)))
})

test('assign: one action has one input; learning again replaces that action\'s own input', () => {
  let result = mapping.assignMidiMapping({}, 'nextSong', cc(64))
  assert.deepEqual(result, { ok: true, mappings: { nextSong: cc(64) } })
  result = mapping.assignMidiMapping(result.mappings, 'nextSong', note(60))
  assert.deepEqual(result, { ok: true, mappings: { nextSong: note(60) } })
  assert.equal(mapping.findMidiAction(result.mappings, cc(64)), null, 'the old input is free again')
  // Learning the same input for the same action is not a conflict.
  assert.deepEqual(mapping.assignMidiMapping(result.mappings, 'nextSong', note(60)), { ok: true, mappings: { nextSong: note(60) } })
})

test('conflict: an input already used is never replaced silently; Replace moves it', () => {
  const start = { nextSong: cc(64), prevSong: note(60) }
  const frozen = JSON.stringify(start)
  assert.equal(mapping.findMidiConflict(start, 'prevSong', cc(64)), 'nextSong')
  assert.equal(mapping.findMidiConflict(start, 'nextSong', cc(64)), null, 'an action does not conflict with itself')
  assert.equal(mapping.findMidiConflict(start, 'scrollUp', cc(65)), null)

  const asked = mapping.assignMidiMapping(start, 'scrollUp', cc(64))
  assert.deepEqual(asked, { ok: false, reason: 'conflict', conflict: 'nextSong' })
  assert.deepEqual(mapping.assignMidiMapping(start, 'scrollUp', cc(64), { replace: false }), asked)
  assert.deepEqual(mapping.assignMidiMapping(start, 'scrollUp', cc(64), {}), asked)
  assert.deepEqual(mapping.assignMidiMapping(start, 'scrollUp', cc(64), { replace: 'yes' }), asked, 'only an explicit true replaces')

  const replaced = mapping.assignMidiMapping(start, 'scrollUp', cc(64), { replace: true })
  assert.deepEqual(replaced, { ok: true, mappings: { prevSong: note(60), scrollUp: cc(64) } })
  assert.equal(Object.hasOwn(replaced.mappings, 'nextSong'), false, 'the other action becomes Not set')
  assert.equal(mapping.findMidiAction(replaced.mappings, cc(64)), 'scrollUp')

  // Replace onto an action that already had its own input: that input is freed too.
  const moved = mapping.assignMidiMapping(start, 'prevSong', cc(64), { replace: true })
  assert.deepEqual(moved, { ok: true, mappings: { prevSong: cc(64) } })
  assert.equal(JSON.stringify(start), frozen, 'the given mappings are never changed in place')
})

test('assign: a bad action id or a bad input is refused and changes nothing', () => {
  const start = { nextSong: cc(64) }
  for (const id of ['', 'delete', 'NextSong', 'fullscreen', 'exportBackup', 'signIn', '__proto__', 'constructor', 'toString', null, undefined, 0, {}, ['nextSong']]) {
    assert.deepEqual(mapping.assignMidiMapping(start, id, note(60)), { ok: false, reason: 'invalid' }, String(id))
    assert.deepEqual(mapping.assignMidiMapping(start, id, note(60), { replace: true }), { ok: false, reason: 'invalid' })
  }
  for (const input of [null, {}, cc(120), note(128), note(60, 17), { type: 'pitchbend', channel: 1, number: 0 }]) {
    assert.deepEqual(mapping.assignMidiMapping(start, 'prevSong', input), { ok: false, reason: 'invalid' })
  }
  assert.deepEqual(start, { nextSong: cc(64) })
  assert.equal(({}).polluted, undefined)
})

test('Clear unsets one action; Reset unsets all', () => {
  const start = { nextSong: cc(64), prevSong: note(60), transposeUp: pc(1) }
  assert.deepEqual(mapping.clearMidiMapping(start, 'prevSong'), { nextSong: cc(64), transposeUp: pc(1) })
  assert.deepEqual(mapping.clearMidiMapping(start, 'scrollUp'), start, 'clearing an unset action changes nothing')
  assert.deepEqual(mapping.clearMidiMapping(start, 'not-an-action'), start)
  assert.deepEqual(start, { nextSong: cc(64), prevSong: note(60), transposeUp: pc(1) }, 'input left untouched')
  assert.deepEqual(mapping.resetMidiMappings(), {})
  assert.notEqual(mapping.resetMidiMappings(), mapping.resetMidiMappings(), 'a fresh object each time')
  // After Clear the input is free for another action without a conflict.
  assert.deepEqual(mapping.assignMidiMapping(mapping.clearMidiMapping(start, 'nextSong'), 'scrollDown', cc(64)).ok, true)
})

test('all nine actions can be mapped at once, each to its own input', () => {
  let mappings = {}
  MIDI_ACTION_IDS.forEach((id, index) => {
    const result = mapping.assignMidiMapping(mappings, id, cc(20 + index))
    assert.equal(result.ok, true)
    mappings = result.mappings
  })
  assert.deepEqual(Object.keys(mappings), [...MIDI_ACTION_IDS])
  MIDI_ACTION_IDS.forEach((id, index) => assert.equal(mapping.findMidiAction(mappings, cc(20 + index)), id))
})

test('validateMidiMappings: a bad mapping is dropped, the rest stays', () => {
  assert.deepEqual(mapping.validateMidiMappings({
    nextSong: cc(64), prevSong: cc(120), nextSection: 'cc 65', prevSection: null, toggleAutoScroll: pc(5),
    scrollUp: note(60, 17), scrollDown: { type: 'note', channel: 1, number: 62, value: 99 }, transposeUp: [], transposeDown: note(128),
  }), { nextSong: cc(64), toggleAutoScroll: pc(5), scrollDown: note(62) })
  for (const bad of [null, undefined, 'x', 5, true, [], [['nextSong', cc(64)]]]) assert.deepEqual(mapping.validateMidiMappings(bad), {})
})

test('validateMidiMappings: stored data that gives one input to two actions keeps the first in allowlist order', () => {
  const stored = JSON.parse('{"transposeDown":{"type":"cc","channel":1,"number":64},"prevSong":{"type":"cc","channel":1,"number":64},"scrollUp":{"type":"note","channel":1,"number":60}}')
  assert.deepEqual(mapping.validateMidiMappings(stored), { prevSong: cc(64), scrollUp: note(60) })
})
