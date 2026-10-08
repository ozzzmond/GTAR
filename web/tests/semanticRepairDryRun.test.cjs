/**
 * GTAR_108_DEV_8B_MULTI_DEVICE_DUPLICATION_REPAIR_PLAN_REVISION
 * Targeted tests: semantic fingerprint + dry-run repair analyzer
 *
 * Coverage:
 * A: different UUID + exact semantic content -> one survivor projected
 * B: setlist refs to removed UUID remapped to survivor, orphan_refs_after = 0
 * C: same title + different rawContent -> both preserved (not deduped)
 * D: same title + different transposeOffset -> both preserved (semantically distinct)
 * E: tombstone vs live variant -> not collapsed (isDeleted is part of fingerprint)
 * F: running analyzeRepairDryRun twice -> identical output (idempotent)
 * G: repair exact duplicate groups -> no orphan refs after remap
 * H: conflict-copy song (distinct UUID, different content) -> preserved alongside original
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs.readFileSync(filename, 'utf8').replaceAll(
          'import.meta.env',
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

const {
  computeSemanticSongFingerprint,
  analyzeRepairDryRun,
} = require('../src/utils/songbookFoundation.ts')
const { generateUUID } = require('../src/utils/uuid.ts')

function makeSong(overrides) {
  return Object.assign({
    id: generateUUID(),
    title: 'Test Song',
    artist: 'Test Artist',
    key: 'G',
    capo: 'No Capo',
    bpm: '120',
    format: 'CHORD_PRO',
    transposeOffset: 0,
    rawContent: '[G]Amazing [C]grace',
    isDeleted: false,
  }, overrides || {})
}

test('A: different UUIDs, same semantic content -> one survivor, one removed in dry run', () => {
  const idA = generateUUID()
  const idB = generateUUID()
  const content = '[G]Amazing [C]grace\nhow sweet the sound'
  const songA = makeSong({ id: idA, rawContent: content })
  const songB = makeSong({ id: idB, rawContent: content })

  const fpA = computeSemanticSongFingerprint(songA)
  const fpB = computeSemanticSongFingerprint(songB)
  assert.equal(fpA, fpB, 'Same semantic content must produce same fingerprint regardless of UUID')

  const report = analyzeRepairDryRun([songA, songB], [])
  assert.equal(report.exactDuplicateGroupCount, 1, 'Must detect 1 exact duplicate group')
  assert.equal(report.exactDuplicateRecordCount, 1, 'Must flag 1 record for removal')
  assert.equal(report.projectedSongCountAfterExactDedupe, 1, 'Projected count must be 1')
  assert.equal(report.plannedUuidRemaps.length, 1)
  const remap = report.plannedUuidRemaps[0]
  assert.notEqual(String(remap.removedId), String(remap.survivorId), 'Removed must differ from survivor')
})

test('B: setlist ref pointing to duplicate UUID -> remapped to survivor, zero orphan refs after', () => {
  const idA = generateUUID()
  const idB = generateUUID()
  const content = '[C]Verse one'
  const songA = makeSong({ id: idA, title: 'Hymn', rawContent: content })
  const songB = makeSong({ id: idB, title: 'Hymn', rawContent: content })
  const setlistRef = { id: idB, title: 'Hymn', artist: 'Test Artist' }
  const setlists = [{ id: generateUUID(), name: 'Gig', songs: [setlistRef] }]

  const report = analyzeRepairDryRun([songA, songB], setlists)

  assert.equal(report.exactDuplicateGroupCount, 1)
  assert.equal(report.orphanRefsAfterRepair, 0, 'After remap, zero orphan refs')
  assert.equal(report.orphanRefsBeforeRepair, 0)
  // setlistRefsAffected is 1 if idB is the removed UUID; 0 if idB is the survivor.
  // Either outcome is correct as long as orphanRefsAfterRepair stays 0.
  assert.ok(report.setlistRefsAffected === 0 || report.setlistRefsAffected === 1, 'Setlist ref must be either remapped or already on survivor')
  assert.equal(report.projectedSongCountAfterExactDedupe, 1, 'Projected count must be 1')
})

test('C: same title + different rawContent -> both preserved, no exact duplicate group', () => {
  const songA = makeSong({ title: 'Abba Father', rawContent: '[G]Abba Father [D]let me be' })
  const songB = makeSong({ title: 'Abba Father', rawContent: '[C]Abba Father [G]yours and yours alone' })

  const fpA = computeSemanticSongFingerprint(songA)
  const fpB = computeSemanticSongFingerprint(songB)
  assert.notEqual(fpA, fpB, 'Different content must produce different fingerprints')

  const report = analyzeRepairDryRun([songA, songB], [])
  assert.equal(report.exactDuplicateGroupCount, 0, 'No exact duplicate groups for different content')
  assert.equal(report.projectedSongCountAfterExactDedupe, 2, 'Both songs preserved')
  assert.equal(report.divergentSameTitleGroupCount, 1, 'Same title but divergent -> flagged as divergent group')
})

test('D: same title + different transposeOffset -> both preserved, fingerprints differ', () => {
  const content = '[G]Verse content'
  const songA = makeSong({ title: '10000', rawContent: content, transposeOffset: 0 })
  const songB = makeSong({ title: '10000', rawContent: content, transposeOffset: 3 })

  const fpA = computeSemanticSongFingerprint(songA)
  const fpB = computeSemanticSongFingerprint(songB)
  assert.notEqual(fpA, fpB, 'Different transposeOffset must produce different fingerprints')

  const report = analyzeRepairDryRun([songA, songB], [])
  assert.equal(report.exactDuplicateGroupCount, 0, 'Different transposeOffset -> not exact duplicates')
  assert.equal(report.projectedSongCountAfterExactDedupe, 2, 'Both songs preserved')
})

test('E: tombstone (isDeleted=true) + live record same content -> distinct fingerprints, both preserved', () => {
  const content = '[D]He is risen'
  const liveSong = makeSong({ title: 'Resurrection', rawContent: content, isDeleted: false })
  const tombstone = makeSong({ title: 'Resurrection', rawContent: content, isDeleted: true })

  const fpLive = computeSemanticSongFingerprint(liveSong)
  const fpTomb = computeSemanticSongFingerprint(tombstone)
  assert.notEqual(fpLive, fpTomb, 'isDeleted difference must produce different fingerprints')

  const report = analyzeRepairDryRun([liveSong, tombstone], [])
  assert.equal(report.exactDuplicateGroupCount, 0, 'Tombstone vs live -> not exact duplicates')
  assert.equal(report.projectedSongCountAfterExactDedupe, 2)
})

test('F: analyzeRepairDryRun is idempotent across two calls on same input', () => {
  const content = '[A]Same content here'
  const songA = makeSong({ rawContent: content })
  const songB = makeSong({ rawContent: content })
  const songC = makeSong({ rawContent: '[C]Different content entirely' })

  const songs = [songA, songB, songC]
  const setlists = []

  const report1 = analyzeRepairDryRun(songs, setlists)
  const report2 = analyzeRepairDryRun(songs, setlists)

  assert.equal(report1.exactDuplicateGroupCount, report2.exactDuplicateGroupCount)
  assert.equal(report1.exactDuplicateRecordCount, report2.exactDuplicateRecordCount)
  assert.equal(report1.projectedSongCountAfterExactDedupe, report2.projectedSongCountAfterExactDedupe)
  assert.equal(report1.orphanRefsAfterRepair, report2.orphanRefsAfterRepair)
  assert.equal(report1.setlistRefsAffected, report2.setlistRefsAffected)
  const remaps1 = report1.plannedUuidRemaps.map(r => String(r.removedId) + '->' + String(r.survivorId)).sort().join(',')
  const remaps2 = report2.plannedUuidRemaps.map(r => String(r.removedId) + '->' + String(r.survivorId)).sort().join(',')
  assert.equal(remaps1, remaps2, 'Survivor selection must be deterministic')
})

test('G: multiple exact duplicate groups with setlist refs -> all remapped, orphan_refs_after = 0', () => {
  const content1 = '[G]Group one content'
  const content2 = '[D]Group two content'
  const g1a = makeSong({ title: 'Song One', rawContent: content1 })
  const g1b = makeSong({ title: 'Song One', rawContent: content1 })
  const g2a = makeSong({ title: 'Song Two', rawContent: content2 })
  const g2b = makeSong({ title: 'Song Two', rawContent: content2 })
  const unique = makeSong({ title: 'Unique Song', rawContent: '[Am]Unique' })

  const setlists = [
    {
      id: generateUUID(), name: 'Set 1',
      songs: [
        { id: g1b.id, title: g1b.title, artist: g1b.artist },
        { id: g2b.id, title: g2b.title, artist: g2b.artist },
        { id: unique.id, title: unique.title, artist: unique.artist },
      ]
    }
  ]

  const report = analyzeRepairDryRun([g1a, g1b, g2a, g2b, unique], setlists)

  assert.equal(report.exactDuplicateGroupCount, 2, 'Two exact duplicate groups')
  assert.equal(report.exactDuplicateRecordCount, 2, 'Two records removed')
  assert.equal(report.projectedSongCountAfterExactDedupe, 3, '5 - 2 = 3 songs after dedupe')
  assert.equal(report.orphanRefsAfterRepair, 0, 'Zero orphan refs after remap')
})

test('H: conflict copy has different content -> distinct fingerprint, both preserved, not deduped', () => {
  const original = makeSong({
    title: 'A Thousand Hallelujahs - C',
    rawContent: '[C]A thousand hallelujahs [G]rise',
  })
  const conflictCopy = makeSong({
    title: 'A Thousand Hallelujahs - C (Cloud Copy)',
    rawContent: '[C]A thousand hallelujahs [G]rise\n[Am]additional verse in conflict copy',
  })

  const fpOrig = computeSemanticSongFingerprint(original)
  const fpConflict = computeSemanticSongFingerprint(conflictCopy)
  assert.notEqual(fpOrig, fpConflict, 'Conflict copy with added content must have different fingerprint')

  const report = analyzeRepairDryRun([original, conflictCopy], [])
  assert.equal(report.exactDuplicateGroupCount, 0, 'Conflict copy must not be treated as exact duplicate')
  assert.equal(report.projectedSongCountAfterExactDedupe, 2, 'Both songs preserved')
})

test('I: 10000 repeated same-title copies -> exact duplicates removed; 10000-2 remains distinct from 10000', () => {
  const content10k = '[F]Bless the Lord [C]O my soul\n[G]worship His name'
  const song1 = makeSong({ title: '10000', rawContent: content10k, key: 'G' })
  const song2 = makeSong({ title: '10000', rawContent: content10k, key: 'G' })
  const song3 = makeSong({ title: '10000-2', rawContent: content10k, key: 'G' })

  const fp1 = computeSemanticSongFingerprint(song1)
  const fp2 = computeSemanticSongFingerprint(song2)
  const fp3 = computeSemanticSongFingerprint(song3)

  assert.equal(fp1, fp2, 'Identical 10000 copies must have same fingerprint')
  assert.notEqual(fp1, fp3, '10000-2 must have different fingerprint from 10000')

  const report = analyzeRepairDryRun([song1, song2, song3], [])
  assert.equal(report.exactDuplicateGroupCount, 1, 'One exact duplicate group for 10000')
  assert.equal(report.exactDuplicateRecordCount, 1, 'One duplicate 10000 record removed')
  assert.equal(report.projectedSongCountAfterExactDedupe, 2, 'Two songs survive (10000 and 10000-2)')
  assert.ok(report.isMutationSafe)
})

test('J: Adonai - D remains distinct from Adonai - D print even when sharing identical rawContent', () => {
  const content = '[D]Lord of all creation\n[A]Adonai'
  const adonaiD = makeSong({ title: 'Adonai - D', rawContent: content, key: 'D' })
  const adonaiDPrint = makeSong({ title: 'Adonai - D print', rawContent: content, key: 'D' })

  const fp1 = computeSemanticSongFingerprint(adonaiD)
  const fp2 = computeSemanticSongFingerprint(adonaiDPrint)

  assert.notEqual(fp1, fp2, 'Adonai - D and Adonai - D print must have distinct fingerprints')

  const report = analyzeRepairDryRun([adonaiD, adonaiDPrint], [])
  assert.equal(report.exactDuplicateGroupCount, 0, 'No exact duplicate groups across distinct titles')
  assert.equal(report.projectedSongCountAfterExactDedupe, 2, 'Both variants preserved')
})

test('K: different keys or capos or bpm are not collapsed when behaviorally distinct', () => {
  const content = '[G]Praise the Lord'
  const songKeyG = makeSong({ title: 'Praise', rawContent: content, key: 'G' })
  const songKeyC = makeSong({ title: 'Praise', rawContent: content, key: 'C' })
  const songCapo2 = makeSong({ title: 'Praise', rawContent: content, key: 'G', capo: 'Capo 2' })
  const songBpm75 = makeSong({ title: 'Praise', rawContent: content, key: 'G', bpm: '75' })

  const report = analyzeRepairDryRun([songKeyG, songKeyC, songCapo2, songBpm75], [])
  assert.equal(report.exactDuplicateGroupCount, 0, 'Different keys, capos, bpm must not be collapsed')
  assert.equal(report.projectedSongCountAfterExactDedupe, 4, 'All four distinct variations preserved')
})

test('L: default-equivalent missing values normalize and deduplicate cleanly', () => {
  const content = '[G]Praise the Lord'
  const songDefault = makeSong({ title: 'Hymn', rawContent: content, key: 'G', capo: 'No Capo', bpm: '120' })
  const songEmptyDefaults = makeSong({ title: 'Hymn', rawContent: content, key: 'G', capo: '', bpm: '' })

  const fp1 = computeSemanticSongFingerprint(songDefault)
  const fp2 = computeSemanticSongFingerprint(songEmptyDefaults)
  assert.equal(fp1, fp2, 'No Capo and empty string, 120 and empty string must normalize as default-equivalent')

  const report = analyzeRepairDryRun([songDefault, songEmptyDefaults], [])
  assert.equal(report.exactDuplicateGroupCount, 1, 'Default-equivalent copies deduplicated')
  assert.equal(report.projectedSongCountAfterExactDedupe, 1)
})

test('M: tags and isFavorite are reconciled on the survivor rather than discarded', () => {
  const content = '[G]Praise the Lord'
  const songA = makeSong({ title: 'Di Ka Nagkulang', rawContent: content, tags: '', isFavorite: false })
  const songB = makeSong({ title: 'Di Ka Nagkulang', rawContent: content, tags: 'Worship', isFavorite: true })

  const report = analyzeRepairDryRun([songA, songB], [])
  assert.equal(report.exactDuplicateGroupCount, 1)
  const group = report.exactDuplicateGroups[0]
  assert.equal(group.reconciledIsFavorite, true, 'Favorite flag must be reconciled on survivor')
  assert.equal(group.reconciledTags, 'Worship', 'Tags must be preserved/reconciled on survivor')
  assert.equal(group.survivorId, songB.id, 'Candidate with favorite/tags preferred as survivor')
})

test('N: actual recovery file dry-run snapshot execution', () => {
  const path = require('node:path')
  const recoveryPath = 'E:/Downloads/GTAR-storage-recovery.json'
  if (!fs.existsSync(recoveryPath)) return

  const data = JSON.parse(fs.readFileSync(recoveryPath, 'utf8'))
  const lib = typeof data.gtar_library_v1 === 'string' ? JSON.parse(data.gtar_library_v1) : data.gtar_library_v1

  const report = analyzeRepairDryRun(lib.songs, lib.setlists || [])

  assert.equal(report.totalSongs, 1182)
  assert.equal(report.semanticGroupCount, 790)
  assert.equal(report.exactDuplicateGroupCount, 390)
  assert.equal(report.exactDuplicateRecordCount, 392)
  assert.equal(report.divergentSameTitleGroupCount, 385)
  assert.equal(report.projectedSongCountAfterExactDedupe, 790)
  assert.equal(report.setlistRefsAffected, 20)
  assert.equal(report.orphanRefsBeforeRepair, 0)
  assert.equal(report.orphanRefsAfterRepair, 0)
  assert.equal(report.isMutationSafe, true)
})
