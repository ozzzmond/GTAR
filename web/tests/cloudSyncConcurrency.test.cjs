
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }
).outputText, filename)
const { createSongbookSqlite } = require('./helpers/songbookSqlite.cjs')
const { upsertUserSongbook, findUserSongbook, createSessionToken } = require('../functions/lib/authCore.ts')
const api = require('../functions/api/songbook/sync.ts')
const sync = require('../src/utils/cloudBackupFormat.ts')

const songId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

const library = content => ({ songs: [{ id: songId, title: 'Song', rawContent: content }], setlists: [] })
const emptyRevision = { version: 0, checksum: null }
const write = (db, data, expected, user = 'user-a') => upsertUserSongbook(db, user,
  JSON.stringify(data), sync.computeSongbookChecksum(data), '2026-10-10T00:00:00Z', expected)
const revision = record => ({ version: record.version, checksum: record.checksum })

async function fixture() {
  const db = createSongbookSqlite()
  const user = { id: 'user-a', google_sub: 'sub-a', email: 'a@example.com', role: 'member', access_status: 'active' }
  const original = db.prepare.bind(db)
  db.prepare = sql => sql.includes('FROM users WHERE id = ?')
    ? { bind(id) { return { first: async () => id === user.id ? user : null } } } : original(sql)
  const env = { DB: db, AUTH_SECRET: 'concurrency-test-secret' }
  const token = await createSessionToken(user, env.AUTH_SECRET)
  const request = async (method, body) => api[method === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env,
    request: new Request('https://example.com/api/songbook/sync', { method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-GTAR-Library-Owner': user.id },
      ...(body ? { body: JSON.stringify(body) } : {}) }) })
  return { db, request }
}
const postBody = (data, rev) => ({ data, expectedVersion: rev.version, expectedChecksum: rev.checksum })

test('CAS: initial write and first-write race have one winner', async () => {
  const db = createSongbookSqlite()
  const results = await Promise.all([write(db, library('A'), emptyRevision), write(db, library('B'), emptyRevision)])
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal((await findUserSongbook(db, 'user-a')).version, 1)
})
test('CAS: same-base clients cannot overwrite or reuse a successful revision', async () => {
  const db = createSongbookSqlite()
  const first = await write(db, library('base'), emptyRevision)
  const results = await Promise.all([write(db, library('A'), revision(first)), write(db, library('B'), revision(first))])
  assert.equal(results.filter(Boolean).length, 1)
  const winner = await findUserSongbook(db, 'user-a')
  assert.equal(winner.version, 2)
  assert.equal(await write(db, library('stale'), revision(first)), null)
  assert.equal((await findUserSongbook(db, 'user-a')).data_json, winner.data_json)
  for (let expectedVersion = 2; expectedVersion < 10; expectedVersion++) {
    const result = await write(db, library(String(expectedVersion)), revision(await findUserSongbook(db, 'user-a')))
    assert.equal(result.version, expectedVersion + 1)
  }
})

test('D1 local binding: actual first()/RETURNING and simultaneous writes enforce CAS', async () => {
  const { Miniflare, convertV4MiniflareOptions } = require('miniflare')
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ modules: true, script: 'export default { fetch() { return new Response("test") } }',
    d1Databases: { DB: 'local-concurrency-test' } }] }))
  try {
    const db = await mf.getD1Database('DB')
    await db.prepare('CREATE TABLE users (id TEXT PRIMARY KEY)').run()
    await db.prepare("INSERT INTO users VALUES ('user-a')").run()
    // Execute the unchanged migration against disposable D1.
    const migration = fs.readFileSync(require('node:path').join(__dirname, '../migrations/0002_songbook_sync.sql'), 'utf8')
      .replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean)
    for (const sql of migration) await db.prepare(sql).run()
    const first = await write(db, library('base'), emptyRevision)
    assert.equal(first.version, 1)
    const results = await Promise.all([write(db, library('A'), revision(first)), write(db, library('B'), revision(first))])
    assert.equal(results.filter(Boolean).length, 1)
    assert.equal((await findUserSongbook(db, 'user-a')).version, 2)
    assert.equal(await write(db, library('stale'), revision(first)), null)
    const next = await write(db, library('next'), revision(await findUserSongbook(db, 'user-a')))
    assert.equal(next.version, 3)
    await db.prepare('DELETE FROM user_songbooks WHERE user_id = ?').bind('user-a').run()
    const initialRace = await Promise.all([write(db, library('first A'), emptyRevision), write(db, library('first B'), emptyRevision)])
    assert.equal(initialRace.filter(Boolean).length, 1)
    assert.equal((await findUserSongbook(db, 'user-a')).version, 1)
  } finally { await mf.dispose() }
})

