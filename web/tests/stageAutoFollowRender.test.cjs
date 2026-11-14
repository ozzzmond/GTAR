const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
const Module = require('node:module'), resolve = Module._resolveFilename
Module._resolveFilename = function(request, parent, ...args) {
  try { return resolve.call(this, request, parent, ...args) } catch (error) {
    if (request.startsWith('.') && parent) for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const file = path.resolve(path.dirname(parent.filename), request + ext)
      if (fs.existsSync(file)) return file
    }
    throw error
  }
}
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename)

const React = require('react'), { act } = React
const { JSDOM } = require('jsdom')

test('real StageView native-timer Auto Follow survives enable, navigation and lifecycle changes', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dev.example/', pretendToBeVisual: true })
  const restore = []
  let fsElement = null
  const frames = new Map(); let nextFrame = 0
  const nativeSetTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout
  const pending = new Map(); let nextTimer = -1
  const setTimeout = function(callback, delay, ...args) {
    if (this !== globalThis) throw new TypeError('Illegal invocation')
    if (delay === 300) { const id = nextTimer--; pending.set(id, () => callback(...args)); return id }
    return nativeSetTimeout(callback, delay, ...args)
  }
  const clearTimeout = function(id) {
    if (this !== globalThis) throw new TypeError('Illegal invocation')
    if (pending.has(id)) pending.delete(id)
    else nativeClearTimeout(id)
  }
  const globals = { setTimeout, clearTimeout, window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame }, cancelAnimationFrame: id => frames.delete(id),
    IS_REACT_ACT_ENVIRONMENT: true, __GTAR_SETLIST_AUTO_FOLLOW_DEV__: true }
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    restore.push(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key])
  }
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsElement })
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  HTMLElement.prototype.scrollTo = function(options) { this.scrollTop = options.top ?? 0 }
  const { createRoot } = require('react-dom/client')
  const { StageView } = require('../src/components/StageView.tsx')
  const { StageErrorBoundary } = require('../src/components/StageErrorBoundary.tsx')
  const { ExtensionHostContext } = require('../src/extensions/host/ExtensionHostContext.ts')
  const { ExtensionHost } = require('../src/extensions/host/ExtensionHost.ts')
  const { projectFollowSetlist } = require('../src/utils/setlistAutoFollow.ts')
  const { appLogger } = require('../src/utils/logger.ts')
  const errors = []
  t.mock.method(appLogger, 'error', (...args) => errors.push(args))
  t.mock.method(console, 'error', () => {})
  let ctx
  const manifest = { id: 'propresenter-follower', name: 'Fixture', version: '1', contractVersion: 1, summary: '', capabilities: [], settings: [] }
  const entry = { manifest, checkAvailability: () => ({ available: true }), load: async () => ({ manifest, checkAvailability: () => ({ available: true }), activate: value => { ctx = value; return () => {} } }) }
  const host = new ExtensionHost([entry], { getItem: () => null, setItem() {} })
  await host.enable(manifest.id)
  const songs = [1, 2, 3].map(id => ({ id, title: `Synthetic song ${id}`, artist: '', key: 'C', originalKey: 'C', confirmedChartKey: 'C', transposeOffset: id, rawContent: `{title: Synthetic song ${id}}\n[C]A synthetic lyric line`, format: 'CHORD_PRO', capo: '', bpm: '' }))
  const list = { id: 'active', name: 'QA', songs: songs.map((song, index) => ({ id: song.id, entryId: `entry-${index}`, position: index, title: song.title })) }
  const followSetlist = projectFollowSetlist('active', 'setlist', list, songs)
  const selections = [], transposes = []
  const before = JSON.stringify({ songs, list })
  let manuallySelect
  const root = createRoot(document.getElementById('root'))
  const boundary = React.createRef()
  function Harness() {
    const [index, setIndex] = React.useState(0)
    const [manualRevision, setManualRevision] = React.useState(0)
    const [origin, setOrigin] = React.useState(false)
    manuallySelect = index => { setManualRevision(value => value + 1); setOrigin(false); setIndex(index) }
    return React.createElement(ExtensionHostContext.Provider, { value: host },
      React.createElement(StageErrorBoundary, { ref: boundary }, React.createElement(StageView, {
        song: songs[index], songs, activeSongIndex: 0, onSelectSongIndex() {}, queueMode: 'setlist', isInSetlistMode: true,
        activeSetlistSongs: songs, activeSetlistSongIndex: index, onSelectSetlistSongIndex: manuallySelect, activeSetlistName: 'QA',
        followSetlist, followManualRevision: manualRevision, isProPresenterSelection: origin, onFollowSetlistEntry: request => { if (!request.isCurrent()) return false; selections.push(request.index); setOrigin(true); setIndex(request.index); return true },
        transposeOffset: songs[index].transposeOffset, onTransposeChange: (...args) => transposes.push(args),
      })))
  }
  let revision = 0
  const healthy = () => assert.equal(boundary.current.state.hasError, false, JSON.stringify(errors))
  const emit = async (index, live = true, title = songs[index].title) => act(async () => ctx.publishFollowSnapshot({ live, identityRevision: ++revision, presentation: { uuid: `p-${index}-${title}`, title, slideIndex: 0 }, current: { uuid: `slide-${index}`, text: 'A synthetic lyric line' } }))
  const tick = async () => act(async () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback()) })
  const fullscreen = async enabled => act(async () => { fsElement = enabled ? document.documentElement : null; document.dispatchEvent(new window.Event('fullscreenchange')) })
  const click = async text => act(async () => {
    const button = [...document.querySelectorAll('button')].find(el => el.textContent.includes(text))
    assert.ok(button, text); assert.equal(button.disabled, false, text); button.click()
  })
  try {
    await act(async () => root.render(React.createElement(Harness)))
    healthy(); await fullscreen(true); await emit(1)
    document.querySelector('[data-testid="live-lyrics-control"]').open = true
    await click('Enable Auto Follow')
    await emit(1) // The real field failure also surfaced on the next layout/update.
    healthy(); await tick(); healthy(); assert.deepEqual(selections, [1])
    for (let i = 0; i < 3; i++) {
      await click('Use Assisted mode'); healthy()
      await click('Enable Auto Follow'); await tick(); healthy()
    }
    for (const index of [2, 1, 0]) { await emit(index); await tick(); healthy() }
    assert.deepEqual(selections, [1, 2, 1, 0])
    await emit(1); await act(async () => manuallySelect(2)); await tick(); healthy()
    assert.deepEqual(selections, [1, 2, 1, 0])
    await click('Resume Auto Follow'); await tick(); healthy(); assert.equal(selections.at(-1), 1)
    const count = selections.length
    await emit(0); await fullscreen(false); await tick(); healthy(); assert.equal(selections.length, count)
    await fullscreen(true); await emit(2); await tick(); healthy(); assert.equal(selections.length, count)
    await click('Resume Auto Follow'); await tick(); healthy(); assert.equal(selections.at(-1), 2)
    await emit(0, false); await tick(); healthy()
    const disconnectedCount = selections.length
    await emit(1); await tick(); healthy(); assert.equal(selections.length, disconnectedCount)
    await click('Resume Auto Follow'); await tick(); healthy(); assert.equal(selections.at(-1), 1)
    const insideCount = selections.length
    await emit(0, true, 'Outside current setlist'); await tick(); healthy(); assert.equal(selections.length, insideCount)
    assert.match(document.querySelector('[data-testid="setlist-auto-follow"]').textContent, /Not in current setlist/)
    assert.equal(JSON.stringify({ songs, list }), before)
    assert.deepEqual(transposes, [])
    assert.deepEqual(errors, [])
    await act(async () => host.disable(manifest.id)); await tick(); healthy()
  } finally {
    await act(async () => root.unmount()); host.dispose(); dom.window.close(); restore.reverse().forEach(fn => fn())
  }
})
