// #299: one Backup & Restore entry point (header cloud button), profile menu labels, DEV-only Advanced Tools.
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

// Real header; the environment and the signed-in account are switchable, modals are stubs.
const env = { isDevEnv: false }
let auth = { session: null, isSuperAdmin: false }
let center = null
const Module = require('node:module'), originalLoad = Module._load
Module._load = function (request, parent, ...args) {
  if (parent?.filename && /[\\/]components[\\/]Header\.tsx$/.test(parent.filename)) {
    if (request === '../utils/env') return env
    if (request === './AuthGate') return { useGoogleAuth: () => ({ signIn: async () => {}, signOut: () => {}, ...auth }) }
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
const signedIn = { session: { token: 't', user: { id: 'u1', email: 'admin@example.com', name: 'Admin' } }, isSuperAdmin: true }
const buttonTexts = el => [...el.querySelectorAll('button')].map(b => b.textContent.trim())

async function mountHeader(options) {
  env.isDevEnv = options.dev; auth = options.auth
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(Header, props)))
  await act(async () => document.querySelector('[data-testid="header-avatar"]').click())
  return { root, popover: document.querySelector('.avatar-popover') }
}

test('profile menu: "Manage Users", no Backup & Restore entry; header cloud button opens the center', async () => {
  const { root, popover } = await mountHeader({ dev: false, auth: { ...signedIn, accessStatus: 'active' } })
  try {
    assert.ok(buttonTexts(popover).includes('Manage Users'))
    assert.doesNotMatch(popover.textContent, /Whitelist|Backup & Restore/)
    const cloud = document.querySelector('[data-testid="header-cloud-sync-button"]')
    assert.equal(cloud.dataset.status, 'unknown', 'active account has no verified cloud metadata yet')
    assert.equal(cloud.getAttribute('aria-label'), 'Backup & Restore \u2014 Backup status unknown. Open to verify cloud backup')
    assert.equal(cloud.getAttribute('title'), null, 'native title tooltip removed in favor of GTAR popover')
    assert.equal(cloud.textContent, '', 'status remains accessible in the icon-only layout')
    assert.equal(center.isOpen, false)
    await act(async () => cloud.click())
    assert.equal(center.isOpen, true)
    assert.equal(center.deviceSongs, songs, 'the file card uses the App library')
    await act(async () => center.onClose())
    // Other surfaces (e.g. Stage Settings) open the same center.
    await act(async () => openBackupCenter())
    assert.equal(center.isOpen, true)
  } finally { await act(async () => root.unmount()) }
})

test('signed out: profile menu explains what sign-in is for', async () => {
  const { root, popover } = await mountHeader({ dev: false, auth: { session: null, isSuperAdmin: false } })
  try {
    assert.match(popover.textContent, /Sign in to use cloud backup\./)
    assert.doesNotMatch(popover.textContent, /approved Google account/)
  } finally { await act(async () => root.unmount()) }
})

for (const auth of [signedIn, { session: null, isSuperAdmin: false }]) {
  test(`PROD (${auth.session ? 'signed in' : 'signed out'}): no developer tool in the profile menu`, async () => {
    const { root, popover } = await mountHeader({ dev: false, auth })
    try {
      assert.equal(document.querySelector('[data-testid="advanced-tools"]'), null)
      assert.doesNotMatch(popover.textContent, /Advanced Tools|Local Recovery Review|JSON Bridge|Debug logs|Record debug logs/)
    } finally { await act(async () => root.unmount()) }
  })
  test(`DEV (${auth.session ? 'signed in' : 'signed out'}): Advanced Tools holds debug logs only (no JSON Bridge)`, async () => {
    const { root, popover } = await mountHeader({ dev: true, auth })
    try {
      const toggle = document.querySelector('[data-testid="advanced-tools-button"]')
      assert.match(toggle.textContent, /Advanced Tools/)
      assert.equal(toggle.getAttribute('aria-expanded'), 'false')
      await act(async () => toggle.click())
      const tools = document.querySelector('[data-testid="advanced-tools"]')
      assert.deepEqual(buttonTexts(tools), ['Advanced ToolsDEV', 'Debug logs options'])
      assert.equal(tools.querySelector('[role="switch"]'), null)
      assert.doesNotMatch(popover.textContent, /Local Recovery Review/)
      assert.equal(document.querySelector('[data-testid="advanced-json-bridge"]'), null, '#304: JSON Bridge removed')
    } finally { await act(async () => root.unmount()) }
  })
}

// #304 item 8: "Recovery data" row — DEV for everyone, PROD for admins (role === 'admin') only.
const member = { session: { token: 't', user: { id: 'u2', email: 'member@example.com', name: 'Member' } }, isSuperAdmin: false }
for (const [label, options, visible] of [
  ['DEV signed out', { dev: true, auth: { session: null, isSuperAdmin: false } }, true],
  ['DEV member', { dev: true, auth: member }, true],
  ['PROD admin', { dev: false, auth: signedIn }, true],
  ['PROD member', { dev: false, auth: member }, false],
  ['PROD signed out', { dev: false, auth: { session: null, isSuperAdmin: false } }, false],
]) {
  test(`#304: ${label} ${visible ? 'sees' : 'does not see'} the Recovery data row`, async () => {
    const { root, popover } = await mountHeader(options)
    try {
      const row = document.querySelector('[data-testid="profile-recovery-data"]')
      if (!visible) { assert.equal(row, null); assert.doesNotMatch(popover.textContent, /Recovery data/); return }
      assert.equal(row.textContent, 'Recovery data')
      assert.match(row.className, /min-h-11/)
      let opened = 0
      const onOpen = () => { opened++ }
      window.addEventListener('gtar-open-recovery-data', onOpen)
      await act(async () => row.click())
      window.removeEventListener('gtar-open-recovery-data', onOpen)
      assert.equal(opened, 1, 'opens the Recovery data panel')
      assert.equal(document.querySelector('.avatar-popover'), null, 'menu closes')
    } finally { await act(async () => root.unmount()) }
  })
}

test('#304: the Recovery data dot shows only while some copies cannot be opened', async () => {
  localStorage.setItem('gtar_library_v1', JSON.stringify({ songs: [{ id: 's1', title: 'A', rawContent: 'C' }], setlists: [] }))
  localStorage.setItem('gtar_sync_recovery:download:1', JSON.stringify({ songs: [{ id: 'old', title: 'Old', rawContent: 'D' }], setlists: [] }))
  const dot = () => document.querySelector('[data-testid="profile-recovery-data-dot"]')
  try {
    let { root } = await mountHeader({ dev: false, auth: signedIn })
    assert.equal(dot(), null, 'readable copies: no dot')
    await act(async () => root.unmount())
    localStorage.setItem('gtar_sync_recovery:download:2', '{broken')
    ;({ root } = await mountHeader({ dev: false, auth: signedIn }))
    assert.ok(dot(), 'unreadable copy: dot')
    assert.equal(document.querySelector('[data-testid="profile-recovery-data"]').getAttribute('aria-label'), "Recovery data, some copies can't be opened")
    await act(async () => root.unmount())
    ;({ root } = await mountHeader({ dev: false, auth: member }))
    assert.equal(dot(), null, 'members never see it')
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
