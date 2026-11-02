// #304 item 8: the "Recovery data" panel replaces Local Recovery Review — plain language, Save, Delete after Save.
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const React = require('react'), { act } = React
const { createRoot } = require('react-dom/client')
const { LIBRARY_KEY, recoveryExportData } = require('../src/utils/syncJournal.ts')
const { RecoveryDataPanel } = require('../src/components/RecoveryDataPanel.tsx')
const { formatRecoverySize, resetRecoverySaveForTests } = require('../src/utils/recoveryDataSummary.ts')

const song = (id, extra = {}) => ({ id, title: `Song ${id}`, rawContent: 'private chart', ...extra })
const library = JSON.stringify({ songs: [song('current')], setlists: [] })
const JARGON = /\bB1\b|\bB2\b|shadow|IndexedDB|localStorage|partition|fingerprint|sync|conflict|archive|retention|decision/i
let dom, root, downloads, closed
const bytes = () => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))
const archive = (name, value) => localStorage.setItem(`gtar_sync_recovery:${name}`, typeof value === 'string' ? value : JSON.stringify(value))
const $ = id => document.querySelector(`[data-testid="${id}"]`)
const click = async id => act(async () => { const el = $(id); assert.ok(el, id); el.click() })
const buttons = () => [...document.querySelectorAll('button')].map(b => b.textContent.trim() || b.getAttribute('aria-label'))
const noJargon = state => assert.doesNotMatch(document.body.textContent, JARGON, `no technical terms (${state})`)

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.test' })
  Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: { locks: { request: async (_, options, callback) => callback({}) } } })
  downloads = []; closed = 0
  URL.createObjectURL = blob => { downloads.push({ blob }); return 'blob:recovery' }
  URL.revokeObjectURL = () => {}
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads.at(-1).name = this.download }
  localStorage.setItem(LIBRARY_KEY, library)
  localStorage.setItem('gtar_theme', 'dark')
  localStorage.setItem('gtar_manual_cloud_backup_dates', '{"u1":"2026-11-01T10:00:00.000Z"}')
  resetRecoverySaveForTests()
})
afterEach(async () => { if (root) { await act(async () => root.unmount()); root = null } dom.window.close() })
const render = async () => {
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(RecoveryDataPanel, { blocked: () => false, onClose: () => { closed++ } })))
}

test('shows the number of saved copies and their size in plain language, in the Backup & Restore shell', async () => {
  archive('download:1', { songs: [song('lost')], setlists: [] })
  archive('merge:2', { local: { songs: [song('current', { rawContent: 'older' })], setlists: [] }, remote: { songs: [], setlists: [] } })
  const size = Object.entries(bytes()).filter(([k]) => k.startsWith('gtar_sync_recovery:')).reduce((sum, [k, v]) => sum + 2 * (k.length + v.length), 0)
  const before = bytes()
  await render()
  const panel = $('recovery-data-panel')
  assert.equal(panel.getAttribute('role'), 'dialog'); assert.equal(panel.getAttribute('aria-label'), 'Recovery data')
  for (const cls of ['max-w-lg', 'rounded-2xl', 'border', 'bg-app-surface']) assert.ok(panel.className.split(' ').includes(cls), cls)
  assert.match(panel.querySelector('h2').textContent, /^Recovery data$/)
  assert.match(document.body.textContent, /Older copies of your songbook that GTAR kept on this device\. Your current songbook is not affected\./)
  assert.equal($('recovery-data-count').textContent, '2')
  assert.equal($('recovery-data-size').textContent, formatRecoverySize(size))
  assert.match($('recovery-data-size').className, /font-mono/)
  assert.equal($('recovery-data-unreadable'), null)
  assert.doesNotMatch(document.body.textContent, /private chart|Song lost/, 'no record titles or content')
  assert.deepEqual(buttons(), ['Close', 'Save recovery data', 'Delete recovery data', 'Close'])
  for (const button of document.querySelectorAll('button')) assert.match(button.className, /min-h-11|h-11/)
  noJargon('summary')
  assert.deepEqual(bytes(), before, 'opening the panel changes nothing')
})

test('size format: KB below 1 MB, one decimal MB above', () => {
  assert.equal(formatRecoverySize(48 * 1024), '48 KB')
  assert.equal(formatRecoverySize(100), '1 KB')
  assert.equal(formatRecoverySize(13.7 * 1024 * 1024), '13.7 MB')
})

test('Save downloads the same full recovery export as before and changes nothing', async () => {
  archive('download:1', { songs: [song('lost')], setlists: [] })
  const before = bytes(), expected = recoveryExportData()
  await render()
  await click('recovery-data-save')
  assert.equal(downloads.length, 1)
  assert.equal(downloads[0].name, 'GTAR-storage-recovery.json')
  assert.deepEqual(JSON.parse(await downloads[0].blob.text()), expected)
  assert.equal($('recovery-data-message').textContent, 'Recovery data saved.')
  assert.deepEqual(bytes(), before)
})

test('Delete is disabled until Save succeeded, needs a confirm step, and removes only recovery copies', async () => {
  archive('download:1', { songs: [song('lost')], setlists: [] })
  archive('download:2', { songs: [song('current')], setlists: [] })
  await render()
  assert.equal($('recovery-data-delete').disabled, true, 'disabled before Save')
  assert.match(document.body.textContent, /Save recovery data first to delete it\./)
  await click('recovery-data-save')
  assert.equal($('recovery-data-delete').disabled, false, 'enabled after Save')

  await click('recovery-data-delete')
  const confirm = $('recovery-data-confirm')
  assert.match(confirm.className, /status-warning/)
  assert.match(confirm.textContent, /Delete all saved copies from this device\? Your current songbook stays\./)
  noJargon('confirm')
  assert.equal(localStorage.getItem('gtar_sync_recovery:download:1') !== null, true, 'nothing deleted before confirming')
  await act(async () => [...confirm.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click())
  assert.equal($('recovery-data-confirm'), null)
  assert.equal(Object.keys(localStorage).filter(k => k.startsWith('gtar_sync_recovery:')).length, 2, 'Cancel keeps everything')

  await click('recovery-data-delete')
  await click('recovery-data-confirm-delete')
  assert.equal(Object.keys(localStorage).filter(k => k.startsWith('gtar_sync_recovery:')).length, 0, 'recovery copies removed')
  assert.equal(localStorage.getItem(LIBRARY_KEY), library, 'current library bytes unchanged')
  assert.equal(localStorage.getItem('gtar_theme'), 'dark', 'settings unchanged')
  assert.equal(localStorage.getItem('gtar_manual_cloud_backup_dates'), '{"u1":"2026-11-01T10:00:00.000Z"}', 'backup state unchanged')
  assert.equal($('recovery-data-message').textContent, 'Recovery data deleted.')
  assert.equal($('recovery-data-empty').textContent, 'No recovery data on this device.')
  noJargon('deleted')
})

test('copies that changed after Save are not deleted', async () => {
  archive('download:1', { songs: [song('lost')], setlists: [] })
  await render()
  await click('recovery-data-save')
  archive('download:3', { songs: [song('newer')], setlists: [] })
  const before = bytes()
  await click('recovery-data-delete')
  await click('recovery-data-confirm-delete')
  assert.deepEqual(bytes(), before, 'nothing deleted')
  assert.match($('recovery-data-message').textContent, /Recovery data changed since you saved it\. Nothing was deleted\. Save it again first\./)
  assert.equal($('recovery-data-delete').disabled, true)
})

test('a failing delete removes nothing and says so plainly', async () => {
  archive('download:1', { songs: [song('lost')], setlists: [] })
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(RecoveryDataPanel, { blocked: () => true, onClose() {} })))
  await click('recovery-data-save')
  const before = bytes()
  await click('recovery-data-delete')
  await click('recovery-data-confirm-delete')
  assert.deepEqual(bytes(), before)
  assert.equal($('recovery-data-message').textContent, 'Nothing was deleted. Close the editor and any other GTAR tabs, then try again.')
  noJargon('error')
})

test('unreadable copies: one plain line, Save still works, Delete stays off', async () => {
  archive('download:1', { songs: [song('lost')], setlists: [] })
  archive('download:2', '{broken')
  const before = bytes()
  await render()
  assert.equal($('recovery-data-unreadable').textContent, "Some copies can't be opened. Save them before deleting.")
  assert.equal($('recovery-data-count').textContent, '2')
  noJargon('unreadable')
  await click('recovery-data-save')
  assert.equal(downloads.length, 1)
  assert.equal(JSON.parse(await downloads[0].blob.text())['gtar_sync_recovery:download:2'], '{broken')
  assert.equal($('recovery-data-delete').disabled, true)
  assert.deepEqual(bytes(), before)
})

test('empty state: "No recovery data on this device." and only Close', async () => {
  await render()
  assert.equal($('recovery-data-empty').textContent, 'No recovery data on this device.')
  assert.deepEqual(buttons(), ['Close', 'Close'])
  noJargon('empty')
  await click('recovery-data-close')
  await act(async () => document.querySelector('[aria-label="Close"]').click())
  await act(async () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })))
  assert.equal(closed, 3, 'footer Close, header X and Escape close the panel')
})
