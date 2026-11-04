// #312 S2: GTAR1 Setlist Manager + multi-song search picker port (DEV-only).
// Search cases mirror GTAR1 @ da2bdee tests/multiSongSetlistPicker.test.cjs.
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
// react-dom detects input-event support from the global document when it loads.
const bootDom = new JSDOM('<!doctype html>')
Object.assign(global, { window: bootDom.window, document: bootDom.window.document })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { MultiSongSetlistPicker } = require('../src/components/MultiSongSetlistPicker.tsx')
const { songMatchesPhrase, segmentSpaceSeparatedTitles, parseSearchPhrases } = require('../src/utils/setlistPickerSearch.ts')
const { SetlistManager } = require('../src/components/SetlistManager.tsx')

const song = (id, title, artist, key, tags = [], bpm = '') => ({
  id, title, artist, key, tags, bpm, capo: 'No Capo', format: 'CHORD_PRO', transposeOffset: 0,
  rawContent: `{title: ${title}}\n{key: ${key}}\n[${key}]Line`,
})
const SAMPLE_SONGS = [
  song('song-1', 'Amazing Grace', 'John Newton', 'G', ['hymn', 'traditional'], '72'),
  song('song-2', 'Hallelujah', 'Leonard Cohen', 'C', ['classic']),
  song('song-3', 'Hallelujah', 'Jeff Buckley', 'F', ['cover', 'rock'], '60'),
  song('song-4', 'Hotel California', 'Eagles', 'Bm', ['rock', 'classic']),
]
const OWNER_WORSHIP_SONGS = [
  ...SAMPLE_SONGS,
  song('song-5', 'Christ Be Magnified', 'Cody Carnes', 'A', ['worship', 'contemporary']),
  song('song-6', 'Goodness of God', 'Bethel Music', 'Ab', ['worship', 'praise']),
  song('song-7', 'Great Are You Lord', 'All Sons & Daughters', 'G', ['worship']),
]
const SAMPLE_SETLIST = { id: 'setlist-trial', name: 'trial', createdAt: 5000, songs: [{ id: 'song-1', title: 'Amazing Grace', artist: 'John Newton' }] }

let dom, root
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://gtar.test' })
  Object.assign(global, {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
  })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})
afterEach(async () => { if (root) { await act(async () => root.unmount()); root = null } dom.window.close() })

async function mount(type, props) {
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(type, props)))
}
const rerender = async (type, props) => act(async () => root.render(React.createElement(type, props)))
const $ = sel => document.querySelector(sel)
const $$ = sel => [...document.querySelectorAll(sel)]
const options = () => $$('[role="option"]')
const optionTitles = () => options().map(el => el.querySelector('[data-testid="picker-option-title"]').textContent.trim())
const button = text => $$('button').find(b => b.textContent.includes(text))
async function click(el) { assert.ok(el, 'control exists'); await act(async () => el.click()) }
async function type(el, value) {
  assert.ok(el, 'input exists')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
async function key(target, init) {
  await act(async () => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))
}
const pickerProps = (overrides = {}) => ({
  isOpen: true, onClose() {}, currentSetlist: SAMPLE_SETLIST, allSongs: SAMPLE_SONGS, onAddSongs: async () => true, ...overrides,
})

test('PICKER_PARSER: parseSearchPhrases / segmentSpaceSeparatedTitles match GTAR1 cases', () => {
  assert.deepEqual(parseSearchPhrases('Amazing Grace', OWNER_WORSHIP_SONGS), ['Amazing Grace'])
  assert.deepEqual(parseSearchPhrases('Goodness of', OWNER_WORSHIP_SONGS), ['Goodness of'])
  assert.deepEqual(parseSearchPhrases('Christ Be Magnified, Goodness of God, Great Are You Lord', OWNER_WORSHIP_SONGS),
    ['Christ Be Magnified', 'Goodness of God', 'Great Are You Lord'])
  assert.deepEqual(parseSearchPhrases('Goodness of God Great Are You Lord', OWNER_WORSHIP_SONGS), ['Goodness of God', 'Great Are You Lord'])
  assert.deepEqual(parseSearchPhrases('Amazing Grace Hotel California', OWNER_WORSHIP_SONGS), ['Amazing Grace', 'Hotel California'])
  assert.deepEqual(parseSearchPhrases('Goodness of God Great Are', OWNER_WORSHIP_SONGS), ['Goodness of God', 'Great Are'])
  assert.deepEqual(parseSearchPhrases('Amazing Grace, ', OWNER_WORSHIP_SONGS), ['Amazing Grace'])
  assert.deepEqual(parseSearchPhrases(', , ,', OWNER_WORSHIP_SONGS), [])
  assert.deepEqual(segmentSpaceSeparatedTitles('Goodness of God Great Are You Lord', OWNER_WORSHIP_SONGS), ['Goodness of God', 'Great Are You Lord'])
})

test('PICKER_MATCH: songMatchesPhrase covers title, artist, key, tag and key:/artist:/title: filters', () => {
  const s5 = OWNER_WORSHIP_SONGS.find(s => s.id === 'song-5')
  assert.ok(songMatchesPhrase(s5, 'Christ Be Magnified'))
  assert.ok(songMatchesPhrase(s5, 'Cody Carnes'))
  assert.ok(songMatchesPhrase(s5, 'A'))
  assert.ok(songMatchesPhrase(s5, 'worship'), 'tag match')
  assert.ok(!songMatchesPhrase(s5, 'Hotel'))
  const buckley = SAMPLE_SONGS[2]
  assert.ok(songMatchesPhrase(buckley, 'Hallelujah Jeff'), 'multi-word phrase across title and artist')
  assert.ok(songMatchesPhrase(buckley, 'key:F'))
  assert.ok(!songMatchesPhrase(buckley, 'key:C'))
  assert.ok(songMatchesPhrase(buckley, 'artist:buckley'))
  assert.ok(!songMatchesPhrase(buckley, 'artist:hallelujah'), 'artist: does not fall back to title')
  assert.ok(songMatchesPhrase(buckley, 'title:hallel'))
  assert.ok(!songMatchesPhrase(buckley, 'title:jeff'), 'title: does not fall back to artist')
  assert.ok(songMatchesPhrase({ ...buckley, tags: 'Cover, Rock' }, 'rock'), 'legacy string tags are normalized')
  assert.ok(!songMatchesPhrase(buckley, '   '))
})

test('PICKER_SEARCH: live search by artist, key, multi-word titles, comma lists and no-match state', async () => {
  await mount(MultiSongSetlistPicker, pickerProps({ allSongs: OWNER_WORSHIP_SONGS }))
  assert.equal(options().length, 7, 'all songs listed before typing')
  const hallelujah = options().filter(el => el.textContent.includes('Hallelujah'))
  assert.equal(hallelujah.length, 2, 'duplicate titles stay distinct')
  assert.match(hallelujah[0].textContent, /Leonard Cohen.*Key: C/)
  assert.match(hallelujah[1].textContent, /Jeff Buckley.*Key: F.*60 BPM/)
  const input = $('#multi-song-search-input')
  await type(input, 'Buckley')
  assert.deepEqual(optionTitles(), ['Hallelujah'])
  assert.match(options()[0].textContent, /Jeff Buckley/)
  await type(input, 'Bm')
  assert.deepEqual(optionTitles(), ['Hotel California'])
  await type(input, 'key:G')
  assert.deepEqual(optionTitles(), ['Amazing Grace', 'Great Are You Lord'])
  await type(input, 'artist:eagles')
  assert.deepEqual(optionTitles(), ['Hotel California'])
  await type(input, 'title:great')
  assert.deepEqual(optionTitles(), ['Great Are You Lord'])
  await type(input, 'praise')
  assert.deepEqual(optionTitles(), ['Goodness of God'], 'tag match')
  await type(input, 'Goodness of')
  assert.deepEqual(optionTitles(), ['Goodness of God'])
  await type(input, 'Christ Be Magnified, Goodness of God, Great Are You Lord')
  assert.deepEqual(optionTitles(), ['Christ Be Magnified', 'Goodness of God', 'Great Are You Lord'])
  await type(input, 'Goodness of God Great Are You Lord')
  assert.deepEqual(optionTitles(), ['Goodness of God', 'Great Are You Lord'])
  await type(input, 'Amazing Grace Hotel California')
  assert.deepEqual(optionTitles(), ['Amazing Grace', 'Hotel California'])
  await type(input, 'Amazing Grace, ')
  assert.deepEqual(optionTitles(), ['Amazing Grace'])
  await type(input, 'NonExistentSong12345')
  assert.equal(options().length, 0)
  assert.match(document.body.textContent, /No songs match your search/)
})

test('PICKER_SELECTION: checkbox rows, count, selection order kept across filtering, one add call', async () => {
  const calls = []
  await mount(MultiSongSetlistPicker, pickerProps({ onAddSongs: async songs => { calls.push(songs.map(s => s.id)); return true } }))
  const row = text => options().find(el => el.textContent.includes(text))
  assert.equal(row('Hotel California').querySelector('input[type="checkbox"]').checked, false)
  await click(row('Hotel California'))
  await click(row('Jeff Buckley'))
  assert.match(document.body.textContent, /2 songs selected/)
  assert.equal(row('Hotel California').getAttribute('aria-selected'), 'true')
  assert.equal(row('Hotel California').querySelector('input[type="checkbox"]').checked, true)
  await click(row('Hotel California'))
  assert.match(document.body.textContent, /1 song selected/)
  await click(row('Hotel California'))
  await type($('#multi-song-search-input'), 'Leonard')
  assert.match(document.body.textContent, /2 songs selected/, 'selection survives filtering')
  await click(row('Leonard Cohen'))
  await type($('#multi-song-search-input'), '')
  await click(button('Add 3 Selected Songs'))
  assert.deepEqual(calls, [['song-3', 'song-4', 'song-2']], 'one add, in selection order')
})

test('PICKER_DUPLICATES: songs already in the setlist are marked and cannot be added again', async () => {
  const calls = []
  await mount(MultiSongSetlistPicker, pickerProps({ onAddSongs: async songs => { calls.push(songs.map(s => s.id)); return true } }))
  const grace = options().find(el => el.textContent.includes('Amazing Grace'))
  assert.match(grace.textContent, /In setlist/)
  assert.equal(grace.getAttribute('aria-disabled'), 'true')
  await click(grace)
  assert.match(document.body.textContent, /0 songs selected/)
  await click(button('Select all matching'))
  assert.match(document.body.textContent, /3 songs selected/, 'select all skips the song already in the setlist')
  await click(button('Clear'))
  assert.match(document.body.textContent, /0 songs selected/)
  await click(button('Select all matching'))
  await click(button('Add 3 Selected Songs'))
  assert.deepEqual(calls, [['song-2', 'song-3', 'song-4']])
})

test('PICKER_SUBMIT: shows "Adding to setlist..." while saving, keeps selection and reports failure', async () => {
  let release
  let closed = 0
  const pending = new Promise(resolve => { release = resolve })
  await mount(MultiSongSetlistPicker, pickerProps({ onClose: () => { closed++ }, onAddSongs: () => pending }))
  await click(options().find(el => el.textContent.includes('Eagles')))
  await click(button('Add 1 Selected Song'))
  const busy = button('Adding to setlist...')
  assert.ok(busy, 'busy label')
  assert.equal(busy.disabled, true)
  await act(async () => { release(false); await pending })
  assert.equal(closed, 0, 'failed add keeps the picker open')
  assert.match($('[role="alert"]').textContent, /not added/i)
  assert.match(document.body.textContent, /1 song selected/)
})

test('PICKER_CANCEL: Escape and Cancel close without adding', async () => {
  let added = 0
  let closed = 0
  await mount(MultiSongSetlistPicker, pickerProps({ onClose: () => { closed++ }, onAddSongs: async () => { added++; return true } }))
  await click(options()[1])
  await key($('#multi-song-search-input'), { key: 'Escape' })
  await click(button('Cancel'))
  assert.equal(closed, 2)
  assert.equal(added, 0)
})

test('PICKER_LAYOUT: full-height sheet on phones, centered dialog on desktop, theme tokens, 44px targets', async () => {
  await mount(MultiSongSetlistPicker, pickerProps())
  const dialog = $('[role="dialog"][aria-label="Multi-song search picker"]')
  assert.ok(dialog)
  assert.equal(dialog.getAttribute('aria-modal'), 'true')
  assert.match(dialog.className, /h-full/)
  assert.match(dialog.className, /sm:max-w-2xl/)
  assert.match(dialog.className, /sm:rounded-2xl/)
  for (const row of options()) assert.match(row.className, /min-h-11/)
  for (const b of $$('[role="dialog"] button')) assert.match(b.className, /min-h-11|w-11 h-11/, `44px target: ${b.textContent || b.getAttribute('aria-label')}`)
  const source = fs.readFileSync(path.join(__dirname, '../src/components/MultiSongSetlistPicker.tsx'), 'utf8')
    + fs.readFileSync(path.join(__dirname, '../src/components/SetlistManager.tsx'), 'utf8')
  assert.doesNotMatch(source, /\b(purple|amber|red|emerald|sky|violet|slate|zinc|gray)-\d{2,3}\b/, 'theme tokens only')
  assert.doesNotMatch(source, /-\[#[0-9a-f]{3,8}\]|(?:color|background)\s*:\s*['"]?#[0-9a-f]{3,8}/i, 'no hard-coded colors')
})

const managerSetlists = [
  { id: 'sl-1', name: 'Sunday AM', songs: [
    { id: 'song-2', title: 'Hallelujah', artist: 'Leonard Cohen' },
    { id: 'gone', title: 'Old Song', artist: 'Nobody' },
    { id: 'song-4', title: 'Hotel California', artist: 'Eagles' },
  ] },
  { id: 'sl-2', name: 'Empty Night', songs: [] },
]
function managerProps(overrides = {}) {
  const calls = []
  const props = {
    setlists: managerSetlists, songs: SAMPLE_SONGS, selectedSetlistId: 'sl-1',
    onSelectSetlist: id => calls.push(['select', id]), onClose: () => calls.push(['close']),
    onRenameSetlist: (id, name) => { calls.push(['rename', id, name]); return true },
    onDeleteSetlist: id => { calls.push(['delete', id]); return true },
    onMoveSong: (id, index, dir) => { calls.push(['move', id, index, dir]); return true },
    onRemoveSong: (id, index) => { calls.push(['remove', id, index]); return true },
    onAddSongs: (id, ids) => { calls.push(['add', id, ids]); return true },
    onPlaySetlist: (id, position) => calls.push(['play', id, position]),
    ...overrides,
  }
  return { props, calls }
}

test('MANAGER_LAYOUT: header bar, name + Rename, Delete, Play in Stage, picker button, Add Shortcut row, ordered list, no folder select', async () => {
  const { props } = managerProps()
  await mount(SetlistManager, props)
  const dialog = $('[role="dialog"][aria-label="Setlist Manager"]')
  assert.ok(dialog)
  assert.ok($('[data-testid="setlist-manager-header"]'))
  assert.match($('[data-testid="setlist-manager-name"]').textContent, /Sunday AM/)
  for (const label of ['Rename', 'Delete Setlist', 'Play Setlist in Stage', 'Search Multi-Songs', '+ Add Shortcut']) assert.ok(button(label), label)
  assert.equal(button('Search Multi-Songs').getAttribute('aria-keyshortcuts'), 'Control+K')
  assert.ok($('[data-testid="setlist-manager-shortcut-select"]'))
  assert.doesNotMatch(dialog.textContent, /Folder/)
  const rows = $$('[data-testid^="setlist-manager-entry-"]').filter(el => /entry-\d+$/.test(el.dataset.testid))
  assert.equal(rows.length, 3)
  assert.match(rows[0].textContent, /^1.*Hallelujah.*Leonard Cohen/)
  assert.match(rows[1].textContent, /Song missing/)
  assert.match(rows[2].textContent, /Hotel California/)
  for (const b of $$('[role="dialog"] button')) assert.match(b.className, /min-h-11|w-11 h-11/, `44px target: ${b.textContent || b.getAttribute('aria-label')}`)
})

test('MANAGER_EMPTY: empty setlist shows the empty state and no Play button', async () => {
  const { props } = managerProps({ selectedSetlistId: 'sl-2' })
  await mount(SetlistManager, props)
  assert.match($('[data-testid="setlist-manager-empty"]').textContent, /no songs/i)
  assert.equal(button('Play Setlist in Stage'), undefined)
})

test('MANAGER_ACTIONS: rename, delete (confirmed), reorder, remove, play call the guarded handlers', async () => {
  const { props, calls } = managerProps()
  await mount(SetlistManager, props)
  await click(button('Rename'))
  await type($('[data-testid="setlist-manager-rename-input"]'), '  Sunday PM ')
  await click(button('Save'))
  await click($('[data-testid="setlist-manager-entry-0-down"]'))
  assert.equal($('[data-testid="setlist-manager-entry-0-up"]').disabled, true)
  assert.equal($('[data-testid="setlist-manager-entry-2-down"]').disabled, true)
  await click($('[data-testid="setlist-manager-entry-2-up"]'))
  await click($('[data-testid="setlist-manager-entry-1-remove"]'))
  await click(button('Play Setlist in Stage'))
  await click(button('Delete Setlist'))
  assert.ok($('[role="alertdialog"]'), 'delete asks first')
  await click($$('[role="alertdialog"] button').find(b => b.textContent === 'Delete'))
  assert.deepEqual(calls, [
    ['rename', 'sl-1', 'Sunday PM'], ['move', 'sl-1', 0, 'down'], ['move', 'sl-1', 2, 'up'],
    ['remove', 'sl-1', 1], ['play', 'sl-1', 0], ['delete', 'sl-1'],
  ])
})

test('MANAGER_ADD_SHORTCUT: Add Shortcut adds one song through the same add handler', async () => {
  const { props, calls } = managerProps()
  await mount(SetlistManager, props)
  const select = $('[data-testid="setlist-manager-shortcut-select"]')
  const values = [...select.options].map(o => o.value)
  assert.ok(!values.includes('song-2'), 'songs already in the setlist are not offered')
  await act(async () => {
    select.value = 'song-3'
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  await click(button('+ Add Shortcut'))
  assert.deepEqual(calls, [['add', 'sl-1', ['song-3']]])
})

test('MANAGER_PICKER: picker adds N songs in one call and reports success', async () => {
  const { props, calls } = managerProps()
  await mount(SetlistManager, props)
  await click(button('Search Multi-Songs'))
  const row = text => options().find(el => el.textContent.includes(text))
  await click(row('Jeff Buckley'))
  await click(row('Amazing Grace'))
  await click(button('Add 2 Selected Songs'))
  assert.deepEqual(calls, [['add', 'sl-1', ['song-3', 'song-1']]])
  assert.equal($('[aria-label="Multi-song search picker"]'), null, 'picker closes on success')
  assert.match($('[data-testid="setlist-manager-status"]').textContent, /Added 2 songs/)
})

test('MANAGER_SHORTCUT: Ctrl+K opens the picker except while typing, blocked (Stage) or another dialog is open', async () => {
  const { props } = managerProps()
  await mount(SetlistManager, props)
  const picker = () => $('[aria-label="Multi-song search picker"]')
  await key(window, { key: 'k', ctrlKey: true })
  assert.ok(picker(), 'Ctrl+K opens')
  await key($('#multi-song-search-input'), { key: 'Escape' })
  assert.equal(picker(), null)
  await key(window, { key: 's', altKey: true })
  assert.equal(picker(), null, 'Alt+S no longer opens the picker')
  await key(window, { key: 'k', ctrlKey: true })
  assert.ok(picker(), 'Ctrl+K reopens')
  await click($('[aria-label^="Close search picker"]'))
  await click(button('Rename'))
  await key($('[data-testid="setlist-manager-rename-input"]'), { key: 'k', ctrlKey: true })
  assert.equal(picker(), null, 'ignored while typing in another field')
  await click(button('Cancel'))
  await click(button('Delete Setlist'))
  await key(window, { key: 'k', ctrlKey: true })
  assert.equal(picker(), null, 'ignored while the delete dialog is open')
  await click($$('[role="alertdialog"] button').find(b => b.textContent === 'Cancel'))
  const other = document.createElement('div')
  other.setAttribute('role', 'dialog'); other.setAttribute('aria-modal', 'true')
  document.body.appendChild(other)
  await key(window, { key: 'k', ctrlKey: true })
  assert.equal(picker(), null, 'ignored while another app dialog is open')
  other.remove()
  await rerender(SetlistManager, { ...props, shortcutsBlocked: true })
  await key(window, { key: 'k', ctrlKey: true })
  assert.equal(picker(), null, 'ignored while Stage is active')
  await rerender(SetlistManager, { ...props, shortcutsBlocked: false })
  await key(window, { key: 'k', ctrlKey: true })
  assert.ok(picker(), 'works again once unblocked')
})

// Codex P2 on #314: focus moves into the manager, stays there, and returns to the trigger.
const focusables = sel => $$(`${sel} button:not([disabled]), ${sel} input:not([disabled]), ${sel} select:not([disabled]), ${sel} [tabindex="0"]`)
const managerDialog = () => $('[role="dialog"][aria-label="Setlist Manager"]')

test('MANAGER_FOCUS: focus moves into the manager on open', async () => {
  const { props } = managerProps()
  await mount(SetlistManager, props)
  assert.equal(document.activeElement, $('[data-testid="setlist-manager-title"]'))
  assert.equal(document.activeElement.getAttribute('tabindex'), '-1')
  assert.ok(managerDialog().contains(document.activeElement))
})

test('MANAGER_FOCUS: Tab and Shift+Tab wrap inside the manager, the picker and the delete dialog', async () => {
  const { props } = managerProps()
  await mount(SetlistManager, props)
  const sel = '[role="dialog"][aria-label="Setlist Manager"]'
  let items = focusables(sel)
  items.at(-1).focus()
  await key(items.at(-1), { key: 'Tab' })
  assert.equal(document.activeElement, items[0], 'Tab on last wraps to first')
  await key(items[0], { key: 'Tab', shiftKey: true })
  assert.equal(document.activeElement, items.at(-1), 'Shift+Tab on first wraps to last')

  await click(button('Search Multi-Songs'))
  const pickerSel = '[role="dialog"][aria-label="Multi-song search picker"]'
  items = focusables(pickerSel)
  items.at(-1).focus()
  await key(items.at(-1), { key: 'Tab' })
  assert.equal(document.activeElement, items[0], 'picker traps its own focus')
  await key(items[0], { key: 'Tab', shiftKey: true })
  assert.equal(document.activeElement, items.at(-1))
  await key($('#multi-song-search-input'), { key: 'Escape' })

  await click(button('Delete Setlist'))
  const confirmItems = $$('[role="alertdialog"] button')
  assert.equal(document.activeElement, confirmItems[0], 'delete dialog focuses Cancel')
  await key(confirmItems.at(-1), { key: 'Tab' })
  assert.equal(document.activeElement, confirmItems[0])
  await key(confirmItems[0], { key: 'Tab', shiftKey: true })
  assert.equal(document.activeElement, confirmItems.at(-1))
})

test('MANAGER_FOCUS: Escape closes only the topmost layer (rename → delete → picker → manager)', async () => {
  const { props, calls } = managerProps()
  await mount(SetlistManager, props)
  await click(button('Rename'))
  await key($('[data-testid="setlist-manager-rename-input"]'), { key: 'Escape' })
  assert.equal($('[data-testid="setlist-manager-rename-input"]'), null, 'rename edit closed')
  assert.ok(managerDialog(), 'manager still open')
  assert.equal(document.activeElement, button('Rename'))

  await click(button('Delete Setlist'))
  await key(document.activeElement, { key: 'Escape' })
  assert.equal($('[role="alertdialog"]'), null, 'delete confirm closed')
  assert.equal(document.activeElement, button('Delete Setlist'))

  await click(button('Search Multi-Songs'))
  const firstOption = $('[role="option"]')
  firstOption.focus()
  await key(firstOption, { key: 'Escape' })
  assert.equal($('[aria-label="Multi-song search picker"]'), null, 'picker closed')
  assert.ok(managerDialog())
  assert.deepEqual(calls.filter(c => c[0] === 'close'), [])

  await key(document.activeElement, { key: 'Escape' })
  assert.deepEqual(calls.filter(c => c[0] === 'close'), [['close']], 'then the manager closes')
})

test('MANAGER_FOCUS: background is inert while open; focus returns to the trigger on close', async () => {
  const trigger = document.createElement('button')
  trigger.textContent = 'Edit in Setlist Manager'
  document.getElementById('root').before(trigger)
  trigger.focus()
  const { props } = managerProps()
  await mount(SetlistManager, { ...props, returnFocusTo: trigger })
  const appRoot = document.getElementById('root')
  assert.ok(appRoot.hasAttribute('inert'), 'app root inert')
  assert.equal(appRoot.getAttribute('aria-hidden'), 'true', 'aria-hidden fallback')
  assert.ok(!appRoot.contains(managerDialog()), 'manager renders outside the inert root')
  assert.notEqual(document.activeElement, trigger)
  await act(async () => root.render(null))
  assert.equal(appRoot.hasAttribute('inert'), false, 'inert removed on close')
  assert.equal(appRoot.hasAttribute('aria-hidden'), false)
  assert.equal(document.activeElement, trigger, 'focus back on the trigger')
})
