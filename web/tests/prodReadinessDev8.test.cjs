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
  createSessionToken,
} = require('../functions/lib/authCore.ts')

const syncApi = require('../functions/api/songbook/sync.ts')
const { generateUUID, isValidUUID } = require('../src/utils/uuid.ts')
const { normalizeSongbookIds, validateSongbookIntegrity } = require('../src/utils/songbookFoundation.ts')

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

// ===========================================================================
// SECTION 1: ACCOUNT & ACCESS LIFECYCLE HARDENING
// ===========================================================================

test('DEV8_DATA_04: Canonical Checksum produces 100% identical fingerprint on client (server sync retired)', async () => {
  const song1 = { id: generateUUID(), title: 'Zebra Song', rawContent: '[A]Line\r\n' }
  const song2 = { id: generateUUID(), title: 'Apple Song', rawContent: '[B]Line\n' }
  const setlist = { id: generateUUID(), name: 'Set A', songs: [{ id: song1.id, title: song1.title }] }

  const libOrder1 = { songs: [song1, song2], setlists: [setlist] }
  const libOrder2 = { songs: [song2, song1], setlists: [setlist] }

  const ck1 = computeSongbookChecksum(libOrder1)
  const ck2 = computeSongbookChecksum(libOrder2)

  assert.equal(ck1, ck2, 'Checksum must be invariant to song order and CRLF newlines')
})

// ===========================================================================
// SECTION 3: CLOUD SETLIST & TOMBSTONE RECONCILIATION HARDENING
// ===========================================================================

// ===========================================================================
// SECTION 4: FRESH ENVIRONMENT REHEARSAL
// ===========================================================================

test('DEV8_FRESH_01: Clean environment empty storage initializes with valid RFC4122 v4 UUIDs', () => {
  const rawSongs = [
    { title: 'Stand By Me', rawContent: '[A]Chords' },
    { title: 'El Bimbo', rawContent: '[G]Chords' },
  ]
  const rawSetlists = [
    { id: generateUUID(), name: 'Default Setlist', songs: [{ title: 'Stand By Me' }] },
  ]

  const normalized = normalizeSongbookIds(rawSongs, rawSetlists)
  assert.equal(normalized.migrated, true)
  for (const s of normalized.songs) {
    assert.equal(isValidUUID(s.id), true, `Song "${s.title}" must have valid UUID`)
  }
  for (const sl of normalized.setlists) {
    assert.equal(isValidUUID(sl.id), true, `Setlist "${sl.name}" must have valid UUID`)
    assert.equal(isValidUUID(sl.songs[0].id), true, 'Setlist song ref must bind to UUID')
  }

  const report = validateSongbookIntegrity(normalized.songs, normalized.setlists)
  assert.equal(report.isValid, true)
})
