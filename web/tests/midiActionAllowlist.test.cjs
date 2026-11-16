// #536 Slice 1: the MIDI allowlist. Only the nine action ids are accepted at Learn, on load and
// at dispatch. Nothing destructive or privileged can be mapped.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)

const actions = require('../src/midi/actions.ts')
const mapping = require('../src/midi/mapping.ts')
const settings = require('../src/midi/settings.ts')

const NINE = ['nextSong', 'prevSong', 'nextSection', 'prevSection', 'toggleAutoScroll', 'scrollUp', 'scrollDown', 'transposeUp', 'transposeDown']
const NOT_ALLOWED = ['', ' ', 'NextSong', 'nextsong', 'next-song', 'nextSong ', 'delete', 'deleteSong', 'restore', 'import', 'export', 'signIn', 'signOut',
  'settings', 'backup', 'sync', 'cast', 'fullscreen', 'exit', 'openEditor', 'transposeReset', 'fontUp', 'speedUp',
  '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf']
const cc = number => ({ type: 'cc', channel: 1, number })

test('exactly nine actions, in dialog order, with their labels', () => {
  assert.deepEqual([...actions.MIDI_ACTION_IDS], NINE)
  assert.deepEqual(actions.MIDI_ACTIONS.map(action => action.label), ['Next song', 'Previous song', 'Next section', 'Previous section',
    'Autoscroll on/off', 'Scroll up', 'Scroll down', 'Transpose up', 'Transpose down'])
  assert.equal(new Set(actions.MIDI_ACTION_IDS).size, 9)
  for (const id of NINE) assert.equal(typeof actions.midiActionLabel(id), 'string')
  assert.equal(actions.midiActionLabel('toggleAutoScroll'), 'Autoscroll on/off')
})

test('isMidiActionId accepts only the nine exact strings', () => {
  for (const id of NINE) assert.equal(actions.isMidiActionId(id), true, id)
  for (const id of [...NOT_ALLOWED, null, undefined, 0, 1, true, {}, [], ['nextSong'], { id: 'nextSong' }, { toString: () => 'nextSong' }, new String('nextSong')]) {
    assert.equal(actions.isMidiActionId(id), false, String(id))
  }
})

test('Learn: only the nine ids can receive a mapping', () => {
  for (const id of NOT_ALLOWED) {
    assert.deepEqual(mapping.assignMidiMapping({}, id, cc(64)), { ok: false, reason: 'invalid' }, id)
    assert.deepEqual(mapping.assignMidiMapping({}, id, cc(64), { replace: true }), { ok: false, reason: 'invalid' }, id)
  }
  NINE.forEach((id, index) => assert.equal(mapping.assignMidiMapping({}, id, cc(index)).ok, true, id))
})

test('load: unknown action ids in stored data are dropped, known ones stay', () => {
  const stored = JSON.parse(JSON.stringify({ version: 1, enabled: true, device: 'all', channel: 'all', mappings: {
    nextSong: cc(1), deleteSong: cc(2), fullscreen: cc(3), signOut: cc(4), exportBackup: cc(5), constructor: cc(6), toString: cc(7), transposeDown: cc(8),
  } }).replace('"deleteSong"', '"__proto__":{"type":"cc","channel":1,"number":9},"deleteSong"'))
  const loaded = settings.normalizeMidiSettings(stored)
  assert.deepEqual(loaded.mappings, { nextSong: cc(1), transposeDown: cc(8) })
  assert.deepEqual(Object.keys(loaded.mappings), ['nextSong', 'transposeDown'])
  assert.equal(Object.getPrototypeOf(loaded.mappings), Object.prototype)
  assert.equal(({}).type, undefined, 'no prototype pollution from a stored __proto__ key')
  assert.deepEqual(mapping.validateMidiMappings(Object.fromEntries(NOT_ALLOWED.filter(id => id !== '__proto__').map((id, index) => [id, cc(index)]))), {})
})

test('dispatch: a lookup can only ever answer with one of the nine ids', () => {
  // Even a hand-built object that skipped validation cannot make the lookup return anything else.
  const dirty = { deleteSong: cc(2), fullscreen: cc(3), toString: cc(7), nextSection: cc(10) }
  assert.equal(mapping.findMidiAction(dirty, cc(2)), null)
  assert.equal(mapping.findMidiAction(dirty, cc(3)), null)
  assert.equal(mapping.findMidiAction(dirty, cc(7)), null)
  assert.equal(mapping.findMidiAction(dirty, cc(10)), 'nextSection')
  const inherited = Object.create({ nextSong: cc(20) })
  assert.equal(mapping.findMidiAction(inherited, cc(20)), null, 'inherited properties are not mappings')
  for (let number = 0; number <= 119; number++) {
    const found = mapping.findMidiAction({ scrollUp: cc(50), scrollDown: cc(51) }, cc(number))
    assert.ok(found === null || NINE.includes(found))
  }
})

test('the allowlist names nothing destructive or privileged', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/midi/actions.ts'), 'utf8')
  assert.equal(source.match(/\{ id: '/g)?.length, 9, 'actions.ts lists nine actions and no more')
  for (const { id, label } of actions.MIDI_ACTIONS) {
    assert.doesNotMatch(`${id} ${label}`, /delete|trash|restore|import|export|sign|login|account|backup|sync|cast|fullscreen|setting/i)
  }
})

// Slice 2 (web/src/utils/stageCommands.ts) is a separate PR. Once both are on the same branch
// the two lists must be identical, because MIDI dispatches an action id as a Stage command name.
const stageCommandsPath = path.join(__dirname, '../src/utils/stageCommands.ts')
test('action ids equal the Stage command names', { skip: fs.existsSync(stageCommandsPath) ? false : 'Stage command seam (Slice 2) is not on this branch yet' }, () => {
  const { STAGE_COMMANDS, stageCommands } = require(stageCommandsPath)
  assert.deepEqual([...STAGE_COMMANDS], [...actions.MIDI_ACTION_IDS])
  for (const id of actions.MIDI_ACTION_IDS) assert.equal(stageCommands.run(id), false, 'no Stage mounted')
  for (const id of NOT_ALLOWED) assert.equal(stageCommands.run(id), false)
})
