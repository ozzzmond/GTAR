const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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
  normalizeChordForVoicingLookup,
  standardChords,
} = require('../src/utils/chordDictionary.ts')
const { GTAR_DEV_VERSION } = require('../src/types/gtar.ts')
const pkgJson = require('../package.json')
const pkgLockJson = require('../package-lock.json')
const authCore = fs.readFileSync(require.resolve('../functions/lib/authCore.ts'), 'utf8')

// 1. VERSION CONTRACT (1.0.123-dev.5b)
test('DEV4A_VERSION_CONTRACT: Canonical version updated to 1.0.123-dev.5b', () => {
  assert.equal(GTAR_DEV_VERSION, '1.0.123-dev.5b', 'gtar.ts GTAR_DEV_VERSION must be 1.0.123-dev.5b')
  assert.equal(pkgJson.version, '1.0.123-dev.5b', 'package.json version must be 1.0.123-dev.5b')
  assert.equal(pkgLockJson.version, '1.0.123-dev.5b', 'package-lock.json root version must be 1.0.123-dev.5b')
  assert.equal(pkgLockJson.packages[''].version, '1.0.123-dev.5b', 'package-lock.json packages[""] must be 1.0.123-dev.5b')
  assert.ok(authCore.includes('v1.0.123-dev.5b'), 'authCore.ts header must reference v1.0.123-dev.5b')
})

// 2. FIELD REGRESSIONS
test('FIELD_REGRESSIONS: Fm6, Abadd4, Absus, Db2/F resolve to trusted practical diagrams', () => {
  // Fm6
  const fm6 = getChordVoicing('Fm6')
  assert.ok(fm6, 'Fm6 must resolve to trusted voicing')
  assert.equal(fm6.chord, 'Fm6', 'Preserves requested chord title')
  assert.deepEqual(fm6.frets, [-1, -1, 3, 1, 3, 1], 'Fm6 frets match trusted fingering')

  // Abadd4
  const abadd4 = getChordVoicing('Abadd4')
  assert.ok(abadd4, 'Abadd4 must resolve to trusted voicing')
  assert.equal(abadd4.chord, 'Abadd4', 'Preserves requested chord title')
  assert.deepEqual(abadd4.frets, [4, 4, 6, 5, 4, 4], 'Abadd4 frets match trusted barre fingering')

  // Absus
  const absus = getChordVoicing('Absus')
  assert.ok(absus, 'Absus must resolve to trusted voicing')
  assert.equal(absus.chord, 'Absus', 'Preserves requested chord title')
  assert.deepEqual(absus.frets, [4, 6, 6, 6, 4, 4], 'Absus frets match trusted Absus4 fingering')

  // Db2/F
  const db2f = getChordVoicing('Db2/F')
  assert.ok(db2f, 'Db2/F must resolve to trusted voicing')
  assert.equal(db2f.chord, 'Db2/F', 'Preserves requested chord title')
  assert.equal(db2f.frets[0], 1, 'Bass string has fret 1 (F in bass)')
  assert.deepEqual(db2f.frets, [1, 4, 3, 1, 4, 1], 'Db2/F frets match trusted fingering')
})

// 3. SHORTHAND & NOTATION ALIASES
test('ALIASES: C2, Csus, C(add9), Cm7(b5), and enharmonics resolve correctly', () => {
  // C2 -> Cadd2
  const c2 = getChordVoicing('C2')
  assert.ok(c2, 'C2 must resolve via Cadd2 alias')
  assert.equal(c2.chord, 'C2')
  assert.deepEqual(c2.frets, [-1, 3, 0, 0, 1, 0])

  // Csus -> Csus4
  const csus = getChordVoicing('Csus')
  assert.ok(csus, 'Csus must resolve via Csus4 alias')
  assert.equal(csus.chord, 'Csus')
  assert.deepEqual(csus.frets, [-1, 3, 3, 0, 1, 1])

  // Parenthesized forms: C(add9) -> Cadd9
  const cAdd9Paren = getChordVoicing('C(add9)')
  assert.ok(cAdd9Paren, 'C(add9) must resolve via Cadd9 alias')
  assert.equal(cAdd9Paren.chord, 'C(add9)')
  assert.deepEqual(cAdd9Paren.frets, [-1, 3, 2, 0, 3, 0])

  // Cm7(b5) -> Cm7b5
  const cm7b5 = getChordVoicing('Cm7(b5)')
  assert.ok(cm7b5, 'Cm7(b5) must resolve via Cm7b5 alias')
  assert.equal(cm7b5.chord, 'Cm7(b5)')
  assert.deepEqual(cm7b5.frets, [-1, 3, 4, 3, 4, -1])

  // Enharmonic root lookup: A# -> Bb, G# -> Ab
  const aSharp = getChordVoicing('A#')
  assert.ok(aSharp, 'A# must resolve via Bb voicing')
  assert.equal(aSharp.chord, 'A#')

  const gSharp = getChordVoicing('G#')
  assert.ok(gSharp, 'G# must resolve via Ab voicing')
  assert.equal(gSharp.chord, 'G#')
})

// 4. FLAT-KEY PRACTICAL COVERAGE
test('FLAT_KEYS: Representative chords in F, Bb, Eb, Ab, Db, Gb and relative minors resolve', () => {
  const flatKeys = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']
  const essentialQualities = ['', 'm', '2', '5', '6', '7', 'maj7', 'sus', 'sus2', 'sus4', 'm7', 'm7b5']

  for (const root of flatKeys) {
    for (const q of essentialQualities) {
      const chord = `${root}${q}`
      const v = getChordVoicing(chord)
      assert.ok(v, `Flat key chord ${chord} must resolve to trusted voicing`)
      assert.equal(v.frets.length, 6)
      assert.equal(v.chord, chord)
    }
  }

  // Relative minor coverage (Fm, Bbm, Ebm)
  const relMinors = ['Fm', 'Bbm', 'Ebm']
  for (const m of relMinors) {
    assert.ok(getChordVoicing(m), `${m} triad must resolve`)
    assert.ok(getChordVoicing(`${m}6`), `${m}6 must resolve`)
    assert.ok(getChordVoicing(`${m}7`), `${m}7 must resolve`)
  }
})

// 5. SLASH CHORD COVERAGE
test('SLASH_CHORDS: Inversions and common patterns represent bass note intentionally', () => {
  const commonSlashes = [
    { chord: 'C/E', bassFret: 0, bassString: 0 },
    { chord: 'D/F#', bassFret: 2, bassString: 0 },
    { chord: 'G/B', bassFret: 2, bassString: 1 },
    { chord: 'Bb/D', bassFret: 0, bassString: 2 },
    { chord: 'Eb/G', bassFret: 3, bassString: 0 },
    { chord: 'Ab/C', bassFret: 3, bassString: 1 },
    { chord: 'Db/F', bassFret: 1, bassString: 0 },
    { chord: 'Db2/F', bassFret: 1, bassString: 0 },
  ]

  for (const { chord, bassFret, bassString } of commonSlashes) {
    const v = getChordVoicing(chord)
    assert.ok(v, `Slash chord ${chord} must resolve`)
    assert.equal(v.chord, chord)
    assert.equal(v.frets[bassString], bassFret, `Bass string ${bassString} for ${chord} must be fret ${bassFret}`)
  }

  // Worship add2/add9 slash forms fallback safely to trusted root/bass inversions
  const worshipSlashes = ['C2/E', 'D2/F#', 'G2/B', 'A2/C#']
  for (const s of worshipSlashes) {
    const v = getChordVoicing(s)
    assert.ok(v, `${s} must resolve to trusted slash voicing`)
    assert.equal(v.chord, s, 'Preserves requested chord title')
  }
})

// 6. UNAVAILABLE STATE PRESERVATION & SAFETY
test('UNAVAILABLE_STATE: Uncataloged extended/altered chords return null without crashing or fake fallback', () => {
  // Valid transposable chord with no cataloged fingering
  assert.equal(getChordVoicing('C13#11'), null, 'C13#11 must return null gracefully')
  assert.equal(getChordVoicing('Cmaj7#11'), null, 'Cmaj7#11 must return null gracefully')
  assert.equal(getChordVoicing('C13#11/G'), null, 'C13#11/G must return null gracefully and not fake C/G')
  assert.equal(getChordVoicing('NonExistentChord'), null, 'Nonsense chord returns null')
  assert.equal(getChordVoicing('N.C.'), null, 'N.C. returns null')
  assert.equal(getChordVoicing(''), null, 'Empty string returns null')
})

// 7. DISPLAY PRESERVATION
test('DISPLAY_PRESERVATION: Alias resolution does not mutate requested chord label', () => {
  const tests = [
    { input: 'C2', expectedLabel: 'C2' },
    { input: 'Csus', expectedLabel: 'Csus' },
    { input: 'C(add9)', expectedLabel: 'C(add9)' },
    { input: 'Cm7(b5)', expectedLabel: 'Cm7(b5)' },
    { input: 'Db2/F', expectedLabel: 'Db2/F' },
    { input: '[Am7]', expectedLabel: '[Am7]' },
  ]

  for (const { input, expectedLabel } of tests) {
    const v = getChordVoicing(input)
    assert.ok(v, `${input} must resolve`)
    assert.equal(v.chord, expectedLabel, `Displayed chord label must match requested ${expectedLabel}`)
  }
})
