// #252 B2 test harness: TypeScript loader, jsdom globals on the DEV host, fresh "tabs" (separate
// module instances sharing one localStorage and one IndexedDB), identities and synthetic libraries.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
const { Factory } = require('./txIdb.cjs')
const { makeLibrary, QuotaStorage } = require('./syntheticSongbook.cjs')

const HOST = 'dev.gtar-web.pages.dev'
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: `https://${HOST}/` })
Object.assign(global, { window: dom.window, document: dom.window.document, location: dom.window.location })

const SRC = path.join(__dirname, '..', '..', 'src') + path.sep
/** A new tab: fresh copies of every web/src module (own in-memory state), same storage and IndexedDB. */
function newTab() {
  for (const key of Object.keys(require.cache)) if (key.startsWith(SRC)) delete require.cache[key]
  return {
    sj: require('../../src/utils/syncJournal.ts'),
    b2: require('../../src/utils/libraryB2.ts'),
    idx: require('../../src/utils/libraryIndex.ts'),
    owner: require('../../src/utils/libraryOwner.ts'),
    bodies: require('../../src/utils/libraryBodyStore.ts'),
  }
}

/** Device storage modelled without a browser quota (tests that need one pass their own). */
function freshStorage(quota = Number.MAX_SAFE_INTEGER) {
  const storage = new QuotaStorage(quota)
  global.localStorage = storage
  return storage
}
function signIn(storage, userId) {
  if (userId === null) storage.removeItem('gtar_auth_session')
  else storage.setItem('gtar_auth_session', JSON.stringify({ user: { id: userId, email: `${userId}@example.test` }, sessionToken: `token-${userId}` }))
}
function bindOwner(storage, userId) {
  storage.setItem('gtar_library_owner_v1', JSON.stringify({ v: 1, userId, env: HOST, boundAt: 1, reason: 'confirmed' }))
}

/** n songs (every 50th in trash), `setlistCount` setlists of 12 songs, deterministic. */
function library(n, setlistCount = 300) {
  const { songs } = makeLibrary(n, 0)
  songs.forEach((song, i) => { if (i % 50 === 49) song.isDeleted = true })
  const live = songs.filter(song => !song.isDeleted)
  const setlists = Array.from({ length: setlistCount }, (_, i) => ({
    id: `set-${i}`, name: `Setlist ${i}`, createdAt: 1_700_000_000_000 + i, ...(i % 30 === 29 ? { isDeleted: true } : {}),
    songs: live.slice((i * 17) % Math.max(1, live.length - 12), (i * 17) % Math.max(1, live.length - 12) + 12).map(s => ({ id: s.id, title: s.title, artist: s.artist })),
  }))
  return { songs, setlists }
}
const ids = list => list.map(item => String(item.id))
const settle = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms))

module.exports = { HOST, dom, newTab, freshStorage, signIn, bindOwner, library, ids, settle, Factory, QuotaStorage, makeLibrary }
