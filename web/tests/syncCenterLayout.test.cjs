// Sync Center keeps the restored 309a82b layout: header bar, account card, CLOUD BACKUP card, footer.
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
const { computeSongbookChecksum } = require('../src/utils/cloudSongbookSync.ts')
const { persistLibrary } = require('../src/utils/syncJournal.ts')
const library = { songs: [{ id: '11111111-1111-4111-8111-111111111111', title: 'A', rawContent: '[C]Hi', artist: 'A' }], setlists: [] }
const q = id => document.querySelector(`[data-testid="${id}"]`)

async function mount(signedIn) {
  localStorage.clear(); persistLibrary(library, localStorage)
  const record = { version: 1, checksum: computeSongbookChecksum(library), updatedAt: '2026-11-01T09:37:35Z', data: library }
  const calls = []
  global.fetch = async (_, opts) => { calls.push(opts.method); return new Response(JSON.stringify({ success: true, cloudRecord: record })) }
  auth.useOptionalGoogleAuth = () => ({ session: signedIn ? { token: 't', user: { id: 'B', email: 'b@example.com', name: 'Bee' } } : null, accessStatus: 'active', signIn: async () => {} })
  const root = createRoot(document.getElementById('root'))
  await act(async () => { root.render(React.createElement(CloudSyncModal, { isOpen: true, onClose() {}, onOpenDebugLogs() {} })); await new Promise(r => setTimeout(r, 5)) })
  return { root, calls, record }
}

test('signed in: header bar, account card, CLOUD BACKUP card, actions and footer', async () => {
  const { root, record } = await mount(true)
  try {
    const header = q('cloud-sync-modal-header')
    assert.ok(header); assert.match(header.textContent, /Sync Center/); assert.ok(header.querySelector('button[aria-label="Close"]'))
    const account = q('cloud-sync-account-card')
    assert.match(account.textContent, /Bee/); assert.match(account.textContent, /b@example.com/); assert.match(account.textContent, /Signed in/)
    const card = q('cloud-backup-card')
    assert.match(card.textContent, /Cloud Backup/i)
    for (const label of ['Last cloud backup', 'Contents', 'Checksum', 'Cloud size']) assert.match(card.textContent, new RegExp(label))
    assert.match(card.textContent, /1 songs · 0 setlists · 0 in trash/)
    assert.ok(card.textContent.includes(record.checksum))
    assert.ok(!card.textContent.includes(record.updatedAt), 'no raw ISO date')
    assert.ok(card.querySelector('[role="meter"]'))
    assert.doesNotMatch(document.body.textContent, /Idle|In Sync|Conflict/)
    assert.ok(q('cloud-backup-button').className.includes('bg-app-action'))
    assert.ok(q('cloud-restore-button').className.includes('border-app-border'))
    assert.ok(q('sync-center-debug-switch')); assert.match(q('sync-center-diagnostics').textContent, /Diagnostics and debug logs/)
    const footer = q('cloud-sync-modal-footer')
    assert.deepEqual([...footer.querySelectorAll('button')].map(b => b.textContent), ['Review local recovery', 'This device', 'Close'])
    await act(async () => q('sync-center-device-button').click())
    assert.match(q('sync-center-device-view').textContent, /1 songs · 0 setlists · 0 in trash/)
    assert.match(q('sync-center-device-view').textContent, /Chart storage/)
  } finally { await act(async () => root.unmount()) }
})

test('signed out: account card shows Auth Required plus a full-width sign-in button and no cloud card', async () => {
  const { root, calls } = await mount(false)
  try {
    assert.match(q('cloud-sync-account-card').textContent, /Guest \/ Offline.*Auth Required/)
    const signIn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Sign in to back up to cloud')
    assert.ok(signIn.className.includes('w-full'))
    assert.equal(q('cloud-backup-card'), null)
    assert.ok(q('cloud-sync-modal-header') && q('cloud-sync-modal-footer'))
    assert.deepEqual(calls, [])
  } finally { await act(async () => root.unmount()) }
})
