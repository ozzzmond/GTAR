// GH579 Phase 1: Integrated Setlist Options & Setlist Manager Retirement tests
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) => {
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      }).outputText,
      filename
    )
  }
}
require.extensions['.png'] = module => { module.exports = '/logo.png' }

const { JSDOM } = require('jsdom')
// react-dom detects input-event support from the global document when it loads.
const bootDom = new JSDOM('<!doctype html>')
Object.assign(global, { window: bootDom.window, document: bootDom.window.document })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { SetlistWorkspace } = require('../src/components/SetlistWorkspace.tsx')

let dom, root

const sampleSongs = [
  { id: 's1', title: 'Amazing Grace', artist: 'John Newton', key: 'G', rawContent: '{key: G}\n[G]Amazing', format: 'CHORD_PRO' },
  { id: 's2', title: 'Goodness of God', artist: 'Bethel Music', key: 'Ab', rawContent: '{key: Ab}\n[Ab]Goodness', format: 'CHORD_PRO' },
  { id: 's3', title: 'Great Are You Lord', artist: 'All Sons & Daughters', key: 'A', rawContent: '{key: A}\n[A]Great', format: 'CHORD_PRO' },
  { id: 's4', title: 'Hotel California', artist: 'Eagles', key: 'Bm', rawContent: '{key: Bm}\n[Bm]Hotel', format: 'CHORD_PRO' },
]

const sampleSetlists = [
  {
    id: 'sl-1',
    name: 'Sunday Morning',
    createdAt: 1000,
    folderId: 'f1',
    songs: [
      { id: 's1', title: 'Amazing Grace' },
      { id: 's2', title: 'Goodness of God', performanceKey: 'A' },
      { id: 's3', title: 'Great Are You Lord' },
    ],
  },
  {
    id: 'sl-empty',
    name: 'Empty Setlist',
    createdAt: 2000,
    songs: [],
  },
]

const sampleFolders = [
  { id: 'f1', name: 'Sunday Services' },
  { id: 'f2', name: 'Youth' },
]

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://gtar.test' })
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: fn => fn(),
  })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount())
    root = null
  }
  dom.window.close()
})

const $ = sel => document.querySelector(sel)
const $$ = sel => [...document.querySelectorAll(sel)]
async function click(el) {
  assert.ok(el, 'element to click exists')
  await act(async () => el.click())
}

function mountWorkspace(overrides = {}) {
  const { menu: menuOverrides, ...restOverrides } = overrides
  const props = {
    scope: 'ALL_SETLISTS',
    openSetlistId: 'sl-1',
    setlists: sampleSetlists,
    songs: sampleSongs,
    folders: sampleFolders,
    onOpenSetlistChange() {},
    onSelectScope() {},
    onPlaySetlistPosition() {},
    onOpenSong() {},
    onRenameSetlist() {},
    onRequestTrashSetlist() {},
    onSetlistFolderChange() {},
    onMoveSong() {},
    onRemoveSong() {},
    onAddSongs() {},
    menu: {
      sortValue: 'recent',
      sortOptions: [{ value: 'recent', label: 'Recent' }],
      onSortChange() {},
      onShareSetlist() {},
      ...menuOverrides,
    },
    ...restOverrides,
  }
  root = createRoot(document.getElementById('root'))
  return act(async () => {
    root.render(React.createElement(SetlistWorkspace, props))
  })
}

test('HEADER: renders setlist icon, name, entry count, folder selector, and action buttons', async () => {
  let shareCalled = false
  let trashCalled = false
  let playCalled = false

  await mountWorkspace({
    menu: {
      sortValue: 'recent',
      sortOptions: [{ value: 'recent', label: 'Recent' }],
      onSortChange() {},
      onShareSetlist: sl => { shareCalled = sl.id === 'sl-1' },
    },
    onRequestTrashSetlist: id => { trashCalled = id === 'sl-1' },
    onPlaySetlistPosition: (id, pos) => { playCalled = id === 'sl-1' && pos === 0 },
  })

  const header = $('[data-testid="workspace-setlist-header"]')
  assert.ok(header, 'integrated header rendered')
  assert.match(header.textContent, /Sunday Morning/)

  // Entry count
  const countBadge = $('[data-testid="workspace-setlist-count"]')
  assert.ok(countBadge)
  assert.equal(countBadge.textContent.trim(), '3 performance entries')

  // Folder selector
  const folderSelect = $('[data-testid="workspace-setlist-folder-select"]')
  assert.ok(folderSelect)
  assert.equal(folderSelect.value, 'f1')

  // Search Songs button
  assert.ok($('[data-testid="workspace-search-songs"]'))

  // Play button
  const playBtn = $('[data-testid="workspace-play-setlist"]')
  assert.ok(playBtn)
  await click(playBtn)
  assert.equal(playCalled, true)

  // Share button
  const shareBtn = $('[data-testid="workspace-share-setlist"]')
  assert.ok(shareBtn)
  await click(shareBtn)
  assert.equal(shareCalled, true)

  // Delete button
  const deleteBtn = $('[data-testid="workspace-delete-setlist"]')
  assert.ok(deleteBtn)
  await click(deleteBtn)
  assert.equal(trashCalled, true)
})

test('HEADER: inline pencil rename edits, saves, and cancels properly', async () => {
  let savedName = null
  await mountWorkspace({
    onRenameSetlist: (id, name) => { savedName = name; return true },
  })

  const renameBtn = $('[data-testid="workspace-rename-setlist"]')
  assert.ok(renameBtn)
  await click(renameBtn)

  const input = $('[data-testid="workspace-rename-input"]')
  assert.ok(input, 'rename input appeared')
  assert.equal(input.value, 'Sunday Morning')

  // Save new name
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'Sunday Night')
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await click($('[data-testid="workspace-rename-save"]'))
  assert.equal(savedName, 'Sunday Night')
  assert.equal($('[data-testid="workspace-rename-input"]'), null, 'input closed on save')

  // Open again and cancel
  await click($('[data-testid="workspace-rename-setlist"]'))
  assert.ok($('[data-testid="workspace-rename-input"]'))
  await click($('[data-testid="workspace-rename-cancel"]'))
  assert.equal($('[data-testid="workspace-rename-input"]'), null, 'input closed on cancel')
})

test('HEADER: folder assignment selector calls onSetlistFolderChange', async () => {
  let changedFolder = null
  await mountWorkspace({
    onSetlistFolderChange: (id, folderId) => { changedFolder = { id, folderId }; return true },
  })

  const folderSelect = $('[data-testid="workspace-setlist-folder-select"]')
  assert.ok(folderSelect)

  await act(async () => {
    folderSelect.value = 'f2'
    folderSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  assert.deepEqual(changedFolder, { id: 'sl-1', folderId: 'f2' })
})

test('SONG_ROWS: compact ordered rows with position, title, artist, key, up/down, play, open, and remove', async () => {
  let movedSong = null
  let removedSong = null
  let openedSong = null
  let playedSongInStage = null

  await mountWorkspace({
    onMoveSong: (slId, index, dir) => { movedSong = { slId, index, dir }; return true },
    onRemoveSong: (slId, index) => { removedSong = { slId, index }; return true },
    onOpenSong: (slId, pos) => { openedSong = { slId, pos } },
    onPlaySetlistPosition: (slId, pos) => { playedSongInStage = { slId, pos } },
  })

  // 3 entries
  assert.ok($('[data-testid="workspace-entry-0"]'))
  assert.ok($('[data-testid="workspace-entry-1"]'))
  assert.ok($('[data-testid="workspace-entry-2"]'))

  // Entry 0 (first): Move Up must be disabled, Move Down enabled
  const up0 = $('[data-testid="workspace-entry-0-up"]')
  const down0 = $('[data-testid="workspace-entry-0-down"]')
  assert.equal(up0.disabled, true, 'first song up is disabled')
  assert.equal(down0.disabled, false, 'first song down is enabled')

  await click(down0)
  assert.deepEqual(movedSong, { slId: 'sl-1', index: 0, dir: 'down' })

  // Entry 2 (last): Move Down must be disabled, Move Up enabled
  const up2 = $('[data-testid="workspace-entry-2-up"]')
  const down2 = $('[data-testid="workspace-entry-2-down"]')
  assert.equal(up2.disabled, false, 'last song up is enabled')
  assert.equal(down2.disabled, true, 'last song down is disabled')

  await click(up2)
  assert.deepEqual(movedSong, { slId: 'sl-1', index: 2, dir: 'up' })

  // Performance key badge check: entry 1 has performanceKey 'Ab'
  const keyBadge1 = $('[data-testid="workspace-entry-key-1"]')
  assert.equal(keyBadge1.textContent.trim(), 'Ab')

  // Play in Stage for individual song
  await click($('[data-testid="workspace-entry-play-1"]'))
  assert.deepEqual(playedSongInStage, { slId: 'sl-1', pos: 1 })

  // Open song via open button
  await click($('[data-testid="workspace-entry-open-0"]'))
  assert.deepEqual(openedSong, { slId: 'sl-1', pos: 0 })

  // Remove song
  await click($('[data-testid="workspace-entry-2-remove"]'))
  assert.deepEqual(removedSong, { slId: 'sl-1', index: 2 })
})

test('SEARCH_SONGS: opens MultiSongSetlistPicker and adds selected songs', async () => {
  let addedSongs = null
  await mountWorkspace({
    onAddSongs: (slId, ids) => { addedSongs = { slId, ids }; return true },
  })

  assert.equal(Boolean($('[data-testid="multi-song-picker-backdrop"]')), false)

  // Ctrl+K opens picker
  await act(async () => {
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  })
  assert.ok($('[data-testid="multi-song-picker-backdrop"]'), 'picker dialog backdrop opened via Ctrl+K')

  // Close picker via cancel
  const cancelBtn = $$('[data-testid="multi-song-picker-backdrop"] button').find(b => b.textContent.includes('Cancel'))
  await click(cancelBtn)
  assert.equal(Boolean($('[data-testid="multi-song-picker-backdrop"]')), false, 'picker closed')

  // Open again via Search Songs button
  await click($('[data-testid="workspace-search-songs"]'))
  assert.ok($('[data-testid="multi-song-picker-backdrop"]'))

  // Verify "In setlist" indicators are present for s1, s2, s3
  const options = $$('[role="option"]')
  assert.ok(options.length >= 4)
  const inSetlistBadges = $$('[data-testid="multi-song-picker-backdrop"] span').filter(s => s.textContent.includes('In setlist'))
  assert.equal(inSetlistBadges.length, 3, 'existing 3 songs show In setlist badge')

  // Select s4 (Hotel California)
  const hotelOption = options.find(opt => opt.textContent.includes('Hotel California'))
  assert.ok(hotelOption)
  await click(hotelOption)

  // Submit add selected
  const addBtn = $$('[data-testid="multi-song-picker-backdrop"] button').find(b => b.textContent.includes('Add 1 Selected Song'))
  assert.ok(addBtn)
  await click(addBtn)

  assert.deepEqual(addedSongs, { slId: 'sl-1', ids: ['s4'] })
  assert.equal(Boolean($('[data-testid="multi-song-picker-backdrop"]')), false, 'picker closed after adding')
})

test('EMPTY_STATE: empty setlist shows empty state message and Search Songs button, hides Play button', async () => {
  await mountWorkspace({
    openSetlistId: 'sl-empty',
  })

  assert.equal($('[data-testid="workspace-play-setlist"]'), null, 'play button omitted on empty setlist')
  const emptyMessage = $('[data-testid="workspace-empty-setlist"]')
  assert.ok(emptyMessage)
  assert.match(emptyMessage.textContent, /This setlist has no songs yet/)

  const emptySearchBtn = $('[data-testid="workspace-empty-search-songs"]')
  assert.ok(emptySearchBtn)
  await click(emptySearchBtn)
  assert.ok($('[data-testid="multi-song-picker-backdrop"]'), 'picker opened from empty state')
})

test('RETIREMENT_PARITY: separate Setlist Manager UI entry points are removed', async () => {
  await mountWorkspace()

  // No old "Edit in Setlist Manager" button
  assert.equal($('[data-testid="workspace-edit-setlist"]'), null)

  // No "Manage Setlists" action in meatball menu
  assert.equal($('[data-testid="workspace-menu-manage"]'), null)

  // Verify SetlistWorkspace source does not contain retired launchers
  const workspaceSrc = fs.readFileSync(path.join(__dirname, '../src/components/SetlistWorkspace.tsx'), 'utf8')
  assert.equal(workspaceSrc.includes('workspace-edit-setlist'), false, 'no workspace-edit-setlist launcher button')
  assert.equal(workspaceSrc.includes('workspace-menu-manage'), false, 'no workspace-menu-manage launcher menu item')
  assert.equal(workspaceSrc.includes('workspace-manage-'), false, 'no workspace-manage action button in cards')
})

test('ROUND_2_FIX_1_AND_2: All Setlists card layout has Share and Delete on top row, Created and Count on bottom row, and no Manage action', async () => {
  let openedId = null
  let sharedSl = null
  let trashedId = null

  await mountWorkspace({
    openSetlistId: null,
    onOpenSetlistChange: id => { openedId = id },
    onRequestTrashSetlist: id => { trashedId = id },
    menu: {
      sortValue: 'recent',
      sortOptions: [{ value: 'recent', label: 'Recent' }],
      onSortChange() {},
      onShareSetlist: sl => { sharedSl = sl },
    },
  })

  // FIX_1: No redundant Manage action
  assert.equal(Boolean($('[data-testid="workspace-manage-sl-1"]')), false, 'card does not render Manage button')
  assert.equal(Boolean($('[data-testid="workspace-manage-sl-empty"]')), false, 'empty setlist card does not render Manage button')

  // FIX_2: TOP_ROW has icon, title, rename, share, delete
  const card = $('[data-testid="workspace-setlist-card-sl-1"]')
  assert.ok(card)

  const shareBtn = $('[data-testid="desktop-share-setlist-sl-1"]')
  const deleteBtn = $('[data-testid="desktop-delete-setlist-sl-1"]')
  const renameBtn = $('[data-testid="desktop-rename-setlist-sl-1"]')
  assert.ok(shareBtn, 'Share button exists in card')
  assert.ok(deleteBtn, 'Delete button exists in card')
  assert.ok(renameBtn, 'Rename button exists in card')
  assert.equal(shareBtn.parentElement, deleteBtn.parentElement, 'Share and Delete are grouped in top-right container')

  // FIX_2: BOTTOM_ROW has created date on left and count on right
  const dateEl = $('[data-testid="workspace-setlist-date-sl-1"]')
  const countEl = $('[data-testid="workspace-setlist-count-sl-1"]')
  assert.ok(dateEl, 'Created date exists in card bottom row')
  assert.ok(countEl, 'Song count exists in card bottom row')
  assert.equal(dateEl.parentElement, countEl.parentElement, 'Date and count are grouped in bottom row container')
  assert.equal(countEl.textContent.trim(), '3 songs')

  // Verify actions do not trigger card opening (stopPropagation)
  await click(shareBtn)
  assert.equal(sharedSl?.id, 'sl-1')
  assert.equal(openedId, null, 'clicking share does not open card')

  await click(deleteBtn)
  assert.equal(trashedId, 'sl-1')
  assert.equal(openedId, null, 'clicking delete does not open card')

  // Clicking card opens setlist
  await click(card)
  assert.equal(openedId, 'sl-1', 'clicking card opens setlist')
})

test('ROUND_2_FIX_3: Single setlist header uses responsive multi-row layout priorities', async () => {
  await mountWorkspace({
    openSetlistId: 'sl-1',
    menu: {
      sortValue: 'recent',
      sortOptions: [{ value: 'recent', label: 'Recent' }],
      onSortChange() {},
      onShareSetlist() {},
    },
    onRequestTrashSetlist() {},
  })

  const header = $('[data-testid="workspace-setlist-header"]')
  assert.ok(header)
  assert.match(header.className, /flex-col md:flex-row/, 'header uses flex-col for compact screens and md:flex-row for desktop')

  // Priority 1: Title and Rename
  const title = $('[data-testid="workspace-setlist-name"]')
  const rename = $('[data-testid="workspace-rename-setlist"]')
  assert.ok(title)
  assert.ok(rename)

  // Priority 2: Count and Folder selector
  const count = $('[data-testid="workspace-setlist-count"]')
  const folder = $('[data-testid="workspace-setlist-folder-select"]')
  assert.ok(count)
  assert.ok(folder)

  // Priority 3: Play in Stage and Search Songs
  const play = $('[data-testid="workspace-play-setlist"]')
  const search = $('[data-testid="workspace-search-songs"]')
  assert.ok(play)
  assert.ok(search)

  // Priority 4: Share and Delete
  const share = $('[data-testid="workspace-share-setlist"]')
  const del = $('[data-testid="workspace-delete-setlist"]')
  assert.ok(share)
  assert.ok(del)

  // Check DOM order conforms to priority 1 -> 2 -> 3 -> 4
  const allElements = [title, count, folder, play, search, share, del]
  for (let i = 0; i < allElements.length - 1; i++) {
    const pos = allElements[i].compareDocumentPosition(allElements[i + 1])
    assert.ok(pos & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, `element ${i} precedes element ${i + 1} in DOM`)
  }
})
