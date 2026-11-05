// #312 S2: App wiring for the DEV Setlist Manager: guarded saves survive a reload, cancel adds
// nothing, a stale write is refused, and manage remains available after removing the legacy drawer.
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
// react-dom detects input-event support from the global document when it loads.
const bootDom = new JSDOM('<!doctype html>')
Object.assign(global, { window: bootDom.window, document: bootDom.window.document })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const srcDir = path.join(__dirname, '../src')
const song = (id, title, artist, key) => ({ id, title, artist, key, capo: 'No Capo', bpm: '', format: 'CHORD_PRO', transposeOffset: 0, rawContent: `{title: ${title}}\n{key: ${key}}\n[${key}]Line` })
const LIBRARY = {
  songs: [song('s1', 'Amazing Grace', 'John Newton', 'G'), song('s2', 'Goodness of God', 'Bethel Music', 'Ab'),
    song('s3', 'Great Are You Lord', 'All Sons & Daughters', 'G'), song('s4', 'Hotel California', 'Eagles', 'Bm')],
  setlists: [{ id: 'sl-1', name: 'Sunday AM', createdAt: 1, songs: [{ id: 's1', title: 'Amazing Grace', artist: 'John Newton' }] }],
}

let dom, root, home
afterEach(async () => { if (root) { await act(async () => root.unmount()); root = null } dom?.window.close() })

function freshModules() {
  for (const key of Object.keys(require.cache)) if (key.startsWith(srcDir)) delete require.cache[key]
}
async function mountApp(url, { keepStorage = false, realHome = false, auth = null, requests = [] } = {}) {
  const previous = keepStorage ? dom.window.localStorage : null
  const saved = previous ? Object.fromEntries(Object.keys(previous).map(k => [k, previous.getItem(k)])) : null
  if (root) { await act(async () => root.unmount()); root = null }
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url })
  if (!dom.window.HTMLDialogElement.prototype.showModal) {
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  }
  if (!dom.window.HTMLDialogElement.prototype.close) {
    dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  }
  Object.assign(global, {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  global.fetch = async (url, options) => {
    requests.push([url, options])
    if (url === '/api/setlist/share') return new Response(JSON.stringify({ token: 'offline-test' }), { status: 200 })
    if (String(url).startsWith('/api/catalog/setlists')) {
      return new Response(JSON.stringify({ setlists: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    throw new Error('offline')
  }
  if (saved) for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v)
  else localStorage.setItem('gtar_library_v1', JSON.stringify(LIBRARY))
  freshModules()
  if (auth?.session) localStorage.setItem('gtar_auth_session', JSON.stringify(auth.session))
  const homeModule = require('../src/components/SongbookHomeView.tsx')
  const Home = homeModule.SongbookHomeView
  homeModule.SongbookHomeView = props => { home = props; return realHome ? React.createElement(Home, props) : React.createElement('div', null, 'Songbook') }
  require('../src/components/Header.tsx').Header = () => null
  const App = require('../src/App.tsx').default
  root = createRoot(document.getElementById('root'))
  const { AuthContext } = require('../src/utils/authContext.ts')
  await act(async () => root.render(React.createElement(AuthContext.Provider, { value: auth }, React.createElement(App))))
}
const stored = () => require('../src/utils/syncJournal.ts').readPersistedLibrary()
const storedOrder = () => stored().setlists.find(sl => sl.id === 'sl-1').songs.map(ref => ref.id)
const $ = sel => document.querySelector(sel)
const $$ = sel => [...document.querySelectorAll(sel)]
const button = text => $$('button').find(b => b.textContent.includes(text))
const option = text => $$('[role="option"]').find(el => el.textContent.includes(text))
async function click(el) { assert.ok(el, 'control exists'); await act(async () => el.click()) }
async function openManagerPicker() {
  await act(async () => home.onManageSetlist(home.setlists[0]))
  assert.ok($('[role="dialog"][aria-label="Setlist Manager"]'), 'DEV manage opens the Setlist Manager')
  await click(button('Search Multi-Songs'))
}

test('#346 workspace swipe delete: cancel preserves saved content; confirm soft-deletes through the existing manager handler', async () => {
  await mountApp('http://localhost/', { realHome: true })
  await act(async () => home.onSelectView({ type: 'ALL_SETLISTS' }))
  const before = localStorage.getItem('gtar_library_v1')
  const swipeDelete = async () => {
    const card = $('[data-testid="workspace-setlist-card-sl-1"]')
    for (const [type, x] of [['touchstart', 150], ['touchmove', 50], ['touchend', 50]]) {
      const event = new window.Event(type, { bubbles: true, cancelable: true })
      const point = { identifier: 1, clientX: x, clientY: 20 }
      Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [point] }, changedTouches: { value: [point] } })
      await act(async () => card.dispatchEvent(event))
      if (type === 'touchmove') assert.ok($('[aria-label="Delete"]'), 'swipe left reveals Delete')
    }
  }
  await swipeDelete()
  assert.match($('[data-testid="workspace-setlist-card-sl-1"]').textContent, /Delete this setlist\?/)
  assert.equal(localStorage.getItem('gtar_library_v1'), before)
  await click($('[data-testid="cancel-delete-setlist-sl-1"]'))
  assert.equal(localStorage.getItem('gtar_library_v1'), before)
  assert.equal($('[data-testid="confirm-delete-setlist-sl-1"]'), null)
  assert.ok($('[data-testid="workspace-setlist-card-sl-1"]'))
  await swipeDelete()
  await click($('[data-testid="confirm-delete-setlist-sl-1"]'))
  assert.equal($('[data-testid="workspace-setlist-card-sl-1"]'), null)
  assert.equal(stored().setlists.find(sl => sl.id === 'sl-1').isDeleted, true)
  assert.equal(stored().songs.length, LIBRARY.songs.length)
  await mountApp('http://localhost/', { keepStorage: true })
  assert.equal(home.setlists.find(sl => sl.id === 'sl-1').isDeleted, true, 'soft-delete survives reload')
})

test('#346 real signed-out App opens local share from header, menu and swipe without a share request', async () => {
  const requests = []
  await mountApp('http://localhost/', { realHome: true, requests })
  await act(async () => home.onSelectView({ type: 'ALL_SETLISTS' }))
  const assertLocalShare = () => {
    const modal = $('[data-testid="share-setlist-modal-card"]')
    assert.ok(modal)
    assert.match(modal.textContent, /Sign in to create a QR code \/ share link\./)
    assert.ok(button('Export JSON'))
    assert.equal(modal.querySelector('img'), null)
    assert.equal(modal.querySelector('input'), null)
    assert.equal(button('Copy'), undefined)
    assert.equal(button('Revoke Share Link'), undefined)
    assert.equal(requests.filter(([url]) => url === '/api/setlist/share').length, 0)
  }
  await click($('[data-testid="workspace-setlist-card-sl-1"]'))
  await click($('[data-testid="workspace-setlist-header"] [aria-label="Share Setlist"]'))
  assertLocalShare()
  const downloads = []
  const originalClick = window.HTMLAnchorElement.prototype.click
  window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download) }
  try { await click(button('Export JSON')); assert.deepEqual(downloads, ['gtar-setlist-sunday-am.json']) }
  finally { window.HTMLAnchorElement.prototype.click = originalClick }
  await click($('[data-testid="share-setlist-modal-card"] [aria-label="Close"]'))
  await click($('[data-testid="workspace-scope-menu-btn"]'))
  await click($('[data-testid="workspace-menu-share"]'))
  assertLocalShare()
  await click($('[data-testid="share-setlist-modal-card"] [aria-label="Close"]'))
  await click($('[data-testid="workspace-crumb-scope"]'))
  await click($('[data-testid="workspace-scope-menu-btn"]'))
  await click($('[data-testid="workspace-menu-share"]'))
  assertLocalShare()
  await click($('[data-testid="share-setlist-modal-card"] [aria-label="Close"]'))
  const card = $('[data-testid="workspace-setlist-card-sl-1"]')
  for (const [type, x] of [['touchstart', 150], ['touchmove', 250], ['touchend', 250]]) {
    const event = new window.Event(type, { bubbles: true, cancelable: true })
    const point = { identifier: 1, clientX: x, clientY: 20 }
    Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [point] }, changedTouches: { value: [point] } })
    await act(async () => card.dispatchEvent(event))
    if (type === 'touchmove') assert.ok($('[data-armed="true"][aria-label="Share Setlist"]'))
  }
  assertLocalShare()
})

for (const accessStatus of ['active', 'pending']) test(`#346 real ${accessStatus} App gates the QR section while keeping local export`, async () => {
  const requests = [], now = Date.now()
  const session = { version: 1, user: { id: 'owner', sub: 'owner', email: 'owner@example.test', access_status: accessStatus },
    sessionToken: 'offline-token', access_status: accessStatus, authenticatedAt: now, lastVerifiedAt: now, localExpiresAt: now + 3600000, expiresAt: now + 3600000 }
  await mountApp('http://localhost/', { realHome: true, requests, auth: { session, accessStatus, role: 'USER' } })
  await act(async () => home.onSelectView({ type: 'ALL_SETLISTS' }))
  await click($('[data-testid="workspace-setlist-card-sl-1"]'))
  await click($('[data-testid="workspace-setlist-header"] [aria-label="Share Setlist"]'))
  const modal = $('[data-testid="share-setlist-modal-card"]')
  assert.ok(modal)
  assert.ok(button('Export JSON'))
  const shares = requests.filter(([url]) => url === '/api/setlist/share')
  if (accessStatus === 'active') {
    assert.equal(shares.length, 1)
    assert.equal(JSON.parse(shares[0][1].body).name, 'Sunday AM')
    assert.ok(modal.querySelector('img[alt="QR Code for Setlist Sharing"]'))
    assert.match(modal.querySelector('input').value, /\?share=offline-test$/)
    assert.ok(button('Copy'))
    assert.ok(button('Revoke Share Link'))
  } else {
    assert.equal(shares.length, 0)
    assert.equal(modal.querySelector('img'), null)
    assert.equal(modal.querySelector('input'), null)
    assert.match(modal.textContent, /Sign in to create a QR code \/ share link\./)
  }
})

test('DEV: select N songs → one guarded add, appended in selection order, kept after reload', async () => {
  await mountApp('http://localhost/')
  assert.equal(typeof home.onOpenSetlistManager, 'function', 'DEV wires ⋯ Manage Setlists to the manager')
  await openManagerPicker()
  await click(option('Hotel California'))
  await click(option('Goodness of God'))
  await click(option('Great Are You Lord'))
  await click(button('Add 3 Selected Songs'))
  assert.deepEqual(storedOrder(), ['s1', 's4', 's2', 's3'], 'saved immediately, in selection order')
  assert.equal($('[aria-label="Multi-song search picker"]'), null)
  await mountApp('http://localhost/', { keepStorage: true })
  assert.deepEqual(home.setlists.find(sl => sl.id === 'sl-1').songs.map(ref => ref.id), ['s1', 's4', 's2', 's3'], 'reload keeps it')
})

test('DEV: cancel adds nothing', async () => {
  await mountApp('http://localhost/')
  const before = localStorage.getItem('gtar_library_v1')
  await openManagerPicker()
  await click(option('Hotel California'))
  await click(button('Cancel'))
  assert.equal($('[aria-label="Multi-song search picker"]'), null)
  assert.equal(localStorage.getItem('gtar_library_v1'), before)
  assert.deepEqual(home.setlists[0].songs.map(ref => ref.id), ['s1'])
})

test('DEV: a stale write is refused, reported, and leaves the other tab\'s save untouched', async () => {
  await mountApp('http://localhost/')
  await openManagerPicker()
  const external = JSON.stringify({ ...LIBRARY, setlists: [{ ...LIBRARY.setlists[0], name: 'Changed elsewhere' }] })
  localStorage.setItem('gtar_library_v1', external)
  await click(option('Eagles'))
  await click(button('Add 1 Selected Song'))
  assert.ok($('[aria-label="Multi-song search picker"]'), 'picker stays open on failure')
  assert.match($('[role="dialog"][aria-label="Multi-song search picker"] [role="alert"]').textContent, /not added/i)
  assert.equal(localStorage.getItem('gtar_library_v1'), external, 'no overwrite')
})

test('DEV: rename, reorder, remove and delete persist through the guarded path', async () => {
  await mountApp('http://localhost/')
  const twoSongs = { ...LIBRARY, setlists: [{ ...LIBRARY.setlists[0], songs: [{ id: 's1', title: 'Amazing Grace' }, { id: 's2', title: 'Goodness of God' }, { id: 's3', title: 'Great Are You Lord' }] }] }
  localStorage.setItem('gtar_library_v1', JSON.stringify(twoSongs))
  await mountApp('http://localhost/', { keepStorage: true })
  await act(async () => home.onOpenSetlistManager(null))
  await click(button('Rename'))
  const input = $('[data-testid="setlist-manager-rename-input"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'Sunday PM')
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await click(button('Save'))
  assert.equal(stored().setlists[0].name, 'Sunday PM')
  await click($('[data-testid="setlist-manager-entry-0-down"]'))
  assert.deepEqual(storedOrder(), ['s2', 's1', 's3'])
  await click($('[data-testid="setlist-manager-entry-2-remove"]'))
  assert.deepEqual(storedOrder(), ['s2', 's1'])
  await click(button('Delete Setlist'))
  await click($$('[role="alertdialog"] button').find(b => b.textContent === 'Delete'))
  assert.equal(stored().setlists[0].isDeleted, true, 'tombstoned like the existing delete')
  await mountApp('http://localhost/', { keepStorage: true })
  assert.equal(home.setlists.filter(sl => !sl.isDeleted).length, 0)
})

// #311 removes the legacy drawer in every build; manage must retain its replacement action.
test('manage remains available without the legacy drawer outside local development', async () => {
  await mountApp('https://gtar.example/')
  assert.equal(typeof home.onOpenSetlistManager, 'function')
  await act(async () => home.onManageSetlist(home.setlists[0]))
  assert.ok($('[role="dialog"][aria-label="Setlist Manager"]'))
})

test('#379: App wires onPublishSetlist to SetlistManager and opens PublishSetlistModal for eligible session', async () => {
  const memberSession = {
    version: 1,
    user: { id: 'user-member-1', sub: 'user-member-1', email: 'member@example.com', role: 'member', access_status: 'active', email_verified: true },
    role: 'member',
    access_status: 'active',
    sessionToken: 'token-abc',
    localExpiresAt: Date.now() + 3600000,
    expiresAt: Date.now() + 3600000,
    authenticatedAt: Date.now(),
    lastVerifiedAt: Date.now(),
  }
  await mountApp('http://localhost/', { auth: { session: memberSession, accessStatus: 'active', role: 'member' } })
  await act(async () => home.onOpenSetlistManager(home.setlists[0]))
  assert.ok($('[role="dialog"][aria-label="Setlist Manager"]'), 'Setlist Manager is open')

  const publishBtn = $('[data-testid="setlist-manager-publish-btn"]')
  assert.ok(publishBtn, 'Publish button is rendered in Setlist Manager for eligible member')

  await click(publishBtn)
  // Publishing modal opens, personal setlist remains untouched
  assert.ok($('dialog[aria-labelledby="publish-setlist-title"]'), 'PublishSetlistModal opened')
  assert.equal(stored().setlists[0].name, 'Sunday AM', 'personal setlist unaffected')
  assert.equal(stored().setlists[0].isDeleted, undefined, 'personal setlist not deleted')
})
