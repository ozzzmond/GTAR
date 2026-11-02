const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { discover, partition, runFiles, shardFiles } = require('../scripts/run-tests.cjs')
const manifest = require('./tiers.json')

test('every discovered file belongs to exactly one tier; unlisted files default to fast', () => {
  const files = discover()
  const groups = partition(files, manifest)
  assert.deepEqual(Object.values(groups).flat().sort(), files)
  assert.deepEqual(partition(['new.test.cjs'], { default: 'fast', files: [] }), {
    fast: ['new.test.cjs'], scale: [], release: [], workerd: [],
  })
  for (const file of ['libraryStore.test.cjs', 'qaBackupFixture.test.cjs', 'scaleBaseline.test.cjs']) assert.ok(groups.fast.includes(file), file)
  for (const file of ['libraryStoreScale.test.cjs', 'qaBackupFixtureScale.test.cjs', 'backupV2Scale.test.cjs']) assert.ok(groups.scale.includes(file), file)
})

test('duplicate, stale and invalid tier assignments fail closed', () => {
  const files = ['a.test.cjs']
  const entry = { file: files[0], tier: 'scale' }
  for (const [entries, expected] of [
    [[entry, { ...entry, tier: 'release' }], /Duplicate tier assignment/],
    [[{ file: 'renamed.test.cjs', tier: 'scale' }], /Unknown test file/],
    [[{ ...entry, tier: 'slow' }], /Unknown tier/],
  ]) assert.throws(() => partition(files, { default: 'fast', files: entries }), expected)
  assert.throws(() => partition(files, { default: 'scale', files: [] }), /default fast/)
})

test('runner executes all selected files, reports failures and preserves child exit status', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-tiers-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const files = ['fail.test.cjs', 'pass.test.cjs'].map(file => path.join(dir, file))
  fs.writeFileSync(files[0], "require('node:test')('failure is visible', () => { throw new Error('tier sentinel failure') })")
  fs.writeFileSync(files[1], "require('node:test')('success still runs', () => {})")
  const messages = []
  const result = await runFiles(files, { concurrency: 1, report: message => messages.push(message) })
  assert.equal(result.success, false)
  assert.deepEqual(result.results.map(row => row.code), [1, 0])
  assert.equal(result.results.reduce((n, row) => n + row.tests, 0), 2)
  assert.ok(messages.some(message => message.includes('tier sentinel failure')))
  assert.equal((await runFiles([files[1]], { report: () => {} })).success, true)
  await assert.rejects(runFiles(files, { concurrency: 0 }), /positive integer/)
})


test('fast CI shards partition all fast files exactly once and reject invalid coordinates', () => {
  const groups = partition(discover(), manifest)
  const pinned = Object.fromEntries(manifest.files.filter(entry => entry.fastShard !== undefined).map(entry => [entry.file, entry.fastShard]))
  const parts = Array.from({ length: 8 }, (_, index) => shardFiles(groups.fast, `${index}/8`, pinned))
  assert.deepEqual(parts.flat().sort(), groups.fast)
  assert.deepEqual(parts[0], ['accountAccessFoundation.test.cjs'])
  assert.deepEqual(shardFiles(['a', 'b', 'c', 'd', 'e'], '0/2'), ['a', 'c', 'e'])
  assert.deepEqual(shardFiles(['a', 'b', 'c', 'd', 'e'], '1/2'), ['b', 'd'])
  assert.deepEqual(shardFiles(['a', 'b', 'c', 'd', 'e'], '0/3', { c: 0, e: 0 }), ['c', 'e'])
  assert.deepEqual(shardFiles(['a', 'b', 'c', 'd', 'e'], '1/3', { c: 0, e: 0 }), ['a', 'd'])
  assert.deepEqual(shardFiles(['a', 'b', 'c', 'd', 'e'], '2/3', { c: 0, e: 0 }), ['b'])
  assert.deepEqual(shardFiles(['a', 'b'], '0/1', { b: 0 }), ['a', 'b'])
  assert.throws(() => shardFiles(['a'], '0/2', { missing: 0 }), /Invalid reserved/)
  assert.throws(() => shardFiles(['a'], '0/2', { a: -1 }), /Invalid reserved/)
  assert.throws(() => shardFiles(['a', 'b'], '0/2', { a: 0, b: 1 }), /Invalid fast shard/)
  for (const invalid of ['-1/8', '1/0', '8/8', 'garbage', '1/2/3', '0/9007199254740992']) {
    assert.throws(() => shardFiles(groups.fast, invalid), /Invalid fast shard/)
  }
  const { spawnSync } = require('node:child_process')
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/run-tests.cjs'), 'all'], {
    encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, GTAR_TEST_SHARD: '0/8' },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Sharding is only supported for fast/)
})
