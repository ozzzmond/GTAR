// #252 / PR #258 audit F1–F7: deterministic reproductions of the B2 data-safety findings.
// Each test fails on 56c7431 (pre-fix) and passes on the remediation.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/b2Harness.cjs')
const { installNavigatorLocks } = require('./helpers/fakeLocks.cjs')

installNavigatorLocks()
const V1 = 'gtar_library_v1'
const b2Db = factory => factory.databaseNames().filter(name => name.startsWith('gtar_library_b2::'))
const records = (factory, db, store) => factory._dbs.get(db).stores.get(store).records

/** Legacy v1 library owned by `owner` (when given), signed in as `session`, B2 enabled. */
function device({ owner = 'user-a', session = 'user-a', n = 12, setlists = 2, storage = h.freshStorage() } = {}) {
  const factory = new h.Factory()
  const tab = h.newTab()
  if (owner) h.bindOwner(storage, owner)
  // The earlier library is built by its owner (#258: another signed-in account cannot open it).
  h.signIn(storage, owner ?? session)
  if (n) tab.sj.persistLibrary(h.library(n, setlists), storage)
  h.signIn(storage, session)
  tab.sj.enableLibraryB2(storage)
  return { storage, factory }
}
async function open(storage, factory, options = {}) {
  const tab = h.newTab()
  const prepared = await tab.sj.prepareLibraryB2(storage, { factory, ...options })
  return { tab, prepared }
}
const edit = (tab, storage, i, fields, options) => {
  const lib = tab.sj.readPersistedLibrary(storage)
  tab.sj.persistLibrary({ ...lib, songs: lib.songs.map((s, k) => k === i ? { ...s, ...fields } : s) }, storage, options ?? { expectedRaw: tab.sj.libraryRevision(storage) })
}
/** An older build (no B2 code) writing gtar_library_v1 directly. */
function oldBuildEdit(storage, i, title) {
  const lib = JSON.parse(storage.getItem(V1))
  lib.songs[i] = { ...lib.songs[i], title }
  storage.setItem(V1, JSON.stringify(lib))
}
const allValues = storage => [...storage.map.entries()]

// F1: migration / activation race
test('F1a: legacy edit after verification but before activation is never hidden (stale migration rejected)', async () => {
  const { storage, factory } = device()
  factory.faults.put = (db, store, value) => {
    if (store === 'meta' && value.key === 'receipt') oldBuildEdit(storage, 0, 'Edited during the move')
    return null
  }
  const { tab, prepared } = await open(storage, factory)
  factory.faults.put = undefined
  assert.equal(prepared.active, false, 'stale migration must not activate')
  assert.equal(tab.sj.isLibraryB2Active(storage), false)
  assert.equal(tab.sj.readPersistedLibrary(storage).songs[0].title, 'Edited during the move')
})

test('F1b: a tab that has not opened B2 cannot save into the frozen legacy source once B2 is enabled', async () => {
  const { storage, factory } = device()
  const before = storage.getItem(V1)
  const b2tab = await open(storage, factory)
  assert.equal(b2tab.prepared.active, true)
  const staleTab = h.newTab() // opened before the switch: still reads the legacy library
  const lib = JSON.parse(before)
  assert.throws(() => staleTab.sj.persistLibrary({ ...lib, songs: lib.songs.map((s, i) => i === 1 ? { ...s, title: 'Hidden edit' } : s) }, storage),
    error => staleTab.sj.isStaleWriteConflictError(error))
  assert.equal(storage.getItem(V1), before)
})

test('F1c: an older build edits the legacy source after activation: next start shows the edit (B2 unchanged → re-moved)', async () => {
  const { storage, factory } = device()
  assert.equal((await open(storage, factory)).prepared.active, true)
  oldBuildEdit(storage, 2, 'Old build edit')
  const { tab, prepared } = await open(storage, factory)
  assert.equal(tab.sj.readPersistedLibrary(storage).songs[2].title, 'Old build edit')
  assert.equal(prepared.active, true)
  assert.ok([...storage.map.keys()].some(k => k.startsWith('gtar_sync_recovery:b2-superseded:')), 'older B2 copy archived')
})

test('F1d: both copies changed after activation: hold, neither copy replaced', async () => {
  const { storage, factory } = device()
  const a = await open(storage, factory)
  edit(a.tab, storage, 3, { title: 'B2 edit' })
  await a.tab.b2.flushB2()
  oldBuildEdit(storage, 4, 'Old build edit')
  const { tab, prepared } = await open(storage, factory)
  assert.equal(prepared.active, false)
  assert.equal(prepared.hold.reason, 'diverged')
  assert.equal(tab.sj.readPersistedLibrary(storage).songs[4].title, 'Old build edit')
  assert.ok([...records(factory, b2Db(factory)[0], 'songs').values()].some(r => r.data.title === 'B2 edit'))
})

// F2: metadata integrity
const tampers = {
  'song metadata changed': (f, db) => { const r = [...records(f, db, 'songs').values()][1]; r.data = { ...r.data, title: 'Tampered title' } },
  'setlist changed': (f, db) => { const r = [...records(f, db, 'setlists').values()][0]; r.data = { ...r.data, name: 'Tampered' } },
  'head schema unsupported': (f, db) => { const m = records(f, db, 'meta'); m.set('head', { ...m.get('head'), schemaVersion: 99 }) },
  'owner scope mismatch': (f, db) => { const m = records(f, db, 'meta'); m.set('owner', { ...m.get('owner'), scope: 'acct-0000', userId: 'user-z' }) },
  'record revision ahead of head': (f, db) => { const r = [...records(f, db, 'songs').values()][2]; r.rev = 999 },
  'deleted flag disagrees': (f, db) => { const r = [...records(f, db, 'songs').values()][3]; r.deleted = 1 },
  'top-level fields changed': (f, db) => { const m = records(f, db, 'meta'); m.set('extra', { ...m.get('extra'), value: { allowedUsers: ['x@example.test'] } }) },
  'head revision rewound': (f, db) => { const m = records(f, db, 'meta'); m.set('head', { ...m.get('head'), libraryRev: 0 }) },
}
for (const [label, tamper] of Object.entries(tampers)) {
  test(`F2: ${label} → B2 fails closed (hold, earlier library in use, B2 records kept)`, async () => {
    const { storage, factory } = device()
    assert.equal((await open(storage, factory)).prepared.active, true)
    const db = b2Db(factory)[0]
    tamper(factory, db)
    const kept = records(factory, db, 'songs').size
    const { tab, prepared } = await open(storage, factory)
    assert.equal(prepared.active, false, `${label} must not load`)
    assert.ok(prepared.hold)
    assert.equal(tab.sj.isLibraryB2Active(storage), false)
    assert.equal(tab.sj.readPersistedLibrary(storage).songs[1].title, h.library(12, 2).songs[1].title, 'legacy library in use')
    assert.equal(records(factory, db, 'songs').size, kept)
  })
}

// F3: journal recovery
test('F3: a conflicting journalled edit is never discarded by revision comparison; it is kept and held', async () => {
  const { storage, factory } = device()
  const a = await open(storage, factory), b = await open(storage, factory)
  edit(a.tab, storage, 3, { title: 'Committed by A' })
  await a.tab.b2.flushB2()
  edit(b.tab, storage, 3, { title: 'Forced by B' }, { force: true })
  await b.tab.b2.flushB2().catch(() => {})
  // Explicit Retry, then a fresh start.
  b.tab.b2.clearB2Hold(storage)
  const { prepared } = await open(storage, factory)
  assert.equal(prepared.active, false, 'conflicting journal must hold, not be dropped')
  const kept = allValues(storage).some(([k, v]) => (k.startsWith('gtar_library_b2_wal::') || k.startsWith('gtar_sync_recovery:')) && v.includes('Forced by B'))
  assert.ok(kept, 'B\'s edit is kept in the journal or a recovery archive')
  const db = b2Db(factory)[0]
  assert.equal([...records(factory, db, 'songs').values()].find(r => r.data.title === 'Committed by A') !== undefined, true)
})

// F4: rollback (turn off) race
test('F4a: turning B2 off refuses when the legacy source changed while B2 was on (no overwrite)', async () => {
  const { storage, factory } = device()
  const { tab } = await open(storage, factory)
  edit(tab, storage, 0, { title: 'B2 edit' })
  oldBuildEdit(storage, 5, 'Old build edit')
  await assert.rejects(tab.sj.disableLibraryB2(storage))
  assert.equal(JSON.parse(storage.getItem(V1)).songs[5].title, 'Old build edit', 'legacy edit not overwritten')
  assert.equal(storage.getItem('gtar_library_b2_enabled'), '1', 'B2 stays on')
})

test('F4b: a B2 save in another tab during turn-off: B2 stays on, nothing stale becomes the library', async () => {
  const { storage, factory } = device()
  const a = await open(storage, factory), b = await open(storage, factory)
  const setItem = storage.setItem.bind(storage)
  let injected = false
  storage.setItem = (key, value) => {
    setItem(key, value)
    if (!injected && key.startsWith('gtar_sync_recovery:b2-disable-source:')) {
      injected = true
      // Tab B loads A's revision and saves a newer one while A is turning B2 off.
      b.tab.b2.b2Decode(a.tab.sj.libraryRevision(storage))
      edit(b.tab, storage, 6, { title: 'Saved in tab B during turn-off' })
    }
  }
  await assert.rejects(a.tab.sj.disableLibraryB2(storage))
  storage.setItem = setItem
  assert.equal(storage.getItem('gtar_library_b2_enabled'), '1')
  await b.tab.b2.flushB2()
  const page = await open(storage, factory)
  assert.equal(page.tab.sj.readPersistedLibrary(storage).songs[6].title, 'Saved in tab B during turn-off')
})

// F5: partition fallback
test('F5a: B2 open failure keeps the device library readable for account B', async () => {
  const { storage, factory } = device({ owner: 'user-a', session: 'user-b' })
  const before = storage.getItem(V1)
  factory.faults.open = () => new Error('IndexedDB unavailable')
  const { tab, prepared } = await open(storage, factory)
  assert.equal(prepared.active, false)
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 12)
  assert.equal(storage.getItem(V1), before)
})

test('F5b: account B can turn off device B2 without changing its library', async () => {
  const { storage, factory } = device({ owner: 'user-a', session: 'user-b' })
  const { tab } = await open(storage, factory)
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 12)
  await tab.sj.disableLibraryB2(storage)
  assert.equal(tab.sj.readPersistedLibrary(storage).songs.length, 12)
  assert.equal(storage.getItem('gtar_library_b2_enabled'), null)
})

for (const [label, owner] of [['owner record for another environment', { v: 1, userId: 'user-a', env: 'other.host', boundAt: 1, reason: 'confirmed' }], ['unreadable owner record', '{broken']]) {
  test(`F5c: ${label}: the device library opens independently of owner metadata`, async () => {
    const storage = h.freshStorage()
    const { factory } = device({ owner: null, session: 'user-c', storage })
    storage.setItem('gtar_library_owner_v1', typeof owner === 'string' ? owner : JSON.stringify(owner))
    const { tab } = await open(storage, factory)
    let songs = null
    try { songs = tab.sj.readPersistedLibrary(storage)?.songs ?? null } catch { songs = null }
    assert.equal(songs.length, 12)
    for (const db of b2Db(factory)) assert.equal(records(factory, db, 'songs').size, 12, 'device copy verified')
  })
}

// F6: recovery isolation
test('F6: recovery archives and exports remain device-readable across accounts', async () => {
  const { storage, factory } = device()
  const key = 'gtar_sync_recovery:replacement:1:a'
  storage.setItem(key, JSON.stringify({ raw: storage.getItem(V1) }))
  const before = storage.getItem(key)
  h.signIn(storage, 'user-b')
  const b = await open(storage, factory)
  assert.match(b.tab.sj.readRecoveryArchive(key, storage), /Synthetic Song/)
  assert.ok(Object.values(b.tab.sj.recoveryExportData(storage)).some(v => v.includes('Synthetic Song')))
  h.signIn(storage, null)
  assert.equal(b.tab.sj.readRecoveryArchive(key, storage), before)
  assert.equal(storage.getItem(key), before)
})

test('F6: restore safety snapshot belongs to the device library across account changes', async () => {
  const { storage, factory } = device({ owner: 'user-a', session: 'user-b' })
  await open(storage, factory)
  const ex = require('../src/utils/backupExport.ts')
  const result = await ex.ensureRestoreSafetySnapshot({ songs: [{ id: 'b-1', title: 'Device song', artist: '', rawContent: '[D]b' }], setlists: [] }, storage)
  assert.match(require('../src/utils/syncJournal.ts').readRecoveryArchive(result.key, storage), /Device song/)
  h.signIn(storage, null)
  assert.match(require('../src/utils/syncJournal.ts').readRecoveryArchive(result.key, storage), /Device song/)
})

// F7: shared setlist publishing
test('F7: with B2 on, shared setlist create/update is refused with a B2-specific reason before any request; unpublish still allowed', async () => {
  const { storage, factory } = device()
  const { tab } = await open(storage, factory)
  const pub = require('../src/utils/sharedSetlistPublishing.ts')
  const realFetch = global.fetch
  const urls = []
  global.fetch = async url => { urls.push(url); return new Response(JSON.stringify({ success: false }), { status: 503 }) }
  try {
    const lib = tab.sj.readPersistedLibrary(storage)
    // Legacy server (no client-snapshot capability): the cloud-source flow stays refused under B2.
    await assert.rejects(pub.preparePublication(lib.setlists[0].id, () => lib, () => false), /new device storage \(B2\)/)
    await assert.rejects(pub.sendPublicationIntent('user-a', lib.setlists[0].id, { publicationKey: 'k', pending: { method: 'POST', key: 'k', body: {} } }), /new device storage \(B2\)/)
    assert.ok(urls.every(url => url === '/api/catalog/setlists?limit=1&offset=0'), 'at most the read-only capability probe; no source read or mutation')
    // Unpublishing sends no library content: whatever else it needs, B2 is not the reason it stops.
    const unpublish = await pub.sendPublicationIntent('user-a', lib.setlists[0].id, { publicationKey: 'k', result: { id: 'p', revision: 1, unpublished: false }, pending: { method: 'DELETE', id: 'p', key: 'k', body: {} } })
      .then(() => null, error => error)
    assert.doesNotMatch(String(unpublish?.message ?? ''), /new device storage \(B2\)/, 'unpublish is not blocked by B2')
  } finally { global.fetch = realFetch }
})

// R1 (#258 re-audit): turning B2 off from a tab whose sign-in is no longer current
const v1Titles = storage => JSON.parse(storage.getItem(V1)).songs.map(s => s.title)
function rotateToken(storage, userId) {
  const session = JSON.parse(storage.getItem('gtar_auth_session'))
  storage.setItem('gtar_auth_session', JSON.stringify({ ...session, user: { ...session.user, id: userId }, sessionToken: `rotated-${Math.random()}` }))
}
async function freshViewOf(storage, factory) {
  const view = await open(storage, factory)
  let songs
  try { songs = view.tab.sj.readPersistedLibrary(storage)?.songs ?? [] } catch { songs = [] }
  return songs
}

test('R1a: switching account before B2 turn-off keeps device edits', async () => {
  const { storage, factory } = device()
  const a = await open(storage, factory)
  edit(a.tab, storage, 1, { title: 'Device edit' })
  h.signIn(storage, 'user-b')
  await a.tab.sj.disableLibraryB2(storage)
  assert.equal(v1Titles(storage)[1], 'Device edit')
  assert.equal(storage.getItem('gtar_library_b2_enabled'), null)
})

test('R1b: ordinary A turn-off still works and keeps every A edit', async () => {
  const { storage, factory } = device()
  const a = await open(storage, factory)
  edit(a.tab, storage, 1, { title: 'Kept on turn-off' })
  await a.tab.sj.disableLibraryB2(storage)
  assert.equal(storage.getItem('gtar_library_b2_enabled'), null)
  assert.equal(v1Titles(storage)[1], 'Kept on turn-off')
})

test('R1c: sign-out before B2 turn-off keeps the device library writable', async () => {
  const { storage, factory } = device()
  const a = await open(storage, factory)
  h.signIn(storage, null)
  edit(a.tab, storage, 2, { title: 'Device edit signed out' })
  await a.tab.sj.disableLibraryB2(storage)
  assert.equal(v1Titles(storage)[2], 'Device edit signed out')
})

for (const [label, change] of [['token rotation', s => rotateToken(s, 'user-a')], ['switch to account B', s => h.signIn(s, 'user-b')], ['sign-out', s => h.signIn(s, null)]]) {
  test(`R1d: ${label} during turn-off (after the source archive): refused before any legacy write; B2 stays on`, async () => {
    const { storage, factory } = device()
    const a = await open(storage, factory)
    edit(a.tab, storage, 3, { title: 'A edit before turn-off' })
    const v1 = storage.getItem(V1)
    const setItem = storage.setItem.bind(storage)
    let fired = false
    storage.setItem = (key, value) => { setItem(key, value); if (!fired && key.startsWith('gtar_sync_recovery:b2-disable-source:')) { fired = true; change(storage) } }
    await assert.rejects(a.tab.sj.disableLibraryB2(storage))
    storage.setItem = setItem
    assert.ok(fired)
    assert.equal(storage.getItem(V1), v1, 'legacy untouched')
    assert.equal(storage.getItem('gtar_library_b2_enabled'), '1')
    if (label === 'switch to account B') assert.equal((await freshViewOf(storage, factory)).some(s => /Synthetic|A edit/.test(s.title)), true)
  })
}

test('R1e: a held device library can turn B2 off after an account switch', async () => {
  const { storage, factory } = device()
  factory.faults.open = () => new Error('IndexedDB unavailable')
  const a = await open(storage, factory)
  h.signIn(storage, 'user-b')
  await a.tab.sj.disableLibraryB2(storage)
  assert.equal(storage.getItem('gtar_library_b2_enabled'), null)
  assert.equal(a.tab.sj.readPersistedLibrary(storage).songs.length, 12)
})

// R2 (#258 re-audit): interrupted re-move after a legitimate legacy change must be retryable
const holdKeys = storage => [...storage.map.keys()].filter(k => k.startsWith('gtar_library_b2_hold::'))
const retry = storage => { for (const k of holdKeys(storage)) storage.removeItem(k) }
for (const phase of ['source', 'write', 'readback', 'verify', 'receipt', 'activate']) {
  test(`R2a: re-move interrupted at ${phase}: held, then Retry converges to the newer legacy library (older B2 archived)`, async () => {
    const { storage, factory } = device()
    assert.equal((await open(storage, factory)).prepared.active, true)
    oldBuildEdit(storage, 2, 'Legacy change')
    const first = await open(storage, factory, { failAt: phase })
    assert.equal(first.prepared.active, false, 'never activates an incomplete re-move')
    assert.equal(first.tab.sj.readPersistedLibrary(storage).songs[2].title, 'Legacy change', 'frozen source in use')
    retry(storage)
    const again = await open(storage, factory, { failAt: phase }) // repeated failure stays held, recoverable
    assert.equal(again.prepared.active, false)
    retry(storage)
    const done = await open(storage, factory)
    assert.equal(done.prepared.active, true, JSON.stringify(done.prepared.hold))
    assert.equal(done.tab.sj.readPersistedLibrary(storage).songs[2].title, 'Legacy change')
    assert.ok([...storage.map.keys()].some(k => k.startsWith('gtar_sync_recovery:b2-superseded:')))
    assert.equal([...storage.map.keys()].some(k => k.startsWith('gtar_library_b2_remigrate::')), false, 'marker cleared on activation')
    const later = await open(storage, factory)
    assert.equal(later.prepared.active, true, 'stable on the next start')
  })
}

test('R2b: source changes again while the re-move is interrupted: Retry moves the latest source', async () => {
  const { storage, factory } = device()
  await open(storage, factory)
  oldBuildEdit(storage, 2, 'First change')
  await open(storage, factory, { failAt: 'readback' })
  oldBuildEdit(storage, 3, 'Second change')
  retry(storage)
  const done = await open(storage, factory)
  assert.equal(done.prepared.active, true, JSON.stringify(done.prepared.hold))
  assert.deepEqual(done.tab.sj.readPersistedLibrary(storage).songs.slice(2, 4).map(s => s.title), ['First change', 'Second change'])
})

test('R2c: interrupted re-move with a corrupted target is rebuilt from the source on Retry', async () => {
  const { storage, factory } = device()
  await open(storage, factory)
  oldBuildEdit(storage, 2, 'Legacy change')
  await open(storage, factory, { failAt: 'activate' })
  const db = b2Db(factory)[0]
  const record = [...records(factory, db, 'songs').values()][4]
  record.data = { ...record.data, title: 'Corrupted' }
  retry(storage)
  const done = await open(storage, factory)
  assert.equal(done.prepared.active, true, JSON.stringify(done.prepared.hold))
  const songs = done.tab.sj.readPersistedLibrary(storage).songs
  assert.equal(songs[2].title, 'Legacy change')
  assert.equal(songs.some(s => s.title === 'Corrupted'), false)
})

test('R2d: ambiguous states stay held and keep every record: no receipt without a re-move marker; marker without its archive', async () => {
  {
    const { storage, factory } = device()
    const a = await open(storage, factory)
    edit(a.tab, storage, 0, { title: 'Only in B2' })
    await a.tab.b2.flushB2()
    const db = b2Db(factory)[0]
    records(factory, db, 'meta').delete('receipt')
    for (let i = 0; i < 2; i++) {
      retry(storage)
      const page = await open(storage, factory)
      assert.equal(page.prepared.active, false)
    }
    assert.ok([...records(factory, db, 'songs').values()].some(r => r.data.title === 'Only in B2'), 'edit kept')
  }
  {
    const { storage, factory } = device()
    await open(storage, factory)
    oldBuildEdit(storage, 2, 'Legacy change')
    await open(storage, factory, { failAt: 'write' })
    const marker = [...storage.map.keys()].find(k => k.startsWith('gtar_library_b2_remigrate::'))
    const archive = JSON.parse(storage.getItem(marker)).archiveKey
    const saved = storage.getItem(archive)
    storage.removeItem(archive)
    retry(storage)
    const page = await open(storage, factory)
    assert.equal(page.prepared.hold.reason, 'remigration-unverified')
    storage.setItem(archive, saved) // evidence restored: resumes
    retry(storage)
    assert.equal((await open(storage, factory)).prepared.active, true)
  }
})

// #253: client-snapshot publishing is self-contained, so B2 no longer blocks it.
test('#253: B2 on + client-snapshot server: publishes the saved device setlist with no personal cloud read', async () => {
  const { storage, factory } = device()
  const { tab } = await open(storage, factory)
  const pub = require('../src/utils/sharedSetlistPublishing.ts')
  storage.setItem('gtar_auth_session', JSON.stringify({ version: 1, user: { id: 'user-a', sub: 'user-a', email: 'user-a@example.test', role: 'member', access_status: 'active', email_verified: true },
    authenticatedAt: Date.now(), lastVerifiedAt: Date.now(), localExpiresAt: Date.now() + 3600000, expiresAt: Date.now() + 3600000,
    sessionToken: 'token-user-a', role: 'member', access_status: 'active' }))
  // The publication journal serializes through Web Locks (single-tab fixture).
  if (!window.navigator.locks) Object.defineProperty(window.navigator, 'locks', { configurable: true, value: { request: async (_name, action) => action() } })
  const realFetch = global.fetch
  const calls = []
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  global.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : undefined })
    if (url.startsWith('/api/catalog/setlists?')) return json({ setlists: [], capabilities: { client_snapshots: true } })
    if (options.method === 'POST') return json({ id: 'publication_b2_000000001', revision: 1, unpublished: false })
    return json({ success: false }, 500)
  }
  try {
    const lib = tab.sj.readPersistedLibrary(storage)
    const setId = lib.setlists[0].id
    const preview = await pub.preparePublication(setId, () => lib, () => false)
    assert.equal(preview.mode, 'client')
    const link = await pub.newPublicationLink(preview.account, setId)
    const { result } = await pub.sendPublicationIntent(preview.account, setId, { ...link, pending: pub.makePublicationIntent(link, preview) })
    assert.equal(result.revision, 1)
    assert.equal(calls.some(c => c.url.includes('/api/songbook')), false, 'no personal cloud read or upload')
    const post = calls.find(c => c.method === 'POST')
    assert.deepEqual(post.body.snapshot, preview.snapshot)
    assert.deepEqual(Object.keys(post.body).sort(), ['publication_key', 'snapshot', 'snapshot_version'])
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i))
    assert.equal(keys.some(k => k.startsWith('gtar_setlist_publication_snapshot_v1:')), false, 'settled request content removed')
    const journal = storage.getItem(keys.find(k => k.startsWith('gtar_setlist_publication_v1:')))
    assert.equal(journal.includes(preview.snapshot.entries[0].rawContent), false, 'no chart content in the journal')
  } finally { global.fetch = realFetch }
})
