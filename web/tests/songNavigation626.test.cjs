const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React

for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } },
).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
require.extensions['.svg'] = require.extensions['.png']

const songs = ['Alpha', 'Beta', 'Gamma'].map(title => ({
  id: title, title, artist: 'Band', rawContent: '[C]Lyrics', format: 'CHORD_PRO',
  key: 'C', originalKey: 'C', capo: 'No Capo', bpm: '120', transposeOffset: 0,
}))
const folders = [{ id: 'folder', name: 'Rehearsals', parentId: null }]
const setlists = [{ id: 'setlist', name: 'Friday Set', folderId: 'folder', songs: songs.slice(0, 2).map(({ id, title }) => ({ id, title })) }]

async function withApp(run, { resumed = false, width = 1280 } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.test/' })
  const { window } = dom
  const globals = {
    window, document: window.document, localStorage: window.localStorage, navigator: window.navigator,
    Node: window.Node, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
  }
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(global, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(global, key, { configurable: true, writable: true, value })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.innerWidth = width
  window.scrollTo = ({ top }) => { window.scrollY = top }
  const { persistLibrary } = require('../src/utils/syncJournal.ts')
  persistLibrary({ songs, folders, setlists }, window.localStorage)
  if (resumed) {
    const { saveStageSession } = require('../src/utils/stageSession.ts')
    saveStageSession({ isActive: true, queueMode: 'library', songId: 'Beta', songTitle: 'Beta', activeSongIndex: 1 })
    window.history.replaceState({ gtarView: 'stage', gtarDepth: 3, gtarSession: 'previous-session', gtarSongReturnDepth: 0 }, '')
  }

  const App = require('../src/App.tsx').default
  const { createRoot } = require('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  const $ = selector => document.querySelector(selector)
  const button = (name, scope = document) => [...scope.querySelectorAll('button')]
    .find(node => node.getAttribute('aria-label') === name || node.textContent.trim() === name)
  const click = async node => {
    assert.ok(node, 'expected control to be rendered')
    await act(async () => node.click())
  }
  const traverse = async navigate => {
    await act(async () => {
      await Promise.all([
        new Promise(resolve => window.addEventListener('popstate', resolve, { once: true })),
        Promise.resolve().then(navigate),
      ])
    })
  }
  const back = () => traverse(() => window.history.back())
  const stageBack = () => traverse(() => {
    const control = $('[data-testid="toolbar-back"]')
    assert.ok(control, 'Stage Back exists')
    control.click()
  })
  try {
    await act(async () => root.render(React.createElement(App)))
    await run({ $, button, click, back, stageBack, window })
  } finally {
    await act(async () => root.unmount())
    window.close()
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(global, key, descriptor)
      else delete global[key]
    }
  }
}

test('Songbook restores scroll and descending order through repeated Back cycles', { timeout: 10000 }, () => withApp(async ({ $, button, click, stageBack, window }) => {
  await click(button('Title ↑'))
  assert.ok(button('Title ↓'))
  const filter = $('[data-testid="filter-setlist-select"]')
  await act(async () => {
    filter.value = 'setlist'
    filter.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  for (let cycle = 0; cycle < 2; cycle++) {
    const scroll = 350 + cycle * 100
    window.scrollY = scroll
    await click(button('Play Beta in Stage'))
    assert.equal(window.history.state.gtarDepth, 1)
    window.scrollY = 0
    await stageBack()
    assert.ok($('[data-testid="songbook-canvas"]'))
    assert.ok(button('Title ↓'))
    assert.equal($('[data-testid="filter-setlist-select"]').value, 'setlist')
    assert.equal(button('Play Gamma in Stage'), undefined)
    assert.equal(window.scrollY, scroll)
    assert.equal(window.history.state.gtarDepth, 0)
    assert.equal(window.history.length, 2)
  }
}))

test('browser Back reopens compact search results with their query and scroll', { timeout: 10000 }, () => withApp(async ({ $, button, click, back, window }) => {
  await click(button('Open search'))
  const input = $('#search-input')
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Band')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  const results = $('#global-search-results')
  assert.ok(results)
  results.scrollTop = 90
  await click([...results.querySelectorAll('button')].find(node => node.textContent.includes('Beta')))
  await back()
  assert.equal($('#search-input').value, 'Band')
  assert.equal($('#global-search-results').scrollTop, 90)
}, { width: 390 }))

test('Back restores the open setlist inside its folder', { timeout: 10000 }, () => withApp(async ({ $, click, stageBack, window }) => {
  await click([...document.querySelectorAll('button')].find(node => node.textContent.includes('Rehearsals')))
  await click($('[data-testid="workspace-setlist-card-setlist"]'))
  window.scrollY = 260
  await click($('[data-testid="workspace-entry-1"]'))
  window.scrollY = 0
  await stageBack()
  assert.match($('[data-testid="workspace-breadcrumbs"]').textContent, /Rehearsals.*Friday Set/)
  assert.match($('[data-testid="workspace-entry-1"]').textContent, /Beta/)
  assert.equal(window.scrollY, 260)
}))

test('Stage entered without a live origin replaces its entry with Songbook', { timeout: 10000 }, () => withApp(async ({ $, click, window }) => {
  assert.equal(window.history.state.gtarDepth, 0)
  await click($('[data-testid="toolbar-back"]'))
  assert.ok($('[data-testid="songbook-canvas"]'))
  assert.equal(window.history.state.gtarView, 'songbook')
  assert.equal(window.history.length, 1)
}, { resumed: true }))
