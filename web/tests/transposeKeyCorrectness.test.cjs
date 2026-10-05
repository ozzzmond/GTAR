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


test('108-dev.3a: KeyPickerModal contains ZERO obsolete branding and zero redundant tutorial copy', () => {
  const modalSrc = fs.readFileSync(path.join(__dirname, '../src/components/KeyPickerModal.tsx'), 'utf8')

  // Obsolete branding and outdated copy removed
  assert.equal(modalSrc.includes('v1.0.42'), false, 'KeyPickerModal must not contain obsolete v1.0.42 branding')
  assert.equal(modalSrc.toLowerCase().includes('pitch pitcher'), false, 'KeyPickerModal must not contain Pitch Pitcher text')
  assert.equal(modalSrc.includes('Tip: Click any target key to apply instantly'), false, 'KeyPickerModal must not contain tutorial footer')
  assert.equal(modalSrc.includes('Sparkles'), false, 'KeyPickerModal must not import or render Sparkles icon')
})

test('108-dev.3a: KeyPickerModal contains ZERO capo guidance, suggestions, or calculations', () => {
  const modalSrc = fs.readFileSync(path.join(__dirname, '../src/components/KeyPickerModal.tsx'), 'utf8')

  // Capo math block and calculations removed
  assert.equal(modalSrc.includes('Capo Math'), false, 'KeyPickerModal must not contain Capo Math block')
  assert.equal(modalSrc.includes('recommendedCapoFret'), false, 'KeyPickerModal must not calculate recommendedCapoFret')
  assert.equal(modalSrc.includes('Song default capo'), false, 'KeyPickerModal must not display song default capo')
  assert.equal(modalSrc.includes('Standard concert pitch'), false, 'KeyPickerModal must not contain concert pitch text')

  // Zero capo fret suggestions in target key rows (e.g. Capo 1 .. Capo 11)
  const capoFretRegex = /Capo\s+\d+/i
  assert.equal(capoFretRegex.test(modalSrc), false, 'KeyPickerModal must not contain any Capo fret suggestions')
  for (let fret = 1; fret <= 11; fret++) {
    assert.equal(modalSrc.includes(`Capo ${fret}`), false, `KeyPickerModal must not contain Capo ${fret}`)
  }
})

test('108-dev.3a: KeyPickerModal preserves musician-focused transpose tools and single-state binding', () => {
  const modalSrc = fs.readFileSync(path.join(__dirname, '../src/components/KeyPickerModal.tsx'), 'utf8')
  const stageSrc = fs.readFileSync(path.join(__dirname, '../src/components/StageView.tsx'), 'utf8')
  const appSrc = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')

  // Core header and key status cards intact
  assert.ok(modalSrc.includes('Transpose Key'), 'KeyPickerModal must display Transpose Key title')
  assert.ok(modalSrc.includes('Original Key'), 'KeyPickerModal must display Original Key')
  assert.ok(modalSrc.includes('Transposed Key'), 'KeyPickerModal must display Transposed Key')
  assert.ok(modalSrc.includes('Reset (0)'), 'KeyPickerModal must provide Reset (0) button')
  assert.ok(modalSrc.includes('Select Target Key or Semitone Shift:'), 'KeyPickerModal must have shift selection label')
  assert.ok(modalSrc.includes('[-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]'), 'KeyPickerModal must cover -6 to +6 offsets')
  assert.ok(modalSrc.includes('(Original)'), 'KeyPickerModal must mark offset 0 as (Original)')

  // StageView and App invocations have zero capo binding
  assert.equal(stageSrc.includes('<KeyPickerModal\n        isOpen={isKeyPickerOpen}\n        onClose={() => setIsKeyPickerOpen(false)}\n        originalKey={effectiveBaseKey || \'C\'}\n        currentOffset={transposeOffset}\n        capoText='), false, 'StageView must not pass capoText to KeyPickerModal')
  assert.equal(appSrc.includes('capoText={currentSong.capo}'), false, 'App.tsx must not pass capoText to KeyPickerModal')

  // StageView preserves song.capo in stage cast / metadata
  assert.ok(stageSrc.includes('capo: song.capo'), 'StageView must preserve song.capo for broadcast/metadata')
})
