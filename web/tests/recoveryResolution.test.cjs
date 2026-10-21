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
const { recoverySourceDigest } = require('../src/utils/recoverySourceDigest.ts')
const { createHash } = require('node:crypto')
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
  assert.equal(decision.libraryRaw, before[LIBRARY_KEY])
  assert.deepEqual(decision.sources['gtar_sync_recovery:download:1'], {
    sourceKey: 'gtar_sync_recovery:download:1', rawLength: before['gtar_sync_recovery:download:1'].length,
    digest: recoverySourceDigest(before['gtar_sync_recovery:download:1']),
  })
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

test('SHA-256 UTF-16LE agrees with independent crypto across padding, Unicode and cache eviction', () => {
  const values = ['', 'abc', 'é', 'e\u0301', '🎸\r\n\t ', '\ud800', '\ud801', '\udc00', '\ufffd',
    ...[27, 28, 31, 32, 33, 59, 60, 63, 64, 65, 1000, 524289].map(n => 'x'.repeat(n))]
  for (const value of [...values, ...values.slice().reverse()]) {
    assert.equal(recoverySourceDigest(value), 'sha256-utf16le:' + createHash('sha256').update(Buffer.from(value, 'utf16le')).digest('hex'))
  }
  assert.notEqual(recoverySourceDigest('\ud800'), recoverySourceDigest('\ufffd'))
})

test('V1 history remains verbatim in V2, including sources no longer present and prior library snapshots', async () => {
  const key = 'gtar_sync_recovery:download:1', raw = JSON.stringify({ songs: [song('missing')], setlists: [] })
  localStorage.setItem(key, raw)
  const oldLibrary = JSON.stringify({ songs: [song('historical-library')], setlists: [] })
  const historical = { choice: 'keep-current', libraryRaw: oldLibrary, sources: { [key]: raw, 'gtar_sync_recovery:lost:1': 'only historical copy' } }
  const v1 = JSON.stringify({ version: 1, decisions: [historical] }, null, 3) + '\n'
  localStorage.setItem(RECOVERY_DECISIONS_KEY, v1)
  assert.equal(hasActionableRecovery(), false)
  await choose(inspectRecovery(), 'reopen')
  let value = JSON.parse(localStorage.getItem(RECOVERY_DECISIONS_KEY))
  assert.equal(value.version, 2); assert.equal(value.legacyV1Raw, v1)
  assert.deepEqual(JSON.parse(value.legacyV1Raw).decisions[0], historical)
  assert.equal(hasActionableRecovery(), true)
  await choose()
  value = JSON.parse(localStorage.getItem(RECOVERY_DECISIONS_KEY))
  assert.equal(value.legacyV1Raw, v1); assert.equal(value.decisions.length, 2)
  assert.equal(recoveryData()[key], raw)
  assert.equal(JSON.parse(recoveryData()[RECOVERY_DECISIONS_KEY]).legacyV1Raw, v1)
})

test('compact decision fits a byte budget that rejects archive duplication and exports every original source', async () => {
  for (let i = 0; i < 15; i++) archive(`download:${i}`, { songs: [song('missing', { rawContent: 'private historical chart '.repeat(1000) + i })], setlists: [] })
  archive('represented:1', original); archive('represented:2', original)
  const before = bytes(), review = inspectRecovery()
  const oldPayload = JSON.stringify({ version: 1, decisions: [{ choice: 'keep-current', libraryRaw: review.libraryRaw,
    sources: Object.fromEntries(review.sources.filter(s => s.status === 'actionable').map(s => [s.key, s.raw])) }] })
  const used = Object.entries(before).reduce((sum, [k, v]) => sum + 2 * (k.length + v.length), 0)
  const budget = used + 14000
  let writes = 0
  const adapter = {
    get length() { return localStorage.length }, key: i => localStorage.key(i), getItem: k => localStorage.getItem(k),
    setItem(k, v) {
      const next = used + 2 * (k.length + v.length)
      if (next > budget) throw new DOMException('full', 'QuotaExceededError')
      writes++; localStorage.setItem(k, v)
    },
  }
  assert.throws(() => adapter.setItem(RECOVERY_DECISIONS_KEY, oldPayload), /full/)
  await recordRecoveryChoice(review, 'keep-current', () => false, adapter)
  assert.equal(writes, 1); assert.equal(hasActionableRecovery(), false)
  const compact = localStorage.getItem(RECOVERY_DECISIONS_KEY)
  assert.ok(compact.length < oldPayload.length / 20)
  for (const [key, raw] of Object.entries(before)) assert.equal(recoveryData()[key], raw)
  assert.equal(compact.includes('private historical chart'), false)
})

test('fresh module and storage reload preserve compact approval, snapshots and repeated keep/reopen semantics', async () => {
  archive('download:1', { songs: [song('missing')], setlists: [] })
  const baseline = localStorage.getItem(LIBRARY_KEY)
  for (let i = 0; i < 3; i++) { await choose(); assert.equal(hasActionableRecovery(), false); await choose(inspectRecovery(), 'reopen'); assert.equal(hasActionableRecovery(), true) }
  await choose()
  localStorage.setItem(LIBRARY_KEY, JSON.stringify({ ...original, songs: [...original.songs, song('new')] }))
  const saved = bytes(), reloaded = new JSDOM('', { url: 'https://gtar.test' })
  try {
    for (const [k, v] of Object.entries(saved)) reloaded.window.localStorage.setItem(k, v)
    delete require.cache[require.resolve('../src/utils/syncJournal.ts')]
    delete require.cache[require.resolve('../src/utils/recoverySourceDigest.ts')]
    const fresh = require('../src/utils/syncJournal.ts')
    assert.equal(fresh.hasActionableRecovery(reloaded.window.localStorage), false)
    const decisions = JSON.parse(saved[RECOVERY_DECISIONS_KEY]).decisions
    assert.equal(decisions.length, 7); assert.equal(decisions.every(d => d.libraryRaw === baseline), true)
    assert.deepEqual(fresh.recoveryData(reloaded.window.localStorage), saved)
  } finally { reloaded.window.close() }
})

test('exact source identity rejects whitespace, same-length content, Unicode and key changes', async () => {
  const key = 'gtar_sync_recovery:download:1'
  const raw = JSON.stringify({ songs: [song('missing', { rawContent: 'é🎸 A' })], setlists: [] })
  localStorage.setItem(key, raw); await choose()
  for (const changed of [raw + ' ', raw.replace(' A', ' B'), raw.replace('é', 'è'), raw.replace('é', 'e\u0301')]) {
    localStorage.setItem(key, changed); assert.equal(hasActionableRecovery(), true)
  }
  localStorage.setItem(key, raw); assert.equal(hasActionableRecovery(), false)
  localStorage.setItem('gtar_sync_recovery:download:2', raw)
  assert.equal(hasActionableRecovery(), true)
})

test('malformed V2 envelopes and source references fail closed without rewriting history', async () => {
  archive('download:1', { songs: [song('missing')], setlists: [] }); await choose()
  const valid = JSON.parse(localStorage.getItem(RECOVERY_DECISIONS_KEY)), key = 'gtar_sync_recovery:download:1'
  const variants = [v => { v.version = 3 }, v => { delete v.legacyV1Raw }, v => { v.legacyV1Raw = JSON.stringify(v) },
    v => { v.extra = true }, v => { v.decisions[0].extra = true },
    v => { v.decisions[0].sources[key] = 'raw' }, v => { v.decisions[0].sources[key].sourceKey = 'wrong' },
    v => { v.decisions[0].sources[key].rawLength = -1 }, v => { v.decisions[0].sources[key].rawLength = 1.5 },
    v => { v.decisions[0].sources[key].digest = 'weak' }, v => { v.decisions[0].sources[key].extra = true }]
  for (const mutate of variants) {
    const value = structuredClone(valid); mutate(value); localStorage.setItem(RECOVERY_DECISIONS_KEY, JSON.stringify(value))
    const before = bytes(); assert.equal(inspectRecovery().invalid, true); assert.equal(hasActionableRecovery(), true)
    await assert.rejects(choose(), /invalid/); assert.deepEqual(bytes(), before)
  }
})

test('quota at compact decision replacement preserves prior V2 history and leaves export available', async () => {
  archive('download:1', { songs: [song('missing')], setlists: [] }); await choose(); await choose(inspectRecovery(), 'reopen')
  const before = bytes(), set = dom.window.Storage.prototype.setItem
  dom.window.Storage.prototype.setItem = function(k, v) { if (k === RECOVERY_DECISIONS_KEY) throw new DOMException('full', 'QuotaExceededError'); return set.call(this, k, v) }
  try {
    await assert.rejects(choose(), /Not enough browser storage/)
    assert.deepEqual(bytes(), before); assert.equal(hasActionableRecovery(), true); assert.deepEqual(recoveryData(), before)
  } finally { dom.window.Storage.prototype.setItem = set }
})

test('readback mismatch preserves concurrent decisions without rollback or a success notification', async () => {
  archive('download:1', { songs: [song('missing')], setlists: [] })
  const concurrent = JSON.stringify({ version: 1, decisions: [] }), before = bytes()
  const set = dom.window.Storage.prototype.setItem
  let notifications = 0, writes = 0
  window.addEventListener('gtar-library-persisted', () => notifications++)
  dom.window.Storage.prototype.setItem = function(k, v) {
    writes++; set.call(this, k, v)
    if (k === RECOVERY_DECISIONS_KEY) set.call(this, k, concurrent)
  }
  try {
    await assert.rejects(choose(), /could not be verified/)
    assert.equal(writes, 1); assert.equal(notifications, 0); assert.equal(localStorage.getItem(RECOVERY_DECISIONS_KEY), concurrent)
    for (const [k, v] of Object.entries(before)) assert.equal(localStorage.getItem(k), v)
    assert.equal(hasActionableRecovery(), true)
  } finally { dom.window.Storage.prototype.setItem = set }
})

test('failed V1 upgrade preserves its exact stored value and UI keeps export available', async () => {
  archive('download:1', { songs: [song('missing')], setlists: [] })
  const v1 = '{ "version": 1, "decisions": [] }\n'
  localStorage.setItem(RECOVERY_DECISIONS_KEY, v1)
  const before = bytes(), proto = dom.window.Storage.prototype, set = proto.setItem
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(RecoveryReviewDialog, { blocked: () => false, onClose() {} })))
  const click = async text => act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === text).click())
  await click('Choose current library')
  assert.match(document.body.textContent, /snapshot of the current library and integrity references/)
  await act(async () => document.querySelector('input[type=checkbox]').click())
  proto.setItem = function(k, v) { if (k === RECOVERY_DECISIONS_KEY) throw new DOMException('full', 'QuotaExceededError'); return set.call(this, k, v) }
  try { await click('Confirm recovery choice') } finally { proto.setItem = set }
  assert.match(document.querySelector('[role=alert]').textContent, /Not enough browser storage/)
  assert.deepEqual(bytes(), before); assert.equal(hasActionableRecovery(), true)
  assert.equal([...document.querySelectorAll('button')].find(b => b.textContent === 'Export all recovery data').disabled, false)
  let exported, downloaded = false
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL, anchorClick = dom.window.HTMLAnchorElement.prototype.click
  URL.createObjectURL = blob => { exported = blob; return 'blob:recovery-export' }
  URL.revokeObjectURL = () => {}
  dom.window.HTMLAnchorElement.prototype.click = function () { downloaded = this.download === 'GTAR-storage-recovery.json' }
  try {
    await click('Export all recovery data')
    assert.equal(downloaded, true); assert.deepEqual(JSON.parse(await exported.text()), before)
    await click('Refresh review'); assert.equal(hasActionableRecovery(), true); assert.deepEqual(bytes(), before)
  } finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; dom.window.HTMLAnchorElement.prototype.click = anchorClick }
})
