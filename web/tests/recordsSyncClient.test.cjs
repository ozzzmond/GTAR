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
  let after = null
  const fetch = async (url, opts = {}) => {
    if (hook) await hook(url, opts)
    const target = url.startsWith('/api/songbook/records') ? recordsApi : syncApi
    const method = opts.method || 'GET'
    const response = await target[method === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env, request: new Request(`https://example.com${url}`, {
      method, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` }, ...(opts.body ? { body: opts.body } : {}) }) })
    // Test hook: runs after the server handled the request (e.g. to lose the acknowledgement).
    if (after) await after(url, opts)
    return response
  }
  // #247: test devices hold user-a's library (linked to user-a, as after an explicit link).
  const device = lib => { const s = storage(); journal.persistLibrary(lib, s)
    s.setItem('gtar_library_owner_v1', JSON.stringify({ v: 1, userId: user.id, env: require('../src/utils/libraryOwner.ts').libraryEnv(), boundAt: 0, reason: 'confirmed' })); return s }
  const run = async (store, options) => {
    const saved = global.fetch
    global.fetch = fetch
    const hadSession = localStorage.getItem('gtar_auth_session') !== null
    if (!hadSession) {
      localStorage.setItem('gtar_auth_session', JSON.stringify({ user: { id: user.id }, sessionToken: 'token' }))
    }
    try { return await client.performRecordsSync('token', { storage: store, ...options }) }
    finally {
      if (!hadSession) localStorage.removeItem('gtar_auth_session')
      global.fetch = saved
    }
  }
  const runAny = async (store, options) => {
    const saved = global.fetch
    global.fetch = fetch
    const hadSession = localStorage.getItem('gtar_auth_session') !== null
    if (!hadSession) {
      localStorage.setItem('gtar_auth_session', JSON.stringify({ user: { id: user.id }, sessionToken: 'token' }))
    }
    try { return await client.performSongbookSync('token', { storage: store, ...options }) }
    finally {
      if (!hadSession) localStorage.removeItem('gtar_auth_session')
      global.fetch = saved
    }
  }
  return { db, device, run, runAny, api: fetch, setHook: h => { hook = h }, setAfter: h => { after = h } }
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
  // Switched to per-record sync: first the one-time setup choice (#227), then with "combine" the
  // unsynced edit is a reviewable conflict (never silently lost) and resolves.
  client.setRecordsSyncEnabled(true, b)
  assert.deepEqual((await w.runAny(b)).firstSyncChoice, { songs: 1, setlists: 0 })
  assert.equal((await w.runAny(b, { firstSync: 'combine' })).status, 'CONFLICT')
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

// #208 F6 (re-audit): a save from another surface during the push makes the sync's library stale.
test('#208 F6: result carries the revision it wrote; a save landing during the push is detectable and kept', async () => {
  const w = await world({ library: base })
  const a = w.device(base), b = w.device(base)
  await w.run(a); await w.run(b)
  edit(a, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'remote from A' } : s) }))
  await w.run(a)
  edit(b, lib => ({ ...lib, songs: [...lib.songs, song(5)] })) // something for B to push
  let saved = false
  w.setHook(async (url, opts) => {
    if (!saved && opts.method === 'POST') { // B's push is in flight: a fresh editor surface saves on B
      saved = true
      edit(b, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(2) ? { ...s, rawContent: 'NEW EDITOR SAVE' } : s) }))
    }
  })
  const result = await w.run(b)
  assert.equal(saved, true)
  assert.ok(result.updatedLibrary, 'B applied the remote change')
  assert.equal(typeof result.appliedRevision, 'string')
  assert.notEqual(result.appliedRevision, journal.libraryRevision(b), 'stale: a newer save exists')
  const stored = read(b)
  assert.equal(stored.songs.find(s => s.id === id(2)).rawContent, 'NEW EDITOR SAVE', 'the newer save is in storage')
  assert.equal(stored.songs.find(s => s.id === id(1)).rawContent, 'remote from A', 'with the remote change')
  assert.equal(result.updatedLibrary.songs.find(s => s.id === id(2)).rawContent, `[G]Line 2`, 'the result copy is the stale one')
})

// #227 item 2 and 3: first-run samples never reach the cloud; a real song does.
// #228: the app ships no samples; devices may still hold the former ones, recognised by fingerprint.
// The tests stand in placeholder charts for them (same ids), registered with their own fingerprints.
const sampleLib = require('../src/data/defaultLibrary.ts')
const { isPristineSampleRecord } = sampleLib
const DEFAULT_SETLIST = [1, 2, 3, 4].map(n => ({ id: `d1080001-0001-4000-8000-00000000000${n}`, title: `Legacy sample ${n}`, artist: 'GTAR test',
  key: 'G', capo: 'No Capo', bpm: '100', format: 'CHORD_PRO', transposeOffset: 0, rawContent: `{title: Legacy sample ${n}}\n\n[G]sample line [C]${n}` }))
sampleLib.LEGACY_SAMPLE_SONGS.clear()
for (const sample of DEFAULT_SETLIST) sampleLib.LEGACY_SAMPLE_SONGS.set(sample.id, sampleLib.sampleSongFingerprint(sample))
const DEFAULT_SAMPLE_SETLISTS = [{ id: 'd1080002-0001-4000-8000-000000000001', name: 'Acoustic Gig Set',
  songs: DEFAULT_SETLIST.map(({ id, title, artist }) => ({ id, title, artist })) }]
const cloudIds = (w, kind) => w.db.sqlite.prepare('SELECT record_id FROM user_songbook_records WHERE kind = ? AND removed = 0').all(kind).map(r => r.record_id)
test('#227: a new device with the sample library gets the cloud songs and uploads no samples', async () => {
  const w = await world({ library: base })
  const fresh = w.device({ songs: DEFAULT_SETLIST, setlists: DEFAULT_SAMPLE_SETLISTS })
  const result = await w.run(fresh)
  assert.equal(result.success, true)
  assert.deepEqual(cloudIds(w, 'song').filter(id => id.startsWith('d108')), [], 'no sample songs in the cloud')
  assert.deepEqual(cloudIds(w, 'setlist').filter(id => id.startsWith('d108')), [], 'no sample setlists in the cloud')
  assert.equal(cloudIds(w, 'song').length, 3)
  assert.ok(base.songs.every(s => read(fresh).songs.some(x => x.id === s.id)), 'cloud songs reached the new device')
  // Nothing was deleted from the cloud by the new device, and a second sync stays quiet.
  const again = await w.run(fresh)
  assert.equal(again.actionTaken, 'NONE')
})

test('#227: an edited sample is the user\'s song and syncs; an empty cloud receives the device\'s real songs', async () => {
  const w = await world({ library: { songs: [], setlists: [] } })
  const device = w.device({ songs: [...DEFAULT_SETLIST, song(7)], setlists: DEFAULT_SAMPLE_SETLISTS })
  await w.run(device)
  assert.deepEqual(cloudIds(w, 'song'), [id(7)], 'empty cloud: real song uploaded, samples not')
  edit(device, lib => ({ ...lib, songs: lib.songs.map(s => s.id === DEFAULT_SETLIST[0].id ? { ...s, rawContent: s.rawContent + '\n[G]my edit' } : s) }))
  await w.run(device)
  assert.ok(cloudIds(w, 'song').includes(DEFAULT_SETLIST[0].id), 'edited sample uploaded')
})

test('#227: pristine-sample detection ignores storage normalization but not real edits', () => {
  const s = DEFAULT_SETLIST[1]
  assert.equal(isPristineSampleRecord('song', { ...s, rawContent: s.rawContent.replace(/\n/g, '\r\n') + '\n', key: 'C', bpm: '99' }), true)
  assert.equal(isPristineSampleRecord('song', { ...s, title: s.title + '!' }), false)
  assert.equal(isPristineSampleRecord('song', { ...s, id: 'other' }), false)
  const l = DEFAULT_SAMPLE_SETLISTS[0]
  assert.equal(isPristineSampleRecord('setlist', JSON.parse(JSON.stringify(l))), true)
  assert.equal(isPristineSampleRecord('setlist', { ...l, songs: l.songs.slice(1) }), false)
})

// #227 item 1: the first sync on a device, when the cloud already has a library.
const songIds = store => read(store).songs.map(s => s.id).sort()
test('#227: a new device with only samples takes the cloud library without asking (samples dropped, no archive)', async () => {
  const w = await world({ library: base })
  const fresh = w.device({ songs: DEFAULT_SETLIST, setlists: DEFAULT_SAMPLE_SETLISTS })
  const archives = recoveryKeys(fresh).length
  const result = await w.run(fresh)
  assert.equal(result.firstSyncChoice, undefined)
  assert.deepEqual(songIds(fresh), base.songs.map(s => s.id).sort(), 'device shows exactly the cloud library')
  assert.equal(recoveryKeys(fresh).length, archives, 'samples need no recovery archive')
})

test('#227: a new device with its own songs is asked once; nothing is written before the answer', async () => {
  const w = await world({ library: base })
  const fresh = w.device({ songs: [...DEFAULT_SETLIST, song(8)], setlists: DEFAULT_SAMPLE_SETLISTS })
  const raw = journal.libraryRevision(fresh)
  const result = await w.run(fresh)
  assert.deepEqual(result.firstSyncChoice, { songs: 1, setlists: 0 })
  assert.equal(journal.libraryRevision(fresh), raw, 'library untouched')
  assert.deepEqual(client.readRecordsSyncState(fresh).known, {}, 'sync state untouched')
  assert.ok(!cloudIds(w, 'song').includes(id(8)), 'nothing uploaded')
})

test('#227: "use cloud library" → device = cloud, own song kept in recovery, cloud unchanged', async () => {
  const w = await world({ library: base })
  const fresh = w.device({ songs: [...DEFAULT_SETLIST, song(8)], setlists: DEFAULT_SAMPLE_SETLISTS })
  const archives = recoveryKeys(fresh).length
  const result = await w.run(fresh, { firstSync: 'cloud' })
  assert.equal(result.success, true)
  assert.deepEqual(songIds(fresh), base.songs.map(s => s.id).sort())
  assert.equal(recoveryKeys(fresh).length, archives + 1, 'own songs kept in recovery')
  assert.ok(!cloudIds(w, 'song').includes(id(8)))
  assert.equal((await w.run(fresh)).firstSyncChoice, undefined, 'asked only once')
})

test('#227: "combine" → own song added to the cloud, samples not, existing cloud songs kept', async () => {
  const w = await world({ library: base })
  const fresh = w.device({ songs: [...DEFAULT_SETLIST, song(8)], setlists: DEFAULT_SAMPLE_SETLISTS })
  const result = await w.run(fresh, { firstSync: 'combine' })
  assert.equal(result.success, true)
  const cloud = cloudIds(w, 'song')
  assert.ok(cloud.includes(id(8)) && base.songs.every(s => cloud.includes(s.id)))
  assert.deepEqual(cloud.filter(i => i.startsWith('d108')), [])
})

// #227 item 4: "Replace this device with the cloud copy" writes nothing when the device already matches.
test('#227: replace with cloud copy on a device that already matches: no archive, no write, real counts', async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  await w.run(a)
  const raw = journal.libraryRevision(a)
  const archives = recoveryKeys(a).length
  for (let i = 0; i < 3; i++) {
    const result = await w.run(a, { forceAction: 'download' })
    assert.equal(result.success, true, result.error)
    assert.deepEqual(result.replaced, { songs: 3, setlists: 1, changed: 0 })
    assert.equal(result.updatedLibrary, undefined, 'nothing to apply')
  }
  assert.equal(journal.libraryRevision(a), raw, 'library untouched')
  assert.equal(recoveryKeys(a).length, archives, 'repeated presses add no archives')
})

test('#227: replace with cloud copy on a device that differs: one archive, device = cloud, changed counted', async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  await w.run(a)
  edit(a, lib => ({ ...lib, songs: [...lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'local only edit' } : s), song(9)] }))
  const archives = recoveryKeys(a).length
  const result = await w.run(a, { forceAction: 'download' })
  assert.equal(result.success, true, result.error)
  assert.deepEqual(result.replaced, { songs: 3, setlists: 1, changed: 2 })
  assert.deepEqual(songIds(a), base.songs.map(s => s.id).sort())
  assert.equal(read(a).songs.find(s => s.id === id(1)).rawContent, base.songs[0].rawContent)
  assert.equal(recoveryKeys(a).length, archives + 1)
})

// #208 follow-up: the feed returns this device's own uploads; they are not a remote change.
test('#208: edit or delete again right after an upload, before any other pull: pushed, no self-conflict', async () => {
  const w = await world({ library: base })
  const a = w.device(base), b = w.device(base)
  await w.run(a); await w.run(b)
  edit(a, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'v1' } : s) }))
  assert.equal((await w.run(a)).actionTaken, 'UPLOADED')
  edit(a, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'v2' } : s) }))
  const second = await w.run(a)
  assert.equal(second.actionTaken, 'UPLOADED', second.error)
  edit(a, lib => ({ ...lib, songs: lib.songs.filter(s => s.id !== id(3)) }))
  const removal = await w.run(a)
  assert.equal(removal.actionTaken, 'UPLOADED', removal.error)
  assert.equal(client.readRecordsSyncState(a).conflicts.length, 0)
  await w.run(b)
  assert.equal(read(b).songs.find(s => s.id === id(1)).rawContent, 'v2')
  assert.ok(!read(b).songs.some(s => s.id === id(3)), 'deletion reached the other device')
})

test('#208: a real remote change still conflicts with a local edit after this device\'s own upload', async () => {
  const w = await world({ library: base })
  const a = w.device(base), b = w.device(base)
  await w.run(a); await w.run(b)
  edit(a, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'A1' } : s) }))
  await w.run(a)
  await w.run(b)
  edit(b, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'B2' } : s) }))
  await w.run(b)
  edit(a, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(1) ? { ...s, rawContent: 'A2' } : s) }))
  const result = await w.run(a)
  assert.equal(result.status, 'CONFLICT')
  assert.equal(read(a).songs.find(s => s.id === id(1)).rawContent, 'A2', 'local edit kept')
})

// #228: former samples the user never changed are removed from the device; edited ones stay.
test('#228: removeUnchangedSamples drops unchanged samples and their setlist, keeps edits and referenced songs', () => {
  const { removeUnchangedSamples } = sampleLib
  const mine = song(5)
  const all = { songs: [...DEFAULT_SETLIST, mine], setlists: DEFAULT_SAMPLE_SETLISTS }
  assert.deepEqual(removeUnchangedSamples(all), { songs: [mine], setlists: [] })
  const edited = { ...DEFAULT_SETLIST[0], rawContent: DEFAULT_SETLIST[0].rawContent + '\n[D]mine now' }
  const myList = { id: 'my-list', name: 'Sunday', songs: [{ id: DEFAULT_SETLIST[1].id }] }
  const kept = removeUnchangedSamples({ songs: [edited, ...DEFAULT_SETLIST.slice(1), mine], setlists: [...DEFAULT_SAMPLE_SETLISTS, myList] })
  assert.deepEqual(kept.songs.map(s => s.id), [edited.id, DEFAULT_SETLIST[1].id, mine.id], 'edited sample and the one in my setlist stay')
  assert.deepEqual(kept.setlists.map(l => l.id), ['my-list'])
  const plain = { songs: [mine], setlists: [] }
  assert.equal(removeUnchangedSamples(plain), plain, 'nothing to remove → same object')
  assert.deepEqual(sampleLib.DEFAULT_SETLIST, [], 'no songs ship with the app')
  assert.deepEqual(sampleLib.DEFAULT_SAMPLE_SETLISTS, [])
})

test('#228: a device that synced the samples before removes them from the cloud once they are cleaned up', async () => {
  const w = await world({ library: { songs: [], setlists: [] } })
  const device = w.device({ songs: [song(7)], setlists: [] })
  await w.run(device)
  // Simulate a build before #227, which uploaded the samples like any other song.
  const fingerprints = new Map(sampleLib.LEGACY_SAMPLE_SONGS)
  const setlists = new Map(sampleLib.LEGACY_SAMPLE_SETLISTS)
  sampleLib.LEGACY_SAMPLE_SONGS.clear(); sampleLib.LEGACY_SAMPLE_SETLISTS.clear()
  edit(device, lib => ({ ...lib, songs: [...lib.songs, ...DEFAULT_SETLIST], setlists: DEFAULT_SAMPLE_SETLISTS }))
  await w.run(device)
  for (const [k, v] of fingerprints) sampleLib.LEGACY_SAMPLE_SONGS.set(k, v)
  for (const [k, v] of setlists) sampleLib.LEGACY_SAMPLE_SETLISTS.set(k, v)
  assert.equal(cloudIds(w, 'song').length, 5, 'old build: samples in the cloud')
  assert.equal(cloudIds(w, 'setlist').length, 1)
  edit(device, lib => sampleLib.removeUnchangedSamples(lib))
  await w.run(device)
  assert.deepEqual(cloudIds(w, 'song'), [id(7)], 'only the real song is left in the cloud')
  assert.deepEqual(cloudIds(w, 'setlist'), [])
})

// #240: a cloud setlist that still lists a song deleted in the cloud must not block sync.
const { recordChecksum } = require('../src/utils/songbookRecords.ts')
function removeInCloud(w, songId) {
  const db = w.db.sqlite
  const seq = db.prepare("SELECT seq FROM user_songbook_cursors WHERE user_id = 'user-a'").get().seq + 1
  db.prepare("UPDATE user_songbook_records SET removed = 1, data_json = NULL, rev = rev + 1, seq = ?, checksum = ? WHERE kind = 'song' AND record_id = ?")
    .run(seq, recordChecksum(true, null), songId)
  db.prepare("UPDATE user_songbook_cursors SET seq = ? WHERE user_id = 'user-a'").run(seq)
}
const cloudSetlistRefs = (w, setlistId) => JSON.parse(w.db.sqlite.prepare("SELECT data_json FROM user_songbook_records WHERE kind = 'setlist' AND record_id = ?").get(setlistId).data_json).songs.map(r => r.id)

test('#240: only a network failure reads as offline; an error on this device reads as an error', async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  w.setHook(async () => { throw new TypeError('Failed to fetch') })
  assert.equal((await w.run(a)).status, 'OFFLINE')
  w.setHook(async () => { throw new Error('Synced songbook failed referential integrity check: x') })
  const failed = await w.run(a)
  assert.equal(failed.status, 'ERROR')
  assert.match(failed.error, /integrity/)
  w.setHook(null)
})

test('#240: sample cleanup keeps a sample setlist that is already in the cloud, and the songs it lists', () => {
  const { removeUnchangedSamples, cloudSyncedSetlistIds } = sampleLib
  const all = { songs: [...DEFAULT_SETLIST, song(5)], setlists: DEFAULT_SAMPLE_SETLISTS }
  const synced = cloudSyncedSetlistIds({ getItem: () => JSON.stringify({ known: { [`setlist:${DEFAULT_SAMPLE_SETLISTS[0].id}`]: { rev: 2 }, 'song:x': {} } }) })
  assert.deepEqual([...synced], [DEFAULT_SAMPLE_SETLISTS[0].id])
  assert.equal(removeUnchangedSamples(all, synced), all, 'nothing removed')
  assert.deepEqual(removeUnchangedSamples(all, new Set()).songs.map(s => s.id), [song(5).id], 'local-only samples still removed')
  assert.deepEqual([...cloudSyncedSetlistIds({ getItem: () => 'not json' })], [])
})

// #240 reproduction: how the cloud can end up with a live setlist that lists deleted songs.
test('#240 repro: cleanup on a device with a stale unchanged sample setlist → song tombstones accepted, setlist deletion conflicts', async () => {
  const w = await world({ library: { songs: [], setlists: [] } })
  const a = w.device({ songs: [song(7)], setlists: [] })
  await w.run(a)
  // A build before #227 uploaded the samples like any song.
  const fingerprints = new Map(sampleLib.LEGACY_SAMPLE_SONGS); const lists = new Map(sampleLib.LEGACY_SAMPLE_SETLISTS)
  sampleLib.LEGACY_SAMPLE_SONGS.clear(); sampleLib.LEGACY_SAMPLE_SETLISTS.clear()
  edit(a, lib => ({ ...lib, songs: [...lib.songs, ...DEFAULT_SETLIST], setlists: DEFAULT_SAMPLE_SETLISTS }))
  await w.run(a)
  const b = w.device({ songs: [], setlists: [] })
  await w.run(b)
  // Device B edits the sample setlist (drops sample 2) and deletes sample 2: cloud setlist rev 2.
  edit(b, lib => ({ ...lib, setlists: lib.setlists.map(l => ({ ...l, songs: l.songs.filter(r => r.id !== DEFAULT_SETLIST[1].id) })) }))
  edit(b, lib => ({ ...lib, songs: lib.songs.filter(s => s.id !== DEFAULT_SETLIST[1].id) }))
  await w.run(b)
  for (const [k, v] of fingerprints) sampleLib.LEGACY_SAMPLE_SONGS.set(k, v)
  for (const [k, v] of lists) sampleLib.LEGACY_SAMPLE_SETLISTS.set(k, v)

  // Old #228 rule on A, before A pulls B's change: A's local setlist is still the unchanged sample.
  const stale = sampleLib.removeUnchangedSamples(read(a))
  assert.equal(stale.setlists.length, 0, 'old rule removes the stale sample setlist and its songs')
  // The new rule keeps them because the setlist is already in the cloud.
  assert.equal(sampleLib.removeUnchangedSamples(read(a), sampleLib.cloudSyncedSetlistIds(a)).setlists.length, 1, 'new rule keeps it')

  journal.persistLibrary(stale, a, { expectedRaw: journal.libraryRevision(a) })
  await w.run(a)
  const conflicts = client.readRecordsSyncState(a).conflicts
  assert.ok(conflicts.some(c => c.kind === 'setlist' && c.id === DEFAULT_SAMPLE_SETLISTS[0].id), 'setlist deletion conflicts (stale base revision)')
  // Before #240 the song deletions were accepted here (seq 775–777 on DEV). The server now refuses them
  // while the live cloud setlist still lists the songs, so the cloud stays consistent.
  for (const n of [0, 2, 3]) assert.ok(conflicts.some(c => c.id === DEFAULT_SETLIST[n].id && /setlist in the cloud still lists it/.test(c.note)), `song ${n + 1} refused`)
  const removed = w.db.sqlite.prepare("SELECT record_id FROM user_songbook_records WHERE kind = 'song' AND removed = 1").all().map(r => r.record_id)
  assert.deepEqual(removed, [DEFAULT_SETLIST[1].id], 'only sample 2 (dropped from the setlist by B) is deleted')
  assert.deepEqual(cloudSetlistRefs(w, DEFAULT_SAMPLE_SETLISTS[0].id), [DEFAULT_SETLIST[0].id, DEFAULT_SETLIST[2].id, DEFAULT_SETLIST[3].id])
})

// #240 non-destructive hold-back: the DEV state (live setlist, its songs deleted in the cloud).
test('#240: a device that still has the songs keeps them; the deletions wait as conflicts; other changes apply', async () => {
  const w = await world({ library: base })
  const a = w.device(base), b = w.device(base)
  await w.run(a); await w.run(b)
  edit(b, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(3) ? { ...s, rawContent: 'edited on B' } : s) }))
  await w.run(b)
  removeInCloud(w, id(2))
  const result = await w.run(a)
  assert.equal(result.status, 'CONFLICT')
  assert.ok(read(a).songs.some(s => s.id === id(2)), 'song kept on this device')
  assert.deepEqual(read(a).setlists[0].songs.map(r => r.id), [id(1), id(2)], 'setlist untouched')
  assert.equal(read(a).songs.find(s => s.id === id(3)).rawContent, 'edited on B', 'unrelated cloud change applied')
  const held = client.readRecordsSyncState(a).conflicts
  assert.deepEqual(held.map(c => c.id), [id(2)])
  assert.match(held[0].note, /Removed in the cloud, but setlist "List 1" on this device still lists it/)
  assert.equal(result.conflicts[0].reason, held[0].note)
  // Keep this device: the song goes back to the cloud; everyone converges.
  assert.equal((await w.run(a, { forceAction: 'upload' })).success, true)
  assert.ok(cloudIds(w, 'song').includes(id(2)), 'song restored in the cloud')
  const fresh = w.device({ songs: [], setlists: [] })
  assert.equal((await w.run(fresh)).success, true)
  assert.deepEqual(read(fresh).setlists[0].songs.map(r => r.id), [id(1), id(2)])
})

test('#240: a new device holds back a cloud setlist that lists missing songs; everything else syncs; "use cloud" is explicit', async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  await w.run(a)
  removeInCloud(w, id(2))
  const fresh = w.device({ songs: [], setlists: [] })
  const result = await w.run(fresh)
  assert.equal(result.status, 'CONFLICT')
  assert.deepEqual(read(fresh).songs.map(s => s.id).sort(), [id(1), id(3)], 'songs synced')
  assert.deepEqual(read(fresh).setlists, [], 'the setlist is held back, not rewritten')
  assert.deepEqual(cloudSetlistRefs(w, id(901)), [id(1), id(2)], 'nothing written to the cloud')
  assert.match(client.readRecordsSyncState(fresh).conflicts[0].note, /lists songs that are not in your library/)
  // The user chooses the cloud version: missing entries are dropped then, and only then.
  assert.equal((await w.run(fresh, { forceAction: 'download' })).success, true)
  assert.deepEqual(read(fresh).setlists[0].songs.map(r => r.id), [id(1)])
  assert.deepEqual(cloudSetlistRefs(w, id(901)), [id(1)], 'the explicit choice is pushed')
})

test('#240 server: a song deletion is refused while a live cloud setlist lists it; dropping it from the setlist in the same push is fine', async () => {
  const w = await world({ library: base })
  const a = w.device(base), b = w.device(base)
  await w.run(a); await w.run(b)
  // B lists song 2 in a second setlist; A has not seen it.
  edit(b, lib => ({ ...lib, setlists: [...lib.setlists, list(2, [2, 3])] }))
  await w.run(b)
  // A drops song 2 from its setlist and deletes it, in one push.
  edit(a, lib => ({ songs: lib.songs.filter(s => s.id !== id(2)), setlists: lib.setlists.map(l => ({ ...l, songs: l.songs.filter(r => r.id !== id(2)) })) }))
  const pushed = await w.run(a)
  assert.ok(pushed)
  assert.ok(cloudIds(w, 'song').includes(id(2)), 'song 2 still live: "List 2" lists it')
  assert.deepEqual(cloudSetlistRefs(w, id(901)), [id(1)], 'the setlist edit itself was accepted')
  assert.ok(client.readRecordsSyncState(a).conflicts.some(c => c.id === id(2)))
  // When no setlist lists it, the deletion goes through.
  const c = w.device({ songs: [], setlists: [] })
  await w.run(c)
  edit(c, lib => ({ songs: lib.songs.filter(s => s.id !== id(3)), setlists: lib.setlists.map(l => ({ ...l, songs: l.songs.filter(r => r.id !== id(3)) })) }))
  await w.run(c)
  assert.ok(!cloudIds(w, 'song').includes(id(3)), 'song 3 deleted together with its setlist entries')
})

// #240 residual (Codex audit) F2: the server must not accept a setlist write that lists a deleted song.
const pushRaw = async (w, changes) => (await w.api('/api/songbook/records', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GTAR-Library-Owner': 'user-a' }, body: JSON.stringify({ changes }) })).json()
const cloudRec = (w, kind, rid) => w.db.sqlite.prepare('SELECT rev, removed, data_json FROM user_songbook_records WHERE kind = ? AND record_id = ?').get(kind, rid)
test('#240 F2: unlink → delete song → write setlist listing the deleted song is refused atomically', async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  await w.run(a)
  edit(a, lib => ({ songs: lib.songs.filter(s => s.id !== id(2)), setlists: lib.setlists.map(l => ({ ...l, songs: l.songs.filter(r => r.id !== id(2)) })) }))
  await w.run(a)
  assert.equal(cloudRec(w, 'song', id(2)).removed, 1, 'song 2 deleted after being unlinked')
  const setlist = cloudRec(w, 'setlist', id(901))
  const stale = { ...JSON.parse(setlist.data_json), songs: [{ id: id(1), title: 'Song 1', artist: 'A' }, { id: id(2), title: 'Song 2', artist: 'A' }] }
  const response = await pushRaw(w, [{ kind: 'setlist', id: id(901), baseRev: setlist.rev, data: stale }])
  assert.deepEqual(response.accepted, [], 'not accepted')
  assert.equal(response.conflicts[0]?.reason, 'missing-songs')
  assert.deepEqual(cloudSetlistRefs(w, id(901)), [id(1)], 'cloud setlist unchanged')
  // A brand-new setlist listing a missing song is refused too; one listing a song created in the same push is accepted.
  const created = await pushRaw(w, [{ kind: 'setlist', id: id(950), baseRev: 0, data: list(50, [1, 2]) }])
  assert.equal(created.conflicts[0]?.reason, 'missing-songs')
  assert.equal(cloudRec(w, 'setlist', id(950)), undefined)
  const both = await pushRaw(w, [{ kind: 'setlist', id: id(951), baseRev: 0, data: list(51, [1, 60]) }, { kind: 'song', id: id(60), baseRev: 0, data: song(60) }])
  assert.equal(both.accepted.length, 2, 'song and the setlist listing it, in one push')
})

// F5: "Keep this device" for a held-back cloud setlist this device does not have must delete it in the cloud.
test('#240 F5: keep this device on a held-back setlist that is not here → cloud tombstone, conflict cleared only on acknowledgement', async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  await w.run(a)
  removeInCloud(w, id(2))
  const fresh = w.device({ songs: [], setlists: [] })
  await w.run(fresh)
  assert.equal(client.readRecordsSyncState(fresh).conflicts.length, 1)
  // Upload fails: nothing is reported as resolved, the conflict stays.
  w.setHook(async (url, opts) => { if ((opts.method || 'GET') === 'POST') throw new TypeError('Failed to fetch') })
  const offline = await w.run(fresh, { forceAction: 'upload' })
  w.setHook(null)
  assert.notEqual(offline.success, true, 'no false success')
  assert.equal(client.readRecordsSyncState(fresh).conflicts.length, 1, 'conflict kept until the cloud confirms')
  const done = await w.run(fresh, { forceAction: 'upload' })
  assert.equal(done.success, true, done.error)
  assert.equal(cloudRec(w, 'setlist', id(901)).removed, 1, 'cloud setlist tombstoned')
  assert.equal(client.readRecordsSyncState(fresh).conflicts.length, 0)
  assert.deepEqual(cloudIds(w, 'song').sort(), [id(1), id(3)], 'unrelated records intact')
  const again = await w.run(a)
  assert.equal(again.success, true, again.error)
  assert.deepEqual(read(a).setlists, [], 'other device converges')
})

test('#240 F2 race: a song deleted by a concurrent writer between the read and the write still blocks the setlist write', async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  await w.run(a)
  const setlist = cloudRec(w, 'setlist', id(901))
  let fired = false
  w.db.beforeBatchStatement = () => { if (!fired) { fired = true; removeInCloud(w, id(3)) } }
  const response = await pushRaw(w, [{ kind: 'setlist', id: id(901), baseRev: setlist.rev, data: list(1, [1, 3]) }])
  w.db.beforeBatchStatement = null
  assert.ok(fired, 'the concurrent deletion ran inside the push')
  assert.deepEqual(response.accepted, [])
  assert.equal(response.conflicts[0]?.reason, 'missing-songs')
  assert.deepEqual(cloudSetlistRefs(w, id(901)), [id(1), id(2)], 'no dangling entry written')
})

// #240 F8 (Codex): a setlist entry with a stale song id whose title matches another song. Exact ids are the
// identity; the title must not hide the problem or relink the entry.
test('#240 F8: stale song id in a cloud setlist → detected by exact id, held back with an actionable note, rest syncs, nothing relinked', async () => {
  const staleList = { id: id(901), name: 'List 1', songs: [{ id: id(1), title: 'Song 1', artist: 'A' }, { id: id(77), title: 'Song 2', artist: 'A' }] }
  const w = await world({ library: { songs: [song(1), song(2), song(3)], setlists: [staleList] } })
  const fresh = w.device({ songs: [], setlists: [] })
  const result = await w.run(fresh)
  assert.equal(result.status, 'CONFLICT', result.error)
  assert.deepEqual(read(fresh).songs.map(s => s.id).sort(), [id(1), id(2), id(3)], 'unrelated records synced')
  assert.deepEqual(read(fresh).setlists, [], 'setlist held back, not rewritten or relinked')
  const conflict = client.readRecordsSyncState(fresh).conflicts[0]
  assert.equal(conflict.id, id(901))
  assert.match(conflict.note, /no song with that exact ID\): "Song 2"/)
  assert.match(conflict.note, /"Download Cloud" keeps this setlist without those entries; "Keep Local Only" keeps this device's version\. Either way, the cloud version is first saved in Review local recovery\./)
  assert.deepEqual(cloudSetlistRefs(w, id(901)), [id(1), id(77)], 'cloud entries untouched (raw id preserved)')
  // Use cloud (explicit): the stale entry is dropped, never pointed at song 2 by title; the raw cloud record is kept in recovery.
  assert.equal((await w.run(fresh, { forceAction: 'download' })).success, true)
  assert.deepEqual(read(fresh).setlists[0].songs.map(r => r.id), [id(1)], 'no relink to song 2')
  assert.deepEqual(cloudSetlistRefs(w, id(901)), [id(1)])
  const snapshots = Object.entries(journal.recoveryData(fresh)).filter(([k]) => k.startsWith('gtar_sync_recovery:records:')).map(([, v]) => JSON.parse(v))
  assert.ok(snapshots.some(snap => snap.remoteRecords?.some(r => r?.data?.songs?.some(ref => ref.id === id(77)))), 'original cloud entry (stale id) preserved in recovery')
})

// ---- #240 five confirmed recovery/convergence defects (base 5a5482b) ----
const heldSetlistWorld = async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  await w.run(a)
  removeInCloud(w, id(2))
  const fresh = w.device({ songs: [], setlists: [] })
  await w.run(fresh)
  assert.equal(client.readRecordsSyncState(fresh).conflicts.length, 1, 'setlist held back on the fresh device')
  return { w, a, fresh }
}

test('#240 P1-F1: a held-back setlist is applied automatically once its missing song is back in the cloud', async () => {
  const { w, a, fresh } = await heldSetlistWorld()
  await w.run(a) // A still has song 2: the cloud deletion is held there
  assert.equal((await w.run(a, { forceAction: 'upload' })).success, true) // Keep Local Only restores song 2 in the cloud
  assert.ok(cloudIds(w, 'song').includes(id(2)))
  for (let i = 0; i < 3; i++) await w.run(fresh)
  assert.deepEqual(read(fresh).setlists.map(l => l.songs.map(r => r.id)), [[id(1), id(2)]], 'setlist now on the fresh device')
  assert.equal(client.readRecordsSyncState(fresh).conflicts.length, 0, 'dependency conflict cleared')
  assert.equal((await w.run(fresh)).status, 'IN_SYNC')
})

test('#240 P1-F1: a dependency conflict stays while the song is still missing (nothing applied, nothing pruned)', async () => {
  const { w, fresh } = await heldSetlistWorld()
  for (let i = 0; i < 2; i++) await w.run(fresh)
  assert.deepEqual(read(fresh).setlists, [])
  assert.equal(client.readRecordsSyncState(fresh).conflicts.length, 1)
  assert.deepEqual(cloudSetlistRefs(w, id(901)), [id(1), id(2)])
})

test('#240 P1-F2: after Download Cloud drops entries, the recovery review shows the archived cloud setlist as a difference', async () => {
  const { w, fresh } = await heldSetlistWorld()
  assert.equal((await w.run(fresh, { forceAction: 'download' })).success, true)
  assert.deepEqual(read(fresh).setlists[0].songs.map(r => r.id), [id(1)])
  const review = journal.inspectRecovery(fresh)
  const source = review.sources.find(s => s.key.startsWith('gtar_sync_recovery:records:'))
  assert.ok(source, 'resolution snapshot exists')
  assert.notEqual(source.status, 'represented', 'not falsely represented')
  const diff = source.differences.find(d => d.kind === 'setlist' && d.id === id(901))
  assert.ok(diff, 'original cloud setlist listed')
  assert.deepEqual(diff.record.songs.map(r => r.id), [id(1), id(2)], 'with the omitted entry')
  assert.equal(diff.revision, 1, 'cloud revision shown')
  assert.ok(source.cloudRecordsOnly, 'restore-from-review not supported is disclosed')
  assert.ok(!journal.planRecoveryCleanup(review).some(item => item.key === source.key), 'cleanup cannot remove it before an explicit choice')
})

test('#240 P2-F3: Keep Both whose acknowledgement is lost creates exactly one copy on retry', async () => {
  const { w, b } = await conflicted()
  w.setAfter(async (url, opts) => { if ((opts.method || 'GET') === 'POST') throw new TypeError('Failed to fetch') })
  const lost = await w.run(b, { forceAction: 'merge_preserve' })
  w.setAfter(null)
  assert.notEqual(lost.success, true)
  const retry = await w.run(b, { forceAction: 'merge_preserve' })
  assert.equal(retry.success, true, retry.error)
  const copies = s => s.filter(x => /cloud copy/.test(x.title))
  assert.equal(copies(read(b).songs).length, 1, 'one copy on this device')
  const cloudCopies = w.db.sqlite.prepare("SELECT data_json FROM user_songbook_records WHERE kind = 'song' AND removed = 0").all().map(r => JSON.parse(r.data_json)).filter(x => /cloud copy/.test(x.title))
  assert.equal(cloudCopies.length, 1, 'one copy in the cloud')
})

test('#240 P2-F4: an editor save during Keep Local is kept and the round is not reported as in sync', async () => {
  const { w, b } = await conflicted()
  const original = journal.writeRecoverySnapshot
  journal.writeRecoverySnapshot = async (...args) => {
    edit(b, lib => ({ ...lib, songs: lib.songs.map(s => s.id === id(3) ? { ...s, rawContent: 'saved during sync' } : s) }))
    return original(...args)
  }
  let result
  try { result = await w.run(b, { forceAction: 'upload' }) } finally { journal.writeRecoverySnapshot = original }
  assert.notEqual(result.status, 'IN_SYNC', 'not reported as converged')
  assert.equal(read(b).songs.find(s => s.id === id(3)).rawContent, 'saved during sync', 'editor save kept')
  const again = await w.run(b, { forceAction: 'upload' })
  assert.equal(again.success, true, again.error)
  const settled = await w.run(b)
  assert.equal(settled.status, 'IN_SYNC')
  assert.equal(JSON.parse(cloudRec(w, 'song', id(3)).data_json).rawContent, 'saved during sync', 'cloud has the newer save')
  assert.equal(JSON.parse(cloudRec(w, 'song', id(1)).data_json).rawContent, 'B version', 'keep-local choice applied')
})

test('#240 P2-F5: the server refuses a new setlist entry without a song id', async () => {
  const w = await world({ library: base })
  const a = w.device(base)
  await w.run(a)
  const setlist = cloudRec(w, 'setlist', id(901))
  const idless = { ...JSON.parse(setlist.data_json), songs: [{ id: id(1), title: 'Song 1', artist: 'A' }, { title: 'Song 2', artist: 'A' }] }
  const response = await pushRaw(w, [{ kind: 'setlist', id: id(901), baseRev: setlist.rev, data: idless }])
  assert.deepEqual(response.accepted, [])
  assert.equal(response.conflicts[0]?.reason, 'missing-songs')
  assert.deepEqual(cloudSetlistRefs(w, id(901)), [id(1), id(2)], 'cloud setlist unchanged')
})

function updateSetlistInCloud(w, setlistId, fn) {
  const db = w.db.sqlite
  const row = db.prepare("SELECT data_json, rev FROM user_songbook_records WHERE kind = 'setlist' AND record_id = ?").get(setlistId)
  const data = fn(JSON.parse(row.data_json))
  const seq = db.prepare("SELECT seq FROM user_songbook_cursors WHERE user_id = 'user-a'").get().seq + 1
  db.prepare("UPDATE user_songbook_records SET data_json = ?, rev = rev + 1, seq = ?, checksum = ? WHERE kind = 'setlist' AND record_id = ?")
    .run(JSON.stringify(data), seq, recordChecksum(false, data), setlistId)
  db.prepare("UPDATE user_songbook_cursors SET seq = ? WHERE user_id = 'user-a'").run(seq)
}

test('R1A: restoring a missing song must not resurrect a deleted local setlist or report false IN_SYNC', async () => {
  const w = await world({ library: base })
  const a = w.device(base), b = w.device(base)
  await w.run(a); await w.run(b)

  // Cloud setlist is updated to reference a missing song (song 77)
  updateSetlistInCloud(w, id(901), s => ({ ...s, songs: [...s.songs, { id: id(77), title: 'Song 77', artist: 'A' }] }))

  // B syncs: cloud setlist 901 is quarantined on B because song 77 is missing
  await w.run(b)
  assert.equal(client.readRecordsSyncState(b).conflicts.length, 1, 'setlist quarantined on B')
  assert.equal(client.readRecordsSyncState(b).conflicts[0].dependency, true)
  assert.equal(read(b).setlists.length, 1, 'B had retained local copy')

  // B deletes the local retained setlist to establish deletion intent
  edit(b, lib => ({ ...lib, setlists: [] }))
  assert.equal(read(b).setlists.length, 0, 'B deleted local retained setlist')

  // Recovery restores the missing cloud song 77
  const added = await pushRaw(w, [{ kind: 'song', id: id(77), baseRev: 0, data: song(77) }])
  assert.equal(added.accepted.length, 1, 'song 77 restored in cloud')

  // Subsequent sync on B: in unfixed code, resurrects setlist and reports IN_SYNC
  const res = await w.run(b)
  assert.deepEqual(read(b).setlists, [], 'deleted local setlist must NOT reappear without explicit recovery')
  assert.notEqual(res.status, 'IN_SYNC', 'must not report false IN_SYNC')
  assert.equal(res.status, 'CONFLICT', 'must preserve conflict with actionable status')
})

test('R1B: legacy quarantined setlist conflict lacking dependency:true safely re-evaluates repaired dependencies', async () => {
  const { w, a, fresh } = await heldSetlistWorld()
  // Simulate persisted legacy conflict: lacks dependency: true
  const state = client.readRecordsSyncState(fresh)
  assert.equal(state.conflicts.length, 1)
  state.conflicts = state.conflicts.map(c => {
    const copy = { ...c }
    delete copy.dependency
    return copy
  })
  fresh.setItem('gtar_records_sync_v1', JSON.stringify(state))
  assert.strictEqual(client.readRecordsSyncState(fresh).conflicts[0].dependency, undefined)

  // Repair missing song dependency in cloud
  await w.run(a)
  assert.equal((await w.run(a, { forceAction: 'upload' })).success, true)
  assert.ok(cloudIds(w, 'song').includes(id(2)))

  // Retry on fresh device: legacy quarantine should re-evaluate and converge
  for (let i = 0; i < 3; i++) await w.run(fresh)
  assert.deepEqual(read(fresh).setlists.map(l => l.songs.map(r => r.id)), [[id(1), id(2)]], 'setlist applied on fresh device')
  assert.equal(client.readRecordsSyncState(fresh).conflicts.length, 0, 'legacy conflict cleared')
  assert.equal((await w.run(fresh)).status, 'IN_SYNC')
})

test('F1: malformed legacy conflict with inconsistent remote kind or ID is rejected from automatic recovery', async () => {
  const { w, a, fresh } = await heldSetlistWorld()

  // Cloud setlist 901 exists in the cloud
  assert.ok(cloudIds(w, 'setlist').includes(id(901)), 'cloud has setlist 901')

  // Repair missing song dependency in cloud so dependencies are met
  await w.run(a)
  assert.equal((await w.run(a, { forceAction: 'upload' })).success, true)
  assert.ok(cloudIds(w, 'song').includes(id(2)))

  // Fresh device has held-back conflict for setlist 901, but remote has inconsistent ID (setlist 999)
  const malformedData = { id: id(999), name: 'Setlist 999', songs: [{ id: id(1), title: 'Song 1' }, { id: id(2), title: 'Song 2' }] }
  const state = client.readRecordsSyncState(fresh)
  state.conflicts[0] = {
    kind: 'setlist',
    id: id(901),
    title: 'Setlist 901',
    dependency: true,
    note: 'missing-songs',
    remote: {
      kind: 'setlist',
      id: id(999), // inconsistent with conflict.id
      rev: 2,
      removed: false,
      checksum: recordChecksum(false, malformedData),
      data: malformedData
    }
  }
  fresh.setItem('gtar_records_sync_v1', JSON.stringify(state))

  const res = await w.run(fresh)
  assert.notEqual(res.status, 'IN_SYNC', 'must not return false IN_SYNC')
  assert.equal(res.status, 'CONFLICT', 'must report actionable CONFLICT')
  assert.ok(cloudIds(w, 'setlist').includes(id(901)), 'cloud setlist 901 must not be tombstoned')
  assert.ok(!cloudIds(w, 'setlist').includes(id(999)), 'inconsistent setlist 999 must not be uploaded to cloud')
  assert.equal(client.readRecordsSyncState(fresh).conflicts.length, 1, 'conflict preserved')
  assert.equal(client.readRecordsSyncState(fresh).conflicts[0].id, id(901), 'conflict identity preserved')
})

test('F1: explicit Download Cloud resolution blocks rogue cloud setlist creation from malformed conflict', async () => {
  const { w, a, fresh } = await heldSetlistWorld()

  await w.run(a)
  assert.equal((await w.run(a, { forceAction: 'upload' })).success, true)

  const initialRecoveryKeys = recoveryKeys(fresh).length
  const initialLocalSetlists = read(fresh).setlists.length
  const initialCursor = client.readRecordsSyncState(fresh).cursor

  const malformedData = { id: id(999), name: 'Setlist 999', songs: [{ id: id(1), title: 'Song 1' }] }
  const state = client.readRecordsSyncState(fresh)
  state.conflicts[0] = {
    kind: 'setlist',
    id: id(901),
    title: 'Setlist 901',
    dependency: true,
    note: 'missing-songs',
    remote: {
      kind: 'setlist',
      id: id(999),
      rev: 2,
      removed: false,
      checksum: recordChecksum(false, malformedData),
      data: malformedData
    }
  }
  fresh.setItem('gtar_records_sync_v1', JSON.stringify(state))

  // Explicit Download Cloud resolution with malformed conflict
  const res = await w.run(fresh, { forceAction: 'download' })
  assert.equal(res.success, false, 'must fail resolution')
  assert.equal(res.status, 'CONFLICT', 'must return CONFLICT status')
  assert.ok(!cloudIds(w, 'setlist').includes(id(999)), 'rogue setlist 999 must not be created in cloud')
  assert.equal(read(fresh).setlists.length, initialLocalSetlists, 'local library must not be mutated')
  assert.equal(recoveryKeys(fresh).length, initialRecoveryKeys, 'recovery evidence must not be mutated from invalid identity')
  assert.equal(client.readRecordsSyncState(fresh).cursor, initialCursor, 'cursor must not be mutated')
  assert.equal(client.readRecordsSyncState(fresh).conflicts.length, 1, 'actionable conflict must be preserved')
  assert.equal(client.readRecordsSyncState(fresh).conflicts[0].id, id(901))
})

test('F1: explicit Download Cloud resolution blocks local and cloud song overwrite from mismatched remote kind', async () => {
  const w = await world({ library: base })
  const a = w.device(base), b = w.device(base)
  await w.run(a); await w.run(b)

  const originalTitle = read(b).songs.find(s => s.id === id(1)).title
  const malformedSongData = { id: id(1), title: 'MALICIOUS_OVERWRITE_SONG_1', artist: 'HACKER', rawContent: '[C]Hacked' }
  const state = client.readRecordsSyncState(b)
  state.conflicts = [{
    kind: 'setlist',
    id: id(901),
    title: 'Setlist 901',
    dependency: true,
    note: 'missing-songs',
    remote: {
      kind: 'song',
      id: id(1),
      rev: 5,
      removed: false,
      checksum: recordChecksum(false, malformedSongData),
      data: malformedSongData
    }
  }]
  b.setItem('gtar_records_sync_v1', JSON.stringify(state))

  const res = await w.run(b, { forceAction: 'download' })
  assert.equal(res.success, false)
  assert.equal(res.status, 'CONFLICT')
  assert.equal(read(b).songs.find(s => s.id === id(1)).title, originalTitle, 'local song 1 must not be overwritten')
  const cloudRow = w.db.sqlite.prepare("SELECT data_json FROM user_songbook_records WHERE kind = 'song' AND record_id = ?").get(id(1))
  assert.equal(JSON.parse(cloudRow.data_json).title, originalTitle, 'cloud song 1 must not be overwritten')
  assert.equal(client.readRecordsSyncState(b).conflicts.length, 1, 'actionable conflict preserved')
})

test('F2: automatic recovery rejects fractional revision 1.5 in remote envelope', async () => {
  const { w, a, fresh } = await heldSetlistWorld()
  await w.run(a)
  assert.equal((await w.run(a, { forceAction: 'upload' })).success, true)

  const validData = { id: id(901), name: 'Setlist 901', songs: [{ id: id(1), title: 'Song 1' }, { id: id(2), title: 'Song 2' }] }
  const state = client.readRecordsSyncState(fresh)
  state.conflicts[0] = {
    kind: 'setlist',
    id: id(901),
    title: 'Setlist 901',
    dependency: true,
    note: 'missing-songs',
    remote: {
      kind: 'setlist',
      id: id(901),
      rev: 1.5, // fractional revision
      removed: false,
      checksum: recordChecksum(false, validData),
      data: validData
    }
  }
  fresh.setItem('gtar_records_sync_v1', JSON.stringify(state))

  const res = await w.run(fresh)
  assert.notEqual(res.status, 'IN_SYNC', 'must not return false IN_SYNC')
  assert.equal(res.status, 'CONFLICT', 'must report actionable CONFLICT')
  assert.equal(client.readRecordsSyncState(fresh).conflicts.length, 1, 'conflict preserved')
  assert.equal(read(fresh).setlists.some(l => l.id === id(901)), false, 'unverified setlist not applied')
})

test('F2: automatic recovery checks authoritative server data and rejects forged integer revision 101', async () => {
  const { w, a, fresh } = await heldSetlistWorld()
  await w.run(a)
  assert.equal((await w.run(a, { forceAction: 'upload' })).success, true)

  // Cloud setlist 901 is at revision 1
  const cloudRow = w.db.sqlite.prepare("SELECT rev, checksum FROM user_songbook_records WHERE kind = 'setlist' AND record_id = ?").get(id(901))
  assert.equal(cloudRow.rev, 1, 'cloud setlist 901 is at rev 1')

  // Setlist 901 with forged rev 101 and valid checksum
  const validData = { id: id(901), name: 'Setlist 901', songs: [{ id: id(1), title: 'Song 1' }, { id: id(2), title: 'Song 2' }] }
  const state = client.readRecordsSyncState(fresh)
  state.conflicts[0] = {
    kind: 'setlist',
    id: id(901),
    title: 'Setlist 901',
    dependency: true,
    note: 'missing-songs',
    remote: {
      kind: 'setlist',
      id: id(901),
      rev: 101, // forged revision
      removed: false,
      checksum: recordChecksum(false, validData),
      data: validData
    }
  }
  fresh.setItem('gtar_records_sync_v1', JSON.stringify(state))

  const res = await w.run(fresh)
  assert.notEqual(res.status, 'IN_SYNC', 'must not report false IN_SYNC')
  assert.equal(res.status, 'CONFLICT', 'must report actionable CONFLICT')
  assert.equal(read(fresh).setlists.some(l => l.id === id(901)), false, 'forged setlist not applied to library')
  assert.equal(client.readRecordsSyncState(fresh).known['setlist:' + id(901)], undefined, 'forged rev 101 not recorded in known')
  assert.equal(client.readRecordsSyncState(fresh).conflicts.length, 1, 'conflict preserved')
})

test('F2: Download Cloud rejects forged integer revision and detects remote changed between validation and mutation', async () => {
  const { w, a, fresh } = await heldSetlistWorld()
  await w.run(a)
  assert.equal((await w.run(a, { forceAction: 'upload' })).success, true)

  const validData = { id: id(901), name: 'Setlist 901', songs: [{ id: id(1), title: 'Song 1' }, { id: id(2), title: 'Song 2' }] }
  const state = client.readRecordsSyncState(fresh)
  state.conflicts[0] = {
    kind: 'setlist',
    id: id(901),
    title: 'Setlist 901',
    dependency: true,
    note: 'missing-songs',
    remote: {
      kind: 'setlist',
      id: id(901),
      rev: 101, // forged revision
      removed: false,
      checksum: recordChecksum(false, validData),
      data: validData
    }
  }
  fresh.setItem('gtar_records_sync_v1', JSON.stringify(state))

  const res = await w.run(fresh, { forceAction: 'download' })
  assert.equal(res.success, false)
  assert.equal(res.status, 'CONFLICT')
  // Conflict remote updated with the real authoritative record (rev 1)
  const updatedConflict = client.readRecordsSyncState(fresh).conflicts[0]
  assert.equal(updatedConflict.remote.rev, 1, 'remote updated with authoritative server revision')
  assert.equal(read(fresh).setlists.some(l => l.id === id(901)), false, 'stale/forged snapshot not applied')
})

test('F1 & F2: repeated retries preserve actionable conflicts and original data', async () => {
  const { w, a, fresh } = await heldSetlistWorld()
  await w.run(a)
  assert.equal((await w.run(a, { forceAction: 'upload' })).success, true)

  const malformedData = { id: id(999), name: 'Setlist 999', songs: [{ id: id(1), title: 'Song 1' }] }
  const state = client.readRecordsSyncState(fresh)
  state.conflicts[0] = {
    kind: 'setlist',
    id: id(901),
    title: 'Setlist 901',
    dependency: true,
    note: 'missing-songs',
    remote: {
      kind: 'setlist',
      id: id(999),
      rev: 2,
      removed: false,
      checksum: recordChecksum(false, malformedData),
      data: malformedData
    }
  }
  fresh.setItem('gtar_records_sync_v1', JSON.stringify(state))

  for (let i = 0; i < 3; i++) {
    const res = await w.run(fresh, { forceAction: 'download' })
    assert.equal(res.success, false, `retry ${i} must fail`)
    assert.equal(res.status, 'CONFLICT', `retry ${i} must be CONFLICT`)
    assert.equal(client.readRecordsSyncState(fresh).conflicts.length, 1, `conflict kept on retry ${i}`)
    assert.equal(client.readRecordsSyncState(fresh).conflicts[0].id, id(901))
  }
})

test('mismatched canonical checksum in remote envelope is rejected from recovery', async () => {
  const { w, a, fresh } = await heldSetlistWorld()
  await w.run(a)
  assert.equal((await w.run(a, { forceAction: 'upload' })).success, true)

  const data = { id: id(901), name: 'Setlist 901', songs: [{ id: id(1), title: 'Song 1' }, { id: id(2), title: 'Song 2' }] }
  const state = client.readRecordsSyncState(fresh)
  state.conflicts[0] = {
    kind: 'setlist',
    id: id(901),
    title: 'Setlist 901',
    dependency: true,
    note: 'missing-songs',
    remote: {
      kind: 'setlist',
      id: id(901),
      rev: 2,
      removed: false,
      checksum: 'rk_badchecksum000000', // mismatched checksum
      data
    }
  }
  fresh.setItem('gtar_records_sync_v1', JSON.stringify(state))

  const res1 = await w.run(fresh)
  assert.equal(res1.status, 'CONFLICT')
  assert.equal(client.readRecordsSyncState(fresh).conflicts.length, 1)

  const res2 = await w.run(fresh, { forceAction: 'download' })
  assert.equal(res2.status, 'CONFLICT')
  assert.equal(client.readRecordsSyncState(fresh).conflicts.length, 1)
})

