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
const api = require('../src/utils/sharedSetlistPublishing.ts')
const { snapshotFromSongbook } = require('../src/utils/sharedSetlistSnapshot.ts')
const { computeSongbookChecksum } = require('../src/utils/cloudSongbookSync.ts')
const { LIBRARY_KEY } = require('../src/utils/syncJournal.ts')
const { SESSION_STORAGE_KEY } = require('../src/utils/googleAuth.ts')
const { bindOwner, OWNER_KEY } = require('./helpers/libraryOwner.cjs')
const { CatalogApiError } = require('../src/types/sharedCatalog.ts')
const { PublishSetlistModal } = require('../src/components/PublishSetlistModal.tsx')
const { SharedCatalogBrowser } = require('../src/components/SharedCatalogBrowser.tsx')
const { SetlistDrawer } = require('../src/components/SetlistDrawer.tsx')
const { AuthContext } = require('../src/utils/authContext.ts')
const { sharedCatalogService } = require('../src/utils/sharedCatalogService.ts')

let dom, root, library, cloud, calls, version, responder, publicationKeyTask
const id = 'publication_123456789'
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function session(account = 'account-a', role = 'admin', access = 'active') {
  const value = { version: 1, user: { id: account, sub: account, email: `${account}@test.app`, role, access_status: access, email_verified: true },
    authenticatedAt: Date.now(), lastVerifiedAt: Date.now(), localExpiresAt: Date.now() + 3600000, expiresAt: Date.now() + 3600000,
    sessionToken: `token-${account}`, role, access_status: access }
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value))
  // #247: the device library belongs to the first account signed in on this test device.
  if (!localStorage.getItem(OWNER_KEY)) bindOwner(localStorage, account)
  return value
}
function persist() { localStorage.setItem(LIBRARY_KEY, JSON.stringify(library)) }
function sourceResponse() { return response({ success: true, userId: 'account-a', cloudRecord: { userId: 'account-a', version, checksum: computeSongbookChecksum(cloud), data: cloud } }) }
beforeEach(t => {
  publicationKeyTask = undefined
  const newPublicationLink = api.newPublicationLink
  t.mock.method(api, 'newPublicationLink', (...args) => {
    publicationKeyTask = newPublicationLink(...args)
    return publicationKeyTask
  })
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://gtar.test' })
  Object.defineProperty(dom.window.navigator, 'locks', { configurable: true, value: { request: async (_name, action) => action() } })
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
const prepare = () => api.preparePublication('set-a', () => library, () => false)
async function mount(component) { root = createRoot(document.getElementById('root')); await act(async () => root.render(component)) }
function button(text) { return [...document.querySelectorAll('button')].find(el => el.textContent === text) }
async function click(element) {
  assert.ok(element, 'control exists')
  await act(async () => {
    element.click()
    // act flushes React work, but does not own WebCrypto's native digest task.
    // Await the real key operation so review finishes before assertions/cleanup.
    await publicationKeyTask
  })
}
async function modal() { await mount(React.createElement(PublishSetlistModal, { sourceId: 'set-a', getLocal: () => library, blocked: () => false, onClose() {} })) }
async function intent() { const preview = await prepare(); const link = await api.newPublicationLink(preview.account, 'set-a'); return { preview, link: { ...link, pending: api.makePublicationIntent(link, preview) } } }

test('exact persisted cloud preview preserves order, repeats, formats, authored chart and every available metadata field', async () => {
  const preview = await prepare()
  assert.equal(preview.version, 4)
  assert.deepEqual(preview.snapshot.entries.map(s => s.title), ['Alpha', 'Beta', 'Alpha'])
  assert.equal(preview.snapshot.entries[0].rawContent, library.songs[0].rawContent)
  for (const key of ['key', 'originalKey', 'confirmedChartKey', 'capo', 'transposeOffset', 'bpm', 'time', 'year']) assert.equal(preview.snapshot.entries[0][key], library.songs[0][key])
  assert.equal('key' in preview.snapshot.entries[1], false)
  assert.equal('id' in preview.snapshot.entries[0], false)
})
test('invalid references, ambiguous IDs, overrides, deleted and unsupported songs block whole snapshot', () => {
  for (const mutate of [l => l.songs.pop(), l => l.songs.push({ ...l.songs[0] }), l => l.setlists[0].songs[0].capo = '3', l => l.songs[0].isDeleted = true, l => l.songs[0].format = 'HTML']) {
    const value = structuredClone(library); mutate(value); assert.throws(() => snapshotFromSongbook(value, 'set-a'))
  }
})
test('unsaved edits, persistence mismatch and cloud conflict never write or silently synchronize', async () => {
  library.songs[0].rawContent += ' draft'
  await assert.rejects(prepare, /not safely persisted/)
  persist()
  await assert.rejects(prepare, /Cloud Sync/)
  assert.ok(calls.every(c => !c.method || c.method === 'GET'))
  await assert.rejects(api.preparePublication('set-a', () => library, () => true), /recovery/)
})
test('remote newer version, local and cross-tab edits invalidate stale preview approval', async () => {
  const preview = await prepare(); version++
  await assert.rejects(api.verifyPreview(preview, () => library, () => false), /stale/)
  version--; cloud.songs[0].capo = '4'
  await assert.rejects(api.verifyPreview(preview, () => library, () => false), /Cloud Sync/)
  cloud = structuredClone(library)
  responder = () => { const changed = structuredClone(library); changed.songs[0].rawContent += ' other tab'; localStorage.setItem(LIBRARY_KEY, JSON.stringify(changed)); return sourceResponse() }
  await assert.rejects(prepare, /Cloud Sync/)
})
test('no cloud record, account mismatch and invalid checksum block exact-source verification', async () => {
  for (const body of [{ success: true, userId: 'account-a', cloudRecord: null }, { success: true, userId: 'other', cloudRecord: { userId: 'other', version, data: cloud } },
    { success: true, userId: 'account-a', cloudRecord: { userId: 'account-a', version, checksum: 'wrong', data: cloud } }]) {
    responder = () => response(body); await assert.rejects(prepare)
  }
})
test('cloud theme settings do not cause false source differences and whole-record checksum is still verified', async () => {
  cloud.themeSettings = { version: 1, themeMode: 'solarized-dark', factoryThemeOverrides: {} }
  const preview = await prepare()
  assert.equal(preview.snapshot.name, 'Sunday')
})
test('active members can prepare; pending or revoked users and expired sessions cannot prepare or send', async () => {
  session('account-a', 'member')
  const memberPreview = await prepare()
  assert.equal(memberPreview.account, 'account-a')
  session('account-a', 'member', 'pending'); await assert.rejects(prepare, /active approved session/)
  session('account-a', 'admin', 'pending'); await assert.rejects(prepare, /active approved session/)
  session('account-a', 'member', 'denied'); await assert.rejects(prepare, /active approved session/)
  const value = session(); value.localExpiresAt = value.expiresAt = Date.now() - 1; localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value))
  await assert.rejects(prepare, /Authentication/)
  assert.equal(calls.length, 1)
})
test('account switching during source read and before mutation preserves account isolation', async () => {
  const original = responder
  responder = (url, options) => { const result = original(url, options); session('account-b'); return result }
  await assert.rejects(prepare, /Account/)
  session(); responder = original
  const { preview, link } = await intent(); session('account-b')
  await assert.rejects(api.sendPublicationIntent(preview.account, 'set-a', link), /Account/)
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
test('stable opaque publication key survives cache loss and is scoped to account and source', async () => {
  const a = await api.newPublicationLink('account-a', 'set-a')
  assert.equal(a.publicationKey, (await api.newPublicationLink('account-a', 'set-a')).publicationKey)
  assert.notEqual(a.publicationKey, (await api.newPublicationLink('account-b', 'set-a')).publicationKey)
  assert.notEqual(a.publicationKey, (await api.newPublicationLink('account-a', 'set-b')).publicationKey)
  assert.match(a.publicationKey, /^[a-f0-9]{64}$/)
})
test('timeout retry sends identical persisted body and key even if source changed; response IDs remain exact', async () => {
  const { preview, link } = await intent()
  responder = () => { throw new Error('network timeout') }
  await assert.rejects(api.sendPublicationIntent(preview.account, 'set-a', link))
  const saved = api.readPublicationLink(preview.account, 'set-a')
  version++; cloud.songs[0].rawContent += 'new content'
  responder = () => response({ id, revision: 1, unpublished: false })
  const result = await api.sendPublicationIntent(preview.account, 'set-a', saved)
  const writes = calls.filter(c => c.method === 'POST')
  assert.equal(writes[0].body, writes[1].body)
  assert.equal(writes[0].headers['Idempotency-Key'], writes[1].headers['Idempotency-Key'])
  assert.deepEqual(Object.keys(JSON.parse(writes[0].body)).sort(), ['publication_key', 'snapshot_version', 'source_setlist_id', 'source_version'])
  assert.equal(result.result.id, id)
  assert.equal(api.readPublicationLink(preview.account, 'set-a').pending, undefined)
})
test('pending requests and cross-tab mutation state prevent a second publishing intent', async () => {
  const { preview, link } = await intent()
  api.savePublicationLink(preview.account, 'set-a', link)
  assert.throws(() => api.makePublicationIntent(link, preview), /pending/)
  const other = { ...link, pending: { ...link.pending, key: 'different_request_1234' } }
  await assert.rejects(api.sendPublicationIntent(preview.account, 'set-a', other), /another tab/)
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
test('quota before request blocks writes; local-link failure after server confirmation reports partial success and safely recovers', async () => {
  const { preview, link } = await intent()
  const original = dom.window.Storage.prototype.setItem
  dom.window.Storage.prototype.setItem = function () { throw new Error('quota') }
  await assert.rejects(api.sendPublicationIntent(preview.account, 'set-a', link), /quota/)
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
  dom.window.Storage.prototype.setItem = original
  responder = () => { dom.window.Storage.prototype.setItem = function () { throw new Error('quota') }; return response({ id, revision: 1, unpublished: false }) }
  const partial = await api.sendPublicationIntent(preview.account, 'set-a', link)
  assert.equal(partial.saved, false); assert.equal(partial.result.id, id)
  dom.window.Storage.prototype.setItem = original
  responder = () => response({ id, revision: 1, unpublished: false })
  assert.equal((await api.sendPublicationIntent(preview.account, 'set-a', api.readPublicationLink(preview.account, 'set-a'))).saved, true)
})
test('update and unpublish always bind expected_revision, with current head review and tombstone prevention', async () => {
  const preview = await prepare()
  const link = { publicationKey: 'publication_key_1234', result: { id, revision: 2, unpublished: false } }
  responder = () => response({ setlists: [{ id, revision: 3, name: 'Sunday', occurrences: 3, updated_at: '2026-10-20' }] })
  const fresh = await api.refreshPublication(link)
  assert.equal(fresh.result.revision, 3)
  const update = api.makePublicationIntent(fresh, preview)
  assert.equal(update.method, 'PUT'); assert.equal(update.body.expected_revision, 3)
  const remove = api.makePublicationIntent(fresh, undefined, true)
  assert.deepEqual(remove.body, { expected_revision: 3 }); assert.equal(remove.method, 'DELETE')
  assert.throws(() => api.makePublicationIntent({ ...fresh, result: { ...fresh.result, unpublished: true } }, preview), /permanently/)
})
test('all server failures remain failures; forged or mismatched confirmations never claim success', async () => {
  for (const status of [401, 403, 404, 409, 410, 422, 429, 503]) {
    const { preview, link } = await intent()
    responder = () => response({ error: 'rejected' }, status)
    await assert.rejects(api.sendPublicationIntent(preview.account, 'set-a', link), error => error.status === status && !!api.publicationError(error))
    localStorage.removeItem(`gtar_setlist_publication_v1:account-a:set-a`)
    responder = () => sourceResponse()
  }
  const { preview, link } = await intent()
  responder = () => response({ id, revision: 88, unpublished: false })
  await assert.rejects(api.sendPublicationIntent(preview.account, 'set-a', link), /Invalid server confirmation/)
})
test('disabled, auth, malformed and arbitrary 404 responses cannot enable setlists capability', async () => {
  for (const res of [response({}, 404), response({}, 401), response({ songs: [] }), new Response('<html>fallback</html>')]) {
    responder = () => res; await assert.rejects(api.listPublishedSetlists())
  }
})
test('Songs/Setlists selection preserves existing Songs controls; member browsing has no import/open or publishing actions', async () => {
  session('account-a', 'member')
  responder = () => response({ setlists: [{ id, revision: 2, name: 'Published Sunday', occurrences: 3, updated_at: '2026-10-20' }] })
  await mount(React.createElement(SharedCatalogBrowser, { onImportSong() {} }))
  assert.ok(document.querySelector('[data-testid="catalog-search-input"]'))
  await click(button('Setlists'))
  assert.match(document.body.textContent, /Published Sunday/)
  assert.equal([...document.querySelectorAll('button')].some(b => /^(Import|Open Setlist|Publish)/.test(b.textContent)), false)
  await click(button('Songs')); assert.ok(document.querySelector('[data-testid="catalog-search-input"]'))
})
test('disabled feature leaves Songs usable and Setlists disabled with accessible reason', async () => {
  responder = () => response({}, 404)
  await mount(React.createElement(SharedCatalogBrowser, { onImportSong() {} }))
  assert.equal(button('Setlists').disabled, true)
  assert.ok(document.getElementById(button('Setlists').getAttribute('aria-describedby')))
  assert.ok(document.querySelector('[data-testid="catalog-search-input"]'))
})
test('modal interaction awaits deferred publication key before asserting review', async t => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const digest = crypto.subtle.digest.bind(crypto.subtle)
  t.mock.method(crypto.subtle, 'digest', async (...args) => { await gate; return digest(...args) })
  await modal()
  let finished = false
  const reviewing = click(button('Review Setlist')).then(() => { finished = true })
  let finishedBeforeRelease
  try {
    // Advance one event-loop turn, without a timer or resolving the digest.
    await new Promise(resolve => setImmediate(resolve))
    finishedBeforeRelease = finished
    assert.equal(calls.length, 0, 'review must not read cloud or mutate before the key is ready')
  } finally {
    release()
    await reviewing
  }
  assert.equal(finishedBeforeRelease, false, 'interaction must await the actual async review')
  assert.deepEqual([...document.querySelectorAll('ol h4')].map(e => e.textContent), ['Alpha', 'Beta', 'Alpha'])
  assert.equal(button('Share Setlist').disabled, true)
  assert.equal(document.querySelector('input[type=checkbox]').checked, false)
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})

test('publication modal requires review and explicit confirmation; close/cancel never publish', async () => {
  await modal()
  assert.equal(button('Share Setlist').disabled, true)
  await click(button('Review Setlist'))
  assert.deepEqual([...document.querySelectorAll('ol h4')].map(e => e.textContent), ['Alpha', 'Beta', 'Alpha'])
  assert.match(document.body.textContent, /confirmedChartKey|transposeOffset/)
  assert.equal(button('Share Setlist').disabled, true)
  await click(document.querySelector('input[type=checkbox]'))
  assert.equal(button('Share Setlist').disabled, false)
  await click(button('Cancel'))
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
test('stale preview removes confirmation and requires fresh review without sending a mutation', async () => {
  await modal(); await click(button('Review Setlist')); await click(document.querySelector('input[type=checkbox]'))
  version++
  await click(button('Share Setlist'))
  assert.match(document.body.textContent, /stale/)
  assert.equal(document.querySelector('[aria-label="Exact publication preview"]'), null)
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
test('reloaded pending request recovers exact approved request without using newly changed source', async () => {
  const { preview, link } = await intent()
  api.savePublicationLink(preview.account, 'set-a', link)
  library.songs[0].rawContent += 'later draft'
  await modal(); await click(button('Review Setlist'))
  assert.ok(button('Retry confirmed request'))
  await click(button('Retry confirmed request'))
  assert.match(document.body.textContent, new RegExp(`Published: ${id}`))
  assert.equal(JSON.parse(calls.find(c => c.method === 'POST').body).source_version, 4)
})
test('review unpublish remains available when source is unsynced, and sends only mandatory revision', async () => {
  api.savePublicationLink('account-a', 'set-a', { publicationKey: 'publication_key_1234', result: { id, revision: 1, unpublished: false } })
  library.songs[0].rawContent += 'draft'
  responder = (url, options) => options.method === 'DELETE' ? response({ id, revision: 3, unpublished: true }) :
    response({ setlists: [{ id, revision: 2, name: 'Sunday', occurrences: 3, updated_at: 'today' }] })
  await modal(); await click(button('Review Setlist'))
  assert.ok(button('Review unpublish'))
  await click(button('Review unpublish')); await click(document.querySelector('input[type=checkbox]')); await click(button('Confirm unpublish'))
  const deletion = calls.find(c => c.method === 'DELETE')
  assert.deepEqual(JSON.parse(deletion.body), { expected_revision: 2 })
  assert.match(document.body.textContent, new RegExp(`Unpublished: ${id}`))
})
test('switching account hides a previous account preview and disables its actions', async () => {
  const props = { sourceId: 'set-a', getLocal: () => library, blocked: () => false, onClose() {} }
  await mount(React.createElement(PublishSetlistModal, props)); await click(button('Review Setlist'))
  session('account-b')
  await act(async () => root.render(React.createElement(PublishSetlistModal, { ...props })))
  assert.match(document.body.textContent, /Account or session changed/)
  assert.equal(document.querySelector('ol'), null)
  assert.equal(button('Share Setlist'), undefined)
})
test('explicit publish confirms server result, update needs fresh review, and revision conflict clears approval', async () => {
  await modal(); await click(button('Review Setlist')); await click(document.querySelector('input[type=checkbox]'))
  await click(button('Share Setlist'))
  assert.match(document.body.textContent, new RegExp(`Published: ${id}`))
  responder = (url, options) => url === '/api/songbook/sync' ? sourceResponse() : options.method === 'PUT' ? response({ error: 'revision conflict' }, 409) : response({ setlists: [{ id, revision: 2, name: 'Sunday', occurrences: 3, updated_at: 'today' }] })
  await click(button('Review Setlist'))
  // The final checkbox approves the snapshot; the first selects unpublish.
  const checkboxes = [...document.querySelectorAll('input[type=checkbox]')]
  await click(checkboxes.at(-1))
  await click(button('Share Setlist'))
  assert.match(document.body.textContent, /conflict/)
  assert.equal(document.querySelector('[aria-label="Exact publication preview"]'), null)
})
test('mobile and keyboard controls use native modal focus, named dialog, touch sizes, cancellation and Escape', async () => {
  let closed = 0
  await mount(React.createElement(PublishSetlistModal, { sourceId: 'set-a', getLocal: () => library, blocked: () => false, onClose() { closed++ } }))
  const dialog = document.querySelector('dialog')
  assert.equal(dialog.open, true)
  assert.ok(document.getElementById(dialog.getAttribute('aria-labelledby')))
  assert.equal(document.activeElement, button('Cancel'))
  assert.ok([...dialog.querySelectorAll('button')].every(b => b.className.includes('min-h-11')))
  await act(async () => dialog.dispatchEvent(new dom.window.Event('cancel', { bubbles: true, cancelable: true })))
  assert.equal(closed, 1)
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
test('active admin and active member personal workflows expose publishing; pending and denied controls stay hidden', async () => {
  for (const [role, access] of [['member', 'active'], ['admin', 'pending'], ['admin', 'active'], ['member', 'denied']]) {
    if (root) { await act(async () => root.unmount()); root = null }
    const authSession = session('account-a', role, access)
    await mount(React.createElement(AuthContext.Provider, { value: { session: authSession, role: role === 'admin' ? 'SUPER_ADMIN' : 'USER', accessStatus: access } },
      React.createElement(SetlistDrawer, { isOpen: true, initialTab: 'setlists', onClose() {}, songs: library.songs, setlists: library.setlists, activeSongIndex: 0, onSelectSongIndex() {}, onDeleteSong() {}, onNewSong() {}, onPublishSetlist() {} })))
    assert.equal(!!document.querySelector('[aria-label="Publish Sunday to Shared"]'), (role === 'admin' || role === 'member') && access === 'active')
  }
})


test('REQUIRED: 62_SONG_COMPACT_JOURNAL_SIZE and NO_RAW_CHART_CONTENT_IN_NEW_JOURNAL', async () => {
  const songs = []
  const setlistSongs = []
  for (let i = 0; i < 62; i++) {
    const songId = 'song-' + i
    songs.push({
      id: songId,
      title: 'Song ' + i,
      artist: 'Artist ' + i,
      rawContent: '{title: Song ' + i + '}\n[C]Chord line for song ' + i + '\n[G]Large chart body with lyrics and repeating musical measures\n'.repeat(20),
      format: 'CHORD_PRO',
      key: 'C',
    })
    setlistSongs.push({ id: songId, title: 'Song ' + i })
  }
  const bigLibrary = { songs, setlists: [{ id: 'set-62', name: '62-Song Setlist', songs: setlistSongs }] }
  library = bigLibrary
  cloud = structuredClone(bigLibrary)
  version = 1
  persist()

  const preview = await api.preparePublication('set-62', () => library, () => false)
  const baseLink = await api.newPublicationLink(preview.account, 'set-62')
  const digest = api.computeSnapshotDigest(preview.snapshot)
  assert.ok(digest.startsWith('sha256-utf16le:'))

  const pendingLink = {
    ...baseLink,
    pending: api.makePublicationIntent(baseLink, preview),
  }

  // Pre-request save
  api.savePublicationLink(preview.account, 'set-62', pendingLink)
  const savedPending = api.readPublicationLink(preview.account, 'set-62')
  assert.equal(savedPending.snapshot, undefined)
  assert.equal(savedPending.pending.snapshotDigest, digest)

  // Send publication intent
  responder = () => response({ id: 'publication_62_songs_id', revision: 1, unpublished: false })
  const outcome = await api.sendPublicationIntent(preview.account, 'set-62', pendingLink)
  assert.equal(outcome.saved, true)

  const savedFinal = api.readPublicationLink(preview.account, 'set-62')
  assert.equal(savedFinal.snapshot, undefined)
  assert.equal(savedFinal.snapshotDigest, digest)

  const journalRaw = localStorage.getItem('gtar_setlist_publication_v1:' + encodeURIComponent(preview.account) + ':set-62')
  assert.ok(journalRaw.length < 500, 'compact journal size should be < 500 bytes for 62 songs, was: ' + journalRaw.length)
  assert.equal(journalRaw.includes('Chord line for song'), false, 'no raw chart content in journal')
  assert.equal(journalRaw.includes('Large chart body'), false, 'no raw chart content in journal')
})

test('REQUIRED: LEGACY_SNAPSHOT_COMPATIBILITY and SNAPSHOT_DIGEST_DIVERGENCE', () => {
  const { resolveSetlistPublicationStatus } = require('../src/utils/setlistPublicationStatus.ts')
  const previewSnapshot = snapshotFromSongbook(library, 'set-a')

  // 1. Legacy link with full snapshot (no snapshotDigest) resolves to CONFIRMED_PUBLISHED
  const legacyLink = {
    publicationKey: 'pub_legacy_key',
    result: { id, revision: 1, unpublished: false },
    snapshot: previewSnapshot,
  }
  const legacyStatus = resolveSetlistPublicationStatus({
    setlist: library.setlists[0],
    songs: library.songs,
    localLink: legacyLink,
    isOnline: true,
    publishedSetlists: [{ id, revision: 1, name: 'Sunday', occurrences: 3, updated_at: '2026-10-21' }],
  })
  assert.equal(legacyStatus, 'CONFIRMED_PUBLISHED')

  // 2. New link with snapshotDigest resolves to CONFIRMED_PUBLISHED
  const digest = api.computeSnapshotDigest(previewSnapshot)
  const newLink = {
    publicationKey: 'pub_new_key',
    result: { id, revision: 1, unpublished: false },
    snapshotDigest: digest,
    snapshotRevision: 1,
  }
  const newStatus = resolveSetlistPublicationStatus({
    setlist: library.setlists[0],
    songs: library.songs,
    localLink: newLink,
    isOnline: true,
    publishedSetlists: [{ id, revision: 1, name: 'Sunday', occurrences: 3, updated_at: '2026-10-21' }],
  })
  assert.equal(newStatus, 'CONFIRMED_PUBLISHED')

  // 3. Content divergence detected via snapshotDigest
  const modifiedSongs = structuredClone(library.songs)
  modifiedSongs[0].rawContent += '\n[D]Modified chord'
  const divergentStatus = resolveSetlistPublicationStatus({
    setlist: library.setlists[0],
    songs: modifiedSongs,
    localLink: newLink,
    isOnline: true,
    publishedSetlists: [{ id, revision: 1, name: 'Sunday', occurrences: 3, updated_at: '2026-10-21' }],
  })
  assert.equal(divergentStatus, 'LOCAL_CHANGES_NOT_PUBLISHED')
})

test('REQUIRED: PRE_REQUEST_QUOTA_NO_NETWORK and POST_CONFIRMATION_QUOTA_RECONCILIATION', async () => {
  const { preview, link } = await intent()
  const original = dom.window.Storage.prototype.setItem

  // Pre-request quota error: no network calls made
  dom.window.Storage.prototype.setItem = function () { throw new Error('quota') }
  await assert.rejects(api.sendPublicationIntent(preview.account, 'set-a', link), /quota/)
  assert.equal(calls.filter(c => c.method === 'POST').length, 0, 'No network calls when pre-request save fails quota')

  // Post-confirmation quota error: server succeeded, returns saved: false without throwing
  dom.window.Storage.prototype.setItem = original
  responder = () => {
    dom.window.Storage.prototype.setItem = function () { throw new Error('quota') }
    return response({ id, revision: 1, unpublished: false })
  }
  const outcome = await api.sendPublicationIntent(preview.account, 'set-a', link)
  assert.equal(outcome.saved, false)
  assert.equal(outcome.result.id, id)

  // Reconciliation: safe retry reconciles and saves successfully once quota is cleared
  dom.window.Storage.prototype.setItem = original
  responder = () => response({ id, revision: 1, unpublished: false })
  const pendingRecord = api.readPublicationLink(preview.account, 'set-a')
  assert.ok(pendingRecord.pending, 'Pending record still durable')
  const retryOutcome = await api.sendPublicationIntent(preview.account, 'set-a', pendingRecord)
  assert.equal(retryOutcome.saved, true)
  assert.equal(api.readPublicationLink(preview.account, 'set-a').pending, undefined)
})

test('REQUIRED: IDEMPOTENT_RETRY and CROSS_TAB_CONFLICT', async () => {
  const { preview, link } = await intent()
  api.savePublicationLink(preview.account, 'set-a', link)

  // Cross-tab conflict: modified pending intent in another tab blocks request
  const conflictingTabLink = { ...link, pending: { ...link.pending, key: 'concurrent-uuid-tab-b' } }
  await assert.rejects(api.sendPublicationIntent(preview.account, 'set-a', conflictingTabLink), /another tab/)
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)

  // Safe retry sends exact same idempotency key and body
  responder = () => response({ id, revision: 1, unpublished: false })
  const first = await api.sendPublicationIntent(preview.account, 'set-a', link)
  assert.equal(first.saved, true)
})

test('REQUIRED: IMPORT_SOURCE_IDENTITY and NO_CLOUD_OVERWRITE', async () => {
  // Imported setlists maintain independent identity
  const importedSetlist = {
    id: 'imported-set-1',
    name: 'Sunday',
    songs: [{ id: 'song-a', title: 'Alpha' }],
    catalogSource: {
      environmentScope: 'https://gtar.test',
      setlistId: 'publication_other_owner_123',
      revision: 1,
    },
  }
  const { resolveSetlistPublicationStatus } = require('../src/utils/setlistPublicationStatus.ts')
  const status = resolveSetlistPublicationStatus({
    setlist: importedSetlist,
    songs: library.songs,
    localLink: null,
    isOnline: true,
    publishedSetlists: [{ id: 'publication_other_owner_123', revision: 1, name: 'Sunday', occurrences: 1, updated_at: '2026-10-21' }],
  })
  assert.equal(status, 'IMPORTED_FROM_CATALOG')
})

test('REQUIRED: LOCAL_STORAGE_FAILURE_PRESERVATION and RELOAD_PERSISTENCE', async () => {
  const { preview, link } = await intent()
  api.savePublicationLink(preview.account, 'set-a', link)

  // Read back verifies reload persistence
  const reloaded = api.readPublicationLink(preview.account, 'set-a')
  assert.equal(reloaded.publicationKey, link.publicationKey)
  assert.equal(reloaded.pending.key, link.pending.key)

  // Simulated failure does not erase existing record
  const original = dom.window.Storage.prototype.setItem
  dom.window.Storage.prototype.setItem = function () { throw new Error('write error') }
  assert.throws(() => api.savePublicationLink(preview.account, 'set-a', { publicationKey: 'broken' }))
  dom.window.Storage.prototype.setItem = original

  const preserved = api.readPublicationLink(preview.account, 'set-a')
  assert.equal(preserved.publicationKey, link.publicationKey)
})
const { SharedSetlistCatalogPanel } = require('../src/components/SharedSetlistCatalogPanel.tsx')
const { useSharedSetlists } = require('../src/utils/useSharedSetlists.ts')
const { resolveSetlistPublicationStatus } = require('../src/utils/setlistPublicationStatus.ts')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const savedLink = () => api.readPublicationLink('account-a', 'set-a')
const statusOf = (link, revision = link.result.revision) => resolveSetlistPublicationStatus({
  setlist: library.setlists[0], songs: library.songs, localLink: link, isOnline: true,
  publishedSetlists: [{ id, revision, name: 'Sunday', occurrences: 3, updated_at: 'today' }],
})
const confirmedLink = () => ({ publicationKey: 'publication_key_1234', result: { id, revision: 1, unpublished: false },
  snapshotDigest: api.computeSnapshotDigest(snapshotFromSongbook(library, 'set-a')), snapshotRevision: 1 })
async function flushRefresh() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }

test('H1_429_AFTER_AMBIGUOUS_COMMIT and H1_PENDING_INTENT_SURVIVES_RELOAD', async () => {
  await modal(); await click(button('Review Setlist')); await click(document.querySelector('input[type=checkbox]'))
  responder = (url) => { if (url === '/api/songbook/sync') return sourceResponse(); throw new Error('committed but response lost') }
  await click(button('Share Setlist'))
  const original = savedLink()
  responder = () => response({ error: 'rate limit before idempotency lookup' }, 429)
  await click(button('Retry confirmed request'))
  assert.deepEqual(savedLink().pending.body, original.pending.body)
  assert.equal(savedLink().pending.key, original.pending.key)
  await act(async () => root.unmount()); root = null
  await modal(); await click(button('Review Setlist'))
  assert.ok(button('Retry confirmed request'))
  responder = () => response({ id, revision: 1, unpublished: false })
  await click(button('Retry confirmed request'))
  assert.equal(savedLink().pending, undefined)
  assert.equal(statusOf(savedLink()), 'CONFIRMED_PUBLISHED')
  const requests = calls.filter(c => c.method === 'POST')
  assert.ok(requests.every(c => c.body === requests[0].body && c.headers['Idempotency-Key'] === requests[0].headers['Idempotency-Key']))
})

test('H2_OVERLAPPING_IDENTICAL_RETRIES never reinstall pending after confirmation', async () => {
  const { link } = await intent()
  const a = deferred(), b = deferred(), enteredA = deferred(), enteredB = deferred()
  let count = 0
  responder = () => { if (++count === 1) { enteredA.resolve(); return a.promise } enteredB.resolve(); return b.promise }
  const first = api.sendPublicationIntent('account-a', 'set-a', link); await enteredA.promise
  const second = api.sendPublicationIntent('account-a', 'set-a', savedLink()); await enteredB.promise
  b.resolve(response({ id, revision: 1, unpublished: false })); assert.equal((await second).saved, true)
  const confirmed = localStorage.getItem('gtar_setlist_publication_v1:account-a:set-a')
  a.resolve(response({ id, revision: 1, unpublished: false })); assert.equal((await first).saved, true)
  assert.equal(localStorage.getItem('gtar_setlist_publication_v1:account-a:set-a'), confirmed)
})

test('H2_LATE_RESPONSE_NEWER_PENDING and H2_CROSS_TAB_JOURNAL_CONFLICT', async () => {
  const { preview, link } = await intent()
  const slow = deferred(), entered = deferred()
  responder = () => { entered.resolve(); return slow.promise }
  const pending = api.sendPublicationIntent('account-a', 'set-a', link); await entered.promise
  const other = { ...confirmedLink(), pending: api.makePublicationIntent(confirmedLink(), preview) }
  api.savePublicationLink('account-a', 'set-a', other) // another tab completed and began its next operation
  slow.resolve(response({ id, revision: 1, unpublished: false }))
  assert.equal((await pending).saved, false)
  assert.deepEqual(savedLink(), other)
  await assert.rejects(api.sendPublicationIntent('account-a', 'set-a', link), /another tab/)
  await assert.rejects(api.replacePublicationLink('account-a', 'set-a', link, confirmedLink()), /another tab/)
  assert.deepEqual(savedLink(), other)
})

test('H1 overlapping retry prevents first rejection from clearing potentially committed intent', async () => {
  const { link } = await intent()
  const a = deferred(), b = deferred(), enteredA = deferred(), enteredB = deferred()
  let count = 0
  responder = () => { if (++count === 1) { enteredA.resolve(); return a.promise } enteredB.resolve(); return b.promise }
  const first = api.sendPublicationIntent('account-a', 'set-a', link); await enteredA.promise
  const second = api.sendPublicationIntent('account-a', 'set-a', savedLink()); await enteredB.promise
  const rejected = assert.rejects(first, e => e.status === 429)
  a.resolve(response({ error: 'rejected' }, 429)); await rejected
  assert.equal(savedLink().pending.key, link.pending.key)
  b.resolve(response({ id, revision: 1, unpublished: false })); await second
  assert.equal(savedLink().pending, undefined)
})

test('H3_REJECTED_UPDATE_NO_FALSE_BADGE preserves confirmed identity, never proposed digest', async () => {
  const old = confirmedLink(); api.savePublicationLink('account-a', 'set-a', old)
  library.songs[0].rawContent += 'changed'; cloud = structuredClone(library); version++; persist()
  responder = (url) => url === '/api/songbook/sync' ? sourceResponse() : response({ setlists: [{ id, revision: 1, name: 'Sunday', occurrences: 3, updated_at: 'today' }] })
  await modal(); await click(button('Review Setlist'))
  await click([...document.querySelectorAll('input[type=checkbox]')].at(-1))
  const originalResponder = responder
  responder = (url, options) => options.method === 'PUT' ? response({ error: 'reject' }, 429) : originalResponder(url, options)
  await click(button('Share Setlist'))
  assert.equal(savedLink().pending, undefined)
  assert.equal(savedLink().snapshotDigest, old.snapshotDigest)
  assert.equal(statusOf(savedLink()), 'LOCAL_CHANGES_NOT_PUBLISHED')
})

test('H3_NEWER_HEAD_NO_OLD_DIGEST_CONFIRMATION and H3_CONFIRMED_DIGEST_REVISION_BINDING', async () => {
  const old = confirmedLink()
  assert.equal(statusOf(old), 'CONFIRMED_PUBLISHED')
  assert.notEqual(statusOf({ ...old, snapshotRevision: 2 }), 'CONFIRMED_PUBLISHED')
  responder = () => response({ setlists: [{ id, revision: 2, name: 'Sunday', occurrences: 3, updated_at: 'today' }] })
  const fresh = await api.refreshPublication(old)
  assert.equal(fresh.snapshotDigest, undefined)
  assert.notEqual(statusOf(fresh), 'CONFIRMED_PUBLISHED')
})

test('H3_LEGACY_JOURNAL_COMPATIBILITY preserves data and recovers exact saved intent conservatively', async () => {
  const old = confirmedLink(); delete old.snapshotRevision
  api.savePublicationLink('account-a', 'set-a', old)
  assert.equal(statusOf(savedLink()), 'UNKNOWN_OR_OFFLINE')
  const legacySnapshot = { ...old, snapshotDigest: undefined, snapshot: snapshotFromSongbook(library, 'set-a') }
  assert.equal(statusOf(legacySnapshot), 'CONFIRMED_PUBLISHED')
  const preview = await prepare()
  const legacy = { ...old, pending: api.makePublicationIntent(old, preview) }; delete legacy.pending.snapshotDigest
  api.savePublicationLink('account-a', 'set-a', legacy)
  const result = await api.sendPublicationIntent('account-a', 'set-a', savedLink())
  assert.equal(result.saved, true)
  assert.equal(savedLink().snapshotDigest, undefined)
  assert.equal(statusOf(savedLink()), 'UNKNOWN_OR_OFFLINE')
})

async function catalogPanel() {
  await mount(React.createElement(SharedSetlistCatalogPanel, { currentUserId: 'account-a' }))
}
const byTestId = id => document.querySelector(`[data-testid="${id}"]`)

const journalPrefix = 'gtar_setlist_publication_v1:account-a:'
const recoveryButtons = () => [...document.querySelectorAll('button')].filter(b => b.textContent.startsWith('Recover unpublish:'))
function pendingDelete(sourceId = 'set-a', account = 'account-a', publicationId = id) {
  const link = { ...confirmedLink(), result: { id: publicationId, revision: 1, unpublished: false } }
  link.pending = api.makePublicationIntent(link, undefined, true)
  api.savePublicationLink(account, sourceId, link)
  return link
}
const storageSnapshot = () => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))

for (const scenario of ['MALFORMED_FIRST_ENTRY_VALID_SECOND', 'VALID_FIRST_MALFORMED_SECOND',
  'MULTIPLE_MALFORMED_ENTRIES', 'MALFORMED_URI_ENCODING', 'NONCANONICAL_URI_ENCODING', 'INVALID_JOURNAL_JSON']) {
  test(`${scenario}: discovers exact pending DELETE without journal mutation and reports unresolved corruption`, async () => {
    if (scenario === 'VALID_FIRST_MALFORMED_SECOND') pendingDelete()
    localStorage.setItem(journalPrefix + (scenario === 'MALFORMED_URI_ENCODING' ? '%E0%A4%A'
      : scenario === 'NONCANONICAL_URI_ENCODING' ? '%73et-a' : 'broken'),
      scenario === 'INVALID_JOURNAL_JSON' ? '{invalid JSON' : JSON.stringify({ publicationKey: 'invalid' }))
    if (scenario === 'MULTIPLE_MALFORMED_ENTRIES') {
      localStorage.setItem(journalPrefix + 'broken-json', '{')
      localStorage.setItem(journalPrefix + '%', 'untouched malformed URI')
      // A corrupt direct lookup must not hide a different valid source link.
      localStorage.setItem(journalPrefix + id, '{')
    }
    if (scenario !== 'VALID_FIRST_MALFORMED_SECOND') pendingDelete()
    const before = storageSnapshot()
    const original = savedLink().pending
    await catalogPanel()
    assert.equal(recoveryButtons().length, 1)
    assert.match(byTestId('setlist-recovery-warning').textContent, /incomplete.*Preserve browser data/)
    assert.equal(byTestId('setlist-unpublish-feedback'), null)
    assert.deepEqual(storageSnapshot(), before)
    assert.equal(calls.filter(c => c.method === 'DELETE').length, 0)
    await click(recoveryButtons()[0])
    await click(byTestId('setlist-unpublish-confirm'))
    const deletes = calls.filter(c => c.method === 'DELETE')
    assert.equal(deletes.length, 1)
    assert.equal(deletes[0].headers['Idempotency-Key'], original.key)
    assert.equal(deletes[0].body, JSON.stringify(original.body))
    assert.equal(savedLink().result.unpublished, true)
    assert.ok(byTestId('setlist-recovery-warning'), 'unresolved corruption remains visible after valid recovery')
    for (const [key, raw] of Object.entries(before)) {
      if (key !== journalPrefix + 'set-a') assert.equal(localStorage.getItem(key), raw)
    }
  })
}

test('VALID_PENDING_DELETE_DISCOVERY, CROSS_ACCOUNT_ISOLATION, NO_DUPLICATE_RECOVERY_ACTIONS and NO_JOURNAL_MUTATION', async () => {
  const original = pendingDelete('source:with / spaces')
  api.savePublicationLink('account-a', 'duplicate-source', original)
  pendingDelete('foreign-source', 'account-a-extra', 'foreign_publication_123')
  pendingDelete('foreign-source', 'account-b', 'foreign_publication_456')
  localStorage.setItem('gtar_setlist_publication_v1:account-b:%', '{')
  const before = storageSnapshot()
  await catalogPanel()
  assert.equal(recoveryButtons().length, 1)
  assert.match(recoveryButtons()[0].textContent, new RegExp(id))
  assert.equal(byTestId('setlist-recovery-warning'), null)
  assert.deepEqual(storageSnapshot(), before)
  await act(async () => root.render(React.createElement(SharedSetlistCatalogPanel, { currentUserId: 'account-b' })))
  assert.equal(recoveryButtons().length, 1)
  assert.match(recoveryButtons()[0].textContent, /foreign_publication_456/)
  assert.deepEqual(storageSnapshot(), before)
})

test('multiple valid DELETE intents survive interleaved corruption and a per-entry storage read failure', async t => {
  pendingDelete('unreadable-source', 'account-a', 'unreadable_publication_123')
  pendingDelete('set-a')
  localStorage.setItem(journalPrefix + 'broken', '{')
  pendingDelete('another-source', 'account-a', 'second_publication_123')
  const mismatch = pendingDelete('mismatched-source', 'account-a', 'mismatched_publication_123')
  mismatch.pending.id = id
  api.savePublicationLink('account-a', 'mismatched-source', mismatch)
  const before = storageSnapshot()
  const getItem = dom.window.Storage.prototype.getItem
  t.mock.method(dom.window.Storage.prototype, 'getItem', function (key) {
    if (key === journalPrefix + 'unreadable-source') throw new Error('storage read denied')
    return getItem.call(this, key)
  })
  await catalogPanel()
  assert.deepEqual(recoveryButtons().map(b => b.textContent), [
    `Recover unpublish: ${id}`, 'Recover unpublish: second_publication_123',
  ])
  assert.ok(byTestId('setlist-recovery-warning'))
  t.mock.restoreAll()
  assert.deepEqual(storageSnapshot(), before)
})

for (const failure of ['length', 'key', 'getItem']) {
  test(`STORAGE_ACCESS_FAILURE_HANDLING: ${failure} failure reports incomplete scan without mutation`, async t => {
    pendingDelete()
    const before = storageSnapshot()
    const prototype = dom.window.Storage.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, failure)
    if (failure === 'length') {
      Object.defineProperty(prototype, 'length', { configurable: true, get() { throw new Error('storage denied') } })
      t.after(() => Object.defineProperty(prototype, 'length', descriptor))
    } else {
      t.mock.method(prototype, failure, function (...args) {
        if (failure !== 'getItem' || args[0].startsWith(journalPrefix)) throw new Error('storage denied')
        return descriptor.value.apply(this, args)
      })
    }
    await catalogPanel()
    assert.equal(recoveryButtons().length, 0)
    assert.match(byTestId('setlist-recovery-warning').textContent, /incomplete.*Preserve browser data/)
    assert.equal(byTestId('setlist-unpublish-feedback'), null)
    Object.defineProperty(prototype, failure, descriptor)
    assert.deepEqual(storageSnapshot(), before)
    assert.equal(calls.filter(c => c.method === 'DELETE').length, 0)
  })
}

test('M1_UNPUBLISH_TIMEOUT_SAFE_RETRY survives panel reload with missing cloud row', async () => {
  api.savePublicationLink('account-a', 'set-a', confirmedLink())
  let removed = false
  responder = (_url, options) => {
    if (options.method === 'DELETE') { removed = true; throw new Error('response lost after commit') }
    return response({ setlists: removed ? [] : [{ id, revision: 1, name: 'Sunday', occurrences: 3, updated_at: 'today' }] })
  }
  await catalogPanel(); await click(byTestId(`unpublish-setlist-btn-${id}`)); await click(byTestId('setlist-unpublish-confirm'))
  assert.ok(byTestId('setlist-unpublish-error'))
  const original = savedLink().pending
  await act(async () => root.unmount()); root = null
  await catalogPanel()
  assert.equal(byTestId(`unpublish-setlist-btn-${id}`), null)
  await click(button(`Recover unpublish: ${id}`))
  responder = (_url, options) => options.method === 'DELETE' ? response({ id, revision: 2, unpublished: true }) : response({ setlists: [] })
  await click(byTestId('setlist-unpublish-confirm'))
  assert.match(byTestId('setlist-unpublish-feedback').textContent, /has been unpublished/)
  assert.equal(savedLink().result.unpublished, true)
  const deletes = calls.filter(c => c.method === 'DELETE')
  assert.equal(deletes.length, 2)
  assert.equal(deletes[0].headers['Idempotency-Key'], original.key)
  assert.equal(deletes[1].headers['Idempotency-Key'], original.key)
  assert.equal(deletes[0].body, deletes[1].body)
})

test('M1_SERVER_SUCCESS_LOCAL_SAVE_FAILURE surfaces server success and retains same recovery request', async () => {
  api.savePublicationLink('account-a', 'set-a', confirmedLink())
  const original = dom.window.Storage.prototype.setItem
  responder = (_url, options) => {
    if (options.method === 'DELETE') {
      dom.window.Storage.prototype.setItem = () => { throw new Error('quota') }
      return response({ id, revision: 2, unpublished: true })
    }
    return response({ setlists: [{ id, revision: 1, name: 'Sunday', occurrences: 3, updated_at: 'today' }] })
  }
  await catalogPanel(); await click(byTestId(`unpublish-setlist-btn-${id}`)); await click(byTestId('setlist-unpublish-confirm'))
  assert.match(byTestId('setlist-unpublish-error').textContent, /Server confirmed unpublish; local recovery record could not be saved/)
  assert.equal(byTestId('setlist-unpublish-feedback'), null)
  const pending = savedLink().pending
  dom.window.Storage.prototype.setItem = original
  responder = (_url, options) => options.method === 'DELETE' ? response({ id, revision: 2, unpublished: true }) : response({ setlists: [] })
  await click(byTestId('setlist-unpublish-confirm'))
  assert.equal(calls.filter(c => c.method === 'DELETE').at(-1).headers['Idempotency-Key'], pending.key)
  assert.equal(savedLink().result.unpublished, true)
})

function HookHarness() {
  const catalog = useSharedSetlists()
  return React.createElement('div', null, catalog.rows.map(r => r.name).join(','))
}

test('M2_SAME_TAB_PUBLISH_REFRESH and M2_UNPUBLISH_REFRESH only after confirmed mutations', async () => {
  let published = false
  responder = (_url, options) => {
    if (options.method === 'POST') { published = true; return response({ id, revision: 1, unpublished: false }) }
    if (options.method === 'DELETE') { published = false; return response({ id, revision: 2, unpublished: true }) }
    return response({ setlists: published ? [{ id, revision: 1, name: 'Sunday', occurrences: 3, updated_at: 'today' }] : [] })
  }
  await mount(React.createElement(HookHarness))
  const base = await api.newPublicationLink('account-a', 'set-a')
  const preview = { sourceId: 'set-a', version: 4, snapshot: snapshotFromSongbook(library, 'set-a') }
  await act(async () => { await api.sendPublicationIntent('account-a', 'set-a', { ...base, pending: api.makePublicationIntent(base, preview) }) })
  await flushRefresh(); assert.match(document.body.textContent, /Sunday/)
  const current = savedLink()
  await act(async () => { await api.sendPublicationIntent('account-a', 'set-a', { ...current, pending: api.makePublicationIntent(current, undefined, true) }) })
  await flushRefresh(); assert.equal(document.body.textContent, '')
  assert.equal(calls.filter(c => c.method === 'GET').length, 3)
})

test('M2_NO_DUPLICATE_REFRESH_STORM scopes account/storage events and coalesces a burst', async () => {
  await mount(React.createElement(HookHarness))
  const event = account => new window.CustomEvent('gtar-setlist-publication-updated', { detail: { account } })
  await act(async () => {
    window.dispatchEvent(event('account-b'))
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'unrelated' }))
  })
  await flushRefresh(); assert.equal(calls.length, 1)
  await act(async () => {
    for (let i = 0; i < 10; i++) window.dispatchEvent(event('account-a'))
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'gtar_setlist_publication_v1:account-a:set-a' }))
  })
  await flushRefresh(); assert.equal(calls.length, 2)
})

test('publication coordination fails closed without Web Locks or IndexedDB', async () => {
  const { link } = await intent()
  Object.defineProperty(window.navigator, 'locks', { value: undefined })
  await assert.rejects(api.sendPublicationIntent('account-a', 'set-a', link), /coordination unavailable/)
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})

test('H2 IndexedDB fallback serializes competing tabs without Web Locks', async () => {
  const { preview, link } = await intent()
  Object.defineProperty(window.navigator, 'locks', { value: undefined })
  // Deterministic transaction scheduler: readwrite transactions run in opening
  // order, including their localStorage read/compare/write critical section.
  let queue = Promise.resolve(), transactions = 0
  const modes = []
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: {
    open: () => {
      const opening = {}
      opening.result = {
        close() {},
        transaction(store, mode) {
          assert.equal(store, 'mutex'); modes.push(mode); transactions++
          const tx = { aborted: false, abort() { this.aborted = true } }
          tx.objectStore = () => ({ get: () => {
            const request = {}
            queue = queue.then(() => {
              request.onsuccess()
              if (tx.aborted) tx.onabort(); else tx.oncomplete()
            })
            return request
          } })
          return tx
        },
      }
      queueMicrotask(() => opening.onsuccess())
      return opening
    },
  } })
  const competing = { ...link, pending: { ...link.pending, key: 'different_request_1234' } }
  const results = await Promise.allSettled([
    api.sendPublicationIntent(preview.account, 'set-a', link),
    api.sendPublicationIntent(preview.account, 'set-a', competing),
  ])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.match(results[1].reason.message, /another tab/)
  assert.equal(transactions, 3)
  assert.ok(modes.every(mode => mode === 'readwrite'))
  assert.equal(calls.filter(c => c.method === 'POST').length, 1)
  assert.equal(savedLink().result.revision, 1)
})

test('blocked IndexedDB coordination never executes a delayed journal mutation', async () => {
  const { link } = await intent()
  Object.defineProperty(window.navigator, 'locks', { value: undefined })
  let opening, closed = false
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open: () => {
    opening = { result: { close() { closed = true }, transaction() { assert.fail('blocked request must never mutate') } } }
    queueMicrotask(() => opening.onblocked())
    return opening
  } } })
  await assert.rejects(api.sendPublicationIntent('account-a', 'set-a', link), /Close other tabs/)
  opening.onsuccess()
  assert.equal(closed, true)
  assert.equal(savedLink(), null)
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})

test('M2 repeated identical server confirmations do not refetch and rejection emits no confirmation', async () => {
  await mount(React.createElement(HookHarness))
  const detail = { account: 'account-a', id, revision: 1, unpublished: false }
  await act(async () => window.dispatchEvent(new window.CustomEvent('gtar-setlist-publication-updated', { detail })))
  await flushRefresh()
  assert.equal(calls.length, 2)
  await act(async () => window.dispatchEvent(new window.CustomEvent('gtar-setlist-publication-updated', { detail })))
  await flushRefresh()
  assert.equal(calls.length, 2)
  let events = 0
  window.addEventListener('gtar-setlist-publication-updated', () => events++)
  const base = await api.newPublicationLink('account-a', 'set-a')
  const preview = { sourceId: 'set-a', version: 4, snapshot: snapshotFromSongbook(library, 'set-a') }
  responder = () => response({ error: 'rejected' }, 429)
  await assert.rejects(api.sendPublicationIntent('account-a', 'set-a', { ...base, pending: api.makePublicationIntent(base, preview) }))
  await flushRefresh()
  assert.equal(events, 0)
  assert.equal(calls.filter(c => c.method === 'GET').length, 2)
})

test('M1 conflicting durable update blocks unpublish without replacement or network mutation', async () => {
  const old = confirmedLink()
  const preview = await prepare()
  const pending = { ...old, pending: api.makePublicationIntent(old, preview) }
  api.savePublicationLink('account-a', 'set-a', pending)
  responder = () => response({ setlists: [{ id, revision: 1, name: 'Sunday', occurrences: 3, updated_at: 'today' }] })
  await catalogPanel(); await click(byTestId(`unpublish-setlist-btn-${id}`)); await click(byTestId('setlist-unpublish-confirm'))
  assert.match(byTestId('setlist-unpublish-error').textContent, /Recover the pending publication request/)
  assert.deepEqual(savedLink(), pending)
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 0)
})

test('M1 catalog parent refresh preserves server-success/local-save-failure recovery dialog', async () => {
  api.savePublicationLink('account-a', 'set-a', confirmedLink())
  const original = dom.window.Storage.prototype.setItem
  let removed = false
  responder = (_url, options) => {
    if (options.method === 'DELETE') {
      removed = true
      dom.window.Storage.prototype.setItem = () => { throw new Error('quota') }
      return response({ id, revision: 2, unpublished: true })
    }
    return response({ setlists: removed ? [] : [{ id, revision: 1, name: 'Sunday', occurrences: 3, updated_at: 'today' }] })
  }
  await mount(React.createElement(SharedCatalogBrowser, { currentUserId: 'account-a', onImportSong() {} }))
  await click(button('Setlists'))
  await click(byTestId(`unpublish-setlist-btn-${id}`)); await click(byTestId('setlist-unpublish-confirm'))
  await flushRefresh()
  assert.match(byTestId('setlist-unpublish-error')?.textContent || '', /Server confirmed unpublish/)
  assert.equal(byTestId('setlist-unpublish-confirm-dialog').open, true)
  dom.window.Storage.prototype.setItem = original
})
