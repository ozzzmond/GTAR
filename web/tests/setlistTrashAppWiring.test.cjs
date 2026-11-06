// #348: real App lifecycle handlers and TrashView, offline persistence and backups.
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const transpiledSource = new Map()
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => {
  let output = transpiledSource.get(filename)
  if (output === undefined) {
    output = ts.transpileModule(
      fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      }).outputText
    transpiledSource.set(filename, output)
  }
  module._compile(output, filename)
}
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
const { Factory } = require('./helpers/txIdb.cjs')
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
  folders: [{ id: 'folder-1', name: 'Services', parentId: null }],
  setlists: [{ id: 'sl-1', name: 'Sunday AM', folderId: 'folder-1', createdAt: 1, songs: [
    { id: 's2', title: 'Goodness of God', entryId: 'entry-1', position: 0 },
    { id: 's1', title: 'Amazing Grace', entryId: 'entry-2', position: 1 },
    { id: 's2', title: 'Goodness of God', entryId: 'entry-3', position: 2 },
  ] }],
}

let dom, root, home, header
afterEach(async () => { if (root) { await act(async () => root.unmount()); root = null } require('../src/utils/libraryStore.ts').resetLibraryStoreForTests(); require('../src/utils/recoveryArchiveStore.ts').resetRecoveryArchives(); dom?.window.close() })

function freshModules() {
  for (const key of Object.keys(require.cache)) if (key.startsWith(srcDir)) delete require.cache[key]
}
async function mountApp(url, { keepStorage = false, library = LIBRARY, factory = null, realHome = false } = {}) {
  const previous = keepStorage ? dom.window.localStorage : null
  const saved = previous ? Object.fromEntries(Object.keys(previous).map(k => [k, previous.getItem(k)])) : null
  if (root) { await act(async () => root.unmount()); root = null }
  require('../src/utils/libraryStore.ts').resetLibraryStoreForTests()
  require('../src/utils/recoveryArchiveStore.ts').resetRecoveryArchives()
  dom?.window.close()
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url })
  Object.assign(global, {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  global.fetch = async () => { throw new Error('offline') }
  if (saved) for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v)
  else localStorage.setItem('gtar_library_v1', JSON.stringify(library))
  freshModules()
  if (factory) global.indexedDB = factory
  else delete global.indexedDB
  home = null
  header = null
  const homeModule = require('../src/components/SongbookHomeView.tsx')
  const Home = homeModule.SongbookHomeView
  homeModule.SongbookHomeView = props => { home = props; return realHome ? React.createElement(Home, props) : React.createElement('div', null, 'Songbook') }
  const headerModule = require('../src/components/Header.tsx')
  const Header = headerModule.Header
  headerModule.Header = props => { header = props; return React.createElement(Header, props) }
  const App = require('../src/App.tsx').default
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(App)))
  for (let i = 0; !header && i < 100; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  assert.ok(header, document.body.textContent)
}
const stored = () => require('../src/utils/syncJournal.ts').readPersistedLibrary()
const $ = sel => document.querySelector(sel)
const $$ = sel => [...document.querySelectorAll(sel)]
const button = text => $$('button').find(b => b.textContent.includes(text))
async function click(el) { assert.ok(el, 'control exists'); await act(async () => el.click()) }
async function deleteSetlist() {
  await act(async () => home.onManageSetlist(home.setlists[0]))
  await click(button('Delete Setlist'))
  await click($$('[role="alertdialog"] button').find(b => b.textContent === 'Delete'))
  await click($('[aria-label="Close Setlist Manager"]'))
}
async function openTrash() { await click($('[data-testid="explorer-nav-trash"]') || $('button[aria-label^="Trash"]')) }

test('delete a setlist: real App lists it in Trash with type, name, entry count and header total', async () => {
  await mountApp('http://localhost/')
  await deleteSetlist()
  assert.equal(stored().setlists[0].isDeleted, true)
  assert.equal(header.deletedSongsCount, 1)
  assert.ok($('[aria-label="Trash Bin (1)"]'))
  await openTrash()
  assert.match(document.body.textContent, /Sunday AM/)
  assert.match(document.body.textContent, /Setlist/)
  assert.match(document.body.textContent, /3 songs/)
})


const plain = value => JSON.parse(JSON.stringify(value))
const trashLibrary = () => ({ ...LIBRARY, songs: [...LIBRARY.songs, { ...song('deleted-song', 'Deleted Song', '', 'C'), isDeleted: true }],
  setlists: [{ ...LIBRARY.setlists[0], isDeleted: true }, { id: 'active-list', name: 'Keep Me', songs: [] }] })
const flush = async () => { await act(async () => require('../src/utils/libraryStore.ts').flushLibraryStore()) }
const backup = () => { const lib = stored(); return require('../src/utils/jsonBackup.ts').buildVerifiedBackup(lib.songs, lib.setlists, undefined, lib.folders) }
const row = kind => $(`button[aria-label="Permanently delete this ${kind}"]`).closest('.rounded-2xl')

for (const b3 of [false, true]) {
  test(`restore setlist keeps folder, entries/order/repeated references and songs after reload (${b3 ? 'B3' : 'legacy'})`, async () => {
    const factory = b3 ? new Factory() : null
    await mountApp('http://localhost/', { factory })
    const before = plain(stored())
    await deleteSetlist()
    await flush()
    await mountApp('http://localhost/', { keepStorage: true, factory })
    await openTrash()
    assert.match(document.body.textContent, /Sunday AM/)
    await click(button('Restore'))
    assert.equal(header.deletedSongsCount, 0)
    assert.equal(stored().setlists[0].isDeleted, false)
    assert.equal(stored().setlists[0].folderId, 'folder-1')
    assert.deepEqual(plain(stored().setlists[0].songs), before.setlists[0].songs)
    assert.deepEqual(plain(stored().songs), before.songs)
    await flush()
    await mountApp('http://localhost/', { keepStorage: true, factory })
    assert.equal(home.setlists[0].isDeleted, false)
    assert.deepEqual(plain(home.setlists[0].songs), before.setlists[0].songs)
    assert.equal(home.setlists[0].folderId, 'folder-1')
    await flush()
  })
}

test('restore setlist whose folder was removed falls back to Unfiled Setlists', async () => {
  await mountApp('http://localhost/', { library: { ...LIBRARY, folders: [], setlists: [{ ...LIBRARY.setlists[0], isDeleted: true }] } })
  await openTrash()
  await click(button('Restore'))
  assert.equal(stored().setlists[0].folderId, null)
  assert.equal(stored().setlists[0].isDeleted, false)
  assert.equal(stored().songs.length, 4)
})

test('permanent setlist delete is confirmed; cancel keeps it; export omits only that setlist and retains songs', async () => {
  await mountApp('http://localhost/', { library: trashLibrary() })
  const beforeSongs = plain(stored().songs)
  await openTrash()
  assert.equal(header.deletedSongsCount, 2)
  assert.match(row('song').textContent, /Song/)
  assert.match(row('setlist').textContent, /Setlist/)
  await click($('[aria-label="Permanently delete this setlist"]'))
  assert.match(document.body.textContent, /recover this setlist/)
  await click(button('Cancel'))
  assert.equal(stored().setlists.length, 2)
  await click($('[aria-label="Permanently delete this setlist"]'))
  await click(button('Delete Forever'))
  assert.deepEqual(stored().setlists.map(sl => sl.id), ['active-list'])
  assert.deepEqual(plain(stored().songs), beforeSongs)
  assert.equal(header.deletedSongsCount, 1)
  assert.equal(JSON.parse(backup().json).setlists.length, 1)
  await mountApp('http://localhost/', { keepStorage: true })
  assert.deepEqual(home.setlists.map(sl => sl.id), ['active-list'])
})

test('Empty Trash states both counts, cancel changes nothing, confirm removes both and keeps active content after B3 reload', async () => {
  const factory = new Factory()
  await mountApp('http://localhost/', { library: trashLibrary(), factory })
  const before = plain(stored())
  await openTrash()
  await click(button('Empty Trash'))
  assert.match(document.body.textContent, /permanently delete 1 song and 1 setlist/)
  await click(button('Cancel'))
  assert.deepEqual(plain(stored()), before)
  await click(button('Empty Trash'))
  await click(button('Permanently Empty'))
  assert.equal(header.deletedSongsCount, 0)
  assert.match(document.body.textContent, /Trash is Empty/)
  assert.deepEqual(stored().setlists.map(sl => sl.id), ['active-list'])
  assert.deepEqual(plain(stored().songs), before.songs.filter(s => !s.isDeleted))
  await flush()
  await mountApp('http://localhost/', { keepStorage: true, factory })
  assert.deepEqual(home.setlists.map(sl => sl.id), ['active-list'])
  assert.equal(home.songs.length, 4)
  assert.equal(header.deletedSongsCount, 0)
  await flush()
})

test('backup export/parse/App full restore keeps a deleted setlist trashed with identical references', async () => {
  await mountApp('http://localhost/')
  await deleteSetlist()
  const before = plain(stored().setlists[0])
  const exported = backup()
  const parsed = require('../src/utils/jsonBackup.ts').parseBackupJson(exported.json)
  assert.equal(parsed.isValid, true, parsed.error)
  assert.equal(parsed.metadata.deletedSetlistCount, 1)
  await mountApp('http://localhost/')
  await act(async () => header.onCloudRestore(parsed.songs, parsed.setlists, parsed.folders))
  assert.deepEqual(plain(stored().setlists[0]), before)
  assert.equal(header.deletedSongsCount, 1)
  await mountApp('http://localhost/', { keepStorage: true })
  await openTrash()
  assert.match(document.body.textContent, /Sunday AM/)
  assert.deepEqual(plain(stored().setlists[0]), before)
})

for (const operation of ['restore', 'permanent', 'empty']) {
  test(`stale ${operation} refuses to overwrite another tab and retains Trash`, async () => {
    await mountApp('http://localhost/', { library: trashLibrary() })
    await openTrash()
    const external = JSON.stringify({ ...trashLibrary(), setlists: [{ ...LIBRARY.setlists[0], name: 'Other tab', isDeleted: true }] })
    localStorage.setItem('gtar_library_v1', external)
    if (operation === 'restore') await click([...row('setlist').querySelectorAll('button')].find(b => b.textContent.includes('Restore')))
    else if (operation === 'permanent') {
      await click($('[aria-label="Permanently delete this setlist"]'))
      await click(button('Delete Forever'))
    } else {
      await click(button('Empty Trash'))
      await click(button('Permanently Empty'))
    }
    assert.equal(localStorage.getItem('gtar_library_v1'), external)
    assert.equal(header.deletedSongsCount, 2)
    assert.ok($('[aria-label="Permanently delete this setlist"]'))
  })
}

test('existing inline song delete, Restore and permanent delete still work through real App UI', async () => {
  await mountApp('http://localhost/', { library: trashLibrary(), realHome: true })
  await openTrash()
  await click([...row('song').querySelectorAll('button')].find(b => b.textContent.includes('Restore')))
  assert.equal(header.deletedSongsCount, 1)
  assert.equal(stored().songs.find(s => s.id === 'deleted-song').isDeleted, false)
  await act(async () => header.onViewChange('songbook'))
  const index = home.songs.findIndex(s => s.id === 'deleted-song')
  await click($(`[data-testid="song-menu-${index}"]`))
  await click($(`[data-testid="menu-delete-song-${index}"]`))
  assert.match(document.body.textContent, /Delete this song\?/)
  await click($(`[data-testid="cancel-delete-song-${index}"]`))
  assert.equal(stored().songs.find(s => s.id === 'deleted-song').isDeleted, false)
  await click($(`[data-testid="song-menu-${index}"]`))
  await click($(`[data-testid="menu-delete-song-${index}"]`))
  await click($(`[data-testid="confirm-delete-song-${index}"]`))
  await openTrash()
  await click($('[aria-label="Permanently delete this song"]'))
  assert.match(document.body.textContent, /recover this song/)
  await click(button('Delete Forever'))
  assert.equal(stored().songs.some(s => s.id === 'deleted-song'), false)
  assert.equal(stored().setlists[0].isDeleted, true)
})

test('#352 desktop confirmation preserves persistence on cancel/Escape and trashes only selected setlist on confirm', async () => {
  await mountApp('http://localhost/', { library: { ...LIBRARY, setlists: [...LIBRARY.setlists, { id: 'keep', name: 'Keep', songs: [] }] } })
  const before = plain(stored())
  await act(async () => home.onRequestTrashSetlist('sl-1'))
  await click($('[data-testid="cancel-trash-setlist"]'))
  assert.deepEqual(plain(stored()), before)
  await act(async () => home.onRequestTrashSetlist('sl-1'))
  await act(async () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true })))
  assert.equal($('[data-testid="setlist-trash-confirmation"]'), null)
  assert.deepEqual(plain(stored()), before)
  await act(async () => home.onRequestTrashSetlist('sl-1'))
  await click($('[data-testid="confirm-trash-setlist"]'))
  assert.equal(stored().setlists[0].isDeleted, true)
  assert.deepEqual(plain(stored().setlists[1]), before.setlists[1])
  assert.deepEqual(plain(stored().songs), before.songs)
})

test('#352 detail header delete action triggers confirmation and trashes setlist on confirm', async () => {
  await mountApp('http://localhost/', { library: { ...LIBRARY, setlists: [...LIBRARY.setlists, { id: 'keep', name: 'Keep', songs: [] }] }, realHome: true })
  const before = plain(stored())
  await act(async () => home.onSelectView({ type: 'ALL_SETLISTS' }))
  await click($('[data-testid="workspace-setlist-card-sl-1"]'))
  const deleteBtn = $('[data-testid="workspace-delete-setlist"]')
  assert.ok(deleteBtn, 'header delete button exists in detail view')
  await click(deleteBtn)
  assert.ok($('[data-testid="setlist-trash-confirmation"]'))
  await click($('[data-testid="cancel-trash-setlist"]'))
  assert.deepEqual(plain(stored()), before)
  assert.ok($('[data-testid="workspace-setlist-header"]'), 'setlist remains open after cancel')
  await click(deleteBtn)
  await click($('[data-testid="confirm-trash-setlist"]'))
  assert.equal(stored().setlists[0].isDeleted, true)
  assert.deepEqual(plain(stored().setlists[1]), before.setlists[1])
})
