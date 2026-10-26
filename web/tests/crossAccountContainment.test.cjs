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
  const fetch = async (url, opts = {}) => {
    if (hook) await hook(url, opts)
    const target = url.startsWith('/api/songbook/records') ? recordsApi : syncApi
    const method = opts.method || 'GET'
    return target[method === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env, request: new Request(`https://example.com${url}`, {
      method, headers: opts.headers || {}, ...(opts.body ? { body: opts.body } : {}) }) })
  }
  const as = who => async (store, options = {}) => {
    const saved = global.fetch
    global.fetch = fetch
    try { return await client.performRecordsSync(tokens[who], { storage: store, ...options }) } finally { global.fetch = saved }
  }
  const songsOf = userId => db.sqlite.prepare("SELECT record_id FROM user_songbook_records WHERE user_id = ? AND kind = 'song' AND removed = 0").all(userId).map(r => r.record_id)
  const recordsOf = userId => db.sqlite.prepare('SELECT count(*) AS n FROM user_songbook_records WHERE user_id = ?').get(userId).n
  return { db, a: as('a'), b: as('b'), songsOf, recordsOf, setHook: h => { hook = h }, tokens, env }
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
