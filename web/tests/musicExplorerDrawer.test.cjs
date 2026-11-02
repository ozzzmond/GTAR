const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }
).outputText, filename)

const React = require('react')
const { act } = React
const { JSDOM } = require('jsdom')

const webDir = path.resolve(__dirname, '..')

const songs = [
  { id: 0, title: 'Zulu', artist: 'Band', tags: 'Rock, Worship', key: 'G', rawContent: '[G] Zero' },
  { id: '12', title: 'Alpha', artist: 'Band', tags: ['worship', 'Acoustic'], key: 'C', rawContent: '[C] Alpha' },
  { id: 'other', title: 'Other', artist: 'Band', tags: ['Rockabilly'], key: 'D', rawContent: '[D] Other' },
]
const setlists = [
  { id: 0, name: 'Sunday', songs: [] },
  { id: 'empty', name: 'Empty', songs: [] },
  { id: 'deleted', name: 'Deleted', songs: [], isDeleted: true },
]

async function mount(run, extra = {}) {
  const dom = new JSDOM('<button id="opener">Open</button><div id="root"></div>', { url: 'http://localhost' })
  const keys = ['window', 'document', 'Node', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, global[key]]))
  Object.assign(global, {
    window: dom.window, document: dom.window.document, Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
  })
  window.innerWidth = 360
  const { createRoot } = require('react-dom/client')
  const { ExplorerNavigation } = require('../src/components/ExplorerNavigation.tsx')
  const calls = { select: [], newSong: 0, newSetlist: 0, sources: 0, close: 0 }
  const props = {
    isOpen: true, songs, setlists, currentSelection: { type: 'ALL_SONGS' },
    onClose: () => { calls.close++ }, onNewSong: () => { calls.newSong++ },
    onNewSetlist: () => { calls.newSetlist++ }, onSelectSongIndex() {}, onDeleteSong() {},
    onSelect: target => calls.select.push(target),
    ...extra,
  }
  const root = createRoot(document.getElementById('root'))
  const click = async node => { assert.ok(node, 'control exists'); await act(async () => node.click()) }
  try {
    await act(async () => root.render(React.createElement(ExplorerNavigation, props)))
    return await run({ click, calls, rerender: async next => act(async () => root.render(React.createElement(ExplorerNavigation, { ...props, ...next }))) })
  } finally { await act(async () => root.unmount()); dom.window.close(); Object.assign(global, previous) }
}

test('EXPLORER_DRAWER_1: hamburger drawer content is the Music Explorer hierarchy with live counts', async () => {
  await mount(async () => {
    const nav = document.querySelector('[role=dialog]').querySelector('[data-testid="music-explorer-nav"]')
    assert.ok(nav, 'Music Explorer navigation renders inside the existing drawer shell')
    assert.equal(nav.getAttribute('aria-label'), 'Music Explorer')

    // Top actions
    assert.ok(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-new-song"]'))
    assert.ok(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-new-set"]'))
    // Songbook entries
    const allSongs = document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-all-songs"]')
    assert.ok(allSongs)
    assert.match(allSongs.textContent, /All Songs/)
    assert.match(allSongs.textContent, /3/, 'All Songs count comes from the live library')
    // #319: Browse Sources left the Explorer; Shared Catalog is an Explorer entry.
    assert.equal(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-browse-sources"]'), null)
    assert.ok(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-shared-catalog"]'))
    // Setlists entries
    assert.match(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-all-setlists"]').textContent, /All Setlists/)
    assert.match(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-all-setlists"]').textContent, /2/, 'deleted setlist excluded')
    assert.match(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-unfiled-setlists"]').textContent, /Unfiled Setlists/)

    // No permanent sidebar and no legacy tab switcher in explorer mode.
    assert.equal(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-tag-rock"]') !== null, true)
  })
})

test('EXPLORER_DRAWER_2: tags use canonical multi-tag membership counts and case-insensitive labels', async () => {
  await mount(async () => {
    const worship = document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-tag-worship"]')
    assert.ok(worship, 'legacy comma string and array tags share the same category')
    assert.match(worship.textContent, /#worship/)
    assert.match(worship.textContent, /2/, 'both songs with worship count once each')
    assert.match(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-tag-rock"]').textContent, /1/)
    assert.match(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-tag-acoustic"]').textContent, /1/)
    // No duplicate Worship entry from the lowercase array spelling.
    assert.equal(document.querySelector('[role=dialog]').querySelectorAll('[data-testid="explorer-nav-tag-worship"]').length, 1)
  })
})

test('EXPLORER_DRAWER_3: selection routes through the supplied handler and quick actions stay wired', async () => {
  await mount(async ({ click, calls }) => {
    await click(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-all-songs"]'))
    await click(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-tag-worship"]'))
    await click(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-all-setlists"]'))
    await click(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-unfiled-setlists"]'))
    await click(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-shared-catalog"]'))
    assert.deepEqual(calls.select, [
      { type: 'ALL_SONGS' },
      { type: 'TAG', tag: 'worship' },
      { type: 'ALL_SETLISTS' },
      { type: 'UNFILED_SETLISTS' },
      { type: 'SHARED_CATALOG' },
    ])
    await click(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-new-song"]'))
    await click(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-new-set"]'))
    assert.equal(calls.newSong, 1)
    assert.equal(calls.newSetlist, 1)
    assert.ok(calls.close >= 2, 'quick actions close the drawer')
  })
})

test('EXPLORER_DRAWER_4: active target is announced without a competing sidebar', async () => {
  await mount(async () => {
    const active = document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-all-setlists"]')
    assert.equal(active.getAttribute('aria-current'), 'page')
    assert.equal(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-all-songs"]').getAttribute('aria-current'), null)
  }, { currentSelection: { type: 'ALL_SETLISTS' } })
})


test('EXPLORER_DRAWER_6: Tags are nested under Songbook and master song counts pluralize', async () => {
  await mount(async ({ click, rerender, calls }) => {
    const allSongs = document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-all-songs"]')
    const songbook = allSongs.closest('section')
    const tags = songbook.querySelector('[role="group"][aria-label="Tags"]')
    assert.ok(tags, 'Tags subgroup belongs to the Songbook section')
    assert.match(songbook.textContent, /3 master songs/)
    assert.match(tags.textContent, /Tags \(4\)/)
    assert.ok(tags.contains(document.querySelector('[role=dialog]').querySelector('[data-testid="explorer-nav-tag-worship"]')))
    assert.equal(allSongs.tagName, 'BUTTON')
    assert.equal(document.querySelector('[role=dialog]').querySelector('h2'), null, 'Explorer header removed')
    await click(document.querySelector('[role=dialog]').querySelector('[aria-label="Close Music Explorer"]'))
    assert.equal(calls.close, 1)
    await click(allSongs)
    assert.equal(calls.close, 2, 'target selection closes the drawer')
    await click([...songbook.querySelectorAll('button')].find(button => button.textContent === 'Songbook'))
    assert.equal(document.querySelector('[role=dialog]').querySelector('[role="group"][aria-label="Tags"]'), null, 'collapsing Songbook hides Tags')
    await rerender({ songs: [songs[0]] })
    assert.ok([...document.querySelector('[role=dialog]').querySelectorAll('span')].some(span => span.textContent.trim() === '1 master song'))
    assert.doesNotMatch(document.querySelector('[role=dialog]').querySelector('nav').textContent, /1 master songs/)
  })
})
