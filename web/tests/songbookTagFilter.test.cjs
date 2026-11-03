const { test } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/tabHarness.cjs')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')

global.IS_REACT_ACT_ENVIRONMENT = true
Object.assign(global, { HTMLElement: window.HTMLElement, Node: window.Node })
Object.defineProperty(global, 'navigator', { configurable: true, value: window.navigator })

async function fixture(run) {
  h.freshStorage()
  const tags = [[' #Rock ', 'rock'], ' #Jazz, jazz ', [], [' ', '##'], undefined]
  const songs = h.library(5, 0).songs.map((song, i) => ({
    ...song, id: `song-${i}`, title: `Song ${i}`, tags: tags[i],
    artist: 'Artist', originalKey: 'G', bpm: '120', time: '4/4',
    year: i === 1 ? '' : '2020', rawContent: '[G]Lyrics',
  }))
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const props = {
    songs, activeSongIndex: 0, setlists: [{ id: 'set', name: 'Set', songs: [{ id: 'song-1' }] }],
    onSelectSong() {}, onNewSong() {}, onOpenSetlists() {}, onDeleteSong() {},
    onSongMembershipChange() {}, onCreateSetlistForSong() {},
  }
  const find = id => host.querySelector(`[data-testid="${id}"]`)
  const change = async (id, value) => {
    const select = find(id)
    assert.ok(select, `${id} exists`)
    await act(async () => {
      select.value = value
      select.dispatchEvent(new window.Event('change', { bubbles: true }))
    })
  }
  const visible = () => [...host.querySelectorAll('[data-testid^="song-card-"]')].map(card => card.dataset.testid)
  const render = async (extra = {}) => act(async () => root.render(React.createElement(SongbookHomeView, { ...props, ...extra })))
  try { await render(); await run({ host, find, change, visible, root, render }) }
  finally { await act(async () => root.unmount()); host.remove() }
}

test('Tagged uses canonical array and legacy tags; Select All selects only filtered songs', () => fixture(async ({ find, change, visible }) => {
  await change('filter-tags-select', 'TAGGED')
  assert.deepEqual(visible(), ['song-card-0', 'song-card-1'])
  assert.equal(find('songs-library-count').textContent.trim(), '(2 songs)')
  await act(async () => find('toggle-song-selection-mode').click())
  await act(async () => find('select-all-songs').click())
  assert.equal(find('song-selection-count').textContent, '2 selected')
  await change('filter-setlist-select', 'set')
  assert.deepEqual(visible(), ['song-card-1'])
  await act(async () => find('sort-title').click())
  assert.deepEqual(visible(), ['song-card-1'])
}))

test('No tag includes empty, blank and missing tags; preference survives remount', () => fixture(async ({ find, change, visible, root, render }) => {
  await change('filter-tags-select', 'NO_TAG')
  assert.deepEqual(visible(), ['song-card-2', 'song-card-3', 'song-card-4'])
  assert.equal(find('songs-library-count').textContent.trim(), '(3 songs)')
  await act(async () => root.render(null))
  await render()
  assert.equal(find('filter-tags-select').value, 'NO_TAG')
  assert.deepEqual(visible(), ['song-card-2', 'song-card-3', 'song-card-4'])
  await change('filter-tags-select', 'ALL')
  assert.equal(visible().length, 5)
}))

test('Tagged intersects metadata and search; empty state resets all filters', () => fixture(async ({ host, find, change, visible, render }) => {
  await change('filter-tags-select', 'TAGGED')
  await change('filter-metadata-select', 'METADATA_OK')
  assert.deepEqual(visible(), ['song-card-0'])
  assert.equal(find('songs-library-count').textContent.trim(), '(1 song)')
  await change('filter-metadata-select', 'NEEDS_METADATA')
  assert.deepEqual(visible(), ['song-card-1'])
  await change('filter-setlist-select', 'set')
  let clearedQuery
  await render({ searchQuery: 'Song 0', onSearchQueryChange: query => { clearedQuery = query } })
  assert.deepEqual(visible(), [])
  assert.equal(find('songs-library-count').textContent.trim(), '(0 songs)')
  assert.match(host.textContent, /No matching songs found/)
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Reset Filters').click())
  assert.equal(find('filter-tags-select').value, 'ALL')
  assert.equal(find('filter-metadata-select').value, 'ALL')
  assert.equal(find('filter-setlist-select').value, 'ALL')
  assert.equal(clearedQuery, '')
  await render({ searchQuery: clearedQuery })
  assert.equal(visible().length, 5)
}))
