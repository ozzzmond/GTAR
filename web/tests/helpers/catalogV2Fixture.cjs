// #253 Catalog V2 disposable SQLite fixture (synthetic users only). Shared by the V2 suites.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { createSessionToken } = require('../../functions/lib/authCore.ts')
const { handleSetlistCatalog } = require('../../functions/lib/setlistCatalog.ts')
const reports = require('../../functions/lib/catalogReports.ts')
const { snapshotFromSongbook } = require('../../src/utils/sharedSetlistSnapshot.ts')

const secret = 'catalog_v2_tests_secret_at_least_32_bytes_long'
const allMigrations = fs.readdirSync(path.join(__dirname, '../../migrations')).filter(n => n.endsWith('.sql')).sort()
const library = () => ({
  songs: ['CHORD_PRO', 'TWO_LINE', 'PLAIN'].map((format, i) => ({
    id: `song-${i}`, title: `Song ${i}`, artist: 'Artist', rawContent: `[C]Line ${i}\n[G]Two`, format, key: 'D', capo: '2', transposeOffset: -2,
    tags: 'private tags', lastOpenedAt: 10,
  })),
  setlists: [{ id: 'set-1', name: 'Sunday', songs: [0, 1, 0, 2].map(i => ({ id: `song-${i}`, title: `Song ${i}` })) }],
})
const snapshot = () => snapshotFromSongbook(library(), 'set-1')
const sha = text => crypto.createHash('sha256').update(text).digest('hex')

/** `migrations`/`transform` build deliberately incomplete or altered disposable schemas for fail-closed tests. */
async function fixture({ upTo, migrations, transform = (name, text) => text } = {}) {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  for (const name of (migrations ?? allMigrations).filter(n => !upTo || n < upTo)) {
    sql.exec(transform(name, fs.readFileSync(path.join(__dirname, '../../migrations', name), 'utf8')))
  }
  const db = { prepare(query) {
    let args = []
    return {
      bind(...values) { args = values; return this },
      async first() { return sql.prepare(query).get(...args) ?? null },
      async all() { return { success: true, results: sql.prepare(query).all(...args) } },
      async run() { return { success: true, meta: sql.prepare(query).run(...args) } },
    }
  } }
  const tokens = {}
  for (const [id, role, status] of [['admin', 'admin', 'active'], ['other', 'admin', 'active'], ['member', 'member', 'active'],
    ['member2', 'member', 'active'], ['pending', 'member', 'pending'], ['denied', 'member', 'denied']]) {
    const user = { id, google_sub: `sub-${id}`, email: `${id}@example.test`, role, access_status: status }
    sql.prepare(`INSERT INTO users(id,google_sub,email,role,access_status,created_at,updated_at,last_login_at)
      VALUES(?,?,?,?,?,'now','now','now')`).run(id, user.google_sub, user.email, role, status)
    tokens[id] = await createSessionToken(user, secret)
  }
  // Only `admin` has a personal cloud songbook. Nobody else ever uploads one.
  sql.prepare('INSERT INTO user_songbooks VALUES(?,1,?,?,?)').run('admin', JSON.stringify(library()), 'source-checksum', 'now')
  const env = { DB: db, AUTH_SECRET: secret, SHARED_SETLISTS_ENABLED: 'phase-a-v1' }
  let keys = 0
  async function call(method, body, options = {}) {
    const headers = { Authorization: `Bearer ${tokens[options.user ?? 'member']}`, 'Idempotency-Key': options.key ?? `idempotency-key-${String(++keys).padStart(6, '0')}` }
    const request = new Request(`https://local.test/api/catalog/setlists${options.id ? '/' + options.id : ''}${options.query ?? ''}`,
      { method, headers, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) })
    return handleSetlistCatalog({ request, env, params: { id: options.id } })
  }
  async function report(body, user = 'member') {
    const request = new Request('https://local.test/api/catalog/reports', { method: 'POST', headers: { Authorization: `Bearer ${tokens[user]}` }, body: JSON.stringify(body) })
    return reports.handleCatalogReport({ request, env, params: {} })
  }
  async function admin(method, { id, body, query = '', user = 'admin', key } = {}) {
    const headers = { Authorization: `Bearer ${tokens[user]}`, 'Idempotency-Key': key ?? `moderation-key-${String(++keys).padStart(6, '0')}` }
    const request = new Request(`https://local.test/api/admin/catalog-reports${id ? '/' + id : ''}${query}`,
      { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
    return id ? reports.handleAdminReportResolve({ request, env, params: { id } }) : reports.handleAdminReportList({ request, env, params: {} })
  }
  const count = table => sql.prepare(`SELECT count(*) AS n FROM ${table}`).get().n
  return { sql, db, env, tokens, call, report, admin, count }
}
const clientCreate = (key = 'member-publication-0001', snap = snapshot()) => ({ snapshot_version: 1, publication_key: key, snapshot: snap })
const clientUpdate = (revision, snap = snapshot()) => ({ snapshot_version: 1, expected_revision: revision, snapshot: snap })
const legacyCreate = () => ({ snapshot_version: 1, publication_key: 'admin-publication-0001', source_setlist_id: 'set-1', source_version: 1 })
const legacyUpdate = revision => ({ snapshot_version: 1, expected_revision: revision, source_setlist_id: 'set-1', source_version: 1 })
async function ok(response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json() }

function seedSongs(f, n) {
  const insert = f.sql.prepare(`INSERT INTO shared_catalog_songs(id,title,artist,raw_content,format,checksum,publisher_user_id,last_editor_user_id,
    current_revision,created_at,updated_at) VALUES(?,?,'A','[C]x','CHORD_PRO','c','admin','admin',2,'now','now')`)
  for (let i = 0; i < n; i++) insert.run(`catalog-song-${i}`, `Catalog Song ${i}`)
}
const songReport = (i = 0, extra = {}) => ({ target_kind: 'song', target_id: `catalog-song-${i}`, target_revision: 2, reason: 'copyright', ...extra })


module.exports = { fixture, library, snapshot, sha, clientCreate, clientUpdate, legacyCreate, legacyUpdate, ok, seedSongs, songReport, allMigrations }
