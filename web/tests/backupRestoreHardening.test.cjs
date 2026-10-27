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
// #257: settings restore requires Web Locks; install an origin-wide lock manager like a real browser.
require('./helpers/fakeLocks.cjs').installNavigatorLocks()
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
test('new exports include schemaVersion 2 and accurate counts matching payload', () => {
  const songs = [mockSong1, mockSong2, mockTrash]
  const setlists = [mockSetlist]
  const payload = createBackupPayload(songs, setlists, '1.1.105')

  assert.equal(payload.schemaVersion, 2)
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
  assert.match(dupSong.error, /canonical ID collision/)

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
    key: () => null,
    length: 0,
  }

  assert.throws(() => {
    createRestoreSafetySnapshot({ songs: [mockSong1], setlists: [] }, failingStorage)
  }, /Pre-restore safety snapshot creation failed/)
})

// Recovery archives can be the only surviving copy of a song or chart.
function recoveryStorage(error, includeSnapshot = true) {
  const previousLibrary = { songs: [{ ...mockTrash, rawContent: '[D]Unique\r\n\uD83C\uDFB8 caf\u00e9' }], setlists: [] }
  const map = new Map([
    [LIBRARY_KEY, JSON.stringify({ songs: [mockSong1], setlists: [mockSetlist] })],
    ['gtar_sync_recovery:2026-01-01T01:00:00Z', ' { "songs": [{"id":"unique","title":"Only copy","rawContent":"[C]\uD83C\uDFB5"}], "setlists": [] }\n'],
    ['gtar_sync_recovery:2026-01-01T02:00:00Z', JSON.stringify({ local: { songs: [mockSong2] }, remote: { songs: [mockTrash] } })],
    ['gtar_sync_recovery:unknown', 'unparseable recovery bytes\r\n'],
    ['unrelated_user_key', 'user data'],
  ])
  if (includeSnapshot) map.set(RESTORE_SNAPSHOT_KEY, JSON.stringify({ createdAt: '2026-01-01T00:00:00Z', library: previousLibrary }, null, 2))
  const before = [...map]
  const calls = { writes: 0, removals: 0 }
  let failure = error
  const storage = {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => {
      calls.writes++
      if (failure) throw failure
      map.set(k, String(v))
    },
    removeItem: k => { calls.removals++; map.delete(k) },
    key: i => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
  return { storage, map, before, calls, previousLibrary, allowWrites: () => { failure = null } }
}

for (const [label, error] of [
  ['standard quota', new DOMException('Storage full', 'QuotaExceededError')],
  ['Firefox quota', new DOMException('Storage full', 'NS_ERROR_DOM_QUOTA_REACHED')],
  ['legacy quota', Object.assign(new Error('storage quota exceeded'), { name: 'QuotaExceededError' })],
  ['non-quota', new Error('Storage access denied')],
]) {
  for (const includeSnapshot of [true, false]) {
    test(`repeated ${label} failures retain every archive byte with prior snapshot=${includeSnapshot}`, () => {
      const { storage, map, before, calls, previousLibrary } = recoveryStorage(error, includeSnapshot)
      const library = { songs: [mockSong2], setlists: [] }
      const input = JSON.stringify(library)
      for (let attempt = 0; attempt < 3; attempt++) {
        assert.throws(() => createRestoreSafetySnapshot(library, storage), err => {
          assert.match(err.message, /Pre-restore safety snapshot creation failed/)
          assert.equal(err.cause, error)
          return true
        })
        assert.deepEqual([...map], before, 'All keys and exact stored strings must survive each failure')
        for (const [key, raw] of before) assert.deepEqual(Buffer.from(storage.getItem(key)), Buffer.from(raw), key)
        assert.deepEqual(restoreFromSafetySnapshot(storage), includeSnapshot ? previousLibrary : null)
        assert.equal(JSON.stringify(library), input)
      }
      assert.equal(calls.removals, 0)
      assert.equal(calls.writes, 3, 'One atomic write per attempt; no destructive retry')
    })
  }
}

test('snapshot succeeds after storage becomes writable without evicting recovery archives', () => {
  const { storage, map, before, calls, allowWrites } = recoveryStorage(new DOMException('Storage full', 'QuotaExceededError'))
  const library = { songs: [mockSong1, mockTrash], setlists: [mockSetlist] }
  assert.throws(() => createRestoreSafetySnapshot(library, storage), /Pre-restore safety snapshot creation failed/)
  assert.deepEqual([...map], before)
  allowWrites()
  createRestoreSafetySnapshot(library, storage)
  assert.deepEqual(restoreFromSafetySnapshot(storage), library)
  assert.ok(getRestoreSafetySnapshot(storage).createdAt)
  for (const [key, raw] of before) {
    if (key !== RESTORE_SNAPSHOT_KEY) assert.equal(storage.getItem(key), raw)
  }
  assert.equal(map.size, before.length + 1)
  assert.ok([...map].some(([key, raw]) => key.startsWith('gtar_sync_recovery:restore-snapshot:') && raw === new Map(before).get(RESTORE_SNAPSHOT_KEY)))
  assert.equal(calls.removals, 0)
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
  assert.match(modalText, /v2/) // Schema version (#251)
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

test('confirmed wipe & replace creates safety snapshot before restore, and retains it on success', withJsdom(async ({ dom, root }) => {
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
      onFullRestore: (songs, setlists) => {
        fullRestoreCalled = true
        // Check that safety snapshot exists BEFORE restore mutation runs
        if (dom.window.localStorage.getItem(RESTORE_SNAPSHOT_KEY)) {
          snapshotExistedDuringRestore = true
        }
        // #251: success is reported only after the saved library is read back.
        persistLibrary({ songs, setlists })
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
  // Successful restoration must retain recovery data.
  assert.equal(getRestoreSafetySnapshot().library.songs[0].id, mockSong2.id)
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
  persistLibrary({ songs: [mockSong1], setlists: [] })
  const backupData = JSON.stringify(createBackupPayload([mockSong2], []))
  const file = new dom.window.File([backupData], 'backup.json', { type: 'application/json' })

  await act(async () => {
    root.render(React.createElement(BackupRestoreDialogModal, {
      isOpen: true,
      onClose: () => {},
      allSongs: [mockSong1],
      setlists: [],
      onImportAllSongs: () => {},
      onSmartMerge: (songs, setlists) => { smartMergeCalled = true; appMerge()(songs, setlists) },
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


test('snapshot quota failure is visible and aborts restore without changing recovery bytes', withJsdom(async ({ dom, root }) => {
  const { storage, map, before, calls } = recoveryStorage(new DOMException('Storage full', 'QuotaExceededError'))
  const library = { songs: [mockSong2], setlists: [] }
  const input = JSON.stringify(library)
  const backupData = JSON.stringify(createBackupPayload([mockSong1], []))
  const file = new dom.window.File([backupData], 'backup.json', { type: 'application/json' })
  let closed = false
  let restoreCalls = 0
  await act(async () => {
    root.render(React.createElement(BackupRestoreDialogModal, {
      isOpen: true,
      onClose: () => { closed = true },
      allSongs: library.songs,
      setlists: library.setlists,
      storage,
      onImportAllSongs: () => { restoreCalls++ },
      onFullRestore: () => { restoreCalls++ },
    }))
  })
  for (let attempt = 0; attempt < 3; attempt++) {
    const wipeButton = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Full Restore (Wipe & Replace)'))
    await act(async () => wipeButton.click())
    const fileInput = document.querySelector('input[type="file"]')
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
    await act(async () => fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    const confirmButton = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Confirm Wipe & Replace'))
    assert.ok(confirmButton)
    await act(async () => confirmButton.click())
    assert.match(document.body.textContent, /Restore aborted: pre-restore safety snapshot failed to save/)
    assert.match(document.body.textContent, /Current library preserved/)
    assert.doesNotMatch(document.body.textContent, /Backup restored:/)
    assert.equal(restoreCalls, 0)
    assert.equal(closed, false)
    assert.deepEqual([...map], before)
    assert.equal(JSON.stringify(library), input)
  }
  assert.equal(calls.removals, 0)
}))


const settingsApi = require('../src/utils/backupSettings.ts')
const { persistLibrary, readPersistedLibrary } = require('../src/utils/syncJournal.ts')
const { mergeBackupLibrary } = require('../src/utils/setlistSongs.ts')
const { mergeImportedSetlists } = require('../src/utils/importIdentity.ts')
// #257 F1: restores are verified against the complete merged library, so merge mocks must merge like App does.
function appMerge(storage) {
  return (songs, setlists) => {
    const target = storage ?? localStorage
    const before = readPersistedLibrary(target) ?? { songs: [], setlists: [] }
    const merged = mergeBackupLibrary(before.songs, songs, setlists)
    persistLibrary({ songs: merged.songs, setlists: mergeImportedSetlists(before.setlists, merged.setlists) }, target, { force: true })
  }
}

async function mountRestore(root, props = {}) {
  await act(async () => root.render(React.createElement(BackupRestoreDialogModal, {
    isOpen: true, onClose: () => {}, allSongs: [mockSong2], setlists: [],
    onImportAllSongs: () => assert.fail('Unexpected fallback import'), ...props,
  })))
}
async function selectBackup(dom, payload, destructive = true) {
  const label = destructive ? 'Full Restore (Wipe & Replace)' : 'Restore Backup (Smart Merge)'
  await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent.includes(label)).click())
  const input = document.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => JSON.stringify(payload) }] })
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
}
async function confirmRestore() {
  await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Confirm Wipe & Replace')).click())
}
function lifecycleSetlists(active) {
  return Array.from({ length: 21 }, (_, i) => ({
    ...mockSetlist, id: `set-${i}`, name: `Gig ${i}`, ...(i >= active ? { isDeleted: true } : i % 2 ? { isDeleted: false } : {}),
  }))
}
for (const active of [3, 4, 21, 0]) {
  test(`preview and roundtrip preserve 21 total / ${active} active / ${21 - active} deleted setlists`, withJsdom(async ({ dom, root }) => {
    const setlists = lifecycleSetlists(active)
    const before = JSON.stringify(setlists)
    const payload = createBackupPayload([mockSong1, mockTrash], setlists)
    // #257 F4: a declared count that does not match the content rejects the file (it never overrides the real totals).
    const tampered = parseBackupJson(JSON.stringify({ ...payload, setlistCount: 999 }))
    assert.equal(tampered.isValid, false)
    assert.match(tampered.error, /setlistCount: file declares 999 but contains 21/)
    const parsed = parseBackupJson(JSON.stringify(payload))
    assert.equal(parsed.isValid, true, parsed.error)
    assert.equal(parsed.metadata.setlistCount, 21)
    assert.equal(parsed.metadata.activeSetlistCount, active)
    assert.equal(parsed.metadata.deletedSetlistCount, 21 - active)
    assert.equal(parsed.metadata.activeSetlistCount + parsed.metadata.deletedSetlistCount, parsed.metadata.setlistCount)
    assert.deepEqual(parsed.setlists, setlists)
    assert.equal(JSON.stringify(setlists), before)
    assert.equal(createBackupPayload(parsed.songs, parsed.setlists).setlists.filter(sl => sl.isDeleted).length, 21 - active)
    await mountRestore(root, { onFullRestore: () => assert.fail('Preview wrote library') })
    await selectBackup(dom, payload)
    for (const [label, count] of [['Total Setlists', 21], ['Active Setlists', active], ['Deleted Setlists', 21 - active], ['Active Songs', 1], ['Trash Bin (Archived Songs)', 1]]) {
      const element = [...document.querySelectorAll('div, span')].find(el => el.textContent === label)
      assert.ok(element, label)
      assert.equal(element.parentElement.textContent.replace(label, '').trim(), String(count))
    }
  }))
}

test('search-filtered visible setlists do not change full backup preview totals', withJsdom(async ({ dom, root }) => {
  const { SongbookHomeView } = require('../src/components/SongbookHomeView.tsx')
  const setlists = lifecycleSetlists(3)
  await act(async () => root.render(React.createElement(SongbookHomeView, {
    songs: [mockSong1], setlists, searchQuery: 'Gig 1', activeSongIndex: 0,
    onSongMembershipChange: () => true, onCreateSetlistForSong: () => true,
    onSelectSong: () => {}, onNewSong: () => {}, onOpenSetlists: () => {}, onDeleteSong: () => {},
  })))
  assert.match(document.body.textContent, /Song Setlists \(1 of 3\)/)
  const payload = createBackupPayload([mockSong1], setlists)
  await mountRestore(root)
  await selectBackup(dom, payload)
  assert.match(document.body.textContent, /Total Setlists21/)
  assert.match(document.body.textContent, /Active Setlists3/)
  assert.match(document.body.textContent, /Deleted Setlists18/)
}))

for (const destructive of [true, false]) {
  test(`recovery archive rejected without any writes in destructive=${destructive} flow`, withJsdom(async ({ dom, root }) => {
    let writes = 0
    const storage = { getItem: () => null, setItem: () => { writes++ }, removeItem: () => assert.fail('Recovery deleted') }
    await mountRestore(root, { storage, onFullRestore: () => assert.fail('Library replaced'), onSmartMerge: () => assert.fail('Library merged') })
    // Even a recovery archive with otherwise valid top-level backup arrays is unsupported.
    await selectBackup(dom, { exportType: 'RECOVERY_ARCHIVE', data: { songs: [mockSong1] }, songs: [mockSong1], setlists: [] }, destructive)
    assert.match(document.body.textContent, /Recovery archive.*not a supported restore-ready backup/)
    assert.doesNotMatch(document.body.textContent, /Ready to restore|Confirm Wipe & Replace|Backup restored:/)
    assert.equal(writes, 0)
  }))
}

function completeSettings() {
  const colors = { bgHex: '#123456', textHex: '#ffffff', chordHex: '#abcdef', sectionHex: '#654321',
    headerBg: '#112233', actionColor: '#223344', uiLinkText: '#334455',
    fonts: { ui: { source: 'builtin', family: 'Inter' }, stage: { source: 'builtin', family: 'Fira Code' }, heading: { source: 'system' } } }
  return { themeMode: 'paper-light', customThemeColors: colors,
    factoryThemeOverrides: {
      'paper-light': { ...colors, identity: { factoryId: 'paper-light', displayName: 'My Paper' } },
      'azure-stage': { ...colors, bgHex: '#445566', identity: { factoryId: 'azure-stage', displayName: 'My Azure' } },
    }, stageSettings: { fontStyle: 'serif', fontSizePx: 25, isTwoColumn: false, scrollSpeed: 90 } }
}
for (const destructive of [true, false]) {
  test(`modal restores every supported setting and reloads customized factory slots; destructive=${destructive}`, withJsdom(async ({ dom, root }) => {
    const settings = completeSettings()
    settingsApi.restoreBackupSettings(settings)
    const payload = createBackupPayload([mockSong1, mockTrash], [mockSetlist])
    localStorage.clear()
    const recoveryKey = 'gtar_sync_recovery:unique'
    localStorage.setItem(recoveryKey, 'unique recovery bytes')
    persistLibrary({ songs: [mockSong2], setlists: [] })
    const save = (songs, setlists) => persistLibrary({ songs, setlists }, localStorage, { force: true })
    await mountRestore(root, { onFullRestore: save, onSmartMerge: appMerge() })
    await selectBackup(dom, payload, destructive)
    if (destructive) await confirmRestore()
    assert.match(document.body.textContent, /Backup restored:/)
    assert.deepEqual(settingsApi.readBackupSettings(), settings)
    assert.deepEqual(readPersistedLibrary().setlists, payload.setlists)
    assert.equal(localStorage.getItem(recoveryKey), 'unique recovery bytes')
    // Remount from persisted storage and exercise the same theme hydration used on reload.
    await act(async () => root.render(null))
    const theme = require('../src/components/ThemeModal.tsx')
    const hydrated = theme.hydrateThemeSettings()
    assert.equal(hydrated.mode, settings.themeMode)
    for (const [slot, palette] of Object.entries(settings.factoryThemeOverrides)) {
      const resolved = theme.resolveThemePalette(slot, hydrated.standalone)
      assert.equal(resolved.bgHex, palette.bgHex)
      assert.deepEqual(resolved.identity, palette.identity)
      assert.deepEqual(resolved.fonts, palette.fonts)
    }
    assert.deepEqual(settingsApi.readBackupSettings(), settings)
    assert.equal(readPersistedLibrary().songs.length, destructive ? 2 : 3)
  }))
}

for (const settings of [{ factoryThemeOverrides: {}, stageSettings: {} }, {}]) {
  test(`modal preserves intentional empty overrides and legacy absent settings: ${JSON.stringify(settings)}`, withJsdom(async ({ dom, root }) => {
    const previous = completeSettings()
    settingsApi.restoreBackupSettings(previous)
    await mountRestore(root, { onFullRestore: (songs, setlists) => persistLibrary({ songs, setlists }) })
    await selectBackup(dom, { songs: [mockSong1], setlists: [], ...settings })
    await confirmRestore()
    assert.match(document.body.textContent, /Backup restored:/)
    assert.deepEqual(settingsApi.readBackupSettings(), { ...previous, ...('factoryThemeOverrides' in settings ? { factoryThemeOverrides: {} } : {}) })
  }))
}

for (const destructive of [true, false]) {
  for (const quota of [true, false]) {
    test(`settings failure after library save is rolled back and reported; destructive=${destructive}, quota=${quota}`, withJsdom(async ({ dom, root }) => {
      const map = new Map([['gtar_sync_recovery:unique', 'only copy']])
      let closed = false
      let events = 0
      window.addEventListener(settingsApi.SETTINGS_CHANGED, () => { events++ })
      const storage = {
        getItem: key => map.get(key) ?? null,
        setItem: (key, value) => {
          if (key === settingsApi.SETTINGS_KEYS.themeMode) throw quota ? new DOMException('Storage full', 'QuotaExceededError') : new Error('Access denied')
          map.set(key, String(value))
        },
        // #257 F2: settings keys may be put back (removed when they were absent); recovery data never.
        removeItem: key => { if (key.startsWith('gtar_sync_recovery:')) assert.fail('Recovery data deleted'); map.delete(key) },
      }
      persistLibrary({ songs: [mockSong2], setlists: [] }, storage)
      const save = (songs, setlists) => persistLibrary({ songs, setlists }, storage, { force: true })
      await mountRestore(root, { storage, onClose: () => { closed = true }, onFullRestore: save, onSmartMerge: appMerge(storage) })
      await selectBackup(dom, { songs: [mockSong1], setlists: [], ...completeSettings() }, destructive)
      if (destructive) await confirmRestore()
      assert.match(document.body.textContent, /Library restored: 1 songs, 0 setlists \(verified after saving\), but settings were not restored/)
      assert.match(document.body.textContent, /every setting was put back and verified\. This device's previous settings are unchanged\./)
      assert.doesNotMatch(document.body.textContent, /Backup restored:|restore aborted|Confirm Wipe & Replace/)
      assert.equal(closed, false)
      assert.equal(events, 0)
      assert.ok(readPersistedLibrary(storage).songs.some(song => song.id === mockSong1.id))
      // The override written before the failing key was put back (it was absent).
      assert.equal(storage.getItem(settingsApi.SETTINGS_KEYS.factoryThemeOverrides), null)
      assert.equal(storage.getItem('gtar_sync_recovery:unique'), 'only copy')
      if (destructive) assert.equal(getRestoreSafetySnapshot(storage).library.songs[0].id, mockSong2.id)
    }))
  }
}

test('stale library write rejects restore before settings change and retains snapshots', withJsdom(async ({ dom, root }) => {
  persistLibrary({ songs: [mockSong2], setlists: [] })
  const baseline = localStorage.getItem(LIBRARY_KEY)
  const external = JSON.stringify({ songs: [mockTrash], setlists: [] })
  await mountRestore(root, { onFullRestore: (songs, setlists) => {
    localStorage.setItem(LIBRARY_KEY, external)
    persistLibrary({ songs, setlists }, localStorage, { expectedRaw: baseline })
  } })
  await selectBackup(dom, { songs: [mockSong1], setlists: [], ...completeSettings() })
  await confirmRestore()
  assert.match(document.body.textContent, /Persistence rejected to prevent data loss/)
  assert.doesNotMatch(document.body.textContent, /Backup restored:|Partial restore:/)
  assert.equal(localStorage.getItem(LIBRARY_KEY), external)
  assert.deepEqual(settingsApi.readBackupSettings(), {})
  assert.equal(getRestoreSafetySnapshot().library.songs[0].id, mockSong2.id)
}))
