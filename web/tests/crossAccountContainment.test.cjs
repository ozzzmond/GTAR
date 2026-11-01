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
// #258: an owner-bound library opens only for its owner. The test oracle (reading, and edits made on
// the device by its owner between rounds) acts as the device's owner; sync rounds keep their own sign-in.
const asOwnerOf = (store, fn) => {
  const linked = owner.readLibraryOwner(store)
  if (!linked) return fn()
  const previous = store.getItem('gtar_auth_session')
  store.setItem('gtar_auth_session', JSON.stringify({ user: { id: linked.userId }, sessionToken: 'owner-oracle' }))
  try { return fn() } finally { if (previous === null) store.removeItem('gtar_auth_session'); else store.setItem('gtar_auth_session', previous) }
}
const ownerPersist = (lib, store, options) => asOwnerOf(store, () => journal.persistLibrary(lib, store, options))
const ownerRevision = store => asOwnerOf(store, () => journal.libraryRevision(store))
const ownerRecoveryData = store => asOwnerOf(store, () => journal.recoveryData(store))
const device = lib => { const s = storage(); journal.persistLibrary(lib, s); return s }
const read = store => asOwnerOf(store, () => journal.readPersistedLibrary(store))



const ownerOf = store => owner.readLibraryOwner(store)?.userId ?? null
const bound = (lib, who) => { const s = device(lib); s.setItem(owner.LIBRARY_OWNER_KEY, JSON.stringify({ v: 1, userId: who, env: owner.libraryEnv(), boundAt: 0, reason: 'confirmed' })); return s }

















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
  ownerPersist(libA, localStorage)
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
  assert.equal(await c.b(device({ songs: [], setlists: [] })), null, 'records route stays disabled')
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
  assert.equal(asA, null, 'records route stays disabled')
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



// ---- #247 re-audit of PR #248 (head 7e8bd32): F3 late Records response ----
const snapshot = store => { const out = {}; for (let i = 0; i < store.length; i++) { const k = store.key(i); out[k] = store.getItem(k) } return out }







// ---- #247 re-audit of PR #248 (head 78089b4): F3 logout / token rotation before completion ----
const uploadAfter = (c, fn) => { let hit = null; c.setAfter(async (url, opts) => {
  if ((opts.method || 'GET') !== 'POST' || !url.startsWith('/api/songbook/records') || hit) return
  fn(); hit = true }); return () => hit }







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





// ---- PR #248 Final Lifecycle Residuals (F1 PENDING_UPLOAD_AFTER_LOGOUT, F2 QUEUED_SYNC_AFTER_TOKEN_ROTATION, F3 EMPTY_LIBRARY_OWNER_AFTER_LOGOUT) ----



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
    ownerPersist({ songs: [...libA.songs, song(88)], setlists: [] }, deviceA, { expectedRaw: ownerRevision(deviceA) })

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



test('PR #248 F3: Empty library ownership confirmation -> logout while pending -> fails closed, no owner bound, empty library & recovery preserved', async () => {
  const store = storage()
  ownerPersist({ songs: [], setlists: [] }, store)
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
  const recoveryCopies = Object.entries(ownerRecoveryData(store)).filter(([k]) => k.startsWith('gtar_sync_recovery:owner-confirm:'))
  assert.equal(recoveryCopies.length, 1, 'Recovery state preserved in storage')
  localStorage.removeItem(sessionKey)
})
