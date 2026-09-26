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
