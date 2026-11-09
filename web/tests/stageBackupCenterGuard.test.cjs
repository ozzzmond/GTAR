// #303: the Backup & Restore center lives in the header; while it (or its restore preview) is open in Stage view,
// Stage keyboard/pedal shortcuts are paused, exactly as for App-owned modals (isAnyModalOpen).
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
const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.app/', pretendToBeVisual: true })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement, Node: dom.window.Node, Event: dom.window.Event,
  KeyboardEvent: dom.window.KeyboardEvent, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
window.HTMLElement.prototype.scrollBy = function () {}
window.HTMLElement.prototype.scrollTo = function () {}
global.ResizeObserver = window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
global.requestAnimationFrame = window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 16)
global.cancelAnimationFrame = window.cancelAnimationFrame = id => clearTimeout(id)
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { Header } = require('../src/components/Header.tsx')
const { StageView } = require('../src/components/StageView.tsx')
const { persistLibrary } = require('../src/utils/syncJournal.ts')

const songs = ['One', 'Two', 'Three'].map((title, i) => ({ id: `${i + 1}1111111-1111-4111-8111-111111111111`, title, artist: 'A', key: 'C',
  rawContent: '{start_of_verse}\n[C]Verse line\n{end_of_verse}\n{start_of_chorus}\n[G]Chorus line\n{end_of_chorus}', transposeOffset: 0 }))
const noop = () => {}

// Same wiring as App.tsx: the header reports its dialogs, App folds them into StageView's isAnyModalOpen.
function Harness({ onSelect }) {
  const [headerOverlay, setHeaderOverlay] = React.useState(false)
  const [index, setIndex] = React.useState(1)
  return React.createElement(React.Fragment, null,
    React.createElement(Header, { activeView: 'stage', song: songs[index], searchQuery: '', onViewChange: noop, onSearchQueryChange: noop,
      onOpenWebsiteUrlSource: noop, onOpenStageTools: noop, onToggleTheme: noop, onOpenStageSettings: noop, onOpenImportModal: noop,
      backupSongs: songs, onOverlayChange: setHeaderOverlay }),
    React.createElement(StageView, { song: songs[index], songs, activeSongIndex: index, onSelectSongIndex: i => { onSelect(i); setIndex(i) },
      onOpenSetlistDrawer: noop, transposeOffset: 0, onTransposeChange: noop, isAnyModalOpen: headerOverlay }))
}

const press = key => {
  const event = new window.KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true })
  act(() => { window.dispatchEvent(event) })
  return event.defaultPrevented
}
const KEYS = [' ', 'ArrowRight', 'ArrowLeft', 'PageUp', 'PageDown']

test('Stage shortcuts pause while the Backup & Restore center is open and work again after closing', async () => {
  localStorage.clear(); persistLibrary({ songs, setlists: [] }, localStorage)
  const selected = []
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(Harness, { onSelect: i => selected.push(i) })))
    await act(async () => document.querySelector('[data-testid="header-settings"]').click())
    await act(async () => document.querySelector('[data-testid="settings-backup-restore-button"]').click())
    assert.ok(document.querySelector('[data-testid="cloud-sync-modal-card"]'), 'center open over Stage')
    for (const key of KEYS) assert.equal(press(key), false, `${JSON.stringify(key)} ignored while the center is open`)
    assert.deepEqual(selected, [], 'no song change behind the dialog')

    // Its restore preview is part of the center: still paused.
    const input = document.querySelector('[data-testid="restore-file-input"]')
    Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => JSON.stringify({ songs: [songs[0]], setlists: [] }) }] })
    await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 5)) })
    assert.ok(document.querySelector('[data-testid="restore-preview"]'))
    for (const key of KEYS) assert.equal(press(key), false, `${JSON.stringify(key)} ignored during the restore preview`)
    assert.deepEqual(selected, [])

    await act(async () => document.querySelector('[data-testid="cloud-sync-close-button"]').click())
    assert.equal(document.querySelector('[data-testid="cloud-sync-modal-card"]'), null)
    // Song navigation is debounced and animated, so each key gets time to finish.
    const settle = () => act(async () => new Promise(r => setTimeout(r, 700)))
    for (const key of KEYS) { assert.equal(press(key), true, `${JSON.stringify(key)} handled again after closing`); await settle() }
    assert.deepEqual(selected, [2, 1], 'ArrowRight / ArrowLeft change songs again')
  } finally {
    await act(async () => root.unmount())
  }
})

test('App folds the header dialogs and the Recovery data panel into the Stage overlay guard', () => {
  const app = fs.readFileSync(require.resolve('../src/App.tsx'), 'utf8')
  assert.match(app, /onOverlayChange=\{setIsHeaderOverlayOpen\}/)
  const guard = app.slice(app.indexOf('isAnyModalOpen={'), app.indexOf('onBack={() => setActiveView(\'songbook\')}'))
  for (const flag of ['isHeaderOverlayOpen', 'recoveryDataOpen']) assert.ok(guard.includes(flag), flag)
  const header = fs.readFileSync(require.resolve('../src/components/Header.tsx'), 'utf8')
  assert.match(header, /const headerOverlayOpen = showCloudSyncModal \|\| showDebugLogsModal/)
})
