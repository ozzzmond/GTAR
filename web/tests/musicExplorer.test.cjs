const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        }
      ).outputText,
      filename
    )
}
require.extensions['.png'] = (module) => {
  module.exports = '/logo.png'
}

const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/' })
Object.assign(global, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  Event: dom.window.Event,
  CustomEvent: dom.window.CustomEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: (fn) => fn(),
})
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')

const songs = [
  { id: 0, title: 'Zulu', artist: 'Band', tags: 'Rock, Worship', rawContent: '[G] Zero' },
  { id: '12', title: 'Alpha', artist: 'Band', tags: ['worship', 'Acoustic'], rawContent: '[C] Alpha' },
  { id: 'other', title: 'Other', artist: 'Band', tags: ['Rockabilly'], rawContent: '[D] Other' },
]
const setlists = [
  { id: 0, name: 'Sunday', songs: [{id: 12, title:'Old title'}, {id:'0', title:'Old zero'}, {id:'missing', title:'Gone'}, {title:'Other', artist:'Band'}, {id:12, title:'Repeat'}] },
  { id: 'empty', name: 'Empty', songs: [] },
  { id: 'deleted', name: 'Deleted', songs: [], isDeleted:true },
]
const props = {
  explorerEnabled:true, songs, setlists, activeSongIndex:0,
  onSelectSong() {}, onNewSong() {}, onOpenSetlists() {}, onDeleteSong() {},
  onSongMembershipChange() {}, onCreateSetlistForSong() {},
}
const sidebar = () => document.querySelector('[aria-label="Explorer sidebar"]')
const byText = (container, text) => [...container.querySelectorAll('button')].find(el => el.textContent.trim().replace(/\d+$/, '').trim() === text)
const click = async element => { assert.ok(element, 'control exists'); await act(async () => element.click()) }
async function mount(extra = {}) {
  const root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(SongbookHomeView, {...props,...extra})))
  return root
}
const cleanup = async root => { await act(async () => root.unmount()); localStorage.clear() }

test('Explorer tags: legacy and arrays share categories, exact case-insensitive membership, canonical indices and search', async () => {
  localStorage.clear()
  const before = JSON.stringify({songs,setlists})
  const selected = []
  const root = await mount({onSelectSong:index => selected.push(index)})
  try {
    assert.equal(byText(sidebar(), 'Worship').textContent.trim(), 'Worship2')
    await click(byText(sidebar(), 'Rock'))
    assert.equal(document.querySelector('[data-testid="song-grid"]').children.length, 1)
    assert.match(document.querySelector('[data-testid="song-grid"]').textContent, /Zulu/)
    await click(document.querySelector('[data-testid="song-card-0"]'))
    assert.deepEqual(selected,[0])
    await click(byText(sidebar(), 'Worship'))
    assert.equal(document.querySelector('[data-testid="song-grid"]').children.length, 2)
    await act(async () => root.render(React.createElement(SongbookHomeView, {...props, searchQuery:'Alpha'})))
    assert.equal(document.querySelector('[data-testid="song-grid"]').children.length, 1)
    await click(byText(sidebar(), 'All Songs'))
    assert.equal(document.querySelector('[data-testid="song-grid"]').children.length, 1, 'library search is preserved')
    assert.equal(JSON.stringify({songs,setlists}),before)
  } finally { await cleanup(root) }
})

test('Explorer setlists: reference order, numeric/string IDs, repeats, legacy refs, missing refs and unchanged Stage indices', async () => {
  const calls = []
  const root = await mount({onSelectSetlistSong:(...args) => calls.push(args)})
  try {
    assert.equal(byText(sidebar(), 'Deleted'), undefined)
    await click(byText(sidebar(), 'Sunday'))
    const rows = [...document.querySelectorAll('[aria-label="Selected setlist songs"] ol button')]
    assert.deepEqual(rows.map(row => row.textContent), ['1.Alpha','2.Zulu','3.Gone — Unavailable song','4.Other','5.Alpha'])
    assert.ok(rows[2].disabled)
    await click(rows[1]); await click(rows[4])
    assert.deepEqual(calls,[[0,1],[0,4]])
    await click(byText(sidebar(), 'Empty'))
    assert.match(document.querySelector('[aria-label="Selected setlist songs"]').textContent,/This setlist is empty/)
    await act(async () => root.render(React.createElement(SongbookHomeView, {...props,setlists:[]})))
    assert.equal(document.querySelector('[aria-label="Selected setlist songs"]'),null)
  } finally { await cleanup(root) }
})

test('Explorer sidebar: section controls, visibility survives remount; unavailable storage remains usable', async () => {
  let root = await mount()
  try {
    const section = byText(sidebar(),'Tags / Songbooks')
    await click(section)
    assert.equal(section.getAttribute('aria-expanded'),'false')
    assert.equal(document.getElementById(section.getAttribute('aria-controls')).hidden,true)
    await click(document.querySelector('[aria-label="Hide Explorer sidebar"]'))
    assert.equal(localStorage.getItem('gtar_explorer_sidebar_visible'),'false')
    await act(async () => root.unmount())
    root = await mount()
    assert.ok(sidebar().classList.contains('explorer-sidebar-hidden'))
    await click(document.querySelector('[aria-label="Show Explorer sidebar"]'))
    assert.equal(localStorage.getItem('gtar_explorer_sidebar_visible'),'true')
  } finally { await cleanup(root) }
  const original = window.Storage.prototype.setItem
  window.Storage.prototype.setItem = () => { throw new Error('storage denied') }
  root = await mount()
  try {
    await click(document.querySelector('[aria-label="Hide Explorer sidebar"]'))
    assert.ok(document.querySelector('[aria-label="Show Explorer sidebar"]'))
    await click(byText(sidebar(),'Acoustic'))
    assert.match(document.querySelector('[data-testid="song-grid"]').textContent,/Alpha/)
  } finally { window.Storage.prototype.setItem = original; await cleanup(root) }
})

test('Explorer mobile drawer: modal open/close, navigation closes and restores trigger focus', async () => {
  // JSDOM has no native dialog lifecycle; real focus trapping/Escape are browser-verified.
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')) }
  const root = await mount()
  try {
    const trigger = document.querySelector('[aria-label="Open Music Explorer"]')
    await click(trigger)
    const drawer = document.querySelector('dialog')
    assert.equal(drawer.open,true)
    const buttons = [...drawer.querySelectorAll('button')]
    for (const button of buttons) button.getClientRects = () => [{height:44}]
    buttons[0].focus()
    buttons[0].dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}))
    assert.equal(document.activeElement,buttons.at(-1),'reverse Tab stays in drawer')
    buttons.at(-1).dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))
    assert.equal(document.activeElement,buttons[0],'forward Tab stays in drawer')
    await click(byText(drawer,'Acoustic'))
    assert.equal(drawer.open,false)
    assert.equal(document.activeElement,trigger)
    assert.match(document.querySelector('[data-testid="song-grid"]').textContent,/Alpha/)
    await click(trigger)
    await click(drawer.querySelector('[aria-label="Close Music Explorer"]'))
    assert.equal(drawer.open,false)
  } finally { await cleanup(root) }
})

test('Explorer absent when disabled; Shared Catalog and original tabs remain reachable', async () => {
  const root = await mount({explorerEnabled:false})
  try {
    assert.equal(document.querySelector('[aria-label="Music Explorer"]'),null)
    assert.ok(document.querySelector('[data-testid="tab-shared-catalog"]'))
    await click(document.querySelector('[data-testid="tab-setlists"]'))
    assert.ok(document.querySelector('[data-testid="setlist-card-0"]'))
    await click(document.querySelector('[data-testid="tab-my-songs"]'))
    assert.ok(document.querySelector('[data-testid="song-grid"]'))
    const app = fs.readFileSync(path.resolve(__dirname,'../src/App.tsx'),'utf8')
    assert.match(app,/explorerEnabled=\{isDevEnv\}/)
  } finally { await cleanup(root) }
})
