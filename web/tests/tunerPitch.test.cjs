// Tuner pitch detection (#534): YIN on synthesized tones from 30 Hz to 1 kHz, with harmonics,
// plus the silence gate, noise rejection and reading smoothing. Tones are generated here, not read
// from files, so the expected frequency is the one used to synthesize the signal.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replace(/import\.meta\.env/g, '({ DEV: false })'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, filename)

const pitch = require('../src/utils/tunerPitch.ts')
const { centsBetween } = require('../src/utils/tunerMath.ts')

const BUFFER = 4096
const TOLERANCE_CENTS = 8

/** Sum of harmonics with 1/k amplitudes (a plucked-string-like timbre), starting at a time offset. */
function tone(freq, sampleRate, { harmonics = 1, amplitude = 0.5, offset = 0.1, length = BUFFER } = {}) {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const t = offset + i / sampleRate
    let v = 0
    for (let k = 1; k <= harmonics; k++) v += Math.sin(2 * Math.PI * freq * k * t) / k
    out[i] = amplitude * v / Math.sqrt(harmonics)
  }
  return out
}

function lcgNoise(length, amplitude, seed = 12345) {
  const out = new Float32Array(length)
  let state = seed
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    out[i] = amplitude * ((state / 0x7fffffff) * 2 - 1)
  }
  return out
}

const SAMPLE_RATES = [44100, 48000]
// B0 (5-string bass low), E1, A1, E2 (guitar low), A2, A3, E4, A4, A5, and 1 kHz.
const FREQUENCIES = [30.87, 41.2, 55, 82.41, 110, 220, 329.63, 440, 880, 1000]

test('single tones from 30 Hz to 1 kHz are detected within 8 cents at 44.1 and 48 kHz', () => {
  for (const sampleRate of SAMPLE_RATES) {
    for (const freq of FREQUENCIES) {
      const estimate = pitch.detectPitch(tone(freq, sampleRate), sampleRate)
      assert.ok(estimate, `${freq} Hz at ${sampleRate} is detected`)
      assert.ok(Math.abs(centsBetween(estimate.frequency, freq)) < TOLERANCE_CENTS,
        `${freq} Hz at ${sampleRate}: got ${estimate.frequency.toFixed(3)} Hz`)
      assert.ok(estimate.clarity > 0.9, `${freq} Hz clean tone is clear (${estimate.clarity.toFixed(2)})`)
    }
  }
})

test('a low note with harmonics (B0 and E1 with six partials) reads the fundamental, not an octave up', () => {
  for (const sampleRate of SAMPLE_RATES) {
    for (const freq of [30.87, 41.2, 82.41]) {
      const estimate = pitch.detectPitch(tone(freq, sampleRate, { harmonics: 6 }), sampleRate)
      assert.ok(estimate, `${freq} Hz with harmonics at ${sampleRate}`)
      assert.ok(Math.abs(centsBetween(estimate.frequency, freq)) < TOLERANCE_CENTS,
        `${freq} Hz with harmonics at ${sampleRate}: got ${estimate.frequency.toFixed(3)} Hz`)
    }
  }
})

test('the 5-string bass low B0 (30.87 Hz) needs no more than the 4096-sample buffer', () => {
  const estimate = pitch.estimatePitch(tone(30.87, 48000, { harmonics: 4, amplitude: 0.3 }), 48000)
  assert.ok(estimate !== null && Math.abs(centsBetween(estimate, 30.87)) < TOLERANCE_CENTS)
})

test('pure silence and very quiet input read as no signal (silence gate)', () => {
  const silent = new Float32Array(BUFFER)
  assert.equal(pitch.rmsOf(silent), 0)
  assert.equal(pitch.estimatePitch(silent, 48000), null)
  const quiet = tone(440, 48000, { amplitude: 0.002 })
  assert.ok(pitch.rmsOf(quiet) < pitch.SILENCE_RMS)
  assert.equal(pitch.estimatePitch(quiet, 48000), null)
})

test('broadband noise is not reported as a note', () => {
  const noise = lcgNoise(BUFFER, 0.5)
  assert.equal(pitch.estimatePitch(noise, 48000), null)
  assert.equal(pitch.detectPitch(noise, 48000), null)
})

test('out-of-range pitches are not reported: below 25 Hz, and nothing above 2 kHz', () => {
  assert.equal(pitch.detectPitch(tone(15, 48000, { harmonics: 3 }), 48000), null)
  // A 3 kHz tone has no lag window inside the range; YIN may report a sub-multiple, never 3 kHz itself.
  const high = pitch.detectPitch(tone(3000, 48000), 48000)
  assert.ok(high === null || high.frequency <= pitch.PITCH_MAX_HZ, 'never reports above the range')
})

test('a tone with a sudden change is followed quickly; smoothing does not jump on one bad frame', () => {
  const tracker = new pitch.PitchTracker()
  let value = null
  for (let i = 0; i < 6; i++) value = tracker.push(440, i * 50)
  assert.ok(Math.abs(value - 440) < 0.5)
  value = tracker.push(445, 300)
  assert.ok(Math.abs(centsBetween(value, 440)) < 25, 'one new reading moves the needle only slightly')
  for (let i = 0; i < 6; i++) value = tracker.push(880, 350 + i * 50)
  assert.ok(Math.abs(centsBetween(value, 880)) < 10, 'a sustained new note is followed')
})

test('unclear frames hold the last reading briefly, then report no signal', () => {
  const tracker = new pitch.PitchTracker()
  for (let i = 0; i < 4; i++) tracker.push(330, i * 50)
  assert.ok(Math.abs(tracker.push(null, 250) - 330) < 0.5, 'held within 400 ms')
  assert.equal(tracker.push(null, 900), null, 'no signal after the hold')
  assert.equal(tracker.push(null, 950), null)
})

test('PitchTracker: a jump larger than 100 cents restarts the glide', () => {
  const tracker = new pitch.PitchTracker()
  for (let i = 0; i < 5; i++) tracker.push(110, i * 50)
  const after = tracker.push(220, 300)
  assert.ok(Math.abs(centsBetween(after, 110)) < 1, 'one stray reading does not move the median')
  for (let i = 0; i < 4; i++) tracker.push(220, 350 + i * 50)
  assert.ok(Math.abs(centsBetween(tracker.push(220, 600), 220)) < 5)
})
