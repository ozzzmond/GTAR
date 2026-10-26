const { bindOwner } = require('./helpers/libraryOwner.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }
).outputText, filename)
const { createSongbookSqlite } = require('./helpers/songbookSqlite.cjs')
const { upsertUserSongbook, findUserSongbook, createSessionToken } = require('../functions/lib/authCore.ts')
const api = require('../functions/api/songbook/sync.ts')
const sync = require('../src/utils/cloudSongbookSync.ts')
const { persistLibrary, readPersistedLibrary } = require('../src/utils/syncJournal.ts')
const { isValidUUID } = require('../src/utils/uuid.ts')

const S1 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const S2 = '0d9e1f22-6b43-4c0e-8a55-91c1c3f7d201'
const L1 = 'c9bf9e57-1685-4c89-bafb-ff5af830be8a'
const song = (id, rawContent, extra = {}) => ({ id, title: 'Song', rawContent, ...extra })
const lib = (songs, setlists = []) => ({ songs, setlists })
const rec = (reconciled) => reconciled.merged
const copies = (merged, id) => merged.songs.filter((s) => s.id !== id)

function storage() {
  const map = new Map()
  const store = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k),
    key: i => [...map.keys()][i] ?? null, get length() { return map.size } }
  bindOwner(store, 'user-a') // #247: devices in these tests belong to user-a
  return store
}
async function fixture() {
  const db = createSongbookSqlite()
  const user = { id: 'user-a', google_sub: 'sub-a', email: 'a@example.com', role: 'member', access_status: 'active' }
  const original = db.prepare.bind(db)
  db.prepare = sql => sql.includes('FROM users WHERE id = ?')
    ? { bind(id) { return { first: async () => id === user.id ? user : null } } } : original(sql)
  const env = { DB: db, AUTH_SECRET: 'g3-test-secret' }
  const token = await createSessionToken(user, env.AUTH_SECRET)
  const request = async (method, body) => api[method === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env,
    request: new Request('https://example.com/api/songbook/sync', { method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-GTAR-Library-Owner': user.id },
      ...(body ? { body: JSON.stringify(body) } : {}) }) })
  return { db, request }
}
const seedCloud = (db, data, expected) => upsertUserSongbook(db, 'user-a', JSON.stringify(data),
  sync.computeSongbookChecksum(data), '2026-10-10T00:00:00Z', expected)
function seedStorage(local, base) {
  const store = storage()
  persistLibrary(local, store)
  if (base) {
    sync.saveCloudSyncBase(base, store)
    sync.saveCloudSyncMeta({ lastSyncedChecksum: sync.computeSongbookChecksum(base), cloudVersion: 1,
      lastSyncedAt: 1, lastSyncedUserId: 'user-a' }, store)
  }
  return store
}
async function withFetch(fn, body) {
  const saved = global.fetch
  global.fetch = fn
  try { return await body() } finally { global.fetch = saved }
}
const cloudLib = async (db) => JSON.parse((await findUserSongbook(db, 'user-a')).data_json)

// G3A -------------------------------------------------------------------
test('G3A: copy IDs are deterministic valid UUIDs derived from source ID and revision, not names', () => {
  const base = lib([song(S1, 'base')])
  const run = () => rec(sync.reconcileSongbook(lib([song(S1, 'L')]), lib([song(S1, 'R')]), base))
  const [a, b] = [run(), run()]
  assert.equal(a.songs.length, 2)
  assert.equal(copies(a, S1)[0].id, copies(b, S1)[0].id)
  assert.ok(isValidUUID(copies(a, S1)[0].id))
  const other = rec(sync.reconcileSongbook(lib([song(S1, 'L')]), lib([song(S1, 'R2')]), base))
  assert.notEqual(copies(other, S1)[0].id, copies(a, S1)[0].id, 'different revision -> different copy identity')
  const renamed = rec(sync.reconcileSongbook(lib([song(S1, 'L')]), lib([song(S1, 'R', { title: 'Other' })]), base))
  assert.notEqual(copies(renamed, S1)[0].id, copies(a, S1)[0].id)
  assert.equal(a.songs.find((s) => s.id === S1).rawContent, 'L', 'both alternatives retained')
  assert.equal(copies(a, S1)[0].rawContent, 'R')
})
test('G3A: repeated reconciliation of identical unresolved conflict never manufactures more copies', () => {
  const base = lib([song(S1, 'base')])
  const remote = lib([song(S1, 'R')])
  let local = lib([song(S1, 'L')])
  for (let i = 0; i < 5; i++) local = rec(sync.reconcileSongbook(local, remote, base))
  assert.equal(local.songs.length, 2)
  // no-base replay too
  let nb = lib([song(S1, 'L')])
  for (let i = 0; i < 4; i++) nb = rec(sync.reconcileSongbook(nb, remote, null))
  assert.equal(nb.songs.length, 2)
})
test('G3A: user edits to an existing conflict copy are retained, not replaced', () => {
  const base = lib([song(S1, 'base')])
  const remote = lib([song(S1, 'R')])
  const first = rec(sync.reconcileSongbook(lib([song(S1, 'L')]), remote, base))
  const edited = lib(first.songs.map((s) => s.id === S1 ? s : { ...s, rawContent: 'user edited copy' }))
  const again = rec(sync.reconcileSongbook(edited, remote, base))
  assert.equal(again.songs.length, 2)
  assert.equal(copies(again, S1)[0].rawContent, 'user edited copy')
})
test('G3A: setlist conflict copies are idempotent with deterministic identity', () => {
  const baseSl = { id: L1, name: 'Set', songs: [{ id: S1, title: 'Song' }] }
  const base = lib([song(S1, 'x')], [baseSl])
  const remote = lib([song(S1, 'x')], [{ ...baseSl, name: 'Remote' }])
  let local = lib([song(S1, 'x')], [{ ...baseSl, name: 'Local' }])
  for (let i = 0; i < 4; i++) local = rec(sync.reconcileSongbook(local, remote, base))
  assert.equal(local.setlists.length, 2)
  assert.ok(isValidUUID(local.setlists.find((s) => s.id !== L1).id))
})
test('G3A: stale-base replay, lost ack and retry via real sync do not grow copies; 409 keeps CAS', async () => {
  const { db, request } = await fixture()
  const base = lib([song(S1, 'base')])
  const cloud = lib([song(S1, 'R')])
  const first = await seedCloud(db, base, { version: 0, checksum: null })
  assert.equal(first.version, 1)
  await seedCloud(db, cloud, { version: first.version, checksum: first.checksum })
  const local = lib([song(S1, 'L')])
  const fetcher = (url, opts) => request(opts.method, opts.body ? JSON.parse(opts.body) : undefined)
  await withFetch(fetcher, async () => {
    const r1 = await sync.performCloudSongbookSync('t', { storage: seedStorage(local, base), forceAction: 'merge_preserve' })
    assert.equal(r1.success, true)
    assert.equal(r1.conflicts.length, 1)
    // lost acknowledgement: device never recorded the result; replays with the same stale base/local
    for (let i = 0; i < 3; i++) {
      const r = await sync.performCloudSongbookSync('t', { storage: seedStorage(local, base), forceAction: 'merge_preserve' })
      assert.equal(r.success, true)
    }
    assert.equal((await cloudLib(db)).songs.length, 2)
  })
  // stale CAS write is still rejected at the HTTP layer
  const stale = await request('POST', { data: local, expectedVersion: first.version, expectedChecksum: first.checksum })
  assert.equal(stale.status, 409)
  assert.equal((await cloudLib(db)).songs.length, 2)
})
test('G3A: reload and third-device reconciliation converge without extra copies', async () => {
  const base = lib([song(S1, 'base')])
  const deviceA = rec(sync.reconcileSongbook(lib([song(S1, 'A')]), lib([song(S1, 'B')]), base))
  const deviceC = rec(sync.reconcileSongbook(lib([song(S1, 'C')]), deviceA, base))
  const again = rec(sync.reconcileSongbook(deviceC, deviceA, base))
  assert.equal(again.songs.length, deviceC.songs.length)
  assert.deepEqual(again.songs.map((s) => s.id).sort(), deviceC.songs.map((s) => s.id).sort())
  // reload: persisted copy round-trips through storage unchanged
  const store = storage()
  persistLibrary(deviceC, store)
  assert.equal(readPersistedLibrary(store).songs.length, deviceC.songs.length)
})

// G3B -------------------------------------------------------------------
const delEdit = (kind) => {
  const base = lib([song(S1, 'base')])
  const deleted = lib([song(S1, 'base', { isDeleted: true })])
  const edited = lib([song(S1, 'edited')])
  return kind === 'localDelete'
    ? sync.reconcileSongbook(deleted, edited, base) : sync.reconcileSongbook(edited, deleted, base)
}
test('G3B: local-delete/remote-edit and local-edit/remote-delete are symmetric and non-destructive', () => {
  for (const kind of ['localDelete', 'localEdit']) {
    const r = delEdit(kind)
    assert.equal(r.hasConflicts, true, kind)
    assert.equal(r.merged.songs.length, 2, kind)
    assert.equal(r.merged.songs.find((s) => s.id === S1).isDeleted, true, `${kind}: deletion intent retained`)
    const copy = copies(r.merged, S1)[0]
    assert.equal(copy.rawContent, 'edited', `${kind}: edit preserved`)
    assert.equal(copy.isDeleted, false)
  }
  assert.equal(copies(delEdit('localDelete').merged, S1)[0].id, copies(delEdit('localEdit').merged, S1)[0].id,
    'same revision -> same copy identity in both directions')
})
test('G3B: delete/edit without a common base still never resurrects or discards', () => {
  for (const [l, r] of [[song(S1, 'x', { isDeleted: true }), song(S1, 'edited')], [song(S1, 'edited'), song(S1, 'x', { isDeleted: true })]]) {
    const res = sync.reconcileSongbook(lib([l]), lib([r]), null)
    assert.equal(res.hasConflicts, true)
    assert.equal(res.merged.songs.find((s) => s.id === S1).isDeleted, true)
    assert.equal(copies(res.merged, S1).filter((s) => s.rawContent === 'edited' && !s.isDeleted).length, 1)
  }
})
test('G3B: delete/edit resolution is idempotent on repeat and from stale device', () => {
  const base = lib([song(S1, 'base')])
  const deleted = lib([song(S1, 'base', { isDeleted: true })])
  const edited = lib([song(S1, 'edited')])
  let local = deleted
  for (let i = 0; i < 4; i++) local = rec(sync.reconcileSongbook(local, edited, base))
  assert.equal(local.songs.length, 2)
  let stale = edited
  for (let i = 0; i < 4; i++) stale = rec(sync.reconcileSongbook(stale, deleted, base))
  assert.equal(stale.songs.length, 2)
})
test('G3B: both deleted with differing contents stays one tombstone, direction independent', () => {
  const base = lib([song(S1, 'base')])
  const a = lib([song(S1, 'A', { isDeleted: true })])
  const b = lib([song(S1, 'B', { isDeleted: true })])
  const ab = sync.reconcileSongbook(a, b, base)
  const ba = sync.reconcileSongbook(b, a, base)
  assert.equal(ab.hasConflicts, false)
  assert.equal(ab.merged.songs.length, 1)
  assert.equal(ab.merged.songs[0].isDeleted, true)
  assert.deepEqual(ab.merged.songs, ba.merged.songs)
})
test('G3B: setlist delete/edit is symmetric', () => {
  const baseSl = { id: L1, name: 'Set', songs: [] }
  const base = lib([], [baseSl])
  const deleted = lib([], [{ ...baseSl, isDeleted: true }])
  const edited = lib([], [{ ...baseSl, name: 'Edited' }])
  for (const r of [sync.reconcileSongbook(deleted, edited, base), sync.reconcileSongbook(edited, deleted, base)]) {
    assert.equal(r.hasConflicts, true)
    assert.equal(r.merged.setlists.find((s) => s.id === L1).isDeleted, true)
    const copy = r.merged.setlists.find((s) => s.id !== L1)
    assert.ok(copy && copy.isDeleted === false && copy.name.startsWith('Edited'))
  }
})

// G3C -------------------------------------------------------------------
test('G3C: remote-modified setlist rebinds to the remote chart revision, preserving order and metadata', () => {
  const baseSl = { id: L1, name: 'Set', songs: [{ id: S2, title: 'Two' }, { id: S1, title: 'Song', artist: 'Art' }] }
  const base = lib([song(S1, 'base'), song(S2, 'two')], [baseSl])
  const localLib = lib([song(S1, 'L'), song(S2, 'two')], [baseSl])
  const remoteLib = lib([song(S1, 'R'), song(S2, 'two')], [{ ...baseSl, name: 'Remote Set' }])
  const r = sync.reconcileSongbook(localLib, remoteLib, base)
  const copy = r.merged.songs.find((s) => s.id !== S1 && s.id !== S2)
  assert.equal(copy.rawContent, 'R')
  const sl = r.merged.setlists.find((s) => s.id === L1)
  assert.equal(sl.name, 'Remote Set')
  assert.deepEqual(sl.songs.map((x) => x.id), [S2, copy.id], 'order kept; chart bound to remote revision')
  assert.equal(sl.songs[1].artist, 'Art', 'metadata preserved')
  assert.equal(r.merged.songs.find((s) => s.id === S1).rawContent, 'L', 'local chart retained, distinct version')
})
test('G3C: local setlist keeps local chart; remote copy of setlist binds to remote chart', () => {
  const baseSl = { id: L1, name: 'Set', songs: [{ id: S1, title: 'Song' }] }
  const base = lib([song(S1, 'base')], [baseSl])
  const r = sync.reconcileSongbook(
    lib([song(S1, 'L')], [{ ...baseSl, name: 'Local' }]),
    lib([song(S1, 'R')], [{ ...baseSl, name: 'Remote' }]), base)
  const copySong = r.merged.songs.find((s) => s.id !== S1)
  const keptLocal = r.merged.setlists.find((s) => s.id === L1)
  const copySl = r.merged.setlists.find((s) => s.id !== L1)
  assert.equal(keptLocal.songs[0].id, S1)
  assert.equal(copySl.songs[0].id, copySong.id)
  assert.equal(sync.computeSongbookChecksum(r.merged) !== '', true)
})
test('G3C: local-edit/remote-delete rebinds local setlist to the preserved local chart', () => {
  const baseSl = { id: L1, name: 'Set', songs: [{ id: S1, title: 'Song' }] }
  const base = lib([song(S1, 'base')], [baseSl])
  const r = sync.reconcileSongbook(
    lib([song(S1, 'edited')], [{ ...baseSl, name: 'Local' }]),
    lib([song(S1, 'base', { isDeleted: true })], [baseSl]), base)
  const copy = r.merged.songs.find((s) => s.id !== S1)
  assert.equal(r.merged.setlists.find((s) => s.id === L1).songs[0].id, copy.id)
})
test('G3C: id-less and title-only references are never guessed or rebound', () => {
  const baseSl = { id: L1, name: 'Set', songs: [{ title: 'Song', artist: '' }, { id: S1, title: 'Song' }] }
  const base = lib([song(S1, 'base')], [baseSl])
  const r = sync.reconcileSongbook(
    lib([song(S1, 'L')], [baseSl]),
    lib([song(S1, 'R')], [{ ...baseSl, name: 'Remote' }]), base)
  const sl = r.merged.setlists.find((s) => s.id === L1)
  assert.equal(sl.songs[0].id, undefined)
  assert.equal(sl.songs[0].title, 'Song')
})
test('G3C: repeated setlist reconciliation after rebinding is stable (no ping-pong, order kept)', () => {
  const baseSl = { id: L1, name: 'Set', songs: [{ id: S2, title: 'Two' }, { id: S1, title: 'Song' }] }
  const base = lib([song(S1, 'base'), song(S2, 'two')], [baseSl])
  const remote = lib([song(S1, 'R'), song(S2, 'two')], [{ ...baseSl, name: 'Remote Set' }])
  let local = lib([song(S1, 'L'), song(S2, 'two')], [baseSl])
  local = rec(sync.reconcileSongbook(local, remote, base))
  const snapshot = JSON.stringify(local)
  const next = rec(sync.reconcileSongbook(local, remote, base))
  assert.equal(next.songs.length, local.songs.length)
  assert.equal(next.setlists.length, local.setlists.length)
  assert.deepEqual(next.setlists[0].songs.map((x) => x.id), local.setlists[0].songs.map((x) => x.id))
  assert.equal(JSON.stringify(local), snapshot)
})
test('G3C: merged library keeps integrity, legacy fields and ordered playback data', () => {
  const { validateSongbookIntegrity } = require('../src/utils/songbookFoundation.ts')
  const baseSl = { id: L1, name: 'Set', songs: [{ id: S2, title: 'Two' }, { id: S1, title: 'Song' }] }
  const base = lib([song(S1, 'base'), song(S2, 'two')], [baseSl])
  const r = sync.reconcileSongbook(
    lib([song(S1, 'L'), song(S2, 'two')], [baseSl]),
    lib([song(S1, 'R'), song(S2, 'two')], [{ ...baseSl, name: 'Remote Set' }]), base)
  assert.equal(validateSongbookIntegrity(r.merged.songs, r.merged.setlists).isValid, true)
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(r.merged))), JSON.stringify(r.merged), 'export/QR serializable')
  for (const sl of r.merged.setlists) assert.ok(Array.isArray(sl.songs), 'legacy ordered songs kept')
})

// G3 failure safety ------------------------------------------------------
test('G3: cross-tab change during sync is preserved and recovery snapshot is written before merge upload', async () => {
  const { db, request } = await fixture()
  const base = lib([song(S1, 'base')])
  const first = await seedCloud(db, base, { version: 0, checksum: null })
  await seedCloud(db, lib([song(S1, 'R')]), { version: first.version, checksum: first.checksum })
  const store = seedStorage(lib([song(S1, 'L')]), base)
  await withFetch((url, opts) => {
    if (opts.method === 'POST') persistLibrary(lib([song(S1, 'L'), song(S2, 'tab2')]), store)
    return request(opts.method, opts.body ? JSON.parse(opts.body) : undefined)
  }, async () => {
    const r = await sync.performCloudSongbookSync('t', { storage: store, forceAction: 'merge_preserve' })
    assert.equal(typeof r.success, 'boolean')
  })
  const local = readPersistedLibrary(store)
  assert.ok(local.songs.some((s) => s.id === S2 && s.rawContent === 'tab2'), 'other-tab edit preserved')
  let recovery = 0
  for (let i = 0; i < store.length; i++) if (store.key(i).startsWith('gtar_sync_recovery:')) recovery++
  assert.ok(recovery >= 1)
})
test('G3: storage quota failure on recovery snapshot blocks merge and preserves local data', async () => {
  const { db, request } = await fixture()
  const base = lib([song(S1, 'base')])
  const first = await seedCloud(db, base, { version: 0, checksum: null })
  const cloud = await seedCloud(db, lib([song(S1, 'R')]), { version: first.version, checksum: first.checksum })
  const store = seedStorage(lib([song(S1, 'L')]), base)
  const realSet = store.setItem
  store.setItem = (k, v) => { if (k.startsWith('gtar_sync_recovery:')) throw new Error('QuotaExceededError'); realSet(k, v) }
  let posts = 0
  await withFetch((url, opts) => { if (opts.method === 'POST') posts++; return request(opts.method, opts.body ? JSON.parse(opts.body) : undefined) }, async () => {
    const r = await sync.performCloudSongbookSync('t', { storage: store, forceAction: 'merge_preserve' })
    assert.equal(r.success, false)
  })
  assert.equal(posts, 0, 'no upload without durable recovery')
  assert.equal(readPersistedLibrary(store).songs[0].rawContent, 'L')
  assert.equal((await findUserSongbook(db, 'user-a')).version, cloud.version)
})
