const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }
).outputText, filename)
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { StageSettingsModal } = require('../src/components/StageSettingsModal.tsx')
const { CloudSyncModal } = require('../src/components/CloudSyncModal.tsx')
const { AuthContext } = require('../src/utils/authContext.ts')
const { useGoogleAuth } = (() => {
  require.extensions['.png'] = module => { module.exports = '/logo.png' }
  return require('../src/components/AuthGate.tsx')
})()

async function harness(run) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.test' })
  const keys = ['window', 'document', 'navigator', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT', 'sessionStorage', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLElement', 'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent']
  const previous = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(global, k)]))
  for (const [k, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true, sessionStorage: dom.window.sessionStorage, HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, requestAnimationFrame: callback => setTimeout(() => callback(Date.now()), 0), cancelAnimationFrame: clearTimeout })) Object.defineProperty(global, k, { value, configurable: true, writable: true })
  const nativeSetTimeout = global.setTimeout
  const timers = new Set()
  global.setTimeout = (callback, delay, ...args) => { const timer = nativeSetTimeout(callback, delay, ...args); timers.add(timer); return timer }
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  let root = createRoot(document.getElementById('root')), mounted = true
  const unmount = async () => { if (mounted) { await act(async () => root.unmount()); mounted = false } }
  const render = element => act(async () => root.render(element))
  const props = { isOpen: true, onClose() {}, fontStyle: 'mono', onSelectFontStyle() {}, isTwoColumn: false, onToggleTwoColumn() {}, onOpenStageTools() {}, onToggleTheme() {} }
  const mountSettings = () => render(React.createElement(React.StrictMode, null, React.createElement(StageSettingsModal, props)))
  const toggle = () => act(async () => {
    const label = [...document.querySelectorAll('div')].find(el => el.textContent.trim() === 'Keep screen awake during performance')
    const button = label?.parentElement?.parentElement?.parentElement?.querySelector('button')
    assert.ok(button, 'wake-lock toggle exists')
    button.click()
  })
  try { await run({ render, schedule: element => root.render(element), mountSettings, toggle, unmount }) }
  finally { await unmount(); for (const timer of timers) clearTimeout(timer); global.setTimeout = nativeSetTimeout; dom.window.close(); for (const [k, descriptor] of previous) { if (descriptor) Object.defineProperty(global, k, descriptor); else delete global[k] } }
}

test('Wake lock: one request across rerenders; toggle-off releases exactly once', async () => harness(async h => {
  let requests = 0, releases = 0
  navigator.wakeLock = { request: async () => { requests++; return { release: async () => { releases++ } } } }
  await h.mountSettings(); await h.toggle()
  assert.equal(requests, 1)
  for (let i = 0; i < 5; i++) await h.mountSettings()
  assert.equal(requests, 1)
  await h.toggle(); assert.equal(releases, 1)
  await h.unmount(); assert.equal(releases, 1)
}))

test('Wake lock: acquired sentinel is released on unmount', async () => harness(async h => {
  let releases = 0
  navigator.wakeLock = { request: async () => ({ release: async () => { releases++ } }) }
  await h.mountSettings(); await h.toggle(); await h.unmount()
  assert.equal(releases, 1)
}))

for (const teardown of ['toggle-off', 'unmount']) test(`Wake lock: late acquisition after ${teardown} is released without a stale toast`, async () => harness(async h => {
  let resolve, releases = 0
  navigator.wakeLock = { request: () => new Promise(r => { resolve = r }) }
  await h.mountSettings(); await h.toggle()
  if (teardown === 'unmount') await h.unmount(); else await h.toggle()
  await act(async () => resolve({ release: async () => { releases++ } }))
  assert.equal(releases, 1)
  assert.doesNotMatch(document.body.textContent, /Stage Wake Lock active/)
}))

test('Wake lock: unsupported browser shows feedback without a declaration-order exception', async () => harness(async h => {
  delete navigator.wakeLock
  await h.mountSettings(); await h.toggle()
  assert.match(document.body.textContent, /Wake Lock not supported/)
}))

test('Cloud sync optional context: absent/present/absent rerenders preserve hook order and stay idle without a token', async () => harness(async h => {
  let notifications = 0
  const modal = () => React.createElement(CloudSyncModal, { isOpen: true, onClose() {}, onSyncStateChange() { notifications++ } })
  for (const value of [null, { session: null, accessStatus: 'active' }, null]) {
    await h.render(React.createElement(React.StrictMode, null, React.createElement(AuthContext.Provider, { value }, modal())))
    assert.match(document.body.textContent, /Cloud Songbook Sync/)
    assert.match(document.body.textContent, /[Ss]ign/)
  }
  assert.ok(notifications > 0)
}))

test('Strict auth hook still requires the authentication boundary', () => {
  const { renderToString } = require('react-dom/server')
  function Outside() { useGoogleAuth(); return null }
  assert.throws(() => renderToString(React.createElement(Outside)), /Authentication boundary is required/)
})

test('Lint guards: named export exceptions stay file-scoped; new exports and effect mutations remain errors', async () => {
  const { ESLint } = require('eslint')
  const path = require('node:path')
  const eslint = new ESLint({ cwd: path.resolve(__dirname, '..') })
  const sample = name => `import React from 'react'; export function ${name}() { return 1 }; export function Example() { return <div/> }`
  const messages = async (source, filePath) => (await eslint.lintText(source, { filePath }))[0].messages
  assert.equal((await messages(sample('normalizeCustomThemeColors'), 'src/components/ThemeModal.tsx')).length, 0)
  assert.ok((await messages(sample('unexpectedHelper'), 'src/components/ThemeModal.tsx')).some(m => m.ruleId === 'react-refresh/only-export-components'))
  assert.ok((await messages(sample('normalizeCustomThemeColors'), 'src/components/NewModal.tsx')).some(m => m.ruleId === 'react-refresh/only-export-components'))
  assert.ok((await messages(`import {useState,useEffect} from 'react'; export function Example(){const [value,setValue]=useState(0);useEffect(()=>{setValue(1)},[]);return <div>{value}</div>}`, 'src/components/ThemeModal.tsx')).some(m => m.ruleId === 'react-hooks/set-state-in-effect'))
})

test('Swipe committed refs: armed release uses the current committed gesture; disabled cards cannot act', async () => harness(async h => {
  const { SwipeableActionCard } = require('../src/components/SwipeableActionCard.tsx')
  let actions = 0
  const render = disabled => h.render(React.createElement(SwipeableActionCard, { id: 'lint-gesture', disabled, dataTestId: 'gesture', rightAction: { icon: null, label: 'Delete', onAction() { actions++ } } }, React.createElement('span', null, 'Song')))
  const touch = async (type, x, y) => act(async () => {
    const event = new window.Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: y }] })
    document.querySelector('[data-testid="gesture"]').dispatchEvent(event)
  })
  await render(false)
  await touch('touchstart', 200, 50); await touch('touchmove', 100, 50)
  assert.equal(document.querySelector('[data-testid="swipe-action-right-lint-gesture"]').dataset.armed, 'true')
  await touch('touchend', 100, 50); assert.equal(actions, 1)
  await touch('touchstart', 200, 50); await touch('touchmove', 100, 50)
  await render(true); await touch('touchend', 100, 50)
  assert.equal(actions, 1)
}))

// Type-only protocol cleanup retains all established aliases and unknown-input guards.
test('Band sync wire types preserve alias conversion, null rejection, incoming payloads and setlist wire content', () => {
  const { bandSync } = require('../src/utils/bandSync.ts')
  const received = []
  const off = bandSync.onMessage(msg => received.push(msg))
  try {
    for (const input of [null, undefined, false, 42, 'invalid']) {
      bandSync.handleWebSocketMessage(input)
      bandSync.handleIncoming(input)
    }
    assert.equal(received.length, 0)
    bandSync.handleWebSocketMessage({ type: 'SONG_CHANGE', title: 'Example', queueType: 'setlist', setlistIndex: 2, offset: 3, content: '[C]Hello' })
    assert.deepEqual(received[0].payload, { title: 'Example', artist: '', queueType: 'SETLIST', queueIndex: 2, songIndex: 2, songTitle: 'Example', transposeOffset: 3, transpose: 3, scrollProgress: 0, rawContent: '[C]Hello', key: '', capo: '' })
    bandSync.handleWebSocketMessage({ type: 'SETLIST_SYNC', setlistName: 'Gig', songs: [{ title: 'Example', rawContent: '[C]Hello' }] })
    assert.equal(received[1].payload.songs[0].rawContent, '[C]Hello')
    bandSync.handleIncoming({ type: 'SCROLL_SYNC', senderId: 'other-peer', role: 'HOST', payload: { scrollFraction: 0.5 }, timestamp: 1 })
    assert.equal(received[2].payload.scrollFraction, 0.5)
  } finally { off() }
})

const exampleSongs = ['Alpha', 'Beta', 'Gamma'].map((title, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, title, artist: 'Artist', key: 'C', capo: '', bpm: '120', rawContent: '[C]Hello', format: 'CHORD_PRO', transposeOffset: 0 }))

test('Stage navigation refs publish committed state, never a suspended transition', async () => harness(async h => {
  const { StageView } = require('../src/components/StageView.tsx')
  const selected = []
  const never = new Promise(() => {})
  function Block({ pending }) { if (pending) throw never; return null }
  const stage = (index, pending) => React.createElement(React.Suspense, { fallback: 'Pending' },
    React.createElement(StageView, { song: exampleSongs[index], songs: exampleSongs, activeSongIndex: index, onSelectSongIndex: i => selected.push(i), transposeOffset: 0, onTransposeChange() {} }),
    React.createElement(Block, { pending }))
  await h.render(stage(0, false))
  await act(async () => React.startTransition(() => { h.schedule(stage(1, true)) }))
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 230))
  })
  assert.deepEqual(selected, [1], 'navigation comes from committed Alpha, not suspended Beta')
}))

test('App band subscription uses the latest selected song without duplicate listeners or network requests', async () => harness(async h => {
  const { persistLibrary, readPersistedLibrary } = require('../src/utils/syncJournal.ts')
  persistLibrary({ songs: exampleSongs, setlists: [] })
  const { bandSync } = require('../src/utils/bandSync.ts')
  const App = require('../src/App.tsx').default
  const originalRole = bandSync.role
  const originalFetch = global.fetch
  let requests = 0
  global.fetch = async () => { requests++; throw new Error('Unexpected network request') }
  try {
    await h.render(React.createElement(App))
    const card = document.querySelector('[data-testid="song-card-1"]')
    assert.ok(card)
    await act(async () => card.click())
    bandSync.role = 'CLIENT'
    const listeners = bandSync.messageHandlers.size
    await act(async () => bandSync.handleWebSocketMessage({ type: 'SONG', title: 'Beta', artist: 'Artist', transposeOffset: 4 }))
    const songs = readPersistedLibrary().songs
    assert.equal(songs.find(s => s.title === 'Beta').transposeOffset, 4)
    assert.equal(songs.find(s => s.title === 'Alpha').transposeOffset, 0)
    assert.equal(bandSync.messageHandlers.size, listeners)
    assert.equal(requests, 0)
  } finally { await h.unmount(); bandSync.role = originalRole; global.fetch = originalFetch }
}))
