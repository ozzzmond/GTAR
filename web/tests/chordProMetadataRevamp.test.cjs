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
require.extensions['.png'] = module => { module.exports = '/logo.png' }

const { parseChordProDirectives, syncCanonicalDirectives, formatCanonicalTempo } = require('../src/utils/chordProMetadata.ts')
const { normalizeMusicalKey, keysArePitchEquivalent } = require('../src/utils/musicalKey.ts')
const { parseGtarSong } = require('../src/utils/songParser.ts')
const { transposeChordToken } = require('../src/utils/chordTransposer.ts')
const { normalizeBackupSong, parseBackupJson, createBackupPayload } = require('../src/utils/jsonBackup.ts')
const { computeSongbookChecksum, songEquals } = require('../src/utils/cloudSongbookSync.ts')
const { computeSemanticSongFingerprint } = require('../src/utils/songbookFoundation.ts')

const webDir = path.resolve(__dirname, '..')

test('CHORDPRO_SIX_CANONICAL_DIRECTIVES: parseChordProDirectives parses title, artist, key, tempo, time, year and retains unknown', () => {
  const content = `{title: Amazing Grace}
{artist: John Newton}
{key: Eb}
{tempo: 96 BPM}
{time: 3/4}
{year: 1779}
{c: Verse 1}
{custom_tag: test_value}
[Eb]Amazing grace! How [Ab]sweet the [Eb]sound`

  const parsed = parseChordProDirectives(content)
  assert.equal(parsed.metadata.title, 'Amazing Grace')
  assert.equal(parsed.metadata.artist, 'John Newton')
  assert.equal(parsed.metadata.key, 'Eb')
  assert.equal(parsed.metadata.tempo, '96 BPM')
  assert.equal(parsed.metadata.time, '3/4')
  assert.equal(parsed.metadata.year, '1779')
  assert.ok(parsed.directives.some(d => d.name === 'custom_tag'))
})

test('TEMPO_FORMATTING: supports 120 and 120 BPM cleanly', () => {
  assert.equal(formatCanonicalTempo('120'), '120 BPM')
  assert.equal(formatCanonicalTempo('120 BPM'), '120 BPM')
  assert.equal(formatCanonicalTempo('95 bpm'), '95 BPM')
  assert.equal(formatCanonicalTempo(''), undefined)
  assert.equal(formatCanonicalTempo(undefined), undefined)
})

test('METADATA_SYNC_BOUNDARY: syncCanonicalDirectives writes six canonical directives and preserves unknown and body', () => {
  const original = `{title: Old Title}
{key: C}
{custom: keep_me}
[C]Old chord line`

  const synced = syncCanonicalDirectives(original, {
    title: 'New Title',
    artist: 'New Artist',
    key: 'Bb',
    bpm: '128',
    time: '6/8',
    year: '2024'
  })

  assert.match(synced, /\{title: New Title\}/)
  assert.match(synced, /\{artist: New Artist\}/)
  assert.match(synced, /\{key: Bb\}/)
  assert.match(synced, /\{tempo: 128 BPM\}/)
  assert.match(synced, /\{time: 6\/8\}/)
  assert.match(synced, /\{year: 2024\}/)
  assert.match(synced, /\{custom: keep_me\}/)
  assert.match(synced, /\[C\]Old chord line/)
  assert.doesNotMatch(synced, /\{original_key/)
  assert.doesNotMatch(synced, /\{capo/)
})

test('FLAT_KEY_PRESERVATION: preserves Bb, Eb, Ab, Db, Gb and minors without normalizing to sharps', () => {
  const flatKeys = ['Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Bbm', 'Ebm', 'Abm']
  for (const fk of flatKeys) {
    const normalized = normalizeMusicalKey(fk)
    assert.equal(normalized, fk, `Flat key ${fk} must not be converted to sharp`)
  }

  assert.equal(keysArePitchEquivalent('Bb', 'A#'), true)
  assert.equal(keysArePitchEquivalent('Eb', 'D#'), true)
  assert.equal(keysArePitchEquivalent('Gb', 'F#'), true)
  assert.equal(keysArePitchEquivalent('Db', 'C#'), true)
  assert.equal(keysArePitchEquivalent('Ab', 'G#'), true)
  assert.equal(keysArePitchEquivalent('C', 'D'), false)
})

test('ZERO_TRANSPOSE_OFFSET_PRESERVES_EXACT_AUTHORED_SPELLING', () => {
  const authored = ['Bb', 'Bbm', 'Ebmaj7', 'Ab7', 'Db/F', 'Gbdim', 'Cb']
  for (const chord of authored) {
    const zeroShifted = transposeChordToken(chord, 0)
    assert.equal(zeroShifted, chord, `Zero offset must preserve authored chord spelling for ${chord}`)
  }
})

test('TRANSPOSE_OFFSETS_AND_FLAT_EXTENSIONS: offsets -11 to +11 transpose cleanly', () => {
  assert.equal(transposeChordToken('Bb', 2), 'C')
  assert.equal(transposeChordToken('Eb', -1), 'D')
  assert.equal(transposeChordToken('Ab/C', 2), 'Bb/D')
  assert.equal(transposeChordToken('Dbmaj7', 1), 'Dmaj7')

  for (let offset = -11; offset <= 11; offset++) {
    const res = transposeChordToken('Bb', offset)
    assert.ok(res && res.length > 0, `Offset ${offset} produces valid chord`)
  }
})

test('LEGACY_READ_COMPATIBILITY: parseGtarSong reads legacy original_key, capo, and time directive', () => {
  const legacyChordPro = `{title: Legacy Song}
{artist: Heritage Band}
{key: G}
{original_key: A}
{capo: 2}
{time: 4/4}
[G]Chords here`

  const parsed = parseGtarSong(legacyChordPro)
  assert.equal(parsed.title, 'Legacy Song')
  assert.equal(parsed.key, 'G')
  assert.equal(parsed.originalKey, 'A')
  assert.equal(parsed.capo, '2')
  assert.equal(parsed.time, '4/4')
  assert.equal(parsed.lines[0].segments[0].chord, 'G')
})

test('TIME_SIGNATURE_ROUND_TRIP: persists through backup, cloud checksum, and reload', () => {
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  const song = {
    id: 's-time-1',
    title: 'Time Test',
    artist: 'Waltz',
    key: 'D',
    time: '3/4',
    rawContent: '{key: D}\n{time: 3/4}\n[D]1 2 3'
  }

  const normalized = normalizeBackupSong(song)
  assert.equal(normalized.time, '3/4')

  const backupJson = JSON.stringify(createBackupPayload([normalized], []))
  const parsedBackup = parseBackupJson(backupJson)
  assert.equal(parsedBackup.isValid, true)
  assert.equal(parsedBackup.songs[0].time, '3/4')

  const songAltTime = { ...song, time: '6/8' }
  assert.notEqual(
    computeSemanticSongFingerprint(song),
    computeSemanticSongFingerprint(songAltTime)
  )
  assert.notEqual(
    computeSongbookChecksum({ songs: [song], setlists: [] }),
    computeSongbookChecksum({ songs: [songAltTime], setlists: [] })
  )

  assert.equal(songEquals(song, song), true)
  assert.equal(songEquals(song, songAltTime), false)
})

test('NO_GETSONGBPM_REFERENCES_ANYWHERE: Zero runtime, client, functions, or config references', () => {
  const forbiddenFiles = [
    path.join(webDir, 'src/utils/songMetadata.ts'),
    path.join(webDir, 'src/components/LibraryMetadataModal.tsx'),
    path.join(webDir, 'functions/api/metadata-lookup.ts')
  ]
  for (const f of forbiddenFiles) {
    assert.equal(fs.existsSync(f), false, `Forbidden file must not exist: ${f}`)
  }

  const indexHtml = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8')
  assert.doesNotMatch(indexHtml, /getsongbpm/i, 'index.html must not contain getsongbpm references')

  const envExample = fs.readFileSync(path.join(webDir, '.env.example'), 'utf8')
  assert.doesNotMatch(envExample, /getsongbpm/i, '.env.example must not contain getsongbpm')

  const appTsx = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')
  assert.doesNotMatch(appTsx, /getsongbpm/i, 'App.tsx must not contain getsongbpm references')
  const editorTsx = fs.readFileSync(path.join(webDir, 'src/components/DesktopEditor.tsx'), 'utf8')
  assert.doesNotMatch(editorTsx, /getsongbpm/i, 'DesktopEditor.tsx must not contain getsongbpm references')
  assert.doesNotMatch(editorTsx, /LibraryMetadataModal/i, 'DesktopEditor.tsx must not reference LibraryMetadataModal')
})

test('EDITOR_INSERT_AND_ICON_ONLY_ACTIONS: DesktopEditor provides [] wrapping and accessible icon-only actions', () => {
  const editorTsx = fs.readFileSync(path.join(webDir, 'src/components/DesktopEditor.tsx'), 'utf8')

  assert.ok(editorTsx.includes('aria-label="Copy"'), 'Must have accessible Copy control')
  assert.ok(editorTsx.includes('aria-label="Paste"'), 'Must have accessible Paste control')
  assert.ok(editorTsx.includes('aria-label="Select All"'), 'Must have accessible Select All control')
  assert.ok(editorTsx.includes('aria-label="Clear"'), 'Must have accessible Clear control')

  assert.ok(editorTsx.includes('handleInsertBrackets'), 'DesktopEditor must expose [] bracket action')
  assert.ok(editorTsx.includes('aria-label="Wrap selection or insert brackets []"'), 'Bracket action must have accessible label')
})

test('AUTHORED_CHORDS_UNCHANGED_ON_ORIGINAL_KEY_EDIT: no automatic chord alignment', () => {
  const editorTsx = fs.readFileSync(path.join(webDir, 'src/components/DesktopEditor.tsx'), 'utf8')
  assert.doesNotMatch(editorTsx, /alignChartKey/, 'DesktopEditor must not invoke alignChartKey')
  assert.doesNotMatch(editorTsx, /acceptOriginalKey/, 'DesktopEditor must not invoke acceptOriginalKey')
  assert.doesNotMatch(editorTsx, /Chart Key/, 'DesktopEditor must not render Chart Key UI')
})
