// #253 PR #260 remediation: B1 fail-closed schema detection, B2 atomic moderation, B3 admin edit (server).
// Disposable SQLite only; synthetic users.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { KNOWN_DEFINITIONS, KNOWN_V2_TABLES, schemaFingerprint, inspectCatalogSchema, normalizeSchemaSql } = require('../functions/lib/catalogSchema.ts')
const { fixture, snapshot, clientCreate, clientUpdate, legacyCreate, ok, seedSongs, songReport, allMigrations } = require('./helpers/catalogV2Fixture.cjs')

const triggerSql = (f, name) => f.sql.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name).sql
const replaceObject = (f, name, sql) => { f.sql.exec(`DROP ${/^\s*CREATE\s+(UNIQUE\s+)?INDEX/i.test(sql) ? 'INDEX' : 'TRIGGER'} ${name}`); f.sql.exec(sql) }
const rows = f => ['catalog_setlist_mutations', 'catalog_setlist_heads', 'catalog_setlist_revisions'].map(t => f.count(t))
/** Same semantics, different formatting: case folded outside literals, whitespace reflowed, comments added. */
function reformat(sql) {
  return normalizeSchemaSql(sql).split(/('(?:[^']|'')*')/).map((part, i) => i % 2 ? part
    : part.toUpperCase().replace(/ /g, '\n    ').replace(/,/g, ' ,  ').replace(/\bBEGIN\b/, 'BEGIN /* reformatted */ -- it\'s a note\n')).join('')
}

// B1
test('B1: fingerprints in catalogSchema.ts are exactly the reviewed migration definitions', async () => {
  const derived = {}
  for (const upTo of ['0008', '0010', null]) {
    const db = new DatabaseSync(':memory:')
    for (const n of allMigrations.filter(n => !upTo || n < upTo)) db.exec(fs.readFileSync(path.join(__dirname, '../migrations', n), 'utf8'))
    for (const { name, sql } of db.prepare(`SELECT name, sql FROM sqlite_master WHERE (type = 'trigger' AND (name LIKE 'catalog_setlist%'
      OR name LIKE 'catalog_report%' OR name LIKE 'catalog_moderation%')) OR name = 'catalog_reports_one_open'`).all()) {
      ;(derived[name] ??= new Set()).add(await schemaFingerprint(sql))
    }
  }
  assert.deepEqual(Object.keys(derived).sort(), Object.keys(KNOWN_DEFINITIONS).sort())
  for (const [name, hashes] of Object.entries(derived)) assert.deepEqual([...hashes].sort(), Object.values(KNOWN_DEFINITIONS[name]).sort(), name)
  assert.equal(normalizeSchemaSql("SELECT  'A  b' -- x\n, X /* y */ FROM T"), "select 'A  b',x from t")
})

test('B2 (PR #261): reviewed table/index fingerprints are exactly the post-0010 migration definitions', async () => {
  const db = new DatabaseSync(':memory:')
  for (const n of allMigrations) db.exec(fs.readFileSync(path.join(__dirname, '../migrations', n), 'utf8'))
  const tables = ['users', 'catalog_setlist_heads', 'catalog_setlist_mutations', 'catalog_setlist_revisions', 'catalog_setlist_rates',
    'catalog_reports', 'catalog_moderation_actions', 'shared_catalog_songs', 'shared_catalog_revisions', 'user_songbook_records', 'user_songbook_cursors']
  const derived = {}
  for (const { name, sql } of db.prepare(`SELECT lower(name) AS name, sql FROM sqlite_master WHERE type IN ('table','index')
    AND lower(tbl_name) IN (${tables.map(() => '?').join(',')}) AND sql IS NOT NULL`).all(...tables)) derived[name] = await schemaFingerprint(sql)
  assert.deepEqual(derived, { ...KNOWN_V2_TABLES })
})

test('B1: equivalently formatted valid schema keeps full capability (case, whitespace, comments)', async () => {
  const f = await fixture()
  for (const { name, sql } of f.sql.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND (name LIKE 'catalog_%')`).all()) {
    replaceObject(f, name, reformat(sql))
  }
  assert.deepEqual(await inspectCatalogSchema(f.db), { setlists: 'v2', reports: true })
  assert.deepEqual((await ok(await f.call('GET', undefined))).capabilities, { client_snapshots: true })
  const { id } = await ok(await f.call('POST', clientCreate()))
  await ok(await f.call('PUT', clientUpdate(1), { id, user: 'other' }))
  seedSongs(f, 1)
  const r = await ok(await f.report(songReport(0)), 201)
  await ok(await f.admin('POST', { id: String(r.id), body: { action: 'remove', expected_revision: 2 } }))
})

test('B1 R1: qualified identifiers with whitespace or comments around the dot are equivalent; semantics still checked', async () => {
  assert.equal(normalizeSchemaSql('SELECT NEW . source_kind'), 'select new.source_kind')
  assert.equal(normalizeSchemaSql('SELECT NEW /* note */ . source_kind'), 'select new.source_kind')
  assert.equal(normalizeSchemaSql('SELECT NEW\n  .\n  source_kind -- c'), 'select new.source_kind')
  assert.equal(normalizeSchemaSql("SELECT 'NEW . source_kind'"), "select 'NEW . source_kind'", 'literals untouched')
  assert.equal(normalizeSchemaSql('SELECT 1 .5'), 'select 1 .5', 'numeric tokens never merged')
  for (const variant of [sql => sql.replace(/NEW\.source_kind/g, 'NEW . source_kind'), sql => sql.replace(/NEW\.source_kind/g, 'NEW /* note */ . source_kind')]) {
    const f = await fixture()
    const original = triggerSql(f, 'catalog_setlist_apply')
    const changed = variant(original)
    assert.notEqual(changed, original)
    replaceObject(f, 'catalog_setlist_apply', changed)
    assert.deepEqual(await inspectCatalogSchema(f.db), { setlists: 'v2', reports: true })
    assert.deepEqual((await ok(await f.call('GET', undefined))).capabilities, { client_snapshots: true })
    await ok(await f.call('POST', clientCreate()))
    // Same spacing, different semantics: still refused.
    const g = await fixture()
    replaceObject(g, 'catalog_setlist_apply', variant(triggerSql(g, 'catalog_setlist_apply')).replace("NEW . source_kind = 'client' AND (", "NEW . source_kind = 'songbook' AND (").replace("NEW /* note */ . source_kind = 'client' AND (", "NEW /* note */ . source_kind = 'songbook' AND ("))
    assert.deepEqual(await inspectCatalogSchema(g.db), { setlists: null, reports: false })
    assert.equal((await g.call('POST', clientCreate())).status, 503)
    assert.deepEqual(rows(g), [0, 0, 0])
  }
})

test('B1 Codex case 1: a weakened apply trigger that still mentions source_kind advertises nothing and mutates nothing', async () => {
  const f = await fixture()
  // Revision CAS removed, admin rule removed; the text still contains source_kind.
  const weakened = triggerSql(f, 'catalog_setlist_apply')
    .replace(/SELECT CASE WHEN NEW\.operation <> 'create' AND NOT EXISTS\(SELECT 1 FROM catalog_setlist_heads\s+WHERE id = NEW\.setlist_id AND publication_key[\s\S]*?SETLIST_REVISION_CONFLICT'\) END;/, '')
  assert.notEqual(weakened, triggerSql(f, 'catalog_setlist_apply'))
  assert.match(weakened, /source_kind/)
  replaceObject(f, 'catalog_setlist_apply', weakened)
  assert.deepEqual(await inspectCatalogSchema(f.db), { setlists: null, reports: false })
  assert.equal((await f.call('GET', undefined)).status, 503)
  assert.equal((await f.call('POST', clientCreate())).status, 503)
  assert.equal((await f.call('POST', legacyCreate(), { user: 'admin' })).status, 503)
  assert.deepEqual(rows(f), [0, 0, 0], 'no ledger rows, orphan heads or revisions')
})

test('B1 Codex case 2: legacy 0007 trigger carrying the substring in a comment stays legacy (no client capability)', async () => {
  const f = await fixture({ upTo: '0010' })
  replaceObject(f, 'catalog_setlist_apply', triggerSql(f, 'catalog_setlist_apply').replace('BEGIN', 'BEGIN -- source_kind'))
  assert.deepEqual(await inspectCatalogSchema(f.db), { setlists: 'legacy', reports: false })
  assert.deepEqual((await ok(await f.call('GET', undefined))).capabilities, { client_snapshots: false })
  assert.equal((await f.call('POST', clientCreate())).status, 501)
  assert.deepEqual(rows(f), [0, 0, 0])
  await ok(await f.call('POST', legacyCreate(), { user: 'admin' }))
})

test('B1 Codex case 3: partially migrated schemas fail before any mutation', async () => {
  // (a) 0010 apply trigger installed without the source_kind column.
  const a = await fixture({ upTo: '0010' })
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/0010_catalog_v2.sql'), 'utf8')
  const apply = migration.slice(migration.indexOf('CREATE TRIGGER catalog_setlist_apply'), migration.indexOf('-- Reactive moderation.'))
  replaceObject(a, 'catalog_setlist_apply', apply)
  assert.deepEqual(await inspectCatalogSchema(a.db), { setlists: null, reports: false })
  for (const [body, user] of [[clientCreate(), 'member'], [legacyCreate(), 'admin']]) assert.equal((await a.call('POST', body, { user })).status, 503)
  assert.deepEqual(rows(a), [0, 0, 0])
  // (b) column added, trigger not replaced: legacy only.
  const b = await fixture({ upTo: '0010' })
  b.sql.exec("ALTER TABLE catalog_setlist_mutations ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'songbook' CHECK (source_kind IN ('songbook','client'))")
  assert.deepEqual(await inspectCatalogSchema(b.db), { setlists: 'legacy', reports: false })
  assert.equal((await b.call('POST', clientCreate())).status, 501)
  assert.deepEqual(rows(b), [0, 0, 0])
  // (c) a protection trigger missing, or an unknown extra trigger on a catalog table.
  const c = await fixture()
  c.sql.exec('DROP TRIGGER catalog_setlist_head_guard')
  assert.equal((await c.call('POST', clientCreate())).status, 503)
  const d = await fixture()
  d.sql.exec("CREATE TRIGGER catalog_setlist_extra AFTER INSERT ON catalog_setlist_heads BEGIN SELECT 1; END")
  assert.equal((await d.call('POST', clientCreate())).status, 503)
  assert.deepEqual([...rows(c), ...rows(d)], [0, 0, 0, 0, 0, 0])
})

test('B1: reports and moderation fail closed on weakened, missing or extra report protections', async () => {
  const cases = [
    f => replaceObject(f, 'catalog_report_guard', triggerSql(f, 'catalog_report_guard').replace(/SELECT CASE WHEN\s+\(SELECT count[\s\S]*?REPORT_RATE'\) END;/, '')),
    f => f.sql.exec('DROP INDEX catalog_reports_one_open'),
    f => replaceObject(f, 'catalog_reports_one_open', 'CREATE UNIQUE INDEX catalog_reports_one_open ON catalog_reports(reporter_user_id, target_kind, target_id, reason) WHERE status = \'open\''),
    f => f.sql.exec('DROP TRIGGER catalog_moderation_apply'),
    f => f.sql.exec('CREATE TRIGGER songs_extra AFTER UPDATE ON shared_catalog_songs BEGIN SELECT 1; END'),
  ]
  for (const [i, weaken] of cases.entries()) {
    const f = await fixture(); seedSongs(f, 1)
    const r = await ok(await f.report(songReport(0)), 201)
    weaken(f)
    assert.equal((await inspectCatalogSchema(f.db)).reports, false, `case ${i}`)
    assert.equal((await f.report(songReport(0), 'member2')).status, 501, `case ${i}`)
    assert.equal((await f.admin('POST', { id: String(r.id), body: { action: 'remove', expected_revision: 2 } })).status, 501, `case ${i}`)
    assert.equal(f.count('catalog_reports'), 1)
    assert.equal(f.sql.prepare("SELECT is_deleted FROM shared_catalog_songs").get().is_deleted, 0)
  }
})

// B2
async function reported(f, kind = 'song') {
  seedSongs(f, 1)
  if (kind === 'song') return { target: 'catalog-song-0', revision: 2, report: await ok(await f.report(songReport(0)), 201) }
  const { id } = await ok(await f.call('POST', clientCreate()))
  return { target: id, revision: 1, report: await ok(await f.report({ target_kind: 'setlist', target_id: id, target_revision: 1, reason: 'spam_abuse' }, 'member2'), 201) }
}
const live = (f, kind, id) => kind === 'song'
  ? f.sql.prepare('SELECT is_deleted FROM shared_catalog_songs WHERE id = ?').get(id).is_deleted === 0
  : f.sql.prepare('SELECT is_deleted FROM catalog_setlist_heads WHERE id = ?').get(id).is_deleted === 0
const status = (f, id) => f.sql.prepare('SELECT status FROM catalog_reports WHERE id = ?').get(id).status

test('B2: remove deletes content (CAS), resolves every open report for the target and records the ledger, in one statement', async () => {
  for (const kind of ['song', 'setlist']) {
    const f = await fixture()
    const { target, revision, report } = await reported(f, kind)
    const second = await ok(await f.report({ target_kind: kind, target_id: target, target_revision: revision, reason: 'other' }, kind === 'song' ? 'member2' : 'member'), 201)
    const result = await ok(await f.admin('POST', { id: String(report.id), body: { action: 'remove', expected_revision: revision, note: 'Removed' } }))
    assert.deepEqual(result, { success: true, id: report.id, action: 'remove', status: 'actioned' })
    assert.equal(live(f, kind, target), false)
    assert.deepEqual([status(f, report.id), status(f, second.id)], ['actioned', 'actioned'])
    assert.equal(f.count('catalog_moderation_actions'), 1)
    if (kind === 'setlist') {
      const head = f.sql.prepare('SELECT * FROM catalog_setlist_heads WHERE id = ?').get(target)
      assert.deepEqual([head.publisher_user_id, head.deleted_by_user_id, head.current_revision], ['member', 'admin', 2])
      assert.equal(f.sql.prepare("SELECT editor_user_id FROM catalog_setlist_mutations WHERE operation = 'unpublish'").get().editor_user_id, 'admin')
    }
  }
})

test('B2: concurrent dismiss and remove of one report: exactly one wins and the outcome is consistent (both orders)', async () => {
  for (const kind of ['song', 'setlist']) {
    for (const order of [0, 1]) {
      const f = await fixture()
      const { target, revision, report } = await reported(f, kind)
      const requests = [
        () => f.admin('POST', { id: String(report.id), body: { action: 'dismiss' }, user: 'admin' }),
        () => f.admin('POST', { id: String(report.id), body: { action: 'remove', expected_revision: revision }, user: 'other' }),
      ]
      if (order) requests.reverse()
      const responses = await Promise.all(requests.map(r => r()))
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 409], `${kind}/${order}`)
      const final = status(f, report.id)
      assert.ok(final === 'dismissed' ? live(f, kind, target) : final === 'actioned' && !live(f, kind, target), `${kind}/${order}: ${final}`)
      assert.equal(f.count('catalog_moderation_actions'), 1)
    }
  }
})

test('B2: retries replay safely; reused key with other content conflicts; stale CAS and close_removed on live content roll back', async () => {
  const f = await fixture()
  const { target, report } = await reported(f, 'song')
  // Stale revision: nothing changes.
  assert.equal((await f.admin('POST', { id: String(report.id), body: { action: 'remove', expected_revision: 1 } })).status, 409)
  assert.equal((await f.admin('POST', { id: String(report.id), body: { action: 'close_removed' } })).status, 409)
  assert.deepEqual([status(f, report.id), live(f, 'song', target), f.count('catalog_moderation_actions')], ['open', true, 0])
  const body = { action: 'remove', expected_revision: 2 }
  const first = await ok(await f.admin('POST', { id: String(report.id), body, key: 'moderation-retry-0001' }))
  assert.deepEqual(await ok(await f.admin('POST', { id: String(report.id), body, key: 'moderation-retry-0001' })), first)
  assert.equal((await f.admin('POST', { id: String(report.id), body: { action: 'dismiss' }, key: 'moderation-retry-0001' })).status, 409)
  assert.equal((await f.admin('POST', { id: String(report.id), body: { action: 'dismiss' } })).status, 409, 'already resolved')
  assert.equal(f.count('catalog_moderation_actions'), 1)
})

test('B2: only active admins moderate; the ledger is append-only and reports resolve only through it', async () => {
  const f = await fixture()
  const { report } = await reported(f, 'setlist')
  for (const user of ['member', 'member2', 'pending']) {
    assert.equal((await f.admin('POST', { id: String(report.id), body: { action: 'dismiss' }, user })).status, 403)
  }
  const insert = user => f.sql.prepare(`INSERT INTO catalog_moderation_actions(report_id,admin_user_id,idempotency_key,request_digest,action,target_kind,target_id,expected_revision,created_at)
    SELECT id,?,'sql-moderation-key-01',?,'dismiss',target_kind,target_id,NULL,'2026-10-28T00:00:00.000Z' FROM catalog_reports WHERE id = ?`).run(user, 'a'.repeat(64), report.id)
  assert.throws(() => insert('member'), /MODERATION_FORBIDDEN/)
  await ok(await f.admin('POST', { id: String(report.id), body: { action: 'dismiss' } }))
  assert.throws(() => f.sql.exec('DELETE FROM catalog_moderation_actions'), /MODERATION_IMMUTABLE/)
  assert.throws(() => f.sql.exec("UPDATE catalog_moderation_actions SET action = 'remove'"), /MODERATION_IMMUTABLE/)
})

// B3 (server side of admin edit)
test('B3: admin edit of another publisher setlist: CAS-protected, publisher immutable, editor recorded; members refused', async () => {
  const f = await fixture()
  const { id } = await ok(await f.call('POST', clientCreate()))
  const edited = snapshot(); edited.name = 'Admin edit'
  assert.equal((await f.call('PUT', clientUpdate(1, edited), { id, user: 'member2' })).status, 409)
  await ok(await f.call('PUT', clientUpdate(1), { id }))
  assert.equal((await f.call('PUT', clientUpdate(1, edited), { id, user: 'admin' })).status, 409, 'stale admin edit')
  await ok(await f.call('PUT', clientUpdate(2, edited), { id, user: 'admin' }))
  const head = f.sql.prepare('SELECT publisher_user_id, current_revision FROM catalog_setlist_heads WHERE id = ?').get(id)
  assert.deepEqual({ ...head }, { publisher_user_id: 'member', current_revision: 3 })
  assert.deepEqual(f.sql.prepare('SELECT editor_user_id FROM catalog_setlist_mutations ORDER BY id').all().map(r => r.editor_user_id), ['member', 'member', 'admin'])
})
