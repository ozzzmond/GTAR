// #191 (RFC #188 S3): header status pill states, device facts and the DEV Sync Center sections.
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = (module) => { module.exports = '/assets/dev-logo.png' }
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const dom0 = new JSDOM('', { url: 'https://gtar.test' })
Object.assign(global, { window: dom0.window, document: dom0.window.document, localStorage: dom0.window.localStorage })
const status = require('../src/utils/syncStatus.ts')
const facts = require('../src/utils/useSyncStatus.ts')
const sync = require('../src/utils/cloudSongbookSync.ts')
const journal = require('../src/utils/syncJournal.ts')
const { makeLibrary } = require('./helpers/syntheticSongbook.cjs')

const base = { signedIn: true, status: 'IDLE', isProcessing: false, lastSyncedAt: 1_000_000, localChanged: false,
  recoveryNeedsDecision: false, syncReference: 'saved', headroom: 'ok', now: 1_000_000 + 2 * 60000 }
const pill = over => status.deriveSyncPill({ ...base, ...over })

test('five states with the agreed priority', () => {
  assert.equal(pill({ signedIn: false }).kind, 'device')
  assert.equal(pill({ lastSyncedAt: null }).kind, 'device')
  assert.equal(pill({ isProcessing: true }).kind, 'syncing')
  assert.equal(pill({}).kind, 'synced')
  assert.equal(pill({}).label, 'Synced · 2m')
  assert.equal(pill({ localChanged: true }).kind, 'pending')
  assert.equal(pill({ status: 'OFFLINE' }).kind, 'pending')
  // attention beats everything, even a running sync
  assert.equal(pill({ isProcessing: true, recoveryNeedsDecision: true }).kind, 'attention')
  assert.equal(pill({ localChanged: true, syncReference: 'missing' }).kind, 'attention')
  // syncing beats pending
  assert.equal(pill({ isProcessing: true, localChanged: true }).kind, 'syncing')
})

test('attention counts every waiting decision; a warning-level size is not one', () => {
  const p = pill({ status: 'CONFLICT', recoveryNeedsDecision: true, syncReference: 'missing', headroom: 'over' })
  assert.deepEqual(p.attention.map(item => item.id), ['conflict', 'recovery', 'sync-reference', 'size-limit'])
  assert.equal(p.label, 'Needs attention · 4')
  assert.match(p.description, /safe on this device/)
  assert.equal(pill({ headroom: 'warning' }).kind, 'synced')
  assert.equal(pill({ status: 'ERROR' }).attention[0].id, 'sync-error')
})

test('age formatting', () => {
  assert.equal(status.formatSyncAge(10_000), 'now')
  assert.equal(status.formatSyncAge(5 * 60000), '5m')
  assert.equal(status.formatSyncAge(3 * 3600000), '3h')
  assert.equal(status.formatSyncAge(50 * 3600000), '2d')
  assert.equal(pill({ now: base.lastSyncedAt + 5000 }).label, 'Synced')
})

test('device facts: never synced, synced, local change and a lost sync reference', async () => {
  localStorage.clear()
  const lib = makeLibrary(6, 2, { chars: 400 })
  journal.persistLibrary(lib, localStorage)
  let f = await facts.readSyncDeviceFacts(localStorage)
  assert.equal(f.syncReference, 'none')
  assert.equal(f.localChanged, false)
  assert.equal(f.songs, 6)
  assert.equal(f.headroom.level, 'ok')

  const full = journal.readPersistedLibrary(localStorage)
  sync.saveCloudSyncBase(full, localStorage)
  sync.saveCloudSyncMeta({ lastSyncedChecksum: sync.computeSongbookChecksum(full), lastSyncedAt: 5, cloudVersion: 1 }, localStorage)
  f = await facts.readSyncDeviceFacts(localStorage)
  assert.equal(f.syncReference, 'saved')
  assert.equal(f.localChanged, false)
  assert.equal(f.lastSyncedAt, 5)

  const edited = { ...full, songs: full.songs.map((s, i) => i === 0 ? { ...s, rawContent: s.rawContent + '\nedit' } : s) }
  journal.persistLibrary(edited, localStorage, { expectedRaw: journal.libraryRevision(localStorage) })
  assert.equal((await facts.readSyncDeviceFacts(localStorage)).localChanged, true)

  localStorage.removeItem(sync.CLOUD_SYNC_BASE_KEY)
  assert.equal(await sync.inspectSyncReference(localStorage), 'missing')
})

let dom, root, container
beforeEach(() => {
  dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'https://gtar.test' })
  Object.assign(global, { window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, CustomEvent: dom.window.CustomEvent, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })
  container = document.getElementById('root')
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()) })

test('pill: accessible label, state attribute and click opens the Sync Center', () => {
  const { SyncStatusPill } = require('../src/components/SyncStatusPill.tsx')
  let opened = 0
  const p = pill({ status: 'CONFLICT', recoveryNeedsDecision: true })
  act(() => root.render(React.createElement(SyncStatusPill, { pill: p, onOpen: () => { opened++ } })))
  const button = container.querySelector('[data-testid="header-cloud-sync-button"]')
  assert.equal(button.tagName, 'BUTTON')
  assert.equal(button.getAttribute('data-sync-state'), 'attention')
  assert.match(button.getAttribute('aria-label'), /needs attention/i)
  assert.match(button.textContent, /Sync Issue/)
  act(() => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
  assert.equal(opened, 1)
})

test('Sync Center sections render only when the dialog is in Sync Center mode', () => {
  const { CloudSyncModal } = require('../src/components/CloudSyncModal.tsx')
  act(() => root.render(React.createElement(CloudSyncModal, { isOpen: true, onClose: () => {} })))
  assert.match(container.querySelector('h2').textContent, /Cloud Songbook Sync/)
  assert.equal(container.querySelector('[data-testid="sync-center-details"]'), null)

  let logs = 0
  const center = { pill: pill({ syncReference: 'missing' }), onOpenDebugLogs: () => { logs++ },
    facts: { lastSyncedAt: 1, localChanged: false, songs: 140, setlists: 12, chartsInIndexedDb: true, syncReference: 'missing', headroom: null } }
  act(() => root.render(React.createElement(CloudSyncModal, { isOpen: true, onClose: () => {}, syncCenter: center })))
  assert.match(container.querySelector('h2').textContent, /Sync Center/)
  const details = container.querySelector('[data-testid="sync-center-details"]')
  assert.match(details.textContent, /1 item needs a decision/)
  assert.match(details.textContent, /140 songs · 12 setlists/)
  assert.match(details.textContent, /IndexedDB/)
  assert.equal(container.querySelector('[data-testid="sync-center-reference"]').textContent.trim(), 'Not saved')
  const diag = [...details.querySelectorAll('button')].find(b => /debug logs/.test(b.textContent))
  act(() => diag.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
  assert.equal(logs, 1)
})

test('no render loop when the dialog re-emits its sync state on every render', async () => {
  const { useSyncStatus } = require('../src/utils/useSyncStatus.ts')
  localStorage.clear()
  let renders = 0
  function Probe() {
    renders++
    useSyncStatus({ enabled: true, signedIn: true, status: 'IDLE', isProcessing: false, recoveryNeedsDecision: false })
    // Same as CloudSyncModal's effect with an inline onSyncStateChange from the header.
    React.useEffect(() => { window.dispatchEvent(new window.CustomEvent('gtar:cloud_sync_state', { detail: { status: 'IDLE', isProcessing: false } })) })
    return null
  }
  await act(async () => { root.render(React.createElement(Probe)) })
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.ok(renders < 6, `renders ${renders}`)
})

test('header keeps the original sync button look; DEV menu drops Debug Logs (Sync Center has it)', () => {
  const { SyncStatusPill } = require('../src/components/SyncStatusPill.tsx')
  act(() => root.render(React.createElement(SyncStatusPill, { pill: pill({}), onOpen: () => {} })))
  const button = container.querySelector('[data-testid="header-cloud-sync-button"]')
  assert.match(button.className, /rounded-xl bg-app-base/)
  assert.match(button.textContent, /In Sync/)
  const header = fs.readFileSync(require.resolve('../src/components/Header.tsx'), 'utf8')
  assert.match(header, /\{isDevApp && !isDevEnv && \(/)
})
