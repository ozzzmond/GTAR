// #252 real-device QA fixture: the synthetic schema-v2 backup is valid, deterministic, and restores
// into B2 exactly (and fails safely into a ~5 MB localStorage with B2 off), using the app's own code.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const h = require('./helpers/b2Harness.cjs')
const { installNavigatorLocks } = require('./helpers/fakeLocks.cjs')
const gen = require('../scripts/generate-qa-backup.cjs')

installNavigatorLocks()
const sha = text => crypto.createHash('sha256').update(text).digest('hex')

test('generator: deterministic bytes, valid schema-v2, exact counts and references (1,500-song build)', () => {
  const options = { active: 1500, trash: 15, setlists: 45 }
  const first = gen.generate(options), second = gen.generate(options)
  assert.equal(sha(first.json), sha(second.json), 'same arguments, same bytes')
  const report = gen.validate(first)
  assert.deepEqual(report.counts, { songs: 1500, trash: 15, setlists: 45 })
  assert.equal(report.uniqueSongIds, 1515)
  assert.notEqual(sha(gen.generate({ ...options, seed: 253 }).json), sha(first.json), 'seed changes content')
})

// Codex P2 (PR #259): --out never overwrites, truncates or follows an existing path.
test('generator --out: existing files, symlinks and dangling symlinks are never overwritten; new paths are created', async t => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { spawnSync } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-qa-out-'))
  try {
    const script = path.join(__dirname, '../scripts/generate-qa-backup.cjs')
    const run = out => spawnSync(process.execPath, [script, '--active', '5', '--trash', '1', '--setlists', '2', '--out', out], { encoding: 'utf8' })
    const existing = path.join(dir, 'existing.json')
    const target = path.join(dir, 'target.json')
    const link = path.join(dir, 'link.json')
    const dangling = path.join(dir, 'dangling.json')
    const original = Buffer.from('{"keep":"these exact bytes"}\n')
    fs.writeFileSync(existing, original)
    fs.writeFileSync(target, original)
    const checkRefused = out => {
      const result = run(out)
      assert.notEqual(result.status, 0, `nonzero exit for ${path.basename(out)}`)
      assert.match(result.stderr, /Refusing to overwrite existing path/)
    }
    checkRefused(existing)
    assert.deepEqual(fs.readFileSync(existing), original, 'existing file bytes unchanged')
    await t.test('symlinks and dangling symlinks are preserved', t => {
      try {
        fs.symlinkSync(target, link)
        fs.symlinkSync(path.join(dir, 'missing-target.json'), dangling)
      } catch (error) {
        if (!['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) throw error
        t.skip(`File symlinks unavailable: ${error.code}`)
        return
      }
      for (const out of [link, dangling]) checkRefused(out)
      assert.deepEqual(fs.readFileSync(target), original, 'symlink target bytes unchanged')
      assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'symlink kept')
      assert.equal(fs.lstatSync(dangling).isSymbolicLink(), true, 'dangling symlink kept')
      assert.equal(fs.existsSync(path.join(dir, 'missing-target.json')), false, 'dangling target never created')
    })
    // A new path is created with the deterministic bytes; running again refuses and leaves it intact.
    const fresh = path.join(dir, 'nested', 'fresh.json')
    const first = run(fresh)
    assert.equal(first.status, 0, first.stderr)
    const expected = gen.generate({ active: 5, trash: 1, setlists: 2 }).json
    assert.equal(fs.readFileSync(fresh, 'utf8'), expected)
    assert.equal(JSON.parse(first.stdout).sha256, sha(expected))
    assert.notEqual(run(fresh).status, 0)
    assert.equal(fs.readFileSync(fresh, 'utf8'), expected)
    assert.throws(() => gen.writeExclusive(existing, 'x'), /Refusing to overwrite/)
    assert.deepEqual(fs.readFileSync(existing), original)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// Codex P2 (PR #259, cleanup ownership): a failed write never removes or changes a file that
// replaced the output path; cleanup acts only on the descriptor this run created.
test('generator --out: write failure after the path is replaced leaves the replacement untouched (no pathname cleanup)', t => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-qa-race-'))
  try {
    const out = path.join(dir, 'out.json')
    const sentinel = path.join(dir, 'sentinel.json')
    const sentinelBytes = Buffer.from('{"pre-existing":"sentinel"}\n')
    fs.writeFileSync(sentinel, sentinelBytes)
    const unlinks = []
    t.mock.method(fs, 'unlinkSync', p => { unlinks.push(p) })
    t.mock.method(fs, 'rmSync', p => { unlinks.push(p) })
    const realWrite = fs.writeFileSync
    const realOpen = fs.openSync
    // Model namespace replacement at the descriptor seam. Windows cannot rename over
    // an open destination; the descriptor still belongs to this run's separate file.
    const detached = path.join(dir, 'detached-output.json')
    t.mock.method(fs, 'openSync', (file, ...args) => realOpen(file === out && args[0] === 'wx' ? detached : file, ...args))
    // Inject ENOSPC after publishing the sentinel at the output pathname.
    t.mock.method(fs, 'writeFileSync', (target, data, ...rest) => {
      if (typeof target !== 'number') return realWrite(target, data, ...rest)
      realWrite(target, 'partial bytes')
      realWrite(out, fs.readFileSync(sentinel))
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
    })
    assert.throws(() => gen.writeExclusive(out, '{"generated":true}'), /failed \(ENOSPC\).*not deleted/)
    assert.deepEqual(unlinks, [], 'no pathname deletion')
    assert.equal(fs.readFileSync(detached, 'utf8'), '', 'cleanup empties only the owned descriptor')
    assert.deepEqual(fs.readFileSync(out), sentinelBytes, 'sentinel at the output path survives byte-for-byte')
    t.mock.restoreAll()
    // Plain injected failure (no replacement): the run's own output is emptied, never deleted elsewhere.
    const own = path.join(dir, 'own.json')
    t.mock.method(fs, 'writeFileSync', (target, data, ...rest) => {
      if (typeof target !== 'number') return realWrite(target, data, ...rest)
      realWrite(target, 'partial bytes')
      throw Object.assign(new Error('EIO'), { code: 'EIO' })
    })
    assert.throws(() => gen.writeExclusive(own, '{"generated":true}'), /failed \(EIO\).*emptied/)
    t.mock.restoreAll()
    assert.equal(fs.readFileSync(own, 'utf8'), '', 'own partial output emptied through its descriptor')
    assert.throws(() => gen.writeExclusive(own, 'x'), /Refusing to overwrite/, 'left in place, so a retry needs a new path or manual removal')
  } finally { t.mock.restoreAll(); fs.rmSync(dir, { recursive: true, force: true }) }
})
