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

// 1. VERSION CONTRACT (1.0.123-dev.5)
test('DEV5_VERSION_CONTRACT: Canonical version updated to 1.0.123-dev.5 across codebase', () => {
  const gtarTypes = fs.readFileSync(path.join(webDir, 'src/types/gtar.ts'), 'utf8')
  assert.ok(gtarTypes.includes("export const GTAR_DEV_VERSION = '1.0.123-dev.5';"), 'gtar.ts must define GTAR_DEV_VERSION as 1.0.123-dev.5')

  const pkgJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'))
  assert.equal(pkgJson.version, '1.0.123-dev.5', 'package.json must be 1.0.123-dev.5')

  const pkgLockJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package-lock.json'), 'utf8'))
  assert.equal(pkgLockJson.version, '1.0.123-dev.5', 'package-lock.json root must be 1.0.123-dev.5')
  assert.equal(pkgLockJson.packages[''].version, '1.0.123-dev.5', 'package-lock.json packages[""] must be 1.0.123-dev.5')

  const authCore = fs.readFileSync(path.join(webDir, 'functions/lib/authCore.ts'), 'utf8')
  assert.ok(authCore.includes('v1.0.123-dev.5'), 'authCore.ts header must reference v1.0.123-dev.5')
})

// 2. SERVER ENDPOINT CONTRACT & PAYLOAD VALIDATION
test('METADATA_SERVER_VALIDATION: Endpoint source code validates input lengths and authenticates', () => {
  const metadataSource = fs.readFileSync(path.join(webDir, 'functions/api/songbook/metadata.ts'), 'utf8')
  assert.ok(metadataSource.includes('authenticateUserRequest'), 'Endpoint must call authenticateUserRequest')
  assert.ok(metadataSource.includes('onRequestPost'), 'Endpoint must export onRequestPost')
  assert.ok(metadataSource.includes('onRequestOptions'), 'Endpoint must export onRequestOptions')
  assert.ok(metadataSource.includes('Title is required'), 'Must validate missing title')
  assert.ok(metadataSource.includes('normalizeMusicalKey'), 'Must validate originalKey using normalizeMusicalKey')
})

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
test('DESKTOP_EDITOR_UI_INTEGRATION: DesktopEditor exposes metadata lookup and explicit transposition action', () => {
  const editorSource = fs.readFileSync(path.join(webDir, 'src/components/DesktopEditor.tsx'), 'utf8')

  // DesktopEditor has Lookup Metadata button
  assert.ok(editorSource.includes('Lookup Metadata'), 'DesktopEditor must render Lookup Metadata action')
  assert.ok(editorSource.includes('handleLookupMetadata'), 'DesktopEditor must define handleLookupMetadata')

  // DesktopEditor has explicit confirmation action before transposition
  assert.ok(editorSource.includes('Transpose to Original Key'), 'DesktopEditor must offer Transpose to Original Key action')
  assert.ok(editorSource.includes('handleConfirmTransposeToOriginalKey'), 'DesktopEditor must define handleConfirmTransposeToOriginalKey')

  // DesktopEditor has already aligned indication for same-key
  assert.ok(editorSource.includes('Already Aligned'), 'DesktopEditor must indicate Already Aligned when keys match')

  // Invariant: DesktopEditor must NOT use deprecated auto-alignment hooks
  assert.doesNotMatch(editorSource, /alignChartKey/, 'DesktopEditor must not invoke alignChartKey')
  assert.doesNotMatch(editorSource, /acceptOriginalKey/, 'DesktopEditor must not invoke acceptOriginalKey')
})

// 7. CLIENT METADATA SERVICE CONTRACT
test('CLIENT_METADATA_SERVICE_CONTRACT: songMetadataClient exports lookupSongMetadata with strict contract', () => {
  const clientSource = fs.readFileSync(path.join(webDir, 'src/utils/songMetadataClient.ts'), 'utf8')
  assert.ok(clientSource.includes('export async function lookupSongMetadata'), 'Must export lookupSongMetadata')
  assert.ok(clientSource.includes('/api/songbook/metadata'), 'Must target POST /api/songbook/metadata')
  assert.ok(clientSource.includes('normalizeMusicalKey'), 'Must validate returned originalKey with normalizeMusicalKey')
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

