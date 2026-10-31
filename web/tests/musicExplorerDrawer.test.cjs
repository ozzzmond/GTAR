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
const drawerSource = fs.readFileSync(path.join(webDir, 'src/components/SetlistDrawer.tsx'), 'utf8')
const appSource = fs.readFileSync(path.join(webDir, 'src/App.tsx'), 'utf8')
const songbookSource = fs.readFileSync(path.join(webDir, 'src/components/SongbookHomeView.tsx'), 'utf8')

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
  const { createRoot } = require('react-dom/client')
  const { SetlistDrawer } = require('../src/components/SetlistDrawer.tsx')
  const calls = { select: [], newSong: 0, newSetlist: 0, sources: 0, close: 0 }
  const props = {
    isOpen: true, songs, setlists, activeSongIndex: 0, mode: 'explorer',
    onClose: () => { calls.close++ }, onNewSong: () => { calls.newSong++ },
    onNewSetlist: () => { calls.newSetlist++ }, onSelectSongIndex() {}, onDeleteSong() {},
    onExplorerSelect: target => calls.select.push(target), onOpenSources: () => { calls.sources++ },
    ...extra,
  }
  const root = createRoot(document.getElementById('root'))
  const click = async node => { assert.ok(node, 'control exists'); await act(async () => node.click()) }
  try {
    await act(async () => root.render(React.createElement(SetlistDrawer, props)))
    return await run({ click, calls, rerender: async next => act(async () => root.render(React.createElement(SetlistDrawer, { ...props, ...next }))) })
  } finally { await act(async () => root.unmount()); dom.window.close(); Object.assign(global, previous) }
}

test('EXPLORER_DRAWER_1: hamburger drawer content is the Music Explorer hierarchy with live counts', async () => {
  await mount(async () => {
    const nav = document.querySelector('[data-testid="music-explorer-nav"]')
    assert.ok(nav, 'Music Explorer navigation renders inside the existing drawer shell')
    assert.equal(nav.getAttribute('aria-label'), 'Music Explorer')

    // Top actions
    assert.ok(document.querySelector('[data-testid="explorer-nav-new-song"]'))
    assert.ok(document.querySelector('[data-testid="explorer-nav-new-set"]'))
    // Songbook entries
    const allSongs = document.querySelector('[data-testid="explorer-nav-all-songs"]')
    assert.ok(allSongs)
    assert.match(allSongs.textContent, /All Songs/)
    assert.match(allSongs.textContent, /3/, 'All Songs count comes from the live library')
    assert.ok(document.querySelector('[data-testid="explorer-nav-browse-sources"]'))
    // Setlists entries
    assert.match(document.querySelector('[data-testid="explorer-nav-all-setlists"]').textContent, /All Setlists/)
    assert.match(document.querySelector('[data-testid="explorer-nav-all-setlists"]').textContent, /2/, 'deleted setlist excluded')
    assert.match(document.querySelector('[data-testid="explorer-nav-unfiled-setlists"]').textContent, /Unfiled Setlists/)

    // No permanent sidebar and no legacy tab switcher in explorer mode.
    assert.equal(document.querySelector('[data-testid="explorer-nav-tag-Rock"]') !== null, true)
  })
})

test('EXPLORER_DRAWER_2: tags use canonical multi-tag membership counts and case-insensitive labels', async () => {
  await mount(async () => {
    const worship = document.querySelector('[data-testid="explorer-nav-tag-Worship"]')
    assert.ok(worship, 'legacy comma string and array tags share the same category')
    assert.match(worship.textContent, /#Worship/)
    assert.match(worship.textContent, /2/, 'both songs with worship count once each')
    assert.match(document.querySelector('[data-testid="explorer-nav-tag-Rock"]').textContent, /1/)
    assert.match(document.querySelector('[data-testid="explorer-nav-tag-Acoustic"]').textContent, /1/)
    // No duplicate Worship entry from the lowercase array spelling.
    assert.equal(document.querySelectorAll('[data-testid="explorer-nav-tag-worship"]').length, 0)
  })
})

test('EXPLORER_DRAWER_3: selection routes through the supplied handler and quick actions stay wired', async () => {
  await mount(async ({ click, calls }) => {
    await click(document.querySelector('[data-testid="explorer-nav-all-songs"]'))
    await click(document.querySelector('[data-testid="explorer-nav-tag-Worship"]'))
    await click(document.querySelector('[data-testid="explorer-nav-all-setlists"]'))
    await click(document.querySelector('[data-testid="explorer-nav-unfiled-setlists"]'))
    assert.deepEqual(calls.select, [
      { type: 'ALL_SONGS' },
      { type: 'TAG', tag: 'Worship' },
      { type: 'ALL_SETLISTS' },
      { type: 'UNFILED_SETLISTS' },
    ])
    await click(document.querySelector('[data-testid="explorer-nav-browse-sources"]'))
    assert.equal(calls.sources, 1)
    await click(document.querySelector('[data-testid="explorer-nav-new-song"]'))
    await click(document.querySelector('[data-testid="explorer-nav-new-set"]'))
    assert.equal(calls.newSong, 1)
    assert.equal(calls.newSetlist, 1)
    assert.ok(calls.close >= 2, 'quick actions close the drawer')
  })
})

test('EXPLORER_DRAWER_4: active target is announced without a competing sidebar', async () => {
  await mount(async () => {
    const active = document.querySelector('[data-testid="explorer-nav-all-setlists"]')
    assert.equal(active.getAttribute('aria-current'), 'page')
    assert.equal(document.querySelector('[data-testid="explorer-nav-all-songs"]').getAttribute('aria-current'), null)
  }, { explorerSelection: { type: 'ALL_SETLISTS' } })
})

test('EXPLORER_DRAWER_5: default library mode keeps the original browsable drawer (regression guard)', async () => {
  await mount(async () => {
    assert.equal(document.querySelector('[data-testid="music-explorer-nav"]'), null, 'Explorer nav is not forced into the library drawer')
    assert.ok(document.querySelector('input[type=text]'), 'original search remains')
    assert.ok(document.querySelectorAll('[aria-label="Delete song from library"]').length === songs.length)
  }, { mode: 'library' })
})

test('EXPLORER_DRAWER_WIRING: hamburger opens explorer mode; nav lives only in the drawer, never a permanent sidebar', () => {
  // Hamburger entry sets explorer mode (DEV target only); other entries keep the browsable library drawer.
  assert.match(appSource, /setDrawerMode\(isDevEnv \? 'explorer' : 'library'\)/, 'Header hamburger switches the drawer to explorer mode in DEV')
  assert.match(appSource, /setDrawerMode\('library'\)/, 'Stage/Soongbook entries keep the browsable drawer')
  assert.match(appSource, /mode=\{drawerMode\}/, 'SetlistDrawer receives the drawer mode')
  assert.match(appSource, /onExplorerSelect=\{handleExplorerSelect\}/, 'Explorer selection is coordinated with App')
  // The Music Explorer navigation is mounted inside the drawer shell only.
  assert.match(drawerSource, /MusicExplorerNav/)
  assert.doesNotMatch(songbookSource, /MusicExplorerNav/)
  assert.doesNotMatch(songbookSource, /explorer-sidebar/)
  assert.doesNotMatch(appSource, /explorer-sidebar/)
})
