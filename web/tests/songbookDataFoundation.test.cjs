const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')

require.extensions['.ts'] = (module, filename) => {
  module._compile(
    ts.transpileModule(
      fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }
    ).outputText,
    filename
  )
}

const { generateUUID, isValidUUID } = require('../src/utils/uuid.ts')
const {
  normalizeSongbookIds,
  validateSongbookIntegrity,
  inspectTransposeDuplicates,
  getCanonicalReferenceKey,
  computePlaybackKey,
  normalizeTitleForTransposeComparison,
} = require('../src/utils/songbookFoundation.ts')
const { GTAR_DEV_VERSION } = require('../src/types/gtar.ts')
const { createBackupPayload, parseBackupJson } = require('../src/utils/jsonBackup.ts')
const { chordTokenToNashville, getTrustworthySongKey } = require('../src/utils/nashvilleNotation.ts')

test('VERSION_STAMP: Target iteration rolled to v1.0.123-dev.5', () => {
  assert.equal(GTAR_DEV_VERSION, '1.0.123-dev.5')
})

test('NEW_SONG_IDS_ARE_VALID_STRING_UUIDS: generateUUID outputs valid RFC4122 v4 UUID strings', () => {
  for (let i = 0; i < 50; i++) {
    const id = generateUUID()
    assert.equal(typeof id, 'string')
    assert.ok(isValidUUID(id), `Generated ID "${id}" must be recognized as valid UUID`)
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      `UUID "${id}" must conform to RFC4122 v4`
    )
  }
})

test('CREATE+IMPORT+ONLINE_IMPORT+BANDSYNC_RELEVANT_ID_PATHS_NO_LONGER_USE_DATE_NOW_IDS', () => {
  const appSrc = fs.readFileSync(require.resolve('../src/App.tsx'), 'utf8')

  // Forbidden patterns: id: Date.now(), id: `setlist-${Date.now()}`, id: `synced-set-${Date.now()}`
  assert.doesNotMatch(appSrc, /\bid:\s*Date\.now\(\)/, 'App.tsx must not assign Date.now() to any id field')
  assert.doesNotMatch(
    appSrc,
    /\bid:\s*`[^`]*Date\.now\(\)[^`]*`/,
    'App.tsx must not use Date.now() in template strings for IDs'
  )
  assert.doesNotMatch(
    appSrc,
    /Date\.now\(\)\s*\+\s*Math\.floor/,
    'App.tsx must not use pseudo-random timestamp math for IDs'
  )
  assert.doesNotMatch(
    appSrc,
    /setlist-\$\{Date\.now\(\)\}/,
    'App.tsx must not use setlist-${Date.now()} for new setlists'
  )
})

test('LEGACY_NUMERIC_SONG_ID_NORMALIZES_TO_UUID: converts numeric and undefined IDs to string UUIDs', () => {
  const legacySongs = [
    { id: 1, title: 'Stand By Me', artist: 'Ben E. King', key: 'A', rawContent: '[A]Stand by me' },
    { id: 2, title: 'El Bimbo', artist: 'Eraserheads', key: 'G', rawContent: '[G]El Bimbo' },
    { id: undefined, title: 'Untitled', artist: '', key: 'C', rawContent: '[C]Untitled' },
  ]
  const legacySetlists = [
    {
      id: 'gig-1',
      name: 'Gig Set',
      songs: [
        { id: 1, title: 'Stand By Me', artist: 'Ben E. King' },
        { id: 2, title: 'El Bimbo', artist: 'Eraserheads' },
      ],
    },
  ]

  const result = normalizeSongbookIds(legacySongs, legacySetlists)
  assert.equal(result.migrated, true)
  assert.equal(result.songs.length, 3)

  for (const song of result.songs) {
    assert.equal(typeof song.id, 'string')
    assert.ok(isValidUUID(song.id), `Song ID ${song.id} must be a valid UUID`)
  }

  // Setlist references rebound to the new UUIDs
  assert.equal(result.setlists[0].songs[0].id, result.songs[0].id)
  assert.equal(result.setlists[0].songs[1].id, result.songs[1].id)
})

test('SETLIST_REFERENCE_REBINDS_TO_NORMALIZED_UUID: binds legacy title-only references to new UUIDs', () => {
  const existingUUID = 'd1080001-0001-4000-8000-000000000001'
  const songs = [
    { id: existingUUID, title: 'Hotel California', artist: 'Eagles', key: 'Bm', rawContent: '[Bm]Welcome' },
    { id: 42, title: 'Hallelujah', artist: 'Leonard Cohen', key: 'C', rawContent: '[C]Secret chord' },
  ]
  const setlists = [
    {
      id: 'acoustic-set',
      name: 'Acoustic Set',
      songs: [
        { title: 'Hotel California', artist: 'Eagles' }, // Unbound reference
        { id: 42, title: 'Hallelujah', artist: 'Leonard Cohen' }, // Numeric ID reference
      ],
    },
  ]

  const result = normalizeSongbookIds(songs, setlists)
  assert.equal(result.songs[0].id, existingUUID, 'Existing valid UUID must remain unchanged')
  assert.ok(isValidUUID(result.songs[1].id), 'Numeric ID must be upgraded to UUID')

  assert.equal(result.setlists[0].songs[0].id, existingUUID, 'Unbound ref must bind to existing song UUID')
  assert.equal(result.setlists[0].songs[1].id, result.songs[1].id, 'Numeric ref must bind to newly assigned UUID')
})

test('MIGRATION_IS_IDEMPOTENT: repeated normalization does not alter valid UUIDs or setlist bindings', () => {
  const songId1 = 'c0000001-0000-4000-8000-000000000001'
  const songId2 = 'c0000001-0000-4000-8000-000000000002'
  const setlistId = 's0000001-0000-4000-8000-000000000001'

  const library = {
    songs: [
      { id: songId1, title: 'Song One', artist: 'Artist One', key: 'G', rawContent: '[G]Lyrics' },
      { id: songId2, title: 'Song Two', artist: 'Artist Two', key: 'D', rawContent: '[D]Lyrics' },
    ],
    setlists: [
      {
        id: setlistId,
        name: 'Main Set',
        songs: [
          { id: songId1, title: 'Song One', artist: 'Artist One' },
          { id: songId2, title: 'Song Two', artist: 'Artist Two' },
        ],
      },
    ],
  }

  const pass1 = normalizeSongbookIds(library.songs, library.setlists)
  assert.equal(pass1.migrated, false, 'Already normalized library must report migrated=false')
  assert.equal(pass1.songs[0].id, songId1)
  assert.equal(pass1.songs[1].id, songId2)
  assert.equal(pass1.setlists[0].songs[0].id, songId1)
  assert.equal(pass1.setlists[0].songs[1].id, songId2)

  const pass2 = normalizeSongbookIds(pass1.songs, pass1.setlists)
  assert.equal(pass2.migrated, false)
  assert.deepEqual(pass2.songs, pass1.songs)
  assert.deepEqual(pass2.setlists, pass1.setlists)
})

test('MIGRATION_PRESERVES_SONG_COUNT+CONTENT+SETLIST_ORDER: zero data loss across all fields', () => {
  const songs = [
    {
      id: 101,
      title: 'Full Featured Song',
      artist: 'Feature Artist',
      key: 'F#m',
      capo: 'Capo 3',
      bpm: '135',
      format: 'CHORD_PRO',
      transposeOffset: 2,
      rawContent: '{title: Full Featured Song}\n[F#m]Verse\n',
      tags: 'Rock, Favorite',
      isFavorite: true,
      isDeleted: false,
      createdAt: 1727500000000,
      lastOpenedAt: 1727560000000,
    },
  ]
  const setlists = [
    {
      id: 'set-order-1',
      name: 'Order Test',
      songs: [{ id: 101, title: 'Full Featured Song', artist: 'Feature Artist' }],
    },
  ]

  const result = normalizeSongbookIds(songs, setlists)
  assert.equal(result.songs.length, 1)
  const norm = result.songs[0]
  assert.ok(isValidUUID(norm.id))
  assert.equal(norm.title, 'Full Featured Song')
  assert.equal(norm.artist, 'Feature Artist')
  assert.equal(norm.key, 'F#m')
  assert.equal(norm.capo, 'Capo 3')
  assert.equal(norm.bpm, '135')
  assert.equal(norm.format, 'CHORD_PRO')
  assert.equal(norm.transposeOffset, 2)
  assert.equal(norm.rawContent, '{title: Full Featured Song}\n[F#m]Verse\n')
  assert.equal(norm.tags, 'Rock, Favorite')
  assert.equal(norm.isFavorite, true)
  assert.equal(norm.isDeleted, false)
  assert.equal(norm.createdAt, 1727500000000)
  assert.equal(norm.lastOpenedAt, 1727560000000)
  assert.equal(result.setlists[0].songs[0].id, norm.id)
})

test('NO_DANGLING_REFS_AFTER_SUCCESSFUL_NORMALIZATION', () => {
  const songs = [
    { id: 1, title: 'Song A', artist: 'Artist A', rawContent: '[C]Text' },
    { id: 2, title: 'Song B', artist: 'Artist B', rawContent: '[G]Text' },
  ]
  const setlists = [
    {
      id: 's1',
      name: 'Setlist 1',
      songs: [
        { id: 1, title: 'Song A', artist: 'Artist A' },
        { id: 2, title: 'Song B', artist: 'Artist B' },
      ],
    },
  ]

  const normalized = normalizeSongbookIds(songs, setlists)
  const report = validateSongbookIntegrity(normalized.songs, normalized.setlists)
  assert.equal(report.isValid, true, `Report should be valid: ${report.errors.join('; ')}`)
  assert.equal(report.danglingReferences.length, 0)
  assert.equal(report.duplicateSongIds.length, 0)
  assert.equal(report.invalidSongUuids.length, 0)
})

test('BACKUP_ROUND_TRIP_REMAINS_VALID with normalized UUID library', () => {
  global.localStorage = { getItem: () => null }
  const songId = generateUUID()
  const songs = [{ id: songId, title: 'Roundtrip Song', artist: 'Tester', key: 'C', rawContent: '[C]Hello' }]
  const setlists = [{ id: 'rt-set', name: 'RT Set', songs: [{ id: songId, title: 'Roundtrip Song', artist: 'Tester' }] }]

  const payload = createBackupPayload(songs, setlists)
  const parsed = parseBackupJson(JSON.stringify(payload))
  assert.equal(parsed.isValid, true, parsed.error)
  assert.equal(parsed.songs[0].id, songId)
  assert.equal(parsed.setlists[0].songs[0].id, songId)
})

test('REFERENCE_KEY+TRANSPOSE_OFFSET_BEHAVIOR_UNCHANGED: canonical key does not guess from chords', () => {
  const explicitSong = { key: 'E', rawContent: '{title: Explicit}\n[A] [B] [C#m]' }
  assert.equal(getCanonicalReferenceKey(explicitSong), 'E')

  const directiveSong = { key: '', rawContent: '{title: Directive}\n{key: F#m}\n[F#m] [D] [E]' }
  assert.equal(getCanonicalReferenceKey(directiveSong), 'F#m')

  // Transpose offset modifies display key dynamically without mutating canonical key or chords
  const canonicalKey = 'A'
  const offset = 2
  const runtimeDisplayKey = computePlaybackKey(canonicalKey, offset)
  assert.equal(runtimeDisplayKey, 'B')
  assert.equal(canonicalKey, 'A', 'Canonical reference key remains unchanged')
  assert.equal(explicitSong.rawContent, '{title: Explicit}\n[A] [B] [C#m]', 'rawContent remains unmodified')
})

test('NUMBERS_NOTATION_REMAINS_PRESENTATION_ONLY: translates on-the-fly and preserves rawContent', () => {
  const song = {
    key: 'G',
    rawContent: '[G]Amazing [C]Grace how [D]sweet the [Em]sound',
  }

  const key = getTrustworthySongKey(song.key, song.rawContent)
  assert.equal(key, 'G')

  assert.equal(chordTokenToNashville('G', key), '1')
  assert.equal(chordTokenToNashville('C', key), '4')
  assert.equal(chordTokenToNashville('D', key), '5')
  assert.equal(chordTokenToNashville('Em', key), '6m')

  // Verify rawContent is 100% unmodified
  assert.equal(song.rawContent, '[G]Amazing [C]Grace how [D]sweet the [Em]sound')
})

test('TRANSPOSE_COPY_DETECTOR_FLAGS_CLEAR_TRANSPOSE_ONLY_FIXTURE: detects identical lyrics with uniform shift', () => {
  const songA = {
    id: generateUUID(),
    title: 'Stand By Me',
    artist: 'Ben E. King',
    key: 'A',
    rawContent: `{title: Stand By Me}\n{artist: Ben E. King}\n{key: A}\n\n[Verse 1]\nWhen the [A]night has come and the [F#m]land is dark\nAnd the [D]moon is the [E]only light we'll [A]see`,
  }
  const songB = {
    id: generateUUID(),
    title: 'Stand By Me (Key of G)',
    artist: 'Ben E. King',
    key: 'G',
    rawContent: `{title: Stand By Me (Key of G)}\n{artist: Ben E. King}\n{key: G}\n\n[Verse 1]\nWhen the [G]night has come and the [Em]land is dark\nAnd the [C]moon is the [D]only light we'll [G]see`,
  }

  const report = inspectTransposeDuplicates([songA, songB])
  assert.equal(report.candidates.length, 1)
  const candidate = report.candidates[0]
  assert.equal(candidate.originalTitle, 'Stand By Me')
  assert.equal(candidate.candidateTitle, 'Stand By Me (Key of G)')
  assert.equal(candidate.semitoneDelta, -2) // A -> G is -2 semitones
  assert.equal(candidate.confidence, 'high')
  assert.match(candidate.evidence, /uniform -2 semitone transposition/)
})

test('TRANSPOSE_COPY_DETECTOR_DOES_NOT_COLLAPSE_GENUINE_ARRANGEMENT_FIXTURE: respects lyric and chord differences', () => {
  const songA = {
    id: generateUUID(),
    title: 'Amazing Grace',
    artist: 'Traditional',
    key: 'G',
    rawContent: '[G]Amazing grace how [C]sweet the [G]sound\nThat saved a [D]wretch like me',
  }
  // Alternate arrangement with reharmonized chords (non-uniform shift)
  const songB = {
    id: generateUUID(),
    title: 'Amazing Grace (Jazz Reharm)',
    artist: 'Traditional',
    key: 'G',
    rawContent: '[Gmaj7]Amazing grace how [C9]sweet the [Bm7]sound\nThat saved a [Am7]wretch [D7b9]like me',
  }
  // Alternate arrangement with additional verse lyrics
  const songC = {
    id: generateUUID(),
    title: 'Amazing Grace (Extended Acoustic)',
    artist: 'Traditional',
    key: 'A',
    rawContent: '[A]Amazing grace how [D]sweet the [A]sound\nThat saved a [E]wretch like me\n[A]Twas grace that taught my [D]heart to [A]fear',
  }

  const report = inspectTransposeDuplicates([songA, songB, songC])
  assert.equal(report.candidates.length, 0, 'Genuine arrangements must not be flagged as transpose copies')
})

test('REFERENTIAL_VALIDATOR_REPORTS_INVALID_STATE_WITHOUT_MUTATION', () => {
  const validSongId = generateUUID()
  const songs = [
    { id: validSongId, title: 'Valid Song', rawContent: '[C]Text' },
    { id: 999, title: 'Numeric ID Song', rawContent: '[D]Text' }, // non-string / non-UUID
    { id: validSongId, title: 'Duplicate Song', rawContent: '[E]Text' }, // duplicate ID
  ]
  const setlists = [
    {
      id: 'sl-1',
      name: 'Setlist with Missing Reference',
      songs: [
        { id: validSongId, title: 'Valid Song' },
        { id: 'non-existent-uuid', title: 'Ghost Song' }, // dangling reference
      ],
    },
  ]

  const originalSongsSnapshot = JSON.stringify(songs)
  const originalSetlistsSnapshot = JSON.stringify(setlists)

  const report = validateSongbookIntegrity(songs, setlists)
  assert.equal(report.isValid, false)
  assert.equal(report.nonStringSongIds.length, 1)
  assert.equal(report.nonStringSongIds[0].id, 999)
  assert.equal(report.duplicateSongIds.length, 1)
  assert.equal(report.duplicateSongIds[0], validSongId)
  assert.equal(report.danglingReferences.length, 1)
  assert.equal(report.danglingReferences[0].songRef.id, 'non-existent-uuid')

  // Verify ZERO silent mutation
  assert.equal(JSON.stringify(songs), originalSongsSnapshot, 'Validator must not mutate input songs')
  assert.equal(JSON.stringify(setlists), originalSetlistsSnapshot, 'Validator must not mutate input setlists')
})
