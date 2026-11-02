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
const { LIBRARY_KEY, RECOVERY_DECISIONS_KEY, inspectRecovery, recoveryExportData } = require('../src/utils/syncJournal.ts')
const { RecoveryDataPanel } = require('../src/components/RecoveryDataPanel.tsx')
const { formatRecoverySize, resetRecoverySaveForTests, summarizeRecoveryData } = require('../src/utils/recoveryDataSummary.ts')
const { useRecoveryAttention } = require('../src/utils/recoveryAttention.ts')

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

test('copies added after Save: nothing is deleted', async () => {
  archive('download:1', { songs: [song('lost')], setlists: [] })
  await render()
  await click('recovery-data-save')
  archive('download:3', { songs: [song('newer')], setlists: [] })
  const before = bytes()
  await click('recovery-data-delete')
  await click('recovery-data-confirm-delete')
  assert.deepEqual(bytes(), before, 'nothing deleted')
  assert.equal($('recovery-data-message').textContent, 'Recovery data changed since you saved it. Save it again first.')
  assert.equal($('recovery-data-delete').disabled, true)
})

test('a saved value that changed after Save: nothing is deleted', async () => {
  archive('download:1', { songs: [song('lost')], setlists: [] })
  archive('download:2', '{broken')
  await render()
  await click('recovery-data-save')
  await click('recovery-data-delete')
  archive('download:2', '{broken differently')
  const before = bytes()
  await click('recovery-data-confirm-delete')
  assert.deepEqual(bytes(), before, 'nothing deleted, readable copy included')
  assert.equal($('recovery-data-message').textContent, 'Recovery data changed since you saved it. Save it again first.')
})

test('direct call: a value changed between Save and Delete stops before deleting anything', async () => {
  archive('download:1', { songs: [song('lost')], setlists: [] })
  archive('download:2', { songs: [song('lost2')], setlists: [] })
  const { markRecoveryDataSaved, savedRecoveryData } = require('../src/utils/recoveryDataSummary.ts')
  const { deleteSavedRecoveryData, RecoveryDataChangedError } = require('../src/utils/recoveryDataDelete.ts')
  markRecoveryDataSaved(inspectRecovery())
  archive('download:2', { songs: [song('edited')], setlists: [] })
  const before = bytes()
  await assert.rejects(deleteSavedRecoveryData(savedRecoveryData(), () => false), RecoveryDataChangedError)
  assert.deepEqual(bytes(), before)
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

test('unreadable + readable copies: Save, then Delete removes all of them; library bytes unchanged; dot clears', async () => {
  archive('download:1', { songs: [song('lost')], setlists: [] })
  archive('replacement:2', '{broken')
  localStorage.setItem(RECOVERY_DECISIONS_KEY, '{not json')
  const keepers = { [LIBRARY_KEY]: library, gtar_theme: 'dark', gtar_manual_cloud_backup_dates: localStorage.getItem('gtar_manual_cloud_backup_dates') }
  await render()
  const dot = createRoot(document.body.appendChild(document.createElement('div')))
  const Dot = () => React.createElement('span', { id: 'dot' }, useRecoveryAttention(true) ? 'DOT' : 'NODOT')
  await act(async () => dot.render(React.createElement(Dot)))
  try {
    assert.equal(document.getElementById('dot').textContent, 'DOT')
    assert.equal($('recovery-data-unreadable').textContent, "Some copies can't be opened. Save them before deleting.")
    assert.equal($('recovery-data-delete').disabled, true)
    assert.equal(document.getElementById('recovery-data-delete-hint').textContent, 'Save recovery data first to delete it.')
    assert.doesNotMatch(document.body.textContent, /can't be deleted here/)
    noJargon('unreadable')
    await click('recovery-data-save')
    const exported = JSON.parse(await downloads[0].blob.text())
    assert.equal(exported['gtar_sync_recovery:replacement:2'], '{broken', 'unreadable copy is inside the saved file')
    assert.equal($('recovery-data-delete').disabled, false, 'enabled after Save even with unreadable copies')
    await click('recovery-data-delete')
    await click('recovery-data-confirm-delete')
    assert.deepEqual(Object.keys(localStorage).filter(k => k.startsWith('gtar_sync_recovery:')), [])
    assert.equal(localStorage.getItem(RECOVERY_DECISIONS_KEY), null, 'unreadable decision file (saved) removed')
    for (const [key, value] of Object.entries(keepers)) assert.equal(localStorage.getItem(key), value, `${key} byte-identical`)
    assert.equal(inspectRecovery().invalid, false)
    assert.equal(summarizeRecoveryData().unreadable, false)
    assert.equal(document.getElementById('dot').textContent, 'NODOT', 'attention dot cleared')
    assert.equal($('recovery-data-message').textContent, 'Recovery data deleted.')
    assert.equal($('recovery-data-empty').textContent, 'No recovery data on this device.')
  } finally { await act(async () => dot.unmount()) }
})

test('allowlist: library, B2, owner, settings, backup and log keys stay byte-identical; unknown source kept and reported', async () => {
  const fixed = {
    gtar_library_v2: '{"index":true}', gtar_sync_library_owner: '{"owner":"u1"}', 'gtar_library_b2_head::scope': 'b2|scope|0|x',
    gtar_settings_restore_snapshot_v1: '{"s":1}', gtar_debug_logs: '[{"m":"x"}]', 'gtar_recovery_scopes_v1': '{}',
  }
  for (const [key, value] of Object.entries(fixed)) localStorage.setItem(key, value)
  archive('download:1', { songs: [song('lost')], setlists: [] })
  archive('cross-tab-conflict:2', '{broken')
  const journal = JSON.stringify({ version: 1, baseline: { songs: [song('current')], setlists: [] } })
  localStorage.setItem('gtar_sync_v1:old', journal)
  const before = bytes()
  await render()
  assert.equal($('recovery-data-count').textContent, '3')
  await click('recovery-data-save')
  await click('recovery-data-delete')
  await click('recovery-data-confirm-delete')
  const after = bytes()
  assert.equal(after['gtar_sync_recovery:download:1'], undefined)
  assert.equal(after['gtar_sync_recovery:cross-tab-conflict:2'], undefined)
  assert.equal(after['gtar_sync_v1:old'], journal, 'unknown source kept')
  for (const key of Object.keys(before).filter(k => !k.startsWith('gtar_sync_recovery:'))) assert.equal(after[key], before[key], `${key} byte-identical`)
  assert.equal($('recovery-data-message').textContent, 'Recovery data deleted. 1 copy could not be deleted here and stays on this device.')
  assert.equal($('recovery-data-count').textContent, '1')
})

test('decision file keeps only references to copies that stay', async () => {
  const { pruneRecoveryDecisions } = require('../src/utils/recoveryDataDelete.ts')
  const library = { digest: `sha256-utf16le:${'a'.repeat(64)}`, rawLength: 1, songs: 1, setlists: 0, timestamp: 1 }
  const ref = key => ({ sourceKey: key, rawLength: 1, digest: 'x' })
  const raw = JSON.stringify({ version: 3, legacyRaw: null, decisions: [
    { choice: 'keep-current', library, sources: { 'gtar_sync_recovery:a': ref('gtar_sync_recovery:a'), 'gtar_sync_v1:old': ref('gtar_sync_v1:old') } },
    { choice: 'keep-current', library, sources: { 'gtar_sync_recovery:b': ref('gtar_sync_recovery:b') } },
  ] })
  const pruned = JSON.parse(pruneRecoveryDecisions(raw, new Set(['gtar_sync_recovery:a', 'gtar_sync_recovery:b'])))
  assert.deepEqual(pruned.decisions.map(d => Object.keys(d.sources)), [['gtar_sync_v1:old']])
  assert.equal(pruneRecoveryDecisions(raw, new Set(['gtar_sync_recovery:a', 'gtar_sync_recovery:b', 'gtar_sync_v1:old'])), null)
  assert.throws(() => pruneRecoveryDecisions('{broken', new Set()))
})

test('archives held in the IndexedDB archive store are removed by compare-and-delete', async () => {
  const store = require('../src/utils/recoveryArchiveStore.ts')
  const records = new Map([['gtar_sync_recovery:download:9', JSON.stringify({ songs: [song('lost')], setlists: [] })], ['gtar_sync_recovery:records:10', '{broken'], [store.RETIRED_LIBRARY_KEY, library]])
  const removes = []
  const backend = {
    loadAll: async () => new Map(records),
    put: async (key, raw) => { records.set(key, raw) },
    remove: async (key, expected) => { removes.push(key); if (records.get(key) !== expected) return false; records.delete(key); return true },
  }
  await store.prepareRecoveryArchives(backend, localStorage)
  try {
    await render()
    assert.equal($('recovery-data-count').textContent, '2')
    await click('recovery-data-save')
    await click('recovery-data-delete')
    await click('recovery-data-confirm-delete')
    assert.deepEqual(removes.sort(), ['gtar_sync_recovery:download:9', 'gtar_sync_recovery:records:10'])
    assert.deepEqual([...records.keys()], [store.RETIRED_LIBRARY_KEY], 'retired library copy untouched')
    assert.equal(localStorage.getItem(LIBRARY_KEY), library)
    assert.equal($('recovery-data-message').textContent, 'Recovery data deleted.')
  } finally { store.resetRecoveryArchives() }
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
