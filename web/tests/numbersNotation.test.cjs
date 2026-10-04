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

const { GTAR_DEV_VERSION } = require('../src/types/gtar.ts')
const {
  isValidMusicalKey,
  extractKeyRootNote,
  getTrustworthySongKey,
  noteToNashvilleDegree,
  chordTokenToNashville,
  convertChordLineToNashville,
  convertChordProTextToNashville,
  NOTATION_STORAGE_KEY,
} = require('../src/utils/nashvilleNotation.ts')
const { transposeChordToken, transposeKey } = require('../src/utils/chordTransposer.ts')
const { parseGtarSong } = require('../src/utils/songParser.ts')

test('VERSION_STAMP: Target iteration rolled to v1.0.108-dev.13', () => {
  assert.equal(GTAR_DEV_VERSION, '1.0.108-dev.13')
})

test('TEST_REQUIREMENTS: basic major, minor, 7th, maj7, add, sus, slash, chromatic, and altered supported chords in Key C', () => {
  const key = 'C'

  // Major
  assert.equal(chordTokenToNashville('C', key), '1')
  assert.equal(chordTokenToNashville('F', key), '4')
  assert.equal(chordTokenToNashville('G', key), '5')

  // Minor
  assert.equal(chordTokenToNashville('Dm', key), '2m')
  assert.equal(chordTokenToNashville('Em', key), '3m')
  assert.equal(chordTokenToNashville('Am', key), '6m')

  // 7th
  assert.equal(chordTokenToNashville('G7', key), '57')
  assert.equal(chordTokenToNashville('Dm7', key), '2m7')
  assert.equal(chordTokenToNashville('Em7', key), '3m7')

  // Maj7
  assert.equal(chordTokenToNashville('Fmaj7', key), '4maj7')
  assert.equal(chordTokenToNashville('Cmaj7', key), '1maj7')

  // Add & Extensions
  assert.equal(chordTokenToNashville('Cadd9', key), '1add9')
  assert.equal(chordTokenToNashville('Am9', key), '6m9')

  // Sus
  assert.equal(chordTokenToNashville('Csus4', key), '1sus4')
  assert.equal(chordTokenToNashville('Gsus2', key), '5sus2')

  // Altered
  assert.equal(chordTokenToNashville('Bm7b5', key), '7m7b5')
  assert.equal(chordTokenToNashville('C7#9', key), '17#9')
  assert.equal(chordTokenToNashville('G7b9', key), '57b9')
  assert.equal(chordTokenToNashville('Caug', key), '1aug')
  assert.equal(chordTokenToNashville('Cdim', key), '1dim')

  // Chromatic roots
  assert.equal(chordTokenToNashville('Db', key), 'b2')
  assert.equal(chordTokenToNashville('Eb', key), 'b3')
  assert.equal(chordTokenToNashville('F#m', key), '#4m')
  assert.equal(chordTokenToNashville('Bb', key), 'b7')
  assert.equal(chordTokenToNashville('Ab', key), 'b6')
})

test('TEST:KEY_G G_D/F#_Em7_Cadd9 => 1_5/7_6m7_4add9', () => {
  const key = 'G'
  assert.equal(chordTokenToNashville('G', key), '1')
  assert.equal(chordTokenToNashville('D/F#', key), '5/7')
  assert.equal(chordTokenToNashville('Em7', key), '6m7')
  assert.equal(chordTokenToNashville('Cadd9', key), '4add9')

  // Additional representative Key G expectations
  assert.equal(chordTokenToNashville('C/E', key), '4/6')
  assert.equal(chordTokenToNashville('Am7/D', key), '2m7/5')
  assert.equal(chordTokenToNashville('F', key), 'b7')

  // ChordPro text conversion
  const rawChordPro = '[G]Amazing grace [D/F#]how sweet [Em7]the sound [Cadd9]'
  const expectedChordPro = '[1]Amazing grace [5/7]how sweet [6m7]the sound [4add9]'
  assert.equal(convertChordProTextToNashville(rawChordPro, key), expectedChordPro)

  // Two-line chord row spacing preservation
  const rawChordRow = 'G     D/F#     Em7     Cadd9'
  const convertedRow = convertChordLineToNashville(rawChordRow, key)
  assert.equal(convertedRow, '1     5/7      6m7     4add9')
})

test('TEST:NUMBER_PATTERN_INVARIANT_WHEN_KEY_CONTROL_CHANGES', () => {
  const originalKey = 'G'
  const sourceProgression = ['G', 'D/F#', 'Em7', 'Cadd9']

  // In Key G at offset 0:
  const numbersAtG = sourceProgression.map((c) => chordTokenToNashville(c, 'G'))
  assert.deepEqual(numbersAtG, ['1', '5/7', '6m7', '4add9'])

  // Stepping Key G to A (+2 semitones):
  const targetKey = transposeKey(originalKey, 2)
  assert.equal(targetKey, 'A')

  // The transposed chords for Key A:
  const chordsAtA = sourceProgression.map((c) => transposeChordToken(c, 2))
  assert.deepEqual(chordsAtA, ['A', 'E/G#', 'F#m7', 'Dadd9'])

  // The numbers displayed in Key A context relative to Key A:
  const numbersAtA = chordsAtA.map((c) => chordTokenToNashville(c, targetKey))
  assert.deepEqual(numbersAtA, ['1', '5/7', '6m7', '4add9'])

  // Invariance check: Numbers before and after key change must be 100% identical
  assert.deepEqual(numbersAtA, numbersAtG, 'Displayed number relationships must remain invariant when performance key changes')

  // Step key again to Key C (+5 semitones from G)
  const targetKeyC = transposeKey(originalKey, 5)
  assert.equal(targetKeyC, 'C')
  const chordsAtC = sourceProgression.map((c) => transposeChordToken(c, 5))
  assert.deepEqual(chordsAtC, ['C', 'G/B', 'Am7', 'Fadd9'])
  const numbersAtC = chordsAtC.map((c) => chordTokenToNashville(c, targetKeyC))
  assert.deepEqual(numbersAtC, numbersAtG, 'Numbers must remain invariant across any chromatic key step')
})

test('TEST:NOTATION_SWITCH_DOES_NOT_MUTATE_CANONICAL_CHORD_DATA', () => {
  const rawSong = `{title: Invariant Song}
{key: G}
[G] [D/F#] [Em7] [Cadd9]
When peace like a [G]river`

  // Initial parse
  const parsed1 = parseGtarSong(rawSong, 0)
  assert.equal(parsed1.lines.find((l) => l.type === 'CHORD_ROW').raw, 'G   D/F#   Em7   Cadd9')

  // Render to Nashville (derived presentation only)
  const numbersRow = convertChordLineToNashville(parsed1.lines.find((l) => l.type === 'CHORD_ROW').raw, 'G')
  assert.equal(numbersRow, '1   5/7    6m7   4add9')

  // Verify raw song text is strictly unchanged and not mutated
  assert.equal(rawSong, `{title: Invariant Song}\n{key: G}\n[G] [D/F#] [Em7] [Cadd9]\nWhen peace like a [G]river`)

  // Re-parse (switching back to Chords mode)
  const parsed2 = parseGtarSong(rawSong, 0)
  assert.equal(parsed2.lines.find((l) => l.type === 'CHORD_ROW').raw, 'G   D/F#   Em7   Cadd9')
  assert.deepEqual(parsed1, parsed2, 'Switching chords to numbers and back must be 100% lossless for canonical song data')
})

test('TEST:MISSING_OR_INVALID_KEY_FAILS_SAFE', () => {
  // Case 1: No key directive and no song.key
  const rawNoKey = `Intro:
G D Em C
Some lyrics here`

  const trustworthyKey1 = getTrustworthySongKey(null, rawNoKey)
  assert.equal(trustworthyKey1, null, 'getTrustworthySongKey must not guess key from chord progression when key is absent')

  // Case 2: Invalid key strings
  assert.equal(getTrustworthySongKey('INVALID', rawNoKey), null)
  assert.equal(getTrustworthySongKey('H', rawNoKey), null)
  assert.equal(getTrustworthySongKey('123', rawNoKey), null)
  assert.equal(getTrustworthySongKey('', rawNoKey), null)
  assert.equal(isValidMusicalKey('INVALID'), false)
  assert.equal(isValidMusicalKey(''), false)
  assert.equal(isValidMusicalKey(null), false)

  // Case 3: Fail-safe behavior on chordTokenToNashville with missing or invalid key
  assert.equal(chordTokenToNashville('G', null), 'G', 'Must return raw chord and not render false number mapping when key is null')
  assert.equal(chordTokenToNashville('G', ''), 'G', 'Must return raw chord when key is empty')
  assert.equal(chordTokenToNashville('G', 'INVALID'), 'G', 'Must return raw chord when key is invalid')

  // Case 4: Valid key detection succeeds only with explicit source
  assert.equal(getTrustworthySongKey('G', rawNoKey), 'G')
  assert.equal(getTrustworthySongKey(null, '{key: Bb}\n[Bb] [F] [Gm]'), 'Bb')
  assert.equal(getTrustworthySongKey(null, 'Key: F#m\nF#m D A E'), 'F#m')
})

test('TEST:NOTATION_PREFERENCE_DEVICE_LOCAL_AND_NOT_CLOUD_SYNCED', () => {
  assert.equal(NOTATION_STORAGE_KEY, 'gtar_stage_notation')

  // Verify BandSync state model does not include notation preference
  const { bandSync } = require('../src/utils/bandSync.ts')
  const syncState = bandSync.getState()
  assert.equal(syncState.notation, undefined, 'BandSyncState must not include device-local notation preference')

  // Verify backupSettings keys do not include gtar_stage_notation in cloud-synced schema
  const { SETTINGS_KEYS } = require('../src/utils/backupSettings.ts')
  assert.equal(Object.values(SETTINGS_KEYS).includes('gtar_stage_notation'), false, 'gtar_stage_notation must not be a cloud backup setting key')
})

test('TEST:NUMBERS_NOT_CLICKABLE and CHORD_MODE_EXISTING_CLICK_BEHAVIOR_PRESERVED contracts in SongLineRenderer', () => {
  const fs = require('fs')
  const rendererSrc = fs.readFileSync(path.join(__dirname, '../src/components/SongLineRenderer.tsx'), 'utf8')

  // Verify that in numbers mode:
  // 1. onClick is set to undefined
  assert.ok(
    rendererSrc.includes('onClick={isNumbersMode ? undefined : () => onChordClick?.('),
    'SongLineRenderer must suppress onClick handler on chord tokens when in numbers mode'
  )

  // 2. Class has cursor-default instead of cursor-pointer
  assert.ok(
    rendererSrc.includes("className={`stage-chord-token ${isNumbersMode ? 'stage-number-token cursor-default' : 'cursor-pointer'} select-none`}"),
    'SongLineRenderer must use cursor-default for numbers mode and cursor-pointer for chords mode'
  )

  // 3. title diagram tooltip is suppressed
  assert.ok(
    rendererSrc.includes('title={isNumbersMode ? undefined : `View ${clean'),
    'SongLineRenderer must suppress fretboard diagram title in numbers mode'
  )
})

test('STAGE_OPTIONS & KEY_CONTROL contracts in StageView', () => {
  const fs = require('fs')
  const stageSrc = fs.readFileSync(path.join(__dirname, '../src/components/StageView.tsx'), 'utf8')

  // Notation selector in Stage Options: Chords | Numbers
  assert.ok(stageSrc.includes("data-testid={`stage-notation-${mode}-btn`}"), 'StageView must include data-testid for notation options')
  assert.ok(stageSrc.includes("mode === 'chords' ? 'Chords' : 'Numbers'"), 'StageView user-facing options must be Chords and Numbers')

  // Key control in Numbers mode vs Transpose control in Chords mode
  assert.ok(stageSrc.includes("notation === 'numbers' ? ("), 'StageView must branch controls based on notation mode')
  assert.ok(stageSrc.includes("title=\"Step Key Down (-1 semitone)\""), 'StageView must have Step Key Down in Numbers mode')
  assert.ok(stageSrc.includes("title=\"Step Key Up (+1 semitone)\""), 'StageView must have Step Key Up in Numbers mode')
  assert.ok(stageSrc.includes("Key: ${effectivePerformanceKey || 'Not Set'}"), 'StageView must display current performance key in Numbers mode')
  assert.ok(stageSrc.includes("data-testid=\"stage-numbers-key-missing\""), 'StageView must have missing-key fail-safe notification banner')
})

test('TEST:EXACT_FIELD_CASE_KEY_F_CHORDS_AND_NUMBERS_ALIGNMENT (FIX_108_DEV_3)', () => {
  const keyF = 'F'
  const chordsF = ['F', 'C', 'G/B', 'Am', 'F', 'C', 'Gsus4', 'G']
  const expectedNumbersF = ['1', '5', '2/4', '3m', '1', '5', '2sus4', '2']

  // Verify individual chord conversions for Key F
  const actualNumbersF = chordsF.map((c) => chordTokenToNashville(c, keyF))
  assert.deepEqual(actualNumbersF, expectedNumbersF, 'Key F numbers must exactly match expected scale degrees 1, 5, 2/4, 3m, 1, 5, 2sus4, 2')

  // Verify field evidence bug does not occur (b7 #3 1/3 2m b7 #3 1sus4 1 was misaligned reference key)
  const misalignedFieldBug = ['b7', '#3', '1/3', '2m', 'b7', '#3', '1sus4', '1']
  assert.notDeepEqual(actualNumbersF, misalignedFieldBug, 'Numbers mode at Key F must not render misaligned Key G degrees')

  // Chord row line conversion with column alignment
  const rawChordLineF = 'F    C    G/B    Am    F    C    Gsus4    G'
  const convertedLineF = convertChordLineToNashville(rawChordLineF, keyF)
  assert.equal(convertedLineF, '1    5    2/4    3m    1    5    2sus4    2')
})

test('TEST:TRANSPOSE_F_TO_G_NUMBERS_INVARIANT_AND_CHORDS_RETURN (FIX_108_DEV_3)', () => {
  const startKey = 'F'
  const initialChords = ['F', 'C', 'G/B', 'Am', 'F', 'C', 'Gsus4', 'G']
  const expectedNumbers = ['1', '5', '2/4', '3m', '1', '5', '2sus4', '2']

  // Initial numbers at Key F
  const numbersAtF = initialChords.map((c) => chordTokenToNashville(c, startKey))
  assert.deepEqual(numbersAtF, expectedNumbers)

  // Step Key to G (+2 semitones)
  const targetKey = transposeKey(startKey, 2)
  assert.equal(targetKey, 'G')

  // Transposed underlying chords
  const chordsAtG = initialChords.map((c) => transposeChordToken(c, 2))
  assert.deepEqual(chordsAtG, ['G', 'D', 'A/C#', 'Bm', 'G', 'D', 'Asus4', 'A'])

  // Numbers in Key G must remain 100% invariant
  const numbersAtG = chordsAtG.map((c) => chordTokenToNashville(c, targetKey))
  assert.deepEqual(numbersAtG, expectedNumbers, 'Changing performance key must keep numeric degrees invariant')

  // Switching back to Chords mode yields exact chords for Key G
  assert.deepEqual(chordsAtG, ['G', 'D', 'A/C#', 'Bm', 'G', 'D', 'Asus4', 'A'])
})

test('TEST:SINGLE_SOURCE_OF_TRUTH_EFFECTIVE_CHORDS_AND_PERFORMANCE_KEY_ALIGNMENT (FIX_108_DEV_3)', () => {
  const rawSong = `{title: Field Case Song}
F   C   G/B   Am   F   C   Gsus4   G
Some lyrics here`

  // At offset 0 (Key F)
  const parsed0 = parseGtarSong(rawSong, 0)
  const chordRow0 = parsed0.lines.find((l) => l.type === 'CHORD_ROW')
  assert.ok(chordRow0)
  assert.equal(chordRow0.raw, 'F   C   G/B   Am   F   C   Gsus4   G')
  const numbersRow0 = convertChordLineToNashville(chordRow0.raw, 'F')
  assert.equal(numbersRow0, '1   5   2/4   3m   1   5   2sus4   2')

  // At offset +2 (Key G)
  const parsed2 = parseGtarSong(rawSong, 2)
  const chordRow2 = parsed2.lines.find((l) => l.type === 'CHORD_ROW')
  assert.ok(chordRow2)
  assert.equal(chordRow2.raw, 'G   D   A/C#  Bm   G   D   Asus4   A')
  const numbersRow2 = convertChordLineToNashville(chordRow2.raw, 'G')
  assert.equal(numbersRow2, '1   5   2/4   3m   1   5   2sus4   2')
  assert.equal(numbersRow2, numbersRow0, 'Numbers representation must be 100% invariant between offset 0 (F) and offset 2 (G)')
})

test('TEST:KEY_STEP_PLUS_MINUS_FULL_RENDER_PIPELINE_INVARIANCE (FIX_108_DEV_3)', () => {
  // Test suite exercising real songs across the complete key-stepper and render pipeline
  const realSongs = [
    {
      title: 'Stand By Me',
      key: 'A',
      raw: `{title: Stand By Me}
Intro: [A] [F#m] [D] [E] [A]
[Verse 1]
When the [A]night has come
[F#m]And the land is dark
And the [D]moon is the [E]only light we'll [A]see`
    },
    {
      title: 'Ang Huling El Bimbo',
      key: 'G',
      raw: `{title: Ang Huling El Bimbo}
[Intro]
G - A7 - C - G`
    },
    {
      title: 'Hotel California',
      key: 'Bm',
      raw: `{title: Hotel California}
Intro: [Bm] [F#7] [A] [E] [G] [D] [Em] [F#7]`
    },
    {
      title: 'Hallelujah',
      key: 'C',
      raw: `{title: Hallelujah}
Intro: [C] [Am] [C] [Am]`
    },
    {
      title: 'Field Case Key F',
      key: 'F',
      raw: `{title: Field Case Song}
F   C   G/B   Am   F   C   Gsus4   G`
    }
  ]

  for (const song of realSongs) {
    const baseKey = song.key

    // 1. Capture numbers output before key change (offset = 0)
    const baselineParsed = parseGtarSong(song.raw, 0)
    const baselineLine = baselineParsed.lines.find((l) => l.type === 'CHORD_ROW')
    assert.ok(baselineLine, `Song ${song.title} must have at least one chord line`)
    const baselineNumbers = convertChordLineToNashville(baselineLine.raw, baseKey)

    // 2. Step Key Plus (+1 to +6) and Step Key Minus (-1 to -6) consecutively
    for (let offset = -6; offset <= 6; offset++) {
      const targetPerformanceKey = transposeKey(baseKey, offset)

      // Assert key label changed
      if (offset !== 0) {
        assert.notEqual(targetPerformanceKey, baseKey, `Key label must change at offset ${offset}`)
      }

      // Render parsed chords at offset
      const steppedParsed = parseGtarSong(song.raw, offset)
      const steppedLine = steppedParsed.lines.find((l) => l.type === 'CHORD_ROW')
      assert.ok(steppedLine)

      // Convert rendered chords to numbers relative to performance key
      const steppedNumbers = convertChordLineToNashville(steppedLine.raw, targetPerformanceKey)

      // Assert rendered numbers are token-for-token identical to baseline (and byte-for-byte on bracketed chords)
      const extractTokens = (str) => str.trim().split(/\s+/).map((tok) => tok.replace(/^[\[<({|]+|[\]>)}|]+$/g, ''))
      assert.deepEqual(
        extractTokens(steppedNumbers),
        extractTokens(baselineNumbers),
        `Rendered numbers for ${song.title} at offset ${offset} (Key ${targetPerformanceKey}) must be token-for-token identical to baseline`
      )
      if (song.raw.includes('[') && song.raw.includes(']')) {
        // Transposed ChordPro text rendered in target key must remain byte-for-byte identical to baseline
        const { transposeChordProText } = require('../src/utils/chordTransposer.ts')
        const steppedTransposedRaw = transposeChordProText(song.raw, offset)
        const steppedChordPro = convertChordProTextToNashville(steppedTransposedRaw, targetPerformanceKey)
        const baselineChordPro = convertChordProTextToNashville(song.raw, baseKey)
        assert.equal(
          steppedChordPro,
          baselineChordPro,
          `ChordPro numbers for ${song.title} at offset ${offset} must be byte-for-byte identical`
        )
      }

      // Switch to chords mode: assert chords are transposed by the exact same interval
      if (offset === 0) {
        assert.equal(steppedLine.raw, baselineLine.raw)
      } else {
        assert.notEqual(
          steppedLine.raw,
          baselineLine.raw,
          `Chords mode for ${song.title} at offset ${offset} must show transposed chord letters`
        )
      }
    }
  }
})

test('TEST:STAGE_VIEW_NO_INDEPENDENT_KEY_STATE_AND_SINGLE_TRANSPOSE_BINDING (FIX_108_DEV_3)', () => {
  const fs = require('fs')
  const stageSrc = fs.readFileSync(path.join(__dirname, '../src/components/StageView.tsx'), 'utf8')

  // Verify manualKey state is completely removed (single transpose state drives everything)
  assert.equal(stageSrc.includes('manualKey'), false, 'StageView must not contain secondary manualKey state')
  assert.equal(stageSrc.includes('setManualKey'), false, 'StageView must not set manualKey')

  // Verify KeyPickerModal binds directly to onTransposeChange without divergence
  assert.ok(
    stageSrc.includes('onSelectOffset={(offset) => onTransposeChange(offset)}'),
    'KeyPickerModal must pass offset directly to onTransposeChange'
  )
  assert.ok(
    stageSrc.includes('onReset={() => onTransposeChange(0)}'),
    'KeyPickerModal reset must directly call onTransposeChange(0)'
  )

  // Verify single source of truth for effectivePerformanceKey
  assert.ok(
    stageSrc.includes("const effectivePerformanceKey = effectiveBaseKey ? transposeKey(effectiveBaseKey, transposeOffset) : ''"),
    'effectivePerformanceKey must be derived from effectiveBaseKey and transposeOffset'
  )
})
