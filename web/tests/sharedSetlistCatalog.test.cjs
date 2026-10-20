const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { parseConfigFileTextToJson } = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const { createSessionToken } = require('../functions/lib/authCore.ts')
const { handleSetlistCatalog, snapshotFromSongbook, validateSnapshot } = require('../functions/lib/setlistCatalog.ts')
const secret = 'setlist_catalog_tests_secret_at_least_32_bytes'
const migrations = fs.readdirSync(path.join(__dirname, '../migrations')).filter(n => n.endsWith('.sql')).sort()
const library = () => ({
  metadata: { privateBackup: 'secret' },
  songs: ['CHORD_PRO', 'TWO_LINE', 'PLAIN'].map((format, i) => ({
    id: `private-song-${i}`, title: `Song ${i}`, artist: 'Artist', rawContent: '{start_of_chorus}\n[C]Line\n{end_of_chorus}', format,
    key: 'D', originalKey: 'C', confirmedChartKey: 'C', capo: '2', transposeOffset: -2, bpm: '96', time: '6/8', year: '2020',
    tags: 'private tags', sharedSourcePublisherId: 'secret-account', lastOpenedAt: 10,
  })),
  setlists: [{ id: 'private-setlist', name: 'Sunday', songs: [0, 1, 0, 2].map(i => ({ id: `private-song-${i}`, title: `Song ${i}` })) }],
})

async function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  for (const name of migrations) sql.exec(fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8'))
  const db = { prepare(query) {
    let args = []
    return {
      bind(...values) { args = values; return this },
      async first() { return sql.prepare(query).get(...args) ?? null },
      async all() { return { success: true, results: sql.prepare(query).all(...args) } },
      async run() { return { success: true, meta: sql.prepare(query).run(...args) } },
    }
  } }
  const users = {}, tokens = {}
  for (const [id, role, status] of [['admin', 'admin', 'active'], ['other', 'admin', 'active'],
    ['member', 'member', 'active'], ['pending', 'member', 'pending'], ['denied', 'admin', 'denied']]) {
    const user = { id, google_sub: `sub-${id}`, email: `${id}@example.test`, role, access_status: status }
    sql.prepare(`INSERT INTO users(id,google_sub,email,role,access_status,created_at,updated_at,last_login_at)
      VALUES(?,?,?,?,?,'now','now','now')`).run(id, user.google_sub, user.email, role, status)
    users[id] = user
    tokens[id] = await createSessionToken(user, secret)
  }
  sql.prepare('INSERT INTO user_songbooks VALUES(?,1,?,?,?)').run('admin', JSON.stringify(library()), 'source-checksum', 'now')
  const env = { DB: db, AUTH_SECRET: secret, SHARED_SETLISTS_ENABLED: 'phase-a-v1' }
  async function call(method = 'POST', body = publish(), options = {}) {
    const headers = { Authorization: `Bearer ${tokens[options.user ?? 'admin']}`, 'Idempotency-Key': options.key ?? 'idempotency-key-0001' }
    const request = new Request(`https://local.test/api/catalog/setlists${options.id ? '/' + options.id : ''}${options.query ?? ''}`,
      { method, headers, ...(method !== 'GET' && method !== 'OPTIONS' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) })
    return handleSetlistCatalog({ request, env: options.env ?? env, params: { id: options.id } })
  }
  const create = async () => {
    const response = await call()
    assert.equal(response.status, 200, await response.clone().text())
    return response.json()
  }
  return { sql, db, env, call, create, users, tokens }
}
const publish = () => ({ snapshot_version: 1, publication_key: 'publication-key-0001', source_setlist_id: 'private-setlist', source_version: 1 })
const update = (revision = 1) => ({ snapshot_version: 1, expected_revision: revision, source_setlist_id: 'private-setlist', source_version: 1 })
const count = (f, table) => f.sql.prepare(`SELECT count(*) AS n FROM ${table}`).get().n

test('snapshot: all supported formats, repeats, key semantics, raw directives, and no private metadata', () => {
  const snapshot = snapshotFromSongbook(library(), 'private-setlist')
  assert.deepEqual(snapshot.entries.map(s => s.format), ['CHORD_PRO', 'TWO_LINE', 'CHORD_PRO', 'PLAIN'])
  assert.deepEqual(snapshot.entries[0], snapshot.entries[2])
  assert.equal(snapshot.entries[0].confirmedChartKey, 'C')
  assert.equal(snapshot.entries[0].originalKey, 'C')
  assert.equal(snapshot.entries[0].key, 'D')
  assert.equal(snapshot.entries[0].transposeOffset, -2)
  assert.equal(snapshot.entries[0].rawContent, library().songs[0].rawContent)
  assert.equal(snapshot.entries[0].capo, '2')
  assert.equal(snapshot.entries[0].time, '6/8')
  assert.doesNotMatch(JSON.stringify(snapshot), /private|secret|lastOpenedAt|Publisher/)
  const absent = library()
  for (const k of ['key', 'originalKey', 'confirmedChartKey', 'transposeOffset', 'capo', 'bpm', 'time', 'year', 'artist']) delete absent.songs[0][k]
  assert.deepEqual(Object.keys(snapshotFromSongbook(absent, 'private-setlist').entries[0]), ['title', 'rawContent', 'format'])
})

test('snapshot: reject missing, ambiguous, trash, unsupported content and occurrence overrides', () => {
  for (const mutate of [
    d => { d.songs[0].isDeleted = true }, d => { d.songs[0].isMissing = true },
    d => { d.songs.shift() }, d => { d.songs.push({ ...d.songs[0] }) },
    d => { d.setlists[0].isDeleted = true }, d => { d.setlists.push(d.setlists[0]) },
    d => { d.songs[0].format = 'UNKNOWN' }, d => { d.setlists[0].songs[0].transposeOffset = 4 },
    d => { d.songs[0].transposeOffset = 49 }, d => { d.songs[0].rawContent = '🔥'.repeat(30000) },
    d => { d.setlists[0].songs = Array(101).fill(d.setlists[0].songs[0]) },
  ]) {
    const data = library(); mutate(data)
    assert.throws(() => snapshotFromSongbook(data, 'private-setlist'))
  }
  const legacy = library()
  delete legacy.setlists[0].songs[0].id
  assert.doesNotThrow(() => snapshotFromSongbook(legacy, 'private-setlist'))
  legacy.songs.push({ ...legacy.songs[0], id: 'another' })
  assert.throws(() => snapshotFromSongbook(legacy, 'private-setlist'))
  const snapshot = snapshotFromSongbook(library(), 'private-setlist')
  assert.throws(() => validateSnapshot({ ...snapshot, version: 2 }))
  assert.throws(() => validateSnapshot({ ...snapshot, sessionToken: 'secret' }))
  assert.throws(() => validateSnapshot({ ...snapshot, entries: snapshot.entries.map(e => ({ ...e, rawContent: 'a'.repeat(70000) })) }))
})

test('gate: all routes and methods disabled before DB/auth; wrong and missing flags fail closed', async () => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
    for (const enabled of [undefined, 'true', 'false', 'phase-a-v0']) {
      const result = await handleSetlistCatalog({ request: new Request('https://test', { method }), env: { SHARED_SETLISTS_ENABLED: enabled }, params: { id: 'test' } })
      assert.equal(result.status, 404)
    }
  }
  assert.equal(require('../functions/api/catalog/setlists.ts').onRequest, handleSetlistCatalog)
  assert.equal(require('../functions/api/catalog/setlists/[id].ts').onRequest, handleSetlistCatalog)
})

test('configuration: shared setlists enabled only in DEV Preview', () => {
  const configPath = path.join(__dirname, '../wrangler.jsonc')
  const { config, error } = parseConfigFileTextToJson(configPath, fs.readFileSync(configPath, 'utf8'))
  assert.equal(error, undefined, 'wrangler.jsonc must be valid JSONC')
  assert.equal(config.env.preview.vars.SHARED_SETLISTS_ENABLED, 'phase-a-v1')
  assert.equal(Object.hasOwn(config.vars ?? {}, 'SHARED_SETLISTS_ENABLED'), false)
  assert.equal(Object.hasOwn(config.env.production.vars ?? {}, 'SHARED_SETLISTS_ENABLED'), false)
})

test('authorization: active admin only mutations; active members may read; no ownership spoof', async () => {
  const f = await fixture()
  const { id } = await f.create()
  for (const user of ['member', 'pending', 'denied']) {
    assert.equal((await f.call('POST', publish(), { user })).status, 403)
    assert.equal((await f.call('PUT', update(), { user, id })).status, 403)
    assert.equal((await f.call('DELETE', { expected_revision: 1 }, { user, id })).status, 403)
  }
  assert.equal((await f.call('GET', null, { user: 'member' })).status, 200)
  assert.equal((await f.call('GET', null, { user: 'pending' })).status, 403)
  assert.equal((await f.call('GET', null, { user: 'denied' })).status, 403)
  assert.equal((await f.call('DELETE', { expected_revision: 1 }, { user: 'other', id })).status, 409)
  assert.equal((await f.call('POST', { ...publish(), publisher_user_id: 'other' }, { key: 'another-idempotency' })).status, 400)
  const head = f.sql.prepare('SELECT * FROM catalog_setlist_heads').get()
  assert.equal(head.publisher_user_id, 'admin')
  assert.equal(f.sql.prepare('SELECT editor_user_id FROM catalog_setlist_mutations').get().editor_user_id, 'admin')
})

test('publication: browse, exact revision, immutable history and unchanged personal/catalog/QR tables', async () => {
  const f = await fixture()
  const privateBefore = f.sql.prepare('SELECT * FROM user_songbooks').get()
  const { id } = await f.create()
  const first = await (await f.call('GET', null, { id, query: '?revision=1' })).json()
  assert.deepEqual(first.snapshot, snapshotFromSongbook(library(), 'private-setlist'))
  assert.equal((await f.call('GET', null, { id })).status, 400)
  assert.equal((await f.call('GET', null, { id, query: '?revision=2' })).status, 404)
  assert.equal((await f.call('GET', null, { query: '?limit=1000' })).status, 400)
  assert.equal((await f.call('PUT', update(), { id, key: 'revision-update-0001' })).status, 200)
  assert.deepEqual(await (await f.call('GET', null, { id, query: '?revision=1' })).json(), first)
  assert.equal(count(f, 'catalog_setlist_revisions'), 2)
  assert.equal(count(f, 'shared_catalog_songs'), 0)
  assert.equal(count(f, 'shared_setlists'), 0)
  assert.deepEqual(f.sql.prepare('SELECT * FROM user_songbooks').get(), privateBefore)
  for (const query of ['UPDATE catalog_setlist_mutations SET snapshot_json=NULL', 'DELETE FROM catalog_setlist_mutations',
    'DELETE FROM catalog_setlist_revisions', 'UPDATE catalog_setlist_revisions SET revision=3', 'DELETE FROM catalog_setlist_heads']) {
    assert.throws(() => f.sql.exec(query), /SETLIST_/)
  }
})

test('idempotency: concurrent identical POSTs, changed digest and stable publication keys', async () => {
  const f = await fixture()
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.call()))
  const values = await Promise.all(responses.map(async r => { assert.equal(r.status, 200); return r.json() }))
  assert.equal(new Set(values.map(v => v.id)).size, 1)
  assert.equal(count(f, 'catalog_setlist_heads'), 1)
  assert.equal(count(f, 'catalog_setlist_mutations'), 1)
  assert.equal((await f.call('POST', { ...publish(), source_version: 2 })).status, 409)
  assert.equal((await f.call('POST', publish(), { key: 'new-key-same-publication' })).status, 409)
  f.sql.prepare('UPDATE user_songbooks SET version=2').run()
  assert.equal((await f.call()).status, 200, 'retry uses persisted result despite changed source')
})

test('idempotency: concurrent key reuse with different content has exactly one durable winner', async () => {
  const f = await fixture()
  const responses = await Promise.all([
    f.call(), f.call('POST', { ...publish(), publication_key: 'different-publication' }),
  ])
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409])
  assert.equal(count(f, 'catalog_setlist_heads'), 1)
  assert.equal(count(f, 'catalog_setlist_mutations'), 1)
})

test('idempotency: permanent old records cannot expire into new publications', async () => {
  const f = await fixture()
  const original = f.db.prepare.bind(f.db)
  f.db.prepare = query => {
    const statement = original(query)
    if (query.startsWith('INSERT INTO catalog_setlist_mutations')) {
      const bind = statement.bind.bind(statement)
      statement.bind = (...values) => { values[11] = '2000-01-01T00:00:00.000Z'; return bind(...values) }
    }
    return statement
  }
  const { id } = await f.create()
  f.db.prepare = original
  assert.equal((await f.call()).status, 200)
  assert.equal((await f.call('DELETE', { expected_revision: 1 }, { id, key: 'permanent-delete-key' })).status, 200)
  assert.equal((await f.call()).status, 410)
  assert.equal((await f.call('POST', publish(), { key: 'new-key-old-publication' })).status, 409)
  assert.equal(count(f, 'catalog_setlist_heads'), 1)
})

test('CAS: concurrent update/unpublish only one winner; mandatory expected revision; tombstones final', async () => {
  const f = await fixture(); const { id } = await f.create()
  assert.equal((await f.call('DELETE', {}, { id })).status, 400)
  const results = await Promise.all([
    f.call('PUT', update(), { id, key: 'update-concurrent-1' }),
    f.call('DELETE', { expected_revision: 1 }, { id, key: 'delete-concurrent-1' }),
  ])
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
  assert.equal(count(f, 'catalog_setlist_mutations'), 2)
  const head = f.sql.prepare('SELECT * FROM catalog_setlist_heads').get()
  if (!head.is_deleted) assert.equal((await f.call('DELETE', { expected_revision: 2 }, { id, key: 'delete-final-0001' })).status, 200)
  assert.equal((await f.call()).status, 410)
  assert.equal((await f.call('GET', null, { id, query: '?revision=1' })).status, 404)
  assert.deepEqual((await (await f.call('GET')).json()).setlists, [])
  assert.equal((await f.call('PUT', update(3), { id, key: 'update-after-delete' })).status, 409)
  assert.throws(() => f.sql.exec('UPDATE catalog_setlist_heads SET is_deleted=0,deleted_at=NULL,deleted_by_user_id=NULL,current_revision=current_revision+1'), /SETLIST_TOMBSTONE/)
})

test('CAS: concurrent updates cannot both win', async () => {
  const f = await fixture(); const { id } = await f.create()
  const responses = await Promise.all([1, 2].map(n => f.call('PUT', update(), { id, key: `update-race-key-00${n}` })))
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409])
  assert.equal(count(f, 'catalog_setlist_revisions'), 2)
})

test('failure: injected trigger abort rolls back mutation, head and revision; lost response retry safe', async () => {
  const f = await fixture()
  f.sql.exec(`CREATE TRIGGER inject_failure BEFORE INSERT ON catalog_setlist_revisions BEGIN SELECT RAISE(ABORT,'injected'); END`)
  assert.equal((await f.call()).status, 503)
  for (const name of ['heads', 'revisions', 'mutations']) assert.equal(count(f, `catalog_setlist_${name}`), 0)
  f.sql.exec('DROP TRIGGER inject_failure')
  const original = f.db.prepare.bind(f.db)
  f.db.prepare = query => {
    const statement = original(query)
    if (query.startsWith('INSERT INTO catalog_setlist_mutations')) {
      const run = statement.run.bind(statement)
      statement.run = async () => { await run(); throw new Error('transport lost after commit') }
    }
    return statement
  }
  assert.equal((await f.call()).status, 503)
  f.db.prepare = original
  assert.equal((await f.call()).status, 200)
  assert.equal(count(f, 'catalog_setlist_heads'), 1)
})

test('failure: source changes between resolution and commit, missing guards and zero-change writes fail safe', async () => {
  const f = await fixture()
  const original = f.db.prepare.bind(f.db)
  f.db.prepare = query => {
    if (query.startsWith('INSERT INTO catalog_setlist_mutations')) f.sql.exec('UPDATE user_songbooks SET version=2')
    return original(query)
  }
  assert.equal((await f.call()).status, 409)
  assert.equal(count(f, 'catalog_setlist_heads'), 0)
  f.db.prepare = original
  f.sql.exec('UPDATE user_songbooks SET version=1')
  f.db.prepare = query => {
    const statement = original(query)
    if (query.startsWith('INSERT INTO catalog_setlist_mutations')) statement.run = async () => ({ success: true, meta: { changes: 0 } })
    return statement
  }
  assert.equal((await f.call()).status, 503)
  f.db.prepare = original
  f.sql.exec('DROP TRIGGER catalog_setlist_apply')
  assert.equal((await f.call()).status, 503)
})

test('rate limits: durable fixed-row attempt counts, day budget, missing limiter fails closed', async () => {
  const f = await fixture()
  await f.create()
  f.sql.exec("UPDATE catalog_setlist_rates SET minute_count=30 WHERE kind='write'")
  assert.equal((await f.call()).status, 429)
  f.sql.exec("UPDATE catalog_setlist_rates SET minute=minute-1,day_count=200 WHERE kind='write'")
  assert.equal((await f.call()).status, 429)
  f.sql.exec("UPDATE catalog_setlist_rates SET day=day-1 WHERE kind='write'")
  assert.equal((await f.call()).status, 200)
  await f.call('GET')
  f.sql.exec("UPDATE catalog_setlist_rates SET minute_count=120 WHERE kind='read'")
  assert.equal((await f.call('GET')).status, 429)
  assert.equal(count(f, 'catalog_setlist_rates'), 2)
  f.sql.exec('DROP TABLE catalog_setlist_rates')
  assert.equal((await f.call()).status, 503)
})

test('quota: publication, revision and storage bounds enforced atomically; unpublish still available', async () => {
  const f = await fixture(); const { id } = await f.create()
  // Populate independently owned heads to the exact owner cap using disposable SQL fixtures.
  const insert = f.sql.prepare('INSERT INTO catalog_setlist_heads(id,publisher_user_id,publication_key,current_revision) VALUES(?,?,?,1)')
  for (let i = 1; i < 100; i++) insert.run(`fixture-head-${i}`, 'admin', `fixture-publication-${i}`)
  assert.equal((await f.call('POST', { ...publish(), publication_key: 'over-quota-publication' }, { key: 'quota-create-key-01' })).status, 429)
  assert.equal(count(f, 'catalog_setlist_mutations'), 1)
  // Exact revision cap with no API rate-budget distortion.
  f.sql.exec('DROP TRIGGER catalog_setlist_head_guard')
  f.sql.prepare('UPDATE catalog_setlist_heads SET current_revision=100 WHERE id=?').run(id)
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/0007_shared_catalog_setlists.sql'), 'utf8')
  f.sql.exec(migration.slice(migration.indexOf('CREATE TRIGGER catalog_setlist_head_guard')))
  assert.equal((await f.call('PUT', update(100), { id, key: 'quota-revision-key01' })).status, 429)
  assert.equal((await f.call('DELETE', { expected_revision: 100 }, { id, key: 'quota-delete-key001' })).status, 200)
})

test('request: oversized/malformed JSON, unknown snapshot version, invalid source and keys rejected', async () => {
  const f = await fixture()
  for (const [body, status] of [['{bad', 400], ['x'.repeat(4097), 413],
    [{ ...publish(), snapshot_version: 2 }, 400], [{ ...publish(), source_version: 2 }, 409],
    [{ ...publish(), source_setlist_id: 'missing' }, 422], [{ ...publish(), snapshot: {} }, 400]]) {
    assert.equal((await f.call('POST', body)).status, status)
  }
  assert.equal((await f.call('POST', publish(), { key: 'short' })).status, 400)
  assert.equal(count(f, 'catalog_setlist_heads'), 0)
})

test('environment: identity and catalog data never cross DB bindings', async () => {
  const dev = await fixture(); const prod = await fixture()
  const { id } = await dev.create()
  assert.equal((await prod.call('GET', null, { id, query: '?revision=1' })).status, 404)
  assert.equal(count(prod, 'catalog_setlist_heads'), 0)
  prod.sql.exec("UPDATE users SET access_status='denied' WHERE id='admin'")
  assert.equal((await prod.call('GET')).status, 403)
  assert.equal((await dev.call('GET')).status, 200)
})

test('expiry and abuse: expired sessions, revoked approval and key reuse cannot bypass authorization', async () => {
  const f = await fixture()
  await f.create()
  f.tokens.admin = await createSessionToken(f.users.admin, secret, -60000)
  assert.equal((await f.call()).status, 401)
  f.tokens.admin = await createSessionToken(f.users.admin, secret)
  f.sql.exec("UPDATE users SET role='member' WHERE id='admin'")
  assert.equal((await f.call()).status, 403)
  f.sql.exec("UPDATE users SET role='admin',access_status='denied' WHERE id='admin'")
  assert.equal((await f.call()).status, 403)
  assert.equal(count(f, 'catalog_setlist_mutations'), 1)
})

test('storage quota: retained snapshot bytes counted once, failed insert rollback, deletion permits no refund', async () => {
  const f = await fixture()
  const large = library()
  large.songs.forEach(song => { song.rawContent = 'a'.repeat(60000) })
  f.sql.prepare('UPDATE user_songbooks SET data_json=?').run(JSON.stringify(large))
  const { id } = await f.create()
  let revision = 1, response
  do {
    f.sql.exec("UPDATE catalog_setlist_rates SET minute_count=1,day_count=1 WHERE kind='write'")
    response = await f.call('PUT', update(revision), { id, key: `storage-quota-key-${revision}` })
    if (response.status === 200) revision++
  } while (response.status === 200 && revision < 100)
  assert.equal(response.status, 429)
  assert.ok(revision > 60 && revision < 100)
  const { bytes } = f.sql.prepare('SELECT sum(snapshot_bytes) AS bytes FROM catalog_setlist_mutations').get()
  assert.ok(bytes <= 16777216)
  assert.equal(count(f, 'catalog_setlist_revisions'), revision)
  assert.equal((await f.call('DELETE', { expected_revision: revision }, { id, key: 'storage-delete-key' })).status, 200)
  assert.equal(f.sql.prepare('SELECT sum(snapshot_bytes) AS bytes FROM catalog_setlist_mutations').get().bytes, bytes)
})

test('global publication quota and SQL snapshot/foreign-key constraints', async () => {
  const f = await fixture()
  const insert = f.sql.prepare('INSERT INTO catalog_setlist_heads(id,publisher_user_id,publication_key,current_revision) VALUES(?,?,?,1)')
  for (let i = 0; i < 1000; i++) insert.run(`global-head-${i}`, 'other', `global-publication-${i}`)
  assert.equal((await f.call()).status, 429)
  assert.equal(count(f, 'catalog_setlist_mutations'), 0)
  assert.throws(() => f.sql.prepare('INSERT INTO catalog_setlist_revisions VALUES(?,?,?)').run('missing', 1, 1), /FOREIGN KEY/)
  const command = f.sql.prepare(`INSERT INTO catalog_setlist_mutations(editor_user_id,idempotency_key,request_digest,
    operation,setlist_id,publication_key,expected_revision,source_version,source_checksum,snapshot_json,snapshot_bytes,created_at)
    VALUES('admin','schema-test-key-001',?,'create','schema-test-head','schema-publication',0,1,'source-checksum',?,?,'now')`)
  for (const snapshot of [{}, { version: 2, name: 'Test', entries: [{}] }, { version: 1, name: '', entries: [] }]) {
    const json = JSON.stringify(snapshot)
    assert.throws(() => command.run('a'.repeat(64), json, Buffer.byteLength(json)), /CHECK/)
  }
})

// Real disposable D1 binding, independent of the SQLite test adapter. No remote config.
test('D1: migration sequence, real concurrent retries/CAS, batch zero-row semantics and injected rollback', { timeout: 30000 }, async () => {
  const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = require('miniflare')
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ modules: true,
    script: 'export default {fetch(){return new Response("local test")}}',
    d1Databases: { DB: 'issue108-disposable-only' }, log: new Log(LogLevel.ERROR) }] }))
  try {
    const db = await mf.getD1Database('DB')
    // Preserve complete trigger bodies (CASE ... END is not a statement boundary).
    for (const file of migrations) {
      const lines = fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8').replace(/--[^\n]*/g, '').split('\n')
      let statement = '', trigger = false
      for (const line of lines) {
        if (/^CREATE TRIGGER/i.test(line.trim())) trigger = true
        statement += line + '\n'
        if ((!trigger && /;\s*$/.test(line)) || (trigger && (/^END;\s*$/.test(line.trim()) || /^BEGIN .* END;\s*$/.test(line.trim())))) {
          await db.prepare(statement.trim()).run()
          statement = ''; trigger = false
        }
      }
      assert.equal(statement.trim(), '')
    }
    const f = await fixture()
    await db.prepare(`INSERT INTO users(id,google_sub,email,role,access_status,created_at,updated_at,last_login_at)
      VALUES('admin','sub-admin','admin@example.test','admin','active','now','now','now')`).run()
    await db.prepare('INSERT INTO user_songbooks VALUES(?,1,?,?,?)').bind('admin', JSON.stringify(library()), 'source-checksum', 'now').run()
    const env = { ...f.env, DB: db }
    const responses = await Promise.all([1, 2, 3].map(() => f.call('POST', publish(), { env })))
    for (const response of responses) assert.equal(response.status, 200, await response.clone().text())
    const { id } = await responses[0].json()
    assert.equal((await db.prepare('SELECT count(*) AS n FROM catalog_setlist_heads').first()).n, 1)
    const race = await Promise.all([
      f.call('PUT', update(), { env, id, key: 'local-d1-update-key' }),
      f.call('DELETE', { expected_revision: 1 }, { env, id, key: 'local-d1-delete-key' }),
    ])
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409])
    // D1 batch's zero-row UPDATE is success, not an abort. The API uses a trigger
    // assertion in a single statement instead of inferring CAS from batch success.
    const zero = await db.batch([db.prepare('UPDATE catalog_setlist_heads SET current_revision=9 WHERE id=?').bind('missing')])
    assert.equal(zero[0].success, true)
    assert.equal(zero[0].meta.changes, 0)
    await db.prepare(`CREATE TRIGGER local_injected_failure BEFORE INSERT ON catalog_setlist_revisions
      BEGIN SELECT RAISE(ABORT,'injected'); END`).run()
    const failed = await f.call('POST', { ...publish(), publication_key: 'local-rollback-publication' }, { env, key: 'local-rollback-key' })
    assert.equal(failed.status, 503)
    assert.equal((await db.prepare('SELECT count(*) AS n FROM catalog_setlist_mutations').first()).n, 2)
    assert.equal((await db.prepare('SELECT count(*) AS n FROM catalog_setlist_heads').first()).n, 1)
    assert.equal((await db.prepare('SELECT count(*) AS n FROM catalog_setlist_revisions').first()).n, 2)
  } finally { await mf.dispose() }
})
