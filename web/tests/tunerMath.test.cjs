// Tuner math (#534): note names, equal-temperament frequencies, cents, the A4 reference and every
// preset's computed frequencies. No hardcoded Hz: expectations come from the formula, not the module.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replace(/import\.meta\.env/g, '({ DEV: false })'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, filename)

const math = require('../src/utils/tunerMath.ts')
const presets = require('../src/utils/tunerPresets.ts')

const SEMITONE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }
/** Independent expected frequency: semitones from A4 counted directly, not via the module's MIDI helper. */
const expectedHz = (note, octave, a4 = 440) => a4 * 2 ** ((((octave - 4) * 12) + (SEMITONE[note] - 9)) / 12)

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), data }
}

test('note names: MIDI numbers, octave numbering and frequencies from A4', () => {
  assert.equal(math.midiOf({ note: 'C', octave: 4 }), 60)
  assert.equal(math.midiOf({ note: 'A', octave: 4 }), 69)
  assert.equal(math.midiOf({ note: 'B', octave: 0 }), 23)
  assert.equal(math.midiOf({ note: 'E', octave: 1 }), 28)
  assert.equal(math.frequencyOf({ note: 'A', octave: 4 }), 440)
  assert.equal(math.frequencyOf({ note: 'A', octave: 5 }), 880)
  assert.equal(math.frequencyOf({ note: 'A', octave: 4 }, 432), 432)
  assert.equal(math.frequencyOf({ note: 'A', octave: 4 }, 442), 442)
  assert.ok(Math.abs(math.frequencyOf({ note: 'E', octave: 2 }) - 82.40688922821748) < 1e-9)
  assert.ok(Math.abs(math.frequencyOf({ note: 'C', octave: 4 }) - 261.6255653005986) < 1e-9)
})

test('enharmonic spellings name the same pitch', () => {
  for (const [a, b] of [['Eb', 'D#'], ['Ab', 'G#'], ['Db', 'C#'], ['Gb', 'F#'], ['Bb', 'A#']]) {
    for (const octave of [1, 2, 3, 4]) {
      assert.equal(math.midiOf({ note: a, octave }), math.midiOf({ note: b, octave }), `${a}${octave} = ${b}${octave}`)
    }
  }
})

test('cents: octave is 1200, semitone is 100, sign shows flat (negative) and sharp (positive)', () => {
  assert.ok(Math.abs(math.centsBetween(880, 440) - 1200) < 1e-9)
  assert.ok(Math.abs(math.centsBetween(440 * 2 ** (1 / 12), 440) - 100) < 1e-9)
  assert.ok(math.centsBetween(430, 440) < 0, 'flat is negative')
  assert.ok(math.centsBetween(450, 440) > 0, 'sharp is positive')
  assert.equal(math.centsBetween(440, 440), 0)
})

test('nearestNote: chromatic name, octave and cents from A4', () => {
  let note = math.nearestNote(440)
  assert.deepEqual([note.name, note.octave], ['A', 4]); assert.ok(Math.abs(note.cents) < 1e-9)
  note = math.nearestNote(261.63)
  assert.deepEqual([note.name, note.octave], ['C', 4]); assert.ok(Math.abs(note.cents) < 0.1)
  note = math.nearestNote(30.87)
  assert.deepEqual([note.name, note.octave], ['B', 0])
  note = math.nearestNote(466.16)
  assert.deepEqual([note.name, note.octave], ['A#', 4])
  note = math.nearestNote(445)
  assert.equal(note.name, 'A'); assert.ok(Math.abs(note.cents - 19.56) < 0.05, `sharp by ${note.cents}`)
  note = math.nearestNote(436)
  assert.equal(note.name, 'A'); assert.ok(note.cents < 0, 'flat')
  note = math.nearestNote(440, 432)
  assert.deepEqual([note.name, note.octave], ['A', 4])
  assert.ok(Math.abs(note.cents - 1200 * Math.log2(440 / 432)) < 1e-9, 'sharp of a 432 reference')
  assert.ok(Math.abs(math.nearestNote(432, 432).cents) < 1e-9, 'a 432 reference reads 432 as in tune')
})

test('A4 reference: default 440, clamped to 400 to 480, rounded to whole Hz', () => {
  assert.equal(math.A4_DEFAULT_HZ, 440); assert.equal(math.A4_MIN_HZ, 400); assert.equal(math.A4_MAX_HZ, 480)
  assert.equal(math.clampA4(300), 400); assert.equal(math.clampA4(999), 480)
  assert.equal(math.clampA4(441.4), 441); assert.equal(math.clampA4(Number.NaN), 440)
})

test('A4 setting persists locally with try/catch and falls back to 440', () => {
  const storage = memoryStorage()
  assert.equal(math.readSavedA4(storage), 440, 'nothing saved')
  assert.equal(math.saveA4(442, storage), true)
  assert.equal(storage.data.get(math.A4_STORAGE_KEY), '442')
  assert.equal(math.readSavedA4(storage), 442)
  storage.data.set(math.A4_STORAGE_KEY, 'not-a-number')
  assert.equal(math.readSavedA4(storage), 440, 'invalid value falls back')
  storage.data.set(math.A4_STORAGE_KEY, '999')
  assert.equal(math.readSavedA4(storage), 480, 'out of range is clamped')
  storage.data.set(math.A4_STORAGE_KEY, '   ')
  assert.equal(math.readSavedA4(storage), 440, 'blank falls back')
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(math.readSavedA4(broken), 440)
  assert.doesNotThrow(() => assert.equal(math.saveA4(442, broken), false))
  assert.equal(math.saveA4(442, null), false, 'no storage is not an error')
})

test('roundHz keeps 0.01 Hz resolution', () => {
  assert.equal(math.roundHz(82.40688922821748), 82.41)
  assert.equal(math.roundHz(146.8323), 146.83)
  assert.equal(math.roundHz(195.9977), 196)
})

test('every preset: exact names, string counts and computed frequencies', () => {
  const byId = Object.fromEntries(presets.TUNER_PRESETS.map(preset => [preset.id, preset]))
  const spell = preset => preset.strings.map(s => `${s.note}${s.octave}`)
  const expected = {
    'guitar-standard': ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
    'guitar-half-step-down': ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'],
    'guitar-full-step-down': ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'],
    'guitar-drop-d': ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'],
    'guitar-dadgad': ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'],
    'guitar-open-g': ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'],
    'guitar-open-d': ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'],
    'guitar-open-c': ['C2', 'G2', 'C3', 'G3', 'C4', 'E4'],
    'guitar-open-e': ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'],
    'guitar-open-a': ['E2', 'A2', 'E3', 'A3', 'C#4', 'E4'],
    'bass-4-string': ['E1', 'A1', 'D2', 'G2'],
    'bass-5-string': ['B0', 'E1', 'A1', 'D2', 'G2'],
    'ukulele-standard': ['G4', 'C4', 'E4', 'A4'],
  }
  assert.deepEqual(presets.TUNER_PRESETS.map(preset => preset.id).sort(), Object.keys(expected).sort())
  for (const [id, notes] of Object.entries(expected)) {
    const preset = byId[id]
    assert.deepEqual(spell(preset), notes, id)
    for (const [index, spec] of preset.strings.entries()) {
      const hz = math.frequencyOf(spec, 440)
      assert.ok(Math.abs(hz - expectedHz(spec.note, spec.octave)) < 1e-9, `${id} ${spec.note}${spec.octave}`)
      const scaled = math.frequencyOf(spec, 432)
      assert.ok(Math.abs(scaled / hz - 432 / 440) < 1e-12, `${id} string ${index} scales with A4`)
      assert.ok(hz > 25 && hz < 1000, `${id} string ${index} is in the tuner range`)
    }
  }
  assert.equal(presets.TUNER_PRESETS.filter(p => p.instrument === 'guitar').length, 10)
  assert.equal(presets.TUNER_PRESETS.filter(p => p.instrument === 'bass').length, 2)
  assert.equal(presets.TUNER_PRESETS.filter(p => p.instrument === 'ukulele').length, 1)
  assert.equal(new Set(presets.TUNER_PRESETS.map(p => p.id)).size, presets.TUNER_PRESETS.length, 'unique ids')
  assert.doesNotMatch(JSON.stringify(presets.TUNER_PRESETS), /iris/i)
})

test('standard guitar reference tones keep their 0.01 Hz values (what the reference tone plays)', () => {
  const standard = presets.findPreset('guitar-standard')
  const rounded = standard.strings.map(spec => math.roundHz(math.frequencyOf(spec)))
  assert.deepEqual(rounded, [82.41, 110, 146.83, 196, 246.94, 329.63])
})

test('string labels: note, octave and string number counted from the thinnest string', () => {
  const standard = presets.findPreset('guitar-standard').strings
  assert.deepEqual(standard.map((_, i) => presets.stringLabel(standard, i)),
    ['E2 (6th)', 'A2 (5th)', 'D3 (4th)', 'G3 (3rd)', 'B3 (2nd)', 'E4 (1st)'])
  const uke = presets.findPreset('ukulele-standard').strings
  assert.equal(presets.stringLabel(uke, 0), 'G4 (4th)')
  assert.equal(presets.stringLabel(presets.findPreset('bass-5-string').strings, 0), 'B0 (5th)')
  assert.equal(presets.findPreset('nope').id, 'guitar-standard', 'unknown id falls back to Standard')
})

test('nearest string in preset mode: target label, tune direction and in-tune state', () => {
  const standard = presets.findPreset('guitar-standard')
  const labels = standard.strings.map((_, i) => presets.stringLabel(standard.strings, i))
  let reading = math.describeTuning(110.5, 'preset', standard.strings, labels)
  assert.equal(reading.headline, 'A2 (5th)'); assert.equal(reading.status, 'Tune down')
  reading = math.describeTuning(82, 'preset', standard.strings, labels)
  assert.equal(reading.headline, 'E2 (6th)'); assert.equal(reading.status, 'Tune up'); assert.ok(reading.cents < 0)
  reading = math.describeTuning(146.83, 'preset', standard.strings, labels)
  assert.equal(reading.headline, 'D3 (4th)'); assert.equal(reading.status, 'In tune'); assert.equal(reading.inTune, true)
  assert.equal(reading.announce, 'D3 (4th), in tune')
})

test('auto mode: chromatic note, flat or sharp, in-tune window of 5 cents', () => {
  let reading = math.describeTuning(440.5, 'auto', [], [])
  assert.equal(reading.headline, 'A4'); assert.equal(reading.inTune, true); assert.equal(reading.status, 'In tune')
  reading = math.describeTuning(445, 'auto', [], [])
  assert.equal(reading.status, 'Sharp'); assert.equal(reading.inTune, false)
  reading = math.describeTuning(436, 'auto', [], [])
  assert.equal(reading.status, 'Flat')
  reading = math.describeTuning(null, 'auto', [], [])
  assert.deepEqual([reading.headline, reading.status, reading.cents, reading.announce], ['', 'Play a note', null, ''])
  reading = math.describeTuning(0, 'auto', [], [])
  assert.equal(reading.status, 'Play a note', 'zero is not a pitch')
})

test('describeTuning announces only the note and in-tune state, not every reading', () => {
  const first = math.describeTuning(440.2, 'auto', [], [])
  const second = math.describeTuning(440.9, 'auto', [], [])
  const drift = math.describeTuning(441.5, 'auto', [], [])
  assert.equal(first.announce, second.announce, 'same note, same in-tune state')
  assert.equal(second.announce, 'A4, in tune')
  assert.equal(drift.announce, 'A4', 'leaving the in-tune window changes the announcement only once')
  assert.equal(math.describeTuning(466.16, 'auto', [], []).announce, 'A#4, in tune', 'a new note is announced')
})
