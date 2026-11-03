const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/tabHarness.cjs')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
const { ShareSetlistModal } = require('../src/components/ShareSetlistModal.tsx')
const { AuthContext } = require('../src/utils/authContext.ts')
const { ExplorerDragDrop } = require('../src/components/ExplorerDragDrop.tsx')

let root, host, requests
const songs = [{ id: 'song', title: 'Alpha', artist: 'Band', key: 'C', format: 'CHORD_PRO', rawContent: '{key: C}\n[C]Words' }]
const lists = [{ id: 'first', name: 'First', songs: [] }, { id: 'second', name: 'Second', folderId: 'folder', songs: [{ id: 'song', title: 'Alpha' }] }]
const auth = { session: { user: { id: 'owner' } }, accessStatus: 'active' }
beforeEach(() => {
  h.freshStorage()
  const now = Date.now()
  localStorage.setItem('gtar_auth_session', JSON.stringify({ version: 1, user: { id: 'owner', sub: 'owner', email: 'owner@example.test', access_status: 'active' }, sessionToken: 'test-token', access_status: 'active', authenticatedAt: now, lastVerifiedAt: now, localExpiresAt: now + 3600000, expiresAt: now + 3600000 }))
  Object.assign(global, { IS_REACT_ACT_ENVIRONMENT: true, HTMLElement: window.HTMLElement, Node: window.Node, Event: window.Event, CustomEvent: window.CustomEvent, sessionStorage: window.sessionStorage, requestAnimationFrame: fn => fn() })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  requests = []
  global.fetch = async (url, options) => {
    requests.push([url, options])
    return new Response(JSON.stringify(url === '/api/setlist/share' ? { token: 'offline-test' } : { setlists: [] }), { status: 200 })
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const find = id => host.querySelector(`[data-testid="${id}"]`)
const button = label => [...host.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === label || el.textContent.trim() === label)
async function click(el) { assert.ok(el, 'control exists'); await act(async () => el.click()) }
async function mount(extra = {}, drag = null) {
  function Harness() {
    const [sharing, setSharing] = React.useState(null)
    return React.createElement(AuthContext.Provider, { value: auth },
      drag && React.createElement(ExplorerDragDrop, { songs, setlists: lists, folders: [{ id: 'folder', name: 'Folder', parentId: null }], onTag() {}, onSetlist() {}, onTrash() {}, ...drag }),
      React.createElement(SongbookHomeView, { songs, setlists: lists, confirmedCatalogIds: new Set(), activeSongIndex: 0, onSelectSong() {}, onNewSong() {}, onOpenSetlists() {}, onDeleteSong() {}, onSongMembershipChange() {}, onCreateSetlistForSong() {}, view: { type: 'ALL_SETLISTS' }, onShareSetlist: setSharing, ...extra }),
      sharing && React.createElement(ShareSetlistModal, { setlist: sharing, allSongs: songs, onClose: () => setSharing(null) }))
  }
  await act(async () => root.render(React.createElement(Harness)))
}
async function touch(el, type, x, y = 20) {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  const point = { identifier: 1, clientX: x, clientY: y }
  Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [point] }, changedTouches: { value: [point] } })
  await act(async () => el.dispatchEvent(event))
  return event
}
async function swipe(id, delta) {
  const card = find(`workspace-setlist-card-${id}`)
  await touch(card, 'touchstart', 150)
  await touch(card, 'touchmove', 150 + delta)
  return card
}

test('#346 open-setlist header shares the selected setlist through the existing QR dialog', async () => {
  await mount()
  await click(find('workspace-setlist-card-second'))
  await click(find('workspace-setlist-header').querySelector('[aria-label="Share Setlist"]'))
  assert.match(find('share-setlist-modal-card').textContent, /Second \(1 song\)/)
  const share = requests.find(([url]) => url === '/api/setlist/share')
  assert.ok(share, 'existing share dialog creates its snapshot')
  assert.equal(JSON.parse(share[1].body).name, 'Second')
})

test('#346 QR dialog Export JSON downloads the existing single-setlist format', async () => {
  await act(async () => root.render(React.createElement(ShareSetlistModal, { setlist: lists[1], allSongs: songs, onClose() {} })))
  const downloads = []
  const originalClick = window.HTMLAnchorElement.prototype.click
  window.HTMLAnchorElement.prototype.click = function () { downloads.push({ filename: this.download, blob: resolveObjectURL(this.href) }) }
  try {
    assert.equal(button('Share Link'), undefined)
    await click(button('Export JSON'))
    assert.equal(downloads.length, 1)
    assert.equal(downloads[0].filename, 'gtar-setlist-second.json')
    const payload = JSON.parse(await downloads[0].blob.text())
    assert.equal(payload.exportType, 'SINGLE_SETLIST')
    assert.equal(payload.setlist.name, 'Second')
    assert.equal(payload.setlist.songs[0].title, 'Alpha')
    assert.ok(button('Revoke Share Link'))
    assert.ok(button('Copy'))
    assert.ok(button('Close'))
  } finally { window.HTMLAnchorElement.prototype.click = originalClick }
})

const { resolveObjectURL } = require('node:buffer')

test('#346 local export stays available while QR creation loads, and sign-out hides an in-flight QR result', async () => {
  let finishShare
  global.fetch = () => new Promise(resolve => { finishShare = resolve })
  const render = async value => act(async () => root.render(React.createElement(AuthContext.Provider, { value },
    React.createElement(ShareSetlistModal, { setlist: lists[1], allSongs: songs, onClose() {} }))))
  await render(auth)
  assert.ok(finishShare)
  assert.ok(button('Export JSON'))
  assert.match(host.textContent, /Creating snapshot/)
  // Stored credentials remain, so this exercises the live context gate too.
  await render({ session: null, accessStatus: 'pending' })
  assert.match(host.textContent, /Sign in to create a QR code \/ share link\./)
  assert.ok(button('Export JSON'))
  assert.equal(button('Close').disabled, false)
  await act(async () => finishShare(new Response(JSON.stringify({ token: 'late-share' }), { status: 200 })))
  assert.equal(host.querySelector('img'), null)
  assert.equal(host.querySelector('input'), null)
  assert.equal(button('Revoke Share Link'), undefined)
})

test('#346 swipe right reveals Share Setlist and opens the selected QR dialog without opening the card', async () => {
  await mount({ view: { type: 'FOLDER', folderId: 'folder' }, folders: [{ id: 'folder', name: 'Folder', parentId: null }] })
  const card = await swipe('second', 100)
  assert.ok(host.querySelector('[aria-label="Share Setlist"]'))
  await touch(card, 'touchend', 250)
  assert.match(find('share-setlist-modal-card').textContent, /Second \(1 song\)/)
  await click(card)
  assert.equal(find('workspace-setlist-header'), null, 'swipe-generated click does not open the setlist')
})

test('#346 setlist swipe and held/native drag stay separate; tap and keyboard still open', async () => {
  let lifted = 0
  const moved = []
  window.requestAnimationFrame = cb => window.setTimeout(() => cb(0), 16)
  window.cancelAnimationFrame = id => window.clearTimeout(id)
  await mount({}, { onFolder: (...args) => moved.push(args), onTouchDrag: () => { lifted++ } })
  const target = document.createElement('div')
  target.dataset.explorerDropFolder = 'folder'; host.append(target)
  document.elementFromPoint = () => target
  let card = await swipe('first', 100)
  const nativeDuringSwipe = new window.Event('dragstart', { bubbles: true, cancelable: true })
  await act(async () => card.dispatchEvent(nativeDuringSwipe))
  assert.equal(nativeDuringSwipe.defaultPrevented, true)
  await act(async () => h.settle(430))
  assert.equal(lifted, 0, 'swiping cancels the drag hold')
  await touch(card, 'touchend', 250)
  await click(button('Close'))
  await touch(card, 'touchstart', 150)
  await act(async () => h.settle(430))
  assert.equal(lifted, 1)
  assert.equal(card.dataset.explorerDragActive, 'true')
  const shareCount = requests.filter(([url]) => url === '/api/setlist/share').length
  await touch(card, 'touchmove', 250)
  await touch(card, 'touchend', 250)
  assert.deepEqual(moved, [['first', 'folder']])
  assert.equal(requests.filter(([url]) => url === '/api/setlist/share').length, shareCount, 'drag does not share')
  assert.equal(find('share-setlist-modal-card'), null)
  await act(async () => h.settle(510))
  const start = new window.Event('dragstart', { bubbles: true, cancelable: true })
  await act(async () => card.dispatchEvent(start))
  assert.equal(card.dataset.explorerDragActive, 'true', 'native drag retains #340 source')
  await act(async () => target.dispatchEvent(new window.Event('drop', { bubbles: true, cancelable: true })))
  assert.deepEqual(moved, [['first', 'folder'], ['first', 'folder']])
  await touch(card, 'touchstart', 150)
  await touch(card, 'touchend', 150)
  await click(card)
  assert.match(find('workspace-setlist-header').textContent, /First/)
  await click(find('workspace-crumb-scope'))
  card = find('workspace-setlist-card-second')
  await act(async () => card.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
  assert.match(find('workspace-setlist-header').textContent, /Second/)
})
