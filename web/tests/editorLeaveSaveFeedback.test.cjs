// #170: autosaved edits are confirmed when the editor closes; failed or absent edits are not.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: fn => fn() })
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { DesktopEditor } = require('../src/components/DesktopEditor.tsx')

const song = { id: 'leave-1', title: 'Leave Song', artist: 'A', key: 'G', rawContent: '[G] Line one', capo: '', bpm: '120', tags: '', format: 'CHORD_PRO', transposeOffset: 0 }
const type = async (el, value) => act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
})
async function session({ write = () => true, edit }) {
  const root = createRoot(document.getElementById('root'))
  let left = 0
  await act(async () => root.render(React.createElement(DesktopEditor, { song, transposeOffset: 0, onUpdateSong: write, onSaveSong: write, onLeaveWithSavedChanges: () => left++ })))
  if (edit) await type(document.querySelector('textarea'), edit)
  const badge = document.querySelector('[data-testid="editor-save-status"]')
  const status = { value: badge.getAttribute('data-save-status'), role: badge.getAttribute('role'), live: badge.getAttribute('aria-live') }
  await act(async () => root.unmount())
  return { left, status }
}

test('autosaved lyric edit: badge announces Saved and leaving confirms once', async () => {
  const { left, status } = await session({ edit: '[G] Line one edited' })
  assert.deepEqual(status, { value: 'SAVED', role: 'status', live: 'polite' })
  assert.equal(left, 1)
})

test('no edits: leaving shows no confirmation', async () => {
  assert.equal((await session({})).left, 0)
})

test('failed autosave: never confirms "saved" on leave', async () => {
  const { left, status } = await session({ write: () => false, edit: '[G] not persisted' })
  assert.equal(status.value, 'FAILED')
  assert.equal(left, 0)
})
