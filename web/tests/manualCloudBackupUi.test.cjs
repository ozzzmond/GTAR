// #431 + #434: decoupled Backup & Restore modal — auth-independent, portable JSON backup/restore.
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:true})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.gtar-web.pages.dev' })
const globalKeys = ['window', 'document', 'localStorage', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT', 'navigator', 'fetch']
const originalGlobals = new Map(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]))
after(() => {
  dom.window.close()
  for (const [key, descriptor] of originalGlobals) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key] }
})
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { CloudSyncModal } = require('../src/components/CloudSyncModal.tsx')
const { persistLibrary, readPersistedLibrary } = require('../src/utils/syncJournal.ts')
const { expectedRestoredLibrary } = require('../src/utils/backupExport.ts')
const { getRestoreSafetySnapshot } = require('../src/utils/jsonBackup.ts')

const song = (id) => ({ id, title: id, rawContent: '[C]Hello', artist: 'A' })
const local = { songs: [song('11111111-1111-4111-8111-111111111111')], setlists: [] }

async function setup({ device = local, restoreBlocked = false } = {}) {
  const container = document.getElementById('root')
  container.innerHTML = ''
  localStorage.clear()
  persistLibrary(device, localStorage)
  const folderArgs = []
  const apply = mode => async (songs, setlists, folders) => {
    folderArgs.push(folders)
    assert.ok(getRestoreSafetySnapshot(localStorage), 'snapshot before apply')
    persistLibrary(expectedRestoredLibrary(readPersistedLibrary(), { songs, setlists, folders }, mode), localStorage)
  }
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(CloudSyncModal, {
      isOpen: true,
      onClose() {},
      restoreBlocked,
      onFullRestore: apply('replace'),
      onSmartMerge: apply('merge'),
    }))
    await new Promise(r => setTimeout(r, 10))
  })
  return { folderArgs, root }
}

test('Backup & Restore modal renders device backup card and no retired cloud controls', async () => {
  const { root } = await setup()
  try {
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog, 'dialog rendered')
    assert.equal(dialog.getAttribute('aria-label'), 'Backup & Restore')

    // Device backup card is present
    const deviceCard = document.querySelector('[data-testid="device-backup-card"]')
    assert.ok(deviceCard, 'device backup card present')
    assert.ok(document.querySelector('[data-testid="save-backup-file-button"]'), 'Save backup button present')
    assert.ok(document.querySelector('[data-testid="restore-file-button"]'), 'Restore button present')

    // Cloud controls are retired (#431, #434)
    assert.equal(document.querySelector('[data-testid="cloud-backup-card"]'), null, 'no cloud backup card')
    assert.equal(document.querySelector('[data-testid="cloud-backup-button"]'), null, 'no cloud backup button')
    assert.equal(document.querySelector('[data-testid="cloud-restore-button"]'), null, 'no cloud restore button')
    assert.equal(document.querySelector('[data-testid="cloud-sync-account-card"]'), null, 'no cloud account card')
    assert.doesNotMatch(dialog.textContent, /Sign in to use cloud backup|Auth Required|Cloud \(Google\)/)
  } finally {
    await act(async () => root.unmount())
  }
})

test('restore blocked flag disables restore actions safely', async () => {
  const { root } = await setup({ restoreBlocked: true })
  try {
    const restoreBtn = document.querySelector('[data-testid="restore-file-button"]')
    assert.ok(restoreBtn, 'Restore button present')
    assert.equal(restoreBtn.disabled, true, 'Restore button disabled when blocked')
  } finally {
    await act(async () => root.unmount())
  }
})

test('escape key dismisses modal and calls onClose', async () => {
  let closed = false
  const container = document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(CloudSyncModal, {
      isOpen: true,
      onClose: () => { closed = true },
    }))
  })
  try {
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    assert.equal(closed, true, 'onClose called on Escape')
  } finally {
    await act(async () => root.unmount())
  }
})

test('backdrop click dismisses modal and calls onClose', async () => {
  let closed = false
  const container = document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(CloudSyncModal, {
      isOpen: true,
      onClose: () => { closed = true },
    }))
  })
  try {
    const backdrop = document.querySelector('[data-testid="cloud-sync-modal-backdrop"]')
    assert.ok(backdrop, 'backdrop present')
    await act(async () => {
      backdrop.click()
    })
    assert.equal(closed, true, 'onClose called on backdrop click')
  } finally {
    await act(async () => root.unmount())
  }
})
