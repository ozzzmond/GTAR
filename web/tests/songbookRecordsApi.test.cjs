// RFC #188 S4: per-record songbook sync API on SQLite running the real 0002 + 0009 migrations.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
const { createSongbookSqlite } = require('./helpers/songbookSqlite.cjs')
const { createSessionToken, upsertUserSongbook, findUserSongbook } = require('../functions/lib/authCore.ts')
const api = require('../functions/api/songbook/records.ts')
const sync = require('../src/utils/cloudSongbookSync.ts')
const records = require('../src/utils/songbookRecords.ts')

const song = (id, extra = {}) => ({ id, title: `Song ${id}`, artist: 'A', rawContent: `[G]Line ${id}`, ...extra })
const setlist = (id, songIds) => ({ id, name: `List ${id}`, songs: songIds.map(s => ({ id: s, title: `Song ${s}`, artist: 'A' })) })

async function fixture({ enabled = true } = {}) {
  const db = createSongbookSqlite()
  const users = { 'user-a': { id: 'user-a', google_sub: 'sub-a', email: 'a@example.com', role: 'member', access_status: 'active' },
    'user-b': { id: 'user-b', google_sub: 'sub-b', email: 'b@example.com', role: 'member', access_status: 'active' } }
  const original = db.prepare.bind(db)
  db.prepare = sql => sql.includes('FROM users WHERE id = ?')
    ? { sql, bound: [], bind(id) { return { first: async () => users[id] ?? null } } } : original(sql)
  const env = { DB: db, AUTH_SECRET: 'records-test-secret', ...(enabled ? { SONGBOOK_RECORDS_SYNC: 'records-v1' } : {}) }
  const tokens = { 'user-a': await createSessionToken(users['user-a'], env.AUTH_SECRET), 'user-b': await createSessionToken(users['user-b'], env.AUTH_SECRET) }
  const call = async (method, { user = 'user-a', since = 0, limit, body } = {}) => {
    const url = `https://example.com/api/songbook/records?since=${since}${limit ? `&limit=${limit}` : ''}`
    const res = await api[method === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env, request: new Request(url, { method,
      headers: { Authorization: `Bearer ${tokens[user]}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }) })
    return { status: res.status, json: await res.json() }
  }
  const seedV1 = async (library, user = 'user-a') => upsertUserSongbook(db, user, JSON.stringify(library),
    sync.computeSongbookChecksum(library), '2026-10-24T00:00:00Z', { version: 0, checksum: null })
  return { db, call, seedV1 }
}

test('disabled without the DEV flag', async () => {
  const { call } = await fixture({ enabled: false })
  assert.equal((await call('GET')).status, 404)
  assert.equal((await call('POST', { body: { changes: [] } })).json.code, 'RECORDS_SYNC_DISABLED')
})

test('first read seeds records from the whole-document songbook, in order, at rev 1', async () => {
  const { call, seedV1 } = await fixture()
  await seedV1({ songs: [song('s1'), song('s2')], setlists: [setlist('l1', ['s1'])] })
  const { status, json } = await call('GET')
  assert.equal(status, 200)
  assert.deepEqual(json.records.map(r => `${r.kind}:${r.id}:${r.rev}:${r.seq}`), ['song:s1:1:1', 'song:s2:1:2', 'setlist:l1:1:3'])
  assert.equal(json.head, 3)
  assert.equal(json.more, false)
  assert.deepEqual(json.records[0].data, song('s1'))
  assert.equal(json.records[0].checksum, records.recordChecksum(false, song('s1')))
})

test('new user without a songbook starts empty', async () => {
  const { call } = await fixture()
  const { json } = await call('GET')
  assert.deepEqual(json.records, [])
  assert.equal(json.head, 0)
})

test('push: new record accepted at rev 1; pull since the old head returns only it', async () => {
  const { call, seedV1 } = await fixture()
  await seedV1({ songs: [song('s1')], setlists: [] })
  const head = (await call('GET')).json.head
  const push = await call('POST', { body: { changes: [{ kind: 'song', id: 's2', baseRev: 0, data: song('s2') }] } })
  assert.equal(push.status, 200)
  assert.deepEqual(push.json.accepted.map(a => [a.id, a.rev, a.seq]), [['s2', 1, head + 1]])
  assert.deepEqual(push.json.conflicts, [])
  const pulled = await call('GET', { since: head })
  assert.deepEqual(pulled.json.records.map(r => r.id), ['s2'])
})

test('stale base revision is a conflict and the stored record is untouched (no last-write-wins)', async () => {
  const { call, seedV1 } = await fixture()
  await seedV1({ songs: [song('s1')], setlists: [] })
  await call('GET')
  await call('POST', { body: { changes: [{ kind: 'song', id: 's1', baseRev: 1, data: song('s1', { rawContent: 'device A' }) }] } })
  const stale = await call('POST', { body: { changes: [{ kind: 'song', id: 's1', baseRev: 1, data: song('s1', { rawContent: 'device B' }) }] } })
  assert.deepEqual(stale.json.accepted, [])
  assert.equal(stale.json.conflicts[0].current.rev, 2)
  assert.equal(stale.json.conflicts[0].current.data.rawContent, 'device A')
  const all = await call('GET')
  assert.equal(all.json.records.find(r => r.id === 's1').data.rawContent, 'device A')
})

test('identical content from a stale base is accepted without a write', async () => {
  const { call, seedV1 } = await fixture()
  await seedV1({ songs: [song('s1')], setlists: [] })
  const head = (await call('GET')).json.head
  const same = await call('POST', { body: { changes: [{ kind: 'song', id: 's1', baseRev: 0, data: song('s1') }] } })
  assert.deepEqual(same.json.accepted.map(a => [a.id, a.rev]), [['s1', 1]])
  assert.equal(same.json.head, head, 'no new sequence number')
  assert.equal(same.json.mirror, 'unchanged')
})

test('a writer racing between read and write turns the change into a conflict', async () => {
  const { db, call, seedV1 } = await fixture()
  await seedV1({ songs: [song('s1')], setlists: [] })
  await call('GET')
  let raced = false
  db.beforeBatchStatement = (index, statement) => {
    if (!raced && /UPDATE user_songbook_records/.test(statement.sql)) {
      raced = true
      db.sqlite.prepare("UPDATE user_songbook_records SET rev = rev + 1, data_json = ?, checksum = 'rk_other' WHERE record_id = 's1'")
        .run(JSON.stringify(song('s1', { rawContent: 'racer' })))
    }
  }
  const res = await call('POST', { body: { changes: [{ kind: 'song', id: 's1', baseRev: 1, data: song('s1', { rawContent: 'mine' }) }] } })
  db.beforeBatchStatement = null
  assert.deepEqual(res.json.accepted, [])
  assert.equal(res.json.conflicts[0].current.data.rawContent, 'racer')
})

test('removal is a tombstone in the change feed and leaves the mirrored songbook', async () => {
  const { db, call, seedV1 } = await fixture()
  await seedV1({ songs: [song('s1'), song('s2')], setlists: [] })
  const head = (await call('GET')).json.head
  const res = await call('POST', { body: { changes: [{ kind: 'song', id: 's2', baseRev: 1, removed: true }] } })
  assert.equal(res.json.accepted[0].rev, 2)
  assert.equal(res.json.mirror, 'updated')
  const feed = await call('GET', { since: head })
  assert.deepEqual(feed.json.records.map(r => [r.id, r.removed, r.data]), [['s2', true, null]])
  const mirrored = JSON.parse((await findUserSongbook(db, 'user-a')).data_json)
  assert.deepEqual(mirrored.songs.map(s => s.id), ['s1'])
})

test('mirror keeps the whole-document songbook in step (valid checksum, version bumped, order kept)', async () => {
  const { db, call, seedV1 } = await fixture()
  await seedV1({ songs: [song('s1'), song('s2')], setlists: [setlist('l1', ['s1', 's2'])] })
  await call('GET')
  await call('POST', { body: { changes: [
    { kind: 'song', id: 's1', baseRev: 1, data: song('s1', { rawContent: 'edited' }) },
    { kind: 'song', id: 's3', baseRev: 0, data: song('s3') },
  ] } })
  const row = await findUserSongbook(db, 'user-a')
  const library = JSON.parse(row.data_json)
  assert.equal(row.version, 2)
  assert.equal(row.checksum, sync.computeSongbookChecksum(library))
  assert.deepEqual(library.songs.map(s => s.id), ['s1', 's2', 's3'], 'insertion order, not change order')
  assert.equal(library.songs[0].rawContent, 'edited')
})

test('pagination: pages follow the sequence and end with more=false', async () => {
  const { call, seedV1 } = await fixture()
  await seedV1({ songs: [song('s1'), song('s2'), song('s3'), song('s4'), song('s5')], setlists: [] })
  const ids = []
  let since = 0
  for (let guard = 0; guard < 10; guard++) {
    const page = (await call('GET', { since, limit: 2 })).json
    ids.push(...page.records.map(r => r.id))
    since = page.cursor
    if (!page.more) break
  }
  assert.deepEqual(ids, ['s1', 's2', 's3', 's4', 's5'])
})

test('users are isolated', async () => {
  const { call, seedV1 } = await fixture()
  await seedV1({ songs: [song('secret')], setlists: [] }, 'user-a')
  await call('GET', { user: 'user-a' })
  const other = await call('GET', { user: 'user-b' })
  assert.deepEqual(other.json.records, [])
  const write = await call('POST', { user: 'user-b', body: { changes: [{ kind: 'song', id: 'secret', baseRev: 1, data: song('secret', { rawContent: 'x' }) }] } })
  assert.equal(write.json.conflicts.length, 1, 'user B has no such record; user A untouched')
  assert.equal((await call('GET', { user: 'user-a' })).json.records[0].data.rawContent, '[G]Line secret')
})

test('validation rejects malformed changes before any write', async () => {
  const { call } = await fixture()
  const bad = async changes => (await call('POST', { body: { changes } })).status
  assert.equal(await bad([]), 400)
  assert.equal(await bad([{ kind: 'album', id: 'x', baseRev: 0, data: {} }]), 400)
  assert.equal(await bad([{ kind: 'song', id: 's1', baseRev: 0, data: song('other') }]), 400)
  assert.equal(await bad([{ kind: 'song', id: 's1', baseRev: -1, data: song('s1') }]), 400)
  assert.equal(await bad([{ kind: 'song', id: 's1', baseRev: 0, data: song('s1') }, { kind: 'song', id: 's1', baseRev: 0, data: song('s1') }]), 400)
  assert.equal(await bad([{ kind: 'song', id: 's1', baseRev: 0, removed: true }]), 400)
  assert.equal(await bad([{ kind: 'setlist', id: 'l1', baseRev: 0, data: { id: 'l1', name: 'L' } }]), 400)
  assert.equal(await bad([{ kind: 'theme', id: 'other', baseRev: 0, data: {} }]), 400)
  assert.equal(await bad(Array.from({ length: 26 }, (_, i) => ({ kind: 'song', id: `s${i}`, baseRev: 0, data: song(`s${i}`) }))), 400)
  assert.equal(await bad([{ kind: 'song', id: 's1', baseRev: 0, data: song('s1', { rawContent: 'x'.repeat(600 * 1024) }) }]), 400)
})

test('record checksum ignores key order and undefined members', () => {
  assert.equal(records.recordChecksum(false, { a: 1, b: { c: 2, d: undefined } }), records.recordChecksum(false, { b: { c: 2 }, a: 1 }))
  assert.notEqual(records.recordChecksum(false, { a: 1 }), records.recordChecksum(false, { a: 2 }))
  assert.notEqual(records.recordChecksum(true, null), records.recordChecksum(false, null))
})

test('one push uses a bounded number of D1 statements (Free plan: 50 per invocation)', async () => {
  const { db, call, seedV1 } = await fixture()
  await seedV1({ songs: Array.from({ length: 300 }, (_, i) => song(`s${i}`)), setlists: [] })
  let statements = 0
  const prepare = db.prepare
  db.prepare = sql => { statements++; return prepare(sql) }
  const changes = Array.from({ length: 25 }, (_, i) => ({ kind: 'song', id: `s${i}`, baseRev: 1, data: song(`s${i}`, { rawContent: 'edit' }) }))
  const res = await call('POST', { body: { changes } })
  assert.equal(res.json.accepted.length, 25)
  assert.ok(statements <= 45, `statements ${statements}`)
  statements = 0
  const fresh = await fixture()
  await fresh.seedV1({ songs: Array.from({ length: 500 }, (_, i) => song(`s${i}`)), setlists: [] })
  const freshPrepare = fresh.db.prepare
  fresh.db.prepare = sql => { statements++; return freshPrepare(sql) }
  const seeded = await fresh.call('GET', { limit: 200 })
  assert.equal(seeded.json.head, 500)
  assert.ok(statements <= 10, `seed statements ${statements}`)
})
