// GH#418: ProPresenter-style contextual help across GTAR's menus, Advanced Tools in the Settings visual
// language, a compact Setlist Manager with one add-song route, and "+ Add" label cleanup.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.app/' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true, isSecureContext: true, FormData: dom.window.FormData })
Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent: 'Chrome/157', platform: 'Linux', maxTouchPoints: 0, onLine: true } })
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const Module = require('node:module'), originalLoad = Module._load
Module._load = function (request, parent, ...args) {
  if (parent?.filename && /[\\/]components[\\/]Header\.tsx$/.test(parent.filename)) {
    if (request === '../utils/env') return { isDevEnv: false }
    if (request.endsWith('.png')) return 'logo.png'
    if (request === '../utils/onlineSearch') return {}
    if (request.startsWith('./') && request.endsWith('Modal')) return new Proxy({}, { get: () => () => null })
  }
  return originalLoad.call(this, request, parent, ...args)
}
const { Header } = require('../src/components/Header.tsx')
Module._load = originalLoad
const help = require('../src/components/menuHelp.tsx')
const { ProPresenterHelp } = require('../src/components/ProPresenterHelp.tsx')
const { SetlistManager } = require('../src/components/SetlistManager.tsx')
const { MultiSongSetlistPicker } = require('../src/components/MultiSongSetlistPicker.tsx')
const { StageOptionsSheet } = require('../src/components/StageOptionsSheet.tsx')
const { registry } = require('../src/extensions/registry.ts')

const read = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')
const q = selector => document.querySelector(selector)
const qa = selector => [...document.querySelectorAll(selector)]
const click = el => act(async () => { el.click() })
const key = (name, target = window) => act(async () => { target.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })) })
const panel = () => q('[data-contextual-help]')
const topicTitles = () => [...panel().querySelectorAll('summary')].map(summary => summary.textContent)

async function mount(element) {
  localStorage.clear()
  const container = document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  await act(async () => root.render(element))
  return root
}
const unmount = root => act(async () => root.unmount())

const noop = () => {}
const song = { id: 's1', title: 'A', rawContent: 'C' }
const headerProps = { activeView: 'songbook', song, searchQuery: '', onViewChange: noop, onSearchQueryChange: noop, onToggleTheme: noop, backupSongs: [song] }

const MENUS = [
  ['SettingsHelp', { showInstall: true }, 'Settings Help', ['Theme', 'Backup & Restore', 'Debug Logs', 'Trash', 'Install App (PWA)']],
  ['AdvancedToolsHelp', { stageTools: ['Metronome', 'Tuner'], extensions: registry.map(entry => entry.manifest) }, 'Advanced Tools Help', ['Online Song Sources', 'Metronome', 'Tuner', 'MIDI', ...registry.map(entry => entry.manifest.name), 'Status labels']],
  ['BandSyncHelp', {}, 'Band Sync Help', ['Start room', 'Join with code', 'Leave or End room', 'Status', 'On / Off switch']],
  ['SongsLibraryHelp', { canImport: true, canCheckDuplicates: true }, 'Songs Help', ['Filters', 'Sort', 'Select', 'Import songs', 'Export songs', 'Check duplicates', 'Add Song']],
  ['SetlistsHelp', {}, 'Setlists Help', ['Sort', 'Manage', 'Share', 'Import Setlist', 'Export Setlist', 'Add new setlist', 'Inside a setlist']],
  ['SetlistManagerHelp', { showFolder: true }, 'Setlist Manager Help', ['Setlist', 'Folder', 'Play Setlist in Stage', 'Delete Setlist', 'Search Songs', 'Order']],
  ['StagePreviewHelp', {}, 'Stage Preview Help', ['Editor', 'Metronome and Tuner', 'Key', 'Chords / NNS', 'Auto-scroll', 'Stage Options', 'Cast', 'Fullscreen']],
  ['StageOptionsHelp', { showQuickJump: true }, 'Stage Options Help', ['Auto-Scroll Speed', 'Notation Mode', 'Text size and style', 'Layout and controls', 'Keep Screen Awake', 'Fullscreen Mode', 'TV & Second Screen', 'Setlist Quick-Jump']],
  ['EditorHelp', {}, 'Editor Help', ['Save', 'Brackets []', 'Insert Section', 'Song Details', 'Sections vs Raw View', 'Undo and Redo', 'Clipboard tools', 'New Song']],
  ['ThemeHelp', {}, 'Stage Color Theme Help', ['Theme selection', 'Light Mode', 'Dark Mode', 'Not Assigned', 'Customize This Theme', 'Save', 'Apply']],
  ['ImportSongsHelp', {}, 'Import Songs Help', ['Supported formats', 'Folder import', 'OnSong files', 'Duplicate handling']],
  ['ExportSongsHelp', {}, 'Export Songs Help', ['Export formats', 'Saved vs Transposed key', 'Song filtering', 'Bulk selection', 'Export action']],
  ['BackupRestoreHelp', {}, 'Backup & Restore Help', ['Save backup file', 'Download backup', 'Copy backup', 'Restore from file', 'Merge vs Replace (Destructive)', 'Settings recovery']],
  ['DebugLogsHelp', {}, 'Debug Logs Help', ['Severity filters', 'Copy All', 'Share', 'Download .log', 'Clear (Destructive)', 'Recovery Data']],
]

test('every menu help is the ProPresenter help: same button, same portaled panel, one short topic per option', async () => {
  let root = await mount(React.createElement(ProPresenterHelp))
  const reference = q('button[aria-expanded]')
  const buttonClass = reference.className
  await click(reference)
  const panelClass = panel().className
  await unmount(root)
  assert.match(buttonClass, /before:-inset-1\.5/, 'the 32px help button carries a 44px touch target')

  const ids = new Set()
  for (const [name, props, title, expected] of MENUS) {
    root = await mount(React.createElement(help[name], props))
    const button = q('button[aria-expanded]')
    assert.equal(button.className, buttonClass, `${name}: same help indicator`)
    assert.match(button.getAttribute('aria-label'), /^Help for /, `${name}: accessible name`)
    assert.equal(button.getAttribute('aria-expanded'), 'false')
    assert.equal(panel(), null, `${name}: closed until asked for`)
    await click(button)
    assert.equal(button.getAttribute('aria-expanded'), 'true')
    assert.equal(panel().id, button.getAttribute('aria-controls'))
    assert.ok(!ids.has(panel().id), `${name}: unique id`)
    ids.add(panel().id)
    assert.equal(panel().className, panelClass, `${name}: same popover`)
    assert.ok(panel().parentElement === document.body, `${name}: portaled, so no menu can clip it`)
    assert.match(panel().textContent, new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.deepEqual(topicTitles(), expected, `${name}: one topic per option`)
    const topics = [...panel().querySelectorAll('details')]
    assert.deepEqual(topics.map(topic => topic.open), topics.map((_, index) => index === 0), `${name}: only the first topic starts open`)
    for (const topic of topics) {
      const text = topic.querySelector('p').textContent
      assert.ok(text.length >= 30 && text.length <= 260, `${name}: "${topic.querySelector('summary').textContent}" is a short explanation (${text.length} chars)`)
    }
    await key('Escape')
    assert.equal(panel(), null, `${name}: Escape closes it`)
    assert.ok(document.activeElement === button, `${name}: focus returns to the help button`)
    await unmount(root)
  }
})

test('optional topics follow what the menu actually offers', async () => {
  for (const [name, props, absent] of [
    ['SettingsHelp', {}, 'Install App (PWA)'],
    ['SongsLibraryHelp', {}, 'Import songs'],
    ['SongsLibraryHelp', {}, 'Check duplicates'],
    ['SetlistManagerHelp', {}, 'Folder'],
    ['StageOptionsHelp', {}, 'Setlist Quick-Jump'],
  ]) {
    const root = await mount(React.createElement(help[name], props))
    await click(q('button[aria-expanded]'))
    assert.ok(!topicTitles().includes(absent), `${name}: no "${absent}" topic`)
    await unmount(root)
  }
})

test('Settings menu: help covers every option except About, and using it does not dismiss the menu', async () => {
  const root = await mount(React.createElement(Header, headerProps))
  try {
    await click(q('[data-testid="header-settings"]'))
    const menu = q('[role="menu"][aria-label="Settings"]')
    const helpButton = menu.querySelector('[data-testid="settings-help-button"]')
    assert.ok(helpButton, 'help indicator in the Settings header')
    assert.equal(menu.querySelectorAll('button[aria-expanded]').length, 1, 'one indicator for the whole menu, not one per row')
    await click(helpButton)
    assert.deepEqual(topicTitles(), ['Theme', 'Backup & Restore', 'Debug Logs', 'Trash', 'Install App (PWA)'])
    assert.doesNotMatch(panel().textContent, /About/, 'About is left out')
    assert.equal(q('[data-testid="settings-about-button"]').textContent, 'About GTAR', 'About row unchanged')

    // The panel is portaled outside the menu; pressing inside it is not an "outside click".
    await act(async () => { panel().dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
    assert.ok(q('[role="menu"][aria-label="Settings"]'), 'menu survives a press inside the help panel')
    await key('Escape')
    assert.equal(panel(), null, 'Escape closes help first')
    assert.ok(q('[role="menu"][aria-label="Settings"]'), 'menu survives the help Escape')
    await key('Escape')
    assert.equal(q('[role="menu"][aria-label="Settings"]'), null, 'second Escape closes the menu')
    assert.ok(document.activeElement === q('[data-testid="header-settings"]'))
  } finally { await unmount(root) }
})

test('Advanced Tools: Settings visual language, help in the header, toggles and launchers still work', async () => {
  const root = await mount(React.createElement(Header, headerProps))
  try {
    await click(q('[data-testid="header-settings"]'))
    const settingsMenu = q('[role="menu"][aria-label="Settings"]')
    const settingsRow = q('[data-testid="settings-theme-button"]')
    const iconClass = svg => svg.getAttribute('class').replace(/\blucide\S*\s*/g, '')
    const settingsIcon = iconClass(settingsRow.querySelector('svg'))
    const settingsHeader = settingsMenu.firstElementChild.className
    await click(q('[data-testid="header-settings"]'))

    await click(q('[data-testid="header-advanced-tools"]'))
    const popover = q('[data-testid="advanced-tools-popover"]')
    assert.equal(popover.firstElementChild.className, settingsHeader, 'same header row as Settings')
    assert.doesNotMatch(popover.firstElementChild.textContent, /Integrations/, 'header is the title and the help indicator only')
    const rows = [popover.querySelector('[data-testid="online-sources-row"] > div'), ...registry.map(entry => popover.querySelector(`[data-testid="extension-${entry.manifest.id}"]`))]
    assert.equal(rows.length, 1 + registry.length)
    const tokens = value => new Set(value.split(/\s+/).filter(Boolean))
    for (const row of rows) {
      assert.ok(row, 'row rendered')
      // Same card as a Settings row: border, radius, 44px height, type scale and left padding.
      for (const cls of ['min-h-11', 'px-3', 'rounded-xl', 'bg-app-base', 'border', 'border-app-border', 'text-xs', 'font-semibold', 'text-app-heading', 'ui-primary-text']) {
        assert.ok(tokens(settingsRow.className).has(cls) && tokens(row.className).has(cls), `row shares ${cls} with Settings`)
      }
      assert.equal(row.querySelector('[class*="w-8 h-8"]'), null, 'no boxed icon')
      assert.doesNotMatch(row.innerHTML, /sm:text-sm|font-bold text-app-heading/, 'no heavier, larger label than Settings')
      const launcher = row.querySelector('button[aria-haspopup="dialog"]')
      assert.equal(iconClass(launcher.querySelector('svg')), settingsIcon, 'flat icon, sized and colored like Settings icons')
      assert.match(launcher.className, /min-h-11/, 'launcher keeps a 44px target')
      const toggle = row.querySelector('[role="switch"]')
      assert.match((toggle.closest('label') ?? toggle).className, /min-w-\[44px\] min-h-\[44px\]/, 'switch keeps a 44px target')
    }

    await click(popover.querySelector('[data-testid="advanced-tools-help-button"]'))
    assert.deepEqual(topicTitles(), ['Online Song Sources', 'Metronome', 'Tuner', 'MIDI', ...registry.map(entry => entry.manifest.name), 'Status labels'])
    await key('Escape')
    assert.ok(q('[data-testid="advanced-tools-popover"]'), 'menu survives the help Escape')

    const toggle = q('[data-testid="settings-online-sources"]')
    const before = toggle.getAttribute('aria-checked')
    await click(toggle)
    assert.notEqual(q('[data-testid="settings-online-sources"]').getAttribute('aria-checked'), before, 'switch still toggles')
    assert.ok(q('[data-testid="advanced-tools-popover"]'), 'toggling keeps the menu open')
    await click(q('[data-testid="extension-band-sync-expand"]'))
    assert.equal(q('[data-testid="advanced-tools-popover"]'), null, 'launcher closes the menu')
    const dialog = q('[data-testid="extension-band-sync-panel"]')
    assert.ok(dialog, 'and opens the Band Sync dialog')
    assert.ok(dialog.querySelector('[data-app-modal="header"] [data-testid="band-sync-help-button"]'), 'Band Sync dialog has its own help')
    await key('Escape')
  } finally { await unmount(root) }
})

const songs = [
  { id: 'a', title: 'Amazing Grace', artist: 'John Newton', key: 'G', rawContent: '{key: G}\n[G]Line' },
  { id: 'b', title: 'Goodness of God', artist: 'Bethel Music', key: 'A', rawContent: '{key: A}\n[A]Line' },
]
const setlists = [{ id: 'sl-1', name: 'Sunday AM', songs: [{ id: 'a', title: 'Amazing Grace' }] }, { id: 'sl-2', name: 'Night', songs: [] }]
const managerProps = (overrides = {}) => ({
  setlists, songs, selectedSetlistId: 'sl-1', onSelectSetlist: noop, onClose: noop, onRenameSetlist: () => true, onDeleteSetlist: () => true,
  onMoveSong: () => true, onRemoveSong: () => true, onAddSongs: () => true, onPlaySetlist: noop, ...overrides,
})

test('Setlist Manager: compact layout, help in the header, Escape closes help before the manager', async () => {
  let closed = 0
  const root = await mount(React.createElement(SetlistManager, managerProps({ onClose: () => { closed++ }, folders: [{ id: 'f1', name: 'Sundays' }], onSetlistFolderChange: () => true })))
  try {
    const dialog = q('[role="dialog"][aria-label="Setlist Manager"]')
    assert.match(dialog.className, /sm:max-w-2xl/, 'narrower than before')
    // One row holds the setlist selector and the pencil; the name is not repeated under the selector.
    const select = q('[data-testid="setlist-manager-select"]')
    const rename = q('button[aria-label="Rename setlist"]')
    assert.ok(select.parentElement === rename.parentElement, 'selector and Rename share a row')
    assert.match(q('[data-testid="setlist-manager-name"]').className, /sr-only/, 'name heading is kept for assistive tech only')
    assert.ok(dialog.querySelector('select[aria-label="Setlist folder"]'), 'Folder stays available')
    assert.equal(dialog.querySelectorAll('select').length, 2, 'setlist and folder are the only dropdowns')
    // Search Songs sits in the Order header: no separate "Add songs" card.
    const launcher = q('[data-testid="setlist-manager-search-songs"]')
    assert.match(launcher.parentElement.textContent, /^OrderSearch Songs$/)
    assert.doesNotMatch(dialog.textContent, /Add songs/)

    const helpButton = q('[data-testid="setlist-manager-help-button"]')
    assert.ok(q('[data-testid="setlist-manager-header"]').contains(helpButton))
    await click(helpButton)
    assert.deepEqual(topicTitles(), ['Setlist', 'Folder', 'Play Setlist in Stage', 'Delete Setlist', 'Search Songs', 'Order'])
    // Tab inside the portaled help panel is not pulled back by the manager's focus trap.
    const summary = panel().querySelector('summary')
    summary.focus()
    await key('Tab', summary)
    assert.ok(document.activeElement === summary, 'focus trap leaves the help panel alone')
    await key('Escape', summary)
    assert.equal(panel(), null, 'Escape closes help')
    assert.equal(closed, 0, 'and not the manager')
    await key('Escape', helpButton)
    assert.equal(closed, 1, 'the next Escape closes the manager')
  } finally { await unmount(root) }
})

test('Search Songs dialog: one bare input inside one field, aligned rows, distinct states, plain Add label', async () => {
  const root = await mount(React.createElement(MultiSongSetlistPicker, { isOpen: true, onClose: noop, currentSetlist: setlists[0], allSongs: songs, onAddSongs: async () => true }))
  try {
    const dialog = q('[role="dialog"][aria-label="Multi-song search picker"]')
    assert.equal(dialog.querySelector('h2').textContent, 'Search Songs')
    const input = q('#multi-song-search-input')
    const field = input.parentElement
    // The field owns border and focus ring; the input uses the header-search reset so themes add no second outline.
    assert.match(field.className, /header-search-box/)
    assert.match(field.className, /border border-app-border/)
    assert.match(field.className, /focus-within:ring-2/)
    assert.match(input.className, /header-search-input/)
    assert.match(input.className, /border-0/)
    assert.match(input.className, /bg-transparent/)
    assert.doesNotMatch(input.className, /\bborder-app|\bring-2/, 'input draws no border or ring of its own')
    const css = read('index.css')
    assert.match(css, /\.header-search-input:focus-visible,[\s\S]*?outline: none !important;/, 'shared reset removes the inner focus outline')

    const [member, free] = [...dialog.querySelectorAll('[role="option"]')]
    assert.equal(member.getAttribute('aria-disabled'), 'true')
    assert.equal(member.querySelector('input'), null, 'a song already in the setlist shows no checkbox')
    assert.match(member.textContent, /In setlist$/, 'badge closes the row')
    assert.equal(free.querySelector('input[type="checkbox"]').checked, false)
    await click(free)
    assert.equal(free.getAttribute('aria-selected'), 'true')
    assert.equal(free.querySelector('input[type="checkbox"]').checked, true)
    assert.match(free.className, /bg-app-action\/15/, 'selected rows are tinted')
    assert.doesNotMatch(member.className, /bg-app-action/, 'in-setlist rows are not')
    // Every row keeps the same leading slot, so titles line up whatever the state.
    for (const row of [member, free]) assert.match(row.firstElementChild.className, /w-5 h-5 shrink-0/)

    const footer = dialog.lastElementChild
    const [cancel, add] = [...footer.querySelectorAll('button')]
    assert.equal(cancel.textContent, 'Cancel')
    assert.equal(add.textContent, 'Add 1 Selected Song')
    assert.equal(add.querySelector('svg'), null, 'no plus icon in front of Add')
    const shape = cls => cls.split(' ').filter(c => /^(min-h|sm:min-h|rounded|px|text-xs|font)-?/.test(c)).sort().join(' ')
    assert.equal(shape(cancel.className), shape(add.className), 'footer buttons share height, radius, padding and type')
    assert.match(footer.className, /safe-area-inset-bottom/, 'footer clears the phone home indicator')
    assert.match(dialog.querySelector('[role="listbox"]').className, /flex-1 min-h-0[\s\S]*overflow-y-auto/, 'only the results scroll, so the footer stays reachable')
  } finally { await unmount(root) }
})

test('Stage Options: help in the sheet header; Escape closes help before the sheet', async () => {
  let closed = 0
  const props = {
    isOpen: true, onClose: () => { closed++ }, fontSize: 18, onFontSizeChange: noop, chordScale: 1, onChordScaleChange: noop, fontWeight: 'normal', onFontWeightChange: noop,
    lineSpacing: 'normal', onLineSpacingChange: noop, fontFamily: 'mono', onFontFamilyChange: noop, notation: 'chords', onNotationChange: noop, isTwoColumn: false, onToggleTwoColumn: noop,
    showDock: false, onToggleShowDock: noop, autoScrollSpeed: 30, onAutoScrollSpeedChange: noop, autoHideControls: false, onToggleAutoHideControls: noop, wakeLockActive: false,
    onToggleWakeLock: noop, isFullscreen: false, onToggleFullscreen: noop, isFullscreenSupported: true,
  }
  const root = await mount(React.createElement(StageOptionsSheet, props))
  try {
    const sheet = q('[role="dialog"][aria-label="Stage Options"]')
    const helpButton = sheet.querySelector('[data-testid="stage-options-help-button"]')
    assert.ok(helpButton.parentElement.parentElement === sheet.querySelector('button[aria-label="Close options"]').parentElement, 'help sits beside Close')
    await click(helpButton)
    assert.ok(!topicTitles().includes('Setlist Quick-Jump'), 'no queue, no Quick-Jump topic')
    assert.ok(topicTitles().includes('Auto-Scroll Speed'))
    await key('Escape')
    assert.equal(panel(), null)
    assert.equal(closed, 0, 'sheet survives the help Escape')
    await key('Escape')
    assert.equal(closed, 1)
  } finally { await unmount(root) }
})

test('help is wired into toolbars and dialogs; About is untouched', () => {
  assert.match(read('components/SongbookHomeView.tsx'), /<SongsLibraryHelp canImport=\{Boolean\(onOpenImportSongs\)\} canCheckDuplicates=\{Boolean\(onTrashDuplicates\)\} \/>\s*<button\s+type="button"\s+data-testid="songs-library-menu-btn"/, 'Songs help sits beside the library menu')
  assert.match(read('components/SetlistWorkspace.tsx'), /<SetlistsHelp className="mr-0\.5" \/>/, 'Setlists help sits in the setlist toolbar')
  assert.match(read('components/StageView.tsx'), /<StageToolButtons [^\n]*\/>\s*<StagePreviewHelp \/>/, 'Stage Preview help follows the Metronome and Tuner buttons in the top bar')
  assert.match(read('components/StageView.tsx'), /data-testid="toolbar-back"[\s\S]*?<\/div>[\s\S]*?<div[^>]*justify-end/, 'Back button aligned separately on the left while other controls group toward the right')
  assert.match(read('components/DesktopEditor.tsx'), /<EditorHelp \/>/, 'Editor help sits in the editor header')
  assert.match(read('components/ThemeModal.tsx'), /<ThemeHelp \/>/, 'Theme help sits in the Stage Color Theme header')
  assert.match(read('components/ImportDialogModal.tsx'), /<ImportSongsHelp \/>/, 'Import songs help sits in the Import modal header')
  assert.match(read('components/ExportSongsDialog.tsx'), /<ExportSongsHelp \/>/, 'Export songs help sits in the Export dialog header')
  assert.match(read('components/CloudSyncModal.tsx'), /<BackupRestoreHelp \/>/, 'Backup & Restore help sits in the CloudSync modal header')
  assert.match(read('components/DebugLogsModal.tsx'), /<DebugLogsHelp \/>/, 'Debug logs help sits in the DebugLogs modal header')
  assert.doesNotMatch(read('components/AboutModal.tsx'), /ContextualHelp|menuHelp/)
})

test('"+ Add" wording is normalized to "Add" across rendered labels', () => {
  const dir = path.join(__dirname, '../src')
  const files = fs.readdirSync(dir, { recursive: true }).filter(file => /\.tsx$/.test(file))
  assert.ok(files.length > 40)
  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8')
    assert.doesNotMatch(source, /[>'"`]\s*\+\s?Add\b/, `${file}: no "+ Add" label`)
    assert.doesNotMatch(source, /<Plus\b[^>]*\/>\s*(?:<span>)?\s*Add\b/, `${file}: no plus icon in front of an Add label`)
  }
  assert.match(read('components/SongbookHomeView.tsx'), /data-testid="songs-add-song"[\s\S]{0,260}<span>Add Song<\/span>/)
  assert.match(read('components/SetlistWorkspace.tsx'), /aria-label="Add new setlist"[\s\S]{0,320}<span>Add new setlist<\/span>/)
  assert.match(read('components/WebsiteUrlSourceModal.tsx'), /<span>Add Custom Website URL<\/span>/)
  assert.match(read('components/MultiSongSetlistPicker.tsx'), /'Add Selected to Setlist'/)
})

test('Round 2: Stage Preview help separates Editor and Metronome/Tuner without Back; toolbar groups right', async () => {
  const root = await mount(React.createElement(help.StagePreviewHelp))
  try {
    const button = q('[data-testid="stage-preview-help-button"]')
    await click(button)
    const titles = topicTitles()
    assert.ok(!titles.includes('Back'), 'Back button is not in help topics')
    assert.ok(!titles.includes('Back and Editor'), 'Back and Editor combined topic is removed')
    assert.ok(titles.includes('Editor'), 'Dedicated Editor topic is present')
    assert.ok(titles.includes('Metronome and Tuner'), 'Dedicated Metronome and Tuner topic is present')
    assert.ok(!titles.includes('Stage Tools'), 'Stage Tools topic is retired')
  } finally { await unmount(root) }

  // Inspect StageView.tsx toolbar markup
  const stageSource = read('components/StageView.tsx')
  assert.match(stageSource, /data-testid="toolbar-back"[\s\S]*?<\/div>[\s\S]*?<div[^>]*justify-end/)
  assert.match(stageSource, /aria-label="Editor"[\s\S]*?<StageToolButtons [\s\S]*?<StagePreviewHelp \/>/)
  assert.doesNotMatch(stageSource, /Stage Tools|onOpenBandSync/)
})

test('Round 2: Destructive-operation warnings and clear topic coverage in new dialog help', async () => {
  // Backup & Restore
  let root = await mount(React.createElement(help.BackupRestoreHelp))
  try {
    await click(q('[data-testid="backup-restore-help-button"]'))
    const titles = topicTitles()
    assert.ok(titles.includes('Save backup file'))
    assert.ok(titles.includes('Download backup'))
    assert.ok(titles.includes('Copy backup'))
    assert.ok(titles.includes('Restore from file'))
    assert.ok(titles.includes('Merge vs Replace (Destructive)'))
    const replaceTopic = [...panel().querySelectorAll('details')].find(d => d.querySelector('summary').textContent === 'Merge vs Replace (Destructive)')
    assert.match(replaceTopic.textContent, /Replace overwrites what is on this device/)
  } finally { await unmount(root) }

  // Debug Logs
  root = await mount(React.createElement(help.DebugLogsHelp))
  try {
    await click(q('[data-testid="debug-logs-help-button"]'))
    const titles = topicTitles()
    assert.ok(titles.includes('Severity filters'))
    assert.ok(titles.includes('Copy All'))
    assert.ok(titles.includes('Share'))
    assert.ok(titles.includes('Download .log'))
    assert.ok(titles.includes('Clear (Destructive)'))
    assert.ok(titles.includes('Recovery Data'))
    const clearTopic = [...panel().querySelectorAll('details')].find(d => d.querySelector('summary').textContent === 'Clear (Destructive)')
    assert.match(clearTopic.textContent, /Permanently deletes all recorded debug logs/)
  } finally { await unmount(root) }

  // Theme Help
  root = await mount(React.createElement(help.ThemeHelp))
  try {
    await click(q('[data-testid="theme-help-button"]'))
    const titles = topicTitles()
    assert.ok(titles.includes('Theme selection'))
    assert.ok(titles.includes('Light Mode'))
    assert.ok(titles.includes('Dark Mode'))
    assert.ok(titles.includes('Not Assigned'))
    assert.ok(titles.includes('Customize This Theme'))
    assert.ok(titles.includes('Save'))
    assert.ok(titles.includes('Apply'))
  } finally { await unmount(root) }

  // Import Songs Help & Export Songs Help
  root = await mount(React.createElement(help.ImportSongsHelp))
  try {
    await click(q('[data-testid="import-songs-help-button"]'))
    const titles = topicTitles()
    assert.ok(titles.includes('Supported formats'))
    assert.ok(titles.includes('Folder import'))
    assert.ok(titles.includes('OnSong files'))
    assert.ok(titles.includes('Duplicate handling'))
  } finally { await unmount(root) }

  root = await mount(React.createElement(help.ExportSongsHelp))
  try {
    await click(q('[data-testid="export-songs-help-button"]'))
    const titles = topicTitles()
    assert.ok(titles.includes('Export formats'))
    assert.ok(titles.includes('Saved vs Transposed key'))
    assert.ok(titles.includes('Song filtering'))
    assert.ok(titles.includes('Bulk selection'))
    assert.ok(titles.includes('Export action'))
  } finally { await unmount(root) }

  // Editor Help
  root = await mount(React.createElement(help.EditorHelp))
  try {
    await click(q('[data-testid="editor-help-button"]'))
    const titles = topicTitles()
    assert.ok(titles.includes('Save'))
    assert.ok(titles.includes('Brackets []'))
    assert.ok(titles.includes('Insert Section'))
    assert.ok(titles.includes('Song Details'))
    assert.ok(titles.includes('Sections vs Raw View'))
    assert.ok(titles.includes('Undo and Redo'))
    assert.ok(titles.includes('Clipboard tools'))
    assert.ok(titles.includes('New Song'))
  } finally { await unmount(root) }
})

test('ExportSongsDialog: help button opens contextual help inside the dialog, Escape closes help first, dialog remains open', async () => {
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const { ExportSongsDialog } = require('../src/components/ExportSongsDialog.tsx')
  let closed = false
  const root = await mount(React.createElement(ExportSongsDialog, {
    songs: [
      { id: '1', title: 'Amazing Grace', rawContent: '{title: Amazing Grace}\n[G]Amazing [C]grace' },
      { id: '2', title: 'How Great Thou Art', rawContent: '{title: How Great Thou Art}\n[G]O Lord my God' },
    ],
    onClose() { closed = true },
  }))
  try {
    const dialogEl = q('[data-testid="export-songs-dialog"]')
    assert.ok(dialogEl, 'ExportSongsDialog is mounted')
    const helpBtn = q('[data-testid="export-songs-help-button"]')
    assert.ok(helpBtn, 'help button exists inside ExportSongsDialog')

    // Open help
    await click(helpBtn)
    const helpPanel = q('[data-contextual-help]')
    assert.ok(helpPanel, 'help panel is open')
    assert.equal(helpPanel.parentElement, dialogEl, 'help panel is portaled inside the native <dialog> to avoid inertness')
    assert.ok(helpPanel.classList.contains('absolute'), 'help panel uses absolute positioning relative to the dialog')
    assert.ok(helpPanel.classList.contains('z-[120]'), 'help panel stacks above dialog content')
    assert.ok(dialogEl.classList.contains('relative'), 'dialog container is relatively positioned')

    // Check topics
    const titles = topicTitles()
    assert.deepEqual(titles, ['Export formats', 'Saved vs Transposed key', 'Song filtering', 'Bulk selection', 'Export action'])

    // Escape closes help while dialog remains open
    await key('Escape')
    assert.equal(q('[data-contextual-help]'), null, 'help is dismissed on Escape')
    assert.equal(closed, false, 'dialog remains open after first Escape')
    assert.equal(document.activeElement, helpBtn, 'focus restored to help button')

    // Re-open and verify outside click inside dialog closes help without closing dialog
    await click(helpBtn)
    assert.ok(q('[data-contextual-help]'), 'help re-opened')
    await act(async () => {
      dialogEl.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))
    })
    assert.equal(q('[data-contextual-help]'), null, 'outside click dismissed help')
    assert.equal(closed, false, 'dialog remains open after outside click dismissal')

    // Native cancel closes dialog when help is closed
    dialogEl.dispatchEvent(new window.Event('cancel', { bubbles: true, cancelable: true }))
    assert.equal(closed, true, 'dialog closes on cancel when help is not active')
  } finally {
    await unmount(root)
  }
})

