// PR528 / GH#517: Online Song Sources and ProPresenter open as application-level dialogs that are
// independent of the Advanced Tools popover (not clipped by it, and alive after it closes).
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
window.matchMedia = () => ({ matches: false })
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
const settings = require('../src/utils/onlineSourceSettings.ts')
const { ExtensionHost } = require('../src/extensions/host/ExtensionHost.ts')
const { ExtensionHostContext } = require('../src/extensions/host/ExtensionHostContext.ts')
const { registry } = require('../src/extensions/registry.ts')

const noop = () => {}
const song = { id: 's1', title: 'A', rawContent: 'C' }
const props = { activeView: 'songbook', song, searchQuery: '', onViewChange: noop, onSearchQueryChange: noop, onOpenWebsiteUrlSource: noop,
  onOpenStageTools: noop, onToggleTheme: noop, onOpenStageSettings: noop, onOpenImportModal: noop, backupSongs: [song] }
const q = selector => document.querySelector(selector)
const click = el => act(async () => { el.click() })
const key = (name, init = {}) => act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })) })
const wrench = () => q('[data-testid="header-advanced-tools"]')
const popover = () => q('[data-testid="advanced-tools-popover"]')

async function mountHeader(extra = {}) {
  localStorage.clear()
  const container = document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  const { host, ...rest } = extra
  const header = React.createElement(Header, { ...props, ...rest })
  await act(async () => root.render(host ? React.createElement(ExtensionHostContext.Provider, { value: host }, header) : header))
  return root
}
async function openFromLauncher(launcher) {
  if (!popover()) await click(wrench())
  await click(q(`[data-testid="${launcher}"]`))
}
/** The dialog is a direct overlay under <body>: no launcher, popover or scroll container above it. */
function assertAppLevel(panel) {
  const backdrop = panel.parentElement
  assert.ok(backdrop.parentElement === document.body, 'dialog overlay is portaled to document.body')
  assert.equal(document.getElementById('root').contains(panel), false, 'dialog is outside the app header tree')
  assert.equal(panel.closest('.avatar-popover, [role="menu"], .overflow-y-auto, .overflow-hidden'), null, 'no clipping or transformed ancestor')
  for (const cls of ['fixed', 'inset-0', 'z-[100]', 'flex', 'items-center', 'justify-center', 'bg-black/75']) assert.ok(backdrop.classList.contains(cls), `backdrop ${cls}`)
  assert.equal(panel.getAttribute('role'), 'dialog')
  assert.equal(panel.getAttribute('aria-modal'), 'true')
}
function assertLayout(panel, title) {
  assert.equal(document.getElementById(panel.getAttribute('aria-labelledby')).textContent, title, 'dialog is named by its full title')
  const [header, body, footer] = ['header', 'body', 'footer'].map(part => panel.querySelector(`[data-app-modal="${part}"]`))
  assert.ok(header.querySelector('svg') && header.querySelector('h2') && header.querySelector('button[aria-label="Close"]'), 'header has icon, title and close')
  assert.ok(header.classList.contains('shrink-0') && footer.classList.contains('shrink-0'), 'header and footer never scroll away')
  assert.ok(body.classList.contains('overflow-y-auto') && body.classList.contains('overscroll-contain') && body.classList.contains('min-h-0'), 'body is the one scroll region')
  assert.equal(panel.querySelectorAll('.overflow-y-auto').length, 1, 'single scrollable content region')
  // Tablet and desktop: full width up to max-w-lg, never taller than the viewport, 12px+ gutter.
  for (const cls of ['w-full', 'max-w-lg', 'max-h-[90dvh]', 'flex', 'flex-col']) assert.ok(panel.classList.contains(cls), `card ${cls}`)
  assert.ok([...footer.querySelectorAll('button')].some(button => button.textContent.trim() === 'Close'), 'footer Close')
}

test('Online Song Sources: launcher closes the dropdown and opens an independent, unclipped app-level dialog', async () => {
  const root = await mountHeader()
  try {
    await click(wrench())
    const toggled = q('[data-testid="settings-online-sources"]')
    const before = toggled.getAttribute('aria-checked')
    await click(toggled)
    assert.notEqual(q('[data-testid="settings-online-sources"]').getAttribute('aria-checked'), before, 'toggle changes enabled state')
    assert.equal(q('[data-testid="online-sources-panel"]'), null, 'toggle does not open the dialog')
    assert.ok(popover(), 'toggle leaves the dropdown open')
    assert.equal(popover().querySelector('[role="dialog"], form, [data-testid="manage-sources-list"]'), null, 'no nested configuration form in the launcher')
    assert.match(q('[data-testid="online-sources-expand"]').textContent, /^Online Song Sources\d+ active$/)

    await openFromLauncher('online-sources-expand')
    assert.equal(popover(), null, 'dropdown dismissed')
    assert.equal(wrench().getAttribute('aria-expanded'), 'false')
    const panel = q('[data-testid="online-sources-panel"]')
    assert.ok(panel, 'dialog stays mounted after the dropdown unmounts')
    assertAppLevel(panel)
    assertLayout(panel, 'Online Song Sources')
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Close', 'focus moves into the dialog')

    // Interactive after the dropdown is gone: mode, provider enable, add, restore defaults.
    const radios = [...panel.querySelectorAll('[role="radio"]')]
    assert.deepEqual(radios.map(radio => radio.textContent), ['All Sources', 'Primary Only'])
    await click(radios[1])
    assert.equal(JSON.parse(localStorage.getItem(settings.ONLINE_SOURCE_SETTINGS_KEY)).mode, 'primary')
    await click(panel.querySelector('input[aria-label="Enable Ultimate Guitar"]'))
    assert.equal(JSON.parse(localStorage.getItem(settings.ONLINE_SOURCE_SETTINGS_KEY)).sources[0].enabled, false)
    await click([...panel.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Add WorshipChords'))
    assert.ok(panel.querySelector('[data-testid="manage-source-worshipchords"]'))
    const footer = panel.querySelector('[data-app-modal="footer"]')
    await click([...footer.querySelectorAll('button')].find(button => button.textContent.trim() === 'Restore Defaults'))
    await click([...footer.querySelectorAll('button')].find(button => button.textContent.trim() === 'Restore defaults'))
    assert.deepEqual(JSON.parse(localStorage.getItem(settings.ONLINE_SOURCE_SETTINGS_KEY)), settings.restoreDefaultSettings())
    assert.ok(q('[data-testid="online-sources-panel"]'), 'still open after edits')
  } finally { await act(async () => root.unmount()) }
})

test('ProPresenter: launcher closes the dropdown, dialog keeps Host, Port, Remember Last Server and Save Settings', async () => {
  const host = new ExtensionHost(registry, localStorage, { capabilities: ['net:lan', 'ui:panel'] })
  await host.start()
  const root = await mountHeader({ host })
  try {
    await click(wrench())
    const row = q('[data-testid="extension-propresenter-follower"]')
    assert.match(q('[data-testid="extension-propresenter-follower-expand"]').textContent, /^ProPresenterOff$/, 'full name, no technical subtitle')
    const toggle = row.querySelector('[data-testid="settings-propresenter-follower-toggle"]')
    assert.equal(toggle.getAttribute('role'), 'switch')
    await click(toggle)
    assert.equal(toggle.checked, true, 'master toggle changes enabled state')
    assert.equal(q('[data-testid="extension-propresenter-follower-panel"]'), null, 'toggle does not open the dialog')
    await click(toggle)
    assert.equal(popover().querySelector('[role="dialog"], form'), null, 'no nested configuration form in the launcher')

    await openFromLauncher('extension-propresenter-follower-expand')
    assert.equal(popover(), null, 'dropdown dismissed')
    const panel = q('[data-testid="extension-propresenter-follower-panel"]')
    assert.ok(panel)
    assertAppLevel(panel)
    assertLayout(panel, 'ProPresenter')
    assert.ok(panel.querySelector('[data-testid="propresenter-help-button"]'), 'contextual help kept')

    const hostInput = panel.querySelector('input[name="host"]')
    assert.equal(hostInput.closest('label').textContent, 'Host')
    assert.equal(panel.querySelector('input[name="port"]').closest('label').textContent, 'Port')
    const remember = panel.querySelector('[data-testid="propresenter-remember-server"]')
    assert.equal(remember.closest('label').textContent, 'Remember Last Server')
    assert.equal(remember.checked, false)
    await click(remember)
    assert.equal(q('[data-testid="propresenter-remember-server"]').checked, true)
    await click(remember)

    const save = panel.querySelector('[data-testid="propresenter-save-settings"]')
    assert.equal(save.textContent.trim(), 'Save Settings')
    assert.equal(save.type, 'submit')
    assert.ok(panel.querySelector('[data-app-modal="footer"]').contains(save), 'Save Settings is a pinned footer action')
    const form = document.getElementById(save.getAttribute('form'))
    assert.ok(form && form.contains(hostInput), 'footer Save submits the settings form')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(hostInput, '192.168.1.77'); hostInput.dispatchEvent(new window.Event('input', { bubbles: true })) })
    await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })) })
    assert.equal(panel.querySelector('[role="alert"]')?.textContent, undefined)
    assert.equal(host.getSnapshot('propresenter-follower').settings.host, '192.168.1.77', 'settings saved from the dialog')
    assert.equal(q('input[name="host"]').value, '192.168.1.77', 'form state kept')
  } finally { await act(async () => root.unmount()); host.dispose() }
})

for (const [name, launcher, panelId] of [
  ['Online Song Sources', 'online-sources-expand', 'online-sources-panel'],
  ['ProPresenter', 'extension-propresenter-follower-expand', 'extension-propresenter-follower-panel'],
]) {
  test(`${name}: Escape, Close, footer Close and backdrop dismiss; focus returns to Advanced Tools; Tab stays inside`, async () => {
    const overlay = []
    const root = await mountHeader({ onOverlayChange: open => overlay.push(open) })
    const panel = () => q(`[data-testid="${panelId}"]`)
    try {
      await openFromLauncher(launcher)
      assert.equal(overlay.at(-1), true, 'background shortcuts are blocked while open')

      // Keyboard focus is trapped in the dialog.
      const focusable = [...panel().querySelectorAll('a[href], button:not([disabled]), input:not([disabled])')]
      focusable.at(-1).focus()
      await key('Tab')
      assert.ok(document.activeElement === focusable[0], 'Tab wraps to the first control')
      await key('Tab', { shiftKey: true })
      assert.ok(document.activeElement === focusable.at(-1), 'Shift+Tab wraps to the last control')
      wrench().focus()
      await key('Tab')
      assert.ok(panel().contains(document.activeElement), 'focus is pulled back into the dialog')

      // Escape closes the help panel first, then the dialog.
      const help = panel().querySelector('[data-app-modal="header"] button[aria-expanded]')
      await click(help)
      const helpPanel = q('[data-contextual-help]')
      assert.ok(helpPanel.parentElement === document.body, 'help is portaled, so the dialog cannot clip it')
      assert.equal(helpPanel.style.position || 'fixed', 'fixed')
      helpPanel.querySelector('summary').focus()
      await key('Tab')
      assert.ok(helpPanel.contains(document.activeElement), 'focus may stay in the open help panel')
      await key('Escape')
      assert.equal(q('[data-contextual-help]'), null, 'Escape closes help first')
      assert.ok(panel(), 'dialog survives the help Escape')
      await key('Escape')
      assert.equal(panel(), null, 'Escape closes the dialog')
      assert.ok(document.activeElement === wrench(), 'focus returns to the Advanced Tools button')
      assert.equal(popover(), null, 'dropdown stays closed')
      assert.equal(overlay.at(-1), false)

      await openFromLauncher(launcher)
      await click(panel().querySelector('[data-app-modal="header"] button[aria-label="Close"]'))
      assert.equal(panel(), null, 'header close button')

      await openFromLauncher(launcher)
      await click(q(`[data-testid="${panelId}-close"]`))
      assert.equal(panel(), null, 'footer Close button')

      await openFromLauncher(launcher)
      await click(panel().querySelector('[data-app-modal="body"]'))
      assert.ok(panel(), 'clicks inside the dialog do not dismiss it')
      await act(async () => { document.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
      assert.ok(panel(), 'the dropdown outside-click handler does not dismiss it')
      await click(panel().parentElement)
      assert.equal(panel(), null, 'backdrop click dismisses, as in Backup & Restore')
      assert.equal(document.body.querySelector('[role="dialog"]'), null, 'nothing left mounted')
    } finally { await act(async () => root.unmount()) }
  })
}

test('dialogs are mounted by Header at app level and share the Backup & Restore shell', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')
  const header = read('components/Header.tsx')
  const popoverSource = header.slice(header.indexOf('const advancedToolsPopover = ('), header.indexOf('useEffect(() => {', header.indexOf('const advancedToolsPopover = (')))
  assert.doesNotMatch(popoverSource, /<OnlineSourcesDialog|<ExtensionSettingsDialog/)
  assert.match(header, /openAdvancedToolsDialog = \(dialog: string\) => \{ setShowAdvancedToolsMenu\(false\); setAdvancedToolsDialog\(dialog\) \}/)
  assert.match(header, /<OnlineSourcesDialog onClose=\{closeAdvancedToolsDialog\} returnFocusRef=\{advancedToolsButtonRef\} \/>/)
  assert.match(header, /<ExtensionSettingsDialog host=\{extensionHost\} id=\{advancedToolsDialog\}/)
  const shell = read('components/AppModal.tsx'), backup = read('components/CloudSyncModal.tsx')
  assert.match(shell, /createPortal\([\s\S]*document\.body,\s*\)/)
  for (const cls of [
    'fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in',
    'w-8 h-8 rounded-xl bg-app-action/20 border border-app-action/40 flex items-center justify-center text-app-action',
    'font-extrabold text-sm sm:text-base tracking-wide',
    'min-h-11 px-4 py-2 rounded-xl bg-app-base hover:bg-app-surface border border-app-border text-app-heading text-xs font-bold',
  ]) { assert.ok(backup.includes(cls), `Backup & Restore uses: ${cls}`); assert.ok(shell.replaceAll(' shrink-0', '').replaceAll(' gap-3', '').includes(cls) || shell.includes(cls), `shell matches: ${cls}`) }
  for (const file of ['components/OnlineSourcesRow.tsx', 'extensions/host/ExtensionRows.tsx']) {
    const source = read(file)
    assert.match(source, /<AppModal\b/)
    assert.doesNotMatch(source, /fixed inset-0|pl-3 border-l-2/, `${file}: no inline overlay or nested indentation rule`)
  }
})

// Round 5: one ProPresenter help for settings and Stage View, and a lean Stage View popover.
test('ProPresenter help is one shared component for settings and the Stage View popover', async () => {
  const read = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')
  for (const file of ['components/LiveLyrics.tsx', 'extensions/host/ExtensionRows.tsx']) {
    const source = read(file)
    assert.match(source, /<ProPresenterHelp\b/, `${file} uses the shared help`)
    assert.doesNotMatch(source, /ContextualHelp|topics=|Manual Override|propresenter-help-guide/, `${file} has no second help implementation or copy`)
  }
  const { LiveLyricsControl } = require('../src/components/LiveLyrics.tsx')
  const { SetlistAutoFollowControl } = require('../src/components/SetlistAutoFollowControl.tsx')
  const container = document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  let closed = 0
  const live = { status: 'Live lyrics on - automatic DEV checks', automaticMode: true, confirmed: true, canConfirm: false, confirm: () => true, stop: noop,
    snapshot: { presentation: { uuid: 'p', title: 'Great Are You Lord' }, current: { uuid: 's', text: 'It is Your breath' } } }
  const follow = { available: true, controller: { enable: noop, assisted: noop, resume: noop, choose: noop },
    state: { mode: 'auto', paused: true, choices: [], target: null, status: 'Manual selection - Resume Auto Follow' } }
  await act(async () => root.render(React.createElement(LiveLyricsControl, { live, songTitle: 'Great Are You Lord', isOpen: true, onClose: () => { closed++ } },
    React.createElement(SetlistAutoFollowControl, { follow }))))
  try {
    const popover = q('[aria-label="ProPresenter controls"]')
    // Lean main panel: current song, short status, contextual actions; no technical or DEV prose.
    assert.match(popover.textContent, /Great Are You Lord/)
    assert.deepEqual([...popover.querySelectorAll('[role="status"]')].map(el => el.textContent), ['Manual selection', 'Live lyrics on'])
    assert.doesNotMatch(popover.textContent, /DEV|current setlist only|enable highlights|to presentation|identity/)
    assert.deepEqual([...popover.querySelectorAll('button')].map(button => button.textContent.trim()).filter(Boolean), ['Use Assisted mode', 'Resume Auto Follow'])

    // Same interactive help as settings, opened above the fullscreen popover without clipping.
    const helpButton = popover.querySelector('[data-testid="propresenter-help-button"]')
    assert.equal(helpButton.tagName, 'BUTTON')
    assert.equal(helpButton.getAttribute('aria-expanded'), 'false')
    await click(helpButton)
    const help = q('[data-testid="propresenter-help"]')
    assert.ok(help.parentElement === document.body && !popover.contains(help), 'help is not inside the scrolling popover')
    assert.ok(help.classList.contains('fixed') && help.classList.contains('z-[120]'))
    assert.deepEqual([...help.querySelectorAll('summary')].map(el => el.textContent), ['Status Indicators', 'Auto Follow', 'Manual Override', 'Resume', 'Stop', 'Setup & Connection'])
    assert.equal(help.querySelectorAll('details[open]').length, 1, 'accordion: only the first topic starts expanded')
    await act(async () => { help.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true })) })
    assert.ok(q('[data-testid="propresenter-help"]') && closed === 0, 'using the help does not dismiss the popover')
    // Escape pressed with focus on the help button, as a keyboard user would.
    await act(async () => { helpButton.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    assert.equal(q('[data-testid="propresenter-help"]'), null, 'Escape closes help first')
    assert.equal(closed, 0, 'popover survives the help Escape')
    await click(helpButton)
    await act(async () => { popover.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true })) })
    assert.equal(q('[data-testid="propresenter-help"]'), null, 'outside click closes help')
    assert.equal(closed, 0)
    await key('Escape')
    assert.equal(closed, 1, 'Escape then closes the popover')
  } finally { await act(async () => root.unmount()) }
})

test('status lines are shortened for display only', () => {
  const { conciseProPresenterStatus } = require('../src/utils/proPresenterStorage.ts')
  assert.equal(conciseProPresenterStatus('Live lyrics on · assisted session'), 'Live lyrics on')
  assert.equal(conciseProPresenterStatus('Auto Follow paused - fresh identity and Resume required'), 'Auto Follow paused')
  assert.equal(conciseProPresenterStatus('Not in current setlist'), 'Not in current setlist')
  assert.equal(conciseProPresenterStatus('Slide not matched'), 'Slide not matched')
  const follow = fs.readFileSync(path.join(__dirname, '../src/utils/setlistAutoFollow.ts'), 'utf8')
  assert.match(follow, /Assisted - manual song selection/, 'state machine wording is untouched')
})
