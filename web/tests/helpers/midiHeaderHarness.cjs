// Mounts the real Header (Advanced Tools menu and its dialogs) on jsdom with a fake Web MIDI
// navigator, for the #536 row and dialog tests. Loading this file sets up the globals.
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.app/' })
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true, isSecureContext: true, FormData: dom.window.FormData })
window.matchMedia = () => ({ matches: false })
const fake = require('./fakeMidi.cjs')

/** Replaces the global navigator with a fake Web MIDI one. */
function useNavigator(options = {}) {
  const nav = fake.fakeNavigator(options)
  Object.defineProperty(global, 'navigator', { configurable: true, value: nav })
  return nav
}
useNavigator()

const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const Module = require('node:module'), originalLoad = Module._load
Module._load = function (request, parent, ...args) {
  if (parent?.filename && /[\\/]components[\\/]Header\.tsx$/.test(parent.filename)) {
    if (request === '../utils/env') return { isDevEnv: false }
    if (request.endsWith('.png')) return 'logo.png'
    if (request === '../utils/onlineSearch') return {}
    if (request.startsWith('./') && request.endsWith('Modal')) return new Proxy({}, { get: () => () => null })
  }
  return originalLoad.call(this, request, parent, ...args)
}
const { Header } = require('../../src/components/Header.tsx')
Module._load = originalLoad
const midi = require('../../src/midi/loader.ts')

const KEY = 'gtar_midi_v1'
const noop = () => {}
const song = { id: 's1', title: 'A', rawContent: 'C' }
const props = { activeView: 'songbook', song, searchQuery: '', onViewChange: noop, onSearchQueryChange: noop, onOpenWebsiteUrlSource: noop,
  onToggleTheme: noop, onOpenStageSettings: noop, onOpenImportModal: noop, backupSongs: [song] }
const q = selector => document.querySelector(selector)
/** Runs `action`, then lets MIDI promises and React settle. */
const run = action => act(async () => { await action?.(); await fake.settle() })
const click = el => run(() => el.click())
const key = (name, init = {}) => run(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })))
const wrench = () => q('[data-testid="header-advanced-tools"]')
const popover = () => q('[data-testid="advanced-tools-popover"]')
/** Text a sighted user sees in an element: its leaf spans, minus screen-reader-only ones. */
const visibleText = el => [...el.querySelectorAll('span')].filter(span => !span.classList.contains('sr-only') && !span.children.length && span.textContent).map(span => span.textContent)

/** MIDI off, empty storage and a Chrome navigator with the given fake MIDI. Call before each mount. */
function reset(navOptions = {}) {
  useNavigator()
  midi.setMidiEnabled(false)
  localStorage.clear()
  return useNavigator(navOptions)
}
const leftOn = () => localStorage.setItem(KEY, JSON.stringify({ version: 1, enabled: true, device: 'all', channel: 'all', mappings: {} }))

async function mountHeader(extra = {}) {
  const container = document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  await run(() => root.render(React.createElement(Header, { ...props, ...extra })))
  return { unmount: () => run(() => root.unmount()) }
}
async function openPopover() {
  if (!popover()) await click(wrench())
  return popover()
}
async function openMidiDialog() {
  await openPopover()
  await click(q('[data-testid="midi-expand"]'))
  return q('[data-testid="midi-panel"]')
}
/** Makes the lazy engine import fail, as a missing or broken chunk would. Returns the undo. */
function breakEngineLoad() {
  const original = Module._load
  Module._load = function (request, parent, ...rest) {
    if (request === './engine' && /[\\/]midi[\\/]loader\.ts$/.test(parent?.filename ?? '')) throw new Error('Failed to fetch dynamically imported module')
    return original.call(this, request, parent, ...rest)
  }
  return () => { Module._load = original }
}

module.exports = { ...fake, KEY, midi, q, run, click, key, wrench, popover, visibleText, reset, leftOn, mountHeader, openPopover, openMidiDialog, breakEngineLoad, useNavigator }
