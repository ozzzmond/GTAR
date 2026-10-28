#!/usr/bin/env node
// #252 real-device QA: deterministic synthetic GTAR schema-v2 FULL_BACKUP for iPhone Safari / PWA
// capacity testing (10,000 active songs + 100 in trash + 300 setlists by default).
//
// All content is generated: no real lyrics, charts, accounts or user data. The file is built and
// checked with the app's own code (createBackupPayload, parseBackupJson, verifyBackupJson) and a
// disposable in-memory Full Restore (persistLibrary + verifyRestoredLibrary). Same arguments, same
// bytes (exportedAt is fixed). The output folder `web/qa.local/` is ignored by Git (`*.local`).
//
//   node web/scripts/generate-qa-backup.cjs                  (from the repository root)
//   node web/scripts/generate-qa-backup.cjs --active 1500 --trash 15 --setlists 45 --out <file>
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const WEB = path.join(__dirname, '..')
const ts = require(require.resolve('typescript', { paths: [WEB] }))
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)

const { makeSong, prng, QuotaStorage } = require(path.join(WEB, 'tests/helpers/syntheticSongbook.cjs'))

const DEFAULTS = { active: 10000, trash: 100, setlists: 300, seed: 252 }
/** Fixed so that the same arguments always produce byte-identical files. */
const EXPORTED_AT = '2026-10-28T00:00:00.000Z'
const DEFAULT_OUT = path.join(WEB, 'qa.local', 'gtar-qa-10k-backup-v2.json')

/** Songs (active first, then trash) and setlists that reference only active songs, no duplicates. */
function buildLibrary({ active, trash, setlists: setlistCount, seed }) {
  const songs = []
  for (let i = 1; i <= active + trash; i++) {
    const song = makeSong(i, { seed })
    // Vary metadata a little more than the base fixture; every value stays valid for the editor.
    song.capo = i % 7 === 0 ? String(i % 5) : 'No Capo'
    song.tags = i % 9 === 0 ? 'Worship' : i % 13 === 0 ? 'Upbeat' : ''
    song.isFavorite = i % 17 === 0
    song.isDeleted = i > active
    songs.push(song)
  }
  const live = songs.slice(0, active)
  const rand = prng(seed * 7919)
  const setlists = []
  for (let s = 0; s < setlistCount; s++) {
    const size = 8 + Math.floor(rand() * 33) // 8..40 songs
    const picked = new Set()
    while (picked.size < Math.min(size, live.length)) picked.add(Math.floor(rand() * live.length))
    setlists.push({
      id: `qa-setlist-${String(s + 1).padStart(4, '0')}`,
      name: `QA Setlist ${String(s + 1).padStart(3, '0')}`,
      createdAt: Date.parse('2026-01-01T00:00:00.000Z') + s * 3_600_000,
      songs: [...picked].map(index => ({ id: live[index].id, title: live[index].title, artist: live[index].artist })),
    })
  }
  return { songs, setlists }
}

function generate(options = {}) {
  const opts = { ...DEFAULTS, ...options }
  // No device settings: the backup restores songs and setlists only (settings groups stay empty).
  global.localStorage = new QuotaStorage(Number.MAX_SAFE_INTEGER)
  const jb = require(path.join(WEB, 'src/utils/jsonBackup.ts'))
  const version = JSON.parse(fs.readFileSync(path.join(WEB, 'package.json'), 'utf8')).version
  const { songs, setlists } = buildLibrary(opts)
  const payload = { ...jb.createBackupPayload(songs, setlists, version), exportedAt: EXPORTED_AT }
  const json = JSON.stringify(payload, null, 2)
  return { opts, payload, json, jb }
}

/** Checks with the app's own parser, verifier and an in-memory Full Restore. Throws on any problem. */
function validate({ opts, payload, json, jb }) {
  const fail = message => { throw new Error(`QA backup validation failed: ${message}`) }
  const parsed = jb.parseBackupJson(json)
  if (!parsed.isValid) fail(parsed.error)
  if (parsed.ignoredFields?.length) fail(`unknown fields ${parsed.ignoredFields.join(', ')}`)
  const counts = jb.verifyBackupJson(json, payload)
  if (counts.songs !== opts.active || counts.trash !== opts.trash || counts.setlists !== opts.setlists) fail(`counts ${JSON.stringify(counts)}`)
  if (payload.schemaVersion !== 2 || payload.exportType !== 'FULL_BACKUP' || payload.app !== 'GTAR') fail('header')
  const ids = new Set(parsed.songs.map(s => String(s.id)))
  if (ids.size !== parsed.songs.length) fail('song ids are not unique')
  const setlistIds = new Set(parsed.setlists.map(l => String(l.id)))
  if (setlistIds.size !== parsed.setlists.length) fail('setlist ids are not unique')
  const activeIds = new Set(parsed.songs.filter(s => !s.isDeleted).map(s => String(s.id)))
  let refs = 0
  for (const list of parsed.setlists) {
    const seen = new Set()
    for (const ref of list.songs) {
      refs++
      if (!activeIds.has(String(ref.id))) fail(`setlist ${list.id} references a missing or trashed song ${ref.id}`)
      if (seen.has(String(ref.id))) fail(`setlist ${list.id} repeats ${ref.id}`)
      seen.add(String(ref.id))
    }
  }
  if (jb.libraryFingerprint(parsed.songs, parsed.setlists) !== payload.contentFingerprint) fail('content fingerprint')
  // Disposable Full Restore: the same persistence and read-back check the restore dialog uses.
  const { persistLibrary, readPersistedLibrary } = require(path.join(WEB, 'src/utils/syncJournal.ts'))
  const { verifyRestoredLibrary } = require(path.join(WEB, 'src/utils/backupExport.ts'))
  const device = new QuotaStorage(Number.MAX_SAFE_INTEGER)
  persistLibrary({ songs: parsed.songs, setlists: parsed.setlists }, device)
  const problems = verifyRestoredLibrary({ songs: [], setlists: [] }, { songs: parsed.songs, setlists: parsed.setlists }, 'replace', device)
  if (problems.length) fail(`restore read-back: ${problems.join('; ')}`)
  const restored = readPersistedLibrary(device)
  if (restored.songs.length !== opts.active + opts.trash || restored.setlists.length !== opts.setlists) fail('restored counts')
  const chars = parsed.songs.map(s => s.rawContent.length)
  return {
    counts, references: refs, uniqueSongIds: ids.size,
    chartChars: { min: Math.min(...chars), max: Math.max(...chars), avg: Math.round(chars.reduce((a, b) => a + b, 0) / chars.length) },
    fingerprint: payload.contentFingerprint,
  }
}

function main(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].replace(/^--/, '')
    if (!['active', 'trash', 'setlists', 'seed', 'out'].includes(name)) throw new Error(`Unknown option ${argv[i]}`)
    args[name] = name === 'out' ? argv[i + 1] : Number(argv[i + 1])
    if (name !== 'out' && (!Number.isSafeInteger(args[name]) || args[name] < 0)) throw new Error(`--${name} must be a non-negative integer`)
  }
  const out = path.resolve(args.out ?? DEFAULT_OUT)
  delete args.out
  const started = Date.now()
  const built = generate(args)
  const report = validate(built)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, built.json)
  const bytes = fs.statSync(out).size
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex')
  console.log(JSON.stringify({ file: out, bytes, mib: +(bytes / 1048576).toFixed(2), sha256, ...report, options: built.opts, ms: Date.now() - started }, null, 2))
}

if (require.main === module) {
  try { main(process.argv.slice(2)) } catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(1) }
}
module.exports = { generate, validate, buildLibrary, EXPORTED_AT }
