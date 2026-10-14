const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const Module = require('node:module')
const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options)
  } catch (err) {
    if (parent && parent.filename && request.startsWith('.')) {
      const dir = path.dirname(parent.filename)
      for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const candidate = path.resolve(dir, request + ext)
        if (fs.existsSync(candidate)) {
          return candidate
        }
      }
    }
    throw err
  }
}

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText,
      filename
    )
}

const {
  STAGE_SESSION_KEY,
  saveStageSession,
  readStageSession,
  clearStageSession,
  validateAndResolveStageSession,
} = require('../src/utils/stageSession.ts')
const { isCanonicalKey } = require('../src/utils/syncJournal.ts')

// Mock storage helper
function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() {
      return store.size
    },
  }
}

const mockSongs = [
  {
    id: 101,
    title: 'Stand By Me',
    artist: 'Ben E. King',
    key: 'A',
    rawContent: '[A]Stand by me',
    format: 'CHORD_PRO',
  },
  {
    id: 102,
    title: 'Hotel California',
    artist: 'Eagles',
    key: 'Bm',
    rawContent: '[Bm]Hotel California',
    format: 'CHORD_PRO',
  },
  {
    id: 103,
    title: 'Hallelujah',
    artist: 'Leonard Cohen',
    key: 'C',
    rawContent: '[C]Hallelujah',
    format: 'CHORD_PRO',
  },
]

const mockSetlists = [
  {
    id: 'gig-set-1',
    name: 'Acoustic Gig Set',
    songs: [
      { id: 101, title: 'Stand By Me', artist: 'Ben E. King' },
      { id: 102, title: 'Hotel California', artist: 'Eagles' },
    ],
  },
]

test('STAGE_SESSION_KEY is recognized as a canonical key for storage housekeeping', () => {
  assert.equal(STAGE_SESSION_KEY, 'gtar_stage_session_v1')
  assert.equal(isCanonicalKey(STAGE_SESSION_KEY), true, 'STAGE_SESSION_KEY must be in CANONICAL_STORAGE_PREFIXES')
})

test('saveStageSession, readStageSession, and clearStageSession round-trip', () => {
  const storage = createMockStorage()
  assert.equal(readStageSession(storage), null)

  const session = {
    isActive: true,
    queueMode: 'setlist',
    activeSetlistId: 'gig-set-1',
    activeSetlistSongIndex: 1,
    songId: 102,
    songTitle: 'Hotel California',
  }

  saveStageSession(session, storage)
  const loaded = readStageSession(storage)
  assert.ok(loaded)
  assert.equal(loaded.isActive, true)
  assert.equal(loaded.queueMode, 'setlist')
  assert.equal(loaded.activeSetlistId, 'gig-set-1')
  assert.equal(loaded.activeSetlistSongIndex, 1)
  assert.equal(loaded.songId, 102)

  clearStageSession(storage)
  assert.equal(readStageSession(storage), null)
})

test('STAGE_SESSION_VALID_RESTORE: Library queue mode restores valid song index and identity', () => {
  const session = {
    isActive: true,
    queueMode: 'library',
    activeSongIndex: 1,
    songId: 102,
    songTitle: 'Hotel California',
  }

  const result = validateAndResolveStageSession(session, mockSongs, mockSetlists)
  assert.equal(result.isValid, true)
  assert.equal(result.view, 'stage')
  assert.equal(result.queueMode, 'library')
  assert.equal(result.activeSongIndex, 1)
  assert.equal(result.resolvedSong?.id, 102)
  assert.equal(result.resolvedSong?.title, 'Hotel California')
})

test('STAGE_SESSION_VALID_RESTORE: Setlist queue mode restores valid setlist and song reference', () => {
  const session = {
    isActive: true,
    queueMode: 'setlist',
    activeSetlistId: 'gig-set-1',
    activeSetlistSongIndex: 1,
    songId: 102,
    songTitle: 'Hotel California',
  }

  const result = validateAndResolveStageSession(session, mockSongs, mockSetlists)
  assert.equal(result.isValid, true)
  assert.equal(result.view, 'stage')
  assert.equal(result.queueMode, 'setlist')
  assert.equal(result.activeSetlistId, 'gig-set-1')
  assert.equal(result.activeSetlistSongIndex, 1)
  assert.equal(result.resolvedSong?.id, 102)
})

test('STAGE_SESSION_STALE_STATE_SAFE: Inactive or empty session defaults safely to songbook', () => {
  const nullResult = validateAndResolveStageSession(null, mockSongs, mockSetlists)
  assert.equal(nullResult.isValid, false)
  assert.equal(nullResult.view, 'songbook')

  const inactiveResult = validateAndResolveStageSession({ isActive: false, queueMode: 'library' }, mockSongs, mockSetlists)
  assert.equal(inactiveResult.isValid, false)
  assert.equal(inactiveResult.view, 'songbook')

  const emptyLibResult = validateAndResolveStageSession({ isActive: true, queueMode: 'library' }, [], mockSetlists)
  assert.equal(emptyLibResult.isValid, false)
  assert.equal(emptyLibResult.view, 'songbook')
})

test('STAGE_SESSION_STALE_STATE_SAFE: Deleted library song is safely rejected', () => {
  const songsWithDeleted = [
    { ...mockSongs[0] },
    { ...mockSongs[1], isDeleted: true }, // deleted
  ]

  const session = {
    isActive: true,
    queueMode: 'library',
    activeSongIndex: 1,
    songId: 102,
    songTitle: 'Hotel California',
  }

  const result = validateAndResolveStageSession(session, songsWithDeleted, mockSetlists)
  assert.equal(result.isValid, false)
  assert.equal(result.view, 'songbook')
  assert.equal(result.reason, 'LIBRARY_SONG_NOT_FOUND')
})

test('STAGE_SESSION_STALE_STATE_SAFE: Missing/deleted setlist is safely rejected', () => {
  const session = {
    isActive: true,
    queueMode: 'setlist',
    activeSetlistId: 'non-existent-setlist',
    activeSetlistSongIndex: 0,
  }

  const result = validateAndResolveStageSession(session, mockSongs, mockSetlists)
  assert.equal(result.isValid, false)
  assert.equal(result.view, 'songbook')
  assert.equal(result.reason, 'SETLIST_NOT_FOUND')
})

test('STAGE_SESSION_STALE_STATE_SAFE: Setlist with deleted song reference is safely rejected', () => {
  const songsMissingOne = [mockSongs[0]] // song 102 is missing
  const session = {
    isActive: true,
    queueMode: 'setlist',
    activeSetlistId: 'gig-set-1',
    activeSetlistSongIndex: 1, // points to 102
    songId: 102,
  }

  const result = validateAndResolveStageSession(session, songsMissingOne, mockSetlists)
  assert.equal(result.isValid, false)
  assert.equal(result.view, 'songbook')
  assert.equal(result.reason, 'SETLIST_SONG_UNRESOLVED')
})

test('STAGE_SESSION_STALE_STATE_SAFE: Corrupted JSON in storage gracefully recovers', () => {
  const storage = createMockStorage({ [STAGE_SESSION_KEY]: '{ invalid JSON !!!' })
  const read = readStageSession(storage)
  assert.equal(read, null)

  const result = validateAndResolveStageSession(read, mockSongs, mockSetlists)
  assert.equal(result.isValid, false)
  assert.equal(result.view, 'songbook')
})

test('STAGE_SESSION_APP_CONTRACT: App source code wires stage session recovery and persistence', () => {
  const appCode = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8')
  assert.ok(appCode.includes('readStageSession'), 'App must import readStageSession')
  assert.ok(appCode.includes('saveStageSession'), 'App must import saveStageSession')
  assert.ok(appCode.includes('clearStageSession'), 'App must import clearStageSession')
  assert.ok(appCode.includes('validateAndResolveStageSession'), 'App must import validateAndResolveStageSession')
  assert.ok(appCode.includes('initialStageSession'), 'App must track initialStageSession')
  assert.ok(appCode.includes("activeView === 'stage'"), 'App must check activeView === stage for persistence')
})
