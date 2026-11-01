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
const sync = require('../src/utils/cloudSongbookSync.ts')
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
 const core=require('../functions/lib/songbookRecordsCore.ts')
 await write(db,library('old'),emptyRevision)
 await core.ensureRecordsSeeded(db,'user-a','2026-11-01T00:00:00Z')
 const old=(await (await request('GET')).json()).cloudRecord
 const result=await request('POST',postBody(library('manual backup'),revision(old)))
 assert.equal(result.status,200)
 const cloud=(await (await request('GET')).json()).cloudRecord
 assert.deepEqual(cloud.data,library('manual backup'))
 assert.equal(cloud.checksum,sync.computeSongbookChecksum(library('manual backup')))
})
