// #304: Manage Users dialog — title, wrapping filter chips, Copy Active row, one footer Refresh. Synthetic data only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { JSDOM } = require('jsdom')
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client-test-id"})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/assets/dev-logo.png' }

const user = (id, status) => ({ id, google_sub: `${id}-sub`, email: `${id}@example.com`, display_name: id, picture_url: null, role: 'member', access_status: status,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', last_login_at: '2026-10-01T00:00:00Z' })

test('Manage Users: title, chips wrap without horizontal scroll, Copy Active on its own row, footer Refresh only', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar-web.pages.dev/' })
  const saved = { window: global.window, document: global.document, fetch: global.fetch, act: global.IS_REACT_ACT_ENVIRONMENT, localStorage: global.localStorage }
  const calls = []
  try {
    Object.assign(global, {
      window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
      fetch: async url => {
        calls.push(String(url))
        if (String(url).includes('catalog-reports')) return new Response(JSON.stringify({ success: true, reports: [] }), { headers: { 'Content-Type': 'application/json' } })
        return new Response(JSON.stringify({ success: true, users: [user('a', 'active'), user('p', 'pending'), user('d', 'denied')] }), { headers: { 'Content-Type': 'application/json' } })
      },
    })
    const { SESSION_STORAGE_KEY } = require('../src/utils/googleAuth.ts')
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ version: 1, user: { id: 'admin-1', sub: 'admin-1', email: 'admin@example.com', role: 'admin', access_status: 'active' },
      authenticatedAt: Date.now(), lastVerifiedAt: Date.now(), localExpiresAt: Date.now() + 3600000, expiresAt: Date.now() + 3600000,
      sessionToken: 't', role: 'admin', access_status: 'active' }))
    const React = require('react'), { act } = React
    const { createRoot } = require('react-dom/client')
    const { AuthContext } = require('../src/utils/authContext.ts')
    const { UserManagementModal } = require('../src/components/UserManagementModal.tsx')
    const doc = dom.window.document
    const root = createRoot(doc.getElementById('root'))
    await act(async () => root.render(React.createElement(AuthContext.Provider, { value: { session: { sessionToken: 't', user: { email: 'admin@example.com' } } } },
      React.createElement(UserManagementModal, { isOpen: true, onClose() {} }))))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

    assert.equal(doc.querySelector('h2').textContent, 'Manage Users')
    assert.doesNotMatch(doc.body.textContent, /D1 Account|Access Control/)
    const accounts = doc.querySelector('[data-testid="account-filters"]')
    assert.deepEqual([...accounts.querySelectorAll('button')].map(b => b.textContent.replace(/\s*\(\d+\)/, '')), ['All', 'Pending', 'Active', 'Denied'])
    for (const cls of ['flex', 'flex-wrap', 'gap-2']) assert.ok(accounts.className.split(' ').includes(cls), cls)
    assert.doesNotMatch(accounts.className, /overflow-x/)
    const copy = doc.querySelector('[aria-label="Copy active user emails"]')
    assert.equal(copy.textContent, 'Copy Active')
    assert.ok(!accounts.contains(copy), 'Copy Active is not in the chip row')
    assert.match(copy.parentElement.className, /justify-end/)
    assert.equal(copy.parentElement.previousElementSibling, accounts, 'Copy Active row sits right under the chips')
    const refreshes = () => [...doc.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Refresh')
    assert.equal(refreshes().length, 1)

    await act(async () => doc.querySelector('[data-testid="admin-reports-tab"]').click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    const reports = doc.querySelector('[data-testid="catalog-reports-filters"]')
    assert.deepEqual([...reports.querySelectorAll('button')].map(b => b.textContent), ['Open', 'Actioned', 'Dismissed', 'All'])
    for (const cls of ['flex', 'flex-wrap', 'gap-2']) assert.ok(reports.className.split(' ').includes(cls), cls)
    assert.doesNotMatch(reports.className, /overflow-x/)
    assert.equal(refreshes().length, 1, 'no duplicate Refresh next to the report chips')
    const before = calls.filter(url => url.includes('catalog-reports')).length
    await act(async () => refreshes()[0].click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    assert.ok(before >= 1, 'reports were loaded')
    assert.equal(calls.filter(url => url.includes('catalog-reports')).length, before + 1, 'footer Refresh reloads the reports')
    await act(async () => root.unmount())
  } finally {
    dom.window.close()
    Object.assign(global, { window: saved.window, document: saved.document, fetch: saved.fetch, IS_REACT_ACT_ENVIRONMENT: saved.act, localStorage: saved.localStorage })
  }
})
