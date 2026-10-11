const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }
).outputText, filename)
const React = require('react')
const { act } = React
const { JSDOM } = require('jsdom')
const { SetlistDrawer } = require('../src/components/SetlistDrawer.tsx')
const { setSongMembership, transitionSongLibrary } = require('../src/utils/setlistSongs.ts')
const { persistLibrary, readPersistedLibrary } = require('../src/utils/syncJournal.ts')
const source = fs.readFileSync(require.resolve('../src/App.tsx'), 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const callbacks = new Map(), tags = new Map()
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer) callbacks.set(node.name.getText(ast), node.initializer.getText(ast))
  if (ts.isJsxSelfClosingElement(node)) tags.set(node.tagName.getText(ast), node)
  ts.forEachChild(node, visit)
}
visit(ast)
function callback(name, scope) {
  assert.ok(callbacks.has(name), name)
  const code = ts.transpileModule(`const callback = ${callbacks.get(name)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(scope), `${code}; return callback`)(...Object.values(scope))
}
function prop(tag, name) {
  const attr = tags.get(tag).attributes.properties.find(item => item.name?.getText(ast) === name)
  assert.ok(attr, `${tag}.${name}`)
  return attr.initializer.expression.getText(ast)
}
const song = (id, title) => ({ id, title, artist: 'Artist', key: 'G', rawContent: '[G]Song', format: 'CHORD_PRO' })
const initialSongs = () => [song('first', 'Alpha'), song(0, 'Beta'), song('last', 'Gamma')]
const initialLists = () => [
  { id: 0, name: 'Same name', songs: [] },
  { id: 'second', name: 'Same name', songs: [] },
  { id: 'deleted', name: 'Deleted', isDeleted: true, songs: [] },
]
async function ui(run) {
  const dom = new JSDOM('<button id="opener">Open</button><div id="root"></div>', { url: 'http://localhost' })
  const keys = ['window', 'document', 'Node', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
  Object.assign(global, { window: dom.window, document: dom.window.document, Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  window.HTMLDialogElement.prototype.close = function () { this.open = false }
  const { createRoot } = require('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  const click = async node => { assert.ok(node); await act(async () => node.click()) }
  const input = async (node, value) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(node, value)
      node.dispatchEvent(new window.Event('input', { bubbles: true }))
      node.dispatchEvent(new window.Event('change', { bubbles: true }))
    })
  }
  try { await run({ root, click, input, render: async props => act(async () => root.render(React.createElement(SetlistDrawer, props))) }) }
  finally { await act(async () => root.unmount()); dom.window.close(); Object.assign(global, previous) }
}
function appState() {
  const state = { songs: initialSongs(), deletedSongs: [], setlists: initialLists(), activeSongIndex: 0, failures: 0 }
  const scope = () => ({ ...state, currentSong: state.songs[state.activeSongIndex],
    setSongMembership, persistLibrary, transitionSongLibrary, generateUUID: () => 'created',
    setSetlists: value => { state.setlists = value }, setSongs: value => { state.songs = value },
    setDeletedSongs: value => { state.deletedSongs = value }, setActiveSongIndex: value => { state.activeSongIndex = value },
    setQueueMode() {}, setToastMessage() {}, setTimeout() {}, handleStorageWriteFailure: () => { state.failures++ },
    createLifecycleBlank: () => song('blank', 'Blank'),
  })
  const call = (name, ...args) => {
    const bindings = scope()
    bindings.commitSongLifecycle = callback('commitSongLifecycle', bindings)
    return callback(name, bindings)(...args)
  }
  const props = () => ({ isOpen: true, songs: state.songs, setlists: state.setlists, activeSongIndex: state.activeSongIndex,
    onSelectSongIndex: index => call('handleSelectLibrarySong', index), onDeleteSong: index => call('handleDeleteSong', index),
    onSongMembershipChange: (...args) => call(prop('SetlistDrawer', 'onSongMembershipChange'), ...args),
    onCreateSetlistForSong: (...args) => call(prop('SetlistDrawer', 'onCreateSetlistForSong'), ...args), onClose() {}, onNewSong() {},
  })
  return { state, call, props }
}

test('App canonical library and queue props stay independent of header search, including zero matches', () => {
  for (const tag of ['SetlistDrawer', 'StageView']) assert.equal(prop(tag, 'songs'), 'songs')
  assert.equal(prop('Header', 'songsCount'), 'songs.length')
  for (const query of ['Beta', 'no match', '']) {
    const songs = initialSongs()
    for (const tag of ['SetlistDrawer', 'StageView']) {
      assert.equal(new Function('songs', 'searchQuery', `return ${prop(tag, 'songs')}`)(songs, query), songs)
    }
  }
})

test('drawer mount/reopen preserves focus; deliberate search targets canonical selection, edit and trash IDs', async () => ui(async ({ render, click, input }) => {
  const { state, call, props } = appState()
  document.getElementById('opener').focus()
  await render(props())
  const search = () => document.querySelector('input[type=text]')
  assert.equal(document.activeElement.id, 'opener')
  search().focus()
  assert.equal(document.activeElement, search(), 'normal keyboard/tap focus remains available')
  await input(search(), 'Beta')
  assert.equal(document.querySelectorAll('[aria-label="Delete song from library"]').length, 1)
  await click(document.querySelector('[data-testid="drawer-song-add-to-setlist-1"]').closest('.group'))
  assert.equal(state.activeSongIndex, 1)
  assert.equal(call('handleUpdateSong', { title: 'Beta edited' }), true)
  assert.equal(state.songs[0].title, 'Alpha')
  assert.equal(state.songs[1].title, 'Beta edited')
  await render(props())
  await click(document.querySelector('[aria-label="Delete song from library"]'))
  // Library order can change while confirmation is open: confirmation must follow ID 0.
  state.songs = [state.songs[1], state.songs[0], state.songs[2]]
  await render(props())
  await click([...document.querySelectorAll('button')].find(button => button.textContent === 'Confirm'))
  assert.deepEqual(state.deletedSongs.map(item => item.id), [0])
  assert.deepEqual(state.songs.map(item => item.id), ['first', 'last'])
  assert.equal(call('handleRestoreSong', 0), undefined)
  assert.equal(state.songs[0].id, 0)
  assert.equal(state.songs[0].title, 'Beta edited')
  await render({ ...props(), isOpen: false })
  document.getElementById('opener').focus()
  await render(props())
  assert.equal(document.activeElement.id, 'opener')
  await input(search(), 'no match')
  assert.match(document.body.textContent, /No songs matched/)
  await input(search(), '')
  assert.equal(document.querySelectorAll('[aria-label="Delete song from library"]').length, 3)
}))

test('drawer mutations persist by song/setlist ID across multiple same-name lists; removal and create roundtrip', async () => ui(async ({ render, click, input }) => {
  const { state, props } = appState()
  await render(props())
  await click(document.querySelector('[data-testid="drawer-song-add-to-setlist-1"]'))
  const boxes = () => [...document.querySelectorAll('input[type=checkbox]')]
  assert.equal(boxes().length, 2, 'deleted setlist excluded')
  await click(boxes()[1]); await render(props())
  assert.equal(boxes()[1].checked, true)
  assert.equal(boxes()[0].checked, false)
  assert.match(document.querySelector('dialog [role=status]').textContent, /Added to/)
  await click(boxes()[0]); await render(props())
  assert.deepEqual(state.setlists.slice(0, 2).map(list => list.songs.map(ref => ref.id)), [[0], [0]])
  await click(boxes()[1]); await render(props())
  assert.deepEqual(state.setlists.slice(0, 2).map(list => list.songs.map(ref => ref.id)), [[0], []])
  await input(document.getElementById('quick-setlist-name'), 'New Gig')
  await act(async () => document.querySelector('dialog form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
  await render(props())
  assert.equal(state.setlists.at(-1).id, 'created')
  assert.deepEqual(state.setlists.at(-1).songs.map(ref => ref.id), [0])
  assert.deepEqual(readPersistedLibrary().setlists, state.setlists, 'refresh reads committed memberships')
}))

for (const mode of ['absent', 'false', 'undefined', 'throw', 'storage']) test(`failed ${mode} mutation never announces success or changes membership`, async () => ui(async ({ render, click, input }) => {
  const { state, call, props } = appState()
  const overrides = mode === 'storage' ? {} : {
    onSongMembershipChange: mode === 'absent' ? undefined : () => { if (mode === 'throw') throw Error('failed'); return mode === 'false' ? false : undefined },
    onCreateSetlistForSong: mode === 'absent' ? undefined : () => { if (mode === 'throw') throw Error('failed'); return mode === 'false' ? false : undefined },
  }
  if (mode === 'storage') localStorage.setItem = () => { throw Error('storage unavailable') }
  // jsdom Storage named properties do not override prototype methods.
  if (mode === 'storage') window.Storage.prototype.setItem = () => { throw Error('storage unavailable') }
  await render({ ...props(), ...overrides })
  await click(document.querySelector('[data-testid="drawer-song-add-to-setlist-1"]'))
  await click(document.querySelector('input[type=checkbox]'))
  assert.match(document.querySelector('dialog [role=status]').textContent, /Could not update/)
  assert.equal(document.querySelector('input[type=checkbox]').checked, false)
  await input(document.getElementById('quick-setlist-name'), 'Retry Gig')
  await act(async () => document.querySelector('dialog form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
  assert.match(document.querySelector('dialog [role=status]').textContent, /Could not create/)
  assert.equal(document.getElementById('quick-setlist-name').value, 'Retry Gig')
  assert.deepEqual(state.setlists, initialLists())
  assert.equal(call('handleSongMembership', 'missing', 0, true), false)
  assert.equal(call('handleSongMembership', 0, 'deleted', true), false)
  assert.equal(call('handleCreateSetlistForSong', 'missing', 'Gig'), false)
  if (mode === 'storage') assert.equal(state.failures, 2)
}))

test('drawer-only track search keeps every setlist position and legitimate missing/tombstone references', async () => ui(async ({ render, input }) => {
  const songs = initialSongs(), setlists = [{ id: 'gig', name: 'Gig', songs: songs.map(s => ({ id: s.id, title: s.title }))
    .concat([{ id: 'missing', title: 'Lost' }, { id: 'trashed', title: 'Trashed' }]) }]
  await render({ isOpen: true, songs, setlists, activeSongIndex: 0, activeSetlistId: 'gig', onClose() {}, onSelectSongIndex() {}, onDeleteSong() {}, onNewSong() {} })
  await input(document.querySelector('input[type=text]'), 'Beta')
  assert.match(document.body.textContent, /Alpha/)
  assert.match(document.body.textContent, /Gamma/)
  assert.doesNotMatch(document.body.textContent, /Missing song: Alpha|Missing song: Gamma/)
  assert.match(document.body.textContent, /Missing song: Lost/)
  assert.match(document.body.textContent, /Missing song: Trashed/)
  await input(document.querySelector('input[type=text]'), 'no match')
  assert.match(document.body.textContent, /No setlists match/)
  await input(document.querySelector('input[type=text]'), '')
  assert.match(document.body.textContent, /Missing song: Lost/)
}))
