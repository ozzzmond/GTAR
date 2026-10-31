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
window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')) }
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
    assert.ok(document.activeElement === trigger, 'focus returns to trigger')
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

test('Setlist collections open dedicated details, preserve breadcrumbs and expose Stage and Manager', async () => {
  const calls = []
  const root = await mount({setlists: [...setlists, {id:'filed',name:'Filed',folderId:'kept-folder',updatedAt:1700000000000,songs:[]}], onSelectSetlistSong:(...args) => calls.push(args), onManageSetlist:sl => calls.push(sl.id)})
  try {
    await click(byText(sidebar(),'All Setlists'))
    assert.equal(document.querySelector('[data-testid="setlist-collection"]').children.length,3)
    assert.match(document.querySelector('[data-testid="setlist-card-filed"]').textContent,/Updated/)
    await click(byText(sidebar(),'Unfiled Setlists'))
    assert.equal(document.querySelector('[data-testid="setlist-collection"]').children.length,2)
    await click(document.querySelector('[data-testid="setlist-card-0"]'))
    assert.equal(document.querySelector('[data-testid="setlist-collection"]'),null)
    assert.equal(document.querySelector('#gig-setlist-cards'),null,'no competing collection')
    const detail = document.querySelector('[aria-label="Selected setlist songs"]')
    const button = text => [...detail.querySelectorAll('button')].find(el => el.textContent === text)
    await click(button('Play in Stage')); await click(button('Edit in Setlist Manager'))
    assert.deepEqual(calls,[[0,0],0])
    await click(button('Unfiled Setlists'))
    assert.equal(document.querySelector('[data-testid="setlist-collection"]').children.length,2)
    await click(byText(sidebar(),'Filed'))
    assert.match(document.querySelector('[aria-label="Setlist breadcrumbs"]').textContent,/All Setlists/)
  } finally { await cleanup(root) }
})

const input = async (element, value) => act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(element,value)
  element.dispatchEvent(new window.Event('input',{bubbles:true}))
})
const pickerButton = text => [...document.querySelectorAll('dialog button')].find(el => el.textContent === text)
const openPicker = async () => {
  await click([...document.querySelectorAll('button')].find(el => el.textContent === 'Search Songs'))
  return document.querySelector('dialog[aria-labelledby]')
}

test('Picker: title/artist/legacy and array tags, hidden selections, deselect/reselect order, clear, cancel and empty results', async () => {
  const calls = []
  const root = await mount({onBulkAddSongsToSetlist:(...args) => {calls.push(args);return true}})
  try {
    await click(byText(sidebar(),'Empty'))
    const trigger = [...document.querySelectorAll('button')].find(el => el.textContent === 'Search Songs')
    trigger.focus()
    const picker = await openPicker()
    assert.equal(picker.open,true)
    const search = picker.querySelector('input[type="search"]')
    await input(search,'acoustic')
    assert.equal(picker.querySelectorAll('input[type="checkbox"]').length,1)
    await click(picker.querySelector('input[type="checkbox"]'))
    await input(search,'Zulu')
    await click(picker.querySelector('input[type="checkbox"]'))
    await input(search,'Band')
    assert.equal(picker.querySelectorAll('input[type="checkbox"]').length,3)
    const boxes = picker.querySelectorAll('input[type="checkbox"]')
    await click(boxes[1]); await click(boxes[1])
    assert.match(picker.querySelector('[role="status"]').textContent,/2 songs/)
    await input(search,'no-match')
    assert.match(picker.textContent,/No songs match/)
    await click(pickerButton('Add selected songs'))
    assert.deepEqual(calls,[[[0,'12'],'empty']])
    assert.ok(document.activeElement === trigger, 'focus returns to trigger')
    await openPicker()
    await click(document.querySelector('dialog input[type="checkbox"]'))
    await click(pickerButton('Clear selection'))
    assert.ok(pickerButton('Add selected songs').disabled)
    await click(pickerButton('Cancel'))
    assert.equal(calls.length,1,'cancel performs no write')
  } finally { await cleanup(root) }
})

test('Picker: failed save retains selection; keyboard focus wraps, Escape cancels; empty/deleted songs excluded', async () => {
  const root = await mount({onBulkAddSongsToSetlist:() => false})
  try {
    await click(byText(sidebar(),'Empty'))
    let picker = await openPicker()
    await click(picker.querySelector('input[type="checkbox"]'))
    await click(pickerButton('Add selected songs'))
    assert.match(picker.querySelector('[role="alert"]').textContent,/Could not save/)
    assert.match(picker.querySelector('[role="status"]').textContent,/1 songs/)
    const first = picker.querySelector('input'), last = pickerButton('Add selected songs')
    first.focus()
    first.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}))
    assert.ok(document.activeElement === last)
    last.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))
    assert.ok(document.activeElement === first)
    await act(async () => picker.dispatchEvent(new window.Event('cancel',{bubbles:true})))
    assert.equal(document.querySelector('dialog[aria-labelledby]'),null)
    await act(async () => root.render(React.createElement(SongbookHomeView,{...props,songs:[{...songs[0],isDeleted:true}],onBulkAddSongsToSetlist:() => true})))
    picker = await openPicker()
    assert.match(picker.textContent,/Your local songbook is empty/)
  } finally { await cleanup(root) }
})

test('Bulk mutation: actual App handler persists once, preserves entry overrides/repeats and unresolved refs, existing duplicate policy and canonical songs', () => {
  const {persistLibrary, libraryRevision, readPersistedLibrary} = require('../src/utils/syncJournal.ts')
  const {setSongMembership, songIdIndex, resolveSetlistPerformanceSong} = require('../src/utils/setlistSongs.ts')
  const librarySongs = songs.map(song => ({...song,format:'CHORD_PRO',transposeOffset:3}))
  const lists = [{...setlists[0],songs:[{id:'0',title:'old',transposeOffset:-2},{id:0,title:'Repeat'}]}]
  const before = JSON.stringify(librarySongs)
  localStorage.clear()
  persistLibrary({songs:librarySongs,setlists:lists},localStorage)
  const baseline = {current:libraryRevision()}
  let saved, writes = 0, failure, conflict = false
  const app = fs.readFileSync(path.resolve(__dirname,'../src/App.tsx'),'utf8')
  const source = app.slice(app.indexOf('  const handleBulkAddSongsToSetlist ='),app.indexOf('  // Restore song from Trash'))
  const js = ts.transpileModule(source+'\nreturn handleBulkAddSongsToSetlist',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
  const handler = new Function('songs','setlists','deletedSongs','songIdIndex','setSongMembership','persistLibrary','persistedBaselineRef','libraryRevision','setSetlists','setToastMessage','setTimeout','handleStorageWriteFailure','crossTabConflict',js)
  const make = () => handler(librarySongs,lists,[],songIdIndex,setSongMembership,(...args) => {writes++;persistLibrary(...args)},baseline,libraryRevision,value => saved=value,()=>{},()=>{},err=>failure=err,conflict)
  assert.equal(make()(['12',0,'other','12'],0),true)
  assert.equal(writes,1)
  assert.deepEqual(saved[0].songs.slice(0,2),lists[0].songs)
  assert.deepEqual(saved[0].songs.slice(2).map(ref=>ref.id),['12','other'],'ID membership skips 0 and repeated 12')
  const unresolved = {...lists[0], songs:[...lists[0].songs, {title:'Other',artist:'Band'}, {id:'missing',title:'Gone'}]}
  const preserved = setSongMembership(unresolved,librarySongs[1],true)
  assert.deepEqual(preserved.songs.slice(0,4),unresolved.songs)
  assert.equal(JSON.stringify(librarySongs),before)
  assert.equal(resolveSetlistPerformanceSong(saved[0].songs[0],librarySongs).transposeOffset,-2)
  assert.equal(librarySongs[0].transposeOffset,3)
  assert.equal(resolveSetlistPerformanceSong({title:'Other',artist:'Band'},librarySongs).id,'other')
  assert.equal(resolveSetlistPerformanceSong({id:'gone',title:'Zulu'},librarySongs),undefined)
  assert.deepEqual(readPersistedLibrary(localStorage).setlists,saved)
  conflict=true
  assert.equal(make()(['12'],0),false)
  assert.equal(writes,1)
  conflict=false
  baseline.current='stale'
  saved=undefined
  assert.equal(make()(['12'],0),false)
  assert.ok(failure)
  assert.equal(saved,undefined)
  localStorage.clear()
})
