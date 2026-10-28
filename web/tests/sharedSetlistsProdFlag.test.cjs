// #253 shared setlists production flag: `catalog-v2` serves only on the reviewed 0010 schema
// (fail closed otherwise); `phase-a-v1` (DEV Preview) unchanged; anything else stays 404.
// Disposable SQLite, synthetic users only.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { SHARED_SETLIST_FLAGS } = require('../functions/lib/setlistCatalog.ts')
const { fixture, clientCreate, clientUpdate, legacyCreate, legacyUpdate, ok } = require('./helpers/catalogV2Fixture.cjs')

const rows = f => ['catalog_setlist_mutations', 'catalog_setlist_heads', 'catalog_setlist_revisions'].map(t => f.count(t))
const withFlag = (f, value) => { if (value === undefined) delete f.env.SHARED_SETLISTS_ENABLED; else f.env.SHARED_SETLISTS_ENABLED = value; return f }

test('flag values: preview phase-a-v1, production catalog-v2', () => {
  assert.deepEqual({ ...SHARED_SETLIST_FLAGS }, { preview: 'phase-a-v1', production: 'catalog-v2' })
})

test('disabled (unset or unknown value): every route 404, nothing read or written', async () => {
  for (const value of [undefined, 'off', 'catalog-v1', 'CATALOG-V2']) {
    const f = withFlag(await fixture(), value)
    for (const [method, body, id] of [['GET'], ['POST', clientCreate()], ['POST', legacyCreate()], ['PUT', clientUpdate(1), 'publication-id-000001'], ['DELETE', { expected_revision: 1 }, 'publication-id-000001']]) {
      assert.equal((await f.call(method, body, { id, user: 'admin' })).status, 404, `${value} ${method}`)
    }
    assert.deepEqual(rows(f), [0, 0, 0])
    assert.equal(f.count('catalog_setlist_rates'), 0, 'no rate-limit rows: rejected before DB access')
  }
})

test('catalog-v2 with 0010: client snapshots advertised and accepted; legacy (old client) bodies still work; admin edit works', async () => {
  const f = withFlag(await fixture(), 'catalog-v2')
  assert.deepEqual((await ok(await f.call('GET', undefined))).capabilities, { client_snapshots: true })
  const { id } = await ok(await f.call('POST', clientCreate()))
  await ok(await f.call('PUT', clientUpdate(1), { id, user: 'other' }))
  const legacy = await ok(await f.call('POST', legacyCreate(), { user: 'admin' }))
  await ok(await f.call('PUT', legacyUpdate(1), { id: legacy.id, user: 'admin' }))
  assert.equal((await f.call('PUT', clientUpdate(2), { id, user: 'member2' })).status, 409, 'members cannot edit others')
  assert.deepEqual(f.sql.prepare('SELECT source_kind FROM catalog_setlist_mutations ORDER BY id').all().map(r => r.source_kind), ['client', 'client', 'songbook', 'songbook'])
})

test('catalog-v2 without 0010 (legacy schema): fails closed on every route, capability never advertised, nothing written', async () => {
  const f = withFlag(await fixture({ upTo: '0010' }), 'catalog-v2')
  assert.equal((await f.call('GET', undefined)).status, 503)
  assert.equal((await f.call('POST', legacyCreate(), { user: 'admin' })).status, 503)
  assert.equal((await f.call('POST', clientCreate())).status, 503)
  assert.deepEqual(rows(f), [0, 0, 0])
  // Same schema under the DEV value keeps the pre-existing legacy behaviour.
  withFlag(f, 'phase-a-v1')
  assert.deepEqual((await ok(await f.call('GET', undefined))).capabilities, { client_snapshots: false })
  assert.equal((await f.call('POST', clientCreate())).status, 501)
  await ok(await f.call('POST', legacyCreate(), { user: 'admin' }))
})

test('catalog-v2 on a partially migrated schema (0010 trigger without its column): fails closed, nothing written', async () => {
  const f = withFlag(await fixture({ upTo: '0010' }), 'catalog-v2')
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/0010_catalog_v2.sql'), 'utf8')
  f.sql.exec('DROP TRIGGER catalog_setlist_apply')
  f.sql.exec(migration.slice(migration.indexOf('CREATE TRIGGER catalog_setlist_apply'), migration.indexOf('-- Reactive moderation.')))
  for (const body of [clientCreate(), legacyCreate()]) assert.equal((await f.call('POST', body, { user: 'admin' })).status, 503)
  assert.deepEqual(rows(f), [0, 0, 0])
})

test('catalog-v2 after applying 0010 over existing legacy rows: history readable, legacy rows stay songbook-kind', async () => {
  const f = await fixture({ upTo: '0010' })
  const { id } = await ok(await f.call('POST', legacyCreate(), { user: 'admin' }))
  f.sql.exec(fs.readFileSync(path.join(__dirname, '../migrations/0010_catalog_v2.sql'), 'utf8'))
  withFlag(f, 'catalog-v2')
  assert.equal((await ok(await f.call('GET', undefined, { id, query: '?revision=1' }))).snapshot.name, 'Sunday')
  assert.equal(f.sql.prepare('SELECT source_kind FROM catalog_setlist_mutations').get().source_kind, 'songbook')
  await ok(await f.call('PUT', clientUpdate(1), { id, user: 'admin' }))
})

// PR #261 Codex remediation
const routes = id => [['GET', undefined], ['POST', clientCreate()], ['POST', legacyCreate()], ['PUT', clientUpdate(1), id], ['DELETE', { expected_revision: 1 }, id]]
const safeCount = (f, table) => { try { return f.count(table) } catch { return null } }
const allRows = f => [...rows(f), ...['catalog_setlist_rates', 'catalog_reports', 'catalog_moderation_actions'].map(t => safeCount(f, t))]
async function assertClosed(f, label) {
  const before = allRows(f)
  for (const [method, body, id] of routes('publication-id-000001')) {
    const response = await f.call(method, body, { id, user: 'admin' })
    assert.equal(response.status, 503, `${label}: ${method}`)
    assert.equal(JSON.stringify(await response.json()).includes('capabilities'), false, `${label}: no capability`)
  }
  assert.deepEqual(allRows(f), before, `${label}: zero writes`)
}
function freshDb(migrationsFilter, transform = (name, sql) => sql) {
  return fixture({ migrations: migrationsFilter, transform })
}

test('Codex B1: catalog-v2 requires complete moderation; incomplete reporting schema closes every route', async () => {
  const cases = [
    ['moderation apply trigger dropped', f => f.sql.exec('DROP TRIGGER catalog_moderation_apply')],
    ['one-open index dropped', f => f.sql.exec('DROP INDEX catalog_reports_one_open')],
    ['moderation table dropped', f => f.sql.exec('DROP TABLE catalog_moderation_actions')],
    ['report column renamed', f => f.sql.exec('ALTER TABLE catalog_reports RENAME COLUMN note TO details')],
  ]
  for (const [label, weaken] of cases) {
    const f = withFlag(await fixture(), 'catalog-v2')
    weaken(f)
    await assertClosed(f, label)
  }
  // Valid 0010 still works under catalog-v2.
  const ok0010 = withFlag(await fixture(), 'catalog-v2')
  assert.deepEqual((await ok(await ok0010.call('GET', undefined))).capabilities, { client_snapshots: true })
  // phase-a-v1 (DEV) keeps serving the setlist path when only the moderation trigger is missing.
  const dev = withFlag(await fixture(), 'phase-a-v1')
  dev.sql.exec('DROP TRIGGER catalog_moderation_apply')
  assert.deepEqual((await ok(await dev.call('GET', undefined))).capabilities, { client_snapshots: true })
})

test('Codex B2: weakened CHECK, renamed column or missing 0008/0009 prerequisites fail closed under both flags', async () => {
  const all = require('./helpers/catalogV2Fixture.cjs').allMigrations
  const cases = [
    ['source_kind CHECK weakened', await freshDb(all, (name, sql) => name.startsWith('0010')
      ? sql.replace("CHECK (source_kind IN ('songbook', 'client'))", '') : sql)],
    ['snapshot CHECK weakened', await freshDb(all, (name, sql) => name.startsWith('0007')
      ? sql.replace("AND json_array_length(snapshot_json, '$.entries') BETWEEN 1 AND 100", '') : sql)],
    ['without 0008', await freshDb(all.filter(n => !n.startsWith('0008')))],
    ['without 0009', await freshDb(all.filter(n => !n.startsWith('0009')))],
  ]
  const renamed = await fixture()
  renamed.sql.exec('ALTER TABLE catalog_setlist_mutations RENAME COLUMN source_checksum TO source_sum')
  cases.push(['source_checksum renamed', renamed])
  for (const [label, f] of cases) {
    assert.deepEqual(await require('../functions/lib/catalogSchema.ts').inspectCatalogSchema(f.db).then(s => s.setlists === 'v2'), false, label)
    withFlag(f, 'catalog-v2')
    await assertClosed(f, label)
    withFlag(f, 'phase-a-v1')
    const response = await f.call('POST', clientCreate())
    assert.ok([501, 503].includes(response.status), `${label}: no client snapshot under phase-a-v1 (${response.status})`)
    assert.deepEqual(rows(f), [0, 0, 0], `${label}: zero writes`)
  }
  // Extra indexes on prerequisite (non-catalog) tables do not weaken anything and stay accepted;
  // an unknown index on a catalog table does not.
  const extra = withFlag(await fixture(), 'catalog-v2')
  extra.sql.exec('CREATE INDEX idx_users_extra ON users(display_name)')
  assert.deepEqual((await ok(await extra.call('GET', undefined))).capabilities, { client_snapshots: true })
  const catalogIndex = withFlag(await fixture(), 'catalog-v2')
  catalogIndex.sql.exec('CREATE UNIQUE INDEX catalog_extra ON catalog_setlist_heads(publisher_user_id)')
  await assertClosed(catalogIndex, 'unknown catalog index')
})

test('Codex B3: runbook states whole-database Time Travel scope, forward-only default and deploy-first 503', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/shared-catalog-v2.md'), 'utf8')
  assert.match(doc, /Time Travel is not a catalog-only undo/)
  assert.match(doc, /rewinds the \*\*whole database\*\*/)
  assert.match(doc, /accounts and approvals, sessions and revocations, personal songbooks/)
  assert.match(doc, /database-wide write quiescence/)
  assert.match(doc, /Rollback \(default: forward-only, non-destructive\)/)
  assert.match(doc, /before the complete 0010 schema is present, every shared-setlist route returns \*\*503\*\*/)
  assert.doesNotMatch(doc, /only if no catalog write happened/, 'old catalog-only restore condition removed')
})
