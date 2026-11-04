// #361: the header search stays available in the Stage preview (Back / Editor / Band Sync) and the
// Ctrl/Cmd+K shortcut follows it. Fullscreen/performance mode still hides the whole header (App.tsx).
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
// React reads DOM support at import time; boot with a window so its event system,
// including controlled input onChange, attaches for the per-test documents below.
const boot = new JSDOM('<html><body></body></html>')
global.window = boot.window
global.document = boot.window.document
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
boot.window.close()

const noop = () => {}
const song = (title, id) => ({ id, title, artist: 'Artist', key: 'G', transposeOffset: 0,
  rawContent: `{title: ${title}}\n{key: G}\n[G]${title} line` })

function headerProps(extra = {}) {
  return { activeView: 'stage', onViewChange: noop, song: song('Alpha', 'one'), searchQuery: '',
    onSearchQueryChange: noop, onOpenWebsiteUrlSource: noop, onOpenStageTools: noop, onToggleTheme: noop,
    onOpenStageSettings: noop, onOpenImportModal: noop, ...extra }
}

async function ui(width, run) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'https://gtar.test/', pretendToBeVisual: true })
  const keys = ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLInputElement',
    'HTMLTextAreaElement', 'Node', 'Event', 'KeyboardEvent', 'CustomEvent', 'fetch', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
  Object.assign(global, { window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement, Node: dom.window.Node, Event: dom.window.Event,
    KeyboardEvent: dom.window.KeyboardEvent, CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
  dom.window.innerWidth = width
  dom.window.innerHeight = 800
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  dom.window.HTMLElement.prototype.scrollBy = function () {}
  dom.window.HTMLElement.prototype.scrollTo = function () {}
  global.ResizeObserver = dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  global.requestAnimationFrame = dom.window.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 16)
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame = id => clearTimeout(id)
  await act(async () => new Promise(resolve => setTimeout(resolve, 25)))
  const root = createRoot(dom.window.document.getElementById('root'))
  const render = async (component, props) => act(async () => root.render(React.createElement(component, props)))
  const click = async node => { assert.ok(node, 'control exists'); await act(async () => node.click()) }
  const press = async (key, options = {}) => {
    const event = new dom.window.KeyboardEvent('keydown', { key, code: options.code ?? key, bubbles: true, cancelable: true, ...options })
    await act(async () => { window.dispatchEvent(event) })
    return event
  }
  try { await run({ dom, root, render, click, press }) }
  finally {
    await act(async () => root.unmount())
    dom.window.close()
    Object.assign(global, previous)
  }
}

function load(relativePath) {
  const resolved = require.resolve(relativePath)
  delete require.cache[resolved]
  return require(relativePath)
}

test('STAGE_SEARCH_DESKTOP: Header renders the search field in Stage view', async () => {
  await ui(1280, async ({ render, press }) => {
    const { Header } = load('../src/components/Header.tsx')
    const cleared = []
    await render(Header, headerProps({ searchQuery: 'alpha', onSearchQueryChange: value => cleared.push(value) }))
    const input = document.getElementById('search-input')
    assert.ok(input, 'desktop Stage shows the global search input')
    assert.equal(input.getAttribute('aria-label'), 'Search songs, artists and setlists')
    assert.equal(input.getAttribute('placeholder'), 'Search songs & setlists... (Esc to clear)')
    assert.ok(document.querySelector('form[role="search"][aria-label="Global song search"]'))
    assert.equal(document.querySelector('[aria-label="Open search"]'), null, 'desktop uses the inline field, not the compact trigger')
    await press('Escape')
    assert.deepEqual(cleared, [''], 'Escape clears search in Stage like the other pages')
  })
})

test('STAGE_SEARCH_COMPACT: Header keeps the compact trigger and overlay in Stage view', async () => {
  await ui(360, async ({ render, click, press }) => {
    const { Header } = load('../src/components/Header.tsx')
    await render(Header, headerProps())
    const trigger = document.querySelector('[aria-label="Open search"]')
    assert.ok(trigger, 'compact Stage shows the search trigger')
    assert.equal(document.getElementById('search-input'), null, 'overlay starts closed')
    await click(trigger)
    const input = document.getElementById('search-input')
    assert.ok(input, 'trigger opens the compact search overlay')
    assert.ok(document.activeElement === input, 'overlay focuses the input')
    assert.ok(document.querySelector('[role="search"][aria-label="Mobile expanded song search"]'))
    await press('Escape')
    assert.equal(document.getElementById('search-input'), null, 'Escape closes the overlay in Stage')
  })
})

test('STAGE_SEARCH_SHORTCUT: Ctrl/Cmd+K focuses the Stage search field', async () => {
  await ui(1280, async ({ render, press }) => {
    const { Header } = load('../src/components/Header.tsx')
    await render(Header, headerProps())
    const input = () => document.getElementById('search-input')
    assert.ok(input(), 'search field is rendered in Stage')
    assert.ok(document.activeElement !== input(), 'search starts unfocused')
    for (const modifier of ['ctrlKey', 'metaKey']) {
      document.activeElement.blur()
      await press('k', { [modifier]: true })
      assert.ok(document.activeElement === input(), `${modifier} focuses search in Stage`)
    }
  })
})

test('STAGE_SEARCH_TYPING: typing in the Stage search field never runs a Stage shortcut', async () => {
  await ui(1280, async ({ render, press }) => {
    const { Header } = load('../src/components/Header.tsx')
    const { StageView } = load('../src/components/StageView.tsx')
    const songs = [song('Alpha', 'one'), song('Beta', 'two')]
    const selected = []
    function Harness() {
      return React.createElement(React.Fragment, null,
        React.createElement(Header, headerProps({ song: songs[0] })),
        React.createElement(StageView, { song: songs[0], songs, activeSongIndex: 0,
          onSelectSongIndex: index => selected.push(index), transposeOffset: 0, onTransposeChange: noop }))
    }
    await render(Harness, {})
    const input = document.getElementById('search-input')
    assert.ok(input)
    const autoscroll = () => document.querySelector('[aria-label^="Start autoscroll"]')
    assert.ok(autoscroll(), 'Stage starts with autoscroll paused')
    await act(async () => input.focus())
    for (const key of ['t', ' ', 'n', 'p']) {
      const event = new window.KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true })
      await act(async () => { input.dispatchEvent(event) })
    }
    // Stage song changes animate; give any wrongly triggered navigation time to land.
    await act(async () => new Promise(resolve => setTimeout(resolve, 700)))
    assert.deepEqual(selected, [], 'n/p typed into search never changes the Stage song')
    assert.ok(autoscroll(), 'space typed into search never toggles autoscroll')
    // Control: the same keys still drive Stage when focus is not in a text field.
    await press(' ', { code: 'Space' })
    assert.equal(autoscroll(), null, 'space outside the search field still toggles autoscroll')
    assert.ok(document.querySelector('[aria-label^="Pause autoscroll"]'))
  })
})

test('STAGE_SEARCH_SAFE_NAVIGATION: choosing a result from Stage stays in Stage and keeps search', async () => {
  await ui(1280, async ({ render, click }) => {
    const alpha = song('Alpha', '11111111-1111-4111-8111-111111111111')
    const beta = song('Beta', '22222222-2222-4222-8222-222222222222')
    localStorage.setItem('gtar_library_v1', JSON.stringify({ songs: [alpha, beta], setlists: [] }))
    const previousFetch = global.fetch
    global.fetch = async () => { throw new Error('offline') }
    try {
      const App = load('../src/App.tsx').default
      await render(App, {})
      await click(document.querySelector('[data-testid="song-card-0"]'))
      assert.ok(document.querySelector('[aria-label="Editor"]'), 'song opens in Stage')
      assert.equal(document.querySelector('h1.ui-primary-text').textContent, 'Alpha')
      const input = document.getElementById('search-input')
      assert.ok(input, 'Stage keeps the header search')
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Beta')
        input.dispatchEvent(new window.Event('input', { bubbles: true }))
      })
      const results = document.querySelector('[data-testid="global-search-results"]')
      assert.ok(results, 'search results open over Stage')
      const row = [...results.querySelectorAll('button')].find(button => button.textContent.includes('Beta'))
      await click(row)
      assert.equal(document.querySelector('h1.ui-primary-text').textContent, 'Beta', 'result navigates to the chosen song')
      assert.ok(document.querySelector('[aria-label="Editor"]'), 'Stage stays the active view')
      assert.ok(document.getElementById('search-input'), 'search stays available after navigating')
    } finally { global.fetch = previousFetch }
  })
})
