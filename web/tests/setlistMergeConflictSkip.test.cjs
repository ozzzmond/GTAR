// #453 D6/D7: a setlist changed on this device since the backup is skipped and named; songs and the
// other setlists still merge. Covers the pure merge, the App import hook (Backup merge, Import Songs,
// setlist import and Band Sync all call it) and the Import Songs dialog.
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./helpers/tabHarness.cjs')
Object.assign(global, { HTMLElement: h.dom.window.HTMLElement, Node: h.dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(global, 'navigator', { configurable: true, value: h.dom.window.navigator })
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const song = (id, title, extra = {}) => ({ id, title, artist: 'A', key: 'G', capo: '', bpm: '120', format: 'CHORD_PRO', transposeOffset: 0, rawContent: `[G]${title}`, ...extra })
const ref = (s, list, position) => ({ id: s.id, title: s.title, artist: s.artist, entryId: `entry:${list}:${position}`, position })
const s1 = song('s1', 'One'), s2 = song('s2', 'Two'), s3 = song('s3', 'Three')
const fileList = (id, name, songs) => ({ id, name, createdAt: 1, songs: songs.map((s, i) => ref(s, id, i)) })
// The backup was made when l1 was "Gig"; the device has since renamed it and added a song.
const device = () => ({ songs: [s1, s2], setlists: [fileList('l1', 'Gig (renamed here)', [s1, s2]), fileList('same', 'Same', [s1])] })
const backup = () => ({ songs: [song('s1', 'One', { rawContent: '[G]One, edited in the backup' }), s2, s3],
  setlists: [fileList('l1', 'Gig', [s1]), fileList('same', 'Same', [s1]), fileList('l2', 'New in backup', [s3])] })

test('pure merge: a changed setlist is skipped and named; others merge; identity and lifecycle disagreements still abort', () => {
  const { mergeImportedSetlists, mergeImportedSetlistsWithReport } = require('../src/utils/importIdentity.ts')
  const before = device(), incoming = backup()
  const frozen = JSON.stringify(before)
  const report = mergeImportedSetlistsWithReport(before.setlists, incoming.setlists)
  assert.deepEqual(report.skipped, [{ id: 'l1', name: 'Gig (renamed here)' }])
  assert.deepEqual(report.setlists.map(l => [l.id, l.name]), [['l1', 'Gig (renamed here)'], ['same', 'Same'], ['l2', 'New in backup']])
  assert.deepEqual(report.setlists[0], before.setlists[0], 'device version kept untouched')
  assert.deepEqual(mergeImportedSetlists(before.setlists, incoming.setlists), report.setlists)
  assert.equal(JSON.stringify(before), frozen)
  assert.deepEqual(mergeImportedSetlistsWithReport(report.setlists, report.setlists).skipped, [], 're-applying the result is a no-op')
  assert.throws(() => mergeImportedSetlistsWithReport(before.setlists, [{ ...incoming.setlists[0], isDeleted: true }]), /lifecycle conflict/)
  assert.throws(() => mergeImportedSetlistsWithReport([{ ...before.setlists[0], id: ' l1 ' }], incoming.setlists), /canonical ID collision/)
})

async function mountHook(before, storage, toasts = []) {
  const sj = require('../src/utils/syncJournal.ts')
  const { useLibraryImports } = require('../src/utils/useLibraryImports.ts')
  sj.persistLibrary(before, storage)
  const baseline = { current: sj.libraryRevision(storage) }, noop = () => {}
  const out = { toasts }
  function Harness() {
    const [songs, setSongs] = React.useState(before.songs), [deletedSongs, setDeletedSongs] = React.useState([]), [setlists, setSetlists] = React.useState(before.setlists)
    out.actions = useLibraryImports({ songs, deletedSongs, setlists, setSongs, setDeletedSongs, setSetlists, persistedBaselineRef: baseline, setCrossTabConflict: noop,
      setToastMessage: m => { if (m) toasts.push(m) }, setActiveSongIndex: noop, setActiveSetlistId: noop, setActiveSetlistSongIndex: noop, setQueueMode: noop, setIncomingSharedSetlist: noop })
    out.state = { songs, setlists }
    return null
  }
  out.root = createRoot(document.createElement('div'))
  await act(async () => out.root.render(React.createElement(Harness)))
  return out
}

test('import hook: merge saves songs and non-conflicting setlists, reports the skipped setlist, and read-back verification passes', async () => {
  const storage = h.freshStorage(), sj = require('../src/utils/syncJournal.ts'), { verifyRestoredLibrary, skippedMergeSetlists } = require('../src/utils/backupExport.ts')
  const { parseBackupJson } = require('../src/utils/jsonBackup.ts')
  const before = device()
  const mounted = await mountHook(before, storage)
  try {
    const parsed = parseBackupJson(JSON.stringify(backup()), { mode: 'merge', existingSongs: before.songs })
    assert.equal(parsed.isValid, true, parsed.error)
    let result
    await act(async () => { result = mounted.actions.handleSmartMerge(parsed.songs, parsed.setlists) })
    assert.deepEqual(result, { skippedSetlists: [{ id: 'l1', name: 'Gig (renamed here)' }] })
    const saved = sj.readPersistedLibrary(storage)
    assert.deepEqual(saved.songs.map(s => s.id), ['s1', 's2', 's3'])
    assert.equal(saved.songs[0].rawContent, '[G]One, edited in the backup', 'songs still merge')
    assert.deepEqual(saved.setlists.map(l => [l.id, l.name, l.songs.length]), [['l1', 'Gig (renamed here)', 2], ['same', 'Same', 1], ['l2', 'New in backup', 1]])
    assert.deepEqual(mounted.state.setlists.map(l => l.name), ['Gig (renamed here)', 'Same', 'New in backup'])
    const incoming = { songs: parsed.songs, setlists: parsed.setlists }
    assert.deepEqual(verifyRestoredLibrary(before, incoming, 'merge', storage), [], 'DeviceBackupCard read-back check accepts the skip')
    assert.deepEqual(skippedMergeSetlists(before, incoming), result.skippedSetlists, 'the card names exactly what the merge skipped')
    // The check still catches a merge that replaced the skipped setlist with the backup's version.
    sj.persistLibrary({ ...saved, setlists: [parsed.setlists[0], ...saved.setlists.slice(1)] }, storage, { force: true })
    assert.match(verifyRestoredLibrary(before, incoming, 'merge', storage).join(';'), /setlist l1 differs in/)
  } finally { await act(async () => mounted.root.unmount()) }
})

test('import hook: single setlist import (Import Songs, setlist import button) says when the setlist was kept', async () => {
  const storage = h.freshStorage(), sj = require('../src/utils/syncJournal.ts')
  const before = device(), toasts = []
  const mounted = await mountHook(before, storage, toasts)
  try {
    let result
    await act(async () => { result = mounted.actions.handleImportSingleSetlist(fileList('l1', 'Gig', [s1, s3]), [s1, s3]) })
    assert.deepEqual(result.skippedSetlists, [{ id: 'l1', name: 'Gig (renamed here)' }])
    assert.equal(toasts.length, 1)
    assert.match(toasts[0], /Setlist "Gig \(renamed here\)" was changed on this device and was kept/)
    assert.doesNotMatch(toasts[0], /^Imported setlist/)
    const saved = sj.readPersistedLibrary(storage)
    assert.deepEqual(saved.songs.map(s => s.id), ['s1', 's2', 's3'], 'the file\'s songs are merged')
    assert.equal(saved.setlists[0].name, 'Gig (renamed here)')
    await act(async () => { result = mounted.actions.handleImportSingleSetlist(fileList('l9', 'Fresh', [s1]), [s1]) })
    assert.deepEqual(result.skippedSetlists, [])
    assert.match(toasts[1], /^Imported setlist "Fresh" \(1 songs\)/)
  } finally { await act(async () => mounted.root.unmount()) }
})

let root
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null })
test('Import Songs dialog: a backup with a changed setlist imports and names the setlist it kept', async () => {
  const { ImportDialogModal } = require('../src/components/ImportDialogModal.tsx')
  const { mergeImportedSetlistsWithReport } = require('../src/utils/importIdentity.ts')
  const before = device(), calls = []
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root'))
  let closed = false
  await act(async () => root.render(React.createElement(ImportDialogModal, { isOpen: true, onClose() { closed = true }, onImportSong() {}, onImportAllSongs() {},
    existingSongs: before.songs, existingSetlists: before.setlists,
    onSmartMerge: (songs, setlists) => { calls.push(setlists.length); return { skippedSetlists: mergeImportedSetlistsWithReport(before.setlists, setlists).skipped } } })))
  const input = document.querySelector('input[type="file"]:not([multiple])')
  Object.defineProperty(input, 'files', { configurable: true, value: [new h.dom.window.File([JSON.stringify(backup())], 'backup.json', { type: '' })] })
  await act(async () => { input.dispatchEvent(new h.dom.window.Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 20)) })
  assert.deepEqual(calls, [3])
  assert.match(document.body.textContent, /Imported 3 songs and 2 of 3 setlists\. Kept as it is on this device \(changed since the file was made\): "Gig \(renamed here\)"/)
  assert.equal(closed, false)
})
