/**
 * GTAR_108_DEV_8B_MULTI_DEVICE_MERGE_DUPLICATION_FIX
 * Regression tests: multi-device merge must not triplicate (or duplicate) the song library.
 *
 * Identical revisions stay idempotent. Differing same-ID content without a base
 * requires explicit conflict copies; absence of a base cannot justify discarding edits.
 */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const ts = require("typescript")

for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs
          .readFileSync(filename, "utf8")
          .replaceAll(
            "import.meta.env",
            '({DEV:false,VITE_GOOGLE_CLIENT_ID:"client-test-id",VITE_AUTHORIZED_EMAILS:"jlopez3rd@gmail.com",VITE_ROOT_ADMIN_EMAIL:"jlopez3rd@gmail.com"})'
          ),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        }
      ).outputText,
      filename
    )
}

const { reconcileSongbook } = require("../src/utils/cloudSongbookSync.ts")
const { generateUUID, isValidUUID } = require("../src/utils/uuid.ts")
const { validateSongbookIntegrity } = require("../src/utils/songbookFoundation.ts")

function makeSong(overrides) {
  return Object.assign({
    id: generateUUID(),
    title: "Test Song",
    artist: "Test Artist",
    key: "G",
    capo: "No Capo",
    bpm: "120",
    format: "CHORD_PRO",
    transposeOffset: 0,
    rawContent: "[G]Amazing [C]grace",
    isDeleted: false,
  }, overrides || {})
}

// A: Identical merge -> count unchanged
test("A: merge identical local+cloud songbook -> song count unchanged", () => {
  const songs = Array.from({ length: 10 }, (_, i) => makeSong({ title: "Song " + i }))
  const lib = { songs, setlists: [] }
  const result = reconcileSongbook(lib, lib, lib)
  assert.equal(result.merged.songs.length, songs.length, "Identical merge must not change song count")
  assert.equal(result.hasConflicts, false)
})

// B: Idempotence
test("B: merge identical payload twice -> count unchanged (idempotent)", () => {
  const songs = Array.from({ length: 5 }, (_, i) => makeSong({ title: "Idempotent Song " + i }))
  const lib = { songs, setlists: [] }
  const first = reconcileSongbook(lib, lib, lib)
  assert.equal(first.merged.songs.length, songs.length)
  const second = reconcileSongbook(first.merged, lib, lib)
  assert.equal(second.merged.songs.length, songs.length, "Second merge must remain idempotent")
})

// C: Local-only + cloud-only songs -> both preserved
test("C: local-only + cloud-only songs -> both preserved exactly once", () => {
  const localSong = makeSong({ title: "Local Only Song" })
  const remoteSong = makeSong({ title: "Cloud Only Song" })
  const result = reconcileSongbook({ songs: [localSong], setlists: [] }, { songs: [remoteSong], setlists: [] }, null)
  assert.equal(result.merged.songs.length, 2, "Both songs must be preserved")
  assert.ok(result.merged.songs.some(s => s.id === localSong.id))
  assert.ok(result.merged.songs.some(s => s.id === remoteSong.id))
  assert.equal(result.hasConflicts, false)
})

// D: Setlist conflict copy does not clone global song library
test("D: setlist conflict copy does not add songs to global song library", () => {
  const sharedSetlistId = generateUUID()
  const song1 = makeSong({ title: "Stand By Me" })
  const song2 = makeSong({ title: "Amazing Grace" })
  const baseSetlist = { id: sharedSetlistId, name: "Acoustic Gig Set", songs: [{ id: song1.id, title: song1.title, artist: song1.artist }] }
  const localSetlist = { id: sharedSetlistId, name: "Acoustic Gig Set Local", songs: [{ id: song1.id, title: song1.title, artist: song1.artist }, { id: song2.id, title: song2.title, artist: song2.artist }] }
  const remoteSetlist = { id: sharedSetlistId, name: "Acoustic Gig Set Cloud", songs: [{ id: song1.id, title: song1.title, artist: song1.artist }] }
  const base = { songs: [song1], setlists: [baseSetlist] }
  const local = { songs: [song1, song2], setlists: [localSetlist] }
  const remote = { songs: [song1], setlists: [remoteSetlist] }
  const result = reconcileSongbook(local, remote, base)
  const songIds = result.merged.songs.map(s => s.id)
  const uniqueIds = new Set(songIds)
  assert.equal(uniqueIds.size, songIds.length, "Song library must have no duplicate IDs after setlist conflict copy")
  // song2 is local-only vs base: local changed (added song2), remote unchanged -> take local (with song2)
  // So library should have song1 + song2
  assert.ok(result.merged.songs.length <= 3, "Setlist conflict copy must not inflate song count")
})

// E: No-base same-ID divergence preserves both edits
test("E: no-base same-ID song divergence preserves both edits with explicit conflict", () => {
  const sharedId = generateUUID()
  const localSong = makeSong({ id: sharedId, rawContent: "[G]Local version of content" })
  const remoteSong = makeSong({ id: sharedId, rawContent: "[G]Remote version of content" })
  const result = reconcileSongbook({ songs: [localSong], setlists: [] }, { songs: [remoteSong], setlists: [] }, null)
  assert.equal(result.merged.songs.length, 2, "Both no-base edits must be preserved")
  assert.equal(result.merged.songs[0].id, sharedId)
  assert.equal(result.merged.songs[0].rawContent, localSong.rawContent)
  assert.equal(result.merged.songs[1].rawContent, remoteSong.rawContent)
  assert.ok(isValidUUID(result.merged.songs[1].id))
  assert.notEqual(result.merged.songs[1].id, sharedId)
  assert.equal(result.hasConflicts, true)
})

// E2: Every differing edit survives even in a large library
test("E2: 395-song no-base merge preserves all 790 differing versions", () => {
  const COUNT = 395
  const sharedSongs = Array.from({ length: COUNT }, (_, i) => ({
    id: generateUUID(),
    title: "Song " + i,
    artist: "Artist",
    key: "C",
    capo: "",
    bpm: "",
    format: "PLAIN",
    transposeOffset: 0,
    rawContent: "[C]Verse " + i,
    isDeleted: false,
  }))
  const remoteSongs = sharedSongs.map(s => Object.assign({}, s, { rawContent: s.rawContent + "\n" }))
  const result = reconcileSongbook({ songs: sharedSongs, setlists: [] }, { songs: remoteSongs, setlists: [] }, null)
  assert.equal(result.merged.songs.length, COUNT * 2)
  assert.equal(result.conflicts.length, COUNT)
  assert.equal(new Set(result.merged.songs.map(s => s.id)).size, COUNT * 2)
  for (const original of sharedSongs) {
    const retained = result.merged.songs.find(s => s.id === original.id)
    assert.equal(retained.rawContent, original.rawContent)
    assert.ok(result.merged.songs.some(s => s.id !== original.id && s.rawContent === original.rawContent + "\n"))
  }
})

// F: Two-stage chained merge -> no triplication
test("F: two-stage multi-device merge retains conflict copies without triplication", () => {
  const COUNT = 10
  const sharedSongs = Array.from({ length: COUNT }, (_, i) => ({
    id: generateUUID(),
    title: "Worship Song " + i,
    artist: "Worship Artist",
    key: "G",
    capo: "No Capo",
    bpm: "100",
    format: "CHORD_PRO",
    transposeOffset: 0,
    rawContent: "[G]Verse " + i + " content",
    isDeleted: false,
  }))
  const cloudSongs = sharedSongs.map(s => Object.assign({}, s, { rawContent: s.rawContent + "\n" }))
  const local = { songs: sharedSongs, setlists: [] }
  const cloud = { songs: cloudSongs, setlists: [] }
  const stage1 = reconcileSongbook(local, cloud, null)
  assert.equal(stage1.merged.songs.length, COUNT * 2, "Stage 1 must retain both differing versions")
  const stage2 = reconcileSongbook(local, stage1.merged, null)
  assert.equal(stage2.merged.songs.length, COUNT * 2, "Stage 2 must not create extra conflict copies")
  const uniqueIds = new Set(stage2.merged.songs.map(s => s.id))
  assert.equal(uniqueIds.size, COUNT * 2, "All song IDs must be unique after two-stage merge")
  const ordered = library => [...library.songs].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  assert.deepEqual(ordered(stage2.merged), ordered(stage1.merged))
})

// G: Reload + resync -> no duplication
test("G: resync same revision after reload -> no additional songs", () => {
  const songs = Array.from({ length: 8 }, (_, i) => makeSong({ title: "Resync Song " + i }))
  const lib = { songs, setlists: [] }
  const firstSync = reconcileSongbook(lib, lib, lib)
  assert.equal(firstSync.merged.songs.length, songs.length)
  const afterReload = reconcileSongbook(lib, lib, firstSync.merged)
  assert.equal(afterReload.merged.songs.length, songs.length, "Resync after reload must not add songs")
  assert.equal(afterReload.hasConflicts, false)
})

// H: True 3-way conflict with base -> conflict copy IS created
test("H: true 3-way song conflict with base -> conflict copy created, both versions preserved", () => {
  const sharedId = generateUUID()
  const baseSong = makeSong({ id: sharedId, rawContent: "[G]Original content" })
  const localSong = makeSong({ id: sharedId, rawContent: "[G]Local modification" })
  const remoteSong = makeSong({ id: sharedId, rawContent: "[G]Cloud modification" })
  const result = reconcileSongbook(
    { songs: [localSong], setlists: [] },
    { songs: [remoteSong], setlists: [] },
    { songs: [baseSong], setlists: [] }
  )
  assert.equal(result.merged.songs.length, 2, "True conflict must yield 2 songs")
  assert.equal(result.hasConflicts, true)
  assert.equal(result.conflicts.length, 1)
  const originalKept = result.merged.songs.find(s => s.id === sharedId)
  assert.ok(originalKept, "Local version must be kept at original ID")
  assert.equal(originalKept.rawContent, localSong.rawContent)
  const conflictCopy = result.merged.songs.find(s => s.id !== sharedId)
  assert.ok(conflictCopy, "Remote version must be preserved as conflict copy")
  assert.ok(isValidUUID(conflictCopy.id), "Conflict copy must have valid UUID")
  assert.ok(conflictCopy.title.includes("Cloud Copy"))
  assert.equal(conflictCopy.rawContent, remoteSong.rawContent)
})

// I: Setlist conflict copy song refs remain valid
test("I: setlist conflict copy creation -> song IDs in setlist refs remain valid", () => {
  const song1 = makeSong({ title: "Song A" })
  const song2 = makeSong({ title: "Song B" })
  const sharedSetlistId = generateUUID()
  const baseSetlist = { id: sharedSetlistId, name: "My Setlist", songs: [{ id: song1.id, title: song1.title, artist: song1.artist }] }
  const localSetlist = { id: sharedSetlistId, name: "My Setlist", songs: [{ id: song1.id, title: song1.title, artist: song1.artist }, { id: song2.id, title: song2.title, artist: song2.artist }] }
  const remoteSetlist = { id: sharedSetlistId, name: "My Setlist Remote", songs: [{ id: song1.id, title: song1.title, artist: song1.artist }] }
  const base = { songs: [song1, song2], setlists: [baseSetlist] }
  const local = { songs: [song1, song2], setlists: [localSetlist] }
  const remote = { songs: [song1, song2], setlists: [remoteSetlist] }
  const result = reconcileSongbook(local, remote, base)
  const songIdSet = new Set(result.merged.songs.map(s => String(s.id)))
  for (const sl of result.merged.setlists) {
    for (const ref of sl.songs) {
      assert.ok(songIdSet.has(String(ref.id)), "Setlist ref \"" + ref.title + "\" (id: " + ref.id + ") must exist in merged song library")
    }
  }
  const integrity = validateSongbookIntegrity(result.merged.songs, result.merged.setlists)
  assert.equal(integrity.duplicateSongIds.length, 0, "No duplicate song IDs after conflict copy")
})

// J: Tombstone semantics
test("J: both-deleted tombstone -> single tombstone, not duplicated", () => {
  const sharedId = generateUUID()
  const localTombstone = makeSong({ id: sharedId, isDeleted: true })
  const remoteTombstone = makeSong({ id: sharedId, isDeleted: true })
  const result = reconcileSongbook({ songs: [localTombstone], setlists: [] }, { songs: [remoteTombstone], setlists: [] }, null)
  assert.equal(result.merged.songs.length, 1, "Both-deleted tombstone must yield exactly 1 entry")
  assert.equal(Boolean(result.merged.songs[0].isDeleted), true, "Kept entry must be tombstoned")
  assert.equal(result.merged.songs[0].id, sharedId)
})
