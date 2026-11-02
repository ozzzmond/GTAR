// #247 (P0): one browser, two accounts. The origin-wide personal library must never be uploaded,
// published or mutated under an account that does not own it.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('', { url: 'https://dev.gtar-web.pages.dev' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage })
Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent: 'GTAR test', locks: { request: async (_name, action) => (typeof action === 'function' ? action() : typeof _name === 'function' ? _name() : undefined) } } })
const journal = require('../src/utils/syncJournal.ts')
const owner = require('../src/utils/libraryOwner.ts')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const song = n => ({ id: id(n), title: `Song ${n}`, artist: 'A', rawContent: `[G]Line ${n}` })
const libA = { songs: [song(1), song(2), song(3)], setlists: [{ id: id(901), name: 'A set', songs: [{ id: id(1), title: 'Song 1', artist: 'A' }] }] }
const asOwnerOf = (store, fn) => {
  const linked = owner.readLibraryOwner(store)
  if (!linked) return fn()
  const previous = store.getItem('gtar_auth_session')
  store.setItem('gtar_auth_session', JSON.stringify({ user: { id: linked.userId }, sessionToken: 'owner-oracle' }))
  try { return fn() } finally { if (previous === null) store.removeItem('gtar_auth_session'); else store.setItem('gtar_auth_session', previous) }
}
const ownerPersist = (lib, store, options) => asOwnerOf(store, () => journal.persistLibrary(lib, store, options))
test('#247: shared publication and QR share are blocked when the session is not the library owner', () => {
  const { SESSION_STORAGE_KEY } = require('../src/utils/googleAuth.ts')
  const catalog = require('../src/utils/sharedCatalogClient.ts')
  localStorage.clear()
  ownerPersist(libA, localStorage)
  localStorage.setItem(owner.LIBRARY_OWNER_KEY, JSON.stringify({ v: 1, userId: 'user-a', env: owner.libraryEnv(), boundAt: 0, reason: 'confirmed' }))
  const sessionFor = who => localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ version: 1, user: { id: who, sub: who, email: `${who}@x`, role: 'member', access_status: 'active', email_verified: true },
    authenticatedAt: Date.now(), lastVerifiedAt: Date.now(), localExpiresAt: Date.now() + 3600000, expiresAt: Date.now() + 3600000, sessionToken: `t-${who}`, role: 'member', access_status: 'active' }))
  sessionFor('user-b')
  assert.throws(() => catalog.assertPublishFromOwnLibrary(), err => err.code === 'LIBRARY_OWNER')
  assert.match(owner.personalContentBlockReason('user-b'), /belongs to another GTAR account/, 'QR share blocked')
  sessionFor('user-a')
  assert.doesNotThrow(() => catalog.assertPublishFromOwnLibrary())
  assert.equal(owner.personalContentBlockReason('user-a'), null)
  localStorage.clear()
})
