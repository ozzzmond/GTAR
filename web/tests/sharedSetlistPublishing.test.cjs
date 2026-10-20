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
const prepare = () => api.preparePublication('set-a', () => library, () => false)
async function mount(component) { root = createRoot(document.getElementById('root')); await act(async () => root.render(component)) }
function button(text) { return [...document.querySelectorAll('button')].find(el => el.textContent === text) }
async function click(element) { assert.ok(element, 'control exists'); await act(async () => element.click()) }
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
test('members, inactive admins and expired sessions cannot prepare or send', async () => {
  session('account-a', 'member'); await assert.rejects(prepare, /active admin/)
  session('account-a', 'admin', 'pending'); await assert.rejects(prepare, /active admin/)
  const value = session(); value.localExpiresAt = value.expiresAt = Date.now() - 1; localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value))
  await assert.rejects(prepare, /Authentication/)
  assert.equal(calls.length, 0)
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
test('publication modal requires review and explicit confirmation; close/cancel never publish', async () => {
  await modal()
  assert.equal(button('Confirm publish').disabled, true)
  await click(button('Refresh and review'))
  assert.deepEqual([...document.querySelectorAll('ol h4')].map(e => e.textContent), ['Alpha', 'Beta', 'Alpha'])
  assert.match(document.body.textContent, /confirmedChartKey|transposeOffset/)
  assert.equal(button('Confirm publish').disabled, true)
  await click(document.querySelector('input[type=checkbox]'))
  assert.equal(button('Confirm publish').disabled, false)
  await click(button('Close'))
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
test('stale preview removes confirmation and requires fresh review without sending a mutation', async () => {
  await modal(); await click(button('Refresh and review')); await click(document.querySelector('input[type=checkbox]'))
  version++
  await click(button('Confirm publish'))
  assert.match(document.body.textContent, /stale/)
  assert.equal(document.querySelector('[aria-label="Exact publication preview"]'), null)
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
test('reloaded pending request recovers exact approved request without using newly changed source', async () => {
  const { preview, link } = await intent()
  api.savePublicationLink(preview.account, 'set-a', link)
  library.songs[0].rawContent += 'later draft'
  await modal(); await click(button('Refresh and review'))
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
  await modal(); await click(button('Refresh and review'))
  assert.ok(button('Review unpublish'))
  await click(button('Review unpublish')); await click(document.querySelector('input[type=checkbox]')); await click(button('Confirm unpublish'))
  const deletion = calls.find(c => c.method === 'DELETE')
  assert.deepEqual(JSON.parse(deletion.body), { expected_revision: 2 })
  assert.match(document.body.textContent, new RegExp(`Unpublished: ${id}`))
})
test('switching account hides a previous account preview and disables its actions', async () => {
  const props = { sourceId: 'set-a', getLocal: () => library, blocked: () => false, onClose() {} }
  await mount(React.createElement(PublishSetlistModal, props)); await click(button('Refresh and review'))
  session('account-b')
  await act(async () => root.render(React.createElement(PublishSetlistModal, { ...props })))
  assert.match(document.body.textContent, /Account or session changed/)
  assert.equal(document.querySelector('ol'), null)
  assert.equal(button('Confirm publish'), undefined)
})
test('explicit publish confirms server result, update needs fresh review, and revision conflict clears approval', async () => {
  await modal(); await click(button('Refresh and review')); await click(document.querySelector('input[type=checkbox]'))
  await click(button('Confirm publish'))
  assert.match(document.body.textContent, new RegExp(`Published: ${id}`))
  responder = (url, options) => url === '/api/songbook/sync' ? sourceResponse() : options.method === 'PUT' ? response({ error: 'revision conflict' }, 409) : response({ setlists: [{ id, revision: 2, name: 'Sunday', occurrences: 3, updated_at: 'today' }] })
  await click(button('Refresh and review'))
  // The final checkbox approves the snapshot; the first selects unpublish.
  const checkboxes = [...document.querySelectorAll('input[type=checkbox]')]
  await click(checkboxes.at(-1))
  await click(button('Confirm update'))
  assert.match(document.body.textContent, /conflict/)
  assert.equal(document.querySelector('[aria-label="Exact publication preview"]'), null)
})
test('mobile and keyboard controls use native modal focus, named dialog, touch sizes, cancellation and Escape', async () => {
  let closed = 0
  await mount(React.createElement(PublishSetlistModal, { sourceId: 'set-a', getLocal: () => library, blocked: () => false, onClose() { closed++ } }))
  const dialog = document.querySelector('dialog')
  assert.equal(dialog.open, true)
  assert.ok(document.getElementById(dialog.getAttribute('aria-labelledby')))
  assert.equal(document.activeElement, button('Close'))
  assert.ok([...dialog.querySelectorAll('button')].every(b => b.className.includes('min-h-11')))
  await act(async () => dialog.dispatchEvent(new dom.window.Event('cancel', { bubbles: true, cancelable: true })))
  assert.equal(closed, 1)
  assert.equal(calls.filter(c => c.method === 'POST').length, 0)
})
test('only active admin personal workflow exposes publishing; member and pending admin controls stay hidden', async () => {
  for (const [role, access] of [['member', 'active'], ['admin', 'pending'], ['admin', 'active']]) {
    if (root) { await act(async () => root.unmount()); root = null }
    const authSession = session('account-a', role, access)
    await mount(React.createElement(AuthContext.Provider, { value: { session: authSession, role: role === 'admin' ? 'SUPER_ADMIN' : 'USER', accessStatus: access } },
      React.createElement(SetlistDrawer, { isOpen: true, initialTab: 'setlists', onClose() {}, songs: library.songs, setlists: library.setlists, activeSongIndex: 0, onSelectSongIndex() {}, onDeleteSong() {}, onNewSong() {}, onPublishSetlist() {} })))
    assert.equal(!!document.querySelector('[aria-label="Publish Sunday to Shared Setlists"]'), role === 'admin' && access === 'active')
  }
})
