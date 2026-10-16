const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)
const { previewBackupImport, confirmImportAsNew } = require('../src/utils/legacyImport.ts')
const { parseBackupJson, normalizeBackupSong, RESTORE_SNAPSHOT_KEY } = require('../src/utils/jsonBackup.ts')
const { mergeBackupLibrary } = require('../src/utils/setlistSongs.ts')
const { mergeImportedSetlists } = require('../src/utils/importIdentity.ts')
const { persistLibrary, LIBRARY_KEY } = require('../src/utils/syncJournal.ts')
const uuid = require('../src/utils/uuid.ts')
const song = { title: 'Song', artist: 'Artist', rawContent: '[G]Chart', tags: 'tag', originalKey: 'G', transposeOffset: 2, createdAt: 42, isFavorite: true }
const backup = { songs: [song], setlists: [{ name: 'Gig', createdAt: 7, songs: [{ title: 'Song' }, { title: 'Song', artist: 'Artist' }] }] }
const existing = { songs: [normalizeBackupSong({ ...song, id: 'existing', isDeleted: true })], setlists: [{ id: 'existing-list', name: 'Gig', isDeleted: true, songs: [] }] }
const preview = data => previewBackupImport(JSON.stringify(data))
function merge(library, imported) {
  const merged = mergeBackupLibrary(library.songs, imported.songs, imported.setlists)
  return { songs: merged.songs, setlists: mergeImportedSetlists(library.setlists, merged.setlists) }
}

test('full/Android legacy backup, song arrays, loose songs and embedded setlists require explicit Import as New', () => {
  for (const data of [backup, { ...backup, metadata: { appName: 'GTAR', appVersion: '1.0.42' } }, [song], song,
    { exportType: 'SINGLE_SETLIST', setlist: { name: 'Gig', songs: [song, song] } }]) {
    const raw = JSON.stringify(data)
    assert.equal(parseBackupJson(raw).isValid, false)
    const candidate = previewBackupImport(raw)
    assert.equal(candidate.isValid, true, candidate.error)
    assert.equal(candidate.importAsNew, true)
    const imported = confirmImportAsNew(candidate, existing, message => {
      assert.match(message, /Import as New.*fresh IDs/)
      return true
    })
    assert.equal(imported.isValid, true, imported.error)
    assert.ok(imported.songs.every(s => uuid.isValidUUID(s.id)))
    assert.equal(JSON.stringify(data), raw)
  }
})

test('preview and cancellation allocate no UUIDs; input, tombstones and chart metadata survive confirmed rebinding', () => {
  const original = uuid.generateUUID
  const before = JSON.stringify({ backup, existing })
  uuid.generateUUID = () => { throw new Error('preview allocated an ID') }
  let candidate
  try {
    candidate = preview(backup)
    assert.equal(candidate.isValid, true, candidate.error)
    assert.equal(confirmImportAsNew(candidate, existing, () => false), null)
  } finally { uuid.generateUUID = original }
  const imported = confirmImportAsNew(candidate, existing, () => true)
  assert.deepEqual(imported.setlists[0].songs.map(s => s.id), [imported.songs[0].id, imported.songs[0].id])
  assert.deepEqual({ ...imported.songs[0], id: undefined }, { ...normalizeBackupSong({ ...song, id: 'temporary' }), id: undefined })
  assert.equal(imported.setlists[0].createdAt, 7)
  const result = merge(existing, imported)
  assert.deepEqual(result.songs[0], existing.songs[0])
  assert.deepEqual(result.setlists[0], existing.setlists[0])
  assert.equal(result.setlists.length, 2)
  assert.equal(JSON.stringify({ backup, existing }), before)
})

test('mixed stable and absent IDs remap every imported record while preserving reference order', () => {
  const data = { songs: [{ ...song, id: 0 }, { ...song, title: 'Second', rawContent: 'second' }], setlists: [{ name: 'Gig', songs: [
    { title: 'Second' }, { id: '0', title: 'Song' }, { title: 'Second' },
  ] }] }
  const imported = confirmImportAsNew(preview(data), existing, () => true)
  assert.deepEqual(imported.setlists[0].songs.map(s => s.id), [imported.songs[1].id, imported.songs[0].id, imported.songs[1].id])
  assert.equal(imported.songs[1].rawContent, 'second')
  assert.notEqual(imported.songs[0].id, '0')
})

test('repeated attempts require confirmation every time; cancellation cannot duplicate; stable files keep G2 behavior', () => {
  let confirmations = 0
  const confirm = () => { confirmations++; return true }
  const first = confirmImportAsNew(preview(backup), existing, confirm)
  const library = merge(existing, first)
  assert.equal(confirmImportAsNew(preview(backup), library, () => { confirmations++; return false }), null)
  const second = confirmImportAsNew(preview(backup), library, confirm)
  assert.equal(confirmations, 3)
  assert.notEqual(first.songs[0].id, second.songs[0].id)
  assert.equal(merge(library, second).songs.length, 3)
  assert.equal(preview(first).importAsNew, undefined)
  assert.deepEqual(merge(library, preview(first)), library)
})

test('malformed data, canonical collisions, ambiguous names and references outside the incoming backup stay rejected', () => {
  for (const data of [
    { songs: [song, { ...song, rawContent: 'different chart' }], setlists: backup.setlists },
    { songs: [song], setlists: [{ name: 'Gig', songs: [{ id: 'existing', title: 'Song' }] }] },
    { songs: [song], setlists: [{ name: 'Gig', songs: [{ songId: 'existing' }] }] },
    { songs: [{ ...song, id: 42 }, { ...song, id: '42' }], setlists: [{ name: 'Gig', songs: [] }] },
    { songs: [{ ...song, id: 'same' }, { ...song, id: ' same ' }], setlists: [{ name: 'Gig', songs: [] }] },
    { songs: [{ ...song, id: null }] }, { songs: [{ title: 'Bad' }] },
    { ...backup, schemaVersion: 999 }, { ...backup, exportType: 'RECOVERY_ARCHIVE' },
    { songs: [song], setlists: [{ name: 'Gig', songs: ['Song'] }] },
  ]) {
    const result = previewBackupImport(JSON.stringify(data), { mode: 'merge', existingSongs: existing.songs })
    assert.equal(result.isValid, false, JSON.stringify(data))
    assert.deepEqual(result.songs, [])
    assert.deepEqual(result.setlists, [])
  }
})

test('UUID collision against existing songs, lists, or another new record aborts without mutation', () => {
  const original = uuid.generateUUID
  const before = JSON.stringify(existing)
  try {
    for (const id of ['existing', 'existing-list', 'new-but-repeated']) {
      uuid.generateUUID = () => id
      assert.throws(() => confirmImportAsNew(preview(backup), existing, () => true), /canonical ID collision/)
    }
    assert.equal(JSON.stringify(existing), before)
  } finally { uuid.generateUUID = original }
})

const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const { JSDOM } = require('jsdom')
async function withUi(run) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://gtar.test/' })
  const saved = Object.fromEntries(['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT', 'setTimeout'].map(key => [key, global[key]]))
  const timers = []
  Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
  global.setTimeout = (...args) => { const timer = saved.setTimeout(...args); timers.push(timer); return timer }
  const root = createRoot(document.getElementById('root'))
  try { await run({ dom, root }) } finally {
    await act(async () => root.unmount())
    timers.forEach(clearTimeout)
    Object.assign(global, saved)
    dom.window.close()
  }
}
async function upload(dom, raw) {
  const input = document.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { value: [{ name: 'legacy.json', text: async () => raw }], configurable: true })
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
}

for (const component of ['BackupRestoreDialogModal', 'ImportDialogModal']) test(`${component}: cancel, confirm, repeated import and persistence failure preserve durable library and recovery`, async () => withUi(async ({ dom, root }) => {
  const Modal = require(`../src/components/${component}.tsx`)[component]
  let library = existing
  let allow = false
  let fail = false
  let calls = 0
  let confirmations = 0
  persistLibrary(library, localStorage)
  localStorage.setItem(RESTORE_SNAPSHOT_KEY, 'snapshot bytes')
  localStorage.setItem('gtar_sync_recovery:original', 'recovery bytes')
  localStorage.setItem('gtar_theme_store', 'local settings')
  window.confirm = () => { confirmations++; return allow }
  const onSmartMerge = (songs, setlists) => {
    calls++
    const next = merge(library, { songs, setlists })
    if (fail) throw new Error('Storage quota exceeded')
    persistLibrary(next, localStorage)
    library = next
  }
  await act(async () => root.render(React.createElement(Modal, { isOpen: true, onClose() {}, allSongs: existing.songs, setlists: existing.setlists,
    existingSongs: existing.songs, existingSetlists: existing.setlists, onSmartMerge,
    onFullRestore() { assert.fail('legacy import must never wipe') }, onImportAllSongs() { assert.fail('must use durable merge') },
  })))
  // Even selecting Wipe & Replace cannot convert this legacy operation into a wipe.
  if (component === 'BackupRestoreDialogModal') await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Full Restore (Wipe & Replace)')).click())
  const raw = JSON.stringify({ ...backup, themeMode: 'paper-light' })
  const originalRaw = localStorage.getItem(LIBRARY_KEY)
  await upload(dom, raw)
  assert.equal(calls, 0)
  assert.equal(localStorage.getItem(LIBRARY_KEY), originalRaw)
  allow = true
  await upload(dom, raw)
  assert.equal(calls, 1, document.body.textContent)
  assert.equal(library.songs.length, 2)
  assert.deepEqual(library.songs[0], existing.songs[0])
  const saved = localStorage.getItem(LIBRARY_KEY)
  fail = true
  await upload(dom, raw)
  assert.match(document.body.textContent, /Storage quota exceeded/)
  assert.equal(localStorage.getItem(LIBRARY_KEY), saved)
  allow = false
  await upload(dom, raw)
  assert.equal(calls, 2)
  assert.equal(confirmations, 4)
  assert.equal(localStorage.getItem(RESTORE_SNAPSHOT_KEY), 'snapshot bytes')
  assert.equal(localStorage.getItem('gtar_sync_recovery:original'), 'recovery bytes')
  assert.equal(localStorage.getItem('gtar_theme_store'), 'local settings')
}))

test('JSON Bridge native ID-less setlist preview preserves charts and order and confirms before durable import', async () => withUi(async ({ dom, root }) => {
  const { JsonBridgeModal } = require('../src/components/JsonBridgeModal.tsx')
  let calls = 0
  let allow = false
  let fail = true
  window.confirm = () => allow
  let imported
  await act(async () => root.render(React.createElement(JsonBridgeModal, { isOpen: true, initialTab: 'import', onClose() {}, song: existing.songs[0],
    allSongs: existing.songs, setlists: existing.setlists, onImportSong() { assert.fail('must import complete legacy setlist') },
    onSmartMerge(songs, setlists) {
      calls++
      if (fail) throw new Error('Storage quota exceeded')
      imported = { songs, setlists }
    },
  })))
  const input = document.querySelector('input[type="file"]')
  const data = { type: 'GTAR_SETLIST', name: 'Native Gig', createdAt: '2026-01-01T00:00:00.000Z', songs: [
    { title: 'Second', chordsContent: 'second', bpm: '99' }, { ...song, chordsContent: song.rawContent },
  ] }
  const file = new dom.window.File([JSON.stringify(data)], 'native.json', { type: 'application/json' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  const priorReader = global.FileReader
  global.FileReader = class { readAsText() { this.onload({ target: { result: JSON.stringify(data) } }) } }
  try {
    await act(async () => {
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Import as New')
    assert.ok(button)
    assert.equal(calls, 0)
    await act(async () => button.click())
    assert.equal(calls, 0)
    allow = true
    await act(async () => button.click())
    assert.equal(calls, 1)
    assert.equal(imported, undefined)
    assert.match(document.body.textContent, /Storage quota exceeded/)
    fail = false
    await act(async () => button.click())
    assert.equal(calls, 2)
    assert.equal(imported.setlists[0].name, 'Native Gig')
    assert.equal(imported.setlists[0].createdAt, Date.parse(data.createdAt))
    assert.deepEqual(imported.setlists[0].songs.map(ref => imported.songs.find(s => s.id === ref.id).rawContent), ['second', song.rawContent])
    assert.equal(imported.songs[0].bpm, '99')
  } finally { global.FileReader = priorReader }
}))
