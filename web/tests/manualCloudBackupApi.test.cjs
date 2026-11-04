const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }
).outputText, filename)
const { createSongbookSqlite } = require('./helpers/songbookSqlite.cjs')
const { upsertUserSongbook, createSessionToken } = require('../functions/lib/authCore.ts')
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

test('manual backup accepts account with per-record cursor and rows', async () => {
 const {db,request}=await fixture()
 await write(db,library('old'),emptyRevision)
 db.sqlite.prepare('INSERT INTO user_songbook_cursors (user_id, seq, seeded_at) VALUES (?, ?, ?)').run('user-a', 1, '2026-11-01T00:00:00Z')
 db.sqlite.prepare('INSERT INTO user_songbook_records (user_id, kind, record_id, rev, seq, removed, data_json, checksum, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('user-a', 'song', songId, 1, 1, 0, JSON.stringify(library('old').songs[0]), 'historical-checksum', '2026-11-01T00:00:00Z')
 const old=(await (await request('GET')).json()).cloudRecord
 const result=await request('POST',postBody(library('manual backup'),revision(old)))
 assert.equal(result.status,200)
 const cloud=(await (await request('GET')).json()).cloudRecord
 assert.deepEqual(cloud.data,library('manual backup'))
 assert.equal(cloud.checksum,sync.computeSongbookChecksum(library('manual backup')))
})

test('explicit scheme survives a cloud round trip; unknown scheme cannot overwrite the revision',async()=>{
 const {db,request}=await fixture()
 const data={...library('scheme'),checksumScheme:sync.SONGBOOK_CHECKSUM_SCHEME}
 assert.equal((await request('POST',postBody(data,emptyRevision))).status,200)
 const record=(await (await request('GET')).json()).cloudRecord
 assert.deepEqual(record.data,data)
 assert.equal((await request('POST',postBody({...data,checksumScheme:'unknown'},revision(record)))).status,400)
 assert.deepEqual((await (await request('GET')).json()).cloudRecord,record)
})
test('authenticated A cannot read or overwrite B; no-backup read leaves B intact',async()=>{
 const {db,request}=await fixture()
 await write(db,library('B-private'),emptyRevision,'user-b')
 const record=(await (await request('GET')).json()).cloudRecord;assert.equal(record,null)
 assert.equal((await request('POST',postBody(library('A'),emptyRevision))).status,200)
 const {findUserSongbook}=require('../functions/lib/authCore.ts')
 const b=await findUserSongbook(db,'user-b')
 assert.equal(JSON.parse(b.data_json).songs[0].rawContent,'B-private')
})
