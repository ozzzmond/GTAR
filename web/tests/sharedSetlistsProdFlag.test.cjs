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
