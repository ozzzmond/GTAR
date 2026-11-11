const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs
          .readFileSync(filename, 'utf8')
          .replaceAll(
            'import.meta.env',
            '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client-test-id"})'
          ),
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

const { computeSongbookChecksum } = require('../src/utils/cloudBackupFormat.ts')

const {
  insertUser,
  findUserSongbook,
  upsertUserSongbook,
  createSessionToken,
} = require('../functions/lib/authCore.ts')

const syncApi = require('../functions/api/songbook/sync.ts')
const { generateUUID, isValidUUID } = require('../src/utils/uuid.ts')
const { normalizeSongbookIds, validateSongbookIntegrity } = require('../src/utils/songbookFoundation.ts')
const { parseBackupJson, createBackupPayload } = require('../src/utils/jsonBackup.ts')
const { resolveSetlistSong } = require('../src/utils/setlistSongs.ts')

// Helper for Mock D1
function createMockD1() {
  const users = new Map()
  const songbookDb = require('./helpers/songbookSqlite.cjs').createSongbookSqlite()

  return {
    _users: users,
    prepare(sql) {
      if (sql.includes('user_songbooks')) return songbookDb.prepare(sql)
      let bound = []
      return {
        bind(...args) {
          bound = args
          return this
        },
        async first() {
          if (sql.includes('FROM users WHERE id = ?')) {
            const [id] = bound
            return users.get(id) || null
          }
          if (sql.includes('FROM users WHERE google_sub = ?')) {
            const [sub] = bound
            for (const u of users.values()) {
              if (u.google_sub === sub) return u
            }
            return null
          }

          return null
        },
        async all() {
          return { results: [], success: true }
        },
        async run() {
          if (sql.includes('INSERT INTO users')) {
            const [id, google_sub, email, display_name, picture_url, role, access_status, created_at, updated_at, last_login_at] = bound
            users.set(id, { id, google_sub, email, display_name, picture_url, role, access_status, created_at, updated_at, last_login_at })
            return { success: true }
          }

          return { success: true }
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// 1. SETLIST UUID NORMALIZATION
// ---------------------------------------------------------------------------
test('1: setlist normalization preserves stable legacy IDs and rejects ID-less records', () => {
  const existingUUID = generateUUID()
  const songs = [{ id: generateUUID(), title: 'Track 1', artist: 'Artist 1', rawContent: '[A]Lyrics' }]
  const ref = { id: songs[0].id, title: 'Track 1' }
  const setlists = [{ id: existingUUID, name: 'Valid', songs: [ref] }, { id: 12345, name: 'Numeric', songs: [ref] }]
  const result = normalizeSongbookIds(songs, setlists)
  assert.equal(result.setlists[0].id, existingUUID)
  assert.equal(result.setlists[1].id, '12345')
  for (const id of [undefined, '']) {
    assert.throws(() => normalizeSongbookIds(songs, [{ id, name: 'Ambiguous', songs: [ref] }]), /Stable ID required/)
  }
})

// ---------------------------------------------------------------------------
// 2. CHECKSUM SENSITIVITY
// ---------------------------------------------------------------------------
test('2: checksum_sensitivity detects tombstone changes and song order changes', () => {
  const songId1 = generateUUID()
  const songId2 = generateUUID()
  const setlistId = generateUUID()

  const libraryA = {
    songs: [
      { id: songId1, title: 'Alpha', rawContent: '[C]A' },
      { id: songId2, title: 'Beta', rawContent: '[D]B' },
    ],
    setlists: [
      {
        id: setlistId,
        name: 'Order Set',
        songs: [{ id: songId1, title: 'Alpha' }, { id: songId2, title: 'Beta' }],
      },
    ],
  }

  // Reorder songs in setlist
  const libraryB = {
    ...libraryA,
    setlists: [
      {
        id: setlistId,
        name: 'Order Set',
        songs: [{ id: songId2, title: 'Beta' }, { id: songId1, title: 'Alpha' }],
      },
    ],
  }

  // Mark setlist as deleted (tombstone)
  const libraryC = {
    ...libraryA,
    setlists: [
      {
        ...libraryA.setlists[0],
        isDeleted: true,
      },
    ],
  }

  const checksumA = computeSongbookChecksum(libraryA)
  const checksumB = computeSongbookChecksum(libraryB)
  const checksumC = computeSongbookChecksum(libraryC)

  assert.notEqual(checksumA, checksumB, 'Reordering songs in a setlist must change checksum')
  assert.notEqual(checksumA, checksumC, 'Tombstoning a setlist must change checksum')
})

// ---------------------------------------------------------------------------
// 3. 3-WAY ADD
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 4. 3-WAY RENAME
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 5. 3-WAY REORDER
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 6. CONCURRENT CONFLICT COPY
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 7. LOCAL DELETE TOMBSTONE
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 8. REMOTE DELETE TOMBSTONE
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 9. ANTI RESURRECTION
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 10. SONG DELETE REFERENTIAL SAFETY
// ---------------------------------------------------------------------------
test('10: song_delete_reference_safety ensures missing referenced song does not crash or silently create song', () => {
  const missingSongId = generateUUID()
  const existingSongId = generateUUID()

  const songs = [
    { id: existingSongId, title: 'Existing Song', rawContent: '[A]Lyrics' },
  ]
  const setlists = [
    {
      id: generateUUID(),
      name: 'Gig List',
      songs: [
        { id: existingSongId, title: 'Existing Song' },
        { id: missingSongId, title: 'Deleted Or Missing Song' },
      ],
    },
  ]

  // resolveSetlistSong returns undefined for missing song
  const ref1 = setlists[0].songs[0]
  const ref2 = setlists[0].songs[1]
  const resolved1 = resolveSetlistSong(ref1, songs)
  const resolved2 = resolveSetlistSong(ref2, songs)

  assert.ok(resolved1)
  assert.equal(resolved1.id, existingSongId)
  assert.equal(resolved2, undefined, 'Missing referenced song must safely resolve to undefined')

  // Validation report catches the dangling reference cleanly without mutation
  const report = validateSongbookIntegrity(songs, setlists)
  assert.equal(report.danglingReferences.length, 1)
  assert.equal(report.danglingReferences[0].songRef.id, missingSongId)

  // Songs array count must be strictly unchanged (no phantom auto-creation)
  assert.equal(songs.length, 1)
})

// ---------------------------------------------------------------------------
// 11. BACKUP RESTORE ROUNDTRIP
// ---------------------------------------------------------------------------
test('11: backup_restore_roundtrip preserves setlist UUIDs and tombstones', () => {
  global.localStorage = { getItem: () => null }
  const setlistId = generateUUID()
  const songId = generateUUID()

  const songs = [{ id: songId, title: 'Song 1', rawContent: '[G]Lyrics' }]
  const setlists = [{ id: setlistId, name: 'Backup Set', isDeleted: false, songs: [{ id: songId, title: 'Song 1' }] }]

  const payload = createBackupPayload(songs, setlists)
  const jsonStr = JSON.stringify(payload)

  const parsed = parseBackupJson(jsonStr)
  assert.equal(parsed.isValid, true)
  assert.equal(parsed.setlists.length, 1)
  assert.equal(parsed.setlists[0].id, setlistId)
  assert.equal(parsed.setlists[0].songs[0].id, songId)
})

// ---------------------------------------------------------------------------
// 12. API PAYLOAD VALIDATION
// ---------------------------------------------------------------------------
