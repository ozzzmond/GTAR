// #253 UI: report control, admin moderation queue and the publish duplicate advisory. Synthetic data only.
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { SESSION_STORAGE_KEY } = require('../src/utils/googleAuth.ts')
const { findCatalogDuplicates } = require('../src/utils/catalogDuplicateAdvisory.ts')
const { ReportContentButton } = require('../src/components/ReportContentButton.tsx')
const { CatalogReportsQueue } = require('../src/components/CatalogReportsQueue.tsx')

let dom, root, calls, responder
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://gtar.test' })
  global.window = dom.window; global.document = dom.window.document
  global.localStorage = dom.window.localStorage
  global.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ version: 1, user: { id: 'admin-1', sub: 'admin-1', email: 'admin@test.app', role: 'admin', access_status: 'active' },
    authenticatedAt: Date.now(), lastVerifiedAt: Date.now(), localExpiresAt: Date.now() + 3600000, expiresAt: Date.now() + 3600000,
    sessionToken: 'token-admin', role: 'admin', access_status: 'active' }))
  calls = []
  global.fetch = async (url, options = {}) => { calls.push({ url, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : undefined, headers: options.headers }); return responder(url, options) }
})
afterEach(async () => { if (root) { await act(async () => root.unmount()); root = null } dom.window.close() })
async function mount(element) { root = createRoot(document.getElementById('root')); await act(async () => root.render(element)) }
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
async function click(el) { assert.ok(el, 'control exists'); await act(async () => { el.click() }); await act(async () => {}) }

test('duplicate advisory: same chart or same lyrics match; own publication, short lyrics and content-less entries ignored', () => {
  const chart = '{title: Grace}\n[G]Amazing grace how [C]sweet the sound\n[G]That saved a wretch like me'
  const catalog = [
    { id: 'same-chart', title: 'Grace', artist: 'A', raw_content: `  ${chart.replaceAll('\n', '\r\n')}  ` },
    { id: 'same-lyrics', title: 'Grace (D)', artist: null, raw_content: '[D]Amazing grace how [G]sweet the sound\n[D]That saved a wretch like me' },
    { id: 'own', title: 'Mine', raw_content: chart },
    { id: 'no-content', title: 'Metadata only' },
    { id: 'different', title: 'Other', raw_content: '[C]Completely different words here today' },
  ]
  const found = findCatalogDuplicates({ rawContent: chart, publishedCatalogSongId: 'own' }, catalog)
  assert.deepEqual(found.map(m => [m.id, m.match]), [['same-chart', 'chart'], ['same-lyrics', 'lyrics']])
  assert.deepEqual(findCatalogDuplicates({ rawContent: '[C]La\n[G]La' }, [{ id: 'x', title: 'X', raw_content: '[D]La\n[A]La' }]), [], 'trivial lyrics never match')
  assert.deepEqual(findCatalogDuplicates({ rawContent: '' }, catalog), [])
})

test('report control: sends a bounded report for the exact revision; duplicate and rate errors are explained', async () => {
  responder = () => json({ success: true, id: 7, status: 'open' }, 201)
  await mount(React.createElement(ReportContentButton, { kind: 'setlist', id: 'publication_123456789', revision: 3, label: 'Sunday' }))
  await click(document.querySelector('[data-testid="report-setlist-btn"]'))
  const select = document.querySelector('select')
  await act(async () => { select.value = 'copyright'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  await click(button('Send report'))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/catalog/reports')
  assert.deepEqual(calls[0].body, { target_kind: 'setlist', target_id: 'publication_123456789', target_revision: 3, reason: 'copyright' })
  assert.match(document.body.textContent, /An admin will review this report/)
  await click(button('Close'))
  for (const [status, text] of [[409, /already reported/], [429, /limit reached/]]) {
    responder = () => json({ success: false, error: 'x' }, status)
    await click(document.querySelector('[data-testid="report-setlist-btn"]'))
    await click(button('Send report'))
    assert.match(document.body.textContent, text)
    await click(button('Cancel'))
  }
})

const report = (over = {}) => ({ id: 1, target_kind: 'song', target_id: 'catalog-song-1', target_revision: 2, reason: 'copyright', note: 'Not licensed',
  status: 'open', created_at: '2026-10-01T00:00:00.000Z', resolved_at: null, resolution_note: null, reporter_email: 'member@test.app', reporter_name: null,
  target_title: 'Grace', target_artist: 'A', target_current_revision: 2, target_deleted: 0, open_reports: 2, ...over })

test('admin queue: lists open reports; dismiss resolves without touching content', async () => {
  let open = [report()]
  responder = (url, options) => {
    if (url.startsWith('/api/admin/catalog-reports?')) return json({ success: true, reports: open })
    if (options.method === 'POST') { open = []; return json({ success: true, id: 1, status: 'dismissed' }) }
    return json({}, 500)
  }
  let count = null
  await mount(React.createElement(CatalogReportsQueue, { onOpenCount: n => { count = n } }))
  assert.match(document.body.textContent, /Grace/)
  assert.match(document.body.textContent, /2 open reports/)
  assert.equal(count, 1)
  await click(button('Dismiss'))
  assert.deepEqual(calls.filter(c => c.method !== 'GET').map(c => [c.url, c.method, c.body]), [['/api/admin/catalog-reports/1', 'POST', { status: 'dismissed' }]])
  assert.match(document.body.textContent, /No open reports/)
  assert.equal(count, 0)
})

test('admin queue: remove needs confirmation, removes the exact revision, then marks actioned', async () => {
  const open = [report(), report({ id: 2, target_kind: 'setlist', target_id: 'publication_123456789', target_current_revision: 4, target_title: 'Sunday' })]
  responder = (url, options) => {
    if (url.startsWith('/api/admin/catalog-reports?')) return json({ success: true, reports: open })
    if (url.startsWith('/api/catalog/songs/')) return json({ success: true, message: 'ok', id: 'catalog-song-1' })
    if (url.startsWith('/api/catalog/setlists/')) return json({ id: 'publication_123456789', revision: 5, unpublished: true })
    return json({ success: true, id: 1, status: 'actioned' })
  }
  await mount(React.createElement(CatalogReportsQueue))
  const removes = () => [...document.querySelectorAll('button')].filter(b => b.textContent === 'Remove content')
  await click(removes()[0])
  assert.equal(calls.filter(c => c.method !== 'GET').length, 0, 'first click only asks for confirmation')
  await click(document.querySelector('[data-testid="confirm-remove-1"]'))
  await click(removes()[1])
  await click(document.querySelector('[data-testid="confirm-remove-2"]'))
  const writes = calls.filter(c => c.method !== 'GET').map(c => [c.method, c.url, c.body])
  assert.deepEqual(writes, [
    ['DELETE', '/api/catalog/songs/catalog-song-1?expected_revision=2', undefined],
    ['POST', '/api/admin/catalog-reports/1', { status: 'actioned' }],
    ['DELETE', '/api/catalog/setlists/publication_123456789', { expected_revision: 4 }],
    ['POST', '/api/admin/catalog-reports/2', { status: 'actioned' }],
  ])
  assert.ok(calls.find(c => c.method === 'DELETE' && c.url.startsWith('/api/catalog/setlists/')).headers['Idempotency-Key'])
})

test('admin queue: a failed removal leaves the report open', async () => {
  responder = (url, options) => url.startsWith('/api/admin/catalog-reports?') ? json({ success: true, reports: [report()] })
    : options.method === 'DELETE' ? json({ success: false, error: 'Revision conflict' }, 409) : json({ success: true })
  await mount(React.createElement(CatalogReportsQueue))
  await click(button('Remove content'))
  await click(document.querySelector('[data-testid="confirm-remove-1"]'))
  assert.equal(calls.some(c => c.method === 'POST'), false)
  assert.match(document.body.textContent, /changed in the meantime/)
})
