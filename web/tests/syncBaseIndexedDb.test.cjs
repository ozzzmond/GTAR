// #189 (RFC #188 S1): slim cloud sync base with chart bodies in IndexedDB; base-write failures are reported.
const { bindOwner } = require('./helpers/libraryOwner.cjs')
const { test, beforeEach } = require('node:test')
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
const { makeLibrary } = require('./helpers/syntheticSongbook.cjs')
const journal = require('../src/utils/syncJournal.ts')
const index = require('../src/utils/libraryIndex.ts')
const bodies = require('../src/utils/libraryBodyStore.ts')
const BASE = bodies.CLOUD_SYNC_BASE_STORAGE_KEY
const flush = () => new Promise(resolve => setTimeout(resolve, 10))
let factory
const newTab = () => { index.forgetLibraryBodies(); index.setLibraryBodyBackend(bodies.libraryBodyBackend({ indexedDBFactory: factory })) }
beforeEach(() => { localStorage.clear(); bindOwner(localStorage, 'user-a'); factory = new MockIDBFactory(); newTab() })
const seed = (n = 12) => { journal.persistLibrary(makeLibrary(n, 2, { chars: 2500 }), localStorage); return journal.readPersistedLibrary(localStorage) }
const b1On = async () => { seed(); await journal.enableLibraryIndex(localStorage); return journal.readPersistedLibrary(localStorage) }

test('shadow cleanup keeps bodies that only the sync base still references', async () => {
  const lib = await b1On()
  localStorage.setItem(BASE, JSON.stringify(index.encodeLibraryIndex(lib)))
  const oldBody = lib.songs[0].rawContent
  const edited = { ...lib, songs: lib.songs.map((s, i) => i === 0 ? { ...s, rawContent: 'replaced chart' } : s) }
  journal.persistLibrary(edited, localStorage, { expectedRaw: journal.libraryRevision(localStorage) })
  await flush()
  const store = bodies.libraryBodyBackend({ indexedDBFactory: factory })
  await store.store(['truly orphaned body'])
  journal.disableLibraryIndex(localStorage)
  localStorage.removeItem('gtar_library_v1_retired')
  const plan = await bodies.inspectShadowCleanup(localStorage, { indexedDBFactory: factory })
  const orphanHashes = new Set(plan.records.map(r => r.hash))
  assert.equal(orphanHashes.has(await bodies.bodyHash(oldBody)), false, 'base body protected')
  assert.equal(orphanHashes.has(await bodies.bodyHash('truly orphaned body')), true)
})
