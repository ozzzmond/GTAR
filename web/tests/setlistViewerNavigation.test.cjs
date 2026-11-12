const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:true})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }
).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const { JSDOM } = require('jsdom')
const bootDom = new JSDOM('<!doctype html>')
Object.assign(global, { window: bootDom.window, document: bootDom.window.document })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

async function ui(run) {
  const dom = new JSDOM('<button id="opener">Open</button><div id="root"></div>', { url: 'http://localhost' })
  const keys = ['window', 'document', 'Node', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
  Object.assign(global, { window: dom.window, document: dom.window.document, Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia = () => ({ matches: false })
  const root = createRoot(document.getElementById('root'))
  const click = async node => { assert.ok(node, 'control exists'); await act(async () => node.click()) }
  const render = async (component, props) => act(async () => root.render(React.createElement(component, props)))
  try { await run({ root, click, render }) }
  finally { await act(async () => root.unmount()); dom.window.close(); Object.assign(global, previous) }
}

const song = (id, title) => ({ id, title, artist: 'QA Band', key: 'C', format: 'CHORD_PRO',
  transposeOffset: 0, rawContent: `{title: ${title}}\n{key: C}\n[C]Lyrics` })
const library = [song('outside', 'Outside the setlist'), song('alpha', 'Alpha'), song('beta', 'Beta'),
  song('other', 'Another library song'), { ...song('trashed', 'Trashed song'), isDeleted: true }]
const entries = [library[2], library[1], library[2]].map((s, i) => ({ id: s.id, title: s.title, entryId: `entry-${i}` }))
const $ = selector => document.querySelector(selector)
const pause = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 550)) })
const position = () => $('[aria-label="Open setlist / library"]').textContent.replace(/\s/g, '')

async function app(run, setlistEntries = entries) {
  await ui(async ({ render, click }) => {
    const keys = ['sessionStorage', 'Event', 'CustomEvent', 'fetch', 'requestAnimationFrame', 'cancelAnimationFrame']
    const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
    Object.assign(global, { sessionStorage: window.sessionStorage, Event: window.Event, CustomEvent: window.CustomEvent,
      fetch: async () => { throw new Error('offline') }, requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout })
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    localStorage.setItem('gtar_library_v1', JSON.stringify({ songs: library,
      setlists: [{ id: 'qa-set', name: 'QA Set', songs: setlistEntries }] }))
    try {
      await render(require('../src/App.tsx').default, {})
      await run({ click })
    } finally { Object.assign(global, previous) }
  })
}

async function openSetlist(click, entry = 0) {
  await click($('[data-testid="explorer-sidebar"] [data-testid="explorer-nav-all-setlists"]'))
  await click($('[data-testid="workspace-setlist-card-qa-set"]'))
  await click($(`[data-testid="workspace-entry-${entry}"]`))
}

async function swipe(direction) {
  const canvas = document.querySelector('main .overflow-y-auto.overflow-x-hidden')
  assert.ok(canvas, 'real viewer canvas')
  for (const [type, x] of [['touchstart', 200], ['touchmove', direction === 'next' ? 60 : 340], ['touchend', direction === 'next' ? 60 : 340]]) {
    const event = new window.Event(type, { bubbles: true, cancelable: true })
    const point = { clientX: x, clientY: 100, identifier: 1 }
    Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [point] }, changedTouches: { value: [point] } })
    await act(async () => canvas.dispatchEvent(event))
  }
  await pause()
}

test('#453 setlist row opens its exact queue position; arrows and swipes preserve duplicate occurrences', async () => app(async ({ click }) => {
  await openSetlist(click)
  assert.equal(position(), '1/3')
  assert.equal($('[aria-label="Previous Song"]').disabled, true)
  await click($('[aria-label="Next Song"]')); await pause()
  assert.equal(position(), '2/3')
  assert.match(document.querySelector('main').textContent, /Alpha/)
  await swipe('next')
  assert.equal(position(), '3/3')
  assert.match(document.querySelector('main').textContent, /Beta/)
  assert.equal($('[aria-label="Next Song"]').disabled, true)
  await swipe('prev')
  assert.equal(position(), '2/3')
  await click($('[aria-label="Previous Song"]')); await pause()
  assert.equal(position(), '1/3')
}))

test('#453 viewer Back returns to the originating setlist page', async () => app(async ({ click }) => {
  await openSetlist(click)
  await click($('[aria-label="Next Song"]')); await pause()
  await click($('[data-testid="toolbar-back"]'))
  assert.match($('[data-testid="workspace-setlist-header"]')?.textContent ?? '', /QA Set/)
  assert.ok($('[data-testid="workspace-entry-2"]'))
}))

test('#453 Open button selects a duplicate occurrence; Play in Stage keeps the same queue', async () => app(async ({ click }) => {
  await openSetlist(click)
  await click($('[data-testid="toolbar-back"]'))
  await click($('[data-testid="workspace-entry-open-2"]'))
  assert.equal(position(), '3/3', 'Open keeps the last occurrence, rather than finding the first matching song')
  await click($('[data-testid="toolbar-back"]'))
  await click($('[data-testid="workspace-entry-play-1"]'))
  assert.equal(position(), '2/3')
  await click($('[data-testid="toolbar-back"]'))
  await click($('[data-testid="workspace-play-setlist"]'))
  assert.equal(position(), '1/3')
}))

test('#453 broken shortcuts remain disabled and viewer navigation handles unavailable entries', async () => app(async ({ click }) => {
  await openSetlist(click, 1)
  assert.equal(position(), '2/5')
  await click($('[aria-label="Previous Song"]')); await pause()
  assert.equal(position(), '1/5')
  assert.match(document.querySelector('main [role="alert"]').textContent, /Missing song: Gone/)
  await click($('[aria-label="Next Song"]')); await pause()
  await click($('[aria-label="Next Song"]')); await pause()
  assert.equal(position(), '3/5')
  assert.match(document.querySelector('main [role="alert"]').textContent, /Missing song: Trashed song/)
  await click($('[aria-label="Next Song"]')); await pause()
  assert.equal(position(), '4/5')
  assert.match(document.querySelector('main').textContent, /Alpha/)
  await click($('[data-testid="toolbar-back"]'))
  for (const index of [0, 2]) assert.equal($(`[data-testid="workspace-entry-open-${index}"]`).disabled, true)
}, [{ id: 'gone', title: 'Gone' }, entries[0], { id: 'trashed', title: 'Trashed song' }, entries[1], entries[2]]))

test('#453 Songbook-origin queue and Back remain unchanged after leaving a setlist', async () => app(async ({ click }) => {
  await openSetlist(click)
  await click($('[data-testid="toolbar-back"]'))
  await click($('[data-testid="explorer-sidebar"] [data-testid="explorer-nav-all-songs"]'))
  await click($('[data-testid="song-card-0"]'))
  assert.equal(position(), '1/4')
  await click($('[aria-label="Next Song"]')); await pause()
  assert.equal(position(), '2/4')
  await click($('[data-testid="toolbar-back"]'))
  assert.ok($('[data-testid="song-card-0"]'))
  assert.equal($('[data-testid="workspace-setlist-header"]'), null)
}))

