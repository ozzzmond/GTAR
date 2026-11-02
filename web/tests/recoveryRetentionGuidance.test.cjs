// #173: a blocked safety snapshot names its reason (the guided-steps UI was removed with Local Recovery Review, #304).
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
const api = require('../src/utils/syncJournal.ts')

const song = (id, title = id) => ({ id, title, rawContent: `chart ${id}`, format: 'CHORD_PRO' })
let dom
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.gtar-web.pages.dev' })
  Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent: 'GTAR test', locks: { request: async (_, options, fn) => fn({}) } } })
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  localStorage.setItem(api.LIBRARY_KEY, JSON.stringify({ songs: [song('current', 'Current Song')], setlists: [] }))
})
afterEach(async () => {
  dom.window.close()
})

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
  assert.deepEqual(usage, { count: 1, bytes: 2 * ('gtar_sync_recovery:download:1'.length + 100), maxCount: 32, maxBytes: 3 * 1024 * 1024, indexedDb: false })
})
