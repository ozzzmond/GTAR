// #434 + #431: Settings menu (gear icon), decoupled Backup & Restore, Debug Logs, Advanced Tools, About GTAR.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.app/' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
window.matchMedia = () => ({ matches: false })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

// Real header; the environment is switchable, modals are stubs.
const env = { isDevEnv: false }
let center = null
const Module = require('node:module'), originalLoad = Module._load
Module._load = function (request, parent, ...args) {
  if (parent?.filename && /[\\/]components[\\/]Header\.tsx$/.test(parent.filename)) {
    if (request === '../utils/env') return env
    if (request.endsWith('.png')) return 'logo.png'
    if (request === '../utils/onlineSearch') return {}
    if (request === './CloudSyncModal') return { CloudSyncModal: props => { center = props; return null } }
    if (request.startsWith('./') && request.endsWith('Modal')) return new Proxy({}, { get: () => () => null })
  }
  return originalLoad.call(this, request, parent, ...args)
}
const { Header } = require('../src/components/Header.tsx')
Module._load = originalLoad
const { openBackupCenter } = require('../src/utils/backupCenter.ts')

const noop = () => {}
const songs = [{ id: 's1', title: 'A', rawContent: 'C' }]
const props = { activeView: 'songbook', song: songs[0], searchQuery: '', onViewChange: noop, onSearchQueryChange: noop, onOpenWebsiteUrlSource: noop,
  onOpenStageTools: noop, onToggleTheme: noop, onOpenStageSettings: noop, onOpenImportModal: noop, backupSongs: songs }
const buttonTexts = el => [...el.querySelectorAll('button')].map(b => b.textContent.trim())

async function mountHeader(options = {}) {
  env.isDevEnv = Boolean(options.dev)
  const container = document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  await act(async () => root.render(React.createElement(Header, props)))
  await act(async () => document.querySelector('[data-testid="header-settings"]').click())
  return { root, popover: document.querySelector('.avatar-popover') }
}

test('Settings menu layout: Theme, Backup & Restore, Debug Logs, Recovery Data, Advanced Tools, About; header cloud button retired', async () => {
  const { root, popover } = await mountHeader({ dev: false })
  try {
    // Header cloud button retired per #434
    assert.equal(document.querySelector('[data-testid="header-cloud-sync-button"]'), null, 'header cloud button removed')

    // Obsolete account/admin controls removed per #431
    assert.ok(!buttonTexts(popover).includes('Manage Users'), 'Manage Users removed')
    assert.ok(!buttonTexts(popover).includes('Sign In with Google'), 'Sign in button removed')
    assert.doesNotMatch(popover.textContent, /Sign in to use cloud backup|Whitelist/)

    // Settings layout order per #434 & QA follow-up
    assert.ok(document.querySelector('[data-testid="settings-theme-button"]'), 'Theme entry exists')
    assert.ok(document.querySelector('[data-testid="settings-backup-restore-button"]'), 'Backup & Restore entry exists')
    assert.ok(document.querySelector('[data-testid="settings-debug-logs"]'), 'Debug Logs entry exists')
    assert.equal(document.querySelector('[data-testid="settings-recovery-data"]'), null, 'Top-level Recovery Data row removed per CHANGE_3')
    assert.ok(document.querySelector('[data-testid="advanced-tools"]'), 'Advanced Tools exists')
    assert.ok(document.querySelector('[data-testid="settings-about-button"]'), 'About GTAR entry exists')

    // Clicking Backup & Restore opens center directly
    assert.equal(center.isOpen, false)
    await act(async () => document.querySelector('[data-testid="settings-backup-restore-button"]').click())
    assert.equal(center.isOpen, true)
    assert.equal(center.deviceSongs, songs, 'the file card uses the App library')
    await act(async () => center.onClose())

    // Programmatic backup center event still opens center
    await act(async () => openBackupCenter())
    assert.equal(center.isOpen, true)
  } finally { await act(async () => root.unmount()) }
})

test('Advanced Tools holds Web Sources and ProPresenter stub', async () => {
  const { root, popover } = await mountHeader({ dev: false })
  try {
    const toggle = document.querySelector('[data-testid="advanced-tools-button"]')
    assert.match(toggle.textContent, /Advanced Tools/)
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    await act(async () => toggle.click())
    assert.equal(toggle.getAttribute('aria-expanded'), 'true')

    const tools = document.querySelector('[data-testid="advanced-tools"]')
    assert.ok(tools.querySelector('[data-testid="profile-web-sources"]'), 'Web Sources preserved in Advanced Tools')
    assert.ok(tools.querySelector('[data-testid="settings-propresenter-stub"]'), 'ProPresenter modular integration present')
  } finally { await act(async () => root.unmount()) }
})

test('Recovery data is consolidated inside Debug Logs, top-level row removed (#434)', async () => {
  const { root, popover } = await mountHeader({ dev: false })
  try {
    assert.equal(document.querySelector('[data-testid="settings-recovery-data"]'), null, 'Separate top-level Recovery data row removed')
    const debugLogsButton = document.querySelector('[data-testid="settings-debug-logs"]')
    assert.ok(debugLogsButton, 'Debug Logs button exists in Settings')
    await act(async () => debugLogsButton.click())
    assert.equal(document.querySelector('.avatar-popover'), null, 'menu closes after clicking Debug Logs')
  } finally { await act(async () => root.unmount()) }
})

test('Recovery data dot alerts on Debug Logs button when unreadable copies exist', async () => {
  localStorage.setItem('gtar_library_v1', JSON.stringify({ songs: [{ id: 's1', title: 'A', rawContent: 'C' }], setlists: [] }))
  localStorage.setItem('gtar_sync_recovery:download:1', JSON.stringify({ songs: [{ id: 'old', title: 'Old', rawContent: 'D' }], setlists: [] }))
  const dot = () => document.querySelector('[data-testid="settings-debug-logs-dot"]')
  try {
    let { root } = await mountHeader({ dev: false })
    assert.equal(dot(), null, 'readable copies: no dot on Debug Logs')
    await act(async () => root.unmount())
    localStorage.setItem('gtar_sync_recovery:download:2', '{broken')
    ;({ root } = await mountHeader({ dev: false }))
    assert.ok(dot(), 'unreadable copy: dot alerts on Debug Logs')
    assert.equal(document.querySelector('[data-testid="settings-debug-logs"]').getAttribute('aria-label'), "Debug Logs and Recovery Data, some recovery copies can't be opened")
    await act(async () => root.unmount())
  } finally { localStorage.clear() }
})

test('#304/#359: Import Songs removed from header overflow (#359) and reachable in Songbook', () => {
  const header = fs.readFileSync(require.resolve('../src/components/Header.tsx'), 'utf8')
  assert.ok(!header.includes('Import Songs'))
  assert.ok(!header.includes('Import Songs &amp; Setlists'))
})

test('#304: App no longer renders the JSON Bridge or the JSON backup dialog', () => {
  const app = fs.readFileSync(require.resolve('../src/App.tsx'), 'utf8')
  assert.doesNotMatch(app, /JsonBridgeModal|onOpenAdvancedBridge|isJsonModalOpen/)
  assert.ok(!fs.existsSync(require.resolve('../src/components/Header.tsx').replace('Header.tsx', 'JsonBridgeModal.tsx')))
  assert.doesNotMatch(app, /BackupRestoreDialogModal|isBackupRestoreModalOpen/)
  assert.ok(!fs.existsSync(require.resolve('../src/components/Header.tsx').replace('Header.tsx', 'BackupRestoreDialogModal.tsx')))
})
