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
            '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client-test-id",VITE_AUTHORIZED_EMAILS:"jlopez3rd@gmail.com",VITE_ROOT_ADMIN_EMAIL:"jlopez3rd@gmail.com"})'
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

const {
  computeSongbookChecksum,
  evaluateSyncDecision,
  reconcileSongbook,
  readCloudSyncMeta,
  saveCloudSyncMeta,
  readCloudSyncBase,
  saveCloudSyncBase,
  performCloudSongbookSync,
} = require('../src/utils/cloudSongbookSync.ts')

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
  const songbooks = new Map()

  return {
    _users: users,
    _songbooks: songbooks,
    prepare(sql) {
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
          if (sql.includes('FROM user_songbooks WHERE user_id = ?')) {
            const [userId] = bound
            return songbooks.get(userId) || null
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
          if (sql.includes('INSERT INTO user_songbooks')) {
            const [userId, version, checksum, dataJson, updatedAt] = bound
            songbooks.set(userId, {
              user_id: userId,
              version,
              checksum,
              data_json: dataJson,
              updated_at: updatedAt,
            })
            return { success: true }
          }
          if (sql.includes('UPDATE user_songbooks')) {
            const [version, checksum, dataJson, updatedAt, userId] = bound
            songbooks.set(userId, {
              user_id: userId,
              version,
              checksum,
              data_json: dataJson,
              updated_at: updatedAt,
            })
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
test('1: setlist_uuid_normalization preserves valid UUIDs and assigns UUID to missing/invalid setlists', () => {
  const existingUUID = generateUUID()
  const songs = [
    { id: generateUUID(), title: 'Track 1', artist: 'Artist 1', rawContent: '[A]Lyrics' },
  ]
  const setlists = [
    { id: existingUUID, name: 'Valid Setlist', songs: [{ id: songs[0].id, title: 'Track 1' }] },
    { id: undefined, name: 'Missing ID Setlist', songs: [{ id: songs[0].id, title: 'Track 1' }] },
    { id: '', name: 'Empty String ID Setlist', songs: [{ id: songs[0].id, title: 'Track 1' }] },
    { id: 12345, name: 'Numeric ID Setlist', songs: [{ id: songs[0].id, title: 'Track 1' }] },
  ]

  const result = normalizeSongbookIds(songs, setlists)
  assert.equal(result.setlists[0].id, existingUUID, 'Valid UUID setlist ID must remain unchanged')
  assert.ok(isValidUUID(result.setlists[1].id), 'Missing ID must receive valid UUID')
  assert.ok(isValidUUID(result.setlists[2].id), 'Empty string ID must receive valid UUID')
  assert.ok(isValidUUID(result.setlists[3].id), 'Numeric ID must receive valid UUID')
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
test('3: 3way_add reconciles clean additions on local and remote without conflict', () => {
  const base = { songs: [], setlists: [] }
  const localSetlist = { id: generateUUID(), name: 'Local Gig', songs: [] }
  const remoteSetlist = { id: generateUUID(), name: 'Remote Gig', songs: [] }

  const local = { songs: [], setlists: [localSetlist] }
  const remote = { songs: [], setlists: [remoteSetlist] }

  const result = reconcileSongbook(local, remote, base)
  assert.equal(result.hasConflicts, false)
  assert.equal(result.merged.setlists.length, 2)
  assert.ok(result.merged.setlists.some((sl) => sl.id === localSetlist.id))
  assert.ok(result.merged.setlists.some((sl) => sl.id === remoteSetlist.id))
})

// ---------------------------------------------------------------------------
// 4. 3-WAY RENAME
// ---------------------------------------------------------------------------
test('4: 3way_rename cleanly accepts single-sided rename against base', () => {
  const setlistId = generateUUID()
  const baseSl = { id: setlistId, name: 'Old Setlist Name', songs: [] }
  const base = { songs: [], setlists: [baseSl] }

  // Local renames, remote unchanged
  const local = { songs: [], setlists: [{ ...baseSl, name: 'Local Renamed Setlist' }] }
  const remote = { songs: [], setlists: [{ ...baseSl }] }

  const resultLocalRenamed = reconcileSongbook(local, remote, base)
  assert.equal(resultLocalRenamed.hasConflicts, false)
  assert.equal(resultLocalRenamed.merged.setlists[0].name, 'Local Renamed Setlist')

  // Remote renames, local unchanged
  const remote2 = { songs: [], setlists: [{ ...baseSl, name: 'Remote Renamed Setlist' }] }
  const resultRemoteRenamed = reconcileSongbook(remote, remote2, base)
  assert.equal(resultRemoteRenamed.hasConflicts, false)
  assert.equal(resultRemoteRenamed.merged.setlists[0].name, 'Remote Renamed Setlist')
})

// ---------------------------------------------------------------------------
// 5. 3-WAY REORDER
// ---------------------------------------------------------------------------
test('5: 3way_reorder cleanly accepts single-sided song reordering against base', () => {
  const s1 = generateUUID()
  const s2 = generateUUID()
  const setlistId = generateUUID()

  const baseSl = {
    id: setlistId,
    name: 'Order Set',
    songs: [{ id: s1, title: 'Song 1' }, { id: s2, title: 'Song 2' }],
  }
  const base = { songs: [], setlists: [baseSl] }

  // Local reorders: Song 2 then Song 1
  const local = {
    songs: [],
    setlists: [
      {
        ...baseSl,
        songs: [{ id: s2, title: 'Song 2' }, { id: s1, title: 'Song 1' }],
      },
    ],
  }
  const remote = { songs: [], setlists: [{ ...baseSl }] }

  const result = reconcileSongbook(local, remote, base)
  assert.equal(result.hasConflicts, false)
  assert.equal(result.merged.setlists[0].songs[0].id, s2)
  assert.equal(result.merged.setlists[0].songs[1].id, s1)
})

// ---------------------------------------------------------------------------
// 6. CONCURRENT CONFLICT COPY
// ---------------------------------------------------------------------------
test('6: concurrent_conflict_copy preserves local setlist and creates (Cloud Copy) with distinct UUID', () => {
  const s1 = generateUUID()
  const setlistId = generateUUID()

  const baseSl = {
    id: setlistId,
    name: 'Shared Setlist',
    songs: [{ id: s1, title: 'Song 1' }],
  }
  const base = { songs: [], setlists: [baseSl] }

  // Local modifies name
  const local = {
    songs: [],
    setlists: [{ ...baseSl, name: 'Local Acoustic Version' }],
  }
  // Remote modifies name differently
  const remote = {
    songs: [],
    setlists: [{ ...baseSl, name: 'Remote Electric Version' }],
  }

  const result = reconcileSongbook(local, remote, base)
  assert.equal(result.hasConflicts, true)
  assert.equal(result.conflicts.length, 1)
  assert.equal(result.conflicts[0].type, 'setlist')
  assert.equal(result.merged.setlists.length, 2)

  const keptLocal = result.merged.setlists.find((sl) => sl.id === setlistId)
  assert.ok(keptLocal)
  assert.equal(keptLocal.name, 'Local Acoustic Version')

  const cloudCopy = result.merged.setlists.find((sl) => sl.id !== setlistId)
  assert.ok(cloudCopy)
  assert.ok(isValidUUID(cloudCopy.id), 'Cloud copy must have a valid new UUID')
  assert.equal(cloudCopy.name, 'Remote Electric Version (Cloud Copy)')
})

// ---------------------------------------------------------------------------
// 7. LOCAL DELETE TOMBSTONE
// ---------------------------------------------------------------------------
test('7: local_delete_tombstone propagates tombstone to merge when remote is unchanged from base', () => {
  const setlistId = generateUUID()
  const baseSl = { id: setlistId, name: 'Setlist To Delete', songs: [] }
  const base = { songs: [], setlists: [baseSl] }

  // Local marks tombstone (isDeleted: true)
  const local = { songs: [], setlists: [{ ...baseSl, isDeleted: true }] }
  const remote = { songs: [], setlists: [{ ...baseSl }] }

  const result = reconcileSongbook(local, remote, base)
  assert.equal(result.hasConflicts, false)
  assert.equal(result.merged.setlists.length, 1)
  assert.equal(result.merged.setlists[0].id, setlistId)
  assert.equal(result.merged.setlists[0].isDeleted, true)
})

// ---------------------------------------------------------------------------
// 8. REMOTE DELETE TOMBSTONE
// ---------------------------------------------------------------------------
test('8: remote_delete_tombstone propagates tombstone to merge when local is unchanged from base', () => {
  const setlistId = generateUUID()
  const baseSl = { id: setlistId, name: 'Setlist Remote Deleted', songs: [] }
  const base = { songs: [], setlists: [baseSl] }

  const local = { songs: [], setlists: [{ ...baseSl }] }
  // Remote marks tombstone (isDeleted: true)
  const remote = { songs: [], setlists: [{ ...baseSl, isDeleted: true }] }

  const result = reconcileSongbook(local, remote, base)
  assert.equal(result.hasConflicts, false)
  assert.equal(result.merged.setlists.length, 1)
  assert.equal(result.merged.setlists[0].id, setlistId)
  assert.equal(result.merged.setlists[0].isDeleted, true)
})

// ---------------------------------------------------------------------------
// 9. ANTI RESURRECTION
// ---------------------------------------------------------------------------
test('9: anti_resurrection prevents tombstoned setlist from resurrecting against base snapshot', () => {
  const setlistId = generateUUID()
  const baseSl = { id: setlistId, name: 'Deleted Setlist', songs: [] }
  const base = { songs: [], setlists: [baseSl] }

  // Local deleted/tombstoned setlist
  const local = { songs: [], setlists: [{ ...baseSl, isDeleted: true }] }
  // Remote still has unmodified setlist from base
  const remote = { songs: [], setlists: [{ ...baseSl }] }

  const result = reconcileSongbook(local, remote, base)
  // Must NOT resurrect as active
  assert.equal(result.hasConflicts, false)
  assert.equal(result.merged.setlists[0].isDeleted, true, 'Must remain tombstoned, not resurrected')
})

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
test('12: api_payload_validation validates setlists, ids, names, songs array, and tombstones', async () => {
  const db = createMockD1()
  const env = { DB: db, AUTH_SECRET: 'test_secret_key' }

  const user = {
    id: 'user_val',
    google_sub: 'sub_val',
    email: 'val@gmail.com',
    role: 'member',
    access_status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_login_at: new Date().toISOString(),
  }
  await insertUser(db, user)
  const token = await createSessionToken(user, env.AUTH_SECRET)

  // 1. Invalid payload: setlist missing name
  const reqBadName = new Request('https://gtar.dev/api/songbook/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      action: 'upload',
      data: {
        songs: [{ id: generateUUID(), title: 'Test Song', rawContent: '[C]Chord' }],
        setlists: [{ id: generateUUID(), name: '', songs: [] }],
      },
    }),
  })
  const resBadName = await syncApi.onRequestPost({ request: reqBadName, env })
  assert.equal(resBadName.status, 400)

  // 2. Invalid payload: setlist songs is not an array
  const reqBadSongs = new Request('https://gtar.dev/api/songbook/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      action: 'upload',
      data: {
        songs: [{ id: generateUUID(), title: 'Test Song', rawContent: '[C]Chord' }],
        setlists: [{ id: generateUUID(), name: 'Set', songs: 'not-an-array' }],
      },
    }),
  })
  const resBadSongs = await syncApi.onRequestPost({ request: reqBadSongs, env })
  assert.equal(resBadSongs.status, 400)

  // 3. Invalid payload: isDeleted is not a boolean
  const reqBadDeleted = new Request('https://gtar.dev/api/songbook/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      action: 'upload',
      data: {
        songs: [{ id: generateUUID(), title: 'Test Song', rawContent: '[C]Chord' }],
        setlists: [{ id: generateUUID(), name: 'Set', songs: [], isDeleted: 'yes' }],
      },
    }),
  })
  const resBadDeleted = await syncApi.onRequestPost({ request: reqBadDeleted, env })
  assert.equal(resBadDeleted.status, 400)

  // 4. Valid payload: accepts setlists with valid UUID, name, songs array, and isDeleted boolean
  const validSetlistId = generateUUID()
  const validSongId = generateUUID()
  const reqValid = new Request('https://gtar.dev/api/songbook/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      action: 'upload',
      data: {
        songs: [{ id: validSongId, title: 'Valid Song', rawContent: '[G]Chord' }],
        setlists: [
          { id: validSetlistId, name: 'Valid Setlist', songs: [{ id: validSongId, title: 'Valid Song' }], isDeleted: false },
        ],
      },
    }),
  })
  const resValid = await syncApi.onRequestPost({ request: reqValid, env })
  assert.equal(resValid.status, 200)
  const validJson = await resValid.json()
  assert.equal(validJson.success, true)
  assert.ok(validJson.cloudRecord.checksum)
})
