// #290 S1: GTAR1 setlist workspace port (DEV-only, Music Explorer setlist targets).
const { test, beforeEach, afterEach } = require('node:test')
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
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')

const webDir = path.join(__dirname, '..')
const appSource = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')
const workspaceSource = () => fs.readFileSync(path.join(webDir, 'src/components/SetlistWorkspace.tsx'), 'utf8')

let dom, root
const songs = [
  { id: 'song-1', title: 'Alpha Tune', artist: 'Band One', key: 'C', rawContent: '{key: C}\n[C]Lyrics', format: 'CHORD_PRO' },
  { id: 'song-2', title: 'Beta Groove', artist: 'Band Two', key: 'G', rawContent: '{key: G}\n[G]Lyrics', format: 'CHORD_PRO' },
  { id: 'song-3', title: 'Gamma Ballad', artist: 'Band Three', key: '', rawContent: 'No chords here', format: 'PLAIN' },
]
const setlists = [
  { id: 'sl-1', name: 'Gig Set A', createdAt: Date.UTC(2026, 0, 15), songs: [
    { id: 'song-1', title: 'Alpha Tune' },
    { id: 'gone', title: 'Trashed Song', artist: 'Old Band' },
    { id: 'song-2', title: 'Beta Groove' },
  ] },
  { id: 'sl-2', name: 'Gig Set B', songs: [{ id: 'song-2', title: 'Beta Groove' }] },
  { id: 'sl-3', name: 'Empty Set', songs: [] },
  { id: 'sl-del', name: 'Deleted Set', isDeleted: true, songs: [] },
]

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://gtar.test' })
  Object.assign(global, {
    window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: fn => fn(),
  })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  global.fetch = async () => new Response(JSON.stringify({ setlists: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
afterEach(async () => { if (root) { await act(async () => root.unmount()); root = null } dom.window.close() })

function baseProps(overrides = {}) {
  return {
    songs, setlists, activeSongIndex: 0,
    onSelectSong() {}, onNewSong() {}, onOpenSetlists() {}, onDeleteSong() {},
    onSongMembershipChange() { return true }, onCreateSetlistForSong() { return true },
    view: { type: 'ALL_SETLISTS' },
    ...overrides,
  }
}
async function mount(props) {
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(require('../src/utils/authContext.ts').AuthContext.Provider,{value:{session:{user:{id:'user'}},accessStatus:'active'}},React.createElement(SongbookHomeView, props))))
}
const $ = sel => document.querySelector(sel)
const $$ = sel => [...document.querySelectorAll(sel)]
async function click(el) { assert.ok(el, 'control exists'); await act(async () => el.click()) }

test('S1_COLLECTION: All Setlists target renders the GTAR1 collection view with count and cards', async () => {
  await mount(baseProps({ view: { type: 'ALL_SETLISTS' } }))
  const heading = $('[data-testid="setlist-workspace-heading"]')
  assert.ok(heading, 'collection heading exists')
  assert.match(heading.textContent, /All Setlists/)
  assert.match(heading.textContent, /\(3\)/, 'count excludes deleted setlists')
  const cards = $$('[data-testid^="workspace-setlist-card-"]')
  assert.deepEqual(cards.map(c => c.getAttribute('data-testid')), ['workspace-setlist-card-sl-1', 'workspace-setlist-card-sl-2', 'workspace-setlist-card-sl-3'])
  const first = cards[0]
  assert.match(first.textContent, /Gig Set A/)
  assert.match($('[data-testid="workspace-setlist-count-sl-1"]').textContent, /^3 songs$/)
  assert.match($('[data-testid="workspace-setlist-count-sl-2"]').textContent, /^1 song$/)
  assert.ok($('[data-testid="workspace-manage-sl-1"]').textContent.includes('Manage →'))
  assert.equal($('[data-testid="song-setlists-panel"]'), null)
  assert.equal($('[data-testid="setlist-controls-toolbar"]'), null, 'legacy panel is replaced in the workspace')
})

test('S1_COLLECTION: Unfiled Setlists target uses its own heading; no folders means every setlist is unfiled', async () => {
  await mount(baseProps({ view: { type: 'UNFILED_SETLISTS' } }))
  const heading = $('[data-testid="setlist-workspace-heading"]')
  assert.match(heading.textContent, /Unfiled Setlists/)
  assert.match(heading.textContent, /\(3\)/)
  assert.equal($$('[data-testid^="workspace-setlist-card-"]').length, 3)
})

test('S1_COLLECTION: date shows only when the setlist has one; no folder label is rendered', async () => {
  await mount(baseProps({ view: { type: 'ALL_SETLISTS' } }))
  assert.ok($('[data-testid="workspace-setlist-date-sl-1"]'), 'setlist with createdAt shows its date')
  assert.equal($('[data-testid="workspace-setlist-date-sl-2"]'), null, 'no date field means no invented date')
  assert.doesNotMatch(document.body.textContent, /Updated/, 'createdAt is not presented as an update date')
  assert.equal($('[data-testid^="workspace-setlist-folder-"]'), null)
})

test('S1_COLLECTION: empty scope shows the dashed GTAR1 empty state', async () => {
  await mount(baseProps({ setlists: [], view: { type: 'ALL_SETLISTS' } }))
  const empty = $('[data-testid="workspace-empty-collection"]')
  assert.ok(empty)
  assert.match(empty.className, /border-dashed/)
  assert.match(empty.textContent, /No setlists in this scope/)
})

async function openSetlist(id, props) {
  await mount(baseProps({ view: { type: 'ALL_SETLISTS' }, ...props }))
  await click($(`[data-testid="workspace-setlist-card-${id}"]`))
}

test('S1_SETLIST: clicking a card opens the single-setlist view with header and numbered rows', async () => {
  await openSetlist('sl-1')
  const header = $('[data-testid="workspace-setlist-header"]')
  assert.ok(header, 'single-setlist header card exists')
  assert.match(header.textContent, /Gig Set A/)
  assert.match(header.textContent, /3 performance entries/)
  assert.ok($('[data-testid="workspace-play-setlist"]'))
  assert.ok($('[data-testid="workspace-edit-setlist"]').textContent.includes('Edit in Setlist Manager'))
  const rows = $$('[data-testid^="workspace-entry-"]').filter(el => /^workspace-entry-\d+$/.test(el.getAttribute('data-testid')))
  assert.equal(rows.length, 3)
  assert.match(rows[0].textContent, /^1/)
  assert.match(rows[0].textContent, /Alpha Tune/)
  assert.match(rows[0].textContent, /Band One/)
  assert.equal($('[data-testid="workspace-setlist-heading"]'), null, 'collection grid is replaced')
})

test('S1_SETLIST: key badge shows the PERFORMANCE_KEY from existing key rules, never a guessed key', async () => {
  const transposed = songs.map(s => s.id === 'song-2' ? { ...s, transposeOffset: 2 } : s)
  await openSetlist('sl-1', { songs: transposed })
  assert.equal($('[data-testid="workspace-entry-key-0"]').textContent, 'C')
  assert.equal($('[data-testid="workspace-entry-key-2"]').textContent, 'A', 'song-level transpose state (G +2) is the key in use')
  assert.equal($('[data-testid="workspace-entry-key-1"]'), null, 'unavailable entry has no key badge')
  assert.doesNotMatch(document.body.textContent, /\(\+2\)/, 'no per-entry transpose label in S1')
})

test('S1_SETLIST: missing or trashed song rows show as unavailable and are disabled', async () => {
  const trashed = songs.map(s => s.id === 'song-2' ? { ...s, isDeleted: true } : s)
  let played = [], opened = []
  await openSetlist('sl-1', {
    songs: trashed,
    onSelectSetlistSong: (id, idx) => played.push([id, idx]),
    onSelectSong: idx => opened.push(idx),
  })
  for (const idx of [1, 2]) {
    const row = $(`[data-testid="workspace-entry-${idx}"]`)
    assert.equal(row.getAttribute('aria-disabled'), 'true')
    assert.match(row.textContent, /Song missing/)
    assert.equal($(`[data-testid="workspace-entry-play-${idx}"]`).disabled, true)
    assert.equal($(`[data-testid="workspace-entry-open-${idx}"]`).disabled, true)
    await click(row)
  }
  assert.match($('[data-testid="workspace-entry-1"]').textContent, /Trashed Song/, 'stored title is kept for context')
  assert.deepEqual(played, [])
  assert.deepEqual(opened, [])
  assert.equal($('[data-testid="workspace-entry-0"]').getAttribute('aria-disabled'), null)
})

test('S1_SETLIST: Play in Stage opens the right setlist position; Open opens the library song', async () => {
  const played = [], opened = []
  await openSetlist('sl-1', {
    onSelectSetlistSong: (id, idx) => played.push([id, idx]),
    onSelectSong: idx => opened.push(idx),
  })
  await click($('[data-testid="workspace-entry-play-2"]'))
  await click($('[data-testid="workspace-play-setlist"]'))
  assert.deepEqual(played, [['sl-1', 2], ['sl-1', 0]])
  await click($('[data-testid="workspace-entry-open-2"]'))
  await click($('[data-testid="workspace-entry-0"]'))
  assert.deepEqual(opened, [1, 0], 'Open uses the library index of the resolved song')
})

test('S1_SETLIST: header Play in Stage starts at the first available entry', async () => {
  const played = []
  const lists = [{ id: 'sl-x', name: 'Gap First', songs: [{ id: 'gone', title: 'Gone' }, { id: 'song-2', title: 'Beta Groove' }] }]
  await mount(baseProps({ setlists: lists, view: { type: 'ALL_SETLISTS' }, onSelectSetlistSong: (id, idx) => played.push([id, idx]) }))
  await click($('[data-testid="workspace-setlist-card-sl-x"]'))
  await click($('[data-testid="workspace-play-setlist"]'))
  assert.deepEqual(played, [['sl-x', 1]])
})

test('S1_SETLIST: Edit in Setlist Manager and card Manage → call the existing GTAR manage flow', async () => {
  const managed = []
  await mount(baseProps({ view: { type: 'ALL_SETLISTS' }, onManageSetlist: sl => managed.push(sl.id) }))
  await click($('[data-testid="workspace-manage-sl-2"]'))
  assert.equal($('[data-testid="workspace-setlist-header"]'), null, 'Manage → does not also open the card')
  await click($('[data-testid="workspace-setlist-card-sl-1"]'))
  await click($('[data-testid="workspace-edit-setlist"]'))
  assert.deepEqual(managed, ['sl-2', 'sl-1'])
})

test('S1_SETLIST: empty setlist shows the dashed empty state and no Play in Stage', async () => {
  await openSetlist('sl-3')
  const empty = $('[data-testid="workspace-empty-setlist"]')
  assert.ok(empty)
  assert.match(empty.className, /border-dashed/)
  assert.match(empty.textContent, /This setlist has no songs yet/)
  assert.equal($('[data-testid="workspace-play-setlist"]'), null)
  assert.match($('[data-testid="workspace-setlist-header"]').textContent, /0 performance entries/)
})

test('S1_BREADCRUMBS: Setlists › All Setlists › name, and crumbs navigate back', async () => {
  const scopes = []
  await openSetlist('sl-1', { onSelectView: target => scopes.push(target.type) })
  const crumbs = () => $$('[data-testid="workspace-breadcrumbs"] [data-crumb]').map(el => el.textContent)
  assert.deepEqual(crumbs(), ['Setlists', 'All Setlists', 'Gig Set A'])
  assert.equal($('[data-testid="workspace-breadcrumbs"] [aria-current="page"]').textContent, 'Gig Set A')
  await click($('[data-testid="workspace-crumb-scope"]'))
  assert.ok($('[data-testid="setlist-workspace-heading"]'), 'scope crumb returns to the collection')
  assert.deepEqual(crumbs(), ['Setlists', 'All Setlists'])
  await click($('[data-testid="workspace-setlist-card-sl-2"]'))
  await click($('[data-testid="workspace-crumb-root"]'))
  assert.ok($('[data-testid="setlist-workspace-heading"]'), 'root crumb returns to the collection')
  assert.deepEqual(scopes, ['ALL_SETLISTS'])
})

test('S1_BREADCRUMBS: Unfiled scope labels its crumb Unfiled Setlists', async () => {
  await mount(baseProps({ view: { type: 'UNFILED_SETLISTS' } }))
  await click($('[data-testid="workspace-setlist-card-sl-2"]'))
  assert.deepEqual($$('[data-testid="workspace-breadcrumbs"] [data-crumb]').map(el => el.textContent), ['Setlists', 'Unfiled Setlists', 'Gig Set B'])
})

const { AuthContext } = require('../src/utils/authContext.ts')
const { SESSION_STORAGE_KEY } = require('../src/utils/googleAuth.ts')
const { bindOwner, OWNER_KEY } = require('./helpers/libraryOwner.cjs')
function signIn(role = 'member', access = 'active') {
  const account = 'account-a'
  const session = { version: 1, user: { id: account, sub: account, email: 'a@test.app', role, access_status: access, email_verified: true },
    authenticatedAt: Date.now(), lastVerifiedAt: Date.now(), localExpiresAt: Date.now() + 3600000, expiresAt: Date.now() + 3600000,
    sessionToken: `token-${account}`, role, access_status: access }
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  if (!localStorage.getItem(OWNER_KEY)) bindOwner(localStorage, account)
  return { session, role: 'USER', accessStatus: access }
}
async function mountAuthed(props, auth) {
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(AuthContext.Provider, { value: auth }, React.createElement(SongbookHomeView, props))))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
async function openMenu() {
  await click($('[data-testid="workspace-scope-menu-btn"]'))
  const menu = $('[data-testid="workspace-scope-menu"]')
  assert.ok(menu, 'scope ⋯ menu opens')
  return menu
}
const menuItems = () => $$('[data-testid="workspace-scope-menu"] [role^="menuitem"]').map(el => el.getAttribute('data-testid'))

test('S1_MENU: collection ⋯ menu holds Sort, Import and Manage; dedicated sharing wired to existing handlers', async () => {
  const opened = []
  await mount(baseProps({ view: { type: 'ALL_SETLISTS' }, onOpenSetlists: () => opened.push('manage') }))
  const btn = $('[data-testid="workspace-scope-menu-btn"]')
  assert.equal(btn.getAttribute('aria-label'), 'Setlist actions')
  assert.match(btn.className, /min-h-11/) // compact toolbar: 44px, same height as the rest of the row
  await openMenu()
  assert.deepEqual(menuItems(), [
    'workspace-sort-manual', 'workspace-sort-title_asc', 'workspace-sort-title_desc',
    'workspace-menu-import', 'workspace-menu-manage',
  ], 'Newest/Oldest stay hidden without reliable timestamps (existing Sort rule)')
  assert.equal($('[data-testid="workspace-sort-manual"]').getAttribute('aria-checked'), 'true')

  // Sort → existing display-only setlist sort
  await click($('[data-testid="workspace-sort-title_desc"]'))
  assert.deepEqual($$('[data-testid^="workspace-setlist-card-"]').map(c => c.getAttribute('data-testid')),
    ['workspace-setlist-card-sl-2', 'workspace-setlist-card-sl-1', 'workspace-setlist-card-sl-3'])
  assert.equal($('[data-testid="workspace-scope-menu"]'), null, 'choosing an item closes the menu')

  await openMenu()
  assert.equal($('[data-testid="workspace-menu-share"]'), null)
  assert.equal($('[data-testid="workspace-menu-import"]').textContent.trim(), 'Import Setlist')
  await click($('[data-testid="main-share-setlist-btn"]'))
  assert.ok($('[data-testid="share-setlist-chooser-dialog"]'), 'QR share opens the existing chooser')
  await click($('[data-testid="share-setlist-chooser-dialog"] [aria-label="Close"]'))

  // Import → existing setlist import dialog
  await openMenu(); await click($('[data-testid="workspace-menu-import"]'))
  assert.ok($('[data-testid="setlist-import-dialog"]'), 'Import opens the existing setlist import dialog')

  // Manage Setlists → existing manage flow
  await openMenu(); await click($('[data-testid="workspace-menu-manage"]'))
  assert.deepEqual(opened, ['manage'])
})

test('S1_MENU: single-setlist ⋯ menu imports, exports and manages; dedicated sharing through existing handlers', async () => {
  const calls = []
  const auth = signIn('member', 'active')
  await mountAuthed(baseProps({
    view: { type: 'ALL_SETLISTS' },
    onShareSetlist: sl => calls.push(['share', sl.id]),
    onOpenSetlists: () => calls.push(['manage']),
  }), auth)
  await click($('[data-testid="workspace-setlist-card-sl-1"]'))
  await openMenu()
  assert.deepEqual(menuItems(), ['workspace-menu-import',
    'workspace-menu-export-json', 'workspace-menu-manage'])
  assert.equal($('[data-testid="workspace-menu-share"]'), null)
  assert.equal($('[data-testid="workspace-menu-import"]').textContent.trim(), 'Import Setlist')
  assert.equal($('[data-testid="workspace-menu-export-json"]').textContent.trim(), 'Export Setlist')
  await click($('[data-testid="workspace-setlist-header"] [aria-label="Share Setlist"]'))
  await openMenu(); await click($('[data-testid="workspace-menu-manage"]'))
  assert.deepEqual(calls, [['share', 'sl-1'], ['manage']])
  await openMenu(); await click($('[data-testid="workspace-menu-import"]'))
  assert.ok($('[data-testid="setlist-import-dialog"]'))
  for (const item of $$('[data-testid="workspace-scope-menu"] [role^="menuitem"]')) assert.match(item.className, /min-h-9|min-h-11/)
})

test('S1_WIRING: the Explorer selection drives the Songbook view; setlist targets render the workspace in every env (#319)', () => {
  assert.match(appSource, /view=\{explorerSelection\}/)
  assert.match(appSource, /onSelectView=\{handleExplorerSelect\}/)
  assert.doesNotMatch(appSource, /setlistScope=/)
})

test('S1_TOKENS: workspace uses theme tokens only and 36px minimum touch targets', () => {
  const source = workspaceSource()
  assert.doesNotMatch(source, /\b(?:bg|text|border|ring)-(?:purple|amber|red|sky|white|black)\b|\b(?:bg|text|border|ring)-(?:purple|amber|red|sky)-\d|\[#[0-9a-fA-F]{3,8}\]/)
  assert.match(source, /const touch = 'min-h-9 min-w-9'/)
})
test('S4_FOLDER: folder scopes and Unfiled filter the existing workspace without losing setlists', async () => {
  const folders=[{id:'folder',name:'Sunday Services',parentId:null}]
  const filed=setlists.map((list,i)=>i===0?{...list,folderId:'folder'}:list)
  await mount(baseProps({folders,setlists:filed,view:{type:'FOLDER',folderId:'folder'}}))
  assert.match($('[data-testid="setlist-workspace-heading"]').textContent,/Sunday Services.*\(1\)/)
  assert.deepEqual($$('[data-testid^="workspace-setlist-card-"]').map(card=>card.dataset.testid),['workspace-setlist-card-sl-1'])
  await act(async()=>root.render(React.createElement(SongbookHomeView,baseProps({folders,setlists:filed,view:{type:'UNFILED_SETLISTS'}}))))
  assert.deepEqual($$('[data-testid^="workspace-setlist-card-"]').map(card=>card.dataset.testid),['workspace-setlist-card-sl-2','workspace-setlist-card-sl-3'])
})

test('desktop Trash action requests selected setlist without opening or deleting it and is integrated next to Manage', async () => {
  const requests = [], mutations = []
  await mount(baseProps({ onRequestTrashSetlist: id => requests.push(id), onDeleteSetlist: id => mutations.push(id) }))
  const button = document.querySelector('[data-testid="desktop-delete-setlist-sl-1"]')
  const manage = document.querySelector('[data-testid="workspace-manage-sl-1"]')
  assert.ok(button)
  assert.ok(manage)
  assert.equal(button.parentElement, manage.parentElement, 'delete and manage share the same action row container')
  assert.equal(button.getAttribute('aria-label'), 'Move setlist Gig Set A to Trash')
  button.focus()
  assert.equal(document.activeElement, button)
  await act(async () => button.click())
  assert.deepEqual(requests, ['sl-1'])
  assert.deepEqual(mutations, [])
  assert.ok(document.querySelector('[data-testid="workspace-setlist-card-sl-1"]'))
})

test('setlist detail header renders Delete action immediately after QR and requests trash confirmation', async () => {
  const requests = [], mutations = []
  await openSetlist('sl-1', {
    onRequestTrashSetlist: id => requests.push(id),
    onDeleteSetlist: id => mutations.push(id),
  })
  const header = $('[data-testid="workspace-setlist-header"]')
  assert.ok(header)
  const deleteBtn = $('[data-testid="workspace-delete-setlist"]')
  assert.ok(deleteBtn, 'detail header delete button is rendered')
  assert.equal(deleteBtn.getAttribute('aria-label'), 'Move setlist Gig Set A to Trash')

  const actions = [...header.querySelectorAll('button')]
  const qrIdx = actions.findIndex(b => b.getAttribute('aria-label') === 'Share Setlist' || b.getAttribute('data-testid') === 'workspace-share-setlist')
  const deleteIdx = actions.indexOf(deleteBtn)
  if (qrIdx !== -1) {
    assert.equal(deleteIdx, qrIdx + 1, 'delete button appears immediately after QR button')
  }

  await click(deleteBtn)
  assert.deepEqual(requests, ['sl-1'])
  assert.deepEqual(mutations, [])
})
