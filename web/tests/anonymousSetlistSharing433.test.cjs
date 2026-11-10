const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const api = require('../functions/api/setlist/share.ts')
const { createSongbookSqlite } = require('./helpers/songbookSqlite.cjs')
const payload = { type: 'GTAR_SHARED_SETLIST', name: 'Explicit snapshot', songs: [{ title: 'Song', rawContent: '{key: C}\n[C]Cross-device' }] }
const request = (method, body, token = '') => new Request(`https://example.test/api/setlist/share?token=${token}`, {
  method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
})
test('#433 anonymous creation, independent recipient read, capability revocation and legacy isolation', async () => {
  api._resetRateLimitsForTesting()
  const DB = createSongbookSqlite()
  for (const name of ['0003_shared_setlists.sql', '0005_shared_setlists_revocation.sql']) DB.sqlite.exec(fs.readFileSync(`${__dirname}/../migrations/${name}`, 'utf8'))
  const env = { DB }
  try {
    const created = await api.onRequestPost({ request: request('POST', payload), env })
    assert.equal(created.status, 200)
    const { token, revokeSecret, expiresAt } = await created.json()
    const ttl = Date.parse(expiresAt) - Date.now()
    assert.ok(ttl <= 3 * 86400000 && ttl > 3 * 86400000 - 1000, 'new anonymous shares expire in 3 days')
    const actualNow = Date.now
    try {
      Date.now = () => Date.parse(expiresAt) - 1
      assert.equal((await api.onRequestGet({ request: request('GET', null, token), env })).status, 200)
      Date.now = () => Date.parse(expiresAt) + 1
      assert.equal((await api.onRequestGet({ request: request('GET', null, token), env })).status, 410)
    } finally { Date.now = actualNow }
    assert.match(token, /^[a-f0-9]{64}$/)
    assert.ok(revokeSecret)
    const read = await api.onRequestGet({ request: request('GET', null, token), env })
    assert.equal(read.status, 200)
    assert.equal((await read.json()).setlist.songs[0].rawContent, payload.songs[0].rawContent)
    assert.equal((await api.handleRevokeShare(request('POST', { token, revokeSecret: 'wrong' }), env)).status, 403)
    assert.equal((await api.handleRevokeShare(request('POST', { token, revokeSecret }), env)).status, 200)
    assert.equal((await api.onRequestGet({ request: request('GET', null, token), env })).status, 410)
    const legacy = 'a'.repeat(64)
    await DB.prepare('INSERT INTO shared_setlists (share_token,setlist_name,payload_json,created_at,expires_at) VALUES (?,?,?,?,?)').bind(legacy, 'Legacy', JSON.stringify(payload), new Date().toISOString(), '2099-01-01').run()
    assert.equal((await api.onRequestGet({ request: request('GET', null, legacy), env })).status, 401)
  } finally { DB.sqlite.close() }
})


test('#433 anonymous validation, expiry, unavailable service and rate limits fail closed', async () => {
  api._resetRateLimitsForTesting()
  const DB = createSongbookSqlite()
  for (const name of ['0003_shared_setlists.sql', '0005_shared_setlists_revocation.sql']) DB.sqlite.exec(fs.readFileSync(`${__dirname}/../migrations/${name}`, 'utf8'))
  const env = { DB }
  try {
    assert.equal((await api.onRequestPost({ request: request('POST', payload), env: {} })).status, 503)
    assert.equal((await api.onRequestPost({ request: request('POST', { ...payload, songs: [] }), env })).status, 400)
    assert.equal((await api.onRequestPost({ request: request('POST', { ...payload, name: 'x'.repeat(1024 * 1024) }), env })).status, 413)
    const created = await (await api.onRequestPost({ request: request('POST', { ...payload, shareAccess: 'injected', creator_user_id: 'forged', revokeSecret: 'forged' }), env })).json()
    const read = await api.onRequestGet({ request: request('GET', null, created.token), env })
    const shared = (await read.json()).setlist
    assert.equal(shared.creator_user_id, undefined)
    assert.equal(shared.revokeSecret, undefined)
    assert.equal(shared.shareAccess, undefined)
    await DB.prepare('UPDATE shared_setlists SET expires_at = ? WHERE share_token = ?').bind('2000-01-01', created.token).run()
    assert.equal((await api.onRequestGet({ request: request('GET', null, created.token), env })).status, 410)
    assert.equal((await api.onRequestGet({ request: request('GET', null, 'z'), env })).status, 400)
    assert.equal((await api.onRequestGet({ request: request('GET', null, 'f'.repeat(64)), env })).status, 404)
    assert.equal((await api.onRequestPost({ request: request('POST', payload), env: { DB, API_ABUSE_MODE: 'durable-v1' } })).status, 503)
    api._resetRateLimitsForTesting()
    for (let i = 0; i < 30; i++) assert.equal((await api.onRequestPost({ request: request('POST', payload), env })).status, 200)
    const limited = await api.onRequestPost({ request: request('POST', payload), env })
    assert.equal(limited.status, 429)
    assert.equal(limited.headers.get('Retry-After'), '60')
  } finally { DB.sqlite.close() }
})
