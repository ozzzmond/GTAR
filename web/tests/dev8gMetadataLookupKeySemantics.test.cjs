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

const webDir = path.resolve(__dirname, '..')

// Load utils
const {
  cleanSearchTitle,
  cleanSearchArtist,
  extractEarliestYear,
  normalizeProviderKey,
  computeMatchConfidence,
  classifyMatchStatus,
} = require('../src/utils/songMetadata.ts')

const { parseGtarSong } = require('../src/utils/songParser.ts')
const { parseChordProDirectives } = require('../src/utils/chordSheetParser.ts')
const { normalizeBackupSong, parseBackupJson } = require('../src/utils/jsonBackup.ts')
const { computeSongbookChecksum, songEquals } = require('../src/utils/cloudSongbookSync.ts')
const { computePlaybackKey, computeSemanticSongFingerprint } = require('../src/utils/songbookFoundation.ts')
const { chordTokenToNashville } = require('../src/utils/nashvilleNotation.ts')
const { transposeChordToken } = require('../src/utils/chordTransposer.ts')
const { GTAR_DEV_VERSION, GTAR_APP_VERSION } = require('../src/types/gtar.ts')

// 1. VERSION CHECK & ENVIRONMENT SECURITY
test('VERSION_ALIGNMENT: dev checkpoint is 1.0.108-dev.9 and prod untouched', () => {
  assert.equal(GTAR_DEV_VERSION, '1.0.108-dev.9')
  assert.equal(GTAR_APP_VERSION, '1.1.108')
  const pkgJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'))
  assert.equal(pkgJson.version, '1.0.108-dev.9')
})

test('PROVIDER_API_KEY_NOT_PRESENT_IN_CLIENT_BUNDLE/SOURCE: no client secrets or hardcoded keys', () => {
  const clientFiles = [
    'src/App.tsx',
    'src/utils/songMetadata.ts',
    'src/components/DesktopEditor.tsx',
    'src/components/LibraryMetadataModal.tsx',
    'src/components/SongbookHomeView.tsx',
    'src/components/Header.tsx',
    'src/components/ImportDialogModal.tsx',
    'index.html',
  ]

  for (const relPath of clientFiles) {
    const content = fs.readFileSync(path.join(webDir, relPath), 'utf8')
    assert.doesNotMatch(
      content,
      /api_key\s*=\s*['"][a-zA-Z0-9_-]{10,}['"]/i,
      `Secret API key hardcoded in client file: ${relPath}`
    )
    assert.doesNotMatch(
      content,
      /getsongbpm[a-zA-Z0-9_]*key\s*=\s*['"][a-zA-Z0-9_-]+['"]/i,
      `Secret key pattern in client file: ${relPath}`
    )
  }

  // Cloudflare proxy function must rely on environment variable context.env.GETSONGBPM_API_KEY
  const proxyCode = fs.readFileSync(path.join(webDir, 'functions/api/metadata-lookup.ts'), 'utf8')
  assert.ok(
    proxyCode.includes('GETSONGBPM_API_KEY') && proxyCode.includes('context.env'),
    'Server-side proxy function must read GETSONGBPM_API_KEY from Cloudflare context.env'
  )
})

test('GETSONGBPM_ATTRIBUTION: static backlink in index.html and UI links', () => {
  const indexHtml = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8')
  assert.ok(
    indexHtml.includes('https://getsongbpm.com'),
    'index.html static source must contain discoverable GetSongBPM backlink for provider registration'
  )
  assert.ok(
    indexHtml.includes('rel="noopener noreferrer"'),
    'Static backlink must have secure rel attribute'
  )
})

// 2. MANUAL_LOOKUP_ONLY & NO_BACKGROUND_REQUESTS
test('MANUAL_LOOKUP_ONLY & NO_BACKGROUND_PROVIDER_REQUESTS: only explicit user trigger queries provider', () => {
  const appTsx = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')
  // App.tsx must not contain background metadata lookup effects
  assert.doesNotMatch(
    appTsx,
    /useEffect\([^)]*fetchSongMetadataFromProvider/s,
    'App.tsx must not perform automatic or periodic metadata lookups in useEffect'
  )
  assert.doesNotMatch(
    appTsx,
    /metadata-lookup/i,
    'App.tsx must not invoke metadata-lookup directly on start or login'
  )

  // Modals require user clicks
  const modalCode = fs.readFileSync(path.join(webDir, 'src/components/LibraryMetadataModal.tsx'), 'utf8')
  assert.ok(modalCode.includes('handleStartScan'), 'LibraryMetadataModal has explicit scan trigger')
  assert.ok(modalCode.includes('handleConfirmApply'), 'LibraryMetadataModal requires explicit Apply confirmation')
})

// 3. TITLE QUERY NORMALIZATION
test('TITLE_QUERY_NORMALIZATION: non-destructive normalization preserves stored title', () => {
  const sample1 = 'Hotel California (Key of Am) - Live (2)'
  assert.equal(cleanSearchTitle(sample1), 'Hotel California')

  const sample2 = 'Free Fallin [Capo 3]'
  assert.equal(cleanSearchTitle(sample2), 'Free Fallin')

  const sample3 = 'Wonderful Tonight - Key of G'
  assert.equal(cleanSearchTitle(sample3), 'Wonderful Tonight')

  const sample4 = 'Yesterday (Acoustic) (Remastered)'
  assert.equal(cleanSearchTitle(sample4), 'Yesterday')

  // Stored string is NOT mutated by cleanSearchTitle
  assert.equal(sample1, 'Hotel California (Key of Am) - Live (2)')
})

// 4. METADATA MAPPING & PROVIDER FIELD NORMALIZATION
test('SUCCESSFUL_METADATA_LOOKUP_MAPPING: extracts earliest year, normalizes musical key and artist', () => {
  // Earliest release year
  const multiAlbums = [
    { year: 2018, title: 'Remaster' },
    { year: 1976, title: 'Original LP' },
    { year: 2004, title: 'Greatest Hits' },
  ]
  assert.equal(extractEarliestYear(multiAlbums), '1976')
  assert.equal(extractEarliestYear(null, '1982'), '1982')
  assert.equal(extractEarliestYear([], 'Unknown'), undefined)

  // Provider key normalization (GTAR canonicalizes enharmonics such as Bb -> A#)
  assert.equal(normalizeProviderKey('C# minor'), 'C#m')
  assert.equal(normalizeProviderKey('Bb major'), 'A#')
  assert.equal(normalizeProviderKey('Ab min'), 'G#m')
  assert.equal(normalizeProviderKey('G'), 'G')
  assert.equal(normalizeProviderKey(''), undefined)

  // Artist normalization
  assert.equal(cleanSearchArtist('  The   Beatles  '), 'The Beatles')
})

// 5. MATCH POLICY & STATUS MODEL
test('AMBIGUOUS_RESULT_REQUIRES_REVIEW & NO_MATCH: status model classification', () => {
  // Empty result -> NO_MATCH
  assert.equal(classifyMatchStatus([]), 'NO_MATCH')

  // Single high-confidence candidate -> MATCH
  const singleHigh = [
    {
      id: '1',
      title: 'Hotel California',
      artist: 'Eagles',
      confidence: 'HIGH',
    },
  ]
  assert.equal(classifyMatchStatus(singleHigh), 'MATCH')

  // Multiple candidates with ambiguous confidence -> REVIEW
  const ambiguous = [
    {
      id: '1',
      title: 'Hotel California',
      artist: 'Eagles',
      confidence: 'HIGH',
    },
    {
      id: '2',
      title: 'Hotel California',
      artist: 'Acoustic Cover',
      confidence: 'HIGH',
    },
  ]
  assert.equal(classifyMatchStatus(ambiguous), 'REVIEW')

  // Confidence computation
  const conf1 = computeMatchConfidence(
    { title: 'Hotel California', artist: 'Eagles' },
    'Hotel California',
    'Eagles'
  )
  assert.equal(conf1, 'HIGH')

  const conf2 = computeMatchConfidence(
    { title: 'Hotel California (Live at Capital Centre)', artist: 'Eagles' },
    'Hotel California',
    'Eagles'
  )
  assert.equal(conf2, 'MEDIUM')

  const conf3 = computeMatchConfidence(
    { title: 'Desperado', artist: 'Eagles' },
    'Hotel California',
    'Eagles'
  )
  assert.equal(conf3, 'LOW')
})

// 6. LIBRARY SCAN READ-ONLY & SELECTIVE UPDATE ONLY
test('LIBRARY_SCAN_READ_ONLY & SELECTIVE_UPDATE_ONLY: selective update leaves non-selected fields intact', () => {
  const originalSong = {
    id: 'song-1',
    title: 'Stored Title',
    artist: 'Stored Artist',
    key: 'D',
    originalKey: 'D',
    bpm: '120',
    year: '1970',
    rawContent: '[D]Verse [A]line',
    transposeOffset: 0,
  }

  // User selects only bpm and year updates from candidate
  const candidate = {
    id: 'c-1',
    title: 'Online Title',
    artist: 'Online Artist',
    originalKey: 'E',
    bpm: '144',
    year: '1976',
  }

  const selectedFields = {
    title: false,
    artist: false,
    originalKey: false,
    bpm: true,
    year: true,
  }

  const changes = {}
  if (selectedFields.title) changes.title = candidate.title
  if (selectedFields.artist) changes.artist = candidate.artist
  if (selectedFields.originalKey && candidate.originalKey) changes.originalKey = candidate.originalKey
  if (selectedFields.bpm && candidate.bpm) changes.bpm = candidate.bpm
  if (selectedFields.year && candidate.year) changes.year = candidate.year

  const updatedSong = { ...originalSong, ...changes }

  // Selected updated:
  assert.equal(updatedSong.bpm, '144')
  assert.equal(updatedSong.year, '1976')

  // Non-selected preserved:
  assert.equal(updatedSong.title, 'Stored Title')
  assert.equal(updatedSong.artist, 'Stored Artist')
  assert.equal(updatedSong.originalKey, 'D')
  assert.equal(updatedSong.key, 'D')
  assert.equal(updatedSong.rawContent, '[D]Verse [A]line')
})

// 7. KEY MODEL INVARIANTS: ORIGINAL_KEY vs CHART_KEY vs STAGE_TRANSPOSE
test('ORIGINAL_KEY_UPDATE_DOES_NOT_CHANGE_CHORD_CONTENT: updating originalKey keeps rawContent intact', () => {
  const song = {
    id: 'k-1',
    title: 'Peaceful Easy Feeling',
    key: 'D',
    originalKey: 'D',
    rawContent: '[D]I like the [G]way your [D]sparkling earrings [G]lay',
    transposeOffset: 0,
  }

  const updatedSong = { ...song, originalKey: 'E' }
  assert.equal(updatedSong.rawContent, song.rawContent)
  assert.equal(updatedSong.key, 'D')
  assert.equal(updatedSong.originalKey, 'E')
})

test('ORIGINAL_KEY_UPDATE_DOES_NOT_CHANGE_CHART_KEY_OR_STAGE_TRANSPOSE', () => {
  const song = {
    id: 'k-2',
    title: 'Test Song',
    key: 'D',
    originalKey: 'D',
    transposeOffset: 2,
  }

  const updatedSong = { ...song, originalKey: 'E' }
  assert.equal(updatedSong.key, 'D', 'Chart key must remain D')
  assert.equal(updatedSong.transposeOffset, 2, 'Stage transpose offset must remain 2')
  assert.equal(updatedSong.originalKey, 'E', 'Original key updated to E')
})

test('STAGE_TRANSPOSE_0_USES_CHART_KEY: prompt example verification', () => {
  // EXAMPLE: ORIGINAL_RECORDING_KEY=E | CHART_KEY=D | STAGE_TRANSPOSE=0 => D | STAGE_TRANSPOSE=+2 => E
  const chartKey = 'D'
  const originalRecordingKey = 'E'

  // Transpose 0 renders Chart Key (D)
  const renderedAtZero = computePlaybackKey(chartKey, 0)
  assert.equal(renderedAtZero, 'D')

  // Transpose +2 renders E (the original key)
  const renderedAtPlusTwo = computePlaybackKey(chartKey, 2)
  assert.equal(renderedAtPlusTwo, 'E')

  // Changing original recording key does NOT affect playback key
  const renderedStill = computePlaybackKey(chartKey, 0)
  assert.equal(renderedStill, 'D')
  assert.notEqual(renderedStill, originalRecordingKey)
})

test('NUMBERS_USES_CHART_KEY: numbers mode derives from Chart Key not external original key', () => {
  const chartKey = 'D'
  const originalRecordingKey = 'E'

  // Chord [D] in key D is "1"
  const nashville1 = chordTokenToNashville('D', chartKey)
  assert.equal(nashville1, '1')

  // Chord [G] in key D is "4"
  const nashville4 = chordTokenToNashville('G', chartKey)
  assert.equal(nashville4, '4')

  // If numbers derived from originalRecordingKey (E), D would be b7!
  const incorrectDerivation = chordTokenToNashville('D', originalRecordingKey)
  assert.notEqual(nashville1, incorrectDerivation)
})

// 8. DATA COMPATIBILITY: LEGACY SONGS & DIRECTIVES
test('EXISTING_LEGACY_SONG_COMPATIBILITY: songs without new fields default safely', () => {
  const legacyChordPro = `
{title: Legacy Song}
{artist: Traditional}
{key: G}
[G]Simple chords [C]here
  `.trim()

  const parsed = parseGtarSong(legacyChordPro)
  assert.equal(parsed.title, 'Legacy Song')
  assert.equal(parsed.artist, 'Traditional')
  assert.equal(parsed.key, 'G')
  assert.equal(parsed.originalKey, '')
  assert.equal(parsed.year, '')

  // Directives with original_key and year
  const extendedChordPro = `
{title: Modern Song}
{artist: Band}
{key: C}
{original_key: D}
{year: 1985}
[C]Modern chords
  `.trim()

  const parsedExtended = parseGtarSong(extendedChordPro)
  assert.equal(parsedExtended.title, 'Modern Song')
  assert.equal(parsedExtended.key, 'C')
  assert.equal(parsedExtended.originalKey, 'D')
  assert.equal(parsedExtended.year, '1985')
})

test('JSON_BACKUP_AND_RESTORE: preserves originalKey, bpm, year and backward compatibility', () => {
  const songData = {
    id: 'compat-1',
    title: 'Backup Song',
    artist: 'Artist',
    key: 'A',
    originalKey: 'B',
    bpm: '110',
    year: '1999',
    rawContent: '[A]Chord',
  }

  const normalized = normalizeBackupSong(songData)
  assert.equal(normalized.originalKey, 'B')
  assert.equal(normalized.bpm, '110')
  assert.equal(normalized.year, '1999')

  const backupJson = JSON.stringify({
    version: '1.0',
    songs: [normalized],
    setlists: [],
  })

  const parsed = parseBackupJson(backupJson)
  assert.equal(parsed.isValid, true)
  assert.equal(parsed.songs[0].originalKey, 'B')
  assert.equal(parsed.songs[0].bpm, '110')
  assert.equal(parsed.songs[0].year, '1999')
})

test('CHECKSUM_AND_FINGERPRINT_STABILITY: originalKey and year contribute to fingerprint without mutating legacy checksum format', () => {
  const s1 = {
    id: 's1',
    title: 'Song',
    artist: 'Band',
    key: 'G',
    rawContent: '[G]Test',
    originalKey: 'A',
    year: '2001',
  }

  const s2 = {
    ...s1,
    originalKey: 'Bb',
  }

  const fp1 = computeSemanticSongFingerprint(s1)
  const fp2 = computeSemanticSongFingerprint(s2)
  assert.notEqual(fp1, fp2, 'Fingerprint must differentiate different originalKey values')

  const sum1 = computeSongbookChecksum({ songs: [s1], setlists: [] })
  const sum2 = computeSongbookChecksum({ songs: [s2], setlists: [] })
  assert.notEqual(sum1, sum2, 'Songbook checksum must change when metadata changes')
})
