const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) => module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    filename
  )
}
require.extensions['.png'] = module => { module.exports = '/logo.png' }

const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const {
  parseBackupJson,
  createBackupPayload,
  createRestoreSafetySnapshot,
  getRestoreSafetySnapshot,
  clearRestoreSafetySnapshot,
  restoreFromSafetySnapshot,
  RESTORE_SNAPSHOT_KEY,
  GTAR_BACKUP_SCHEMA_VERSION,
} = require('../src/utils/jsonBackup.ts')
const { LIBRARY_KEY, isCanonicalKey } = require('../src/utils/syncJournal.ts')
const { BackupRestoreDialogModal } = require('../src/components/BackupRestoreDialogModal.tsx')

global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const mockSong1 = { id: 'song-1', title: 'Song One', artist: 'Artist One', rawContent: '[G]Song 1 lyrics', isDeleted: false }
const mockSong2 = { id: 'song-2', title: 'Song Two', artist: 'Artist Two', rawContent: '[C]Song 2 lyrics', isDeleted: false }
const mockTrash = { id: 'song-3', title: 'Deleted Song', artist: 'Artist Three', rawContent: '[D]Trash lyrics', isDeleted: true }
const mockSetlist = { id: 'set-1', name: 'Gig 1', songs: [{ id: 'song-1', title: 'Song One', artist: 'Artist One' }] }

// ACTION 3: Dedicated backup schema version + counts
test('new exports include schemaVersion 1 and accurate counts matching payload', () => {
  const songs = [mockSong1, mockSong2, mockTrash]
  const setlists = [mockSetlist]
  const payload = createBackupPayload(songs, setlists, '1.1.105')

  assert.equal(payload.schemaVersion, 1)
  assert.equal(payload.version, '1.1.105')
  assert.equal(payload.songCount, 2) // 2 active
  assert.equal(payload.trashCount, 1) // 1 trash
  assert.equal(payload.setlistCount, 1) // 1 setlist
  assert.ok(payload.exportedAt)
  assert.equal(payload.songs.length, 3)
})

test('valid legacy unversioned backup imports successfully when structure validates', () => {
  const legacyPayload = {
    app: 'GTAR',
    version: '1.0.90',
    exportedAt: '2026-01-01T00:00:00.000Z',
    exportType: 'FULL_BACKUP',
    songs: [mockSong1],
    setlists: [mockSetlist],
  }
  const result = parseBackupJson(JSON.stringify(legacyPayload))
  assert.equal(result.isValid, true, result.error)
  assert.equal(result.songs.length, 1)
  assert.equal(result.setlists.length, 1)
  assert.equal(result.metadata?.schemaVersion, undefined)
  assert.equal(result.metadata?.version, '1.0.90')
  assert.equal(result.metadata?.songCount, 1)
  assert.equal(result.metadata?.trashCount, 0)
  assert.equal(result.metadata?.setlistCount, 1)
})

test('unknown future schema version rejects with zero mutation', () => {
  const futurePayload = {
    app: 'GTAR',
    schemaVersion: GTAR_BACKUP_SCHEMA_VERSION + 1,
    version: '2.0.0',
    exportedAt: new Date().toISOString(),
    exportType: 'FULL_BACKUP',
    songs: [mockSong1],
    setlists: [mockSetlist],
  }
  const result = parseBackupJson(JSON.stringify(futurePayload))
  assert.equal(result.isValid, false)
  assert.match(result.error, /unsupported future schema version/)
  assert.deepEqual(result.songs, [])
  assert.deepEqual(result.setlists, [])

  // Also verify non-integer or negative schemaVersion
  for (const badVer of [0, -1, 1.5, '1']) {
    const badResult = parseBackupJson(JSON.stringify({ ...futurePayload, schemaVersion: badVer }))
    assert.equal(badResult.isValid, false)
    assert.match(badResult.error, /schemaVersion: must be a positive integer/)
  }
})

// ACTION 2: Reject duplicate setlist IDs
test('duplicate setlist IDs are rejected before any state or storage mutation', () => {
  const setlistA = { id: 'dup-set-1', name: 'Setlist A', songs: [{ id: 'song-1', title: 'Song One' }] }
  const setlistB = { id: 'dup-set-1', name: 'Setlist B', songs: [{ id: 'song-1', title: 'Song One' }] }

  const payload = {
    songs: [mockSong1],
    setlists: [setlistA, setlistB],
  }
  const result = parseBackupJson(JSON.stringify(payload))
  assert.equal(result.isValid, false)
  assert.match(result.error, /setlists\[1\]\.id: duplicate setlist ID/)
  assert.deepEqual(result.songs, [])
  assert.deepEqual(result.setlists, [])
})

test('existing duplicate song ID and setlist reference validation remain enforced', () => {
  // Duplicate song ID
  const dupSong = parseBackupJson(JSON.stringify({
    songs: [mockSong1, { ...mockSong2, id: mockSong1.id }],
    setlists: [],
  }))
  assert.equal(dupSong.isValid, false)
  assert.match(dupSong.error, /songs\[1\]\.id: duplicate song ID/)

  // Missing setlist reference
  const missingRef = parseBackupJson(JSON.stringify({
    songs: [mockSong1],
    setlists: [{ id: 'set-1', name: 'Set', songs: [{ id: 'non-existent', title: 'Ghost' }] }],
  }))
  assert.equal(missingRef.isValid, false)
  assert.match(missingRef.error, /missing or ambiguous/)
})

// ACTION 5: Pre-restore safety snapshot lifecycle & recovery
test('safety snapshot is created before destructive wipe, bounded to single key, and recoverable', () => {
  const map = new Map()
  const mockStorage = {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  }

  assert.equal(isCanonicalKey(RESTORE_SNAPSHOT_KEY), true)

  const currentLibrary = {
    songs: [mockSong1, mockTrash],
    setlists: [mockSetlist],
  }

  createRestoreSafetySnapshot(currentLibrary, mockStorage)
  assert.ok(mockStorage.getItem(RESTORE_SNAPSHOT_KEY))

  const snapshot = getRestoreSafetySnapshot(mockStorage)
  assert.ok(snapshot)
  assert.ok(snapshot.createdAt)
  assert.equal(snapshot.library.songs.length, 2)
  assert.equal(snapshot.library.setlists.length, 1)

  // Recovery returns original library
  const recovered = restoreFromSafetySnapshot(mockStorage)
  assert.deepEqual(recovered, currentLibrary)

  // Clear removes snapshot
  clearRestoreSafetySnapshot(mockStorage)
  assert.equal(mockStorage.getItem(RESTORE_SNAPSHOT_KEY), null)
})

test('snapshot write failure aborts restore and preserves current state', () => {
  const failingStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('Storage write error (disk full)') },
    removeItem: () => {},
  }

  assert.throws(() => {
    createRestoreSafetySnapshot({ songs: [mockSong1], setlists: [] }, failingStorage)
  }, /Pre-restore safety snapshot creation failed/)
})

function withJsdom(fn) {
  return async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
    const timers = new Set()
    const origSetTimeout = global.setTimeout
    const origClearTimeout = global.clearTimeout
    const prior = {
      window: global.window,
      document: global.document,
      localStorage: global.localStorage,
      setTimeout: global.setTimeout,
      clearTimeout: global.clearTimeout,
      IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT,
    }
    global.setTimeout = (cb, ms, ...args) => {
      const id = origSetTimeout(cb, ms, ...args)
      timers.add(id)
      return id
    }
    global.clearTimeout = id => {
      timers.delete(id)
      origClearTimeout(id)
    }
    Object.assign(global, {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
    })

    const root = createRoot(document.getElementById('root'))
    try {
      await fn({ dom, root })
    } finally {
      for (const id of timers) origClearTimeout(id)
      await act(async () => root.unmount())
      Object.assign(global, prior)
      dom.window.close()
    }
  }
}

// ACTION 1, 4 & 5 UI Verification in BackupRestoreDialogModal
test('wipe & replace flow requires explicit preview confirmation; cancel causes zero mutation', withJsdom(async ({ dom, root }) => {
  let fullRestoreCalled = false
  const backupData = JSON.stringify(createBackupPayload([mockSong1, mockSong2, mockTrash], [mockSetlist], '1.1.105'))
  const file = new dom.window.File([backupData], 'backup.json', { type: 'application/json' })

  await act(async () => {
    root.render(React.createElement(BackupRestoreDialogModal, {
      isOpen: true,
      onClose: () => {},
      allSongs: [mockSong1],
      setlists: [],
      onImportAllSongs: () => {},
      onFullRestore: () => { fullRestoreCalled = true },
    }))
  })

  // Click "Full Restore (Wipe & Replace)"
  const wipeButton = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Full Restore (Wipe & Replace)'))
  assert.ok(wipeButton)
  await act(async () => wipeButton.click())

  // Simulate file input change
  const fileInput = document.querySelector('input[type="file"]')
  assert.ok(fileInput)
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })

  await act(async () => {
    fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })

  // REQUIREMENT: FILE_SELECTION_MUST_NOT_IMMEDIATELY_MUTATE_LIBRARY
  assert.equal(fullRestoreCalled, false, 'Library must NOT mutate immediately on file selection')

  // Preview must display decision-useful summary:
  // APP_VERSION_IF_PRESENT, SCHEMA_VERSION_IF_PRESENT, EXPORTED_AT_IF_PRESENT, SONG_COUNT, SETLIST_COUNT, TRASH_COUNT
  const modalText = document.body.textContent
  assert.match(modalText, /Confirm Full Restore|Destructive Wipe & Replace/)
  assert.match(modalText, /1\.1\.105/) // App version
  assert.match(modalText, /v1/) // Schema version
  assert.match(modalText, /Active Songs/)
  assert.match(modalText, /Setlists/)
  assert.match(modalText, /Trash Bin/)

  // Click "Cancel" in preview
  const cancelButton = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel')
  assert.ok(cancelButton)
  await act(async () => cancelButton.click())

  // REQUIREMENT: CANCEL_LEAVES_CURRENT_LIBRARY_UNCHANGED
  assert.equal(fullRestoreCalled, false, 'Cancel must not mutate library')
  assert.match(document.body.textContent, /Backup & Restore/) // Back to main modal menu
}))

test('confirmed wipe & replace creates safety snapshot before restore, and clears it on success', withJsdom(async ({ dom, root }) => {
  let fullRestoreCalled = false
  let snapshotExistedDuringRestore = false
  const backupData = JSON.stringify(createBackupPayload([mockSong1, mockTrash], [mockSetlist]))
  const file = new dom.window.File([backupData], 'backup.json', { type: 'application/json' })

  await act(async () => {
    root.render(React.createElement(BackupRestoreDialogModal, {
      isOpen: true,
      onClose: () => {},
      allSongs: [mockSong2],
      setlists: [],
      onImportAllSongs: () => {},
      onFullRestore: () => {
        fullRestoreCalled = true
        // Check that safety snapshot exists BEFORE restore mutation runs
        if (dom.window.localStorage.getItem(RESTORE_SNAPSHOT_KEY)) {
          snapshotExistedDuringRestore = true
        }
      },
    }))
  })

  const wipeButton = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Full Restore (Wipe & Replace)'))
  await act(async () => wipeButton.click())

  const fileInput = document.querySelector('input[type="file"]')
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
  await act(async () => {
    fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })

  // Click "Confirm Wipe & Replace"
  const confirmButton = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Confirm Wipe & Replace'))
  assert.ok(confirmButton)
  await act(async () => confirmButton.click())

  assert.equal(fullRestoreCalled, true)
  assert.equal(snapshotExistedDuringRestore, true, 'Safety snapshot must exist before restore begins')
  // After restore succeeds, snapshot was handled according to minimum safe recovery policy (cleared)
  assert.equal(dom.window.localStorage.getItem(RESTORE_SNAPSHOT_KEY), null)
  assert.match(document.body.textContent, /Backup restored/)
}))

test('persistence failure reports user-visible error and preserves recoverable pre-restore snapshot', withJsdom(async ({ dom, root }) => {
  let closed = false
  const backupData = JSON.stringify(createBackupPayload([mockSong1], []))
  const file = new dom.window.File([backupData], 'backup.json', { type: 'application/json' })

  await act(async () => {
    root.render(React.createElement(BackupRestoreDialogModal, {
      isOpen: true,
      onClose: () => { closed = true },
      allSongs: [mockSong2],
      setlists: [],
      onImportAllSongs: () => {},
      onFullRestore: () => {
        const err = new Error('QuotaExceededError: Local storage limit reached')
        err.name = 'QuotaExceededError'
        throw err
      },
    }))
  })

  const wipeButton = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Full Restore (Wipe & Replace)'))
  await act(async () => wipeButton.click())

  const fileInput = document.querySelector('input[type="file"]')
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
  await act(async () => {
    fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })

  const confirmButton = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Confirm Wipe & Replace'))
  await act(async () => confirmButton.click())

  // REQUIREMENT: PERSIST_FAILURE_SHOWS_USER_VISIBLE_ERROR
  // REQUIREMENT: PERSIST_FAILURE_MUST_NOT_BE_MISREPORTED_AS_SUCCESS
  // REQUIREMENT: DO_NOT_SHOW_FINAL_SUCCESS_OR_CLOSE_MODAL_UNTIL_CANONICAL_LIBRARY_WRITE_SUCCEEDS
  assert.equal(closed, false, 'Modal must NOT close when persist fails')
  assert.match(document.body.textContent, /Restore failed: Storage quota exceeded/)
  assert.doesNotMatch(document.body.textContent, /Backup restored:/)

  // REQUIREMENT: FAILED_RESTORE_PRESERVES_RECOVERABLE_PRE_RESTORE_STATE
  const snapshotRaw = dom.window.localStorage.getItem(RESTORE_SNAPSHOT_KEY)
  assert.ok(snapshotRaw, 'Pre-restore safety snapshot must NOT be deleted if restore fails')
  const parsedSnapshot = JSON.parse(snapshotRaw)
  assert.equal(parsedSnapshot.library.songs[0].id, mockSong2.id)
}))

test('smart merge flow does not prompt for destructive confirmation and coordinates persistence', withJsdom(async ({ dom, root }) => {
  let smartMergeCalled = false
  const backupData = JSON.stringify(createBackupPayload([mockSong2], []))
  const file = new dom.window.File([backupData], 'backup.json', { type: 'application/json' })

  await act(async () => {
    root.render(React.createElement(BackupRestoreDialogModal, {
      isOpen: true,
      onClose: () => {},
      allSongs: [mockSong1],
      setlists: [],
      onImportAllSongs: () => {},
      onSmartMerge: () => { smartMergeCalled = true },
    }))
  })

  // Click "Restore Backup (Smart Merge)"
  const mergeButton = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Restore Backup (Smart Merge)'))
  assert.ok(mergeButton)
  await act(async () => mergeButton.click())

  const fileInput = document.querySelector('input[type="file"]')
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
  await act(async () => {
    fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })

  // REQUIREMENT: SMART_MERGE_FLOW_MUST_NOT_GAIN_UNNECESSARY_DESTRUCTIVE_CONFIRMATION
  assert.equal(smartMergeCalled, true, 'Smart merge executes without prompting destructive confirmation')
  assert.doesNotMatch(document.body.textContent, /Confirm Wipe & Replace/)
  assert.match(document.body.textContent, /Backup restored/)
}))
