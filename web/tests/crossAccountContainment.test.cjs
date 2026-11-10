// D1 device-owned library: explicit actions use the active account, not a stored library owner.
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.gtar-web.pages.dev' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(dom.window.navigator, 'locks', { configurable: true, value: { request: async (_name, action) => action() } })
const OWNER_KEY = 'gtar_library_owner_v1'
const library = { songs: [{ id: 'song-a', title: 'Device song', rawContent: '[C]Device chart', format: 'CHORD_PRO' }],
  setlists: [{ id: 'set-a', name: 'Device setlist', songs: [{ id: 'song-a', title: 'Device song' }] }] }
function signIn(status = 'active') {
  if (status === 'signed-out') return localStorage.removeItem('gtar_auth_session')
  localStorage.setItem('gtar_auth_session', JSON.stringify({ version: 1,
    user: { id: 'account-b', sub: 'b', email: 'b@example.test', role: 'member', access_status: status, email_verified: true },
    role: 'member', access_status: status, authenticatedAt: Date.now(), lastVerifiedAt: Date.now(),
    localExpiresAt: Date.now() + 3600000, expiresAt: Date.now() + 3600000, sessionToken: 'token-b' }))
}
let calls
beforeEach(() => { localStorage.clear(); calls = []; localStorage.setItem('gtar_library_v1', JSON.stringify(library)); signIn() })
function deviceOwner(kind) {
  if (kind === 'mismatch') localStorage.setItem(OWNER_KEY, ' {"v":1,"userId":"account-a","env":"dev.gtar-web.pages.dev","boundAt":7,"reason":"confirmed"} ')
  return localStorage.getItem(OWNER_KEY)
}
const response = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { ShareSetlistModal } = require('../src/components/ShareSetlistModal.tsx')
for (const kind of ['unbound', 'mismatch']) test(`active account creates QR share from ${kind} device library without changing owner bytes`, async () => {
  const owner = deviceOwner(kind)
  global.fetch = async (url, options) => { calls.push({ url, ...options }); return response({ token: 'a'.repeat(64), revokeSecret: 'b'.repeat(64) }) }
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(ShareSetlistModal, { setlist: library.setlists[0], allSongs: library.songs, onClose() {} })))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/setlist/share')
    assert.equal(calls[0].headers.Authorization, undefined)
    assert.ok(document.querySelector('img[src^="data:image/svg+xml"]'))
    assert.match(document.querySelector('input').value, /share=a{64}/)
    assert.equal(localStorage.getItem(OWNER_KEY), owner)
  } finally { await act(async () => root.unmount()) }
})
for (const status of ['signed-out', 'pending']) test(`${status} account creates only the explicitly shared snapshot without login`, async () => {
  const owner = deviceOwner('mismatch')
  signIn(status)
  global.fetch = async (url, options) => { calls.push({ url, ...options }); return response({ token: 'a'.repeat(64), revokeSecret: 'b'.repeat(64) }) }
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(ShareSetlistModal, { setlist: library.setlists[0], allSongs: library.songs, onClose() {} })))
    assert.doesNotMatch(document.body.textContent, /Sign in/)
    assert.ok([...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Export JSON'))
    assert.ok(document.querySelector('img'))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].headers.Authorization, undefined)
    assert.equal(JSON.parse(calls[0].body).songs[0].rawContent, '[C]Device chart')
    assert.equal(localStorage.getItem('gtar_library_v1'), JSON.stringify(library))
    assert.equal(localStorage.getItem(OWNER_KEY), owner)
  } finally { await act(async () => root.unmount()) }
})
