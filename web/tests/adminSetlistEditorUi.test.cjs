// #253 B3 UI: admin edit of another publisher's shared setlist. One JSDOM per file (React input events).
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://gtar.test' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { SESSION_STORAGE_KEY } = require('../src/utils/googleAuth.ts')
const { AdminSetlistEditor } = require('../src/components/AdminSetlistEditor.tsx')
const { SharedSetlistCatalogPanel } = require('../src/components/SharedSetlistCatalogPanel.tsx')

let root, calls, responder
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = '<div id="root"></div>'
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ version: 1, user: { id: 'admin-1', sub: 'admin-1', email: 'admin@test.app', role: 'admin', access_status: 'active' },
    authenticatedAt: Date.now(), lastVerifiedAt: Date.now(), localExpiresAt: Date.now() + 3600000, expiresAt: Date.now() + 3600000,
    sessionToken: 'token-admin', role: 'admin', access_status: 'active' }))
  calls = []
  global.fetch = async (url, options = {}) => { calls.push({ url, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : undefined, headers: options.headers }); return responder(url, options) }
})
afterEach(async () => { if (root) { await act(async () => root.unmount()); root = null } })
async function mount(element) { root = createRoot(document.getElementById('root')); await act(async () => root.render(element)) }
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
async function click(el) { assert.ok(el, 'control exists'); await act(async () => { el.click() }); await act(async () => {}) }

const remote = { version: 1, name: 'Sunday', entries: [
  { title: 'Alpha', artist: 'A', rawContent: '[C]Alpha line', format: 'CHORD_PRO', key: 'C' },
  { title: 'Beta', rawContent: 'Beta chart', format: 'PLAIN' },
] }
function editorServer(put) {
  responder = (url, options) => {
    if (url.startsWith('/api/catalog/setlists?')) return json({ setlists: [], capabilities: { client_snapshots: true } })
    if (url.startsWith('/api/catalog/setlists/publication_123456789?revision=3')) return json({ id: 'publication_123456789', revision: 3, snapshot: remote })
    if (options.method === 'PUT') return put(JSON.parse(options.body))
    return json({}, 500)
  }
}
async function typeInto(el, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}
async function loaded() {
  for (let i = 0; i < 50 && !(document.querySelector('[data-testid="admin-edit-name"]') && !document.querySelector('[data-testid="admin-edit-name"]').disabled); i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
  }
  assert.equal(document.querySelector('[data-testid="admin-edit-name"]').disabled, false, 'editor ready')
}
async function reviewEdit() {
  await mount(React.createElement(AdminSetlistEditor, { id: 'publication_123456789', revision: 3, onClose() {} }))
  await loaded()
  await typeInto(document.querySelector('[data-testid="admin-edit-name"]'), 'Sunday (fixed)')
  await typeInto(document.querySelector('textarea[aria-label="Song 2 chart"]'), 'Beta chart corrected')
  await click(document.querySelector('button[aria-label="Move song 2 up"]'))
  await click(button('Review changes'))
  await act(async () => { document.querySelector('[data-testid="admin-edit-review"] input[type=checkbox]').click() })
}

test('B3: admin edits another publisher setlist: review, then one CAS-bound PUT; publisher stays recorded', async () => {
  editorServer(body => json({ id: 'publication_123456789', revision: body.expected_revision + 1, unpublished: false }))
  let saved = null
  await mount(React.createElement(AdminSetlistEditor, { id: 'publication_123456789', revision: 3, onClose() {}, onSaved: r => { saved = r } }))
  await loaded()
  await click(button('Review changes'))
  assert.match(document.body.textContent, /No changes to save/)
  await act(async () => root.unmount()); root = null
  calls = []
  await reviewEdit()
  assert.match(document.body.textContent, /Name: “Sunday” → “Sunday \(fixed\)”/)
  assert.equal(calls.some(c => c.method === 'PUT'), false, 'review sends nothing')
  await click(document.querySelector('[data-testid="admin-edit-save"]'))
  const put = calls.find(c => c.method === 'PUT')
  assert.equal(put.url, '/api/catalog/setlists/publication_123456789')
  assert.deepEqual(Object.keys(put.body).sort(), ['expected_revision', 'snapshot', 'snapshot_version'])
  assert.equal(put.body.expected_revision, 3)
  assert.deepEqual(put.body.snapshot.entries.map(e => e.title), ['Beta', 'Alpha'])
  assert.equal(put.body.snapshot.entries[0].rawContent, 'Beta chart corrected')
  assert.ok(put.headers['Idempotency-Key'])
  assert.match(document.body.textContent, /Saved revision 4\. The original publisher stays recorded/)
  assert.equal(document.querySelector('[data-testid="admin-edit-save"]').disabled, true)
  assert.equal(saved, null, 'first editor instance never saved')
})

test('B3: stale edit (409) fails safely; ambiguous failure retries with the same key', async () => {
  let mode = 'timeout'
  editorServer(() => mode === 'timeout' ? json({ success: false }, 503) : mode === 'ok' ? json({ id: 'publication_123456789', revision: 4, unpublished: false }) : json({ success: false }, 409))
  await reviewEdit()
  await click(document.querySelector('[data-testid="admin-edit-save"]'))
  assert.match(document.body.textContent, /Result unknown/)
  mode = 'ok'
  await click(document.querySelector('[data-testid="admin-edit-save"]'))
  const puts = calls.filter(c => c.method === 'PUT')
  assert.equal(puts[0].headers['Idempotency-Key'], puts[1].headers['Idempotency-Key'])
  assert.equal(puts[0].body.snapshot.name, puts[1].body.snapshot.name)
  await act(async () => root.unmount()); root = null
  mode = 'conflict'; calls = []
  await reviewEdit()
  await click(document.querySelector('[data-testid="admin-edit-save"]'))
  assert.match(document.body.textContent, /changed since you opened it/)
  assert.equal(document.querySelector('[data-testid="admin-edit-save"]').disabled, true)
  assert.equal(calls.filter(c => c.method === 'PUT').length, 1)
})

test('B3: catalog card shows admin Edit only to admins and never on own publications', async () => {
  responder = url => url.startsWith('/api/catalog/setlists?')
    ? json({ setlists: [{ id: 'publication_123456789', revision: 3, name: 'Sunday', occurrences: 2, updated_at: 'now' }] }) : json({}, 500)
  for (const [isAdmin, expected] of [[true, true], [false, false]]) {
    await mount(React.createElement(SharedSetlistCatalogPanel, { currentUserId: 'admin-1', isAdmin }))
    await act(async () => {})
    assert.equal(!!document.querySelector('[data-testid="admin-edit-setlist-btn-publication_123456789"]'), expected, `isAdmin=${isAdmin}`)
    await act(async () => root.unmount()); root = null
  }
  localStorage.setItem(`gtar_setlist_publication_v1:admin-1:set-own`, JSON.stringify({ publicationKey: 'a'.repeat(64), result: { id: 'publication_123456789', revision: 3, unpublished: false } }))
  await mount(React.createElement(SharedSetlistCatalogPanel, { currentUserId: 'admin-1', isAdmin: true }))
  await act(async () => {})
  assert.equal(document.querySelector('[data-testid="admin-edit-setlist-btn-publication_123456789"]'), null, 'own publication uses the publisher flow')
})
