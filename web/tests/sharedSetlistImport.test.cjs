const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const api = require('../src/utils/sharedSetlistImport.ts')
const { CatalogImportContext } = require('../src/utils/catalogImportContext.ts')
const { CatalogSetlistPreview } = require('../src/components/CatalogSetlistPreview.tsx')
const { createBackupPayload, parseBackupJson } = require('../src/utils/jsonBackup.ts')
const { normalizeSongbookIds } = require('../src/utils/songbookFoundation.ts')
const { setlistEquals, reconcileSongbook, performCloudSongbookSync } = require('../src/utils/cloudSongbookSync.ts')
const { snapshotFromSongbook } = require('../src/utils/sharedSetlistSnapshot.ts')
const { computeSongbookChecksum } = require('../src/utils/cloudSongbookSync.ts')
const { LIBRARY_KEY } = require('../src/utils/syncJournal.ts')
const { SESSION_STORAGE_KEY } = require('../src/utils/googleAuth.ts')
const { CatalogApiError } = require('../src/types/sharedCatalog.ts')
const { PublishSetlistModal } = require('../src/components/PublishSetlistModal.tsx')
const { SharedCatalogBrowser } = require('../src/components/SharedCatalogBrowser.tsx')
const { SetlistDrawer } = require('../src/components/SetlistDrawer.tsx')
const { AuthContext } = require('../src/utils/authContext.ts')
const { sharedCatalogService } = require('../src/utils/sharedCatalogService.ts')

let dom, root, library, cloud, calls, version, responder
const id = 'publication_123456789'
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function session(account = 'account-a', role = 'admin', access = 'active') {
  const value = { version: 1, user: { id: account, sub: account, email: `${account}@test.app`, role, access_status: access, email_verified: true },
    authenticatedAt: Date.now(), lastVerifiedAt: Date.now(), localExpiresAt: Date.now() + 3600000, expiresAt: Date.now() + 3600000,
    sessionToken: `token-${account}`, role, access_status: access }
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value))
  return value
}
function persist() { localStorage.setItem(LIBRARY_KEY, JSON.stringify(library)) }
function sourceResponse() { return response({ success: true, userId: 'account-a', cloudRecord: { userId: 'account-a', version, checksum: computeSongbookChecksum(cloud), data: cloud } }) }
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://gtar.test' })
  global.window = dom.window; global.document = dom.window.document
  global.localStorage = dom.window.localStorage; global.sessionStorage = dom.window.sessionStorage
  global.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; this.querySelector('button')?.focus() }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  library = { songs: [
    { id: 'song-a', title: 'Alpha', artist: 'Author', rawContent: '{start_of_chorus}\n[C]Exact chart', format: 'CHORD_PRO', key: 'C', originalKey: 'D', confirmedChartKey: 'C', capo: '2', transposeOffset: -3, bpm: '90', time: '3/4', year: '2020' },
    { id: 'song-b', title: 'Beta', artist: '', rawContent: 'G\nSecond chart', format: 'TWO_LINE' },
  ], setlists: [{ id: 'set-a', name: 'Sunday', songs: [{ id: 'song-a', title: 'Alpha' }, { id: 'song-b', title: 'Beta' }, { id: 'song-a', title: 'Alpha' }] }] }
  cloud = structuredClone(library); version = 4; calls = []; session(); persist()
  responder = (url, options) => url === '/api/songbook/sync' ? sourceResponse() : options.method && options.method !== 'GET'
    ? response({ id, revision: options.method === 'POST' ? 1 : JSON.parse(options.body).expected_revision + 1, unpublished: options.method === 'DELETE' })
    : response({ setlists: [] })
  global.fetch = async (url, options = {}) => { calls.push({ url, ...options }); return responder(url, options) }
  sharedCatalogService.setAccount = () => {}
  sharedCatalogService.getCatalogSongs = async () => ({ songs: [], state: 'ONLINE', isStale: false, total: 0, hasMore: false })
  sharedCatalogService.getConfirmedActiveCatalogIds = async () => new Set()
})
afterEach(async () => { if (root) { await act(async () => root.unmount()); root = null } dom.window.close() })
const prepare = () => api.previewCatalogSetlist(id, 1)
let held = false
function host() { return { getLocal: () => library, blocked: () => false, applied: saved => { library = saved }, open: destination => { host.opened = destination } } }
async function mount(component) { root = createRoot(document.getElementById('root')); await act(async () => root.render(component)) }
function button(text) { return [...document.querySelectorAll('button')].find(el => el.textContent === text) }
async function click(element) { assert.ok(element, 'control exists'); await act(async () => element.click()) }
beforeEach(() => {
  held = false
  Object.defineProperty(global, 'navigator', { configurable: true, value: { locks: { request: async (_name, _options, callback) => {
    if (held) return callback(null)
    held = true; try { return callback({ name: 'lock' }) } finally { held = false }
  } } } })
  responder = () => response({ id, revision: 1, snapshot: snapshotFromSongbook(cloud, 'set-a') })
})
test('exact revision validated, no private fields, no stale fallback', async () => {
  const preview = await prepare()
  assert.equal(calls[0].url, `/api/catalog/setlists/${id}?revision=1`)
  assert.equal(calls[0].cache, 'no-store')
  assert.deepEqual(preview.snapshot.entries.map(s => s.title), ['Alpha', 'Beta', 'Alpha'])
  for (const bad of [{ id, revision: 2, snapshot: preview.snapshot }, { id: 'wrong', revision: 1, snapshot: preview.snapshot },
    { id, revision: 1, snapshot: { ...preview.snapshot, account: 'private' } }, { id, revision: 1, snapshot: { ...preview.snapshot, entries: [] } },
    { id, revision: 1, snapshot: { ...preview.snapshot, entries: [{ ...preview.snapshot.entries[0], id: 'private' }] } }]) {
    responder = () => response(bad); await assert.rejects(prepare)
  }
})
test('independent copies preserve repeats, every format, raw directives and all supported key metadata', async () => {
  cloud.songs.push({ id: 'plain', title: 'Plain', rawContent: '<script>unsafe()</script>', format: 'PLAIN' })
  cloud.setlists[0].songs.push({ id: 'plain', title: 'Plain' })
  const preview = await prepare(), cloned = api.cloneCatalogSetlist(preview)
  assert.equal(new Set(cloned.songs.map(s => s.id)).size, 4)
  assert.deepEqual(cloned.songs.map(s => s.format), ['CHORD_PRO', 'TWO_LINE', 'CHORD_PRO', 'PLAIN'])
  for (const key of Object.keys(preview.snapshot.entries[0])) assert.equal(cloned.songs[0][key], preview.snapshot.entries[0][key])
  cloned.songs[0].rawContent = 'edited'; cloned.setlist.name = 'edited'
  assert.notEqual(cloned.songs[2].rawContent, 'edited'); assert.equal(cloud.setlists[0].name, 'Sunday')
})
test('verified single library save, reload duplicate detection and real Open destination', async () => {
  const preview = await prepare(), h = host()
  const destination = await api.importCatalogSetlist(preview, h, { kind: 'new' })
  const saved = JSON.parse(localStorage.getItem(LIBRARY_KEY))
  assert.equal(saved.songs.length, 5); assert.equal(saved.setlists.length, 2)
  assert.equal(api.existingCatalogImports(saved, preview)[0].id, destination)
  api.openCatalogImport(destination, preview, h); assert.equal(host.opened, destination)
  await assert.rejects(api.importCatalogSetlist(preview, h, { kind: 'new' }), /Existing imports/)
  saved.setlists[1].isDeleted = true; localStorage.setItem(LIBRARY_KEY, JSON.stringify(saved)); library = saved
  assert.throws(() => api.openCatalogImport(destination, preview, h), /unavailable/)
  assert.equal(await api.importCatalogSetlist(preview, h, { kind: 'restore', existingId: destination }), destination)
})
test('deliberate duplicate and new revisions create separate copies; trash participates', async () => {
  const preview = await prepare(), h = host()
  const first = await api.importCatalogSetlist(preview, h, { kind: 'new' })
  const second = await api.importCatalogSetlist(preview, h, { kind: 'duplicate' }); assert.notEqual(first, second)
  library.setlists[1].isDeleted = true; persist()
  responder = () => response({ id, revision: 2, snapshot: snapshotFromSongbook(cloud, 'set-a') })
  const newer = await api.previewCatalogSetlist(id, 2)
  const third = await api.importCatalogSetlist(newer, h, { kind: 'revision' }); assert.notEqual(third, first)
  assert.equal(api.existingCatalogImports(library, preview).length, 3)
  assert.equal(api.existingCatalogImports(library, { ...preview, scope: 'https://other.test' }).length, 0)
})
test('duplicate taps, simultaneous-tab lock and unsupported locks fail closed', async () => {
  const preview = await prepare(), h = host()
  const running = api.importCatalogSetlist(preview, h, { kind: 'new' })
  await assert.rejects(api.importCatalogSetlist(preview, h, { kind: 'new' }), /progress/); await running
  held = true; await assert.rejects(api.importCatalogSetlist(preview, h, { kind: 'duplicate' }), /Another tab/)
  navigator.locks = undefined; await assert.rejects(api.importCatalogSetlist(preview, h, { kind: 'duplicate' }), /Web Locks/)
})
test('account switch and cross-tab or in-memory edits reject before writing', async () => {
  const preview = await prepare(), original = localStorage.getItem(LIBRARY_KEY)
  session('account-b'); await assert.rejects(api.importCatalogSetlist(preview, host(), { kind: 'new' }), /Account/)
  session()
  responder = () => { localStorage.setItem(LIBRARY_KEY, original + ' '); return response({ id, revision: 1, snapshot: snapshotFromSongbook(cloud, 'set-a') }) }
  await assert.rejects(api.importCatalogSetlist(preview, host(), { kind: 'new' }), /Library changed/)
  persist(); responder = () => { library.songs[0].title = 'draft'; return response({ id, revision: 1, snapshot: snapshotFromSongbook(cloud, 'set-a') }) }
  await assert.rejects(api.importCatalogSetlist(preview, host(), { kind: 'new' }), /Library changed/)
})
test('unpublish, disabled gate, network failure and malformed recheck never import cached preview', async () => {
  const preview = await prepare(), original = localStorage.getItem(LIBRARY_KEY)
  for (const status of [401, 403, 404, 410, 503]) {
    responder = () => response({ error: 'Unavailable' }, status)
    await assert.rejects(api.importCatalogSetlist(preview, host(), { kind: 'new' }))
    assert.equal(localStorage.getItem(LIBRARY_KEY), original)
  }
  responder = () => { throw new TypeError('offline') }; await assert.rejects(api.importCatalogSetlist(preview, host(), { kind: 'new' }))
})
test('quota, denied storage and recovery failures never apply partial library or false success', async () => {
  const preview = await prepare(), original = localStorage.getItem(LIBRARY_KEY), proto = dom.window.Storage.prototype, originalSet = proto.setItem
  for (const failedKey of [LIBRARY_KEY, 'recovery', 'all']) {
    proto.setItem = function(key, value) {
      if (failedKey === 'all' || key === failedKey || failedKey === 'recovery' && key !== LIBRARY_KEY) throw new DOMException('full', 'QuotaExceededError')
      return originalSet.call(this, key, value)
    }
    try { await assert.rejects(api.importCatalogSetlist(preview, host(), { kind: 'new' })); assert.equal(localStorage.getItem(LIBRARY_KEY), original) }
    finally { proto.setItem = originalSet }
  }
})
test('lineage survives backup, normalization and cloud serialization; equality/checksum include lineage', async () => {
  await api.importCatalogSetlist(await prepare(), host(), { kind: 'new' })
  const parsed = parseBackupJson(JSON.stringify(createBackupPayload(library.songs, library.setlists)))
  assert.equal(parsed.isValid, true, parsed.error)
  const normalized = normalizeSongbookIds(parsed.songs, parsed.setlists)
  assert.deepEqual(normalized.setlists[1].catalogSource, library.setlists[1].catalogSource)
  const roundtrip = JSON.parse(JSON.stringify(library)); assert.equal(computeSongbookChecksum(roundtrip), computeSongbookChecksum(library))
  roundtrip.setlists[1].catalogSource.revision++
  assert.notEqual(computeSongbookChecksum(roundtrip), computeSongbookChecksum(library))
  assert.equal(setlistEquals(roundtrip.setlists[1], library.setlists[1]), false)
  roundtrip.setlists[1].catalogSource.revision = 0
  assert.equal(parseBackupJson(JSON.stringify(createBackupPayload(library.songs, library.setlists)).replace('"revision":1','"revision":0')).isValid, false)
})
test('mobile dialog escapes injection, confirms import, reports local verification and opens actual ID', async () => {
  cloud.songs[0].title = '<script>unsafe()</script>'
  const h = host()
  await mount(React.createElement(CatalogImportContext.Provider, { value: h }, React.createElement(CatalogSetlistPreview, { id, revision: 1, onClose() {} })))
  assert.equal(document.querySelectorAll('script').length, 0)
  assert.ok(document.querySelector('dialog').open)
  await click(button('Import personal copy')); assert.equal(library.setlists.length, 1)
  await click(button('Confirm import'))
  assert.match(document.body.textContent, /saved and verified locally/)
  await click(button('Open Setlist')); assert.equal(host.opened, library.setlists[1].id)
})

test('cloud upload/download and conflicting setlist copies retain lineage and independent occurrences', async () => {
  await api.importCatalogSetlist(await prepare(), host(), { kind: 'new' })
  const uploaded = structuredClone(library)
  responder = (_url, options) => options.method === 'POST'
    ? response({ success: true, userId: 'account-a', cloudRecord: { userId: 'account-a', version: 1, checksum: computeSongbookChecksum(uploaded), data: uploaded } })
    : response({ success: true, userId: 'account-a', cloudRecord: null })
  const result = await performCloudSongbookSync('token-account-a', { forceAction: 'upload', localLibraryOverride: uploaded })
  assert.equal(result.status, 'IN_SYNC', result.error)
  assert.equal(result.actionTaken, 'UPLOADED')
  assert.deepEqual(result.updatedLibrary.setlists[1].catalogSource, uploaded.setlists[1].catalogSource)
  const wire = JSON.parse(JSON.stringify(result.updatedLibrary))
  localStorage.setItem(LIBRARY_KEY, JSON.stringify({ songs: [], setlists: [] }))
  responder = () => response({ success: true, userId: 'account-a', cloudRecord: { userId: 'account-a', version: 1, checksum: computeSongbookChecksum(wire), data: wire } })
  const downloaded = await performCloudSongbookSync('token-account-a', { forceAction: 'download' })
  assert.equal(downloaded.actionTaken, 'DOWNLOADED', downloaded.error)
  assert.deepEqual(downloaded.updatedLibrary.setlists[1].catalogSource, uploaded.setlists[1].catalogSource)
  const remote = structuredClone(uploaded); remote.setlists[1].name = 'Remote edit'
  library.setlists[1].name = 'Local edit'
  const merged = reconcileSongbook(library, remote, uploaded)
  assert.ok(merged.conflicts.length)
  const copies = merged.merged.setlists.filter(list => list.catalogSource)
  assert.ok(copies.length >= 2)
  for (const copy of copies) assert.deepEqual(copy.catalogSource, uploaded.setlists[1].catalogSource)
})

test('mid-request account switch, changed snapshot, recovery block and missing restored song fail closed', async () => {
  const preview = await prepare(), h = host(), original = localStorage.getItem(LIBRARY_KEY)
  responder = () => { session('account-b'); return response({ id, revision: 1, snapshot: preview.snapshot }) }
  await assert.rejects(api.importCatalogSetlist(preview, h, { kind: 'new' }), /Account/)
  session(); responder = () => response({ id, revision: 1, snapshot: { ...preview.snapshot, name: 'changed' } })
  await assert.rejects(api.importCatalogSetlist(preview, h, { kind: 'new' }), /Publication changed/)
  await assert.rejects(api.importCatalogSetlist(preview, { ...h, blocked: () => true }, { kind: 'new' }), /conflicts/)
  assert.equal(localStorage.getItem(LIBRARY_KEY), original)
  responder = () => response({ id, revision: 1, snapshot: preview.snapshot })
  const destination = await api.importCatalogSetlist(preview, h, { kind: 'new' })
  library.setlists[1].isDeleted = true; library.songs[2].isDeleted = true; persist()
  await assert.rejects(api.importCatalogSetlist(preview, h, { kind: 'restore', existingId: destination }), /Trash first/)
})
test('UI cancel never imports and failed persistence never offers Open Setlist', async () => {
  await mount(React.createElement(CatalogImportContext.Provider, { value: { ...host(), blocked: () => true } }, React.createElement(CatalogSetlistPreview, { id, revision: 1, onClose() {} })))
  await click(button('Import personal copy')); await click(button('Cancel import'))
  assert.equal(library.setlists.length, 1)
  await click(button('Import personal copy')); await click(button('Confirm import'))
  assert.equal(button('Open Setlist'), undefined); assert.equal(library.setlists.length, 1)
  assert.match(document.body.textContent, /conflicts/)
})

test('Open rejects stale chart state even when personal setlist identity still matches', async () => {
  const preview = await prepare(), h = host()
  const destination = await api.importCatalogSetlist(preview, h, { kind: 'new' })
  const external = JSON.parse(localStorage.getItem(LIBRARY_KEY)); external.songs[2].rawContent = 'other tab edit'
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(external))
  assert.throws(() => api.openCatalogImport(destination, preview, h), /unavailable/)
})


test('exact blocker categories reject before network revalidation and remain checked inside import lock', async () => {
  const preview = await prepare(), h = host(), original = localStorage.getItem(LIBRARY_KEY)
  for (const [reason, message] of [['editor-draft', /editor changes/], ['cross-tab-conflict', /active cross-tab/], ['actionable-recovery', /Review local recovery/], ['invalid-recovery', /invalid or unreadable/]]) {
    h.blockers = () => [reason]
    const count = calls.length
    await assert.rejects(api.importCatalogSetlist(preview, h, { kind: 'new' }), message)
    assert.equal(calls.length, count); assert.equal(localStorage.getItem(LIBRARY_KEY), original)
  }
  let checks = 0
  h.blockers = () => ++checks === 1 ? [] : ['actionable-recovery']
  await assert.rejects(api.importCatalogSetlist(preview, h, { kind: 'new' }), /Review local recovery/)
  assert.equal(localStorage.getItem(LIBRARY_KEY), original)
})
test('represented/raw archives permit clean import; genuine conflicts require explicit preserved decision', async () => {
  const { hasActionableRecovery, inspectRecovery, recordRecoveryChoice } = require('../src/utils/syncJournal.ts')
  localStorage.setItem('gtar_sync_recovery:replacement:1', JSON.stringify({ raw: JSON.stringify(library) }))
  const h = host(); h.blocked = () => hasActionableRecovery()
  await api.importCatalogSetlist(await prepare(), h, { kind: 'new' })
  localStorage.setItem('gtar_sync_recovery:download:1', JSON.stringify({ songs: [{ id: 'missing', title: 'Missing', rawContent: 'Kept in recovery' }], setlists: [] }))
  const preview = await prepare(), before = localStorage.getItem(LIBRARY_KEY)
  await assert.rejects(api.importCatalogSetlist(preview, h, { kind: 'duplicate' }), /Resolve editor/)
  await recordRecoveryChoice(inspectRecovery(), 'keep-current', () => false)
  assert.equal(localStorage.getItem(LIBRARY_KEY), before)
  await api.importCatalogSetlist(preview, h, { kind: 'duplicate' })
  assert.equal(library.songs.some(song => song.id === 'missing'), false)
  assert.equal(hasActionableRecovery(), false)
})
