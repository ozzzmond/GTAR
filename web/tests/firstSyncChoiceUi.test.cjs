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

test('Replace this device with the cloud copy asks first; Cancel does nothing; an equal device says nothing changed', async () => {
  const calls = []
  records.performSongbookSync = async (_token, options = {}) => {
    calls.push(options.forceAction ?? 'sync')
    return options.forceAction === 'download'
      ? { success: true, status: 'IN_SYNC', state: 'SAME_STATE', actionTaken: 'NONE', replaced: { songs: 4, setlists: 1, changed: 0 } }
      : { success: true, status: 'IN_SYNC', state: 'SAME_STATE', actionTaken: 'NONE' }
  }
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(CloudSyncModal, { isOpen: true, onClose() {}, onSyncApplied() {} })))
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  const q = id => document.querySelector(`[data-testid="${id}"]`)
  assert.match(q('download-from-cloud-button').textContent, /Replace this device with the cloud copy/)
  await act(async () => q('download-from-cloud-button').click())
  assert.ok(q('replace-with-cloud-confirm'))
  await act(async () => q('replace-with-cloud-cancel-button').click())
  assert.equal(q('replace-with-cloud-confirm'), null)
  assert.ok(!calls.includes('download'), 'Cancel does not replace')
  await act(async () => q('download-from-cloud-button').click())
  await act(async () => { q('replace-with-cloud-confirm-button').click(); await new Promise(r => setTimeout(r, 20)) })
  assert.ok(calls.includes('download'))
  assert.match(document.body.textContent, /already matches the cloud copy\. Nothing changed\./)
  await act(async () => root.unmount())
})

test('#240 F8: a held-back conflict shows its reason and the Download Cloud consequence before any choice', async () => {
  const reason = 'The cloud version lists songs that are not in your library (no song with that exact ID): "Song 2". "Download Cloud" keeps this setlist without those entries; "Keep Local Only" keeps this device\'s version. Either way, the cloud version is first saved in Review local recovery.'
  const calls = []
  records.performSongbookSync = async (_token, options = {}) => {
    calls.push(options.forceAction ?? 'sync')
    return { success: false, status: 'CONFLICT', state: 'CONFLICT', actionTaken: 'CONFLICT_DETECTED',
      conflicts: [{ id: 'list-1', type: 'setlist', title: 'List 1', reason }], error: 'Some songs or setlists were edited here and in the cloud.' }
  }
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(CloudSyncModal, { isOpen: true, onClose() {}, onSyncApplied() {} })))
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  const row = document.querySelector('[data-testid="conflict-item"]')
  assert.ok(row, 'conflict listed')
  assert.match(row.textContent, /List 1/)
  assert.equal(row.querySelector('[data-testid="conflict-reason"]').textContent, reason, 'reason shown in full')
  const download = [...document.querySelectorAll('button')].find(b => /Download Cloud/.test(b.textContent))
  assert.ok(download, 'choice offered next to the explanation')
  assert.deepEqual(calls, ['sync'], 'shown before the user chooses anything')
  await act(async () => root.unmount())
})

test('#247: an unlinked songbook shows an explicit link step; linking saves a recovery copy, then syncs again', async () => {
  const journal = require('../src/utils/syncJournal.ts')
  const owner = require('../src/utils/libraryOwner.ts')
  localStorage.clear()
  journal.persistLibrary({ songs: [{ id: 's1', title: 'Mine', rawContent: 'x' }], setlists: [] }, localStorage)
  auth.useOptionalGoogleAuth = () => ({ session: { token: 'token', user: { id: 'user-a', email: 'a@example.com' } }, accessStatus: 'active' })
  const calls = []
  records.performSongbookSync = async () => {
    calls.push(owner.readLibraryOwner(localStorage)?.userId ?? null)
    return owner.readLibraryOwner(localStorage)
      ? { success: true, status: 'IN_SYNC', state: 'SAME_STATE', actionTaken: 'NONE' }
      : { success: false, status: 'ERROR', state: 'OFFLINE_OR_CLOUD_FAILURE', actionTaken: 'NONE', ownership: 'unbound', error: 'not linked' }
  }
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(CloudSyncModal, { isOpen: true, onClose() {}, onSyncApplied() {} })))
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  const panel = document.querySelector('[data-testid="library-owner-link"]')
  assert.ok(panel, 'link step shown')
  assert.match(panel.textContent, /1 songs, 0 setlists/)
  assert.match(panel.textContent, /a@example\.com/)
  await act(async () => { document.querySelector('[data-testid="library-owner-link-button"]').click(); await new Promise(r => setTimeout(r, 30)) })
  assert.equal(owner.readLibraryOwner(localStorage).userId, 'user-a')
  assert.ok(Object.keys(journal.recoveryData(localStorage)).some(k => k.startsWith('gtar_sync_recovery:owner-confirm:')))
  assert.deepEqual(calls, [null, 'user-a'], 'synced again after linking')
  assert.equal(document.querySelector('[data-testid="library-owner-link"]'), null)
  await act(async () => root.unmount())
  localStorage.clear()
})
