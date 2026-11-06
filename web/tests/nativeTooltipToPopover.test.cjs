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

const { SyncStatusPill } = require('../src/components/SyncStatusPill.tsx')

test('SyncStatusPill: renders GTAR popover on hover, focus and tap; no native title tooltip', async () => {
  const root = createRoot(document.getElementById('root'))
  let clicked = false
  const onClick = () => { clicked = true }
  const status = { state: 'backed-up', label: 'Backed up' }
  const lastBackup = '2026-11-05T12:00:00Z'
  const now = Date.parse('2026-11-05T12:15:00Z')

  await act(async () => {
    root.render(React.createElement(SyncStatusPill, { status, lastBackup, now, onClick }))
  })

  const btn = document.querySelector('[data-testid="header-cloud-sync-button"]')
  assert.ok(btn, 'button renders')
  assert.equal(btn.getAttribute('title'), null, 'native title attribute removed')
  assert.match(btn.getAttribute('aria-label'), /Backup & Restore \u2014 Backed up/)
  assert.equal(btn.getAttribute('aria-haspopup'), 'dialog')
  assert.equal(btn.getAttribute('aria-expanded'), 'false')
  assert.equal(document.querySelector('[data-testid="cloud-backup-popover"]'), null, 'popover initially closed')

  // Hover opens popover
  await act(async () => {
    btn.dispatchEvent(new window.Event('mouseover', { bubbles: true }))
  })
  assert.equal(btn.getAttribute('aria-expanded'), 'true')
  const popover = document.querySelector('[data-testid="cloud-backup-popover"]')
  assert.ok(popover, 'popover opened on hover')
  assert.equal(popover.getAttribute('role'), 'dialog')
  assert.equal(popover.querySelector('[data-testid="cloud-popover-status-badge"]').textContent, 'Backed up')
  assert.equal(popover.querySelector('[data-testid="cloud-backup-time"]').textContent, 'Last cloud backup: 15 m ago')

  // Entering popover keeps it open
  await act(async () => {
    btn.dispatchEvent(new window.Event('mouseout', { bubbles: true }))
    popover.dispatchEvent(new window.Event('mouseover', { bubbles: true }))
  })
  assert.ok(document.querySelector('[data-testid="cloud-backup-popover"]'), 'popover stays open when pointer enters')

  // Mouse out of popover closes it after timer
  await act(async () => {
    popover.dispatchEvent(new window.Event('mouseout', { bubbles: true }))
    await new Promise(r => setTimeout(r, 220))
  })
  assert.equal(document.querySelector('[data-testid="cloud-backup-popover"]'), null, 'popover closes on mouse out')

  // Mobile tap (touchend followed by synthetic click) opens popover without opening center
  await act(async () => {
    btn.dispatchEvent(new window.Event('touchend', { bubbles: true }))
    btn.click()
  })
  assert.equal(clicked, false, 'mobile tap does not open center directly')
  assert.ok(document.querySelector('[data-testid="cloud-backup-popover"]'), 'mobile tap opens popover')

  // Clicking "Backup & Restore" button inside popover calls onClick and closes popover
  const openCenterBtn = document.querySelector('[data-testid="cloud-popover-open-center"]')
  assert.ok(openCenterBtn, 'action button inside popover')
  await act(async () => {
    openCenterBtn.click()
  })
  assert.equal(clicked, true, 'onClick called from popover action')
  assert.equal(document.querySelector('[data-testid="cloud-backup-popover"]'), null, 'popover closes after action')

  // Direct desktop click triggers onClick
  clicked = false
  await act(async () => {
    btn.click()
  })
  assert.equal(clicked, true, 'direct button click triggers onClick')

  await act(async () => root.unmount())
})

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
