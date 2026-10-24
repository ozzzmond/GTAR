// RFC #188 S5: per-record sync between two devices through the real records API on SQLite.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('', { url: 'https://dev.gtar-web.pages.dev' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage })
const { createSongbookSqlite } = require('./helpers/songbookSqlite.cjs')
const { createSessionToken, upsertUserSongbook, findUserSongbook } = require('../functions/lib/authCore.ts')
const recordsApi = require('../functions/api/songbook/records.ts')
const syncApi = require('../functions/api/songbook/sync.ts')
const sync = require('../src/utils/cloudSongbookSync.ts')
const journal = require('../src/utils/syncJournal.ts')
const client = require('../src/utils/recordsSync.ts')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const song = (n, extra = {}) => ({ id: id(n), title: `Song ${n}`, artist: 'A', rawContent: `[G]Line ${n}`, ...extra })
const list = (n, songs) => ({ id: id(900 + n), name: `List ${n}`, songs: songs.map(s => ({ id: id(s), title: `Song ${s}`, artist: 'A' })) })

function storage() {
  const map = new Map()
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k),
    key: i => [...map.keys()][i] ?? null, get length() { return map.size } }
}

async function world({ enabled = true, library } = {}) {
  const db = createSongbookSqlite()
  const user = { id: 'user-a', google_sub: 'sub-a', email: 'a@example.com', role: 'member', access_status: 'active' }
  const original = db.prepare.bind(db)
  db.prepare = sql => sql.includes('FROM users WHERE id = ?') ? { sql, bound: [], bind(x) { return { first: async () => x === user.id ? user : null } } } : original(sql)
  const env = { DB: db, AUTH_SECRET: 'records-client-secret', ...(enabled ? { SONGBOOK_RECORDS_SYNC: 'records-v1' } : {}) }
  const token = await createSessionToken(user, env.AUTH_SECRET)
  if (library) await upsertUserSongbook(db, 'user-a', JSON.stringify(library), sync.computeSongbookChecksum(library), '2026-10-24T00:00:00Z', { version: 0, checksum: null })
  let hook = null
  const fetch = async (url, opts = {}) => {
    if (hook) await hook(url, opts)
    const target = url.startsWith('/api/songbook/records') ? recordsApi : syncApi
    const method = opts.method || 'GET'
    return target[method === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env, request: new Request(`https://example.com${url}`, {
      method, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` }, ...(opts.body ? { body: opts.body } : {}) }) })
  }
  const device = lib => { const s = storage(); journal.persistLibrary(lib, s); return s }
  const run = async (store, options) => {
    const saved = global.fetch
    global.fetch = fetch
    try { return await client.performRecordsSync('token', { storage: store, ...options }) } finally { global.fetch = saved }
  }
  const runAny = async (store, options) => {
    const saved = global.fetch
    global.fetch = fetch
    try { return await client.performSongbookSync('token', { storage: store, ...options }) } finally { global.fetch = saved }
  }
  return { db, device, run, runAny, setHook: h => { hook = h } }
}
const read = store => journal.readPersistedLibrary(store)
const edit = (store, fn) => { const lib = read(store); journal.persistLibrary(fn(lib), store, { expectedRaw: journal.libraryRevision(store) }) }
const recoveryKeys = store => Object.keys(journal.recoveryData(store)).filter(k => k.startsWith('gtar_sync_recovery:'))

const base = { songs: [song(1), song(2), song(3)], setlists: [list(1, [1, 2])] }

test('adopting a device whose library equals the cloud: nothing to push, nothing to apply, no conflicts', async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  const result = await w.run(a)
  assert.equal(result.success, true)
  assert.equal(result.actionTaken, 'NONE')
  assert.equal(client.readRecordsSyncState(a).conflicts.length, 0)
  assert.equal(Object.keys(client.readRecordsSyncState(a).known).length, 4)
})

test('an edit on one device reaches the other; untouched records are fast-forwarded', async () => {
  const w = await world({ library: base })
  const a = w.device(base), b = w.device(base)
  await w.run(a); await w.run(b)
  edit(a, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'from A' } : s) }))
  const pushed = await w.run(a)
  assert.equal(pushed.actionTaken, 'UPLOADED')
  const pulled = await w.run(b)
  assert.equal(pulled.actionTaken, 'DOWNLOADED')
  assert.equal(pulled.updatedLibrary.songs.find(s => s.id === id(1)).rawContent, 'from A')
  assert.equal(read(b).songs.find(s => s.id === id(1)).rawContent, 'from A')
  assert.equal(recoveryKeys(b).length, 0, 'fast-forward of unedited records needs no snapshot')
})

test('edits to the same song on both devices: conflict, local kept, unrelated edits still sync', async () => {
  const w = await world({ library: base })
  const a = w.device(base), b = w.device(base)
  await w.run(a); await w.run(b)
  edit(a, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'A version' } : s) }))
  await w.run(a)
  edit(b, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'B version' } : s.id === id(2) ? { ...s, rawContent: 'B other' } : s) }))
  const result = await w.run(b)
  assert.equal(result.status, 'CONFLICT')
  assert.equal(result.success, false)
  assert.deepEqual(result.conflicts.map(c => [c.id, c.type, c.title]), [[id(1), 'song', 'Song 1']])
  assert.equal(read(b).songs.find(s => s.id === id(1)).rawContent, 'B version', 'local edit kept')
  const fromA = await w.run(a)
  assert.equal(read(a).songs.find(s => s.id === id(2)).rawContent, 'B other', 'unrelated edit synced')
  assert.equal(read(a).songs.find(s => s.id === id(1)).rawContent, 'A version', 'no last-write-wins')
  void fromA
})

async function conflicted() {
  const w = await world({ library: base })
  const a = w.device(base), b = w.device(base)
  await w.run(a); await w.run(b)
  edit(a, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'A version' } : s) }))
  await w.run(a)
  edit(b, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'B version' } : s) }))
  await w.run(b)
  return { w, a, b }
}

test('resolve keep-both: this device keeps the song, the cloud version survives as a copy, snapshot saved', async () => {
  const { w, a, b } = await conflicted()
  const result = await w.run(b, { forceAction: 'merge_preserve' })
  assert.equal(result.success, true, result.error)
  assert.equal(client.readRecordsSyncState(b).conflicts.length, 0)
  const songs = read(b).songs
  assert.equal(songs.find(s => s.id === id(1)).rawContent, 'B version')
  assert.ok(songs.some(s => s.rawContent === 'A version' && /cloud copy/.test(s.title)))
  assert.equal(recoveryKeys(b).length, 1)
  await w.run(a)
  assert.equal(read(a).songs.find(s => s.id === id(1)).rawContent, 'B version')
  assert.ok(read(a).songs.some(s => /cloud copy/.test(s.title)))
})

test('resolve use-cloud: this device takes the cloud version, with a snapshot of both', async () => {
  const { w, b } = await conflicted()
  const result = await w.run(b, { forceAction: 'download' })
  assert.equal(result.success, true, result.error)
  assert.equal(read(b).songs.find(s => s.id === id(1)).rawContent, 'A version')
  const snapshot = JSON.parse(journal.recoveryData(b)[recoveryKeys(b)[0]])
  assert.equal(snapshot.local.songs.find(s => s.id === id(1)).rawContent, 'B version')
  assert.equal(snapshot.remote.songs.find(s => s.id === id(1)).rawContent, 'A version')
})

test('resolve keep-local: this device overwrites the cloud copy explicitly', async () => {
  const { w, a, b } = await conflicted()
  const result = await w.run(b, { forceAction: 'upload' })
  assert.equal(result.success, true, result.error)
  await w.run(a)
  assert.equal(read(a).songs.find(s => s.id === id(1)).rawContent, 'B version')
})

test('removal syncs as a removal', async () => {
  const w = await world({ library: base })
  const a = w.device(base), b = w.device(base)
  await w.run(a); await w.run(b)
  edit(a, lib => ({ ...lib, songs: lib.songs.filter(s => s.id !== id(3)) }))
  await w.run(a)
  await w.run(b)
  assert.equal(read(b).songs.some(s => s.id === id(3)), false)
})

test('a song added on one device appears on the other, setlist reference included', async () => {
  const w = await world({ library: base })
  const a = w.device(base), b = w.device(base)
  await w.run(a); await w.run(b)
  edit(a, lib => ({ songs: [...lib.songs, song(4)], setlists: lib.setlists.map(l => ({ ...l, songs: [...l.songs, { id: id(4), title: 'Song 4', artist: 'A' }] })) }))
  await w.run(a)
  await w.run(b)
  assert.deepEqual(read(b).setlists[0].songs.map(r => r.id), [id(1), id(2), id(4)])
})

test('the whole-document cloud copy stays in step for classic clients', async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  await w.run(a)
  edit(a, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(2) ? { ...s, rawContent: 'mirrored' } : s) }))
  await w.run(a)
  const row = await findUserSongbook(w.db, 'user-a')
  assert.equal(JSON.parse(row.data_json).songs.find(s => s.id === id(2)).rawContent, 'mirrored')
})

test('server flag off: records sync steps aside', async () => {
  const w = await world({ enabled: false, library: base })
  const a = w.device(base)
  assert.equal(await w.run(a), null)
})

test('library changed by another tab during sync: nothing overwritten, error reported', async () => {
  const w = await world({ library: base })
  const a = w.device(base), b = w.device(base)
  await w.run(a); await w.run(b)
  edit(a, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'from A' } : s) }))
  await w.run(a)
  let once = true
  w.setHook(async () => { if (once) { once = false; edit(b, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(3) ? { ...s, rawContent: 'other tab' } : s) })) } })
  const result = await w.run(b)
  w.setHook(null)
  assert.equal(result.success, false)
  assert.equal(read(b).songs.find(s => s.id === id(3)).rawContent, 'other tab')
  const retry = await w.run(b)
  assert.equal(retry.success, true, retry.error)
  assert.equal(read(b).songs.find(s => s.id === id(1)).rawContent, 'from A')
})

test('the classic sync metadata follows a records sync (header status and fallback)', async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  await w.run(a)
  const meta = sync.readCloudSyncMeta(a)
  assert.equal(meta.lastSyncedChecksum, sync.computeSongbookChecksum(read(a)))
  assert.ok(meta.lastSyncedAt > 0)
})

test('DEV toggle: on by default (S7), off per device, classic sync when off', async () => {
  const s = storage()
  assert.equal(client.isRecordsSyncEnabled(s), true)
  client.setRecordsSyncEnabled(true, s)
  assert.equal(client.isRecordsSyncEnabled(s), true)
  client.setRecordsSyncEnabled(false, s)
  assert.equal(client.isRecordsSyncEnabled(s), false)
  // Off: the dialog's sync goes to /api/songbook/sync only.
  const w = await world({ library: base })
  const a = w.device(base)
  client.setRecordsSyncEnabled(false, a)
  const urls = []
  w.setHook(async url => { urls.push(url) })
  await w.runAny(a)
  assert.ok(urls.length > 0 && urls.every(url => url.startsWith('/api/songbook/sync')))
  urls.length = 0
  client.setRecordsSyncEnabled(true, a)
  await w.runAny(a)
  assert.ok(urls.every(url => url.startsWith('/api/songbook/records')), urls.join(','))
})

test('DB without migration 0009: records API reports disabled, the client falls back to classic sync', async () => {
  const w = await world({ library: base })
  w.db.sqlite.exec('DROP TABLE user_songbook_records; DROP TABLE user_songbook_cursors;')
  const a = w.device(base)
  assert.equal(await w.run(a), null)
  const viaDialog = await w.runAny(a)
  assert.equal(viaDialog.success, true, viaDialog.error)
})

test('server off: classic fallback is remembered (shown in the Sync Center) and logged once', async () => {
  const logger = require('../src/utils/logger.ts')
  logger.appLogger.resume()
  const w = await world({ enabled: false, library: base })
  const a = w.device(base)
  client.setRecordsSyncEnabled(true, a)
  const before = logger.appLogger.getLogs().filter(l => /per-record sync off/.test(l.message)).length
  await w.runAny(a); await w.runAny(a); await w.runAny(a)
  assert.equal(client.isRecordsServerUnavailable(a), true)
  assert.equal(logger.appLogger.getLogs().filter(l => /per-record sync off/.test(l.message)).length - before, 1)
  const on = await world({ library: base })
  const b = on.device(base)
  client.setRecordsSyncEnabled(true, b)
  b.setItem(client.RECORDS_SERVER_STATE_KEY, 'off')
  await on.runAny(b)
  assert.equal(client.isRecordsServerUnavailable(b), false)
})

test('disabled answers say why: not enabled for the host, or no per-record tables in the bound database', async () => {
  const records = require('../functions/api/songbook/records.ts')
  const flagOff = await world({ enabled: false, library: base })
  const res1 = await records.onRequestGet({ env: { DB: flagOff.db }, request: new Request('https://gtar-web.pages.dev/api/songbook/records') })
  assert.equal((await res1.json()).reason, 'flag')
  const noTables = await world({ library: base })
  noTables.db.sqlite.exec('DROP TABLE user_songbook_records; DROP TABLE user_songbook_cursors; CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO d1_migrations (name) VALUES (\'0008_member_setlist_publishing.sql\');')
  const logger = require('../src/utils/logger.ts')
  logger.appLogger.resume()
  const a = noTables.device(base)
  client.setRecordsSyncEnabled(true, a)
  await noTables.runAny(a)
  const entry = logger.appLogger.getLogs().reverse().find(l => /per-record sync off/.test(l.message))
  assert.match(entry.details, /no per-record tables \(newest migration: 0008_member_setlist_publishing\.sql\)/)
})

// #208 F1: a B1 fallback restores an older library; sync must not turn the missing records into cloud deletes.
const cloudRow = (w, n) => w.db.sqlite.prepare("SELECT removed, data_json FROM user_songbook_records WHERE kind = 'song' AND record_id = ?").get(id(n))
test('#208 F1: after a storage fallback, records missing locally are restored from the cloud, never deleted', async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  await w.run(a)
  edit(a, lib => ({ ...lib, songs: [...lib.songs, song(4)] }))
  await w.run(a)
  await w.run(a) // cursor moves past our own write, as after any later sync
  assert.equal(cloudRow(w, 4).removed, 0)
  // The fallback copy predates song 4 (what prepareLibraryStorage restores), and it sets the hold.
  journal.persistLibrary(base, a, { expectedRaw: journal.libraryRevision(a) })
  a.setItem(journal.RECORDS_DELETE_HOLD_KEY, JSON.stringify({ at: 1, reason: 'b1-fallback' }))
  const result = await w.run(a)
  assert.equal(result.success, true)
  assert.equal(cloudRow(w, 4).removed, 0, 'cloud record kept')
  assert.ok(cloudRow(w, 4).data_json, 'cloud data kept')
  assert.ok(read(a).songs.some(s => s.id === id(4)), 'song 4 restored on this device')
  assert.equal(a.getItem(journal.RECORDS_DELETE_HOLD_KEY), null, 'hold cleared after a completed sync')
  // A real delete afterwards still reaches the cloud.
  edit(a, lib => ({ ...lib, songs: lib.songs.filter(s => s.id !== id(4)) }))
  await w.run(a)
  assert.equal(cloudRow(w, 4).removed, 1)
})

test('#208 F1: without the hold, the same older library would delete the cloud record (the audited path)', async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  await w.run(a)
  edit(a, lib => ({ ...lib, songs: [...lib.songs, song(4)] }))
  await w.run(a)
  await w.run(a) // cursor moves past our own write, as after any later sync
  journal.persistLibrary(base, a, { expectedRaw: journal.libraryRevision(a) })
  await w.run(a)
  assert.equal(cloudRow(w, 4).removed, 1, 'documents why the hold is needed')
})

// #208 F2: once a user has records, classic writes are refused instead of silently diverging.
test('#208 F2: classic upload is refused (409 SONGBOOK_RECORDS_ACTIVE) once records exist; no archive, cloud unchanged', async () => {
  const w = await world({ library: base })
  const b = w.device(base)
  client.setRecordsSyncEnabled(false, b) // an old or classic-only client, in sync with the cloud
  assert.equal((await w.runAny(b)).success, true)
  const a = w.device(base)
  await w.run(a) // another device seeds the records
  const before = await findUserSongbook(w.db, 'user-a')
  edit(b, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'classic edit' } : s) }))
  const archivesBefore = recoveryKeys(b).length
  const result = await w.runAny(b)
  assert.equal(result.success, false)
  assert.match(result.error, /syncs song by song/)
  assert.equal(recoveryKeys(b).length, archivesBefore, 'no recovery snapshot for a refused write')
  const after = await findUserSongbook(w.db, 'user-a')
  assert.equal(after.checksum, before.checksum, 'classic document unchanged')
  assert.equal(read(b).songs.find(s => s.id === id(1)).rawContent, 'classic edit', 'edit kept on the device')
  // Switched to per-record sync, the unsynced edit is a reviewable conflict (never silently lost) and resolves.
  client.setRecordsSyncEnabled(true, b)
  assert.equal((await w.runAny(b)).status, 'CONFLICT')
  assert.equal((await w.run(b, { forceAction: 'upload' })).success, true) // keep this device's version
  assert.equal(JSON.parse((await findUserSongbook(w.db, 'user-a')).data_json).songs.find(s => s.id === id(1)).rawContent, 'classic edit')
})

test('#208 F2: classic writes still work for users without records and on databases without 0009', async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  client.setRecordsSyncEnabled(false, a)
  assert.equal((await w.runAny(a)).success, true)
  edit(a, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(2) ? { ...s, rawContent: 'classic ok' } : s) }))
  assert.equal((await w.runAny(a)).success, true)
  const noTables = await world({ library: base })
  noTables.db.sqlite.exec('DROP TABLE user_songbook_records; DROP TABLE user_songbook_cursors;')
  const b = noTables.device(base)
  client.setRecordsSyncEnabled(false, b)
  assert.equal((await noTables.runAny(b)).success, true)
  edit(b, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(3) ? { ...s, rawContent: 'prod-like' } : s) }))
  assert.equal((await noTables.runAny(b)).success, true)
})

// #208 F5: pushes are bounded by bytes, not only by count.
test('#208 F5: six 450,000-character charts upload in byte-bounded batches; an oversized one is reported, the rest sync', async () => {
  const w = await world({ library: { songs: [], setlists: [] } })
  const a = w.device({ songs: [], setlists: [] })
  await w.run(a)
  const big = n => song(50 + n, { rawContent: 'x'.repeat(450000) })
  const posts = []
  w.setHook(async (url, opts) => { if (opts.method === 'POST') posts.push(opts.body.length) })
  edit(a, lib => ({ ...lib, songs: [big(1), big(2), big(3), big(4), big(5), big(6)] }))
  const ok = await w.run(a)
  assert.equal(ok.success, true, ok.error)
  assert.ok(posts.length >= 2 && posts.every(n => n < 2 * 1024 * 1024), `bodies: ${posts}`)
  assert.equal(w.db.sqlite.prepare("SELECT COUNT(*) n FROM user_songbook_records WHERE kind = 'song' AND removed = 0").get().n, 6)
  edit(a, lib => ({ ...lib, songs: [...lib.songs, song(70, { title: 'Huge', rawContent: 'y'.repeat(600000) }), song(71)] }))
  const partial = await w.run(a)
  assert.equal(partial.success, false)
  assert.match(partial.error, /too large to sync.*Huge/)
  assert.ok(w.db.sqlite.prepare("SELECT 1 FROM user_songbook_records WHERE record_id = ?").get(id(71)), 'the normal song still synced')
  assert.ok(read(a).songs.some(s => s.title === 'Huge'), 'oversized song kept on the device')
})

test('#208 F6: a sync that would apply remote changes under an open editor writes nothing and is deferred', async () => {
  const w = await world({ library: base })
  const a = w.device(base), b = w.device(base)
  await w.run(a); await w.run(b)
  edit(a, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'from A' } : s) }))
  await w.run(a)
  const rawBefore = journal.libraryRevision(b)
  const stateBefore = JSON.stringify(client.readRecordsSyncState(b))
  const deferred = await w.run(b, { canApply: () => false })
  assert.equal(deferred.deferred, true)
  assert.equal(journal.libraryRevision(b), rawBefore, 'library untouched')
  assert.equal(JSON.stringify(client.readRecordsSyncState(b)), stateBefore, 'sync state untouched')
  const later = await w.run(b)
  assert.equal(later.success, true)
  assert.equal(read(b).songs.find(s => s.id === id(1)).rawContent, 'from A')
})

// #204 S1: a per-record sync that changes something leaves a ✅ line (INFO, recorded with the debug switch on).
test('#204: a successful per-record sync logs a success line with counts', async () => {
  const logger = require('../src/utils/logger.ts')
  logger.appLogger.resume()
  logger.setDebugLoggingEnabled(true)
  try {
    const w = await world({ library: base })
    const a = w.device(base)
    await w.run(a)
    edit(a, lib => ({ ...lib, songs: [...lib.songs, song(9)] }))
    await w.run(a)
    const line = logger.appLogger.getLogs().reverse().find(l => /Per-record sync OK/.test(l.message))
    assert.match(line.message, /✅ Per-record sync OK: 0 from cloud, 1 uploaded/)
    assert.match(line.details, /^cursor \d+$/)
  } finally { logger.setDebugLoggingEnabled(false) }
})
