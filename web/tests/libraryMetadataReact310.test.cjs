const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
require.extensions['.png'] = module => { module.exports = '/logo.png' }
const React = require('react'), { act } = React
const { createRoot } = require('react-dom/client')
const { JSDOM } = require('jsdom')
const { LibraryMetadataModal } = require('../src/components/LibraryMetadataModal.tsx')
const App = require('../src/App.tsx').default
const song = { id: 'd1080001-0001-4000-8000-000000000001', title: 'Fixture', artist: 'Artist', key: 'G', originalKey: 'G', bpm: '90', year: '1990', transposeOffset: 2, rawContent: '{key: G}\n[G] [C] [D/F#]', format: 'CHORD_PRO' }

async function withDOM(run) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  const keys = ['window', 'document', 'Node', 'localStorage', 'sessionStorage', 'IS_REACT_ACT_ENVIRONMENT', 'fetch', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout']
  const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
  const timers = new Set()
  global.setTimeout = (callback, delay, ...args) => {
    const timer = previous.setTimeout(() => { timers.delete(timer); callback(...args) }, delay)
    timers.add(timer)
    return timer
  }
  Object.assign(global, { window: dom.window, document: dom.window.document, Node: dom.window.Node, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  const errors = [], priorError = console.error
  console.error = (...args) => errors.push(args.map(String).join(' '))
  const root = createRoot(document.getElementById('root'), { onUncaughtError: error => errors.push(String(error)), onCaughtError: error => errors.push(String(error)) })
  const click = async element => { assert.ok(element, 'interaction target exists'); await act(async () => element.click()) }
  const find = id => document.querySelector(`[data-testid="${id}"]`)
  try {
    await run({ root, click, find })
    assert.deepEqual(errors, [], 'no React errors, including caught errors or hook-order diagnostics')
  } finally {
    await act(async () => root.unmount())
    for (const timer of timers) clearTimeout(timer)
    console.error = priorError
    dom.window.close()
    Object.assign(global, previous)
  }
}

test('real React StrictMode modal closed/open/closed/reopen and preselected songs', async () => withDOM(async ({ root, click, find }) => {
  let closed = 0
  const songs = [song, { ...song, id: 'other', title: 'Other' }]
  const preselectedSongIds = new Set([song.id])
  const render = async isOpen => act(async () => root.render(React.createElement(React.StrictMode, null,
    React.createElement(LibraryMetadataModal, { isOpen, songs, preselectedSongIds, onClose: () => closed++, onApplyUpdates() {} }))))
  await render(false)
  assert.equal(document.getElementById('root').textContent, '')
  await render(true)
  assert.match(find('start-metadata-scan-btn').textContent, /Scan Library \(1\)/)
  assert.match(document.body.textContent, /Fixture/)
  assert.doesNotMatch(document.body.textContent, /Other/)
  await click(document.querySelector('button[title="Close"]'))
  assert.equal(closed, 1)
  await render(false)
  assert.equal(find('start-metadata-scan-btn'), null)
  await render(true)
  assert.match(find('start-metadata-scan-btn').textContent, /Scan Library \(1\)/)
  assert.equal(find('apply-metadata-updates-btn').disabled, true)
}))

test('real App main menu and import metadata entry points preserve scan, selection and confirmation', async () => withDOM(async ({ root, click, find }) => {
  const { persistLibrary, readPersistedLibrary } = require('../src/utils/syncJournal.ts')
  persistLibrary({ songs: [song], setlists: [] })
  let requests = 0
  global.fetch = async url => {
    assert.match(String(url), /^\/api\/metadata-lookup\?/)
    requests++
    return { ok: true, json: async () => ({ success: true, results: [
      { id: 'first', title: 'Fixture', artist: 'Artist', originalKey: 'D', bpm: '120', year: '2000' },
      { id: 'second', title: 'Fixture', artist: 'Artist', originalKey: 'E', bpm: '130', year: '2001' },
    ] }) }
  }
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(App))))
  const buttonText = text => [...document.querySelectorAll('button')].find(b => b.textContent.includes(text))
  const openMenu = async () => {
    // The actual overflow toggle contains the MoreVertical icon.
    await click(document.querySelector('button:has(svg.lucide-ellipsis-vertical)') || document.querySelector('button:has(svg.lucide-more-vertical)'))
  }
  await openMenu()
  await click(find('header-open-metadata-review-btn'))
  assert.ok(find('start-metadata-scan-btn'), 'main menu opens metadata review without blank screen')
  assert.equal(requests, 0, 'opening does not scan automatically')
  await click(document.querySelector('button[title="Close"]'))
  assert.equal(find('start-metadata-scan-btn'), null)
  assert.ok(document.getElementById('root').textContent.trim(), 'App remains visible after close')
  await openMenu()
  await click(buttonText('Import Songs & Setlists'))
  await click(find('import-dialog-open-metadata-btn'))
  assert.equal(find('import-dialog-open-metadata-btn'), null, 'import tools close when review opens')
  assert.ok(find('start-metadata-scan-btn'), 'import entry reopens review')
  await click(find('start-metadata-scan-btn'))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)) })
  assert.equal(requests, 1)
  const select = [...document.querySelectorAll('select')].find(element => element.textContent.includes('confidence'))
  assert.ok(select)
  await act(async () => { select.value = '1'; select.dispatchEvent(new window.Event('change', { bubbles: true })) })
  assert.equal(select.value, '1', 'second provider candidate selected')
  await click(buttonText('Select Matches'))
  await click(buttonText('Clear'))
  assert.equal(find('apply-metadata-updates-btn').disabled, true)
  await click(buttonText('Select Matches'))
  const year = [...document.querySelectorAll('label')].find(label => label.textContent.includes('Year:')).querySelector('input')
  await click(year)
  await click(find('apply-metadata-updates-btn'))
  assert.ok(find('confirm-apply-metadata-btn'))
  assert.equal(readPersistedLibrary().songs[0].bpm, '90', 'review requires explicit confirmation')
  await click(find('confirm-apply-metadata-btn'))
  assert.equal(find('start-metadata-scan-btn'), null)
  const updated = readPersistedLibrary().songs[0]
  assert.equal(updated.originalKey, 'E')
  assert.equal(updated.key, 'E')
  assert.match(updated.rawContent, /\[E\] \[A\] \[B\/D#\]/)
  assert.equal(updated.transposeOffset, 2)
  assert.equal(updated.bpm, '130')
  assert.equal(updated.year, '1990', 'unchecked field preserved')
  assert.equal(updated.title, song.title)
  assert.equal(updated.artist, song.artist)
  await openMenu()
  await click(find('header-open-metadata-review-btn'))
  assert.ok(find('start-metadata-scan-btn'), 'reopen after apply remains functional')
  assert.equal(find('apply-metadata-updates-btn').disabled, true)
  await click(document.querySelector('button[title="Close"]'))
  assert.ok(document.getElementById('root').textContent.trim(), 'App remains visible')
}))
