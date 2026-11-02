// #299: the Backup & Restore center keeps the restored #296 layout: header bar, cards, primary/secondary buttons, footer.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:true})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.gtar-web.pages.dev' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const auth = require('../src/utils/authContext.ts')
const { CloudSyncModal } = require('../src/components/CloudSyncModal.tsx')
const { computeSongbookChecksum } = require('../src/utils/cloudBackupFormat.ts')
const { persistLibrary } = require('../src/utils/syncJournal.ts')
const library = { songs: [{ id: '11111111-1111-4111-8111-111111111111', title: 'A', rawContent: '[C]Hi', artist: 'A' }], setlists: [] }
const q = id => document.querySelector(`[data-testid="${id}"]`)

async function mount(signedIn, before = () => {}) {
  localStorage.clear(); persistLibrary(library, localStorage); before()
  const record = { version: 1, checksum: computeSongbookChecksum(library), updatedAt: '2026-11-01T09:37:35Z', data: library }
  const calls = []
  global.fetch = async (_, opts) => { calls.push(opts.method); return new Response(JSON.stringify({ success: true, cloudRecord: record })) }
  auth.useOptionalGoogleAuth = () => ({ session: signedIn ? { token: 't', user: { id: 'B', email: 'b@example.com', name: 'Bee' } } : null, accessStatus: 'active', signIn: async () => {} })
  const root = createRoot(document.getElementById('root'))
  await act(async () => { root.render(React.createElement(CloudSyncModal, { isOpen: true, onClose() {} })); await new Promise(r => setTimeout(r, 5)) })
  return { root, calls, record }
}

const buttons = el => [...el.querySelectorAll('button')].map(b => b.textContent)

test('signed in: header bar, device card, Cloud (Google) card with account and last backup, footer', async () => {
  const { root, record } = await mount(true)
  try {
    const header = q('cloud-sync-modal-header')
    assert.ok(header); assert.match(header.textContent, /^Backup & Restore$/); assert.ok(header.querySelector('button[aria-label="Close"]'))
    assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-label'), 'Backup & Restore')
    assert.doesNotMatch(document.body.textContent, /Sync Center/)
    const device = q('device-backup-card')
    assert.match(device.textContent, /^This device \(file\)/)
    assert.deepEqual(buttons(device), ['Save backup file', 'Download .json', 'Copy JSON', 'Restore from file'])
    assert.ok(q('save-backup-file-button').className.includes('bg-app-action') && q('save-backup-file-button').className.includes('w-full'))
    assert.ok(q('restore-file-button').className.includes('border-app-border'))
    assert.match(device.textContent, /On this device1 songs · 0 setlists · 0 in trash/)
    // #304: no backup reminder control and no device-only "last backup" line.
    for (const id of ['backup-reminder', 'backup-status']) assert.equal(q(id), null, id)
    assert.doesNotMatch(document.body.textContent, /Remind me to back up|No backup made from this device yet/)
    const card = q('cloud-backup-card')
    assert.match(card.textContent, /^Cloud \(Google\)/i)
    const account = q('cloud-sync-account-card')
    assert.ok(card.contains(account))
    assert.match(account.textContent, /Bee/); assert.match(account.textContent, /b@example.com/); assert.match(account.textContent, /Signed in/)
    for (const label of ['Last cloud backup', 'Contents', 'Checksum', 'Backup size']) assert.match(card.textContent, new RegExp(label))
    assert.doesNotMatch(card.textContent, /Cloud size/)
    assert.match(q('cloud-sync-headroom').textContent, /^\d+\.\d\d MB of 2 MB cloud limit$/)
    assert.equal(card.querySelector('[role="meter"]').getAttribute('aria-label'), 'Backup size')
    assert.match(card.textContent, /1 songs · 0 setlists · 0 in trash/)
    assert.ok(card.textContent.includes(record.checksum))
    assert.ok(!card.textContent.includes(record.updatedAt), 'no raw ISO date')
    assert.ok(card.querySelector('[role="meter"]'))
    assert.doesNotMatch(document.body.textContent, /Idle|In Sync|Conflict/)
    assert.ok(q('cloud-backup-button').className.includes('bg-app-action'))
    assert.ok(q('cloud-restore-button').className.includes('border-app-border'))
    // Removed from the everyday UI (#299): This device view, Review local recovery, debug-log switch.
    for (const id of ['sync-center-debug-switch', 'sync-center-diagnostics', 'sync-center-device-button', 'sync-center-device-view', 'cloud-sync-recovery-button']) assert.equal(q(id), null, id)
    assert.doesNotMatch(document.body.textContent, /Review local recovery|Diagnostics and debug logs|Chart storage/)
    assert.deepEqual(buttons(q('cloud-sync-modal-footer')), ['Close'])
  } finally { await act(async () => root.unmount()) }
})

test('signed out: device card works, cloud card asks to sign in, no cloud request', async () => {
  const { root, calls } = await mount(false)
  try {
    assert.ok(q('device-backup-card'))
    assert.ok(q('save-backup-file-button') && q('restore-file-button'))
    assert.match(q('cloud-sync-account-card').textContent, /Guest \/ Offline.*Auth Required/)
    const signIn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Sign in to use cloud backup')
    assert.ok(signIn.className.includes('w-full') && signIn.className.includes('bg-app-action'))
    assert.ok(q('cloud-backup-card').contains(signIn))
    assert.equal(q('cloud-backup-card').querySelector('[role="meter"]'), null)
    assert.equal(q('cloud-backup-button'), null)
    assert.ok(q('cloud-sync-modal-header') && q('cloud-sync-modal-footer'))
    assert.deepEqual(calls, [])
  } finally { await act(async () => root.unmount()) }
})

test('#304: old recovery archives no longer add an export button or dot to the center footer', async () => {
  const archive = JSON.stringify({ local: { songs: [{ id: 'old', title: 'Old', rawContent: 'C' }], setlists: [] } })
  const { root } = await mount(false, () => localStorage.setItem('gtar_sync_recovery:review:1', archive))
  try {
    assert.deepEqual(buttons(q('cloud-sync-modal-footer')), ['Close'])
    for (const id of ['export-old-recovery-button', 'old-recovery-dot', 'old-recovery-message']) assert.equal(q(id), null, id)
    assert.doesNotMatch(document.body.textContent, /Export old recovery data/)
    assert.equal(localStorage.getItem('gtar_sync_recovery:review:1'), archive, 'recovery data untouched')
  } finally { await act(async () => root.unmount()) }
})

test('design guard: center cards reuse the #296 tokens; no blanket selectors or new hex colours', () => {
  for (const file of ['CloudSyncModal.tsx', 'DeviceBackupCard.tsx', 'RestorePreview.tsx', 'backupCenterUi.ts']) {
    const source = fs.readFileSync(require.resolve(`../src/components/${file}`), 'utf8')
    assert.doesNotMatch(source, /\[&_/, `${file}: no blanket descendant selectors`)
    assert.doesNotMatch(source, /\[#[0-9a-fA-F]{3,8}\]|['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(/, `${file}: theme tokens only`)
  }
  const ui = fs.readFileSync(require.resolve('../src/components/backupCenterUi.ts'), 'utf8')
  for (const name of ['primaryButton', 'secondaryButton', 'outlinedButton']) assert.match(ui, new RegExp(`export const ${name} = '[^']*min-h-11`), `${name}: 44px touch target`)
})
