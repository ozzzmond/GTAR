// #252 Cloud V2 P1: B2 cross-tab safety, account partitions, Cloud V1 sync boundary, restore regression,
// 10,000-song measurements and Songbook list windowing.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/b2Harness.cjs')
const { installNavigatorLocks } = require('./helpers/fakeLocks.cjs')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

installNavigatorLocks()
const V1 = 'gtar_library_v1'

/** Device with a legacy library owned by `owner`, signed in as `session`, B2 turned on. */
function device({ owner = 'user-a', session = 'user-a', n = 30, setlists = 4, storage = h.freshStorage() } = {}) {
  const factory = new h.Factory()
  const tab = h.newTab()
  if (owner) h.bindOwner(storage, owner)
  h.signIn(storage, session)
  if (n) tab.sj.persistLibrary(h.library(n, setlists), storage)
  tab.sj.enableLibraryB2(storage)
  return { storage, factory }
}
async function open(storage, factory) {
  const tab = h.newTab()
  const prepared = await tab.sj.prepareLibraryB2(storage, { factory })
  return { tab, prepared }
}
const edit = (tab, storage, i, fields) => {
  const lib = tab.sj.readPersistedLibrary(storage)
  tab.sj.persistLibrary({ ...lib, songs: lib.songs.map((s, k) => k === i ? { ...s, ...fields } : s) }, storage, { expectedRaw: tab.sj.libraryRevision(storage) })
}

test('two tabs: a stale save is refused (no last-write-wins); the other tab loads the newer revision', async () => {
  const { storage, factory } = device()
  const a = await open(storage, factory), b = await open(storage, factory)
  assert.equal(a.prepared.active && b.prepared.active, true)
  const baseB = b.tab.sj.libraryRevision(storage)
  edit(a.tab, storage, 1, { title: 'Tab A edit' })
  const headA = a.tab.sj.libraryRevision(storage)
  // Tab B still holds the old revision and edits the same song.
  const libB = b.tab.b2.b2Decode(baseB)
  assert.throws(() => b.tab.sj.persistLibrary({ ...libB, songs: libB.songs.map((s, k) => k === 1 ? { ...s, title: 'Tab B edit' } : s) }, storage, { expectedRaw: baseB }),
    error => b.tab.sj.isStaleWriteConflictError(error))
  assert.throws(() => b.tab.b2.b2Decode(headA), /not loaded/, 'B has not loaded A\'s revision yet')
  await a.tab.b2.flushB2()
  await b.tab.sj.loadLibraryRevision(headA)
  assert.equal(b.tab.b2.b2Decode(headA).songs[1].title, 'Tab A edit')
  // B continues from the newer revision; A sees B's save after loading it.
  edit(b.tab, storage, 2, { title: 'Tab B edit' })
  await b.tab.b2.flushB2()
  await a.tab.sj.loadLibraryRevision(b.tab.sj.libraryRevision(storage))
  const final = a.tab.b2.b2Decode(b.tab.sj.libraryRevision(storage))
  assert.deepEqual([final.songs[1].title, final.songs[2].title], ['Tab A edit', 'Tab B edit'])
  const page = await open(storage, factory)
  assert.deepEqual(page.tab.sj.readPersistedLibrary(storage).songs.slice(1, 3).map(s => s.title), ['Tab A edit', 'Tab B edit'])
})

test('two tabs: even a forced stale save cannot overwrite a newer record; it holds and keeps the edit in the journal', async () => {
  const { storage, factory } = device()
  const a = await open(storage, factory), b = await open(storage, factory)
  edit(a.tab, storage, 3, { title: 'Committed by A' })
  await a.tab.b2.flushB2()
  const libB = b.tab.sj.readPersistedLibrary(storage) // B's in-memory copy (stale)
  b.tab.sj.persistLibrary({ ...libB, songs: libB.songs.map((s, k) => k === 3 ? { ...s, title: 'Forced by B' } : s) }, storage, { force: true })
  await assert.rejects(b.tab.b2.flushB2(), /changed the same song/)
  assert.equal(b.tab.b2.readB2Hold(storage).reason, 'commit-conflict')
  const db = factory.databaseNames().find(name => name.startsWith('gtar_library_b2::'))
  assert.equal(factory.dump(db, 'songs').find(r => r.key === libB.songs[3].id).data.title, 'Committed by A', 'A\'s record intact')
  const wal = JSON.parse(storage.getItem(`gtar_library_b2_wal::${b.prepared.identity.scope}`))
  assert.equal(wal.at(-1).songs[0].song.title, 'Forced by B', 'B\'s edit is not lost')
})

test('account partitions A → B → A: no leak, mix, move or deletion; data stays after sign-out', async () => {
  const { storage, factory } = device({ n: 12, setlists: 2 })
  const legacy = storage.getItem(V1)
  const a = await open(storage, factory)
  assert.equal(a.prepared.identity.kind, 'account')
  edit(a.tab, storage, 0, { title: 'A private edit' })
  await a.tab.b2.flushB2()
  // Account B on the same device: its own, empty partition.
  h.signIn(storage, 'user-b')
  const b = await open(storage, factory)
  assert.equal(b.prepared.active, true)
  assert.notEqual(b.prepared.identity.scope, a.prepared.identity.scope)
  const libB = b.tab.sj.readPersistedLibrary(storage)
  assert.deepEqual([libB.songs.length, libB.setlists.length], [0, 0], 'B sees nothing of A')
  b.tab.sj.persistLibrary({ songs: [{ id: 'b-1', title: 'B song', artist: '', rawContent: '[D]b' }], setlists: [] }, storage, { expectedRaw: b.tab.sj.libraryRevision(storage) })
  await b.tab.b2.flushB2()
  assert.equal(b.tab.owner.libraryOwnership('user-b', storage), 'owned')
  assert.equal(b.tab.owner.libraryOwnership('user-a', storage), 'mismatch')
  // Sign out: B's data stays; a late B save is refused once B is no longer signed in.
  h.signIn(storage, null)
  assert.throws(() => b.tab.sj.persistLibrary({ songs: [], setlists: [] }, storage, { expectedRaw: b.tab.sj.libraryRevision(storage) }), /account changed/)
  // Back to A.
  h.signIn(storage, 'user-a')
  const a2 = await open(storage, factory)
  const libA = a2.tab.sj.readPersistedLibrary(storage)
  assert.equal(libA.songs.length, 12)
  assert.equal(libA.songs[0].title, 'A private edit')
  assert.equal(libA.songs.some(s => s.id === 'b-1'), false)
  const dbB = `gtar_library_b2::${b.prepared.identity.scope}`
  assert.deepEqual(factory.dump(dbB, 'songs').map(r => r.key), ['b-1'], 'B partition intact')
  assert.equal(storage.getItem(V1), legacy, 'legacy library untouched')
  assert.equal(JSON.parse(storage.getItem('gtar_library_owner_v1')).userId, 'user-a', 'owner never relabelled')
})

test('switching account inside one page: B2 refuses to reuse the open partition and stale work cannot write', async () => {
  const { storage, factory } = device({ n: 8, setlists: 1 })
  const a = await open(storage, factory)
  const head = a.tab.sj.libraryRevision(storage)
  h.signIn(storage, 'user-b')
  await assert.rejects(a.tab.sj.prepareLibraryB2(storage, { factory }), error => error.name === 'LibraryPartitionError')
  assert.throws(() => edit(a.tab, storage, 0, { title: 'stale async work' }), /account changed/)
  assert.equal(storage.getItem(`gtar_library_b2_head::${a.prepared.identity.scope}`), head, 'nothing saved')
})

test('library without a verified owner opens the device partition; it is never claimed or linked automatically', async () => {
  const { storage, factory } = device({ owner: null, session: 'user-c', n: 10, setlists: 1 })
  const page = await open(storage, factory)
  assert.equal(page.prepared.identity.kind, 'device')
  assert.equal(page.prepared.identity.scope, 'device')
  assert.equal(page.tab.sj.readPersistedLibrary(storage).songs.length, 10)
  assert.equal(page.tab.owner.libraryOwnership('user-c', storage), 'unbound')
  assert.match(page.tab.owner.personalContentBlockReason('user-c', storage), /not linked/)
  assert.throws(() => page.tab.owner.assertLibraryOwner('user-c', storage), error => error.ownership === 'unbound')
  await assert.rejects(page.tab.owner.confirmLibraryOwner('user-c', storage), /not available while library storage B2 is on/)
  assert.equal(storage.getItem('gtar_library_owner_v1'), null, 'owner never written')
})

test('Cloud V1 boundary: with B2 on, classic, per-record and automatic sync make no request and change nothing', async () => {
  const { storage, factory } = device()
  const page = await open(storage, factory)
  const records = require('../src/utils/recordsSync.ts')
  const classic = require('../src/utils/cloudSongbookSync.ts')
  const realFetch = global.fetch
  let requests = 0
  global.fetch = async () => { requests++; throw new Error('network must not be used') }
  try {
    const head = page.tab.sj.libraryRevision(storage)
    for (const run of [
      () => records.performSongbookSync('token', { storage }),
      () => records.performRecordsSync('token', { storage }),
      () => classic.performCloudSongbookSync('token', { storage }),
      () => records.performSongbookSync('token', { storage, forceAction: 'upload' }),
      () => records.performSongbookSync('token', { storage, forceAction: 'download' }),
    ]) {
      const result = await run()
      assert.equal(result.success, false)
      assert.match(result.error, /paused while the new device storage \(B2\) is on/)
    }
    edit(page.tab, storage, 0, { title: 'offline edit' })
    await page.tab.b2.flushB2()
    assert.equal(requests, 0, 'zero uploads or downloads')
    assert.notEqual(page.tab.sj.libraryRevision(storage), head)
    assert.equal(storage.getItem('gtar_cloud_sync_base'), null)
    assert.equal(storage.getItem('gtar_records_sync_v1'), null)
  } finally { global.fetch = realFetch }
})

test('Cloud V1 unchanged with B2 off: the guard is inert and the legacy save path is used', async () => {
  const storage = h.freshStorage()
  const tab = h.newTab()
  tab.sj.persistLibrary(h.library(5, 1), storage)
  assert.equal(tab.sj.personalSyncPausedByB2(storage), false)
  assert.equal(tab.sj.isLibraryB2Active(storage), false)
  assert.ok(storage.getItem(V1).startsWith('{'), 'v1 JSON is the revision')
  assert.equal(tab.sj.libraryRevision(storage), storage.getItem(V1))
})

// Restore regression (#251 schema v2) with B2 active.
const jbPath = '../src/utils/jsonBackup.ts'
function withDom(fn) {
  return async () => {
    const { JSDOM } = require('jsdom')
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: `https://${h.HOST}/` })
    const prior = { window: global.window, document: global.document }
    Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
    const root = createRoot(document.getElementById('root'))
    try { await fn({ dom, root }) } finally { await act(async () => root.unmount()); Object.assign(global, prior); dom.window.close() }
  }
}
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.includes(text))
async function pick(dom, label, payload) {
  await act(async () => button(label).click())
  const input = document.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => JSON.stringify(payload) }] })
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
}
function backupSource() {
  const { songs } = h.makeLibrary(154, 0)
  songs[153].isDeleted = true
  const live = songs.filter(s => !s.isDeleted)
  const setlists = Array.from({ length: 28 }, (_, i) => ({ id: `rs-${i}`, name: `Set ${i}`, createdAt: 1_700_000_000_000 + i,
    songs: [...live.slice(i * 5, i * 5 + 6)].reverse().map(s => ({ id: s.id, title: s.title, artist: s.artist })) }))
  return { songs, setlists }
}
for (const mode of ['replace', 'merge']) {
  test(`schema-v2 ${mode === 'replace' ? 'Full Restore' : 'Smart Merge'} into B2: 153 active + 1 trash, 28 setlists, exact order and settings`, withDom(async ({ dom, root }) => {
    const storage = h.freshStorage()
    const jb = require(jbPath)
    const bs = require('../src/utils/backupSettings.ts')
    const source = backupSource()
    // Source device settings, then the file.
    storage.setItem(bs.SETTINGS_KEYS.themeMode, 'azure-stage')
    storage.setItem('gtar_songbook_sort', 'artist')
    const payload = JSON.parse(jb.buildVerifiedBackup(source.songs, source.setlists).json)
    assert.equal(payload.schemaVersion, 2)
    // Target device: B2 on, its own library and settings.
    storage.setItem(bs.SETTINGS_KEYS.themeMode, 'oled-black')
    storage.setItem('gtar_songbook_sort', 'date')
    const existing = { songs: [{ id: 'cur-1', title: 'Current one', artist: '', rawContent: '[G]cur' }, { id: 'cur-2', title: 'Current two', artist: '', rawContent: '[A]cur' }],
      setlists: [{ id: 'cur-set', name: 'Current', songs: [{ id: 'cur-2', title: 'Current two', artist: '' }] }] }
    const { factory } = (() => { const factory = new h.Factory(); const t = h.newTab(); h.bindOwner(storage, 'user-a'); h.signIn(storage, 'user-a'); t.sj.persistLibrary(existing, storage); t.sj.enableLibraryB2(storage); return { factory } })()
    const { tab } = await open(storage, factory)
    assert.equal(tab.sj.isLibraryB2Active(storage), true)
    // The dialog is loaded from this tab's module instances.
    const { BackupRestoreDialogModal } = require('../src/components/BackupRestoreDialogModal.tsx')
    const { mergeBackupLibrary } = require('../src/utils/setlistSongs.ts')
    const { mergeImportedSetlists } = require('../src/utils/importIdentity.ts')
    let baseline = tab.sj.libraryRevision(storage)
    const app = {
      // useLibraryImports.handleFullRestore / handleSmartMerge persistence, as the App runs them.
      fullRestore: (songs, setlists) => {
        const parsed = jb.parseBackupJson(JSON.stringify({ songs, setlists }))
        const expectedRaw = tab.sj.libraryRevision(storage)
        tab.sj.preserveStoredLibrary(expectedRaw, storage)
        tab.sj.persistLibrary({ songs: parsed.songs, setlists: parsed.setlists }, storage, { expectedRaw })
        baseline = tab.sj.libraryRevision(storage)
      },
      smartMerge: (songs, setlists) => {
        const current = tab.sj.readPersistedLibrary(storage)
        const parsed = jb.parseBackupJson(JSON.stringify({ songs, setlists }), { mode: 'merge', existingSongs: current.songs })
        const merged = mergeBackupLibrary(current.songs, parsed.songs, parsed.setlists)
        tab.sj.persistLibrary({ songs: merged.songs, setlists: mergeImportedSetlists(current.setlists, merged.setlists) }, storage, { expectedRaw: baseline })
        baseline = tab.sj.libraryRevision(storage)
      },
    }
    const current = tab.sj.readPersistedLibrary(storage)
    await act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
      isOpen: true, onClose: () => {}, allSongs: current.songs, setlists: current.setlists, onImportAllSongs: () => assert.fail('fallback'),
      onFullRestore: app.fullRestore, onSmartMerge: app.smartMerge,
    })))
    const checkbox = label => [...document.querySelectorAll('label')].find(l => l.textContent.includes(label))?.querySelector('input')
    if (!checkbox('Preferences').checked) await act(async () => checkbox('Preferences').click())
    await pick(dom, mode === 'replace' ? 'Full Restore (Wipe & Replace)' : 'Restore Backup (Smart Merge)', payload)
    if (mode === 'replace') await act(async () => button('Confirm Wipe & Replace').click())
    assert.match(document.body.textContent, /Backup restored: .*\(verified after saving\)/)
    // #258 F6: with B2 the safety snapshot is a recovery archive of this partition, not the shared single key.
    assert.equal(storage.getItem(jb.RESTORE_SNAPSHOT_KEY), null)
    const snapshots = [...storage.map.entries()].filter(([k]) => k.startsWith('gtar_sync_recovery:restore-snapshot:')).map(([, v]) => JSON.parse(v))
    assert.equal(snapshots.length, 1, 'safety snapshot written first')
    assert.deepEqual(snapshots[0].local.songs.map(s => s.id), ['cur-1', 'cur-2'])
    await tab.b2.flushB2()
    // A new page reads exactly the expected library from B2.
    const page = await open(storage, factory)
    const back = page.tab.sj.readPersistedLibrary(storage)
    const want = mode === 'replace' ? source : { songs: [...existing.songs, ...source.songs], setlists: [...existing.setlists, ...source.setlists] }
    assert.deepEqual(h.ids(back.songs), h.ids(want.songs))
    assert.deepEqual(back.songs.filter(s => s.isDeleted).map(s => s.id), ['synthetic-000154'])
    assert.equal(back.songs.filter(s => !s.isDeleted).length, mode === 'replace' ? 153 : 155)
    assert.deepEqual(h.ids(back.setlists), h.ids(want.setlists))
    for (const list of source.setlists) assert.deepEqual(h.ids(back.setlists.find(l => l.id === list.id).songs), h.ids(list.songs), `order in ${list.id}`)
    assert.deepEqual(back.songs.find(s => s.id === 'synthetic-000007').rawContent, source.songs[6].rawContent)
    assert.equal(storage.getItem(bs.SETTINGS_KEYS.themeMode), 'azure-stage')
    assert.equal(storage.getItem('gtar_songbook_sort'), 'artist')
    const incoming = jb.parseBackupJson(JSON.stringify(payload))
    assert.deepEqual(require('../src/utils/backupExport.ts').verifyRestoredLibrary(
      existing, { songs: incoming.songs, setlists: incoming.setlists }, mode, storage), [])
  }))
}

test('10,000 songs: cold start, saving, search and opening measured (Node + in-memory IndexedDB, not a device result)', withDom(async ({ root }) => {
  const storage = h.freshStorage()
  const factory = new h.Factory()
  const setup = h.newTab()
  h.bindOwner(storage, 'user-a'); h.signIn(storage, 'user-a')
  setup.sj.persistLibrary(h.library(10000, 300), storage)
  setup.sj.enableLibraryB2(storage)
  await open(storage, factory) // migration (measured in libraryB2Storage)
  let t = performance.now()
  const { tab, prepared } = await open(storage, factory)
  const coldStart = performance.now() - t
  assert.equal(prepared.songs, 10000)
  const lib = tab.sj.readPersistedLibrary(storage)
  // Saving: 20 consecutive single-song edits.
  const saves = [], commits = []
  let current = lib
  for (let i = 0; i < 20; i++) {
    const next = { ...current, songs: current.songs.map((s, k) => k === i * 400 ? { ...s, title: `${s.title} *` } : s) }
    t = performance.now(); tab.sj.persistLibrary(next, storage, { expectedRaw: tab.sj.libraryRevision(storage) }); saves.push(performance.now() - t)
    t = performance.now(); await tab.b2.flushB2(); commits.push(performance.now() - t)
    current = next
  }
  // Opening a song: lookup by id in the loaded library.
  t = performance.now()
  for (let i = 0; i < 1000; i++) current.songs.find(s => s.id === `synthetic-${String(9000 + (i % 900)).padStart(6, '0')}`)
  const openMs = (performance.now() - t) / 1000
  // Songbook: windowed render and search keystrokes.
  const { partitionSongs } = require('../src/utils/setlistSongs.ts')
  const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
  const active = partitionSongs(current.songs).active
  const props = { songs: active, setlists: current.setlists, activeSongIndex: 0, onSelectSong: () => {}, onSongMembershipChange: () => {},
    onCreateSetlistForSong: () => {}, onNewSong: () => {}, onOpenSetlists: () => {}, onDeleteSong: () => {} }
  t = performance.now()
  await act(async () => root.render(React.createElement(SongbookHomeView, { ...props, searchQuery: '' })))
  const firstRender = performance.now() - t
  const cards = () => document.querySelectorAll('[data-testid^="song-card-"]').length
  assert.ok(cards() > 0 && cards() <= 240, `rendered ${cards()} of ${active.length} cards`)
  assert.match(document.querySelector('[data-testid="song-grid"]').getAttribute('data-window'), /^0-\d+$/)
  const keystrokes = []
  for (const query of ['s', 'sy', 'syn', 'synthetic song 00', 'synthetic song 0099']) {
    t = performance.now()
    await act(async () => root.render(React.createElement(SongbookHomeView, { ...props, searchQuery: query })))
    keystrokes.push(performance.now() - t)
  }
  assert.equal(cards(), [...active].filter(s => s.title.toLowerCase().includes('synthetic song 0099')).length, 'short result renders in full')
  // The Song Setlists panel (300 setlists here) renders in full; measure the song list alone too.
  const songOnly = []
  for (const query of ['s', 'sy', 'syn', 'synthetic song 00', 'synthetic song 0099']) {
    t = performance.now()
    await act(async () => root.render(React.createElement(SongbookHomeView, { ...props, setlists: [], searchQuery: query })))
    songOnly.push(performance.now() - t)
  }
  const avg = list => list.reduce((a, b) => a + b, 0) / list.length
  const max = list => Math.max(...list)
  console.log(`[B2 measure] 10,000 songs: cold start (load + verify) ${coldStart.toFixed(0)} ms; save avg ${avg(saves).toFixed(1)} / max ${max(saves).toFixed(1)} ms (sync); commit avg ${avg(commits).toFixed(1)} ms; open lookup ${openMs.toFixed(3)} ms; list first render ${firstRender.toFixed(0)} ms (${cards()} cards); search keystroke avg ${avg(keystrokes).toFixed(0)} / max ${max(keystrokes).toFixed(0)} ms with 300 setlists, ${avg(songOnly).toFixed(0)} / ${max(songOnly).toFixed(0)} ms song list only (React development build in jsdom); Node heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MiB (test process, all fixtures)`)
  assert.ok(max(saves) < 250, 'synchronous save stays small')
}))

test('list windowing: rows near the viewport only, aligned to grid columns, spacers keep the scroll height', () => {
  const { computeWindow, songGridColumns } = require('../src/utils/listWindow.ts')
  assert.deepEqual([songGridColumns(375), songGridColumns(700), songGridColumns(1100), songGridColumns(1400)], [1, 2, 3, 4])
  const top = computeWindow({ count: 10000, columns: 3, rowHeight: 60, viewportTop: 0, viewportHeight: 600, listTop: 0, overscanRows: 5 })
  assert.deepEqual(top, { start: 0, end: 45, padTop: 0, padBottom: (3334 - 15) * 60 })
  const mid = computeWindow({ count: 10000, columns: 3, rowHeight: 60, viewportTop: 60000, viewportHeight: 600, listTop: 0, overscanRows: 5 })
  assert.equal(mid.start % 3, 0)
  assert.deepEqual([mid.start, mid.end, mid.padTop], [995 * 3, 1015 * 3, 995 * 60])
  assert.equal(mid.padTop + (mid.end - mid.start) / 3 * 60 + mid.padBottom, 3334 * 60, 'total height preserved')
  const end = computeWindow({ count: 10000, columns: 4, rowHeight: 60, viewportTop: 10_000_000, viewportHeight: 600, listTop: 0, overscanRows: 5 })
  assert.equal(end.end, 10000)
  assert.ok(end.start < end.end)
  const short = computeWindow({ count: 7, columns: 2, rowHeight: 60, viewportTop: 0, viewportHeight: 600, listTop: 0, overscanRows: 5 })
  assert.deepEqual([short.start, short.end, short.padBottom], [0, 7, 0])
})
