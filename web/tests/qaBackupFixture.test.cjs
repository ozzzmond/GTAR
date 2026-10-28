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

test('generator default: 10,000 active + 100 trash + 300 setlists, valid and deterministic; restores into B2 exactly', async () => {
  const built = gen.generate()
  const report = gen.validate(built)
  assert.deepEqual(report.counts, { songs: 10000, trash: 100, setlists: 300 })
  assert.equal(sha(gen.generate().json), sha(built.json), 'repeatable')
  console.log(`[QA fixture] ${Buffer.byteLength(built.json)} bytes, ${report.references} setlist entries, chart chars ${JSON.stringify(report.chartChars)}`)

  // A fresh, unlinked device with B2 on (as in the QA plan): Full Restore goes into the B2 partition.
  const storage = h.freshStorage()
  const factory = new h.Factory()
  const setup = h.newTab()
  setup.sj.enableLibraryB2(storage)
  const tab = h.newTab()
  assert.equal((await tab.sj.prepareLibraryB2(storage, { factory })).active, true)
  const jb = require('../src/utils/jsonBackup.ts')
  const parsed = jb.parseBackupJson(built.json)
  assert.equal(parsed.isValid, true)
  const ex = require('../src/utils/backupExport.ts')
  await ex.ensureRestoreSafetySnapshot(tab.sj.readPersistedLibrary(storage), storage)
  const expectedRaw = tab.sj.libraryRevision(storage)
  tab.sj.preserveStoredLibrary(expectedRaw, storage)
  tab.sj.persistLibrary({ songs: parsed.songs, setlists: parsed.setlists }, storage, { expectedRaw })
  assert.deepEqual(ex.verifyRestoredLibrary({ songs: [], setlists: [] }, { songs: parsed.songs, setlists: parsed.setlists }, 'replace', storage), [])
  await tab.b2.flushB2()
  // Reload: the restored library comes back from IndexedDB, identical.
  const page = h.newTab()
  assert.equal((await page.sj.prepareLibraryB2(storage, { factory })).active, true)
  const back = page.sj.readPersistedLibrary(storage)
  assert.equal(back.songs.filter(s => !s.isDeleted).length, 10000)
  assert.equal(back.songs.filter(s => s.isDeleted).length, 100)
  assert.equal(back.setlists.length, 300)
  assert.equal(jb.libraryFingerprint(back.songs, back.setlists), built.payload.contentFingerprint)
  // Export from B2 re-creates the same library content.
  const exported = jb.buildVerifiedBackup(back.songs, back.setlists)
  assert.equal(exported.fingerprint, built.payload.contentFingerprint)
  assert.deepEqual(exported.counts, { songs: 10000, trash: 100, setlists: 300 })
})

test('B2 off: restoring the 10k file into a ~5 MB localStorage fails safely and leaves the library unchanged', () => {
  const built = gen.generate()
  const storage = new h.QuotaStorage(5 * 1024 * 1024)
  global.localStorage = storage
  const tab = h.newTab()
  const small = { songs: [{ id: 'keep-1', title: 'Kept song', artist: '', rawContent: '[G]kept' }], setlists: [] }
  tab.sj.persistLibrary(small, storage)
  const before = storage.getItem('gtar_library_v1')
  const parsed = require('../src/utils/jsonBackup.ts').parseBackupJson(built.json)
  assert.throws(() => tab.sj.persistLibrary({ songs: parsed.songs, setlists: parsed.setlists }, storage, { expectedRaw: before }), /quota/i)
  assert.equal(storage.getItem('gtar_library_v1'), before, 'nothing partially written')
})

// Codex P2 (PR #259): --out never overwrites, truncates or follows an existing path.
test('generator --out: existing files, symlinks and dangling symlinks are never overwritten; new paths are created', () => {
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
    fs.symlinkSync(target, link)
    fs.symlinkSync(path.join(dir, 'missing-target.json'), dangling)
    for (const out of [existing, link, dangling]) {
      const result = run(out)
      assert.notEqual(result.status, 0, `nonzero exit for ${path.basename(out)}`)
      assert.match(result.stderr, /Refusing to overwrite existing path/)
    }
    assert.deepEqual(fs.readFileSync(existing), original, 'existing file bytes unchanged')
    assert.deepEqual(fs.readFileSync(target), original, 'symlink target bytes unchanged')
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'symlink kept')
    assert.equal(fs.lstatSync(dangling).isSymbolicLink(), true, 'dangling symlink kept')
    assert.equal(fs.existsSync(path.join(dir, 'missing-target.json')), false, 'dangling target never created')
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
