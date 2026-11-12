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
            users.set(id, {
              id,
              google_sub,
              email,
              display_name,
              picture_url,
              role,
              access_status,
              created_at,
              updated_at,
              last_login_at,
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
// 2. DETERMINISTIC DECISION LOGIC: 7 CORE STATES
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 3. RECONCILIATION & SAFE CONFLICT RESOLUTION
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 4. SERVER D1 ENDPOINT SECURITY & USER ISOLATION
// ---------------------------------------------------------------------------
test('COMPATIBILITY: Cloud serialization roundtrip preserves 108-dev.5 UUIDs and setlist bindings', async () => {
  const song1 = {
    id: generateUUID(),
    title: 'Stand By Me',
    artist: 'Ben E. King',
    key: 'A',
    rawContent: '[A]Stand by me',
  }
  const song2 = {
    id: generateUUID(),
    title: 'El Bimbo',
    artist: 'Eraserheads',
    key: 'G',
    rawContent: '[G]El Bimbo',
  }

  const setlist = {
    id: generateUUID(),
    name: 'Acoustic Set',
    songs: [
      { id: song1.id, title: song1.title, artist: song1.artist },
      { id: song2.id, title: song2.title, artist: song2.artist },
    ],
  }

  const originalLibrary = {
    songs: [song1, song2],
    setlists: [setlist],
  }

  // Pre-condition: integrity valid
  const preCheck = validateSongbookIntegrity(originalLibrary.songs, originalLibrary.setlists)
  assert.equal(preCheck.isValid, true)

  // Simulate Cloud persistence serialize & deserialize
  const serialized = JSON.stringify(originalLibrary)
  const deserialized = JSON.parse(serialized)

  // Normalization on deserialized data
  const normalized = normalizeSongbookIds(deserialized.songs, deserialized.setlists)
  assert.equal(normalized.migrated, false, 'Valid 108-dev.5 UUIDs must not be re-migrated')
  assert.equal(normalized.songs[0].id, song1.id)
  assert.equal(normalized.songs[1].id, song2.id)
  assert.equal(normalized.setlists[0].songs[0].id, song1.id)
  assert.equal(normalized.setlists[0].songs[1].id, song2.id)

  const postCheck = validateSongbookIntegrity(normalized.songs, normalized.setlists)
  assert.equal(postCheck.isValid, true)
})
