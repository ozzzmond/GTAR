const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { execFileSync } = require('node:child_process')
const C = require('../.github/prod_controller.cjs')
// Synthetic identifiers only; never copy live account/database identifiers into tests.
const id = '00000000-0000-0000-0000-000000000001'
const devId = '00000000-0000-0000-0000-000000000002'
const names = ['0001_users.sql', '0002_songbook_sync.sql']
const e = { CF_ACCOUNT_ID: '0'.repeat(32), CF_PAGES_READ_TOKEN: 'synthetic-read-token' }
const project = { deployment_configs: { production: { d1_databases: { DB: { id } } } } }
const rows = names.map((name, n) => ({ id: n + 1, name }))
const envelope = results => ({ success: true, errors: [], result: [{ success: true, results, meta: { rows_written: 0, changed_db: false } }] })
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-d1-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  const put = (file, body) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), body) }
  const prod = { binding: 'DB', database_name: 'gtar-db-prod', database_id: id, migrations_dir: 'migrations' }
  const config = { d1_databases: [prod], env: { production: { d1_databases: [prod] }, preview: { d1_databases: [{ ...prod, database_name: 'gtar-db-dev', database_id: devId }] } } }
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com')
  put('web/wrangler.jsonc', JSON.stringify(config)); put(`web/migrations/${names[0]}`, 'SELECT 1;')
  git('add', '.'); git('commit', '-m', 'reviewed controller')
  const controllerSha = git('rev-parse', 'HEAD')
  put(`web/migrations/${names[1]}`, 'SELECT 2;'); git('add', '.'); git('commit', '-m', 'selected checkpoint')
  const sha = git('rev-parse', 'HEAD')
  return { root, git, put, config, p: { sha, controllerSha }, ready: reader => C.d1Readiness(root, { sha, controllerSha }, e, project, reader) }
}
test('current PROD passes, exact selected checkpoint inventory ignores working tree', async t => {
  const f = fixture(t)
  f.put('web/migrations/0003_uncommitted.sql', 'SELECT 3;')
  f.put('web/wrangler.jsonc', '{}')
  assert.deepEqual(C.migrationCheckpoint(f.root, f.p.sha, f.p.controllerSha).names, names)
  assert.deepEqual(C.migrationCheckpoint(f.root, f.p.controllerSha, f.p.controllerSha).names, [names[0]])
  const before = f.git('status', '--porcelain')
  assert.deepEqual(await f.ready(async () => rows), { state: 'PASS', required: names, pending: [] })
  assert.equal(f.git('status', '--porcelain'), before)
})
test('one/multiple missing migrations HOLD with precise pending filenames', async t => {
  const f = fixture(t)
  await assert.rejects(f.ready(async () => rows.slice(0, 1)), error => {
    assert.match(error.message, /HOLD.*pending migrations: 0002_songbook_sync.sql/)
    assert.doesNotMatch(error.message, /0001_users.sql/); return true
  })
  await assert.rejects(f.ready(async () => []), /pending migrations: 0001_users.sql, 0002_songbook_sync.sql/)
})
test('lookup unavailable/error sanitizes diagnostics and lists required unverified migrations', async t => {
  const f = fixture(t)
  await assert.rejects(f.ready(async () => { throw new Error(`${id} ${e.CF_ACCOUNT_ID} ${e.CF_PAGES_READ_TOKEN}`) }), error => {
    assert.match(error.message, /HOLD.*unverifiable.*0001_users.sql, 0002_songbook_sync.sql/)
    for (const sensitive of [id, e.CF_ACCOUNT_ID, e.CF_PAGES_READ_TOKEN]) assert.ok(!error.message.includes(sensitive))
    return true
  })
  await assert.rejects(C.readD1Migrations(e.CF_ACCOUNT_ID, id, ''), /existing read credential.*D1 Read/)
})
test('unknown, duplicate, malformed and inconsistent applied states fail closed', async t => {
  const f = fixture(t)
  for (const state of [null, {}, [{ id: 1, name: 'unexpected.sql' }], [...rows, rows[1]],
    [{ id: 0, name: names[0] }], [{ id: '1', name: names[0] }], [rows[1], rows[0]],
    [{ id: 1, name: names[0] }, { id: 1, name: names[1] }], [{ id: 1 }],
    [{ id: 1, name: names[0] }, { id: 2, name: names[0] }]]) {
    await assert.rejects(f.ready(async () => state), /D1 applied migration state/)
  }
})
test('fixed read query performs no initialization, migration execution, or SQL mutation', async () => {
  const calls = []
  const fetcher = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => envelope(rows) } }
  assert.deepEqual(await C.readD1Migrations(e.CF_ACCOUNT_ID, id, e.CF_PAGES_READ_TOKEN, fetcher), rows)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${e.CF_ACCOUNT_ID}/d1/database/${id}/query`)
  assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.redirect, 'error')
  assert.deepEqual(JSON.parse(calls[0].options.body), { sql: 'SELECT id, name FROM "d1_migrations" ORDER BY id' })
})
test('HTTP, timeout, malformed JSON/envelope and unverifiable no-write metadata fail closed', async () => {
  const good = envelope(rows)
  for (const data of [{}, { ...good, success: false }, { ...good, errors: [{}] }, { ...good, result: [] },
    { ...good, result: [...good.result, ...good.result] },
    ...[{ success: false }, { results: null }, { meta: {} }, { meta: { rows_written: 1, changed_db: true } },
      { meta: { rows_written: 0 } }].map(change => ({ ...good, result: [{ ...good.result[0], ...change }] }))]) {
    await assert.rejects(C.readD1Migrations(e.CF_ACCOUNT_ID, id, 'test', async () => ({ ok: true, json: async () => data })), /unavailable\/unverifiable/)
  }
  for (const fetcher of [async () => ({ ok: false }), async () => { throw new Error('timeout') },
    async () => ({ ok: true, json: async () => { throw new Error('invalid JSON') } })]) {
    await assert.rejects(C.readD1Migrations(e.CF_ACCOUNT_ID, id, 'test', fetcher), /unavailable\/unverifiable/)
  }
})
test('configuration drift, unsupported layouts and missing bindings block before any D1 request', async t => {
  const f = fixture(t)
  let calls = 0
  const reader = async () => { calls++; return rows }
  await assert.rejects(C.d1Readiness(f.root, f.p, e, {}, reader), /Pages PROD binding/)
  await assert.rejects(C.d1Readiness(f.root, f.p, { ...e, CF_ACCOUNT_ID: '' }, project, reader), /account configuration/)
  for (const mutate of [c => { c.env.production.d1_databases[0].database_id = devId },
    c => { c.env.production.d1_databases[0].migrations_table = 'other' },
    c => { c.env.production.d1_databases[0].migrations_pattern = 'migrations/**/*.sql' },
    c => { c.env.preview.d1_databases[0].database_id = id }, c => { c.d1_databases = [] }]) {
    const config = structuredClone(f.config); mutate(config)
    const git = (...args) => args[0] === 'show' && args[1].endsWith(':web/wrangler.jsonc') ? JSON.stringify(config) : f.git(...args)
    await assert.rejects(C.d1Readiness(f.root, f.p, e, project, reader, git), /D1/)
  }
  for (const entry of ['', `120000 blob ${'a'.repeat(40)}\tweb/migrations/0001_link.sql`,
    `100644 blob ${'a'.repeat(40)}\tweb/migrations/nested/0001_file.sql`,
    `100644 blob ${'a'.repeat(40)}\tweb/migrations/README.md`]) {
    const git = (...args) => args[0] === 'ls-tree' ? entry : f.git(...args)
    assert.throws(() => C.migrationCheckpoint(f.root, f.p.sha, f.p.controllerSha, git), /D1/)
  }
  assert.equal(calls, 0)
})
test('plan and fresh post-approval main path cannot reach promotion on D1 HOLD', async t => {
  const f = fixture(t), events = []
  const module = { exports: {} }
  const context = vm.createContext({ require: createRequire(path.resolve(__dirname, '../.github/prod_controller.cjs')), module, __dirname: path.resolve(__dirname, '../.github'),
    process: { cwd: () => f.root }, fetch, AbortSignal, console, setTimeout,
    p: f.p, project, rows, events, git: f.git })
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../.github/prod_controller.cjs'), 'utf8'), context)
  // Replace independent gates only; exercise the actual D1 gate and main ordering.
  vm.runInContext(`refresh = () => {}; plan = () => p; remoteRefs = () => ({});
    inventoryContract = () => {}; externalGate = async () => ({ project, protection: 'test' });
    readD1Migrations = async () => rows;
    freshContract = () => events.push('fresh'); emit = value => events.push(value);
    promote = () => { events.push('mutation'); return { state: 'PROD_PROMOTED_BUT_UNVERIFIED' } };`, context)
  for (const mode of ['plan', 'promote']) {
    context.rows = rows.slice(0, 1)
    await assert.rejects(module.exports.main(mode, e), /HOLD.*0002_songbook_sync.sql/)
    assert.deepEqual(events, [])
    context.rows = rows
    await module.exports.main(mode, e)
    if (mode === 'plan') { assert.equal(events[0].ready, true); assert.equal(JSON.parse(events[0].d1).state, 'PASS') }
    else assert.ok(events.includes('mutation') && events.includes('fresh'))
    events.length = 0
  }
})
