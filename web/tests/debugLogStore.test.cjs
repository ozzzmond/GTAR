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

test('retention keeps the newest entries within 12 h and the byte cap, oldest dropped first', () => {
  const now = Date.now()
  const all = [entry(1, 13 * 3600e3), entry(2, 2000), entry(3, 1000), entry(4, 0)]
  const { keep, drop } = store.applyLogRetention(all, now, store.entryBytes(entry(0)) * 2 + 4)
  assert.deepEqual(keep.map(e => e.id), ['e3', 'e4'])
  assert.deepEqual(drop.sort(), ['e1', 'e2'])
})

test('logs move from localStorage to IndexedDB, more than 30 survive a reload, export includes them all', async () => {
  localStorage.clear()
  loggerModule.setDebugLoggingEnabled(true)
  localStorage.setItem(loggerModule.STORAGE_KEY, JSON.stringify([entry('legacy', 1000)]))
  const factory = new MockIDBFactory()
  const a = fresh()
  a.resume()
  assert.equal(await a.attachStore(store.debugLogBackend(factory)), true)
  assert.equal(localStorage.getItem(loggerModule.STORAGE_KEY), null, 'old localStorage copy removed')
  for (let i = 0; i < 120; i++) a.info('Test', `line ${i}`)
  await new Promise(r => setTimeout(r, 600))
  await a.flush()
  const b = fresh() // reload
  b.resume()
  await b.attachStore(store.debugLogBackend(factory))
  const all = await b.getAllLogs()
  assert.ok(all.length >= 121, `kept ${all.length}`)
  assert.ok(all.some(e => e.id === 'elegacy'))
  const text = await b.exportAllLogsAsText()
  assert.match(text, /line 0/)
  assert.match(text, /line 119/)
  b.clearLogs()
  await new Promise(r => setTimeout(r, 10))
  const c = fresh(); c.resume(); await c.attachStore(store.debugLogBackend(factory))
  assert.equal((await c.getAllLogs()).filter(e => /line \d+/.test(e.message)).length, 0, 'clear removes stored logs')
  loggerModule.setDebugLoggingEnabled(false)
})

test('entries older than 12 h are deleted from the store on the next start', async () => {
  localStorage.clear()
  const factory = new MockIDBFactory()
  const backend = store.debugLogBackend(factory)
  await backend.write([entry('old', 13 * 3600e3), entry('new', 1000)], [])
  const a = fresh(); a.resume(); await a.attachStore(backend)
  const ids = (await backend.loadAll()).map(e => e.id)
  assert.ok(ids.includes('enew') && !ids.includes('eold'))
})

test('without IndexedDB the logger keeps the localStorage fallback', async () => {
  localStorage.clear()
  loggerModule.setDebugLoggingEnabled(true)
  const a = fresh(); a.resume()
  const broken = { loadAll: async () => { throw new Error('IndexedDB is not available') }, write: async () => {} }
  assert.equal(await a.attachStore(broken), false)
  a.warn('T', 'fallback line')
  assert.match(localStorage.getItem(loggerModule.STORAGE_KEY), /fallback line/)
  loggerModule.setDebugLoggingEnabled(false)
})
