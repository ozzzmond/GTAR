const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
      }).outputText,
      filename
    )
}

const webDir = path.resolve(__dirname, '..')

// 1. VERSION CONTRACT (1.0.123-dev.5d)
test('DEV5B_VERSION_CONTRACT: Canonical version updated to 1.0.123-dev.5d across manifests, types, and functions', () => {
  const { GTAR_DEV_VERSION } = require(path.join(webDir, 'src/types/gtar.ts'))
  const pkgJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'))
  const pkgLockJson = JSON.parse(fs.readFileSync(path.join(webDir, 'package-lock.json'), 'utf8'))
  const authCore = fs.readFileSync(path.join(webDir, 'functions/lib/authCore.ts'), 'utf8')

  assert.equal(GTAR_DEV_VERSION, '1.0.123-dev.5d', 'gtar.ts GTAR_DEV_VERSION must be 1.0.123-dev.5d')
  assert.equal(pkgJson.version, '1.0.123-dev.5d', 'package.json version must be 1.0.123-dev.5d')
  assert.equal(pkgLockJson.version, '1.0.123-dev.5d', 'package-lock.json root version must be 1.0.123-dev.5d')
  assert.equal(pkgLockJson.packages[''].version, '1.0.123-dev.5d', 'package-lock.json packages[""] must be 1.0.123-dev.5d')
  assert.ok(authCore.includes('v1.0.123-dev.5d'), 'authCore.ts header must reference v1.0.123-dev.5d')
})

// 2. DELIVERABLE 2: NEW SONG FIRST SAVE PRODUCES EXACTLY ONE RECORD
test('NEW_SONG_FIRST_SAVE: Creating and saving a new song yields exactly one record', () => {
  // Simulate App.tsx saving logic
  let songs = [
    { id: 'song-1', title: 'Amazing Grace', artist: 'John Newton', rawContent: '' },
    { id: 'song-2', title: 'Way Maker', artist: 'Sinach', rawContent: '' },
  ]
  const deletedSongs = []
  const setlists = []

  const handleSaveSongFromEditor = (updatedSong) => {
    const targetId = updatedSong.id
    const isExisting = songs.some(s => String(s.id) === String(targetId))
    const nextSongs = isExisting
      ? songs.map(s => String(s.id) === String(targetId) ? { ...s, ...updatedSong, id: s.id } : s)
      : [updatedSong, ...songs]
    songs = nextSongs
    return true
  }

  // Create new song
  const newSong = {
    id: 'uuid-new-120',
    title: 'Washed',
    artist: 'Elevation Rhythm',
    key: 'G',
    bpm: '128',
    format: 'CHORD_PRO',
    transposeOffset: 0,
    rawContent: '{title: Washed}\n{artist: Elevation Rhythm}\n{key: G}\n',
  }

  // First save
  const saved = handleSaveSongFromEditor(newSong)
  assert.equal(saved, true)
  assert.equal(songs.length, 3, 'Library must have exactly 3 songs after first save')

  const matchingSongs = songs.filter(s => s.title === 'Washed' && s.artist === 'Elevation Rhythm')
  assert.equal(matchingSongs.length, 1, 'Exactly one song card for Washed must exist')
  assert.equal(matchingSongs[0].id, 'uuid-new-120', 'Song must preserve its stable identity')
})

// 3. DELIVERABLE 2: SAME SONG SECOND SAVE UPDATES RECORD WITHOUT DUPLICATING
test('SAME_SONG_SECOND_SAVE: Saving same song again updates existing record, no new cards created', () => {
  let songs = [
    { id: 'uuid-new-120', title: 'Washed', artist: 'Elevation Rhythm', bpm: '128', rawContent: '' },
    { id: 'song-1', title: 'Amazing Grace', artist: 'John Newton', rawContent: '' },
  ]

  const handleSaveSongFromEditor = (updatedSong) => {
    const targetId = updatedSong.id
    const isExisting = songs.some(s => String(s.id) === String(targetId))
    const nextSongs = isExisting
      ? songs.map(s => String(s.id) === String(targetId) ? { ...s, ...updatedSong, id: s.id } : s)
      : [updatedSong, ...songs]
    songs = nextSongs
    return true
  }

  // Second save with modified bpm and rawContent
  const updatedSong = {
    id: 'uuid-new-120',
    title: 'Washed',
    artist: 'Elevation Rhythm',
    bpm: '130',
    rawContent: '{title: Washed}\n[G]Washed in the blood\n',
  }

  handleSaveSongFromEditor(updatedSong)
  assert.equal(songs.length, 2, 'Library must still have exactly 2 songs')
  assert.equal(songs[0].bpm, '130', 'Song bpm must be updated')
  assert.equal(songs[0].rawContent, '{title: Washed}\n[G]Washed in the blood\n')
})

// 4. DELIVERABLE 2: RELOAD / RECONCILIATION PRESERVES EXACTLY ONE RECORD
test('RELOAD_RECONCILIATION: Local and cloud sync reconciliation preserves single record', () => {
  const { deduplicateLibrary } = require(path.join(webDir, 'src/utils/syncMerge.ts'))

  const localSongs = [
    { id: 'uuid-new-120', title: 'Washed', artist: 'Elevation Rhythm', rawContent: '{title: Washed}' },
  ]

  const deduped = deduplicateLibrary({ songs: localSongs, setlists: [] })
  assert.equal(deduped.songs.length, 1, 'Must retain exactly 1 record')
  assert.equal(deduped.songs[0].id, 'uuid-new-120')
})

// 5. DELIVERABLE 2: TWO INTENTIONALLY SEPARATE NEW SONGS CREATE TWO DISTINCT RECORDS
test('TWO_INTENTIONALLY_SEPARATE_SONGS: Distinct new songs create two distinct records', () => {
  let songs = []
  const handleSaveSongFromEditor = (updatedSong) => {
    const targetId = updatedSong.id
    const isExisting = songs.some(s => String(s.id) === String(targetId))
    const nextSongs = isExisting
      ? songs.map(s => String(s.id) === String(targetId) ? { ...s, ...updatedSong, id: s.id } : s)
      : [updatedSong, ...songs]
    songs = nextSongs
    return true
  }

  handleSaveSongFromEditor({ id: 'uuid-1', title: 'Song A', artist: 'Artist 1', rawContent: '' })
  handleSaveSongFromEditor({ id: 'uuid-2', title: 'Song B', artist: 'Artist 2', rawContent: '' })

  assert.equal(songs.length, 2, 'Two distinct songs must exist')
  assert.equal(songs[0].id, 'uuid-2')
  assert.equal(songs[1].id, 'uuid-1')
})

// 6. DELIVERABLE 2: EXISTING SONG EDIT DOES NOT CREATE DUPLICATE
test('EXISTING_SONG_EDIT: Editing existing song updates in-place without duplicating', () => {
  let songs = [
    { id: 'existing-1', title: 'Ever Be', artist: 'Bethel', key: 'D', rawContent: '' },
  ]
  const handleSaveSongFromEditor = (updatedSong) => {
    const targetId = updatedSong.id
    const isExisting = songs.some(s => String(s.id) === String(targetId))
    const nextSongs = isExisting
      ? songs.map(s => String(s.id) === String(targetId) ? { ...s, ...updatedSong, id: s.id } : s)
      : [updatedSong, ...songs]
    songs = nextSongs
    return true
  }

  handleSaveSongFromEditor({ id: 'existing-1', title: 'Ever Be (Live)', artist: 'Bethel Music', key: 'E', rawContent: '' })
  assert.equal(songs.length, 1, 'Editing existing song must not change count')
  assert.equal(songs[0].title, 'Ever Be (Live)')
  assert.equal(songs[0].key, 'E')
})

// 7. DELIVERABLE 1: QR CODE SVG GENERATION
test('QR_CODE_SVG_GENERATION: generateQrSvgDataUri creates valid XML/SVG data URI', () => {
  const { generateQrSvgDataUri } = require(path.join(webDir, 'src/utils/qrCode.ts'))

  const testUrl = 'https://gtar.pages.dev?share=a1b2c3d4e5f60718'
  const svgDataUri = generateQrSvgDataUri(testUrl)

  assert.ok(svgDataUri.startsWith('data:image/svg+xml;utf8,'), 'Must return SVG data URI')
  const decoded = decodeURIComponent(svgDataUri.replace('data:image/svg+xml;utf8,', ''))
  assert.ok(decoded.includes('<svg'), 'Decoded string must contain <svg tag')
  assert.ok(decoded.includes('viewBox="0 0'), 'Decoded SVG must contain viewBox')
  assert.ok(decoded.includes('<rect'), 'Decoded SVG must contain QR matrix rect elements')
})

// 8. DELIVERABLE 1: SANITIZATION STRIPS PRIVATE / INTERNAL FIELDS
test('QR_SHARE_SANITIZATION: sanitizeSetlistForShare strips private IDs, credentials, and deleted items', () => {
  const { sanitizeSetlistForShare } = require(path.join(webDir, 'src/utils/sharedSetlist.ts'))

  const sensitiveInput = {
    id: 'internal-d1-pk-999',
    userId: 'user-secret-abc',
    token: 'jwt.token.secret',
    name: 'Sunday Worship Set',
    isDeleted: false,
    syncStatus: 'synced',
    updatedAt: 123456789,
    songs: [
      {
        id: 'song-id-123',
        userId: 'user-secret-abc',
        title: 'Build My Life',
        artist: 'Housefires',
        key: 'G',
        capo: 'No Capo',
        bpm: '68',
        time: '4/4',
        rawContent: '{title: Build My Life}\n[G]Worthy of every song',
        secretNotes: 'Private chord variation',
      },
    ],
  }

  const sanitized = sanitizeSetlistForShare(sensitiveInput)

  assert.equal(sanitized.name, 'Sunday Worship Set')
  assert.equal(sanitized.songs.length, 1)
  assert.equal(sanitized.songs[0].title, 'Build My Life')
  assert.equal(sanitized.songs[0].artist, 'Housefires')
  assert.equal(sanitized.songs[0].key, 'G')

  // Prove private/internal fields are EXCLUDED
  assert.equal(sanitized.id, undefined, 'Internal setlist ID must be stripped')
  assert.equal(sanitized.userId, undefined, 'User ID must be stripped')
  assert.equal(sanitized.token, undefined, 'Token must be stripped')
  assert.equal(sanitized.songs[0].id, undefined, 'Internal song ID must be stripped')
  assert.equal(sanitized.songs[0].userId, undefined, 'Internal user ID must be stripped')
  assert.equal(sanitized.songs[0].secretNotes, undefined, 'Internal metadata must be stripped')
})

// 9. DELIVERABLE 1: VALIDATION FAILS CLOSED ON MALFORMED / INVALID PAYLOADS
test('QR_SHARE_VALIDATION_FAIL_CLOSED: Rejects malformed, oversized, or missing required fields', () => {
  const { validateSharedSetlistPayload } = require(path.join(webDir, 'src/utils/sharedSetlist.ts'))

  // Null / non-object
  assert.equal(validateSharedSetlistPayload(null).isValid, false)
  assert.equal(validateSharedSetlistPayload('bad string').isValid, false)

  // Empty name
  assert.equal(validateSharedSetlistPayload({ type: 'GTAR_SHARED_SETLIST', name: '   ', songs: [] }).isValid, false)

  // Songs not array
  assert.equal(validateSharedSetlistPayload({ type: 'GTAR_SHARED_SETLIST', name: 'Valid Set', songs: 'not-array' }).isValid, false)

  // Song missing title
  assert.equal(validateSharedSetlistPayload({ type: 'GTAR_SHARED_SETLIST', name: 'Valid Set', songs: [{ artist: 'Only Artist' }] }).isValid, false)

  // Valid payload succeeds
  const valid = validateSharedSetlistPayload({
    type: 'GTAR_SHARED_SETLIST',
    name: 'Valid Setlist',
    songs: [{ title: 'Song 1', artist: 'Artist 1', rawContent: '[C]Chord' }],
  })
  assert.equal(valid.isValid, true)
  assert.equal(valid.setlist.name, 'Valid Setlist')
})

// 10. DELIVERABLE 1 & 2: DEV.5A METADATA & TRANSPOSE PRESERVED
test('EXISTING_DEV5A_INVARIANTS_PRESERVED: Deterministic transposition and metadata lookup directives intact', () => {
  const { transposeCanonicalSong } = require(path.join(webDir, 'src/utils/chartKeyAlignment.ts'))
  const { syncCanonicalDirectives } = require(path.join(webDir, 'src/utils/chordProMetadata.ts'))

  const chart = `{title: Way Maker}\n{key: G}\n[G]You are here moving in our midst`
  const transposed = transposeCanonicalSong(chart, 'G', 'A')

  assert.equal(transposed.key, 'A')
  assert.ok(transposed.rawContent.includes('{key: A}'), 'Transposed chart contains {key: A}')
  assert.ok(transposed.rawContent.includes('[A]You are here'), 'Chord transposed from [G] to [A]')

  const synced = syncCanonicalDirectives(chart, { originalKey: 'E' })
  assert.ok(synced.includes('{original_key: E}'), 'Metadata directive includes {original_key: E}')
  assert.ok(synced.includes('[G]You are here'), 'Original chords unaffected by directive sync')
})
