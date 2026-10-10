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
const { persistLibrary, readPersistedLibrary, recoveryData } = require('../src/utils/syncJournal.ts')
const songId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const listId = 'c9bf9e57-1685-4c89-bafb-ff5af830be8a'
const library = content => ({ songs: [{ id: songId, title: 'Song', rawContent: content }], setlists: [] })
const emptyRevision = { version: 0, checksum: null }
const write = (db, data, expected, user = 'user-a') => upsertUserSongbook(db, user,
  JSON.stringify(data), sync.computeSongbookChecksum(data), '2026-10-10T00:00:00Z', expected)
const revision = record => ({ version: record.version, checksum: record.checksum })

function storage() {
  const map = new Map()
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key), key: index => [...map.keys()][index] ?? null,
    get length() { return map.size } }
}
async function fixture() {
  const db = createSongbookSqlite()
  const user = { id: 'user-a', google_sub: 'sub-a', email: 'a@example.com', role: 'member', access_status: 'active' }
  const original = db.prepare.bind(db)
  db.prepare = sql => sql.includes('FROM users WHERE id = ?')
    ? { bind(id) { return { first: async () => id === user.id ? user : null } } } : original(sql)
  const env = { DB: db, AUTH_SECRET: 'concurrency-test-secret' }
  const token = await createSessionToken(user, env.AUTH_SECRET)
  const request = async (method, body) => api[method === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env,
    request: new Request('https://example.com/api/songbook/sync', { method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) }) })
  return { db, request }
}
const postBody = (data, rev) => ({ data, expectedVersion: rev.version, expectedChecksum: rev.checksum })

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

test('CAS: initial write and first-write race have one winner', async () => {
  const db = createSongbookSqlite()
  const results = await Promise.all([write(db, library('A'), emptyRevision), write(db, library('B'), emptyRevision)])
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal((await findUserSongbook(db, 'user-a')).version, 1)
})
test('CAS: same-base clients cannot overwrite or reuse a successful revision', async () => {
  const db = createSongbookSqlite()
  const first = await write(db, library('base'), emptyRevision)
  const results = await Promise.all([write(db, library('A'), revision(first)), write(db, library('B'), revision(first))])
  assert.equal(results.filter(Boolean).length, 1)
  const winner = await findUserSongbook(db, 'user-a')
  assert.equal(winner.version, 2)
  assert.equal(await write(db, library('stale'), revision(first)), null)
  assert.equal((await findUserSongbook(db, 'user-a')).data_json, winner.data_json)
  for (let expectedVersion = 2; expectedVersion < 10; expectedVersion++) {
    const result = await write(db, library(String(expectedVersion)), revision(await findUserSongbook(db, 'user-a')))
    assert.equal(result.version, expectedVersion + 1)
  }
})
test('CAS: identical-content retries reject stale bases; client GET can acknowledge without a new write', async () => {
  const { db, request } = await fixture()
  const data = library('same')
  assert.equal((await request('POST', postBody(data, emptyRevision))).status, 200)
  assert.equal((await request('POST', postBody(data, emptyRevision))).status, 409)
  const store = seedStorage(data)
  let posts = 0
  await withFetch((url, opts) => { if (opts.method === 'POST') posts++; return request(opts.method) }, async () => {
    assert.equal((await sync.performCloudSongbookSync('token', { storage: store })).success, true)
  })
  assert.equal(posts, 0)
  assert.equal((await findUserSongbook(db, 'user-a')).version, 1)
})
test('HTTP: stable 409 contract, invalid metadata, checksum mismatch and user scoping', async () => {
  const { db, request } = await fixture()
  const first = await write(db, library('private'), emptyRevision)
  const invalid = [ {}, { clientVersion: first.version, clientChecksum: first.checksum },
    { expectedVersion: '1', expectedChecksum: first.checksum },
    { expectedVersion: -1, expectedChecksum: null }, { expectedVersion: 0, expectedChecksum: first.checksum },
    { expectedVersion: 1.5, expectedChecksum: first.checksum },
    { expectedVersion: 1, expectedChecksum: null }, { expectedVersion: 1, expectedChecksum: 'bad' },
    { expectedVersion: 1, expectedChecksum: 'ck_0000000000000000' },
    { expectedVersion: Number.MAX_SAFE_INTEGER + 1, expectedChecksum: first.checksum } ]
  for (const metadata of invalid) {
    const response = await request('POST', { data: library('overwrite'), ...metadata, userId: 'user-b' })
    assert.equal(response.status, 409)
    const body = await response.json()
    assert.equal(body.code, 'SONGBOOK_REVISION_CONFLICT')
    assert.equal(body.success, false)
    assert.equal(body.cloudRecord, undefined)
    assert.equal(JSON.stringify(body).includes('private'), false)
  }
  await write(db, library('B secret'), emptyRevision, 'user-b')
  const response = await request('POST', { ...postBody(library('A edit'), revision(first)), userId: 'user-b' })
  assert.equal(response.status, 200)
  assert.equal(JSON.parse((await findUserSongbook(db, 'user-b')).data_json).songs[0].rawContent, 'B secret')
  assert.equal((await request('GET')).status, 200)
})
test('D1 local binding: actual first()/RETURNING and simultaneous writes enforce CAS', async () => {
  const { Miniflare, convertV4MiniflareOptions } = require('miniflare')
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ modules: true, script: 'export default { fetch() { return new Response("test") } }',
    d1Databases: { DB: 'local-concurrency-test' } }] }))
  try {
    const db = await mf.getD1Database('DB')
    await db.prepare('CREATE TABLE users (id TEXT PRIMARY KEY)').run()
    await db.prepare("INSERT INTO users VALUES ('user-a')").run()
    // Execute the unchanged migration against disposable D1.
    const migration = fs.readFileSync(require('node:path').join(__dirname, '../migrations/0002_songbook_sync.sql'), 'utf8')
      .replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean)
    for (const sql of migration) await db.prepare(sql).run()
    const first = await write(db, library('base'), emptyRevision)
    assert.equal(first.version, 1)
    const results = await Promise.all([write(db, library('A'), revision(first)), write(db, library('B'), revision(first))])
    assert.equal(results.filter(Boolean).length, 1)
    assert.equal((await findUserSongbook(db, 'user-a')).version, 2)
    assert.equal(await write(db, library('stale'), revision(first)), null)
    const next = await write(db, library('next'), revision(await findUserSongbook(db, 'user-a')))
    assert.equal(next.version, 3)
    await db.prepare('DELETE FROM user_songbooks WHERE user_id = ?').bind('user-a').run()
    const initialRace = await Promise.all([write(db, library('first A'), emptyRevision), write(db, library('first B'), emptyRevision)])
    assert.equal(initialRace.filter(Boolean).length, 1)
    assert.equal((await findUserSongbook(db, 'user-a')).version, 1)
  } finally { await mf.dispose() }
})

test('CLIENT: rejected upload fetches authoritative state and preserves both edits with conflict copies', async () => {
  const { db, request } = await fixture()
  const base = library('base'), local = library('local')
  const first = await write(db, base, emptyRevision)
  const store = seedStorage(local, base)
  const calls = []
  let raced = false
  await withFetch(async (url, opts) => {
    calls.push(opts.method)
    if (opts.method === 'POST') {
      const body = JSON.parse(opts.body)
      assert.ok(Object.hasOwn(body, 'expectedVersion'))
      if (!raced) { raced = true; await write(db, library('remote'), revision(first)) }
      return request('POST', body)
    }
    return request('GET')
  }, async () => {
    const result = await sync.performCloudSongbookSync('token', { storage: store })
    assert.equal(result.success, true)
    assert.equal(result.actionTaken, 'MERGED')
    assert.deepEqual(result.updatedLibrary.songs.map(s => s.rawContent).sort(), ['local', 'remote'])
    assert.equal(new Set(result.updatedLibrary.songs.map(s => s.id)).size, 2)
  })
  assert.deepEqual(calls, ['GET', 'POST', 'GET', 'POST'])
  assert.equal((await findUserSongbook(db, 'user-a')).version, 3)
  const snapshots = Object.values(recoveryData(store)).map(raw => JSON.parse(raw))
  assert.ok(snapshots.some(data => (data.local ?? data).songs?.[0]?.rawContent === 'local'))
})
test('CLIENT: resolve path races preserve tombstones, setlist references and recovery snapshots', async () => {
  const { db, request } = await fixture()
  const base = library('base')
  base.setlists = [{ id: listId, name: 'Set', songs: [{ id: songId, title: 'Song' }] }]
  const local = structuredClone(base); local.songs[0].isDeleted = true; local.setlists[0].isDeleted = true
  const remote = structuredClone(base); remote.songs[0].rawContent = 'remote edit'
  await write(db, base, emptyRevision)
  const store = seedStorage(local, base)
  let posts = 0
  await withFetch(async (url, opts) => {
    if (opts.method === 'GET') return request('GET')
    if (++posts === 1) await write(db, remote, revision(await findUserSongbook(db, 'user-a')))
    return request('POST', JSON.parse(opts.body))
  }, async () => {
    const result = await sync.performCloudSongbookSync('token', { storage: store, forceAction: 'merge_preserve' })
    assert.equal(result.success, true)
    const merged = result.updatedLibrary
    assert.equal(merged.songs.find(s => s.id === songId).isDeleted, true)
    assert.ok(merged.songs.some(s => s.rawContent === 'remote edit' && !s.isDeleted))
    assert.equal(merged.setlists[0].isDeleted, true)
    assert.equal(merged.setlists[0].songs[0].id, songId)
    assert.ok(Object.keys(recoveryData(store)).some(k => k.includes('concurrency')))
  })
})
test('CLIENT: automatic retries are bounded and local edits survive continued contention', async () => {
  const { db, request } = await fixture()
  const base = library('base'), local = library('local')
  await write(db, base, emptyRevision)
  const store = seedStorage(local, base)
  let posts = 0
  await withFetch(async (url, opts) => {
    if (opts.method === 'GET') return request('GET')
    await write(db, library('racer-' + ++posts), revision(await findUserSongbook(db, 'user-a')))
    return request('POST', JSON.parse(opts.body))
  }, async () => {
    const result = await sync.performCloudSongbookSync('token', { storage: store })
    assert.equal(result.success, false)
    assert.equal(result.status, 'CONFLICT')
    assert.match(result.error, /Export a backup/)
  })
  assert.equal(posts, 3)
  assert.equal(readPersistedLibrary(store).songs[0].rawContent, 'local')
})
test('CLIENT: offline during conflict fetch preserves edits and reconnect can reconcile', async () => {
  const { db, request } = await fixture()
  const base = library('base'), local = library('local')
  await write(db, base, emptyRevision)
  const store = seedStorage(local, base)
  let gets = 0
  await withFetch(async (url, opts) => {
    if (opts.method === 'GET') { if (++gets > 1) throw new Error('offline'); return request('GET') }
    await write(db, library('remote'), revision(await findUserSongbook(db, 'user-a')))
    return request('POST', JSON.parse(opts.body))
  }, async () => {
    const result = await sync.performCloudSongbookSync('token', { storage: store })
    assert.equal(result.status, 'OFFLINE')
    assert.equal(readPersistedLibrary(store).songs[0].rawContent, 'local')
    assert.equal(sync.readCloudSyncMeta(store).cloudVersion, 1)
  })
  await withFetch((url, opts) => request(opts.method, opts.body && JSON.parse(opts.body)), async () => {
    const conflict = await sync.performCloudSongbookSync('token', { storage: store })
    assert.equal(conflict.status, 'CONFLICT')
    const resolved = await sync.performCloudSongbookSync('token', { storage: store, forceAction: 'merge_preserve' })
    assert.equal(resolved.success, true)
    assert.deepEqual(resolved.updatedLibrary.songs.map(s => s.rawContent).sort(), ['local', 'remote'])
  })
})
test('CLIENT: missing/foreign base or failed recovery storage blocks unsafe reconciliation', async () => {
  const { db, request } = await fixture()
  await write(db, library('remote'), emptyRevision)
  for (const foreign of [false, true]) {
    const store = seedStorage(library('local'), library('base'))
    if (foreign) sync.saveCloudSyncMeta({ lastSyncedUserId: 'user-b', lastSyncedChecksum: sync.computeSongbookChecksum(library('base')) }, store)
    else store.removeItem(sync.CLOUD_SYNC_BASE_KEY)
    await withFetch((url, opts) => request(opts.method), async () => {
      const result = await sync.performCloudSongbookSync('token', { storage: store, forceAction: 'merge_preserve' })
      assert.equal(result.status, 'CONFLICT')
      assert.match(result.error, /Export a backup/)
    })
    assert.equal(readPersistedLibrary(store).songs[0].rawContent, 'local')
  }
  const store = seedStorage(library('local'), library('remote'))
  const original = store.setItem
  store.setItem = (key, value) => { if (key.includes('concurrency')) throw new Error('quota'); original(key, value) }
  await withFetch((url, opts) => opts.method === 'GET' ? request('GET') : new Response('{}', { status: 409 }), async () => {
    const result = await sync.performCloudSongbookSync('token', { storage: store })
    assert.equal(result.status, 'ERROR')
    assert.match(result.error, /export a backup/)
  })
})

test('CLIENT: initial-write race reconciles additions from both devices using an empty base', async () => {
  const { db, request } = await fixture()
  const local = library('local')
  const remote = { songs: [{ id: listId, title: 'Remote addition', rawContent: 'remote' }], setlists: [] }
  const store = seedStorage(local)
  let posts = 0
  await withFetch(async (url, opts) => {
    if (opts.method === 'GET') return request('GET')
    if (++posts === 1) await write(db, remote, emptyRevision)
    return request('POST', JSON.parse(opts.body))
  }, async () => {
    const result = await sync.performCloudSongbookSync('token', { storage: store })
    assert.equal(result.success, true)
    assert.deepEqual(result.updatedLibrary.songs.map(s => s.rawContent).sort(), ['local', 'remote'])
  })
  assert.equal(posts, 2)
})
test('CLIENT: identical raced content is acknowledged by GET without replaying POST', async () => {
  const { db, request } = await fixture()
  const base = library('base'), local = library('same edit')
  await write(db, base, emptyRevision)
  const store = seedStorage(local, base)
  let posts = 0
  await withFetch(async (url, opts) => {
    if (opts.method === 'GET') return request('GET')
    posts++
    await write(db, local, revision(await findUserSongbook(db, 'user-a')))
    return request('POST', JSON.parse(opts.body))
  }, async () => {
    assert.equal((await sync.performCloudSongbookSync('token', { storage: store })).success, true)
  })
  assert.equal(posts, 1)
  assert.equal((await findUserSongbook(db, 'user-a')).version, 2)
})
test('CLIENT: browser edits during merge POST remain local and cloud base tracks the uploaded payload', async () => {
  const { db, request } = await fixture()
  const base = library('base'), local = library('local')
  await write(db, base, emptyRevision)
  await write(db, library('remote'), revision(await findUserSongbook(db, 'user-a')))
  const store = seedStorage(local, base)
  await withFetch(async (url, opts) => {
    if (opts.method === 'GET') return request('GET')
    persistLibrary(library('later browser edit'), store)
    return request('POST', JSON.parse(opts.body))
  }, async () => {
    const result = await sync.performCloudSongbookSync('token', { storage: store, forceAction: 'merge_preserve' })
    assert.equal(result.success, true)
    assert.ok(result.updatedLibrary.songs.some(s => s.rawContent === 'later browser edit'))
    assert.ok(readPersistedLibrary(store).songs.some(s => s.rawContent === 'later browser edit'))
    assert.equal(sync.computeSongbookChecksum(sync.readCloudSyncBase(store)), (await findUserSongbook(db, 'user-a')).checksum)
    assert.notEqual(sync.computeSongbookChecksum(readPersistedLibrary(store)), sync.readCloudSyncMeta(store).lastSyncedChecksum)
  })
})
test('CLIENT: changed account during 409 refresh cannot receive the previous account library', async () => {
  const { db, request } = await fixture()
  const base = library('base')
  await write(db, base, emptyRevision)
  const store = seedStorage(library('local'), base)
  let gets = 0, posts = 0
  await withFetch((url, opts) => {
    if (opts.method === 'POST') { posts++; return new Response('{}', { status: 409 }) }
    if (++gets === 1) return request('GET')
    return new Response(JSON.stringify({ success: true, userId: 'user-b', cloudRecord: null }))
  }, async () => {
    const result = await sync.performCloudSongbookSync('token', { storage: store })
    assert.equal(result.status, 'ERROR')
    assert.match(result.error, /Account changed/)
  })
  assert.equal(posts, 1)
  assert.equal(readPersistedLibrary(store).songs[0].rawContent, 'local')
})


test('F1: identical merged-content race applies remote additions to React and persisted state', async () => {
  const { JSDOM } = require('jsdom')
  const React = require('react')
  const { act } = React
  const { createRoot } = require('react-dom/client')
  const auth = require('../src/utils/authContext.ts')
  const savedAuth = auth.useOptionalGoogleAuth
  auth.useOptionalGoogleAuth = () => ({ session: { token: 'token' }, accessStatus: 'active' })
  const { CloudSyncModal } = require('../src/components/CloudSyncModal.tsx')
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.com' })
  const saved = Object.fromEntries(['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'].map(k => [k, global[k]]))
  global.window = dom.window; global.document = dom.window.document
  global.localStorage = dom.window.localStorage; global.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  const originalSync = sync.performCloudSongbookSync
  let completeSync
  const completed = new Promise(resolve => { completeSync = resolve })
  sync.performCloudSongbookSync = async (...args) => {
    const result = await originalSync(...args)
    completeSync(result)
    return result
  }
  try {
    const { db, request } = await fixture()
    const base = library('base'), local = library('local')
    const remote = structuredClone(base)
    remote.songs.push({ id: listId, title: 'Remote addition', rawContent: 'addition' })
    await write(db, base, emptyRevision)
    persistLibrary(local, localStorage)
    sync.saveCloudSyncBase(base, localStorage)
    sync.saveCloudSyncMeta({ lastSyncedUserId: 'user-a', lastSyncedChecksum: sync.computeSongbookChecksum(base) }, localStorage)
    let posts = 0
    let displayed = local
    let gets = 0
    function Harness() {
      const [data, setData] = React.useState(local)
      return React.createElement(React.Fragment, null,
        React.createElement('div', { id: 'library' }, data.songs.map(s => s.rawContent).join(',')),
        React.createElement(CloudSyncModal, { isOpen: true, onClose() {}, onSyncApplied: updated => { displayed = updated; setData(updated) } }))
    }
    await withFetch(async (url, opts) => {
      if (opts.method === 'GET') { gets++; return request('GET') }
      if (++posts === 1) await write(db, remote, revision(await findUserSongbook(db, 'user-a')))
      else await write(db, JSON.parse(opts.body).data, revision(await findUserSongbook(db, 'user-a')))
      return request('POST', JSON.parse(opts.body))
    }, async () => {
      await act(async () => root.render(React.createElement(Harness)))
      await act(async () => { assert.equal((await completed).success, true) })
    })
    assert.equal(posts, 2)
    assert.equal(gets, 3, 'React state application must not trigger another sync')
    assert.equal(document.getElementById('library').textContent, 'local,addition')
    assert.deepEqual(displayed, readPersistedLibrary(localStorage))
    assert.deepEqual(displayed.songs.map(s => s.rawContent).sort(), ['addition', 'local'])
    assert.equal(sync.computeSongbookChecksum(displayed), (await findUserSongbook(db, 'user-a')).checksum)
  } finally {
    await act(async () => root.unmount())
    sync.performCloudSongbookSync = originalSync
    auth.useOptionalGoogleAuth = savedAuth
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value }
    dom.window.close()
  }
})

test('F2: first-write same-ID race preserves both edits without a common base item', async () => {
  const { db, request } = await fixture()
  const store = seedStorage(library('local'))
  let posts = 0
  await withFetch(async (url, opts) => {
    if (opts.method === 'GET') return request('GET')
    if (++posts === 1) await write(db, library('remote'), emptyRevision)
    return request('POST', JSON.parse(opts.body))
  }, async () => {
    const result = await sync.performCloudSongbookSync('token', { storage: store })
    assert.equal(result.success, true)
    assert.deepEqual(result.updatedLibrary.songs.map(s => s.rawContent).sort(), ['local', 'remote'])
    assert.equal(new Set(result.updatedLibrary.songs.map(s => s.id)).size, 2)
    assert.deepEqual(readPersistedLibrary(store), result.updatedLibrary)
  })
  assert.equal(posts, 2)
})

test('F3: failed or unverifiable recovery snapshot aborts download without changing local data or metadata', async () => {
  const { request, db } = await fixture()
  await write(db, library('remote'), emptyRevision)
  for (const failure of ['throw', 'silent']) {
    const store = seedStorage(library('local'), library('base'))
    const before = store.getItem(sync.CLOUD_SYNC_META_KEY)
    const setItem = store.setItem
    store.setItem = (key, value) => {
      if (key.startsWith('gtar_sync_recovery:')) { if (failure === 'throw') throw new Error('quota'); return }
      setItem(key, value)
    }
    await withFetch((url, opts) => request(opts.method), async () => {
      const result = await sync.performCloudSongbookSync('token', { storage: store, forceAction: 'download' })
      assert.equal(result.success, false)
      assert.equal(result.actionTaken, 'NONE')
      assert.match(result.error, /backup|storage/i)
      assert.equal(result.updatedLibrary, undefined)
    })
    assert.equal(readPersistedLibrary(store).songs[0].rawContent, 'local')
    assert.equal(store.getItem(sync.CLOUD_SYNC_META_KEY), before)
  }
})

test('F3: automatic and explicit downloads abort when browser edits arrive during GET', async () => {
  const { request, db } = await fixture()
  const base = library('base')
  await write(db, library('remote'), emptyRevision)
  for (const forceAction of [undefined, 'download']) {
    const store = seedStorage(base, base)
    await withFetch(async (url, opts) => {
      persistLibrary(library('in-flight edit'), store)
      return request(opts.method)
    }, async () => {
      const result = await sync.performCloudSongbookSync('token', { storage: store, forceAction })
      assert.equal(result.success, false)
      assert.match(result.error, /changed|edit/i)
      assert.equal(result.updatedLibrary, undefined)
    })
    assert.equal(readPersistedLibrary(store).songs[0].rawContent, 'in-flight edit')
    assert.equal(sync.readCloudSyncMeta(store).cloudVersion, 1)
  }
})

test('F4: persisted song fields affect equality and checksum; tag-only changes reconcile without loss', () => {
  const base = library('base')
  for (const [field, value] of Object.entries({ tags: 'worship', isFavorite: true, createdAt: 42, lastOpenedAt: 43, isMissing: true })) {
    const changed = structuredClone(base)
    changed.songs[0][field] = value
    assert.equal(sync.songEquals(base.songs[0], changed.songs[0]), false, field)
    assert.notEqual(sync.computeSongbookChecksum(base), sync.computeSongbookChecksum(changed), field)
    assert.equal(sync.reconcileSongbook(changed, base, base).merged.songs[0][field], value)
    assert.equal(sync.reconcileSongbook(base, changed, base).merged.songs[0][field], value)
  }
  const local = structuredClone(base), remote = structuredClone(base)
  local.songs[0].tags = 'local'; remote.songs[0].tags = 'remote'
  const result = sync.reconcileSongbook(local, remote, base)
  assert.equal(result.hasConflicts, true)
  assert.deepEqual(result.merged.songs.map(s => s.tags).sort(), ['local', 'remote'])
})

test('F6: database write failure preserves cloud revision and local data; legacy clients receive update guidance', async () => {
  const { request, db } = await fixture()
  const base = library('base')
  const first = await write(db, base, emptyRevision)
  const legacy = await request('POST', { data: library('legacy'), clientVersion: 1 })
  assert.equal(legacy.status, 409)
  assert.match((await legacy.json()).error, /Update the app/)
  const prepare = db.prepare.bind(db)
  db.prepare = sql => { if (/(?:INSERT INTO|UPDATE) user_songbooks/.test(sql)) throw new Error('database write failed'); return prepare(sql) }
  const store = seedStorage(library('local'), base)
  await withFetch((url, opts) => request(opts.method, opts.body && JSON.parse(opts.body)), async () => {
    const result = await sync.performCloudSongbookSync('token', { storage: store })
    assert.equal(result.success, false)
    assert.match(result.error, /database write failed/)
  })
  assert.equal(readPersistedLibrary(store).songs[0].rawContent, 'local')
  assert.equal((await findUserSongbook(db, 'user-a')).version, first.version)
})


test('F2: no-base tombstone divergence retains both persisted edits', () => {
  const local = library('local'), remote = library('remote')
  for (const [left, right] of [[true, true], [false, true], [true, false]]) {
    local.songs[0].isDeleted = left; remote.songs[0].isDeleted = right
    const result = sync.reconcileSongbook(local, remote, { songs: [], setlists: [] })
    assert.equal(result.hasConflicts, true)
    assert.deepEqual(result.merged.songs.map(s => [s.rawContent, s.isDeleted]), [['local', left], ['remote', right]])
  }
})

test('F3: local write failure retains durable download recovery and never acknowledges success', async () => {
  const { request, db } = await fixture()
  await write(db, library('remote'), emptyRevision)
  const store = seedStorage(library('local'), library('base'))
  const setItem = store.setItem
  store.setItem = (key, value) => { if (key === 'gtar_library_v1') throw new Error('write failure'); setItem(key, value) }
  await withFetch((url, opts) => request(opts.method), async () => {
    const result = await sync.performCloudSongbookSync('token', { storage: store, forceAction: 'download' })
    assert.equal(result.success, false)
    assert.match(result.error, /write failure/)
  })
  assert.equal(readPersistedLibrary(store).songs[0].rawContent, 'local')
  assert.equal(sync.readCloudSyncMeta(store).lastSyncedChecksum, sync.computeSongbookChecksum(library('base')))
  assert.ok(Object.values(recoveryData(store)).some(raw => JSON.parse(raw).songs?.[0]?.rawContent === 'local'))
})

test('F1: upload acknowledgement returns latest browser edits and preserves uploaded base', async () => {
  const { request, db } = await fixture()
  const base = library('base')
  await write(db, base, emptyRevision)
  const store = seedStorage(library('local'), base)
  await withFetch((url, opts) => {
    if (opts.method === 'POST') persistLibrary(library('later edit'), store)
    return request(opts.method, opts.body && JSON.parse(opts.body))
  }, async () => {
    const result = await sync.performCloudSongbookSync('token', { storage: store })
    assert.equal(result.success, true)
    assert.equal(result.updatedLibrary.songs[0].rawContent, 'later edit')
    assert.deepEqual(result.updatedLibrary, readPersistedLibrary(store))
    assert.equal(sync.readCloudSyncBase(store).songs[0].rawContent, 'local')
  })
})


test('F6: explicit cloud replacement requires verified recovery of both libraries', async () => {
  const { request, db } = await fixture()
  await write(db, library('remote'), emptyRevision)
  for (const failSnapshot of [true, false]) {
    const store = seedStorage(library('local'))
    const setItem = store.setItem
    store.setItem = (key, value) => { if (failSnapshot && key.startsWith('gtar_sync_recovery:')) throw new Error('quota'); setItem(key, value) }
    let posts = 0
    await withFetch((url, opts) => {
      if (opts.method === 'POST') posts++
      return request(opts.method, opts.body && JSON.parse(opts.body))
    }, async () => {
      const result = await sync.performCloudSongbookSync('token', { storage: store, forceAction: 'upload' })
      assert.equal(result.success, !failSnapshot)
      if (failSnapshot) assert.match(result.error, /backup/)
    })
    assert.equal(posts, failSnapshot ? 0 : 1)
    if (failSnapshot) assert.equal(JSON.parse((await findUserSongbook(db, 'user-a')).data_json).songs[0].rawContent, 'remote')
    else assert.ok(Object.values(recoveryData(store)).some(raw => JSON.parse(raw).remote?.songs[0]?.rawContent === 'remote'))
  }
})
