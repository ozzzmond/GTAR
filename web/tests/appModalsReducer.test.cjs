// #85 slice 4: modal visibility reducer keeps useState semantics for every App modal.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { APP_MODALS, appModalReducer, useAppModals } = require('../src/utils/useAppModals.ts')

const closed = Object.fromEntries(APP_MODALS.map(m => [m, false]))

test('reducer: value and updater forms; unchanged value keeps the same state object', () => {
  const opened = appModalReducer(closed, { modal: 'theme', value: true })
  assert.equal(opened.theme, true)
  assert.equal(appModalReducer(opened, { modal: 'theme', value: true }), opened, 'no re-render for the same value')
  assert.equal(appModalReducer(opened, { modal: 'theme', value: prev => !prev }).theme, false)
  assert.deepEqual(Object.keys(opened).sort(), [...APP_MODALS].sort())
})

test('hook: lazy initial state, independent modals, stable setters across renders', async () => {
  let latest
  const Probe = () => { latest = useAppModals(() => ({ tvPresentation: true })); return null }
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(Probe)))
  assert.equal(latest.tvPresentation[0], true)
  assert.equal(latest.import[0], false)
  const setImport = latest.import[1]
  await act(async () => setImport(true))
  assert.equal(latest.import[0], true)
  assert.equal(latest.theme[0], false, 'other modals untouched')
  assert.equal(latest.import[1], setImport, 'setter identity is stable')
  await act(async () => latest.setlistDrawer[1](prev => !prev))
  assert.equal(latest.setlistDrawer[0], true)
  const state = latest
  await act(async () => latest.import[1](true))
  assert.equal(latest.import[0], true, 'same value: no change (React may still render once before bailing out, as with useState)')
  assert.equal(latest.import[1], state.import[1])
  await act(async () => root.unmount())
})

test('App declares every modal through the reducer, not separate useState calls', () => {
  const app = fs.readFileSync(require.resolve('../src/App.tsx'), 'utf8')
  for (const name of ['WebsiteUrlModal', 'ImportModal', 'BackupRestoreModal', 'StageSettingsModal', 'StageToolsModal', 'ThemeModal', 'JsonModal', 'HeaderKeyPicker', 'SetlistDrawer', 'TvPresentationModal']) {
    assert.match(app, new RegExp(`const \\[is${name}Open, setIs${name}Open\\] = modals\\.`), name)
  }
})
