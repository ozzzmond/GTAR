// #204 S1: debug logs in IndexedDB — more than 30 entries survive a reload, 12 h / 10 MB retention, legacy move, clear, export.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('', { url: 'https://dev.gtar-web.pages.dev' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage })
const { MockIDBFactory } = require('./helpers/mockIdb.cjs')
const store = require('../src/utils/debugLogStore.ts')
const loggerModule = require('../src/utils/logger.ts')

const entry = (i, ageMs = 0, size = 10) => ({ id: `e${i}`, timestamp: new Date(Date.now() - ageMs).toISOString(), level: 'INFO', tag: 'T', message: 'x'.repeat(size) })
const fresh = () => {
  // A new engine instance, as after a page reload.
  const Engine = loggerModule.appLogger.constructor
  return new Engine()
}

test('retention keeps newest 20 total with no age or byte expiry', () => {
  const all = Array.from({ length: 25 }, (_, i) => entry(i, (25-i)*86400e3))
  all[24].message = 'x'.repeat(11 * 1024 * 1024)
  const { keep, drop } = store.applyLogRetention(all)
  assert.equal(keep.length, 20)
  assert.equal(keep[0].id, 'e5')
  assert.equal(keep[19].id, 'e24')
  assert.deepEqual(drop, ['e0','e1','e2','e3','e4'])
})

test('logs move from localStorage to IndexedDB, newest 20 survive a reload, export includes them all', async () => {
  localStorage.clear()
  localStorage.setItem(loggerModule.STORAGE_KEY, JSON.stringify([entry('legacy', 1000)]))
  const factory = new MockIDBFactory()
  const a = fresh()
  a.resume()
  assert.equal(await a.attachStore(store.debugLogBackend(factory)), true)
  assert.equal(localStorage.getItem(loggerModule.STORAGE_KEY), null, 'old localStorage copy removed')
  for (let i = 0; i < 25; i++) a.warn('Test', `line ${i}`)
  await new Promise(r => setTimeout(r, 600))
  await a.flush()
  const b = fresh() // reload
  b.resume()
  await b.attachStore(store.debugLogBackend(factory))
  const all = await b.getAllLogs()
  assert.equal(all.length, 20)
  assert.ok(!all.some(e => e.id === 'elegacy'))
  const text = await b.exportAllLogsAsText()
  assert.doesNotMatch(text, /line 0\r/)
  assert.match(text, /line 24/)
  b.clearLogs()
  await new Promise(r => setTimeout(r, 10))
  const c = fresh(); c.resume(); await c.attachStore(store.debugLogBackend(factory))
  assert.equal((await c.getAllLogs()).filter(e => /line \d+/.test(e.message)).length, 0, 'clear removes stored logs')
})

test('entries older than 12 h survive from the store on the next start', async () => {
  localStorage.clear()
  const factory = new MockIDBFactory()
  const backend = store.debugLogBackend(factory)
  await backend.write([entry('old', 13 * 3600e3), entry('new', 1000)], [])
  const a = fresh(); a.resume(); await a.attachStore(backend)
  const ids = (await backend.loadAll()).map(e => e.id)
  assert.ok(ids.includes('enew') && ids.includes('eold'))
})

test('without IndexedDB the logger keeps the localStorage fallback', async () => {
  localStorage.clear()
  const a = fresh(); a.resume()
  const broken = { loadAll: async () => { throw new Error('IndexedDB is not available') }, write: async () => {} }
  assert.equal(await a.attachStore(broken), false)
  a.warn('T', 'fallback line')
  assert.match(localStorage.getItem(loggerModule.STORAGE_KEY), /fallback line/)
})

test('fallback startup and mixed-level inserts keep 20, including old entries', async () => {
  localStorage.clear()
  const old = Array.from({ length: 25 }, (_, i) => entry(i, (25-i)*86400e3))
  localStorage.setItem(loggerModule.STORAGE_KEY, JSON.stringify(old))
  const a = fresh(); a.resume()
  assert.equal(a.getLogs().length, 20)
  assert.equal(JSON.parse(localStorage.getItem(loggerModule.STORAGE_KEY)).length, 20)
  a.clearLogs()
  for (let i = 0; i < 25; i++) {
    if (i % 2) a.info('BackupSaved', `event ${i}`)
    else a.warn('Test', `event ${i}`)
  }
  assert.equal(a.getLogs().length, 20)
  assert.equal(a.getLogs()[0].message, 'event 5')
  assert.equal(JSON.parse(localStorage.getItem(loggerModule.STORAGE_KEY)).length, 20)
})

test('read prunes an oversized IndexedDB store without age expiry', async () => {
  localStorage.clear()
  const backend = store.debugLogBackend(new MockIDBFactory())
  const a = fresh(); a.resume(); await a.attachStore(backend)
  a.clearLogs(); await a.flush()
  await backend.write(Array.from({ length: 25 }, (_, i) => entry(i, (25-i)*86400e3)), [])
  const logs = await a.getAllLogs()
  assert.equal(logs.length, 20)
  assert.equal(logs[0].id, 'e5')
  assert.equal((await backend.loadAll()).length, 20)
})

test('fallback read prunes disk entries added since startup', () => {
  localStorage.clear()
  const a = fresh(); a.resume()
  localStorage.setItem(loggerModule.STORAGE_KEY, JSON.stringify(Array.from({ length: 25 }, (_, i) => entry(i))))
  a.getLogs()
  assert.equal(JSON.parse(localStorage.getItem(loggerModule.STORAGE_KEY)).length, 20)
})

test('Clear during an in-flight flush cannot resurrect logs', async () => {
  localStorage.clear()
  const backend = store.debugLogBackend(new MockIDBFactory())
  let release
  let entered
  const started = new Promise(resolve => { entered = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  let pause = false
  const delayed = {
    loadAll: () => backend.loadAll(),
    write: async (put, drop) => {
      if (pause && put.length) { entered(); await blocked }
      await backend.write(put, drop)
    },
  }
  const a = fresh(); a.resume(); await a.attachStore(delayed)
  pause = true
  a.warn('Test', 'queued before Clear')
  const flushing = a.flush()
  await started
  a.clearLogs()
  release()
  await flushing; await a.flush()
  assert.deepEqual(await a.getAllLogs(), [])
  assert.deepEqual(await backend.loadAll(), [])
})
