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
