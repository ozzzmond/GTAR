// #247 (P0): one browser, two accounts. The origin-wide personal library must never be uploaded,
// published or mutated under an account that does not own it.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('', { url: 'https://dev.gtar-web.pages.dev' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage })
Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent: 'GTAR test', locks: { request: async (_name, action) => (typeof action === 'function' ? action() : typeof _name === 'function' ? _name() : undefined) } } })
const { createSongbookSqlite } = require('./helpers/songbookSqlite.cjs')
const { createSessionToken } = require('../functions/lib/authCore.ts')
const recordsApi = require('../functions/api/songbook/records.ts')
const syncApi = require('../functions/api/songbook/sync.ts')
const journal = require('../src/utils/syncJournal.ts')
const client = require('../src/utils/recordsSync.ts')
const owner = require('../src/utils/libraryOwner.ts')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const song = n => ({ id: id(n), title: `Song ${n}`, artist: 'A', rawContent: `[G]Line ${n}` })
const libA = { songs: [song(1), song(2), song(3)], setlists: [{ id: id(901), name: 'A set', songs: [{ id: id(1), title: 'Song 1', artist: 'A' }] }] }
function storage() {
  const map = new Map()
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k),
    key: i => [...map.keys()][i] ?? null, get length() { return map.size } }
}

async function cloud() {
  const db = createSongbookSqlite()
  const users = {
    a: { id: 'user-a', google_sub: 'sub-a', email: 'a@example.com', role: 'member', access_status: 'active' },
    b: { id: 'user-b', google_sub: 'sub-b', email: 'b@example.com', role: 'member', access_status: 'active' },
  }
  const original = db.prepare.bind(db)
  db.prepare = sql => sql.includes('FROM users WHERE id = ?')
    ? { sql, bound: [], bind(x) { return { first: async () => Object.values(users).find(u => u.id === x) ?? null } } } : original(sql)
  const env = { DB: db, AUTH_SECRET: 'cross-account-secret', SONGBOOK_RECORDS_SYNC: 'records-v1' }
  const tokens = { a: await createSessionToken(users.a, env.AUTH_SECRET), b: await createSessionToken(users.b, env.AUTH_SECRET) }
  let hook = null
  let after = null
  const fetch = async (url, opts = {}) => {
    if (hook) await hook(url, opts)
    const target = url.startsWith('/api/songbook/records') ? recordsApi : syncApi
    const method = opts.method || 'GET'
    const response = await target[method === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env, request: new Request(`https://example.com${url}`, {
      method, headers: opts.headers || {}, ...(opts.body ? { body: opts.body } : {}) }) })
    if (after) await after(url, opts, response) // server work done; the response is not yet delivered
    return response
  }
  const as = who => async (store, options = {}) => {
    const saved = global.fetch
    global.fetch = fetch
    const hadSession = localStorage.getItem('gtar_auth_session') !== null
    if (!hadSession && !options.noSession) {
      localStorage.setItem('gtar_auth_session', JSON.stringify({ user: { id: `user-${who}` }, sessionToken: tokens[who] }))
    }
    try { return await client.performRecordsSync(tokens[who], { storage: store, ...options }) }
    finally {
      if (!hadSession && !options.noSession) {
        localStorage.removeItem('gtar_auth_session')
      }
      global.fetch = saved
    }
  }
  const songsOf = userId => db.sqlite.prepare("SELECT record_id FROM user_songbook_records WHERE user_id = ? AND kind = 'song' AND removed = 0").all(userId).map(r => r.record_id)
  const recordsOf = userId => db.sqlite.prepare('SELECT count(*) AS n FROM user_songbook_records WHERE user_id = ?').get(userId).n
  return { db, a: as('a'), b: as('b'), songsOf, recordsOf, setHook: h => { hook = h }, setAfter: h => { after = h }, tokens, env, fetch }
}
const device = lib => { const s = storage(); journal.persistLibrary(lib, s); return s }
const read = store => journal.readPersistedLibrary(store)

test('#247 repro: A syncs, the same browser signs in as empty B → none of A\'s records reach B', async () => {
  const c = await cloud()
  const browser = device(libA)
  await owner.confirmLibraryOwner('user-a', browser) // A's device, linked to A
  assert.equal((await c.a(browser)).success, true)
  assert.equal(c.songsOf('user-a').length, 3)
  const asB = await c.b(browser)
  assert.equal(c.recordsOf('user-b'), 0, 'no record of A uploaded into B')
  assert.notEqual(asB.success, true)
  assert.deepEqual(read(browser), libA, 'A\'s library untouched on the device')
})

const ownerOf = store => owner.readLibraryOwner(store)?.userId ?? null
const bound = (lib, who) => { const s = device(lib); s.setItem(owner.LIBRARY_OWNER_KEY, JSON.stringify({ v: 1, userId: who, env: owner.libraryEnv(), boundAt: 0, reason: 'confirmed' })); return s }

test('#247: an empty, unlinked device is linked to the first account that syncs on it (nothing to leak)', async () => {
  const c = await cloud()
  const seedA = device(libA); await owner.confirmLibraryOwner('user-a', seedA); await c.a(seedA)
  const fresh = device({ songs: [], setlists: [] })
  const result = await c.a(fresh)
  assert.equal(result.success, true, result.error)
  assert.equal(ownerOf(fresh), 'user-a')
  assert.equal(JSON.parse(fresh.getItem(owner.LIBRARY_OWNER_KEY)).reason, 'empty-library')
  assert.equal(read(fresh).songs.length, 3, 'A\'s cloud library downloaded')
})

test('#247: populated B — a device owned by A neither uploads to B nor takes B\'s songs', async () => {
  const c = await cloud()
  const deviceB = device({ songs: [], setlists: [] })
  await c.b(deviceB) // links to B
  const libB = { songs: [{ id: id(50), title: 'B song', artist: 'B', rawContent: '[C]b' }], setlists: [] }
  journal.persistLibrary(libB, deviceB, { expectedRaw: journal.libraryRevision(deviceB) })
  await c.b(deviceB)
  assert.deepEqual(c.songsOf('user-b'), [id(50)])
  const deviceA = bound(libA, 'user-a')
  const result = await c.b(deviceA)
  assert.equal(result.ownership, 'mismatch')
  assert.deepEqual(c.songsOf('user-b'), [id(50)], 'B unchanged')
  assert.deepEqual(read(deviceA), libA, 'A unchanged, B\'s song not applied')
})

test('#247: B → A — a device owned by B does not upload to A', async () => {
  const c = await cloud()
  const deviceB = device({ songs: [], setlists: [] })
  await c.b(deviceB)
  journal.persistLibrary({ songs: [song(7)], setlists: [] }, deviceB, { expectedRaw: journal.libraryRevision(deviceB) })
  await c.b(deviceB)
  const asA = await c.a(deviceB)
  assert.equal(asA.ownership, 'mismatch')
  assert.equal(c.recordsOf('user-a'), 0)
  assert.equal(ownerOf(deviceB), 'user-b')
})

test('#247: unknown legacy owner fails closed; explicit link saves a verified recovery copy first, then syncs', async () => {
  const c = await cloud()
  const legacy = device(libA) // older build: content, no owner
  const blocked = await c.a(legacy)
  assert.equal(blocked.ownership, 'unbound')
  assert.equal(c.recordsOf('user-a'), 0, 'nothing uploaded before the explicit link')
  assert.equal(ownerOf(legacy), null, 'not inferred')
  await owner.confirmLibraryOwner('user-a', legacy)
  const copies = Object.entries(journal.recoveryData(legacy)).filter(([k]) => k.startsWith('gtar_sync_recovery:owner-confirm:'))
  assert.equal(copies.length, 1)
  assert.deepEqual(JSON.parse(copies[0][1]).local, libA, 'full copy preserved')
  assert.equal((await c.a(legacy)).success, true)
  assert.equal(c.songsOf('user-a').length, 3)
})

test('#247: last-synced metadata alone never establishes ownership', async () => {
  const c = await cloud()
  const legacy = device(libA)
  legacy.setItem('gtar_records_sync_v1', JSON.stringify({ v: 1, userId: 'user-a', cursor: 0, known: {}, conflicts: [] }))
  const result = await c.a(legacy)
  assert.equal(result.ownership, 'unbound')
  assert.equal(c.recordsOf('user-a'), 0)
})

test('#247: reload — ownership survives and still blocks; offline — nothing changes', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a')
  const reloaded = storage(); for (let i = 0; i < deviceA.length; i++) { const k = deviceA.key(i); reloaded.setItem(k, deviceA.getItem(k)) }
  assert.equal((await c.b(reloaded)).ownership, 'mismatch')
  c.setHook(async () => { throw new TypeError('Failed to fetch') })
  const offline = await c.a(deviceA)
  c.setHook(null)
  assert.equal(offline.status, 'OFFLINE')
  assert.deepEqual(read(deviceA), libA)
  assert.equal(ownerOf(deviceA), 'user-a')
})

test('#247: switch during async work — a round whose library changed hands mid-flight writes and uploads nothing', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a')
  await c.a(deviceA)
  journal.persistLibrary({ ...libA, songs: [...libA.songs, song(4)] }, deviceA, { expectedRaw: journal.libraryRevision(deviceA) })
  c.setHook(async (url, opts) => {
    // While A's round waits on the network, the library is linked to B (e.g. in another tab).
    if ((opts.method || 'GET') === 'GET') deviceA.setItem(owner.LIBRARY_OWNER_KEY, JSON.stringify({ v: 1, userId: 'user-b', env: owner.libraryEnv(), boundAt: 1, reason: 'confirmed' }))
  })
  const result = await c.a(deviceA)
  c.setHook(null)
  assert.equal(result.ownership, 'mismatch')
  assert.ok(!c.songsOf('user-a').includes(id(4)), 'stale round uploaded nothing')
  assert.equal(c.recordsOf('user-b'), 0)
})

test('#247: conflict resolution and Replace with the cloud copy are refused for another account', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a')
  await c.a(deviceA)
  const state = client.readRecordsSyncState(deviceA)
  deviceA.setItem('gtar_records_sync_v1', JSON.stringify({ ...state, conflicts: [{ kind: 'song', id: id(1), title: 'Song 1', remote: null }] }))
  const keep = await c.b(deviceA, { forceAction: 'upload' })
  assert.equal(keep.ownership, 'mismatch')
  const replace = await c.b(deviceA, { forceAction: 'download' })
  assert.equal(replace.ownership, 'mismatch')
  assert.equal(c.recordsOf('user-b'), 0)
  assert.deepEqual(read(deviceA), libA)
})

test('#247: Classic sync refuses another account (no merge, no upload)', async () => {
  const c = await cloud()
  const sync = require('../src/utils/cloudSongbookSync.ts')
  const deviceA = bound(libA, 'user-a')
  const saved = global.fetch
  let posts = 0
  global.fetch = async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'POST') posts++
    return syncApi[(opts.method || 'GET') === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env: c.env, request: new Request(`https://example.com${url}`, { method: opts.method || 'GET', headers: opts.headers || {}, ...(opts.body ? { body: opts.body } : {}) }) })
  }
  try {
    const result = await sync.performCloudSongbookSync(c.tokens.b, { storage: deviceA })
    assert.equal(result.ownership, 'mismatch')
  } finally { global.fetch = saved }
  assert.equal(posts, 0)
  assert.equal(c.db.sqlite.prepare("SELECT count(*) AS n FROM user_songbooks WHERE user_id = 'user-b'").get().n, 0)
  assert.deepEqual(read(deviceA), libA)
})

test('#247: shared publication and QR share are blocked when the session is not the library owner', () => {
  const { SESSION_STORAGE_KEY } = require('../src/utils/googleAuth.ts')
  const catalog = require('../src/utils/sharedCatalogClient.ts')
  localStorage.clear()
  journal.persistLibrary(libA, localStorage)
  localStorage.setItem(owner.LIBRARY_OWNER_KEY, JSON.stringify({ v: 1, userId: 'user-a', env: owner.libraryEnv(), boundAt: 0, reason: 'confirmed' }))
  const sessionFor = who => localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ version: 1, user: { id: who, sub: who, email: `${who}@x`, role: 'member', access_status: 'active', email_verified: true },
    authenticatedAt: Date.now(), lastVerifiedAt: Date.now(), localExpiresAt: Date.now() + 3600000, expiresAt: Date.now() + 3600000, sessionToken: `t-${who}`, role: 'member', access_status: 'active' }))
  sessionFor('user-b')
  assert.throws(() => catalog.assertPublishFromOwnLibrary(), err => err.code === 'LIBRARY_OWNER')
  assert.match(owner.personalContentBlockReason('user-b'), /belongs to another GTAR account/, 'QR share blocked')
  sessionFor('user-a')
  assert.doesNotThrow(() => catalog.assertPublishFromOwnLibrary())
  assert.equal(owner.personalContentBlockReason('user-a'), null)
  localStorage.clear()
})

// ---- #247 audit of PR #248 (head 89943dc): F1–F3 ----
const sessionKey = 'gtar_auth_session'
const setSession = who => localStorage.setItem(sessionKey, JSON.stringify({ user: { id: who } }))

test('#247 F1: a Classic upload without the owner capability (older builds) is refused; nothing reaches B', async () => {
  const c = await cloud()
  const legacyPost = await syncApi.onRequestPost({ env: c.env, request: new Request('https://example.com/api/songbook/sync', { method: 'POST',
    headers: { Authorization: `Bearer ${c.tokens.b}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: libA, checksum: require('../src/utils/cloudSongbookSync.ts').computeSongbookChecksum(libA), expectedVersion: 0, expectedChecksum: null }) }) })
  assert.equal(legacyPost.status, 409)
  assert.equal((await legacyPost.json()).code, 'LIBRARY_OWNER_REQUIRED')
  assert.equal(c.db.sqlite.prepare("SELECT count(*) AS n FROM user_songbooks WHERE user_id = 'user-b'").get().n, 0, 'B has no classic songbook')
  assert.equal((await c.b(device({ songs: [], setlists: [] }))).success, true)
  assert.equal(c.recordsOf('user-b'), 0, 'nothing seeded into B records')
})

test('#247 F2: concurrent link confirmations — a stale one cannot replace the owner saved meanwhile', async () => {
  const c = await cloud()
  const legacy = device(libA)
  const original = journal.writeRecoverySnapshot
  let release, paused = new Promise(r => { release = r }), first = true
  journal.writeRecoverySnapshot = async (...args) => { if (first) { first = false; await paused } return original(...args) }
  let staleA
  try {
    staleA = owner.confirmLibraryOwner('user-a', legacy).then(() => 'linked', e => e.message)
    await owner.confirmLibraryOwner('user-b', legacy) // B confirms and saves while A is paused
    release()
  } finally { journal.writeRecoverySnapshot = original }
  assert.match(await staleA, /changed/)
  assert.equal(owner.readLibraryOwner(legacy).userId, 'user-b', 'B owner kept')
  const asA = await c.a(legacy)
  assert.equal(asA.ownership, 'mismatch')
  assert.equal(c.recordsOf('user-a'), 0, 'A uploads nothing')
})

test('#247 F3: a Classic download paused at its recovery write does not apply after a switch to B', async () => {
  const c = await cloud()
  const sync = require('../src/utils/cloudSongbookSync.ts')
  const deviceA = bound({ songs: [song(1)], setlists: [] }, 'user-a')
  // A's classic cloud has more songs than the device.
  const cloudA = { songs: [song(1), song(2), song(3)], setlists: [] }
  await require('../functions/lib/authCore.ts').upsertUserSongbook(c.db, 'user-a', JSON.stringify(cloudA), sync.computeSongbookChecksum(cloudA), '2026-10-26T00:00:00Z', { version: 0, checksum: null })
  setSession('user-a')
  const original = journal.writeRecoverySnapshot
  journal.writeRecoverySnapshot = async (...args) => { setSession('user-b'); return original(...args) } // switch while the write is awaited
  const saved = global.fetch
  global.fetch = async (url, opts = {}) => syncApi[(opts.method || 'GET') === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env: c.env,
    request: new Request(`https://example.com${url}`, { method: opts.method || 'GET', headers: opts.headers || {}, ...(opts.body ? { body: opts.body } : {}) }) })
  let result
  try { result = await sync.performCloudSongbookSync(c.tokens.a, { storage: deviceA, forceAction: 'download' }) }
  finally { global.fetch = saved; journal.writeRecoverySnapshot = original; localStorage.removeItem(sessionKey) }
  assert.notEqual(result.status, 'IN_SYNC')
  assert.deepEqual(read(deviceA).songs.map(s => s.id), [id(1)], 'nothing applied after the switch')
})

test('#247 F3 (records): a session switch while a per-record round waits on the network stops its apply and upload', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a')
  await c.a(deviceA)
  // Another device of A adds a song; this device edits locally too.
  const other = bound(libA, 'user-a'); await c.a(other)
  journal.persistLibrary({ ...libA, songs: [...libA.songs, song(8)] }, other, { expectedRaw: journal.libraryRevision(other) }); await c.a(other)
  journal.persistLibrary({ ...libA, songs: [...libA.songs, song(9)] }, deviceA, { expectedRaw: journal.libraryRevision(deviceA) })
  setSession('user-a')
  c.setHook(async (url, opts) => { if ((opts.method || 'GET') === 'GET') setSession('user-b') })
  let result
  try { result = await c.a(deviceA) } finally { c.setHook(null); localStorage.removeItem(sessionKey) }
  assert.equal(result.ownership, 'mismatch')
  assert.ok(!read(deviceA).songs.some(s => s.id === id(8)), 'cloud change not applied')
  assert.ok(!c.songsOf('user-a').includes(id(9)), 'local change not uploaded')
  // Back on A, the same device syncs normally.
  setSession('user-a')
  try { assert.equal((await c.a(deviceA)).success, true) } finally { localStorage.removeItem(sessionKey) }
  assert.ok(c.songsOf('user-a').includes(id(9)))
})

// ---- #247 re-audit of PR #248 (head 7e8bd32): F3 late Records response ----
const snapshot = store => { const out = {}; for (let i = 0; i < store.length; i++) { const k = store.key(i); out[k] = store.getItem(k) } return out }

test('#247 F3 late response: session switches A→B while A\'s upload response is in flight → no IN_SYNC, no metadata, device untouched', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a')
  setSession('user-a')
  try {
    assert.equal((await c.a(deviceA)).success, true)
    journal.persistLibrary({ ...libA, songs: [...libA.songs, song(11)] }, deviceA, { expectedRaw: journal.libraryRevision(deviceA) })
    let before = null
    c.setAfter(async (url, opts) => {
      if ((opts.method || 'GET') !== 'POST' || !url.startsWith('/api/songbook/records')) return
      setSession('user-b') // the server accepted A's upload; the browser is now signed in as B
      before = snapshot(deviceA)
    })
    let result
    try { result = await c.a(deviceA) } finally { c.setAfter(null) }
    assert.ok(before, 'upload response was intercepted')
    assert.equal(result.success, false)
    assert.notEqual(result.status, 'IN_SYNC')
    assert.equal(result.ownership, 'mismatch')
    assert.match(result.error, /already accepted by the cloud stay in the account that started/)
    assert.doesNotMatch(result.error, /Nothing was uploaded/)
    assert.deepEqual(snapshot(deviceA), before, 'no sync state, metadata, base or library written after the switch')
    assert.ok(c.songsOf('user-a').includes(id(11)), 'the accepted upload is reported honestly: it stays in A')
    assert.equal(c.recordsOf('user-b'), 0)
    // Back on A: retry reconciles safely.
    setSession('user-a')
    const again = await c.a(deviceA)
    assert.equal(again.success, true)
    assert.equal(again.status, 'IN_SYNC')
    assert.deepEqual(read(deviceA).songs.map(s => s.id).sort(), [...libA.songs.map(s => s.id), id(11)].sort())
  } finally { localStorage.removeItem(sessionKey) }
})

test('#247 F3 late response: library linked to B (with B\'s songs) while A\'s upload response is in flight → B library and context untouched', async () => {
  const c = await cloud()
  const store = bound(libA, 'user-a')
  assert.equal((await c.a(store)).success, true)
  journal.persistLibrary({ ...libA, songs: [...libA.songs, song(12)] }, store, { expectedRaw: journal.libraryRevision(store) })
  const libB = { songs: [song(50)], setlists: [] }
  let before = null
  c.setAfter(async (url, opts) => {
    if ((opts.method || 'GET') !== 'POST' || !url.startsWith('/api/songbook/records')) return
    // Another tab hands the device to B: B's library and owner replace A's.
    journal.persistLibrary(libB, store, { expectedRaw: journal.libraryRevision(store) })
    store.setItem(owner.LIBRARY_OWNER_KEY, JSON.stringify({ v: 1, userId: 'user-b', env: owner.libraryEnv(), boundAt: 2, reason: 'confirmed' }))
    before = snapshot(store)
  })
  let result
  try { result = await c.a(store) } finally { c.setAfter(null) }
  assert.ok(before)
  assert.equal(result.success, false)
  assert.notEqual(result.status, 'IN_SYNC')
  assert.equal(result.ownership, 'mismatch')
  assert.deepEqual(snapshot(store), before, 'no A completion metadata or base written into B\'s context')
  assert.deepEqual(read(store).songs.map(s => s.id), [id(50)])
  assert.equal(c.recordsOf('user-b'), 0)
})

test('#247 F3 late response: conflict resolution upload — session switch before the response → no IN_SYNC, nothing saved', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a'); await c.a(deviceA)
  const other = bound(libA, 'user-a'); await c.a(other)
  const edited = n => ({ ...libA, songs: libA.songs.map(s => s.id === id(1) ? { ...s, rawContent: `[C]${n}` } : s) })
  journal.persistLibrary(edited('cloud'), other, { expectedRaw: journal.libraryRevision(other) }); await c.a(other)
  journal.persistLibrary(edited('mine'), deviceA, { expectedRaw: journal.libraryRevision(deviceA) })
  setSession('user-a')
  try {
    assert.equal((await c.a(deviceA)).status, 'CONFLICT')
    let before = null
    c.setAfter(async (url, opts) => {
      if ((opts.method || 'GET') !== 'POST' || !url.startsWith('/api/songbook/records')) return
      setSession('user-b'); before = snapshot(deviceA)
    })
    let result
    try { result = await c.a(deviceA, { forceAction: 'upload' }) } finally { c.setAfter(null) }
    assert.ok(before)
    assert.equal(result.success, false)
    assert.notEqual(result.status, 'IN_SYNC')
    assert.deepEqual(snapshot(deviceA), before)
    assert.equal(c.recordsOf('user-b'), 0)
  } finally { localStorage.removeItem(sessionKey) }
})

// ---- #247 re-audit of PR #248 (head 78089b4): F3 logout / token rotation before completion ----
const uploadAfter = (c, fn) => { let hit = null; c.setAfter(async (url, opts) => {
  if ((opts.method || 'GET') !== 'POST' || !url.startsWith('/api/songbook/records') || hit) return
  fn(); hit = true }); return () => hit }

test('#247 F3 logout: A logs out while A\'s accepted upload response is in flight → no IN_SYNC, no metadata/base, local data kept', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a')
  setSession('user-a')
  try {
    assert.equal((await c.a(deviceA)).success, true)
    journal.persistLibrary({ ...libA, songs: [...libA.songs, song(21)] }, deviceA, { expectedRaw: journal.libraryRevision(deviceA) })
    let before = null
    const hit = uploadAfter(c, () => { localStorage.removeItem(sessionKey); before = snapshot(deviceA) }) // sign-out (googleAuth removes the stored session)
    let result
    try { result = await c.a(deviceA) } finally { c.setAfter(null) }
    assert.ok(hit())
    assert.equal(result.success, false)
    assert.notEqual(result.status, 'IN_SYNC')
    assert.match(result.error, /signed out while syncing/)
    assert.match(result.error, /already accepted by the cloud stay in the account that started/)
    assert.deepEqual(snapshot(deviceA), before, 'no sync state, metadata or base written after logout')
    assert.ok(read(deviceA).songs.some(s => s.id === id(21)), 'local data preserved')
    assert.ok(c.songsOf('user-a').includes(id(21)), 'accepted upload not described as undone: it is in A')
    setSession('user-a')
    const again = await c.a(deviceA)
    assert.equal(again.status, 'IN_SYNC')
  } finally { localStorage.removeItem(sessionKey) }
})

test('#247 F3 logout: conflict-resolution upload — logout before the response → no IN_SYNC, nothing saved', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a'); await c.a(deviceA)
  const other = bound(libA, 'user-a'); await c.a(other)
  const edited = n => ({ ...libA, songs: libA.songs.map(s => s.id === id(1) ? { ...s, rawContent: `[C]${n}` } : s) })
  journal.persistLibrary(edited('cloud'), other, { expectedRaw: journal.libraryRevision(other) }); await c.a(other)
  journal.persistLibrary(edited('mine'), deviceA, { expectedRaw: journal.libraryRevision(deviceA) })
  setSession('user-a')
  try {
    assert.equal((await c.a(deviceA)).status, 'CONFLICT')
    let before = null
    const hit = uploadAfter(c, () => { localStorage.removeItem(sessionKey); before = snapshot(deviceA) })
    let result
    try { result = await c.a(deviceA, { forceAction: 'upload' }) } finally { c.setAfter(null) }
    assert.ok(hit())
    assert.notEqual(result.status, 'IN_SYNC')
    assert.deepEqual(snapshot(deviceA), before)
  } finally { localStorage.removeItem(sessionKey) }
})

test('#247 F3 token rotation: the session token changes (same account) before completion → round not marked synced; retry converges', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a')
  const withToken = t => localStorage.setItem(sessionKey, JSON.stringify({ user: { id: 'user-a' }, sessionToken: t }))
  withToken('tok-1')
  try {
    assert.equal((await c.a(deviceA)).success, true)
    journal.persistLibrary({ ...libA, songs: [...libA.songs, song(22)] }, deviceA, { expectedRaw: journal.libraryRevision(deviceA) })
    let before = null
    const hit = uploadAfter(c, () => { withToken('tok-2'); before = snapshot(deviceA) })
    let result
    try { result = await c.a(deviceA) } finally { c.setAfter(null) }
    assert.ok(hit())
    assert.notEqual(result.status, 'IN_SYNC')
    assert.match(result.error, /sign-in changed while syncing/)
    assert.deepEqual(snapshot(deviceA), before)
    assert.equal((await c.a(deviceA)).status, 'IN_SYNC')
  } finally { localStorage.removeItem(sessionKey) }
})

// ---- #248 Final F3 Lifecycle Containment (F1 missing initial session, F2 GET persistence race) ----
const getAfter = (c, fn) => {
  let hit = null
  c.setAfter(async (url, opts) => {
    if ((opts.method || 'GET') !== 'GET' || !url.startsWith('/api/songbook/records') || hit) return
    fn()
    hit = true
  })
  return () => hit
}

test('#248 F1: missing initial session with valid token fails closed; no queued execution, no sync state/base written', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a')
  localStorage.removeItem(sessionKey)
  const before = snapshot(deviceA)
  const result = await c.a(deviceA, { noSession: true })
  assert.equal(result.success, false)
  assert.equal(result.status, 'ERROR')
  assert.match(result.error, /Session expired or unauthorized/)
  assert.deepEqual(snapshot(deviceA), before, 'local storage completely untouched; no base, no metadata')
  assert.deepEqual(read(deviceA), libA, 'local library preserved')
})

test('#248 F1: missing-session -> login -> logout sequence fails closed; no stale completion or sync persistence', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a')
  localStorage.removeItem(sessionKey)
  const before = snapshot(deviceA)
  c.setHook(async () => {
    setSession('user-a')
    localStorage.removeItem(sessionKey)
  })
  let result
  try {
    result = await c.a(deviceA, { noSession: true })
  } finally {
    c.setHook(null)
    localStorage.removeItem(sessionKey)
  }
  assert.equal(result.success, false)
  assert.notEqual(result.status, 'IN_SYNC')
  assert.deepEqual(snapshot(deviceA), before, 'nothing persisted on device after logout sequence')
})

test('#248 F2: Records GET paused -> logout before resume -> no remote records written to local library', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a')
  setSession('user-a')
  try {
    assert.equal((await c.a(deviceA)).success, true)
    const other = bound(libA, 'user-a')
    await c.a(other)
    journal.persistLibrary({ ...libA, songs: [...libA.songs, song(31)] }, other, { expectedRaw: journal.libraryRevision(other) })
    assert.equal((await c.a(other)).success, true)
    assert.ok(c.songsOf('user-a').includes(id(31)))

    let before = null
    const hit = getAfter(c, () => {
      localStorage.removeItem(sessionKey)
      before = snapshot(deviceA)
    })
    let result
    try {
      result = await c.a(deviceA)
    } finally {
      c.setAfter(null)
    }
    assert.ok(hit())
    assert.equal(result.success, false)
    assert.notEqual(result.status, 'IN_SYNC')
    assert.match(result.error, /signed out while syncing/)
    assert.deepEqual(snapshot(deviceA), before, 'device storage untouched by remote records')
    assert.ok(!read(deviceA).songs.some(s => s.id === id(31)), 'stale remote song 31 was NOT written to device library')
    assert.deepEqual(read(deviceA).songs.map(s => s.id), libA.songs.map(s => s.id), 'device library preserved')
  } finally {
    localStorage.removeItem(sessionKey)
  }
})

test('#248 F2: Records GET paused -> token rotates before resume -> no remote records written to local library', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a')
  const withToken = t => localStorage.setItem(sessionKey, JSON.stringify({ user: { id: 'user-a' }, sessionToken: t }))
  withToken('tok-initial')
  try {
    assert.equal((await c.a(deviceA)).success, true)
    const other = bound(libA, 'user-a')
    await c.a(other)
    journal.persistLibrary({ ...libA, songs: [...libA.songs, song(32)] }, other, { expectedRaw: journal.libraryRevision(other) })
    assert.equal((await c.a(other)).success, true)
    assert.ok(c.songsOf('user-a').includes(id(32)))

    let before = null
    const hit = getAfter(c, () => {
      withToken('tok-rotated')
      before = snapshot(deviceA)
    })
    let result
    try {
      result = await c.a(deviceA)
    } finally {
      c.setAfter(null)
    }
    assert.ok(hit())
    assert.equal(result.success, false)
    assert.notEqual(result.status, 'IN_SYNC')
    assert.match(result.error, /sign-in changed while syncing/)
    assert.deepEqual(snapshot(deviceA), before, 'device storage untouched by remote records')
    assert.ok(!read(deviceA).songs.some(s => s.id === id(32)), 'stale remote song 32 was NOT written to device library')
    assert.deepEqual(read(deviceA).songs.map(s => s.id), libA.songs.map(s => s.id), 'device library preserved')

    const retry = await c.a(deviceA)
    assert.equal(retry.status, 'IN_SYNC')
    assert.ok(read(deviceA).songs.some(s => s.id === id(32)), 'retry successfully incorporates remote song')
  } finally {
    localStorage.removeItem(sessionKey)
  }
})

// ---- PR #248 Final Lifecycle Residuals (F1 PENDING_UPLOAD_AFTER_LOGOUT, F2 QUEUED_SYNC_AFTER_TOKEN_ROTATION, F3 EMPTY_LIBRARY_OWNER_AFTER_LOGOUT) ----

test('PR #248 F1: multi-batch pending upload -> logout after batch 1 -> no batch 2 dispatched, local state untouched, accepted batch 1 reported honestly', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a')
  setSession('user-a')
  try {
    assert.equal((await c.a(deviceA)).success, true)
    // Create 55 songs to exceed MAX_PUSH_CHANGES (50), guaranteeing at least 2 push batches
    const manySongs = []
    for (let i = 100; i < 155; i++) {
      manySongs.push(song(i))
    }
    journal.persistLibrary({ songs: [...libA.songs, ...manySongs], setlists: [] }, deviceA, { expectedRaw: journal.libraryRevision(deviceA) })

    let postCalls = 0
    let before = null
    c.setHook(async (url, opts) => {
      if ((opts.method || 'GET') === 'POST' && url.startsWith('/api/songbook/records')) {
        postCalls++
        if (postCalls === 1) {
          // Logout triggered while batch 1 is in-flight before completion
          localStorage.removeItem(sessionKey)
          before = snapshot(deviceA)
        }
      }
    })

    let result
    try {
      result = await c.a(deviceA)
    } finally {
      c.setHook(null)
    }

    assert.equal(postCalls, 1, 'No new request dispatched after invalidation: batch 2 was never sent')
    assert.equal(result.success, false)
    assert.notEqual(result.status, 'IN_SYNC')
    assert.match(result.error, /signed out while syncing/)
    assert.match(result.error, /already accepted by the cloud stay in the account that started/)
    assert.doesNotMatch(result.error, /Nothing was uploaded/)
    assert.deepEqual(snapshot(deviceA), before, 'local library, cursor, baseline, and sync metadata untouched after invalidation')
    // Server-side acceptance verified for batch 1 (25 songs uploaded)
    assert.ok(c.songsOf('user-a').length >= 25, 'already-dispatched authenticated request completed server-side')
  } finally {
    localStorage.removeItem(sessionKey)
  }
})

test('PR #248 F1: Classic sync pending upload -> logout while in flight -> server accepts, client local state untouched, no IN_SYNC', async () => {
  const c = await cloud()
  const sync = require('../src/utils/cloudSongbookSync.ts')
  const deviceA = bound(libA, 'user-a')
  setSession('user-a')
  const savedFetch = global.fetch
  let triggerLogout = false
  let before = null
  global.fetch = async (url, opts = {}) => {
    if (triggerLogout && (opts.method || 'GET') === 'POST' && url.startsWith('/api/songbook/sync')) {
      localStorage.removeItem(sessionKey)
      before = snapshot(deviceA)
    }
    return syncApi[(opts.method || 'GET') === 'GET' ? 'onRequestGet' : 'onRequestPost']({
      env: c.env,
      request: new Request(`https://example.com${url}`, {
        method: opts.method || 'GET',
        headers: opts.headers || {},
        ...(opts.body ? { body: opts.body } : {}),
      }),
    })
  }

  try {
    // Initial sync
    const initial = await sync.performCloudSongbookSync(c.tokens.a, { storage: deviceA })
    assert.equal(initial.success, true)

    // Add a new song locally
    journal.persistLibrary({ songs: [...libA.songs, song(88)], setlists: [] }, deviceA, { expectedRaw: journal.libraryRevision(deviceA) })

    triggerLogout = true
    const result = await sync.performCloudSongbookSync(c.tokens.a, { storage: deviceA })

    assert.equal(result.success, false)
    assert.notEqual(result.status, 'IN_SYNC')
    assert.match(result.error, /signed out while syncing/)
    assert.match(result.error, /already accepted by the cloud stay in the account that started/)
    assert.deepEqual(snapshot(deviceA), before, 'Classic sync: local library, baseline, metadata untouched after logout')
  } finally {
    localStorage.removeItem(sessionKey)
  }
})

test('PR #248 F2: Queued Records sync -> token rotates before queued execution -> revalidates and fails closed without network dispatch or mutation', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a')
  const withToken = t => localStorage.setItem(sessionKey, JSON.stringify({ user: { id: 'user-a' }, sessionToken: t }))
  withToken('tok-initial')

  try {
    // Seed device
    assert.equal((await c.a(deviceA)).success, true)
    journal.persistLibrary({ ...libA, songs: [...libA.songs, song(99)] }, deviceA, { expectedRaw: journal.libraryRevision(deviceA) })

    // Simulate lock queue: lock is held by ongoing task
    let releaseLock
    const lockWait = new Promise(resolve => { releaseLock = resolve })
    let queueExecuted = false
    let networkCalls = 0

    const savedLocks = navigator.locks
    let queuedAction = null
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (name, action) => {
          if (name === client.RECORDS_SYNC_RUN_LOCK && !queuedAction) {
            queuedAction = action
            // Hold the lock until released
            await lockWait
            queueExecuted = true
            return action()
          }
          return action()
        },
      },
    })

    c.setHook(async () => {
      networkCalls++
    })

    let queuedSyncPromise
    try {
      // Start sync 1 which enters the lock queue
      queuedSyncPromise = c.a(deviceA)

      // Rotate token while sync 1 is queued waiting for execution
      withToken('tok-rotated')
      const beforeSnapshot = snapshot(deviceA)

      // Release lock so queued sync 1 actually begins execution
      releaseLock()
      const result = await queuedSyncPromise

      assert.ok(queueExecuted, 'Queue execution took place')
      assert.equal(result.success, false)
      assert.equal(result.status, 'ERROR')
      assert.match(result.error, /Session expired or unauthorized/)
      assert.equal(networkCalls, 0, 'No network requests dispatched for stale queued sync')
      assert.deepEqual(snapshot(deviceA), beforeSnapshot, 'Zero mutations to device storage')
    } finally {
      Object.defineProperty(navigator, 'locks', { configurable: true, value: savedLocks })
      c.setHook(null)
    }
  } finally {
    localStorage.removeItem(sessionKey)
  }
})

test('PR #248 F3: Empty library ownership confirmation -> logout while pending -> fails closed, no owner bound, empty library & recovery preserved', async () => {
  const store = storage()
  journal.persistLibrary({ songs: [], setlists: [] }, store)
  localStorage.setItem(sessionKey, JSON.stringify({ user: { id: 'user-a' }, sessionToken: 'tok-a' }))

  const originalWriteRecovery = journal.writeRecoverySnapshot
  let loggedOut = false
  journal.writeRecoverySnapshot = async (...args) => {
    // Logout while confirmation is pending
    localStorage.removeItem(sessionKey)
    loggedOut = true
    return originalWriteRecovery(...args)
  }

  let error = null
  try {
    await owner.confirmLibraryOwner('user-a', store)
  } catch (err) {
    error = err
  } finally {
    journal.writeRecoverySnapshot = originalWriteRecovery
  }

  assert.ok(loggedOut, 'Logout was triggered while confirmation was pending')
  assert.ok(error, 'Confirmation must reject on logout')
  assert.match(error.message, /The songbook or the signed-in account changed while linking/)
  assert.equal(owner.readLibraryOwner(store), null, 'No ownership binding after logout')
  assert.deepEqual(read(store), { songs: [], setlists: [] }, 'Empty library preserved')
  const recoveryCopies = Object.entries(journal.recoveryData(store)).filter(([k]) => k.startsWith('gtar_sync_recovery:owner-confirm:'))
  assert.equal(recoveryCopies.length, 1, 'Recovery state preserved in storage')
  localStorage.removeItem(sessionKey)
})

test('PR #248 F4: Public Records sync wrapper -> stale queued sync preserves off state, zero network/mutation, fresh sync enables on', async () => {
  const c = await cloud()
  const deviceA = bound(libA, 'user-a')
  const withToken = t => localStorage.setItem(sessionKey, JSON.stringify({ user: { id: 'user-a' }, sessionToken: t }))
  withToken('tok-initial')

  const savedFetch = global.fetch
  global.fetch = c.fetch
  try {
    // 1. Initial state: server state flag is 'off', sync enabled is '1'
    deviceA.setItem(client.RECORDS_SERVER_STATE_KEY, 'off')
    deviceA.setItem(client.RECORDS_SYNC_TOGGLE_KEY, '1')
    assert.equal(client.isRecordsServerUnavailable(deviceA), true)

    let releaseLock
    const lockWait = new Promise(resolve => { releaseLock = resolve })
    let queueExecuted = false
    let networkCalls = 0

    const savedLocks = navigator.locks
    let queuedAction = null
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (name, action) => {
          if (name === client.RECORDS_SYNC_RUN_LOCK && !queuedAction) {
            queuedAction = action
            await lockWait
            queueExecuted = true
            return action()
          }
          return action()
        },
      },
    })

    c.setHook(async () => {
      networkCalls++
    })

    let queuedSyncPromise
    try {
      // Call actual public Records sync wrapper
      queuedSyncPromise = client.performSongbookSync('tok-initial', { storage: deviceA })

      // Rotate token while queued before execution
      withToken('tok-rotated')
      const beforeSnapshot = snapshot(deviceA)
      assert.equal(beforeSnapshot[client.RECORDS_SERVER_STATE_KEY], 'off')

      // Release lock so queued execution runs
      releaseLock()
      const result = await queuedSyncPromise

      assert.ok(queueExecuted, 'Queue execution took place')
      assert.equal(result.success, false)
      assert.equal(result.status, 'ERROR')
      assert.match(result.error, /Session expired or unauthorized/)
      assert.equal(networkCalls, 0, 'No network requests dispatched for stale queued sync')
      assert.equal(deviceA.getItem(client.RECORDS_SERVER_STATE_KEY), 'off', 'gtar_records_sync_server preserved as off')
      assert.deepEqual(snapshot(deviceA), beforeSnapshot, 'Zero unauthorized mutations to storage including gtar_records_sync_server')
    } finally {
      Object.defineProperty(navigator, 'locks', { configurable: true, value: savedLocks })
      c.setHook(null)
    }

    // 2. Fresh authenticated sync: legitimate sync enables server flag from off to on
    withToken(c.tokens.a)
    const freshResult = await client.performSongbookSync(c.tokens.a, { storage: deviceA })
    assert.equal(freshResult.success, true)
    assert.equal(deviceA.getItem(client.RECORDS_SERVER_STATE_KEY), 'on', 'Fresh sync enables gtar_records_sync_server flag')
    assert.equal(client.isRecordsServerUnavailable(deviceA), false)
  } finally {
    global.fetch = savedFetch
    localStorage.removeItem(sessionKey)
  }
})

