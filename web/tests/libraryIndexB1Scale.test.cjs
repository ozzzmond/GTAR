// #171 B1: slim gtar_library_v2 index with chart bodies in IndexedDB (DEV toggle, off by default).
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
const { makeLibrary, QuotaStorage } = require('./helpers/syntheticSongbook.cjs')
const api = require('../src/utils/syncJournal.ts')
const index = require('../src/utils/libraryIndex.ts')
const bodies = require('../src/utils/libraryBodyStore.ts')

const V1 = api.LIBRARY_KEY, V2 = index.LIBRARY_V2_KEY, B1 = index.LIBRARY_B1_KEY
const bodiesOf = lib => lib.songs.map(song => song.rawContent)
let factory
/** Fresh tab: empty in-memory body cache, same localStorage and IndexedDB. */
const newTab = () => { index.forgetLibraryBodies(); index.setLibraryBodyBackend(bodies.libraryBodyBackend({ indexedDBFactory: factory })) }
beforeEach(() => { localStorage.clear(); factory = new MockIDBFactory(); newTab() })
const seed = (n = 20, chars = 600) => { const lib = makeLibrary(n, Math.min(n, 5), { chars }); api.persistLibrary(lib, localStorage); return api.readPersistedLibrary(localStorage) }



test('5,000 songs: encode/decode is byte-identical with every body cached (no IndexedDB)', () => {
  const lib = makeLibrary(5000, 0, { chars: 1200 })
  index.rememberLibraryBodies(lib.songs.map((song, i) => [`sha256:${i}`, song.rawContent]))
  const { payload, pending } = index.encodeLibraryIndex(lib)
  assert.equal(pending.length, 0)
  assert.deepEqual(bodiesOf(index.decodeLibraryIndex(JSON.parse(payload))), bodiesOf(lib))
})
