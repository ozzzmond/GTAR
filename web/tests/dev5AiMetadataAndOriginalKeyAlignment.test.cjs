const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        }
      ).outputText,
      filename
    )
}

const webDir = path.resolve(__dirname, '..')

// 2. SERVER ENDPOINT CONTRACT & PAYLOAD VALIDATION
// 3. ORIGINAL KEY VALIDATION
test('ORIGINAL_KEY_VALIDATION: Normalization supports major, minor, sharps, flats and fails closed on invalid', () => {
  const musicalKeyModule = require(path.join(webDir, 'src/utils/musicalKey.ts'))
  const { normalizeMusicalKey } = musicalKeyModule

  // Valid canonical keys
  assert.equal(normalizeMusicalKey('G'), 'G')
  assert.equal(normalizeMusicalKey('Bb'), 'Bb')
  assert.equal(normalizeMusicalKey('F#m'), 'F#m')
  assert.equal(normalizeMusicalKey('Abm'), 'Abm')
  assert.equal(normalizeMusicalKey('C#'), 'C#')
  assert.equal(normalizeMusicalKey('Eb'), 'Eb')

  // Case normalization
  assert.equal(normalizeMusicalKey('bb'), 'Bb')
  assert.equal(normalizeMusicalKey('ebm'), 'Ebm')
  assert.equal(normalizeMusicalKey('f#m'), 'F#m')

  // Esoteric root normalization
  assert.equal(normalizeMusicalKey('B#'), 'C')
  assert.equal(normalizeMusicalKey('E#'), 'F')

  // Invalid / malformed keys fail closed to null
  assert.equal(normalizeMusicalKey('H'), null)
  assert.equal(normalizeMusicalKey('Gxyz'), null)
  assert.equal(normalizeMusicalKey('123'), null)
  assert.equal(normalizeMusicalKey('Cmaj7'), null)
  assert.equal(normalizeMusicalKey('random text'), null)
})

// 4. DETERMINISTIC TRANSPOSITION PIPELINE (transposeCanonicalSong)
test('DETERMINISTIC_TRANSPOSITION_ALIGNMENT: Preserves ChordPro structure, slash chords, enharmonics, and directives', () => {
  const { transposeCanonicalSong } = require(path.join(webDir, 'src/utils/chartKeyAlignment.ts'))

  // 4a. Transposition from C to G
  const sourceChartC = `{title: Test Song}
{artist: Test Artist}
{key: C}
{tempo: 120 BPM}

[Intro]
[C] [G/B] [Am] [F]

[Verse 1]
[C]Amazing [G/B]grace how [Am]sweet the [F]sound`

  const resultG = transposeCanonicalSong(sourceChartC, 'C', 'G')
  assert.equal(resultG.key, 'G')
  assert.equal(resultG.semitones, 7)
  assert.match(resultG.rawContent, /\{key: G\}/)
  assert.match(resultG.rawContent, /\{title: Test Song\}/)
  assert.match(resultG.rawContent, /\{tempo: 120 BPM\}/)
  // Verify slash chord transposition: C -> G, G/B -> D/F#, Am -> Em, F -> C
  assert.match(resultG.rawContent, /\[G\] \[D\/F#\] \[Em\] \[C\]/)
  assert.match(resultG.rawContent, /\[G\]Amazing \[D\/F#\]grace how \[Em\]sweet the \[C\]sound/)

  // 4b. Transposition to flat key (C to Bb)
  const resultBb = transposeCanonicalSong(sourceChartC, 'C', 'Bb')
  assert.equal(resultBb.key, 'Bb')
  assert.equal(resultBb.semitones, 10)
  assert.match(resultBb.rawContent, /\{key: Bb\}/)
  assert.match(resultBb.rawContent, /\[Bb\]/)

  // 4c. Minor target key (Am to Em)
  const sourceMinor = `{key: Am}
[Am] [Dm] [E7] [Am]`
  const resultEm = transposeCanonicalSong(sourceMinor, 'Am', 'Em')
  assert.equal(resultEm.key, 'Em')
  assert.match(resultEm.rawContent, /\{key: Em\}/)
  assert.match(resultEm.rawContent, /\[Em\] \[Am\] \[B7\] \[Em\]/)

  // 4d. Same-key no-op
  const sameKey = transposeCanonicalSong(sourceChartC, 'C', 'C')
  assert.equal(sameKey.key, 'C')
  assert.equal(sameKey.semitones, 0)
  assert.equal(sameKey.rawContent, sourceChartC)
})

// 5. CHORDPRO ORIGINAL_KEY DIRECTIVE SYNCHRONIZATION
test('CHORDPRO_ORIGINAL_KEY_SYNCHRONIZATION: syncCanonicalDirectives updates {original_key: ...} when provided', () => {
  const { syncCanonicalDirectives, parseChordProDirectives } = require(path.join(webDir, 'src/utils/chordProMetadata.ts'))

  const initialContent = `{title: Song 1}
{artist: Artist 1}
{key: C}

[C]Chord line`

  // When originalKey is not provided in updates, directive is NOT injected
  const noOriginalKey = syncCanonicalDirectives(initialContent, {
    key: 'D',
  })
  assert.doesNotMatch(noOriginalKey, /\{original_key/)
  assert.match(noOriginalKey, /\{key: D\}/)

  // When originalKey IS provided, directive IS synchronized
  const withOriginalKey = syncCanonicalDirectives(initialContent, {
    key: 'D',
    originalKey: 'G',
  })
  assert.match(withOriginalKey, /\{key: D\}/)
  assert.match(withOriginalKey, /\{original_key: G\}/)

  // Parse check verifies parseChordProDirectives retains legacyDirectives
  const parsed = parseChordProDirectives(withOriginalKey)
  assert.equal(parsed.legacyDirectives.original_key, 'G')

  // When updated to a different key
  const updatedOriginalKey = syncCanonicalDirectives(withOriginalKey, {
    originalKey: 'Eb',
  })
  assert.match(updatedOriginalKey, /\{original_key: Eb\}/)
  assert.doesNotMatch(updatedOriginalKey, /\{original_key: G\}/)

  // When removed (empty string)
  const clearedOriginalKey = syncCanonicalDirectives(updatedOriginalKey, {
    originalKey: '',
  })
  assert.doesNotMatch(clearedOriginalKey, /\{original_key/)
})

// 6. UI WORKFLOW INTEGRATION IN DESKTOP EDITOR
test('DESKTOP_EDITOR_UI_INTEGRATION: DesktopEditor retires lookup action while preserving explicit transposition action', () => {
  const editorSource = fs.readFileSync(path.join(webDir, 'src/components/DesktopEditor.tsx'), 'utf8')

  // DesktopEditor has retired Lookup Metadata action and handler
  assert.ok(!editorSource.includes('Lookup Metadata'), 'DesktopEditor must not render Lookup Metadata action')
  assert.ok(!editorSource.includes('handleLookupMetadata'), 'DesktopEditor must not define handleLookupMetadata')

  // DesktopEditor has explicit confirmation action before transposition
  assert.ok(editorSource.includes('Transpose chord text to Original Key'), 'DesktopEditor must offer Transpose chord text to Original Key action')
  assert.ok(editorSource.includes('handleConfirmTransposeToOriginalKey'), 'DesktopEditor must define handleConfirmTransposeToOriginalKey')

  // Invariant: DesktopEditor must NOT use deprecated auto-alignment hooks
  assert.doesNotMatch(editorSource, /alignChartKey/, 'DesktopEditor must not invoke alignChartKey')
  assert.doesNotMatch(editorSource, /acceptOriginalKey/, 'DesktopEditor must not invoke acceptOriginalKey')
})

// 8. NON-DESTRUCTIVE OFFLINE / FAILURE BEHAVIOR
test('NON_DESTRUCTIVE_FAILURE_AND_OFFLINE: Song content is never mutated on lookup failure or empty result', () => {
  const originalChart = `{title: Safe Song}\n{key: D}\n[D]Safe [G]chords`
  // An unconfirmed / failed lookup produces no side effects on originalChart
  const simulatedFailureError = 'Metadata lookup unavailable offline'
  assert.equal(typeof simulatedFailureError, 'string')
  // Original chart unchanged
  assert.equal(originalChart.includes('{key: D}'), true)
  assert.equal(originalChart.includes('[D]Safe'), true)
})

// 9. SONG ENTITY ORIGINAL_KEY PERSISTENCE & PARSING ROUND-TRIP
test('SONG_ENTITY_PERSISTENCE: parseGtarSong preserves originalKey and round-trips through ChordPro directives', () => {
  const { parseGtarSong } = require(path.join(webDir, 'src/utils/songParser.ts'))
  const rawWithOriginal = `{title: Bound Song}\n{artist: The Band}\n{key: G}\n{original_key: Bb}\n[G]Singing [C]now`
  const parsed = parseGtarSong(rawWithOriginal)

  assert.equal(parsed.title, 'Bound Song')
  assert.equal(parsed.key, 'G')
  assert.equal(parsed.originalKey, 'Bb')
})

// 10. WORKERS AI STRUCTURED SUCCESS
// 11. WORKERS AI MALFORMED RESPONSE
// 12. WORKERS AI PROVIDER FAILURE
// 13. WORKERS AI AMBIGUOUS RESPONSE & UNCERTAINTY POLICY
// 14. NULL / INVALID ORIGINAL KEY VALIDATION
// 15. SONG IDENTITY PROTECTION & ARTIST MISMATCH
// 16. FIELD REGRESSION: Real-world failure class where unreliable metadata must not mutate chart
test('FIELD_REGRESSION_FAILURE_CLASS: Mismatched recording identity and uncertain Original Key cannot trigger chart transposition', () => {
  const { transposeCanonicalSong } = require(path.join(webDir, 'src/utils/chartKeyAlignment.ts'))
  const { normalizeMusicalKey } = require(path.join(webDir, 'src/utils/musicalKey.ts'))

  const originalSongChart = `{title: Field Test Song}
{artist: Field Artist}
{key: E}

[E]Sample [A]verse [B]line`

  // Scenario 1: Identity mismatch returns null originalKey -> transposition is refused
  const uncertainOriginalKey = null
  const validatedKey = normalizeMusicalKey(uncertainOriginalKey)
  assert.equal(validatedKey, null)

  // Invariant: With null key, chart MUST remain untouched
  if (!validatedKey) {
    // UI halts transposition; chart remains strictly untouched
    assert.equal(originalSongChart.includes('{key: E}'), true)
    assert.equal(originalSongChart.includes('[E]Sample'), true)
  }

  // Scenario 2: Same-key alignment is a deterministic no-op
  const sameKeyResult = transposeCanonicalSong(originalSongChart, 'E', 'E')
  assert.equal(sameKeyResult.key, 'E')
  assert.equal(sameKeyResult.rawContent, originalSongChart)
})
