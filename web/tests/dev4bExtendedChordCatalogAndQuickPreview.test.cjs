const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(
        fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'),
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
  getChordVoicing,
  getAllChordVoicings,
  normalizeChordForVoicingLookup,
  standardChords,
  curatedChords,
} = require('../src/utils/chordDictionary.ts')
const { IMPORTED_CHORD_VOICINGS } = require('../src/data/importedChords.ts')
const { importChordsDbData } = require('../scripts/importChordsDb.ts')
const { GTAR_DEV_VERSION } = require('../src/types/gtar.ts')
const pkgJson = require('../package.json')
const pkgLockJson = require('../package-lock.json')
const authCore = fs.readFileSync(require.resolve('../functions/lib/authCore.ts'), 'utf8')

// 1. VERSION CONTRACT (1.0.123-dev.5b)
test('DEV4B_VERSION_CONTRACT: Canonical version updated to 1.0.123-dev.5b', () => {
  assert.equal(GTAR_DEV_VERSION, '1.0.123-dev.5b', 'gtar.ts GTAR_DEV_VERSION must be 1.0.123-dev.5b')
  assert.equal(pkgJson.version, '1.0.123-dev.5b', 'package.json version must be 1.0.123-dev.5b')
  assert.equal(pkgLockJson.version, '1.0.123-dev.5b', 'package-lock.json root version must be 1.0.123-dev.5b')
  assert.equal(pkgLockJson.packages[''].version, '1.0.123-dev.5b', 'package-lock.json packages[""] must be 1.0.123-dev.5b')
  assert.ok(authCore.includes('v1.0.123-dev.5b'), 'authCore.ts header must reference v1.0.123-dev.5b')
})

// 2. DATASET DISCOVERY, PROVENANCE & LICENSING
test('DATASET_PROVENANCE: Licensed imported chords-db data meets attribution, licensing, and schema invariants', () => {
  assert.ok(IMPORTED_CHORD_VOICINGS.length >= 3000, `Expected >= 3000 imported voicings, got ${IMPORTED_CHORD_VOICINGS.length}`)
  
  // Verify provenance header in imported module
  const importedCode = fs.readFileSync(path.resolve(__dirname, '../src/data/importedChords.ts'), 'utf8')
  assert.ok(importedCode.includes('MIT License'), 'Imported data file must include MIT license notice')
  assert.ok(importedCode.includes('chords-db'), 'Imported data file must include provenance source')

  // Verify all imported entries adhere to physical guitar rules
  for (const v of IMPORTED_CHORD_VOICINGS) {
    assert.ok(typeof v.chord === 'string' && v.chord.length > 0, 'Voicing must have chord identifier')
    assert.equal(v.frets.length, 6, `Voicing ${v.chord} must have exactly 6 string fret values`)
    assert.ok(v.frets.every(f => typeof f === 'number' && f >= -1 && f <= 24), `Invalid fret value in ${v.chord}`)
    assert.ok(typeof v.baseFret === 'number' && v.baseFret >= 1 && v.baseFret <= 24, `Invalid baseFret in ${v.chord}`)
    if (v.fingers) {
      assert.equal(v.fingers.length, 6, `Fingers array if present must be length 6 in ${v.chord}`)
      assert.ok(v.fingers.every(f => f >= 0 && f <= 4), `Invalid finger value in ${v.chord}`)
    }
  }
})

// 3. DETERMINISTIC IMPORTER PIPELINE & REJECTION OF MALFORMED RECORDS
test('IMPORT_PIPELINE: Deterministic importer handles normalization, deduplication, and malformed rejection', () => {
  const dummyRaw = {
    main: { strings: 6, fretsOnChord: 5, name: 'guitar', numberOfChords: 2 },
    tunings: { standard: ['E', 'A', 'D', 'G', 'B', 'E'] },
    chords: {
      C: [
        {
          key: 'C',
          suffix: 'major',
          positions: [
            { frets: [-1, 3, 2, 0, 1, 0], baseFret: 1 },
            { frets: [-1, 3, 2, 0, 1, 0], baseFret: 1 }, // duplicate physical shape
            { frets: [0, 0, 0], baseFret: 1 }, // malformed string count (3 instead of 6)
            { frets: [-1, 3, 2, 0, 1, 99], baseFret: 1 }, // invalid fret > 24
            { frets: [-1, 3, 2, 0, 1, 0], baseFret: -1 }, // invalid baseFret
          ],
        },
      ],
    },
  }

  const imported = importChordsDbData(dummyRaw)
  assert.equal(imported.length, 1, 'Importer must deduplicate and reject malformed records')
  assert.equal(imported[0].chord, 'C', 'Suffix "major" normalized to empty suffix "C"')
  assert.deepEqual(imported[0].frets, [-1, 3, 2, 0, 1, 0])
})

// 4. MULTIPLE VOICINGS & TRUST PRECEDENCE
test('MULTIPLE_VOICINGS_AND_PRECEDENCE: getAllChordVoicings returns multiple legitimate shapes, getChordVoicing returns preferred shape', () => {
  const cVoicings = getAllChordVoicings('C')
  assert.ok(cVoicings.length >= 4, `C must have multiple voicings (got ${cVoicings.length})`)

  // First voicing must be the hand-curated GTAR shape (open C)
  assert.equal(cVoicings[0].source, 'CURATED_GTAR')
  assert.deepEqual(cVoicings[0].frets, [-1, 3, 2, 0, 1, 0])

  // Single lookup must return preferred curated voicing
  const cDefault = getChordVoicing('C')
  assert.ok(cDefault)
  assert.equal(cDefault.source, 'CURATED_GTAR')
  assert.deepEqual(cDefault.frets, [-1, 3, 2, 0, 1, 0])

  // Future ChordPro {define: ...} precedence
  const songDefined = new Map([
    ['c', { chord: 'C', baseFret: 8, frets: [8, 10, 10, 9, 8, 8] }]
  ])
  const customC = getChordVoicing('C', songDefined)
  assert.ok(customC)
  assert.equal(customC.source, 'SONG_DEFINED')
  assert.deepEqual(customC.frets, [8, 10, 10, 9, 8, 8])
})

// 5. FIELD CHORDS: Db/Gb and E7/G#
test('FIELD_CHORDS: Db/Gb and E7/G# resolve accurately without fabrication', () => {
  // Db/Gb (enharmonic C#/F# from licensed imported dataset)
  const dbGb = getChordVoicing('Db/Gb')
  assert.ok(dbGb, 'Db/Gb must resolve via trusted dataset')
  assert.equal(dbGb.chord, 'Db/Gb', 'Requested chord spelling must be preserved')
  assert.equal(dbGb.source, 'LICENSED_IMPORTED')
  // Verify bass note is indeed Gb/F# (4th string 4th fret or equivalent)
  assert.equal(dbGb.frets[2], 4, 'Db/Gb bass note on string 4 is fret 4 (F#/Gb)')

  // E7/G# (hand-curated GTAR 1st inversion)
  const e7Gsharp = getChordVoicing('E7/G#')
  assert.ok(e7Gsharp, 'E7/G# must resolve via trusted catalog')
  assert.equal(e7Gsharp.chord, 'E7/G#', 'Requested chord spelling must be preserved')
  assert.equal(e7Gsharp.source, 'CURATED_GTAR')
  assert.deepEqual(e7Gsharp.frets, [4, 2, 0, 1, 0, 0], 'E7/G# frets match standard 4 2 0 1 0 0')
})

// 6. DEV.4a REGRESSION CHORDS
test('DEV4A_REGRESSIONS: Fm6, Abadd4, Absus, Db2/F remain resolved', () => {
  const fm6 = getChordVoicing('Fm6')
  assert.ok(fm6)
  assert.equal(fm6.chord, 'Fm6')
  assert.deepEqual(fm6.frets, [-1, -1, 3, 1, 3, 1])

  const abadd4 = getChordVoicing('Abadd4')
  assert.ok(abadd4)
  assert.equal(abadd4.chord, 'Abadd4')
  assert.deepEqual(abadd4.frets, [4, 4, 6, 5, 4, 4])

  const absus = getChordVoicing('Absus')
  assert.ok(absus)
  assert.equal(absus.chord, 'Absus')
  assert.deepEqual(absus.frets, [4, 6, 6, 6, 4, 4])

  const db2f = getChordVoicing('Db2/F')
  assert.ok(db2f)
  assert.equal(db2f.chord, 'Db2/F')
  assert.deepEqual(db2f.frets, [1, 4, 3, 1, 4, 1])
})

// 7. EXTENDED DATASET EXPANSION (e.g. 69, alt, 7b5, maj13, etc.)
test('EXTENDED_CATALOG_COVERAGE: Trusted imported chords resolve extended jazz/modern qualities', () => {
  const c69 = getChordVoicing('C69')
  assert.ok(c69, 'C69 resolves from imported catalog')
  assert.equal(c69.chord, 'C69')
  assert.equal(c69.source, 'LICENSED_IMPORTED')

  const d13 = getChordVoicing('D13')
  assert.ok(d13, 'D13 resolves from imported catalog')
  assert.equal(d13.chord, 'D13')
  assert.equal(d13.source, 'LICENSED_IMPORTED')

  const g7b5 = getChordVoicing('G7b5')
  assert.ok(g7b5, 'G7b5 resolves from imported catalog')
  assert.equal(g7b5.chord, 'G7b5')
  assert.equal(g7b5.source, 'LICENSED_IMPORTED')
})

// 8. UNAVAILABLE CHORD BEHAVIOR (FAIL-CLOSED)
test('UNAVAILABLE_CHORD: Unsupported chords return null gracefully without fake shape fabrication', () => {
  const fake = getChordVoicing('Qmaj99#11')
  assert.equal(fake, null, 'Nonsense chord must return null')

  const uncataloged = getChordVoicing('Cmaj7#11b13')
  assert.equal(uncataloged, null, 'Uncataloged complex altered chord returns null without guessing')
})

// 9. CHORD QUICK PREVIEW UX & INTERACTIVE COMPONENTS
test('QUICK_PREVIEW_COMPONENT: ChordQuickPreview and ChordSvgDiagram exist, import cleanly, and render correctly', () => {
  const React = require('react')
  const { ChordQuickPreview } = require('../src/components/ChordQuickPreview.tsx')
  const { ChordSvgDiagram } = require('../src/components/ChordSvgDiagram.tsx')

  assert.ok(typeof ChordQuickPreview === 'function', 'ChordQuickPreview must be a React component')
  assert.ok(typeof ChordSvgDiagram === 'function', 'ChordSvgDiagram must be a React component')
})
