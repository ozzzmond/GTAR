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
const { inspectRecovery, hasActionableRecovery, recordRecoveryChoice, recoveryData, LIBRARY_KEY, RECOVERY_DECISIONS_KEY } = require('../src/utils/syncJournal.ts')
const { RecoveryReviewDialog } = require('../src/components/RecoveryReviewDialog.tsx')
const song = (id, extra = {}) => ({ id, title: 'Same title', rawContent: 'private chart', ...extra })
let dom, root
const original = { songs: [song('current'), song('deleted', { isDeleted: true })], setlists: [] }
const bytes = () => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))
const archive = (name, value) => localStorage.setItem(`gtar_sync_recovery:${name}`, JSON.stringify(value))
const choose = (review = inspectRecovery(), choice = 'keep-current', blocked = () => false) => recordRecoveryChoice(review, choice, blocked)
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.test' })
  Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: { locks: { request: async (_, options, callback) => { assert.equal(options.ifAvailable, true); return callback({}) } } } })
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(original))
})
afterEach(async () => { if (root) { await act(async () => root.unmount()); root = null } dom.window.close() })

test('download, cross-tab and valid raw envelopes represented by canonical records are read-only and non-actionable', () => {
  archive('download:1', original); archive('cross-tab-conflict:1', { songs: [original.songs[1]], setlists: [] })
  archive('replacement:1', { raw: JSON.stringify(original) })
  const before = bytes()
  assert.equal(hasActionableRecovery(), false)
  assert.equal(inspectRecovery().sources.every(source => source.status === 'represented'), true)
  assert.deepEqual(bytes(), before)
})
test('missing records deduplicate by ID across archives, never by title; historical versions stay distinct', () => {
  const missing = song('missing')
  archive('download:1', { songs: [missing, song('current', { rawContent: 'old' })], setlists: [] })
  archive('cross-tab-conflict:1', { songs: [missing, song('current', { rawContent: 'old' })], setlists: [] })
  archive('download:2', { songs: [song('current', { rawContent: 'older' })], setlists: [] })
  const review = inspectRecovery()
  assert.equal(review.missingRecords, 1); assert.equal(review.divergentVersions, 2)
  assert.equal(review.sources.filter(source => source.status === 'actionable').length, 3)
  assert.equal(hasActionableRecovery(), true)
})
test('tombstone equality is represented; live/deleted differences and absent tombstones remain protected', () => {
  archive('download:1', { songs: [song('deleted')], setlists: [] })
  archive('download:2', { songs: [song('absent-deleted', { isDeleted: true })], setlists: [] })
  const review = inspectRecovery()
  assert.equal(review.missingRecords, 1); assert.equal(review.divergentVersions, 1)
  assert.equal(review.sources[0].differences[0].difference, 'divergent')
  assert.equal(review.sources[1].differences[0].deleted, true)
})
test('setlist content and ordering diverge even when every ID exists', () => {
  const list = { id: 'list', name: 'Weekly', songs: [{ id: 'current', title: 'Same title' }, { id: 'deleted', title: 'Same title' }] }
  localStorage.setItem(LIBRARY_KEY, JSON.stringify({ ...original, setlists: [list] }))
  archive('download:1', { ...original, setlists: [{ ...list, songs: [...list.songs].reverse() }] })
  assert.equal(inspectRecovery().divergentVersions, 1); assert.equal(hasActionableRecovery(), true)
})
test('malformed, damaged, dangling and ambiguous raw envelopes remain invalid and cannot be resolved', async () => {
  for (const value of [{ raw: '{' }, { raw: JSON.stringify(original), local: original }, { raw: JSON.stringify({ songs: [], setlists: [{ id: 'bad', name: 'Bad', songs: [{ id: 'absent', title: 'Absent' }] }] }) }, null, []]) {
    archive('replacement:1', value)
    const before = bytes()
    assert.equal(inspectRecovery().invalid, true); assert.equal(hasActionableRecovery(), true)
    await assert.rejects(choose(), /invalid/); assert.deepEqual(bytes(), before)
  }
})
test('pending legacy journal or envelope and conflicting access settings cannot receive keep-current choices', async () => {
  for (const value of [{ local: original, remote: null, journal: { pending: {} } }, { ...original, allowedUsers: ['other'] }]) {
    archive('download:1', value)
    assert.equal(inspectRecovery().sources[0].canKeepCurrent, false)
    await assert.rejects(choose(), /Pending or unsupported/)
  }
  localStorage.removeItem('gtar_sync_recovery:download:1')
  localStorage.setItem('gtar_sync_v1:old', JSON.stringify({ version: 1, pending: {}, baseline: original }))
  await assert.rejects(choose(), /Pending or unsupported/)
})
test('explicit keep-current preserves every byte and baseline, survives new library additions, and is reversible', async () => {
  archive('download:1', { songs: [song('missing')], setlists: [] })
  const before = bytes()
  await choose()
  for (const [key, value] of Object.entries(before)) assert.equal(localStorage.getItem(key), value)
  const decision = JSON.parse(localStorage.getItem(RECOVERY_DECISIONS_KEY)).decisions[0]
  assert.equal(decision.libraryRaw, before[LIBRARY_KEY]); assert.equal(decision.sources['gtar_sync_recovery:download:1'], before['gtar_sync_recovery:download:1'])
  assert.equal(hasActionableRecovery(), false)
  localStorage.setItem(LIBRARY_KEY, JSON.stringify({ ...original, songs: [...original.songs, song('new')] }))
  assert.equal(hasActionableRecovery(), false)
  await choose(inspectRecovery(), 'reopen')
  assert.equal(hasActionableRecovery(), true)
  assert.equal(JSON.parse(localStorage.getItem(RECOVERY_DECISIONS_KEY)).decisions.length, 2)
  assert.equal(recoveryData()[RECOVERY_DECISIONS_KEY], localStorage.getItem(RECOVERY_DECISIONS_KEY))
})
test('decision applies to exact reviewed source bytes only; new/changed archives and invalid decision logs block', async () => {
  archive('download:1', { songs: [song('missing')], setlists: [] }); await choose()
  archive('download:1', { songs: [song('missing', { rawContent: 'new revision' })], setlists: [] })
  assert.equal(hasActionableRecovery(), true)
  archive('download:2', { raw: 'invalid' }); assert.equal(inspectRecovery().invalid, true)
  localStorage.setItem(RECOVERY_DECISIONS_KEY, '{'); assert.equal(hasActionableRecovery(), true)
  assert.equal(inspectRecovery().sources.length, 2)
})
test('stale source/library/decision previews, editor/cross-tab protection and unavailable lock reject without writes', async () => {
  archive('download:1', { songs: [song('missing')], setlists: [] })
  for (const key of [LIBRARY_KEY, 'gtar_sync_recovery:download:1']) {
    const review = inspectRecovery(); localStorage.setItem(key, localStorage.getItem(key) + ' ')
    const before = bytes(); await assert.rejects(choose(review), /changed/); assert.deepEqual(bytes(), before)
  }
  const before = bytes(); await assert.rejects(choose(inspectRecovery(), 'keep-current', () => true), /editor edits/); assert.deepEqual(bytes(), before)
  navigator.locks.request = async (_, options, callback) => callback(null)
  await assert.rejects(choose(), /cross-tab/); assert.deepEqual(bytes(), before)
  navigator.locks = undefined; await assert.rejects(choose(), /Web Locks/)
})
test('quota failure preserves sources and leaves recovery blocking', async () => {
  archive('download:1', { songs: [song('missing')], setlists: [] })
  const before = bytes(), originalSet = dom.window.Storage.prototype.setItem
  dom.window.Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
  try { await assert.rejects(choose(), /Not enough browser storage/); assert.deepEqual(bytes(), before); assert.equal(hasActionableRecovery(), true) }
  finally { dom.window.Storage.prototype.setItem = originalSet }
})
test('review/cancel is read-only, private charts omitted, approval required and explicit choice can be reopened', async () => {
  archive('download:1', { songs: [song('missing')], setlists: [] })
  const before = bytes()
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(RecoveryReviewDialog, { blocked: () => false, onClose() {} })))
  const click = async text => act(async () => { const button = [...document.querySelectorAll('button')].find(button => button.textContent === text); assert.ok(button, text); button.click() })
  assert.match(document.body.textContent, /1 distinct missing records/); assert.doesNotMatch(document.body.textContent, /private chart/)
  await click('Choose current library'); assert.equal([...document.querySelectorAll('button')].find(button => button.textContent === 'Confirm recovery choice').disabled, true)
  await click('Cancel recovery choice'); assert.deepEqual(bytes(), before)
  await click('Choose current library'); await act(async () => document.querySelector('input[type=checkbox]').click()); await click('Confirm recovery choice')
  assert.equal(hasActionableRecovery(), false)
  await click('Reopen recovery conflicts'); await act(async () => document.querySelector('input[type=checkbox]').click()); await click('Confirm recovery choice')
  assert.equal(hasActionableRecovery(), true)
})

test('concurrent decision changes reject stale approval and read-back failure cannot report success', async () => {
  archive('download:1', { songs: [song('missing')], setlists: [] })
  const stale = inspectRecovery(); await choose()
  const before = bytes()
  await assert.rejects(choose(stale), /changed/); assert.deepEqual(bytes(), before)
  await choose(inspectRecovery(), 'reopen')
  const review = inspectRecovery(), savedGet = localStorage.getItem.bind(localStorage)
  let wrote = false
  const adapter = {
    get length() { return localStorage.length }, key: index => localStorage.key(index),
    getItem: key => wrote && key === RECOVERY_DECISIONS_KEY ? 'unverified' : savedGet(key),
    setItem: (key, value) => { localStorage.setItem(key, value); wrote = true },
  }
  await assert.rejects(recordRecoveryChoice(review, 'keep-current', () => false, adapter), /could not be verified/)
  assert.equal(savedGet(LIBRARY_KEY), review.libraryRaw)
  assert.equal(savedGet('gtar_sync_recovery:download:1'), review.sources[0].raw)
})

test('valid divergent raw envelope protects historical content, including tombstones', () => {
  archive('replacement:1', { raw: JSON.stringify({ songs: [song('current', { isDeleted: true })], setlists: [] }) })
  const review = inspectRecovery()
  assert.equal(review.invalid, false); assert.equal(review.divergentVersions, 1)
  assert.equal(hasActionableRecovery(), true)
})

test('startup legacy retirement cannot undo an explicit keep-current choice or remove its sources', async () => {
  const { performStorageHousekeeping } = require('../src/utils/syncJournal.ts')
  localStorage.setItem('gtar_sync_v1:old', JSON.stringify({ version: 1, baseline: { songs: [song('missing')], setlists: [] } }))
  await choose()
  const before = bytes()
  assert.equal(performStorageHousekeeping(), false)
  assert.deepEqual(bytes(), before)
  assert.equal(hasActionableRecovery(), false)
})
