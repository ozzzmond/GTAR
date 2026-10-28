// #253 Catalog V2: client-submitted setlist snapshots, admin moderation of any setlist,
// reactive catalog_reports and legacy/old-client compatibility. Disposable SQLite, synthetic users only.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { CLIENT_SNAPSHOT_BODY_BYTES } = require('../functions/lib/setlistCatalog.ts')
const { fixture, snapshot, sha, clientCreate, clientUpdate, legacyCreate, legacyUpdate, ok, seedSongs, songReport } = require('./helpers/catalogV2Fixture.cjs')

test('client snapshot publish needs no personal cloud songbook; stored as source_kind=client with sha256(snapshot_json)', async () => {
  const f = await fixture()
  assert.equal(f.sql.prepare("SELECT count(*) AS n FROM user_songbooks WHERE user_id='member'").get().n, 0)
  const { id, revision } = await ok(await f.call('POST', clientCreate()))
  assert.equal(revision, 1)
  const row = f.sql.prepare('SELECT * FROM catalog_setlist_mutations WHERE setlist_id = ?').get(id)
  assert.equal(row.source_kind, 'client')
  assert.equal(row.source_version, 1)
  assert.equal(row.source_checksum, sha(row.snapshot_json))
  assert.equal(row.editor_user_id, 'member')
  assert.doesNotMatch(row.snapshot_json, /private tags|lastOpenedAt|song-0/)
  const read = await ok(await f.call('GET', undefined, { id, query: '?revision=1', user: 'member2' }))
  assert.deepEqual(read.snapshot, snapshot())
  const list = await ok(await f.call('GET', undefined, { user: 'member2' }))
  assert.deepEqual(list.capabilities, { client_snapshots: true })
  assert.equal(list.setlists[0].occurrences, 4)
})

test('client snapshot: canonical field order, nulls dropped; update keeps immutable history and CAS', async () => {
  const f = await fixture()
  const scrambled = snapshot()
  scrambled.entries = scrambled.entries.map(e => ({ ...Object.fromEntries(Object.entries(e).reverse()), bpm: null }))
  const { id } = await ok(await f.call('POST', clientCreate('member-publication-0001', scrambled)))
  assert.equal(f.sql.prepare('SELECT snapshot_json FROM catalog_setlist_mutations').get().snapshot_json, JSON.stringify(snapshot()))
  const changed = snapshot(); changed.name = 'Sunday v2'
  await ok(await f.call('PUT', clientUpdate(1, changed), { id }))
  assert.equal((await f.call('PUT', clientUpdate(1, changed), { id })).status, 409, 'stale revision')
  for (const op of ['UPDATE catalog_setlist_mutations SET snapshot_json = NULL', 'DELETE FROM catalog_setlist_mutations',
    'UPDATE catalog_setlist_revisions SET revision = 9', 'DELETE FROM catalog_setlist_revisions', 'DELETE FROM catalog_setlist_heads']) {
    assert.throws(() => f.sql.exec(op), /SETLIST_(IMMUTABLE|TOMBSTONE)/)
  }
  assert.equal((await ok(await f.call('GET', undefined, { id, query: '?revision=1' }))).snapshot.name, 'Sunday')
  assert.equal((await ok(await f.call('GET', undefined, { id, query: '?revision=2' }))).snapshot.name, 'Sunday v2')
})

test('client snapshot idempotency: exact replay returns the same result once; same key with other content conflicts', async () => {
  const f = await fixture()
  const first = await ok(await f.call('POST', clientCreate(), { key: 'replay-key-000000001' }))
  const scrambled = snapshot(); scrambled.entries = scrambled.entries.map(e => Object.fromEntries(Object.entries(e).reverse()))
  assert.deepEqual(await ok(await f.call('POST', clientCreate('member-publication-0001', scrambled), { key: 'replay-key-000000001' })), first, 'canonical replay')
  const other = snapshot(); other.name = 'Other'
  assert.equal((await f.call('POST', clientCreate('member-publication-0001', other), { key: 'replay-key-000000001' })).status, 409)
  assert.equal((await f.call('POST', clientCreate(), { key: 'replay-key-000000002' })).status, 409, 'publication key cannot create twice')
  assert.equal(f.count('catalog_setlist_mutations'), 1)
})

test('malformed and oversized client snapshots are rejected atomically (400/413/422), nothing written', async () => {
  const f = await fixture()
  const big = snapshot()
  big.entries = Array.from({ length: 3 }, () => ({ ...big.entries[0], rawContent: 'x'.repeat(100000) }))
  const many = snapshot(); many.entries = Array(101).fill(many.entries[0])
  const cases = [
    [clientCreate('member-publication-0001', big), 413],
    ['{"snapshot":' + JSON.stringify('y'.repeat(CLIENT_SNAPSHOT_BODY_BYTES)) + '}', 413],
    [clientCreate('member-publication-0001', many), 422],
    [clientCreate('member-publication-0001', { ...snapshot(), version: 2 }), 422],
    [clientCreate('member-publication-0001', { ...snapshot(), owner: 'admin' }), 422],
    [clientCreate('member-publication-0001', { ...snapshot(), entries: [{ ...snapshot().entries[0], id: 'private' }] }), 422],
    [clientCreate('member-publication-0001', { ...snapshot(), entries: [{ ...snapshot().entries[0], format: 'HTML' }] }), 422],
    [clientCreate('member-publication-0001', { ...snapshot(), entries: [{ ...snapshot().entries[0], rawContent: '' }] }), 422],
    [clientCreate('member-publication-0001', 'not-an-object'), 422],
    [{ ...clientCreate(), source_version: 1 }, 400],
    [{ ...clientCreate(), publisher_user_id: 'admin' }, 400],
    [{ ...clientCreate(), snapshot_version: 2 }, 400],
    [{ ...clientCreate(), publication_key: 'short' }, 400],
    ['x'.repeat(4097), 413],
    [JSON.stringify({ ...legacyCreate(), padding: 'p'.repeat(5000) }), 413],
    ['{bad', 400],
  ]
  for (const [body, status] of cases) assert.equal((await f.call('POST', body)).status, status, JSON.stringify(body).slice(0, 80))
  assert.equal(f.count('catalog_setlist_mutations'), 0)
  assert.equal(f.count('catalog_setlist_heads'), 0)
  // Largest valid snapshot (just under 256 KB) fits the raised client-snapshot body cap.
  const max = snapshot(); max.entries = Array.from({ length: 3 }, () => ({ ...max.entries[0], rawContent: 'x'.repeat(87000) }))
  await ok(await f.call('POST', clientCreate('member-publication-0002', max)))
})

test('legacy path and old clients unchanged: songbook source validation, digests, 4 KB cap, no capability needed', async () => {
  const f = await fixture()
  const { id } = await ok(await f.call('POST', legacyCreate(), { user: 'admin', key: 'legacy-key-0000001' }))
  const row = f.sql.prepare('SELECT source_kind, source_checksum, source_version FROM catalog_setlist_mutations').get()
  assert.deepEqual({ ...row }, { source_kind: 'songbook', source_checksum: 'source-checksum', source_version: 1 })
  assert.equal((await f.call('POST', legacyCreate(), { user: 'admin', key: 'legacy-key-0000001' })).status, 200, 'replay')
  assert.equal((await f.call('PUT', { ...legacyUpdate(1), source_version: 2 }, { user: 'admin', id })).status, 409)
  await ok(await f.call('PUT', legacyUpdate(1), { user: 'admin', id }))
  // Members without a cloud songbook still cannot use the legacy path.
  assert.equal((await f.call('POST', { ...legacyCreate(), publication_key: 'member-legacy-key-01' })).status, 409)
  // Direct legacy-kind insert with a forged checksum still fails in SQL.
  assert.throws(() => f.sql.prepare(`INSERT INTO catalog_setlist_mutations(editor_user_id,idempotency_key,request_digest,operation,setlist_id,
    publication_key,expected_revision,source_version,source_checksum,snapshot_json,snapshot_bytes,created_at)
    VALUES('member','sql-key-000000000001',?,'create','sql-set','sql-publication-0001',0,1,'forged',?,?,'now')`)
    .run('a'.repeat(64), JSON.stringify(snapshot()), Buffer.byteLength(JSON.stringify(snapshot()))), /SETLIST_SOURCE_CONFLICT/)
})

test('client-kind SQL guards: checksum shape, version 1, unpublish kind; failed statement leaves no rows', async () => {
  const f = await fixture()
  const json = JSON.stringify(snapshot())
  const insert = (version, checksum, key) => f.sql.prepare(`INSERT INTO catalog_setlist_mutations(editor_user_id,idempotency_key,request_digest,operation,setlist_id,
    publication_key,expected_revision,source_version,source_checksum,snapshot_json,snapshot_bytes,created_at,source_kind)
    VALUES('member',?,?,'create','sql-set','sql-publication-0001',0,?,?,?,?,'now','client')`).run(key, 'a'.repeat(64), version, checksum, json, Buffer.byteLength(json))
  assert.throws(() => insert(2, sha(json), 'sql-key-000000000001'), /SETLIST_SOURCE_CONFLICT/)
  assert.throws(() => insert(1, 'G'.repeat(64), 'sql-key-000000000002'), /SETLIST_SOURCE_CONFLICT/)
  assert.throws(() => insert(1, 'abc', 'sql-key-000000000003'), /SETLIST_SOURCE_CONFLICT/)
  assert.throws(() => f.sql.exec("INSERT INTO catalog_setlist_mutations(editor_user_id,idempotency_key,request_digest,operation,setlist_id,publication_key,expected_revision,source_version,source_checksum,snapshot_json,snapshot_bytes,created_at,source_kind) VALUES('member','sql-key-000000000004','" + 'a'.repeat(64) + "','create','x','sql-publication-0002',0,1,'x','{}',2,'now','other')"), /CHECK/)
  assert.equal(f.count('catalog_setlist_mutations'), 0)
  assert.equal(f.count('catalog_setlist_heads'), 0)
})

test('admin may edit/unpublish any setlist; publisher stays immutable, editor recorded; members cannot', async () => {
  const f = await fixture()
  const { id } = await ok(await f.call('POST', clientCreate()))
  const edited = snapshot(); edited.name = 'Moderated'
  // Other members: original non-disclosing 409; pending/denied: 403.
  assert.equal((await f.call('PUT', clientUpdate(1, edited), { id, user: 'member2' })).status, 409)
  assert.equal((await f.call('DELETE', { expected_revision: 1 }, { id, user: 'member2' })).status, 409)
  for (const user of ['pending', 'denied']) assert.equal((await f.call('DELETE', { expected_revision: 1 }, { id, user })).status, 403)
  // An admin's legacy songbook body cannot overwrite another publisher's setlist.
  assert.equal((await f.call('PUT', legacyUpdate(1), { id, user: 'admin' })).status, 403)
  await ok(await f.call('PUT', clientUpdate(1, edited), { id, user: 'other' }))
  const head = f.sql.prepare('SELECT * FROM catalog_setlist_heads WHERE id = ?').get(id)
  assert.equal(head.publisher_user_id, 'member')
  assert.equal(head.current_revision, 2)
  assert.deepEqual(f.sql.prepare('SELECT editor_user_id FROM catalog_setlist_mutations ORDER BY id').all().map(r => r.editor_user_id), ['member', 'other'])
  // The original publisher can still edit after moderation, with CAS.
  await ok(await f.call('PUT', clientUpdate(2), { id }))
  await ok(await f.call('DELETE', { expected_revision: 3 }, { id, user: 'admin' }))
  const tomb = f.sql.prepare('SELECT * FROM catalog_setlist_heads WHERE id = ?').get(id)
  assert.equal(tomb.is_deleted, 1); assert.equal(tomb.deleted_by_user_id, 'admin'); assert.equal(tomb.publisher_user_id, 'member')
  assert.throws(() => f.sql.prepare("UPDATE catalog_setlist_heads SET publisher_user_id='admin' WHERE id=?").run(id), /SETLIST_TOMBSTONE/)
  // SQL enforces membership rules even if the server check were bypassed.
  const json = JSON.stringify(edited)
  const { id: second } = await ok(await f.call('POST', clientCreate('member-publication-0002')))
  assert.throws(() => f.sql.prepare(`INSERT INTO catalog_setlist_mutations(editor_user_id,idempotency_key,request_digest,operation,setlist_id,
    publication_key,expected_revision,source_version,source_checksum,snapshot_json,snapshot_bytes,created_at,source_kind)
    VALUES('member2','sql-key-000000000009',?,'update',?,'member-publication-0002',1,1,?,?,?,'now','client')`)
    .run('a'.repeat(64), second, sha(json), json, Buffer.byteLength(json)), /SETLIST_FORBIDDEN/)
  f.sql.exec("UPDATE users SET access_status='denied' WHERE id='other'")
  assert.throws(() => f.sql.prepare(`INSERT INTO catalog_setlist_mutations(editor_user_id,idempotency_key,request_digest,operation,setlist_id,
    publication_key,expected_revision,source_version,source_checksum,snapshot_json,snapshot_bytes,created_at)
    VALUES('other','sql-key-000000000010',?,'unpublish',?,'member-publication-0002',1,NULL,NULL,NULL,0,'now')`).run('a'.repeat(64), second), /SETLIST_FORBIDDEN/)
})

test('quotas apply to the client path atomically', async () => {
  const f = await fixture()
  const insert = f.sql.prepare('INSERT INTO catalog_setlist_heads(id,publisher_user_id,publication_key,current_revision) VALUES(?,?,?,1)')
  for (let i = 0; i < 100; i++) insert.run(`fixture-head-${i}`, 'member', `fixture-publication-${String(i).padStart(4, '0')}`)
  assert.equal((await f.call('POST', clientCreate())).status, 429)
  assert.equal(f.count('catalog_setlist_mutations'), 0)
  assert.equal(f.count('catalog_setlist_heads'), 100)
})

test('pre-0010 database: legacy path works unchanged, client snapshots refused (501), no admin cross-edit', async () => {
  const f = await fixture({ upTo: '0010' })
  const list = await ok(await f.call('GET', undefined))
  assert.deepEqual(list.capabilities, { client_snapshots: false })
  const { id } = await ok(await f.call('POST', legacyCreate(), { user: 'admin' }))
  assert.equal((await f.call('POST', clientCreate())).status, 501)
  assert.equal((await f.call('DELETE', { expected_revision: 1 }, { id, user: 'other' })).status, 409)
  await ok(await f.call('PUT', legacyUpdate(1), { id, user: 'admin' }))
  assert.equal(f.count('catalog_setlist_mutations'), 2)
})

test('migration 0010 keeps existing rows: legacy history stays songbook-kind and readable', async () => {
  const f = await fixture({ upTo: '0010' })
  const { id } = await ok(await f.call('POST', legacyCreate(), { user: 'admin' }))
  f.sql.exec(fs.readFileSync(path.join(__dirname, '../migrations/0010_catalog_v2.sql'), 'utf8'))
  assert.equal(f.sql.prepare('SELECT source_kind FROM catalog_setlist_mutations').get().source_kind, 'songbook')
  assert.equal((await ok(await f.call('GET', undefined, { id, query: '?revision=1' }))).snapshot.name, 'Sunday')
  await ok(await f.call('PUT', clientUpdate(1), { id, user: 'admin' }))
  await ok(await f.call('PUT', legacyUpdate(2), { id, user: 'admin' }))
})

test('reports: one open report per user and target; validation; unknown or future revisions refused', async () => {
  const f = await fixture(); seedSongs(f, 1)
  const created = await ok(await f.report(songReport(0, { note: 'Published without permission' })), 201)
  assert.equal(created.status, 'open')
  assert.equal((await f.report(songReport(0, { reason: 'spam_abuse' }))).status, 409)
  await ok(await f.report(songReport(0), 'member2'), 201)
  const { id } = await ok(await f.call('POST', clientCreate()))
  await ok(await f.report({ target_kind: 'setlist', target_id: id, target_revision: 1, reason: 'wrong_content' }), 201)
  for (const [body, status] of [[songReport(0, { reason: 'dislike' }), 400], [songReport(0, { note: 'n'.repeat(501) }), 400],
    [songReport(0, { extra: 1 }), 400], [songReport(0, { target_kind: 'user' }), 400], [songReport(0, { target_revision: 0 }), 400],
    [songReport(9), 404], [songReport(0, { target_revision: 3 }), 404], [{ ...songReport(0), target_id: '../x' }, 400]]) {
    assert.equal((await f.report(body, 'admin')).status, status, JSON.stringify(body))
  }
  for (const user of ['pending', 'denied']) assert.equal((await f.report(songReport(0), user)).status, 403)
  assert.equal(f.count('catalog_reports'), 3)
  // Reporting never hides content.
  assert.equal(f.sql.prepare("SELECT is_deleted FROM shared_catalog_songs WHERE id='catalog-song-0'").get().is_deleted, 0)
  assert.equal((await f.call('GET', undefined, { id, query: '?revision=1', user: 'member2' })).status, 200)
})

test('reports: rate limited to 10 per hour per reporter, enforced in SQL', async () => {
  const f = await fixture(); seedSongs(f, 12)
  for (let i = 0; i < 10; i++) await ok(await f.report(songReport(i)), 201)
  assert.equal((await f.report(songReport(10))).status, 429)
  await ok(await f.report(songReport(10), 'member2'), 201)
  // Older reports leave the window.
  // Disposable fixture: age the rows by briefly lifting the resolve guard, then restore its exact text.
  const guard = f.sql.prepare("SELECT sql FROM sqlite_master WHERE name = 'catalog_report_resolve'").get().sql
  f.sql.exec('DROP TRIGGER catalog_report_resolve')
  f.sql.exec("UPDATE catalog_reports SET created_at = '2020-01-01T00:00:00.000Z' WHERE reporter_user_id = 'member'")
  f.sql.exec(guard)
  await ok(await f.report(songReport(10)), 201)
})

test('reports: admin queue lists open reports with targets; resolve once; members cannot moderate; history immutable', async () => {
  const f = await fixture(); seedSongs(f, 1)
  const { id: setlistId } = await ok(await f.call('POST', clientCreate()))
  const song = await ok(await f.report(songReport(0)), 201)
  const set = await ok(await f.report({ target_kind: 'setlist', target_id: setlistId, target_revision: 1, reason: 'spam_abuse' }, 'member2'), 201)
  assert.equal((await f.admin('GET', { user: 'member' })).status, 403)
  const queue = await ok(await f.admin('GET'))
  assert.equal(queue.reports.length, 2)
  const bySet = queue.reports.find(r => r.target_kind === 'setlist')
  assert.equal(bySet.target_title, 'Sunday'); assert.equal(bySet.reporter_email, 'member2@example.test'); assert.equal(bySet.target_deleted, 0)
  assert.equal(queue.reports.find(r => r.target_kind === 'song').target_title, 'Catalog Song 0')
  assert.equal((await f.admin('POST', { id: String(song.id), body: { action: 'dismiss' }, user: 'member' })).status, 403)
  assert.equal((await f.admin('POST', { id: String(song.id), body: { action: 'open' } })).status, 400)
  assert.equal((await f.admin('POST', { id: String(song.id), body: { action: 'dismiss' }, key: 'short' })).status, 400)
  const resolved = await ok(await f.admin('POST', { id: String(song.id), body: { action: 'dismiss', note: 'Licensed' } }))
  assert.equal(resolved.status, 'dismissed')
  assert.equal((await f.admin('POST', { id: String(song.id), body: { action: 'remove', expected_revision: 2 } })).status, 409)
  assert.equal((await f.admin('POST', { id: '999', body: { action: 'dismiss' } })).status, 404)
  // Content removed through the normal catalog route first: close_removed records it as actioned.
  await ok(await f.call('DELETE', { expected_revision: 1 }, { id: setlistId, user: 'admin' }))
  await ok(await f.admin('POST', { id: String(set.id), body: { action: 'close_removed' } }))
  const all = await ok(await f.admin('GET', { query: '?status=all' }))
  assert.equal(all.reports.find(r => r.target_kind === 'setlist').target_deleted, 1)
  assert.equal(all.reports.find(r => r.target_kind === 'setlist').target_title, 'Sunday', 'reported revision title kept')
  assert.equal((await ok(await f.admin('GET'))).reports.length, 0)
  const row = f.sql.prepare('SELECT * FROM catalog_reports WHERE id = ?').get(song.id)
  assert.equal(row.resolver_user_id, 'admin'); assert.ok(row.resolved_at); assert.equal(row.resolution_note, 'Licensed')
  // A dismissed report lets the same user report again.
  await ok(await f.report(songReport(0)), 201)
  assert.throws(() => f.sql.exec('DELETE FROM catalog_reports'), /REPORT_IMMUTABLE/)
  assert.throws(() => f.sql.prepare("UPDATE catalog_reports SET reason='other' WHERE id=?").run(song.id), /REPORT_IMMUTABLE/)
  const open = f.sql.prepare("SELECT id FROM catalog_reports WHERE status='open'").get().id
  assert.throws(() => f.sql.prepare("UPDATE catalog_reports SET status='dismissed', resolver_user_id='member', resolved_at='now' WHERE id=?").run(open), /REPORT_IMMUTABLE/)
  assert.throws(() => f.sql.prepare("UPDATE catalog_reports SET status='dismissed', resolver_user_id='admin', resolved_at='now' WHERE id=?").run(open), /REPORT_IMMUTABLE/, 'direct admin update without a moderation ledger row')
  assert.throws(() => f.sql.prepare("INSERT INTO catalog_reports(target_kind,target_id,target_revision,reporter_user_id,reason,status,resolver_user_id,created_at,resolved_at) VALUES('song','catalog-song-0',1,'member2','other','dismissed','admin','2026-01-01T00:00:00.000Z','x')").run(), /REPORT_INVALID/)
})

test('reports: unavailable (501) before migration 0010', async () => {
  const f = await fixture({ upTo: '0010' })
  assert.equal((await f.report(songReport(0))).status, 501)
  assert.equal((await f.admin('GET')).status, 501)
})
