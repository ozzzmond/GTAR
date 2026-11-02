// #252 Cloud V2 P1: B2 cross-tab safety, account partitions, Cloud V1 sync boundary, restore regression,
// 10,000-song measurements and Songbook list windowing.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/b2Harness.cjs')
const { installNavigatorLocks } = require('./helpers/fakeLocks.cjs')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

installNavigatorLocks()
const V1 = 'gtar_library_v1'

/** Device with a legacy library owned by `owner`, signed in as `session`, B2 turned on. */
function device({ owner = 'user-a', session = 'user-a', n = 30, setlists = 4, storage = h.freshStorage() } = {}) {
  const factory = new h.Factory()
  const tab = h.newTab()
  if (owner) h.bindOwner(storage, owner)
  h.signIn(storage, session)
  if (n) tab.sj.persistLibrary(h.library(n, setlists), storage)
  tab.sj.enableLibraryB2(storage)
  return { storage, factory }
}
async function open(storage, factory) {
  const tab = h.newTab()
  const prepared = await tab.sj.prepareLibraryB2(storage, { factory })
  return { tab, prepared }
}
const edit = (tab, storage, i, fields) => {
  const lib = tab.sj.readPersistedLibrary(storage)
  tab.sj.persistLibrary({ ...lib, songs: lib.songs.map((s, k) => k === i ? { ...s, ...fields } : s) }, storage, { expectedRaw: tab.sj.libraryRevision(storage) })
}


function withDom(fn) {
  return async () => {
    const { JSDOM } = require('jsdom')
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: `https://${h.HOST}/` })
    const prior = { window: global.window, document: global.document }
    Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
    const root = createRoot(document.getElementById('root'))
    try { await fn({ dom, root }) } finally { await act(async () => root.unmount()); Object.assign(global, prior); dom.window.close() }
  }
}
test('10,000 songs: cold start, saving, search and opening measured (Node + in-memory IndexedDB, not a device result)', withDom(async ({ root }) => {
  const storage = h.freshStorage()
  const factory = new h.Factory()
  const setup = h.newTab()
  h.bindOwner(storage, 'user-a'); h.signIn(storage, 'user-a')
  setup.sj.persistLibrary(h.library(10000, 300), storage)
  setup.sj.enableLibraryB2(storage)
  await open(storage, factory) // migration (measured in libraryB2Storage)
  let t = performance.now()
  const { tab, prepared } = await open(storage, factory)
  const coldStart = performance.now() - t
  assert.equal(prepared.songs, 10000)
  const lib = tab.sj.readPersistedLibrary(storage)
  // Saving: 20 consecutive single-song edits.
  const saves = [], commits = []
  let current = lib
  for (let i = 0; i < 20; i++) {
    const next = { ...current, songs: current.songs.map((s, k) => k === i * 400 ? { ...s, title: `${s.title} *` } : s) }
    t = performance.now(); tab.sj.persistLibrary(next, storage, { expectedRaw: tab.sj.libraryRevision(storage) }); saves.push(performance.now() - t)
    t = performance.now(); await tab.b2.flushB2(); commits.push(performance.now() - t)
    current = next
  }
  // Opening a song: lookup by id in the loaded library.
  t = performance.now()
  for (let i = 0; i < 1000; i++) current.songs.find(s => s.id === `synthetic-${String(9000 + (i % 900)).padStart(6, '0')}`)
  const openMs = (performance.now() - t) / 1000
  // Songbook: windowed render and search keystrokes.
  const { partitionSongs } = require('../src/utils/setlistSongs.ts')
  const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
  const active = partitionSongs(current.songs).active
  const props = { songs: active, setlists: current.setlists, activeSongIndex: 0, onSelectSong: () => {}, onSongMembershipChange: () => {},
    onCreateSetlistForSong: () => {}, onNewSong: () => {}, onOpenSetlists: () => {}, onDeleteSong: () => {} }
  t = performance.now()
  await act(async () => root.render(React.createElement(SongbookHomeView, { ...props, searchQuery: '' })))
  const firstRender = performance.now() - t
  const cards = () => document.querySelectorAll('[data-testid^="song-card-"]').length
  assert.ok(cards() > 0 && cards() <= 240, `rendered ${cards()} of ${active.length} cards`)
  assert.match(document.querySelector('[data-testid="song-grid"]').getAttribute('data-window'), /^0-\d+$/)
  const keystrokes = []
  for (const query of ['s', 'sy', 'syn', 'synthetic song 00', 'synthetic song 0099']) {
    t = performance.now()
    await act(async () => root.render(React.createElement(SongbookHomeView, { ...props, searchQuery: query })))
    keystrokes.push(performance.now() - t)
  }
  assert.equal(cards(), [...active].filter(s => s.title.toLowerCase().includes('synthetic song 0099')).length, 'short result renders in full')
  // The Song Setlists panel (300 setlists here) renders in full; measure the song list alone too.
  const songOnly = []
  for (const query of ['s', 'sy', 'syn', 'synthetic song 00', 'synthetic song 0099']) {
    t = performance.now()
    await act(async () => root.render(React.createElement(SongbookHomeView, { ...props, setlists: [], searchQuery: query })))
    songOnly.push(performance.now() - t)
  }
  const avg = list => list.reduce((a, b) => a + b, 0) / list.length
  const max = list => Math.max(...list)
  console.log(`[B2 measure] 10,000 songs: cold start (load + verify) ${coldStart.toFixed(0)} ms; save avg ${avg(saves).toFixed(1)} / max ${max(saves).toFixed(1)} ms (sync); commit avg ${avg(commits).toFixed(1)} ms; open lookup ${openMs.toFixed(3)} ms; list first render ${firstRender.toFixed(0)} ms (${cards()} cards); search keystroke avg ${avg(keystrokes).toFixed(0)} / max ${max(keystrokes).toFixed(0)} ms with 300 setlists, ${avg(songOnly).toFixed(0)} / ${max(songOnly).toFixed(0)} ms song list only (React development build in jsdom); Node heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MiB (test process, all fixtures)`)
  assert.ok(max(saves) < 250, 'synchronous save stays small')
}))
