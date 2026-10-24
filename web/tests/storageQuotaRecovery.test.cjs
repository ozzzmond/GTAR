const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const api = require('../src/utils/syncJournal.ts')
const { recoverySourceDigest: digest } = require('../src/utils/recoverySourceDigest.ts')
const shadow = require('../src/utils/libraryBodyStore.ts')
const { MockIDBFactory } = require('./helpers/mockIdb.cjs')
const { appLogger } = require('../src/utils/logger.ts')
const song = (id, rawContent = 'chart') => ({ id, title: id, rawContent })
const lib = (body = 'chart') => ({ songs: [song('current', body)], setlists: [] })
let dom
beforeEach(() => {
  dom = new JSDOM('', { url: 'https://dev.gtar-web.pages.dev' })
  Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage })
  Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent: 'GTAR test', locks: { request: async (_, options, fn) => fn({}) } } })
  localStorage.setItem(api.LIBRARY_KEY, JSON.stringify(lib()))
})
afterEach(() => dom.window.close())
const add = (i, value = { songs: [song('historical')], setlists: [] }) => {
  const key = `gtar_sync_recovery:download:${1000 + i}`
  localStorage.setItem(key, JSON.stringify(value)); return key
}
const choose = () => api.recordRecoveryChoice(api.inspectRecovery(), 'keep-current', () => false)
const cleanup = (confirmed = true, blocked = () => false, review = api.inspectRecovery()) => api.confirmRecoveryCleanup(review, confirmed, blocked)

test('P1: exact digest decided archive prunes only after confirmation; undecided represented archive remains', async () => {
  const key = add(1); await choose()
  const undecided = add(2, lib())
  const before = api.recoveryData()
  await assert.rejects(cleanup(false), /confirmation/)
  await assert.rejects(cleanup(true, () => true), /editor/)
  assert.deepEqual(api.recoveryData(), before)
  assert.deepEqual(api.planRecoveryCleanup(api.inspectRecovery()).map(x => x.key), [key])
  await cleanup()
  assert.equal(localStorage.getItem(key), null)
  assert.equal(localStorage.getItem(undecided), before[undecided])
  assert.equal(localStorage.getItem(api.LIBRARY_KEY), before[api.LIBRARY_KEY])
})
test('P1: changed same-length bytes retain archive and warn; stale review and reopened decision cannot prune', async () => {
  const key = add(1); await choose()
  const review = api.inspectRecovery(), raw = localStorage.getItem(key)
  localStorage.setItem(key, raw.replace('chart', 'CHART'))
  const warnings = [], saved = appLogger.warn
  appLogger.warn = (...args) => warnings.push(args)
  try {
    assert.deepEqual(api.planRecoveryCleanup(api.inspectRecovery()), [])
    await assert.rejects(cleanup(true, () => false, review), /changed/)
    await cleanup()
    assert.notEqual(localStorage.getItem(key), null)
    assert.ok(warnings.some(args => /Digest mismatch/.test(args[1])))
  } finally { appLogger.warn = saved }
  localStorage.setItem(key, raw)
  await api.recordRecoveryChoice(api.inspectRecovery(), 'reopen', () => false)
  assert.deepEqual(api.planRecoveryCleanup(api.inspectRecovery()), [])
})
test('P2: new decisions have fixed-size library metadata; legacy V2 baseline survives until confirmed compaction', async () => {
  const key = add(1); await choose()
  const first = JSON.parse(localStorage.getItem(api.RECOVERY_DECISIONS_KEY)).decisions[0]
  assert.equal(first.libraryRaw, undefined)
  localStorage.setItem(api.LIBRARY_KEY, JSON.stringify(lib('x'.repeat(250000))))
  await api.recordRecoveryChoice(api.inspectRecovery(), 'reopen', () => false)
  const second = JSON.parse(localStorage.getItem(api.RECOVERY_DECISIONS_KEY)).decisions[1]
  assert.ok(Math.abs(JSON.stringify(first).length - JSON.stringify(second).length) < 20)
  const raw = localStorage.getItem(key)
  const legacy = JSON.stringify({ version: 2, legacyV1Raw: null, decisions: [{ choice: 'keep-current', libraryRaw: localStorage.getItem(api.LIBRARY_KEY), sources: { [key]: { sourceKey: key, rawLength: raw.length, digest: digest(raw) } } }] })
  localStorage.setItem(api.RECOVERY_DECISIONS_KEY, legacy)
  assert.equal(api.inspectRecovery().invalid, false)
  assert.equal(api.recoveryData()[api.RECOVERY_DECISIONS_KEY], legacy)
  await api.recordRecoveryChoice(api.inspectRecovery(), 'reopen', () => false)
  assert.equal(JSON.parse(localStorage.getItem(api.RECOVERY_DECISIONS_KEY)).legacyRaw, legacy)
  await cleanup()
  const compact = localStorage.getItem(api.RECOVERY_DECISIONS_KEY)
  assert.equal(JSON.parse(compact).legacyRaw, null)
  assert.ok(compact.length < 1500)
  assert.notEqual(localStorage.getItem(key), null) // reopened, never prune
})
test('P5: eight archives + full V2 decision free bytes after confirmed prune; bounded-quota download snapshot then fits', async () => {
  const fieldLibrary = { songs: Array.from({ length: 146 }, (_, i) => song('song-' + i)),
    setlists: Array.from({ length: 24 }, (_, i) => ({ id: 'list-' + i, name: 'Set ' + i, songs: [{ id: 'song-0', title: 'song-0' }] })) }
  const baseLength = JSON.stringify(fieldLibrary).length
  fieldLibrary.songs[0].rawContent += 'x'.repeat(253000 - baseLength)
  localStorage.setItem(api.LIBRARY_KEY, JSON.stringify(fieldLibrary))
  assert.equal(JSON.parse(localStorage.getItem(api.LIBRARY_KEY)).songs.length, 146)
  assert.equal(JSON.parse(localStorage.getItem(api.LIBRARY_KEY)).setlists.length, 24)
  const sources = {}
  for (let i = 0; i < 7; i++) {
    const key = add(i, { songs: [song('historical', 'z'.repeat(231000) + i)], setlists: [] }), raw = localStorage.getItem(key)
    sources[key] = { sourceKey: key, rawLength: raw.length, digest: digest(raw) }
  }
  const undecided = add(8, { songs: [song('undecided', 'u'.repeat(179000))], setlists: [] })
  localStorage.setItem(api.RECOVERY_DECISIONS_KEY, JSON.stringify({ version: 2, legacyV1Raw: null, decisions: [{ choice: 'keep-current', libraryRaw: localStorage.getItem(api.LIBRARY_KEY), sources }] }))
  const before = api.localStorageBytes(localStorage), original = localStorage.getItem(api.LIBRARY_KEY), undecidedRaw = localStorage.getItem(undecided)
  assert.equal(api.planRecoveryCleanup(api.inspectRecovery()).length, 7)
  await assert.rejects(api.writeRecoverySnapshot('gtar_sync_recovery:download:new', original, localStorage), /retention/)
  await cleanup()
  assert.equal(localStorage.getItem(undecided), undecidedRaw)
  assert.equal(localStorage.getItem(api.LIBRARY_KEY), original)
  const after = api.localStorageBytes(localStorage)
  assert.ok(before - after > 3 * 1024 * 1024)
  const budget = before + 100
  const storage = {
    get length() { return localStorage.length }, key: i => localStorage.key(i), getItem: k => localStorage.getItem(k),
    setItem(k, v) { if (api.localStorageBytes(localStorage) + 2 * (k.length + v.length) > budget) throw new DOMException('full', 'QuotaExceededError'); localStorage.setItem(k, v) },
  }
  await api.writeRecoverySnapshot('gtar_sync_recovery:download:new', original, storage)
  assert.equal(storage.getItem('gtar_sync_recovery:download:new'), original)
})
test('retention cap blocks new snapshots without deleting undecided; advisory estimate rejection logs error', async () => {
  for (let i = 0; i < api.RECOVERY_MAX_COUNT; i++) add(i, lib())
  await assert.rejects(api.writeRecoverySnapshot('gtar_sync_recovery:download:new', '{}', localStorage), /retention/)
  assert.equal(api.inspectRecovery().sources.length, api.RECOVERY_MAX_COUNT)
  localStorage.clear(); navigator.storage = { estimate: async () => ({ usage: 10, quota: 11 }) }
  const errors = [], saved = appLogger.error
  appLogger.error = (...args) => errors.push(args)
  try {
    await assert.rejects(api.writeRecoverySnapshot('gtar_sync_recovery:download:new', '{}', localStorage), /quota/)
    assert.equal(errors.length, 1)
    const details = JSON.parse(errors[0][3]); assert.equal(details.totalUsedBytes, 0); assert.ok(details.attemptedBytes > 0)
  } finally { appLogger.error = saved }
})
test('shadow edits retain superseded bodies; reviewed cleanup protects current AND historical bodies and refuses stale/editor previews', async () => {
  const factory = new MockIDBFactory(), options = { indexedDBFactory: factory }
  await shadow.shadowWriteBodies(lib('orphan'), options)
  await shadow.shadowWriteBodies(lib('old'), options)
  localStorage.setItem(api.LIBRARY_KEY, JSON.stringify(lib('new')))
  add(1, lib('old'))
  await shadow.shadowWriteBodies(lib('new'), options)
  const plan = await shadow.inspectShadowCleanup(localStorage, options)
  assert.equal(plan.totalCount, 3); assert.equal(plan.records.length, 1); assert.ok(plan.totalBytes > plan.orphanBytes)
  assert.equal(plan.records[0].body, 'orphan')
  await assert.rejects(shadow.confirmShadowCleanup(plan, false, () => false, localStorage, options), /confirmation/)
  await assert.rejects(shadow.confirmShadowCleanup(plan, true, () => true, localStorage, options), /editor/)
  localStorage.setItem(api.LIBRARY_KEY, JSON.stringify(lib('changed')))
  await assert.rejects(shadow.confirmShadowCleanup(plan, true, () => false, localStorage, options), /changed/)
  localStorage.setItem(api.LIBRARY_KEY, JSON.stringify(lib('new')))
  await shadow.confirmShadowCleanup(plan, true, () => false, localStorage, options)
  const after = await shadow.inspectShadowCleanup(localStorage, options)
  assert.equal(after.totalCount, 2); assert.equal(after.records.length, 0)
  assert.equal((await shadow.verifyShadowBodies(lib('new'), options)).missing, 0)
})
test('P4: hosted DEV production-mode bundle logger uses development; production and local build envs remain correct', () => {
  const script = `const fs=require('node:fs'),ts=require('typescript');require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8').replaceAll('import.meta.env',process.env.BUILD_ENV),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);global.window={location:{hostname:process.env.HOST},addEventListener:()=>{}};global.navigator={userAgent:'test'};const logger=require('./src/utils/logger.ts').appLogger;logger.resume();process.stdout.write(JSON.stringify({dev:require('./src/utils/env.ts').isDevEnv,header:logger.exportLogsAsText(),init:logger.getLogs().find(l=>l.tag==='WebLogger')?.message}));`
  const { execFileSync } = require('node:child_process')
  for (const [host, env, expected] of [['dev.gtar-web.pages.dev','{DEV:false}',true], ['gtar-web.pages.dev','{DEV:false}',false], ['localhost','{DEV:true}',true]]) {
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env, HOST: host, BUILD_ENV: env } }).toString())
    assert.equal(result.dev, expected)
    assert.match(result.header, new RegExp('Environment: ' + (expected ? 'development' : 'production')))
    // The "Logger initialized" INFO line is recorded only with debug logging on (owner, 2026-10-24).
    if (result.init !== undefined) assert.match(result.init, new RegExp('Environment: ' + (expected ? 'development' : 'production')))
  }
  const code = fs.readFileSync(require.resolve('../src/utils/logger.ts'), 'utf8')
  assert.equal(code.match(/Environment: \$\{isDevEnv \?/g).length, 2)
})

test('represented archives can be explicitly reviewed before pruning; decision compaction failure deletes nothing', async () => {
  const key = add(1, lib())
  await choose()
  assert.equal(api.planRecoveryCleanup(api.inspectRecovery()).length, 1)
  const before = api.recoveryData(), set = dom.window.Storage.prototype.setItem
  dom.window.Storage.prototype.setItem = function(k, v) { if (k === api.RECOVERY_DECISIONS_KEY) throw new DOMException('full', 'QuotaExceededError'); return set.call(this, k, v) }
  try { await assert.rejects(cleanup(), /full/); assert.deepEqual(api.recoveryData(), before) }
  finally { dom.window.Storage.prototype.setItem = set }
  await cleanup(); assert.equal(localStorage.getItem(key), null)
})
test('review UI requires separate checked confirmation for archive cleanup and reports backend sizes', async () => {
  const React = require('react'), { act } = React, { createRoot } = require('react-dom/client')
  const { RecoveryReviewDialog } = require('../src/components/RecoveryReviewDialog.tsx')
  global.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true }
  document.body.innerHTML = '<div id="root"></div>'
  const key = add(1); await choose()
  const root = createRoot(document.getElementById('root'))
  const click = selector => act(async () => document.querySelector(selector).click())
  try {
    await act(async () => root.render(React.createElement(RecoveryReviewDialog, { blocked: () => false, onClose: () => {} })))
    assert.match(document.body.textContent, /localStorage gtar_library_v1/)
    assert.match(document.body.textContent, /gtar_recovery_decisions_v1/)
    await click('[data-testid="review-cleanup-btn"]')
    assert.equal(document.querySelector('[data-testid="confirm-recovery-choice-btn"]').disabled, true)
    assert.match(document.body.textContent, /SHA-256 still matches/)
    await click('[data-testid="cancel-recovery-choice-btn"]')
    assert.notEqual(localStorage.getItem(key), null)
    await click('[data-testid="review-cleanup-btn"]')
    await click('input[type="checkbox"]')
    await click('[data-testid="confirm-recovery-choice-btn"]')
    assert.equal(localStorage.getItem(key), null)
  } finally { await act(async () => root.unmount()) }
})

test('pending archive operations remain protected even if an old record claims keep-current with an exact digest', async () => {
  const key = add(1, { local: lib(), remote: null, journal: { pending: {} } }), raw = localStorage.getItem(key)
  localStorage.setItem(api.RECOVERY_DECISIONS_KEY, JSON.stringify({ version: 2, legacyV1Raw: null, decisions: [{
    choice: 'keep-current', libraryRaw: localStorage.getItem(api.LIBRARY_KEY), sources: { [key]: { sourceKey: key, rawLength: raw.length, digest: digest(raw) } },
  }] }))
  assert.deepEqual(api.planRecoveryCleanup(api.inspectRecovery()), [])
  await cleanup()
  assert.equal(localStorage.getItem(key), raw)
})
