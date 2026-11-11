const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const share = require('../functions/api/setlist/share.ts')
const sync = require('../functions/api/songbook/sync.ts')
const { createSongbookSqlite } = require('./helpers/songbookSqlite.cjs')

const payload = { type: 'GTAR_SHARED_SETLIST', name: 'Snapshot', songs: [{ title: 'Song', rawContent: '[C]Line' }] }
const call = (method, body, query = '', headers = {}) => new Request(`https://example.test/api/setlist/share${query}`, {
  method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
})
const database = () => {
  const DB = createSongbookSqlite()
  for (const name of ['0003_shared_setlists.sql', '0005_shared_setlists_revocation.sql']) DB.sqlite.exec(fs.readFileSync(`${__dirname}/../migrations/${name}`, 'utf8'))
  return DB
}

test('#453 N1: songbook cloud sync is retired with an explicit 410 for every method', async () => {
  for (const handler of ['onRequestGet', 'onRequestPost', 'onRequestPut', 'onRequestDelete']) {
    const response = await sync[handler]()
    assert.equal(response.status, 410)
    assert.equal((await response.json()).error, 'SONGBOOK_SYNC_RETIRED')
  }
  assert.equal((await sync.onRequestOptions()).status, 204)
})

test('#453 N1: Authorization is ignored on share create; every share is an anonymous 64-hex capability', async () => {
  share._resetRateLimitsForTesting()
  const DB = database()
  try {
    const created = await share.onRequestPost({ request: call('POST', payload, '', { Authorization: 'Bearer anything' }), env: { DB } })
    assert.equal(created.status, 200)
    const body = await created.json()
    assert.match(body.token, /^[a-f0-9]{64}$/)
    assert.match(body.revokeSecret, /^[a-f0-9]{64}$/)
    const row = DB.sqlite.prepare('SELECT creator_user_id, payload_json, expires_at FROM shared_setlists WHERE share_token = ?').get(body.token)
    assert.equal(row.creator_user_id, null)
    assert.equal(JSON.parse(row.payload_json).shareAccess, 'anonymous-v1')
    assert.ok(Date.parse(row.expires_at) - Date.now() <= 3 * 86400000)
    const read = await share.onRequestGet({ request: call('GET', null, `?token=${body.token}`, { Authorization: 'Bearer anything' }), env: { DB } })
    assert.equal(read.status, 200)
  } finally { DB.sqlite.close() }
})

test('#453 N1: account-era shares (short tokens, creator rows, unmarked 64-hex) are 410 and never served', async () => {
  share._resetRateLimitsForTesting()
  const DB = database()
  try {
    const insert = DB.sqlite.prepare('INSERT INTO shared_setlists (share_token,setlist_name,payload_json,created_at,expires_at,creator_user_id) VALUES (?,?,?,?,?,?)')
    const marked = JSON.stringify({ name: 'S', songs: [], shareAccess: 'anonymous-v1' })
    insert.run('a'.repeat(64), 'Unmarked', JSON.stringify({ name: 'S', songs: [] }), new Date().toISOString(), '2099-01-01', null)
    insert.run('b'.repeat(64), 'Creator', marked, new Date().toISOString(), '2099-01-01', 'user-1')
    for (const token of ['0123456789abcdef', '0123456789abcdef0123456789abcdef', 'a'.repeat(64), 'b'.repeat(64)]) {
      for (const headers of [{}, { Authorization: 'Bearer valid-looking' }]) {
        const response = await share.onRequestGet({ request: call('GET', null, `?token=${token}`, headers), env: { DB } })
        assert.equal(response.status, 410, token)
        assert.equal((await response.json()).error, 'LEGACY_SHARE_RETIRED')
      }
    }
    assert.equal((await share.onRequestGet({ request: call('GET', null, '?token=not-hex'), env: { DB } })).status, 400)
  } finally { DB.sqlite.close() }
})

test('#453 N1: revoke needs the capability secret; an account header grants nothing', async () => {
  share._resetRateLimitsForTesting()
  const DB = database()
  try {
    const { token } = await (await share.onRequestPost({ request: call('POST', payload), env: { DB } })).json()
    for (const headers of [{}, { Authorization: 'Bearer admin-looking' }]) {
      const denied = await share.handleRevokeShare(call('POST', { token }, '', headers), { DB })
      assert.equal(denied.status, 403)
    }
    const legacyToken = '0123456789abcdef0123456789abcdef'
    assert.equal((await share.handleRevokeShare(call('POST', { token: legacyToken }, '', { Authorization: 'Bearer x' }), { DB })).status, 403)
  } finally { DB.sqlite.close() }
})
