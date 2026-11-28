// #646: Emergency song export directly from the selected setlist header toolbar.
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
    fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, filename)
}
require.extensions['.png'] = module => { module.exports = '/logo.png' }

const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
Object.assign(global, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  Event: dom.window.Event,
})
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
global.IS_REACT_ACT_ENVIRONMENT = true

const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { SetlistWorkspace } = require('../src/components/SetlistWorkspace.tsx')
const { ImportDialogModal } = require('../src/components/ImportDialogModal.tsx')
const { resolveSetlistExportScope } = require('../src/utils/setlistSongs.ts')
const exp = require('../src/utils/songExport.ts')

const makeSong = (id, extra = {}) => ({
  id,
  title: `Song ${id}`,
  artist: `Artist ${id}`,
  key: 'G',
  capo: 'No Capo',
  bpm: '120',
  rawContent: `{title: Song ${id}}\n{artist: Artist ${id}}\n{key: G}\n\n[G]Line for [C]${id}\n`,
  format: 'CHORD_PRO',
  transposeOffset: 0,
  ...extra,
})

const makeSetlist = (id, name, refs) => ({
  id,
  name,
  songs: refs.map((ref, position) => ({
    entryId: `entry-${id}-${position}`,
    position,
    ...ref,
  })),
})

let root
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
})

const renderWorkspace = async (props) => {
  document.body.innerHTML = '<div id="root"></div>'
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(React.createElement(SetlistWorkspace, {
    scope: 'ALL_SETLISTS',
    setlists: props.setlists,
    songs: props.songs,
    openSetlistId: props.openSetlistId,
    onOpenSetlistChange() {},
    onPlaySetlistPosition() {},
    onRequestTrashSetlist() {},
    menu: {
      sortValue: 'manual',
      sortOptions: [{ value: 'manual', label: 'Manual Order' }],
      onSortChange() {},
      onShareSetlist() {},
      onExportSetlist() {},
    },
    ...props,
  })))
}

const $ = sel => document.querySelector(sel)
const click = el => act(async () => { el.click() })

test('toolbar placement: Export Songs sits between Share and Trash, not in three-dot menu', async () => {
  const songs = [1, 2, 3, 4, 5].map(n => makeSong(`s${n}`))
  const sl = makeSetlist('sl-nov29', 'Nov 29 2026', songs.map(s => ({ id: s.id, title: s.title, artist: s.artist })))
  await renderWorkspace({ setlists: [sl], songs, openSetlistId: sl.id })

  const play = $('[data-testid="workspace-play-setlist"]')
  const search = $('[data-testid="workspace-search-songs"]')
  const share = $('[data-testid="workspace-share-setlist"]')
  const exportBtn = $('[data-testid="workspace-export-setlist-songs"]')
  const trash = $('[data-testid="workspace-delete-setlist"]')

  assert.ok(play && search && share && exportBtn && trash, 'all five toolbar buttons exist')
  assert.equal(exportBtn.getAttribute('aria-label'), 'Export Songs')
  assert.match(exportBtn.className, /\bmin-h-11\b/)
  assert.match(exportBtn.className, /\bmin-w-11\b/)

  const ordered = [play, search, share, exportBtn, trash]
  for (let i = 0; i < ordered.length - 1; i++) {
    assert.ok(
      ordered[i].compareDocumentPosition(ordered[i + 1]) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
      `button ${i} precedes button ${i + 1}`
    )
  }

  assert.equal($('[data-testid="workspace-scope-menu-btn"]'), null, 'meatball menu is removed from setlists toolbar')
})

test('5-song setlist exports only its 5 songs offline without mutating songs or setlist, and imports back', async () => {
  const librarySongs = [1, 2, 3, 4, 5, 6, 7, 8].map(n => makeSong(`s${n}`, { transposeOffset: n === 2 ? 3 : 0 }))
  const snapshotBefore = JSON.stringify(librarySongs)
  const sl = makeSetlist('sl-nov29', 'Nov 29 2026', [1, 2, 3, 4, 5].map(n => ({
    id: `s${n}`,
    title: `Song s${n}`,
    artist: `Artist s${n}`,
  })))
  const setlistBefore = JSON.stringify(sl)

  const originalFetch = global.fetch
  global.fetch = () => { throw new Error('Network must not be called during offline export') }
  const blobs = []
  const downloads = []
  global.URL.createObjectURL = blob => { blobs.push(blob); return 'blob:offline' }
  global.URL.revokeObjectURL = () => {}
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download) }

  try {
    await renderWorkspace({ setlists: [sl], songs: librarySongs, openSetlistId: sl.id })
    await click($('[data-testid="workspace-export-setlist-songs"]'))

    const dialog = $('[data-testid="export-songs-dialog"]')
    assert.ok(dialog, 'ExportSongsDialog opens')
    assert.equal($('[data-testid="export-selected-count"]').textContent, '5 selected')
    const listedTitles = [...dialog.querySelectorAll('ul li label span.truncate')].map(el => el.textContent)
    assert.equal(listedTitles.length, 5)
    assert.ok(!listedTitles.some(t => t.includes('s6') || t.includes('s7') || t.includes('s8')), 'no unrelated library songs')

    // PDF options & key clarification remain available
    await click($('[data-testid="export-format-pdf"]'))
    assert.ok($('[data-testid="export-key-saved"]').checked)
    assert.ok($('[data-testid="export-key-transposed"]'))
    await click($('[data-testid="export-format-txt"]'))

    await click($('[data-testid="export-run-btn"]'))
    assert.deepEqual(downloads, ['GTAR songs (5).txt'])
    assert.equal(blobs.length, 1)

    const exportedText = await blobs[0].text()
    assert.equal(exp.splitTxtSongs(exportedText).length, 5)
    assert.ok(!exportedText.includes('Song s6') && !exportedText.includes('Song s7') && !exportedText.includes('Song s8'))
    assert.equal(JSON.stringify(librarySongs), snapshotBefore, 'library songs are not mutated')
    assert.equal(JSON.stringify(sl), setlistBefore, 'setlist is not mutated')

    // Verify exported TXT imports back via existing ImportDialogModal
    const importedMany = []
    await act(async () => root.unmount())
    document.body.innerHTML = '<div id="root"></div>'
    root = createRoot(document.getElementById('root'))
    await act(async () => root.render(React.createElement(ImportDialogModal, {
      isOpen: true,
      onClose() {},
      onImportSong() {},
      onImportAllSongs: songs => importedMany.push(songs),
    })))
    const input = document.querySelector('input[type="file"]:not([multiple])')
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new dom.window.File([exportedText], downloads[0], { type: 'text/plain' })],
    })
    await act(async () => {
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
      await new Promise(r => setTimeout(r, 20))
    })
    assert.equal(importedMany.length, 1)
    assert.deepEqual(importedMany[0].map(s => s.title), ['Song s1', 'Song s2', 'Song s3', 'Song s4', 'Song s5'])
  } finally {
    global.fetch = originalFetch
  }
})

test('edge cases: empty setlist, duplicate references, and missing/trashed songs are handled explicitly', async () => {
  // 1. Empty setlist
  const emptySl = makeSetlist('sl-empty', 'Empty Setlist', [])
  await renderWorkspace({ setlists: [emptySl], songs: [makeSong('s1')], openSetlistId: emptySl.id })
  await click($('[data-testid="workspace-export-setlist-songs"]'))
  assert.ok($('[data-testid="export-empty-setlist-notice"]'))
  assert.equal($('[data-testid="export-run-btn"]').disabled, true)

  // 2. Duplicate references + missing + trashed songs
  const songs = [
    makeSong('s1'),
    makeSong('s2'),
    makeSong('s-trashed', { isDeleted: true }),
  ]
  const mixedSl = makeSetlist('sl-mixed', 'Mixed Setlist', [
    { id: 's1', title: 'Song s1' },
    { id: 's1', title: 'Song s1' }, // duplicate
    { id: 's-missing', title: 'Ghost Song' }, // missing
    { id: 's-trashed', title: 'Song s-trashed' }, // trashed
    { id: 's2', title: 'Song s2' },
  ])

  const scope = resolveSetlistExportScope(mixedSl, songs)
  assert.deepEqual(scope.songs.map(s => s.id), ['s1', 's2'])
  assert.equal(scope.duplicateCount, 1)
  assert.deepEqual(scope.missingEntries.map(e => e.title), ['Ghost Song', 'Song s-trashed'])

  await renderWorkspace({ setlists: [mixedSl], songs, openSetlistId: mixedSl.id })
  await click($('[data-testid="workspace-export-setlist-songs"]'))
  assert.equal($('[data-testid="export-selected-count"]').textContent, '2 selected')
  assert.match($('[data-testid="export-duplicate-songs-notice"]').textContent, /1 duplicate reference/)
  const missingNotice = $('[data-testid="export-missing-songs-notice"]')
  assert.ok(missingNotice)
  assert.match(missingNotice.textContent, /Ghost Song/)
  assert.match(missingNotice.textContent, /Song s-trashed/)
})
