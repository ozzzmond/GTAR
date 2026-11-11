const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText,
  filename
)
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.app/' })
Object.assign(global, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  TouchEvent: dom.window.TouchEvent,
  KeyboardEvent: dom.window.KeyboardEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
})
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { top: 10, left: 100, bottom: 40, right: 140, width: 40, height: 30 }
}

test('SongbookHomeView: song setlist indicator replaces native tooltip with GTAR-styled popover', async () => {
  const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
  const root = createRoot(document.getElementById('root'))
  let managedSetlist = null
  const songs = [{ id: 'song-1', title: 'Amazing Grace', rawContent: 'G C D' }]
  const setlists = [
    { id: 'sl-1', name: 'Sunday Service', songs: [{ id: 'song-1', entryId: 'e1', title: 'Amazing Grace' }] },
    { id: 'sl-2', name: 'Worship Night', songs: [{ id: 'song-1', entryId: 'e2', title: 'Amazing Grace' }] },
  ]
  const props = {
    songs,
    setlists,
    searchQuery: '',
    onSearchChange: () => {},
    onSelectSong: () => {},
    onDeleteSong: () => {},
    onUpdateSong: () => {},
    onCreateSong: () => {},
    onOpenSetlists: () => {},
    onManageSetlist: sl => { managedSetlist = sl },
    onSongMembershipChange: () => {},
  }
  await act(async () => {
    root.render(React.createElement(SongbookHomeView, props))
  })

  const indicator = document.querySelector('[data-testid="song-setlist-indicator-0"]')
  assert.ok(indicator, 'indicator rendered')
  assert.equal(indicator.getAttribute('title'), null, 'no native title attribute')
  assert.equal(indicator.getAttribute('aria-label'), 'In 2 setlists')
  assert.equal(indicator.getAttribute('aria-haspopup'), 'dialog')
  assert.equal(indicator.getAttribute('aria-expanded'), 'false')
  assert.equal(document.querySelector('[data-testid="membership-popover-0"]'), null)

  // Hover opens popover
  await act(async () => {
    indicator.dispatchEvent(new window.Event('mouseover', { bubbles: true }))
  })
  assert.equal(indicator.getAttribute('aria-expanded'), 'true')
  const popover = document.querySelector('[data-testid="membership-popover-0"]')
  assert.ok(popover, 'hover opens setlist popover')
  assert.match(popover.textContent, /In Setlists \(2\)/)
  assert.match(popover.textContent, /Sunday Service/)
  assert.match(popover.textContent, /Worship Night/)

  // Jump to setlist navigates and closes popover
  const jumpBtn = document.querySelector('[data-testid="jump-setlist-sl-1"]')
  assert.ok(jumpBtn, 'jump button exists')
  await act(async () => {
    jumpBtn.click()
  })
  assert.equal(managedSetlist?.id, 'sl-1', 'managed setlist called')
  assert.equal(document.querySelector('[data-testid="membership-popover-0"]'), null, 'popover closed after jump')

  await act(async () => root.unmount())
})
