const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      }).outputText,
      filename
    )
}
require.extensions['.png'] = module => { module.exports = '/logo.png' }

const {
  LIBRARY_KEY,
  persistLibrary,
  readPersistedLibrary,
  getPersistedLibraryRaw,
  saveCrossTabConflictSnapshot,
  StaleWriteConflictError,
  isStaleWriteConflictError,
  recoveryData,
  preserveStoredLibrary,
  retireDriveSyncState,
} = require('../src/utils/syncJournal.ts')

function createMockStorage() {
  const store = new Map()
  return {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size },
    store,
  }
}

const songA = { id: '11111111-1111-4111-8111-111111111111', title: 'Song Alpha', artist: 'Artist A', key: 'G', capo: 'No Capo', bpm: '120', format: 'CHORD_PRO', transposeOffset: 0, rawContent: '{title: Song Alpha}\n[G]Alpha line' }
const songB = { id: '22222222-2222-4222-8222-222222222222', title: 'Song Beta', artist: 'Artist B', key: 'C', capo: 'No Capo', bpm: '100', format: 'CHORD_PRO', transposeOffset: 0, rawContent: '{title: Song Beta}\n[C]Beta line' }
const setlist1 = { id: '33333333-3333-4333-8333-333333333333', name: 'Main Set', createdAt: 1000, songs: [{ id: songA.id, title: songA.title }] }

test('1. Two tabs editing same library: Tab A saves, Tab B stale save rejected without data loss', () => {
  const store = createMockStorage()
  const initialLib = { songs: [songA], setlists: [setlist1] }
  persistLibrary(initialLib, store)
  const initialRaw = store.getItem(LIBRARY_KEY)
  assert.ok(initialRaw)

  // Tab A and Tab B both start from initialRaw
  const tabABaseline = initialRaw
  const tabBBaseline = initialRaw

  // Tab A edits: adds songB
  const tabALib = { songs: [songA, songB], setlists: [setlist1] }
  persistLibrary(tabALib, store, { expectedRaw: tabABaseline })
  const tabAPersistedRaw = store.getItem(LIBRARY_KEY)
  assert.notEqual(tabAPersistedRaw, initialRaw)

  // Tab B edits: modifies songA title concurrently
  const tabBLib = {
    songs: [{ ...songA, title: 'Song Alpha (Tab B Edits)' }],
    setlists: [setlist1],
  }

  // Tab B attempts to persist with its stale baseline
  let tabBError = null
  try {
    persistLibrary(tabBLib, store, { expectedRaw: tabBBaseline })
  } catch (err) {
    tabBError = err
  }

  assert.ok(tabBError !== null, 'Tab B write must be rejected')
  assert.ok(isStaleWriteConflictError(tabBError), 'Error must be StaleWriteConflictError')
  assert.equal(tabBError.code, 'STALE_WRITE_CONFLICT')

  // Storage STILL contains Tab A's edits untouched (no silent overwrite!)
  assert.equal(store.getItem(LIBRARY_KEY), tabAPersistedRaw)
  const storedLib = readPersistedLibrary(store)
  assert.equal(storedLib.songs.length, 2)
  assert.equal(storedLib.songs[1].title, 'Song Beta')

  // Tab B's in-memory data is completely intact (no silent discard!)
  assert.equal(tabBLib.songs[0].title, 'Song Alpha (Tab B Edits)')
})

test('2. Sequential edits succeed when clean writer updates baseline', () => {
  const store = createMockStorage()
  persistLibrary({ songs: [songA], setlists: [] }, store)
  let base = store.getItem(LIBRARY_KEY)

  // Tab A saves update
  const libA = { songs: [songA, songB], setlists: [] }
  persistLibrary(libA, store, { expectedRaw: base })
  base = store.getItem(LIBRARY_KEY)

  // Tab B adopts Tab A update and makes sequential edit
  const songC = { id: '33333333-3333-4333-8333-333333333333', title: 'Song Gamma', artist: '', key: 'D', capo: 'No Capo', bpm: '110', format: 'CHORD_PRO', transposeOffset: 0, rawContent: '{title: Song Gamma}' }
  const libB = { songs: [songA, songB, songC], setlists: [] }
  persistLibrary(libB, store, { expectedRaw: base })

  const stored = readPersistedLibrary(store)
  assert.equal(stored.songs.length, 3)
  assert.equal(stored.songs[2].title, 'Song Gamma')
})

test('3. Deletions versus updates: Tab A deletes song, Tab B updates same song -> conflict rejected', () => {
  const store = createMockStorage()
  persistLibrary({ songs: [songA, songB], setlists: [] }, store)
  const base = store.getItem(LIBRARY_KEY)

  // Tab A deletes songA (moves to trash or removes)
  const tabALib = { songs: [{ ...songA, isDeleted: true }, songB], setlists: [] }
  persistLibrary(tabALib, store, { expectedRaw: base })

  // Tab B (stale) was editing songA chords
  const tabBLib = {
    songs: [{ ...songA, rawContent: '{title: Song Alpha}\n[G]New verse added in Tab B' }, songB],
    setlists: [],
  }

  let conflict = null
  try {
    persistLibrary(tabBLib, store, { expectedRaw: base })
  } catch (err) {
    conflict = err
  }

  assert.ok(isStaleWriteConflictError(conflict), 'Must detect conflict on deletion vs update')

  // Storage still has Tab A deletion
  const stored = readPersistedLibrary(store)
  assert.equal(stored.songs.find(s => s.id === songA.id).isDeleted, true)

  // Tab B in-memory retains its chord update
  assert.match(tabBLib.songs[0].rawContent, /New verse added in Tab B/)
})

test('4. Delayed storage events: write-time verification catches conflict without waiting for storage event', () => {
  const store = createMockStorage()
  persistLibrary({ songs: [songA], setlists: [] }, store)
  const initialBase = store.getItem(LIBRARY_KEY)

  // Background tab modified storage, but NO window storage event has reached current tab yet
  store.setItem(LIBRARY_KEY, JSON.stringify({ songs: [songA, songB], setlists: [] }))

  // Current tab tries to save with initialBase
  let caught = null
  try {
    persistLibrary({ songs: [{ ...songA, title: 'Delayed Event Edit' }], setlists: [] }, store, { expectedRaw: initialBase })
  } catch (err) {
    caught = err
  }

  assert.ok(isStaleWriteConflictError(caught), 'Write-time check must fail closed immediately')
})

test('5. Stale writer attempting another save remains rejected while conflict is unresolved', () => {
  const store = createMockStorage()
  persistLibrary({ songs: [songA], setlists: [] }, store)
  const base = store.getItem(LIBRARY_KEY)

  // External writer updates storage
  store.setItem(LIBRARY_KEY, JSON.stringify({ songs: [songA, songB], setlists: [] }))
  const externalData = store.getItem(LIBRARY_KEY)

  const staleLib = { songs: [{ ...songA, bpm: '180' }], setlists: [] }

  // First save attempt
  assert.throws(() => persistLibrary(staleLib, store, { expectedRaw: base }), StaleWriteConflictError)
  assert.equal(store.getItem(LIBRARY_KEY), externalData)

  // Second save attempt by same stale writer
  assert.throws(() => persistLibrary(staleLib, store, { expectedRaw: base }), StaleWriteConflictError)
  assert.equal(store.getItem(LIBRARY_KEY), externalData)

  // Third save attempt
  assert.throws(() => persistLibrary(staleLib, store, { expectedRaw: base }), StaleWriteConflictError)
  assert.equal(store.getItem(LIBRARY_KEY), externalData)
})

test('6. Normal single-tab editing: sequential saves update baseline cleanly without errors', () => {
  const store = createMockStorage()
  persistLibrary({ songs: [songA], setlists: [] }, store)
  let baseline = getPersistedLibraryRaw(store)

  // Single tab edits 5 times in sequence
  for (let i = 1; i <= 5; i++) {
    const updated = {
      songs: [{ ...songA, title: `Song Alpha Revision ${i}` }],
      setlists: [],
    }
    persistLibrary(updated, store, { expectedRaw: baseline })
    baseline = getPersistedLibraryRaw(store)
    assert.equal(readPersistedLibrary(store).songs[0].title, `Song Alpha Revision ${i}`)
  }
})

test('7. Draft retention: saveCrossTabConflictSnapshot safely stores draft into recovery partition', () => {
  const store = createMockStorage()
  persistLibrary({ songs: [songA], setlists: [] }, store)

  const draftLib = {
    songs: [{ ...songA, title: 'Valuable Unsaved Draft' }],
    setlists: [],
  }

  const snapshotKey = saveCrossTabConflictSnapshot(draftLib, store)
  assert.ok(snapshotKey.startsWith('gtar_sync_recovery:cross-tab-conflict:'))
  assert.equal(store.getItem(snapshotKey), JSON.stringify(draftLib))

  // Preserved in recoveryData
  const recoveries = recoveryData(store)
  assert.ok(recoveries[snapshotKey])
  const parsed = JSON.parse(recoveries[snapshotKey])
  assert.equal(parsed.songs[0].title, 'Valuable Unsaved Draft')
})

test('8. Recovery snapshots reject quota, access errors and silent write loss', () => {
  for (const failure of ['quota', 'denied', 'silent', 'readback']) {
    const store = createMockStorage()
    const original = store.setItem
    store.setItem = (key, value) => {
      if (failure === 'silent') return
      if (failure === 'quota') throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
      if (failure === 'denied') throw new Error('denied')
      original(key, value)
    }
    if (failure === 'readback') store.getItem = () => { throw new Error('read failed') }
    assert.throws(() => saveCrossTabConflictSnapshot({ songs: [songA], setlists: [] }, store), undefined, failure)
    assert.throws(() => preserveStoredLibrary('original bytes', store), undefined, failure)
  }
})

test('9. React App: cross-tab conflict detection, alert UI rendering, and recovery actions', async () => {
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const prior = {
    window: global.window,
    document: global.document,
    localStorage: global.localStorage,
    sessionStorage: global.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT,
  }
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

  const originalTimeout = global.setTimeout
  const timers = new Set()
  global.setTimeout = (fn, delay, ...args) => {
    const timer = originalTimeout(fn, delay, ...args)
    timers.add(timer)
    return timer
  }

  const modules = ['SongbookHomeView', 'TrashView', 'Header', 'BackupRestoreDialogModal', 'DesktopEditor'].map(name => require(`../src/components/${name}.tsx`))
  const originals = modules.map((module, i) => module[['SongbookHomeView', 'TrashView', 'Header', 'BackupRestoreDialogModal', 'DesktopEditor'][i]])
  let home, trash, header, backup, editor
  modules[0].SongbookHomeView = props => { home = props; return React.createElement('div', null, 'Songbook mounted') }
  modules[1].TrashView = props => { trash = props; return React.createElement('div', null, 'Trash mounted') }
  modules[2].Header = props => { header = props; return null }

  modules[3].BackupRestoreDialogModal = props => { backup = props; return null }

  modules[4].DesktopEditor = props => { editor = props; return null }

  const React = require('react')
  const { act } = React
  const { createRoot } = require('react-dom/client')

  const initialLib = { songs: [songA], setlists: [] }
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(initialLib))

  const root = createRoot(document.getElementById('root'))
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL
  let downloadedFileName = null
  URL.createObjectURL = () => 'blob:conflict-draft'
  URL.revokeObjectURL = () => {}
  dom.window.HTMLAnchorElement.prototype.click = function () {
    downloadedFileName = this.download
  }

  try {
    const App = require('../src/App.tsx').default
    await act(async () => root.render(React.createElement(App)))

    // Initially no conflict alert
    assert.equal(document.querySelector('[data-testid="cross-tab-conflict-alert"]'), null)
    assert.equal(home.songs.length, 1)

    // 1. Clean tab adopts external update cleanly
    const externalLib = { songs: [songA, songB], setlists: [] }
    const externalRaw = JSON.stringify(externalLib)
    localStorage.setItem(LIBRARY_KEY, externalRaw)

    await act(async () => {
      window.dispatchEvent(new dom.window.StorageEvent('storage', {
        key: LIBRARY_KEY,
        newValue: externalRaw,
      }))
    })

    assert.equal(home.songs.length, 2, 'Clean tab must adopt external update')
    assert.equal(document.querySelector('[data-testid="cross-tab-conflict-alert"]'), null)

    // 2. External tab modifies storage to externalRaw3 behind Tab B's back
    const externalLib3 = {
      songs: [songA, songB, { id: '33333333-3333-4333-8333-333333333333', title: 'External New Song', artist: '', key: 'A', capo: 'No Capo', bpm: '120', format: 'CHORD_PRO', transposeOffset: 0, rawContent: '{title: External New Song}' }],
      setlists: [],
    }
    const externalRaw3 = JSON.stringify(externalLib3)
    localStorage.setItem(LIBRARY_KEY, externalRaw3)

    // 3. Tab B attempts an edit (delete song 0) while its baseline is stale
    await act(async () => {
      home.onDeleteSong(0)
    })

    // Conflict banner appears!
    const conflictAlert = document.querySelector('[data-testid="cross-tab-conflict-alert"]')
    assert.ok(conflictAlert, 'Conflict alert banner must be rendered')
    assert.match(conflictAlert.textContent, /Cross-Tab Storage Conflict/)

    // External storage was NOT overwritten
    assert.equal(localStorage.getItem(LIBRARY_KEY), externalRaw3)

    // Draft snapshot was saved into recovery partition
    const snapshotKey = Object.keys(localStorage).find(k => k.startsWith('gtar_sync_recovery:cross-tab-conflict:'))
    assert.ok(snapshotKey, 'Draft recovery snapshot must be created in localStorage')

    // 4. Stale writer attempting another action while conflict active is rejected
    await act(async () => {
      home.onDeleteSong(0)
    })
    // External storage was STILL NOT overwritten
    assert.equal(localStorage.getItem(LIBRARY_KEY), externalRaw3)

    // 5. Export Draft button works
    const exportBtn = document.querySelector('[data-testid="conflict-export-draft-button"]')
    assert.ok(exportBtn, 'Export Draft button must exist')
    await act(async () => exportBtn.click())
    assert.ok(downloadedFileName && downloadedFileName.startsWith('gtar-conflict-draft-'), 'Must trigger export download')

    // 6. Reload Other Tab's Version button works
    const reloadBtn = document.querySelector('[data-testid="conflict-reload-button"]')
    assert.ok(reloadBtn, 'Reload button must exist')
    await act(async () => reloadBtn.click())

    // Conflict alert cleared after reload, and latest storage songs loaded
    assert.equal(document.querySelector('[data-testid="cross-tab-conflict-alert"]'), null)
    assert.equal(home.songs.length, 3, 'Must reload all 3 songs from external storage')

    const replacement = { songs: [songB], setlists: [] }
    const replacementRaw = JSON.stringify(replacement)
    localStorage.setItem(LIBRARY_KEY, replacementRaw)
    assert.throws(() => backup.onSmartMerge([songA], []), StaleWriteConflictError)
    assert.equal(localStorage.getItem(LIBRARY_KEY), replacementRaw)

    const storagePrototype = Object.getPrototypeOf(localStorage)
    const originalSetItem = storagePrototype.setItem
    let failRecovery = true
    storagePrototype.setItem = function (key, value) {
      if (failRecovery && key.startsWith('gtar_sync_recovery:')) throw new Error('recovery denied')
      return originalSetItem.call(this, key, value)
    }
    try {
      await act(async () => home.onDeleteSong(0))
      assert.ok(document.querySelector('[data-testid="cross-tab-conflict-alert"]'))
      assert.match(document.querySelector('[data-testid="cross-tab-conflict-alert"]').textContent, /Recovery snapshot unavailable/)
      const draftTitles = home.songs.map(song => song.title)
      await act(async () => document.querySelector('[data-testid="conflict-reload-button"]').click())
      assert.deepEqual(home.songs.map(song => song.title), draftTitles)
      assert.ok(document.querySelector('[data-testid="cross-tab-conflict-alert"]'))
      window.confirm = () => false
      await act(async () => document.querySelector('[data-testid="conflict-overwrite-button"]').click())
      assert.equal(localStorage.getItem(LIBRARY_KEY), replacementRaw)
      window.confirm = () => true
      await act(async () => document.querySelector('[data-testid="conflict-overwrite-button"]').click())
      assert.equal(localStorage.getItem(LIBRARY_KEY), replacementRaw)
      assert.throws(() => backup.onFullRestore([songA], []), /recovery denied/)
      assert.equal(localStorage.getItem(LIBRARY_KEY), replacementRaw)
      failRecovery = false
      await act(async () => document.querySelector('[data-testid="conflict-overwrite-button"]').click())
      assert.equal(document.querySelector('[data-testid="cross-tab-conflict-alert"]'), null)
      assert.ok(Object.entries(recoveryData()).some(([key, value]) => key.includes('replacement:') && JSON.parse(value).raw === replacementRaw))
      assert.deepEqual(home.songs.map(song => song.title), draftTitles)
      // Explicit confirmed restore remains legitimate even with a stale baseline.
      localStorage.setItem(LIBRARY_KEY, replacementRaw)
      await act(async () => backup.onFullRestore([songA], []))
      assert.equal(home.songs[0].title, songA.title)
      assert.equal(readPersistedLibrary().songs[0].title, songA.title)
      await act(async () => header.onViewChange('editor'))
      const editorDraft = { ...songA, title: 'Unsaved editor title', rawContent: '[D]Unsaved editor text' }
      editor.recoveryDraftRef.current = () => editorDraft
      localStorage.setItem(LIBRARY_KEY, replacementRaw)
      await act(async () => editor.onSaveSong({ ...songA, title: 'attempt' }))
      assert.ok(document.querySelector('[data-testid="cross-tab-conflict-alert"]'))
      await act(async () => document.querySelector('[data-testid="conflict-reload-button"]').click())
      assert.ok(Object.entries(recoveryData()).some(([key, value]) => key.includes('cross-tab-conflict:') && JSON.parse(value).songs.some(song => song.rawContent === editorDraft.rawContent)))
      assert.equal(readPersistedLibrary().songs[0].title, songB.title)

      // Mount the real Desktop Editor: failed autosaves leave its private draft
      // newer than App's song state, including edits made after conflict detection.
      modules[4].DesktopEditor = originals[4]
      await act(async () => backup.onFullRestore([songA, songB], [setlist1]))
      const expectedSetlists = readPersistedLibrary().setlists
      const change = async (element, value) => {
        await act(async () => {
          const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
          element.dispatchEvent(new window.Event('input', { bubbles: true }))
        })
      }
      localStorage.setItem(LIBRARY_KEY, replacementRaw)
      await change(document.querySelector('textarea'), '[D]First unsaved editor text')
      assert.ok(document.querySelector('[data-testid="cross-tab-conflict-alert"]'))
      await change(document.querySelector('input[placeholder="Song Title *"]'), 'Final private editor title')
      const finalText = '[D]Final unsaved editor text'
      await change(document.querySelector('textarea'), finalText)
      assert.equal(home.songs.find(song => song.id === songA.id).title, songA.title)
      window.confirm = () => false
      await act(async () => document.querySelector('[data-testid="conflict-overwrite-button"]').click())
      assert.equal(localStorage.getItem(LIBRARY_KEY), replacementRaw)
      assert.equal(document.querySelector('textarea').value, finalText)
      window.confirm = () => true
      await act(async () => document.querySelector('[data-testid="conflict-overwrite-button"]').click())
      assert.equal(document.querySelector('[data-testid="cross-tab-conflict-alert"]'), null)
      const overwritten = readPersistedLibrary()
      const savedDraft = overwritten.songs.find(song => song.id === songA.id)
      assert.equal(savedDraft.title, 'Final private editor title')
      assert.equal(savedDraft.rawContent, finalText)
      assert.equal(overwritten.songs.find(song => song.id === songB.id).title, songB.title)
      assert.deepEqual(overwritten.setlists, expectedSetlists)
      assert.ok(Object.entries(recoveryData()).some(([key, value]) => key.includes('replacement:') && JSON.parse(value).raw === replacementRaw))
      // Subsequent renders/persistence must retain the adopted draft too.
      await act(async () => root.render(React.createElement(App)))
      assert.deepEqual(readPersistedLibrary(), overwritten)

    } finally {
      storagePrototype.setItem = originalSetItem
    }

  } finally {
    await act(async () => root.unmount())
    for (const timer of timers) clearTimeout(timer)
    global.setTimeout = originalTimeout
    modules.forEach((module, i) => { module[['SongbookHomeView', 'TrashView', 'Header', 'BackupRestoreDialogModal', 'DesktopEditor'][i]] = originals[i] })
    URL.createObjectURL = create
    URL.revokeObjectURL = revoke
    Object.assign(global, prior)
    dom.window.close()
  }
})


test('Retirement cannot force an old library over a concurrent stored revision', () => {
  const store = createMockStorage()
  persistLibrary({ songs: [songA], setlists: [] }, store)
  const newerRaw = JSON.stringify({ songs: [songB], setlists: [] })
  const originalKey = store.key
  store.key = index => {
    store.setItem(LIBRARY_KEY, newerRaw)
    return originalKey(index)
  }
  assert.equal(retireDriveSyncState(store), false)
  assert.equal(store.getItem(LIBRARY_KEY), newerRaw)
})
