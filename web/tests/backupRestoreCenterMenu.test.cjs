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
  await act(async () => document.querySelector('.avatar-wrapper').click())
  return { root, popover: document.querySelector('.avatar-popover') }
}

test('profile menu: "Manage Users", no Backup & Restore entry; header cloud button opens the center', async () => {
  const { root, popover } = await mountHeader({ dev: false, auth: signedIn })
  try {
    assert.ok(buttonTexts(popover).includes('Manage Users'))
    assert.doesNotMatch(popover.textContent, /Whitelist|Backup & Restore/)
    const cloud = document.querySelector('[data-testid="header-cloud-sync-button"]')
    assert.equal(cloud.getAttribute('aria-label'), 'Backup & Restore')
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
    assert.match(popover.textContent, /Sign in to use cloud backup and the Shared Catalog\./)
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
  test(`DEV (${auth.session ? 'signed in' : 'signed out'}): Advanced Tools opens Local Recovery Review and debug logs (no JSON Bridge)`, async () => {
    const { root, popover } = await mountHeader({ dev: true, auth })
    try {
      const toggle = document.querySelector('[data-testid="advanced-tools-button"]')
      assert.match(toggle.textContent, /Advanced Tools/)
      assert.equal(toggle.getAttribute('aria-expanded'), 'false')
      await act(async () => toggle.click())
      const tools = document.querySelector('[data-testid="advanced-tools"]')
      assert.deepEqual(buttonTexts(tools), ['Advanced ToolsDEV', 'Local Recovery Review', 'Debug logs options'])
      assert.equal(tools.querySelector('[role="switch"]'), null)
      let reviews = 0
      const onReview = () => { reviews++ }
      window.addEventListener('gtar-review-recovery', onReview)
      await act(async () => document.querySelector('[data-testid="advanced-recovery-review"]').click())
      window.removeEventListener('gtar-review-recovery', onReview)
      assert.equal(reviews, 1, 'opens the existing Local Recovery Review')
      assert.ok(popover.isConnected === false || !document.querySelector('.avatar-popover'), 'menu closes')
      assert.equal(document.querySelector('[data-testid="advanced-json-bridge"]'), null, '#304: JSON Bridge removed')
    } finally { await act(async () => root.unmount()) }
  })
}

test('#304: App no longer renders the JSON Bridge or the JSON backup dialog', () => {
  const app = fs.readFileSync(require.resolve('../src/App.tsx'), 'utf8')
  assert.doesNotMatch(app, /JsonBridgeModal|onOpenAdvancedBridge|isJsonModalOpen/)
  assert.ok(!fs.existsSync(require.resolve('../src/components/Header.tsx').replace('Header.tsx', 'JsonBridgeModal.tsx')))
  assert.doesNotMatch(app, /BackupRestoreDialogModal|isBackupRestoreModalOpen/)
  assert.ok(!fs.existsSync(require.resolve('../src/components/Header.tsx').replace('Header.tsx', 'BackupRestoreDialogModal.tsx')))
})
