// #173: a blocked safety snapshot names its reason, and Recovery Review shows the decide-then-cleanup order.
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/assets/dev-logo.png' }
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const api = require('../src/utils/syncJournal.ts')
const { RecoveryReviewDialog } = require('../src/components/RecoveryReviewDialog.tsx')

const song = (id, title = id) => ({ id, title, rawContent: `chart ${id}`, format: 'CHORD_PRO' })
let dom, root
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.gtar-web.pages.dev' })
  Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent: 'GTAR test', locks: { request: async (_, options, fn) => fn({}) } } })
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  localStorage.setItem(api.LIBRARY_KEY, JSON.stringify({ songs: [song('current', 'Current Song')], setlists: [] }))
})
afterEach(async () => {
  if (root) { await act(async () => root.unmount()); root = null }
  dom.window.close()
})
const render = async () => {
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(RecoveryReviewDialog, { blocked: () => false, onClose() {} })))
}
const text = id => document.querySelector(`[data-testid="${id}"]`)?.textContent ?? null

test('retention block throws RecoveryRetentionError and maps to a specific, non-destructive message', async () => {
  for (let i = 0; i < api.RECOVERY_MAX_COUNT; i++) localStorage.setItem(`gtar_sync_recovery:download:${i}`, JSON.stringify({ songs: [], setlists: [] }))
  const error = await api.writeRecoverySnapshot('gtar_sync_recovery:merge:new', '{}', localStorage).catch(e => e)
  assert.ok(error instanceof api.RecoveryRetentionError)
  const message = api.recoverySnapshotFailureMessage(error, 'sync')
  assert.match(message, /Recovery storage is full \(limit 32 archives \/ 3 MiB\)/)
  assert.match(message, /Nothing was changed/)
  assert.match(message, /choose the current library, then review decided archive cleanup before retrying sync/)
  assert.equal(localStorage.getItem('gtar_sync_recovery:merge:new'), null)
})

test('quota and readback failures get their own reasons', () => {
  assert.match(api.recoverySnapshotFailureMessage(new DOMException('full', 'QuotaExceededError'), 'download'), /^Device storage is full.*retrying download\.$/)
  assert.match(api.recoverySnapshotFailureMessage(new Error('Snapshot readback failed'), 'replacing the cloud songbook'), /^Recovery snapshot could not be verified.*replacing the cloud songbook\.$/)
})

test('retention usage counts only recovery archives (UTF-16 bytes)', () => {
  localStorage.setItem('gtar_sync_recovery:download:1', 'x'.repeat(100))
  localStorage.setItem('unrelated', 'y'.repeat(1000))
  const usage = api.recoveryRetentionUsage(localStorage)
  assert.deepEqual(usage, { count: 1, bytes: 2 * ('gtar_sync_recovery:download:1'.length + 100), maxCount: 32, maxBytes: 3 * 1024 * 1024 })
})

test('undecided archives: guided steps, usage line and deduplicated missing titles behind a disclosure', async () => {
  localStorage.setItem('gtar_sync_recovery:download:1', JSON.stringify({ songs: [song('lost-1', 'Lost One'), song('lost-2', 'Lost Two')], setlists: [] }))
  localStorage.setItem('gtar_sync_recovery:merge:2', JSON.stringify({ local: { songs: [song('lost-1', 'Lost One')], setlists: [] }, remote: { songs: [], setlists: [] } }))
  const before = JSON.stringify(Object.entries(localStorage))
  await render()
  assert.match(text('recovery-retention-usage'), /Recovery storage: 2 of 32 archives · 0\.00 of 3\.00 MiB/)
  const steps = text('recovery-guided-steps')
  assert.match(steps, /Export all recovery data/)
  assert.match(steps, /Choose current library for 2 undecided archives\. Undecided archives can't be cleaned up\./)
  assert.match(steps, /Review decided archive cleanup, then retry sync\./)
  const missing = document.querySelector('[data-testid="recovery-missing-titles"]')
  assert.equal(missing.tagName, 'DETAILS')
  assert.equal(missing.open, false, 'titles stay collapsed until opened')
  assert.match(missing.querySelector('summary').textContent, /Show 2 missing records before deciding/)
  assert.equal(missing.querySelectorAll('li').length, 2)
  assert.match(missing.textContent, /Lost One/)
  assert.equal(JSON.stringify(Object.entries(localStorage)), before, 'rendering the review never mutates storage')
})

test('after choosing current library, step 2 is done and cleanup count is shown', async () => {
  localStorage.setItem('gtar_sync_recovery:download:1', JSON.stringify({ songs: [song('lost-1')], setlists: [] }))
  api.recordRecoveryChoice(api.inspectRecovery(), 'keep-current', () => false)
  await render()
  const steps = text('recovery-guided-steps')
  assert.match(steps, /Choose current library \(done\)/)
  assert.match(steps, /Review decided archive cleanup — 1 ready to remove/)
  assert.equal(document.querySelector('[data-testid="recovery-missing-titles"]'), null)
})

test('no archives: no guided steps', async () => {
  await render()
  assert.equal(document.querySelector('[data-testid="recovery-guided-steps"]'), null)
  assert.match(text('recovery-retention-usage'), /0 of 32 archives/)
})
