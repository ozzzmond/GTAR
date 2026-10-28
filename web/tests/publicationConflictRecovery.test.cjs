// #253 DEV publication 409: root-cause reproductions and recovery, with the real client publishing code
// talking to the real server handler on a disposable SQLite catalog (synthetic users only).
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html>', { url: 'https://gtar.test' })
Object.defineProperty(dom.window.navigator, 'locks', { configurable: true, value: { request: async (_name, action) => action() } })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage })
const { fixture } = require('./helpers/catalogV2Fixture.cjs')
const { handleSetlistCatalog } = require('../functions/lib/setlistCatalog.ts')
const api = require('../src/utils/sharedSetlistPublishing.ts')
const { CatalogApiError } = require('../src/types/sharedCatalog.ts')
const { LIBRARY_KEY } = require('../src/utils/syncJournal.ts')
const { bindOwner, OWNER_KEY } = require('./helpers/libraryOwner.cjs')

const library = { songs: [
  { id: 'song-a', title: 'Alpha', artist: 'A', rawContent: '[C]Alpha line', format: 'CHORD_PRO', key: 'C' },
  { id: 'song-b', title: 'Beta', rawContent: 'Beta chart', format: 'PLAIN' },
], setlists: [{ id: 'V2-QA-TEMP-20261028', name: 'QA temp', songs: [{ id: 'song-a', title: 'Alpha' }, { id: 'song-b', title: 'Beta' }] }] }
const SOURCE = 'V2-QA-TEMP-20261028'
let f, calls, dropAfterCommit
function signIn(user) {
  localStorage.setItem('gtar_auth_session', JSON.stringify({ version: 1, user: { id: user, sub: user, email: `${user}@example.test`, role: 'member', access_status: 'active' },
    authenticatedAt: Date.now(), lastVerifiedAt: Date.now(), localExpiresAt: Date.now() + 3600000, expiresAt: Date.now() + 3600000,
    sessionToken: f.tokens[user], role: 'member', access_status: 'active' }))
}
beforeEach(async () => {
  localStorage.clear()
  f = await fixture()
  f.env.SHARED_SETLISTS_ENABLED = 'catalog-v2'
  calls = []; dropAfterCommit = false
  global.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' })
    const match = /^\/api\/catalog\/setlists(?:\/([^/?]+))?/.exec(url)
    if (!match) return new Response('{}', { status: 404 })
    const response = await handleSetlistCatalog({ request: new Request(`https://local.test${url}`, options), env: f.env, params: { id: match[1] && decodeURIComponent(match[1]) } })
    if (dropAfterCommit && options.method && options.method !== 'GET') { dropAfterCommit = false; throw new TypeError('network connection lost') }
    return response
  }
  signIn('member')
  bindOwner(localStorage, 'member')
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(library))
})
const getLocal = () => library
const journalKeys = () => Object.keys(localStorage).filter(k => k.startsWith('gtar_setlist_publication_v1:'))
const posts = () => calls.filter(c => c.method !== 'GET')
const heads = () => f.sql.prepare('SELECT id, publisher_user_id, current_revision, is_deleted FROM catalog_setlist_heads ORDER BY rowid').all()
async function publishWith(link) {
  const preview = await api.preparePublication(SOURCE, getLocal, () => false)
  return api.sendPublicationIntent(preview.account, SOURCE, { ...link, pending: api.makePublicationIntent(link, preview) })
}

test('root cause A: an unlinked device library is refused locally (409 LIBRARY_OWNER), not a publication conflict; nothing sent', async () => {
  localStorage.removeItem(OWNER_KEY)
  const error = await api.preparePublication(SOURCE, getLocal, () => false).then(() => null, e => e)
  assert.ok(error instanceof CatalogApiError)
  assert.deepEqual([error.status, error.code], [409, 'LIBRARY_OWNER'])
  assert.doesNotMatch(api.publicationError(error), /conflict/i, 'actionable ownership message, not a publication conflict')
  assert.match(api.publicationError(error), /not linked to an account/)
  localStorage.setItem('gtar_library_b2_enabled', '1')
  assert.match(api.publicationError(error), /Turn B2 off in Review local recovery, link the songbook in Sync Center/)
  assert.deepEqual(posts(), [])
  assert.deepEqual(journalKeys(), [])
})

test('root cause B: lost journal + existing publication: a deterministic re-create is 409 forever; recovery adopts and updates it', async () => {
  const first = await publishWith(await api.newPublicationLink('member', SOURCE))
  assert.equal(first.result.revision, 1)
  for (const key of journalKeys()) localStorage.removeItem(key) // other browser, restored device or cleared storage
  // Before the fix: review always derived a fresh link and re-sent a create.
  for (let attempt = 0; attempt < 2; attempt++) {
    const error = await publishWith(await api.newPublicationLink('member', SOURCE)).then(() => null, e => e)
    assert.equal(error?.status, 409, `attempt ${attempt}: server SETLIST_PUBLICATION_CONFLICT`)
  }
  assert.equal(heads().length, 1, 'duplicate prevention held')
  // After the fix: the server-verified identity is the existing publication; the action is an update.
  for (const key of journalKeys()) localStorage.removeItem(key)
  const resolved = await api.resolvePublicationLink('member', SOURCE)
  assert.equal(resolved.recovered, true)
  assert.deepEqual(resolved.link.result, { id: first.result.id, revision: 1, unpublished: false })
  const updated = await publishWith(resolved.link)
  assert.deepEqual([updated.result.id, updated.result.revision], [first.result.id, 2])
  assert.deepEqual(heads().map(h => [h.id, h.publisher_user_id, h.current_revision, h.is_deleted]), [[first.result.id, 'member', 2, 0]])
  assert.equal(api.readPublicationLink('member', SOURCE).result.revision, 2, 'recovered identity journaled')
})

test('unpublished publication: the burned key moves to the next generation only after the server proves the tombstone', async () => {
  const first = await publishWith(await api.newPublicationLink('member', SOURCE))
  assert.equal((await f.call('DELETE', { expected_revision: 1 }, { id: first.result.id, user: 'admin' })).status, 200, 'admin moderation removal')
  const saved = api.readPublicationLink('member', SOURCE)
  await assert.rejects(api.refreshPublication(saved), /unavailable or unpublished/)
  assert.deepEqual(await api.lookupOwnPublication(saved.publicationKey), { id: first.result.id, revision: 2, unpublished: true })
  const resolved = await api.resolvePublicationLink('member', SOURCE)
  assert.deepEqual([resolved.recovered, resolved.unpublishedBefore, resolved.link.result], [false, 1, undefined])
  assert.notEqual(resolved.link.publicationKey, saved.publicationKey)
  // As the review dialog does: the stale journal entry is replaced (compare-and-set) before sending.
  await api.replacePublicationLink('member', SOURCE, saved, resolved.link)
  const second = await publishWith(resolved.link)
  assert.notEqual(second.result.id, first.result.id)
  assert.deepEqual(heads().map(h => h.is_deleted), [1, 0], 'one tombstone, exactly one live publication')
  // Deterministic on any device: the next resolution adopts the live generation.
  const again = await api.resolvePublicationLink('member', SOURCE)
  assert.deepEqual([again.recovered, again.link.result.id, again.link.publicationKey], [true, second.result.id, resolved.link.publicationKey])
})

test('ambiguous create (committed, response lost) replays the same request safely; never a second head', async () => {
  const link = await api.newPublicationLink('member', SOURCE)
  const preview = await api.preparePublication(SOURCE, getLocal, () => false)
  const pending = { ...link, pending: api.makePublicationIntent(link, preview) }
  dropAfterCommit = true
  await assert.rejects(api.sendPublicationIntent('member', SOURCE, pending), /network/)
  const saved = api.readPublicationLink('member', SOURCE)
  assert.ok(saved.pending, 'pending request kept for exact retry')
  const replay = await api.sendPublicationIntent('member', SOURCE, saved)
  assert.equal(replay.result.revision, 1)
  assert.equal(heads().length, 1)
  assert.equal(f.count('catalog_setlist_mutations'), 1)
})

test('lookup is own-only and strict; an older server without lookup keeps the previous behaviour', async () => {
  const first = await publishWith(await api.newPublicationLink('member', SOURCE))
  const key = api.readPublicationLink('member', SOURCE).publicationKey
  signIn('member2')
  bindOwner(localStorage, 'member2')
  assert.equal(await api.lookupOwnPublication(key), null, 'another publisher never sees this head')
  for (const query of [`?publication_key=${key}&limit=1`, '?publication_key=short', `?publication_key=${key}x!`]) {
    assert.equal((await f.call('GET', undefined, { query, user: 'member2' })).status, 400, query)
  }
  signIn('member')
  global.fetch = async () => new Response(JSON.stringify({ setlists: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const legacy = await api.resolvePublicationLink('member', SOURCE)
  assert.deepEqual([legacy.recovered, legacy.link.result, legacy.link.publicationKey], [false, undefined, key])
  void first
})
