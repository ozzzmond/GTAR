const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { JSDOM } = require('jsdom')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client-test-id"})'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }
      ).outputText,
      filename
    )
}
require.extensions['.png'] = (module) => { module.exports = '/assets/dev-logo.png' }

const user = (id, email, role) => ({
  id, google_sub: `${id}-sub`, email, display_name: id, picture_url: null, role, access_status: 'active',
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', last_login_at: '2026-10-01T00:00:00Z',
})

test('admin protection in user management comes from server role, not a configured email', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar-web.pages.dev/' })
  const saved = { window: global.window, document: global.document, fetch: global.fetch, act: global.IS_REACT_ACT_ENVIRONMENT }
  try {
    Object.assign(global, {
      window: dom.window,
      document: dom.window.document,
      IS_REACT_ACT_ENVIRONMENT: true,
      fetch: async () => new Response(JSON.stringify({
        success: true,
        users: [user('self', 'self@example.com', 'admin'), user('other-admin', 'other-admin@example.com', 'admin'), user('member', 'member@example.com', 'member')],
      })),
    })
    const React = require('react')
    const { createRoot } = require('react-dom/client')
    const { act } = require('react')
    const { AuthContext } = require('../src/utils/authContext.ts')
    const { UserManagementModal } = require('../src/components/UserManagementModal.tsx')

    const auth = { session: { sessionToken: 'server-token', user: { email: 'self@example.com' } } }
    const root = createRoot(dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(AuthContext.Provider, { value: auth },
        React.createElement(UserManagementModal, { isOpen: true, onClose() {} })))
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

    const text = dom.window.document.body.textContent
    assert.match(text, /other-admin@example\.com/)
    assert.match(text, /member@example\.com/)
    const revoke = dom.window.document.querySelectorAll('button'); const revokeButtons = [...revoke].filter(b => /Revoke/.test(b.textContent))
    assert.equal(revokeButtons.length, 1, 'only the active member can be revoked; admins and self are protected')
    await act(async () => root.unmount())
  } finally {
    dom.window.close()
    global.window = saved.window
    global.document = saved.document
    global.fetch = saved.fetch
    global.IS_REACT_ACT_ENVIRONMENT = saved.act
  }
})
