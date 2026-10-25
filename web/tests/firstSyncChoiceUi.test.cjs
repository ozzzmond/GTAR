// #227: the Sync Center shows the one-time first-sync choice and sends the user's answer.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:true})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.gtar-web.pages.dev' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const auth = require('../src/utils/authContext.ts')
auth.useOptionalGoogleAuth = () => ({ session: { token: 'token' }, accessStatus: 'active' })
const records = require('../src/utils/recordsSync.ts')
const { CloudSyncModal } = require('../src/components/CloudSyncModal.tsx')

test('first sync with own songs: the choice is shown; each button sends its answer', async () => {
  const calls = []
  const library = { songs: [], setlists: [] }
  records.performSongbookSync = async (_token, options = {}) => {
    calls.push(options.firstSync ?? null)
    return options.firstSync
      ? { success: true, status: 'IN_SYNC', state: 'SAME_STATE', actionTaken: 'DOWNLOADED', updatedLibrary: library }
      : { success: false, status: 'IDLE', state: 'SAME_STATE', actionTaken: 'NONE', firstSyncChoice: { songs: 3, setlists: 1 } }
  }
  const applied = []
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(CloudSyncModal, { isOpen: true, onClose() {}, onSyncApplied: l => applied.push(l) })))
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  const panel = document.querySelector('[data-testid="first-sync-choice"]')
  assert.ok(panel)
  assert.match(panel.textContent, /3 songs and 1 setlist that your cloud library does not have/)
  await act(async () => { document.querySelector('[data-testid="first-sync-use-cloud"]').click(); await new Promise(r => setTimeout(r, 20)) })
  assert.deepEqual(calls, [null, 'cloud'])
  assert.equal(document.querySelector('[data-testid="first-sync-choice"]'), null, 'choice disappears once answered')
  assert.deepEqual(applied, [library])
  await act(async () => root.unmount())
})
