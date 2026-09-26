const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename
  )

const { parseGtarSong, detectSongKey } = require('../src/utils/songParser.ts')
const { transposeKey } = require('../src/utils/chordTransposer.ts')

test('108-dev.1f: detectSongKey detects key from chords when {key} directive is absent', () => {
  // Known failure example: Song in C with no {key} directive previously defaulted to G
  const rawSongInC = `[Intro]
[C] [F] [G] [C]

[Verse 1]
When I [C]wake up in the [F]morning
And the [G]sun begins to [C]shine`

  const detected = detectSongKey(rawSongInC)
  assert.equal(detected, 'C', 'detectSongKey must detect C as the starting tonic chord')

  const parsed = parseGtarSong(rawSongInC, 0)
  assert.equal(parsed.key, 'C', 'parseGtarSong must detect C instead of returning empty or defaulting to G')

  // Verify transposition uses true original key C as baseline: +2 semitones -> D
  const transposed = transposeKey(parsed.key, 2)
  assert.equal(transposed, 'D', 'Transposing C by +2 must yield D (not A as would happen if original were G)')
})

test('108-dev.1f: detectSongKey prioritizes explicit {key} directive if present', () => {
  const songWithDirective = `{title: Test Song}
{key: Eb}

[Verse]
[C] [F] [G]`

  const detected = detectSongKey(songWithDirective)
  assert.equal(detected, 'Eb', 'detectSongKey must respect explicit {key: Eb} directive')

  const parsed = parseGtarSong(songWithDirective, 0)
  assert.equal(parsed.key, 'Eb', 'parseGtarSong must use directive key Eb')
})

test('108-dev.1f: 2-line unbracketed chord format key detection', () => {
  const twoLineSongInAm = `Intro:
Am F C G

Verse 1:
Am          F
Lost in the shadows
C           G
Looking for light`

  const detected = detectSongKey(twoLineSongInAm)
  assert.equal(detected, 'Am', 'detectSongKey must detect Am from 2-line chord row')
})

test('108-dev.1g: Relative semitone transpose control defaults to 0 and does not mutate chords at 0', () => {
  const { formatTransposeOffset, transposeChordProText } = require('../src/utils/chordTransposer.ts')

  // Default offset 0
  const defaultOffset = 0
  assert.equal(formatTransposeOffset(defaultOffset), '0', 'Default offset 0 formats as "0"')
  assert.equal(`Transpose: ${formatTransposeOffset(defaultOffset)}`, 'Transpose: 0', 'Primary display at default is Transpose: 0')

  // Positive semitone transpose
  const posOffset = 2
  assert.equal(formatTransposeOffset(posOffset), '+2', 'Positive offset 2 formats as "+2"')
  assert.equal(`Transpose: ${formatTransposeOffset(posOffset)}`, 'Transpose: +2', 'Primary display at +2 is Transpose: +2')

  // Negative semitone transpose
  const negOffset = -1
  assert.equal(formatTransposeOffset(negOffset), '-1', 'Negative offset -1 formats as "-1"')
  assert.equal(`Transpose: ${formatTransposeOffset(negOffset)}`, 'Transpose: -1', 'Primary display at -1 is Transpose: -1')

  // Zero semitone offset does not mutate original chord positions
  const rawChords = '[C] [Am] [F] [G]\nWhen I [C]wake up in the [F]morning'
  const renderedAtZero = transposeChordProText(rawChords, 0)
  assert.equal(renderedAtZero, rawChords, 'Offset 0 must return identical text without mutating chord tokens')

  // Transposed at +2 shifts chords relative to original chords, without needing original key label
  const renderedAtPlusTwo = transposeChordProText(rawChords, 2)
  assert.equal(renderedAtPlusTwo, '[D] [Bm] [G] [A]\nWhen I [D]wake up in the [G]morning')

  // Transposed at -2 shifts chords downwards
  const renderedAtMinusTwo = transposeChordProText(rawChords, -2)
  assert.equal(renderedAtMinusTwo, '[A#] [Gm] [Eb] [F]\nWhen I [A#]wake up in the [Eb]morning')
})

