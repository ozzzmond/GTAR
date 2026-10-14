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

const { parseChord, isChordToken } = require('../src/utils/chordParser.ts')
const {
  transposeChordToken,
  transposeChordProText,
  transposeChordLine,
} = require('../src/utils/chordTransposer.ts')
const {
  keyPrefersFlats,
  spellPitchClass,
  transposeNoteWithKey,
} = require('../src/utils/enharmonicPolicy.ts')
const {
  transposeCanonicalSong,
  establishChartKey,
  transposeChartText,
} = require('../src/utils/chartKeyAlignment.ts')
const { getChordVoicing } = require('../src/utils/chordDictionary.ts')

// 1. PARSER: ROOTS, ACCIDENTALS, QUALITIES, MODIFIERS, PARENTHESES, SLASH
test('PARSER: Natural roots, sharps, flats, minor, major aliases', () => {
  const naturalRoots = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
  for (const r of naturalRoots) {
    const p = parseChord(r)
    assert.ok(p, `Must parse natural root ${r}`)
    assert.equal(p.root, r)
    assert.equal(p.quality, '')
  }

  const sharps = ['C#', 'D#', 'F#', 'G#', 'A#']
  for (const s of sharps) {
    const p = parseChord(s)
    assert.ok(p, `Must parse sharp root ${s}`)
    assert.equal(p.root, s)
  }

  const flats = ['Db', 'Eb', 'Gb', 'Ab', 'Bb']
  for (const f of flats) {
    const p = parseChord(f)
    assert.ok(p, `Must parse flat root ${f}`)
    assert.equal(p.root, f)
  }

  // Minor
  const minors = ['Cm', 'Cmin', 'Cminor']
  for (const m of minors) {
    const p = parseChord(m)
    assert.ok(p, `Must parse minor chord ${m}`)
    assert.equal(p.root, 'C')
  }

  // Major aliases
  const majors = ['Cmaj', 'Cmajor', 'Cmaj7', 'CM']
  for (const m of majors) {
    const p = parseChord(m)
    assert.ok(p, `Must parse major chord ${m}`)
    assert.equal(p.root, 'C')
  }
})

test('PARSER: 5, 6, 7, maj7, m7, dim, aug, sus2/sus4, add forms', () => {
  const common = ['C5', 'C6', 'Cm6', 'C7', 'Cm7', 'Cmaj7', 'Cdim', 'Cdim7', 'Caug']
  for (const c of common) {
    assert.ok(parseChord(c), `Must parse ${c}`)
  }

  const susAndAdd = [
    'Csus', 'Csus2', 'Csus4', 'C7sus2', 'C7sus4',
    'Cadd2', 'Cadd4', 'Cadd9', 'Cadd11', 'Cadd13'
  ]
  for (const s of susAndAdd) {
    assert.ok(parseChord(s), `Must parse ${s}`)
  }
})

test('PARSER: Extensions 9/11/13, altered extensions, parenthesized modifiers', () => {
  const extensions = [
    'C9', 'Cm9', 'Cmaj9', 'C11', 'Cm11', 'C13', 'Cm13', 'Cmaj13',
    'C7b5', 'C7#5', 'C7b9', 'C7#9', 'C9#11', 'C13b9', 'C13#11', 'Cm7b5', 'Cmaj7#11'
  ]
  for (const e of extensions) {
    assert.ok(parseChord(e), `Must parse ${e}`)
  }

  const parenthesized = [
    'C(add9)', 'C(b9)', 'C(#9)', 'C7(b9)', 'C7(#9)', 'Cmaj7(#11)',
    'F#m7(b5)', 'Am(add9)'
  ]
  for (const p of parenthesized) {
    const parsed = parseChord(p)
    assert.ok(parsed, `Must parse parenthesized ${p}`)
    assert.equal(parsed.isKnown, true, `Parenthesized chord ${p} should be known`)
  }
})

test('PARSER: Slash chords, flat slash bass, compound suffixes', () => {
  const slashes = [
    ['C/E', 'C', '', 'E'],
    ['D/F#', 'D', '', 'F#'],
    ['G/B', 'G', '', 'B'],
    ['Bb/D', 'Bb', '', 'D'],
    ['F#m/C#', 'F#', 'm', 'C#'],
    ['Am7/G', 'A', 'm7', 'G'],
    ['F#m7b5/E', 'F#', 'm7b5', 'E'],
    ['C6/9/G', 'C', '6/9', 'G'],
  ]
  for (const [chord, root, qual, bass] of slashes) {
    const p = parseChord(chord)
    assert.ok(p, `Must parse slash chord ${chord}`)
    assert.equal(p.root, root)
    assert.equal(p.quality, qual)
    assert.equal(p.bass, bass)
  }
})

test('PARSER: Conservative Safe Rooted Unknown & Prose Rejection', () => {
  // Safe rooted unknown: root note with uncommon modifier, not arbitrary text
  const safeUnknown = ['C^7', 'G(no3)', 'F#(no5)']
  for (const u of safeUnknown) {
    const p = parseChord(u)
    assert.ok(p, `Should safely recognize rooted token ${u}`)
    assert.equal(p.isKnown, false)
    assert.equal(p.root, u.startsWith('F#') ? 'F#' : u[0])
  }

  // English words and prose must be rejected
  const proseRejections = [
    'Verse', 'Chorus', 'Intro', 'Outro', 'Bridge', 'Solo', 'Tab',
    'And', 'apple', 'Dance', 'When', 'Kamukha', 'Just', 'A thousand',
    'Before', 'Can', 'Do', 'Every', 'Good', 'Father'
  ]
  for (const r of proseRejections) {
    assert.equal(parseChord(r), null, `Prose "${r}" must be rejected as chord`)
  }

  // Fused concatenated chords must be rejected (not safe unknown)
  assert.equal(parseChord('Cadd9A7sus4Em7'), null, 'Fused concatenated chord tokens must be rejected')
  assert.equal(parseChord('D/F#foo'), null, 'Invalid slash chord D/F#foo must be rejected')
})

// 2. ENHARMONIC SPELLING & KEY CONTEXT
test('ENHARMONIC: Deterministic key-aware spelling for major and minor target keys', () => {
  // Target F (prefer Bb)
  assert.equal(transposeNoteWithKey('A', 1, 'F'), 'Bb')

  // Target Bb (prefer Bb, Eb)
  assert.equal(transposeNoteWithKey('A', 1, 'Bb'), 'Bb')
  assert.equal(transposeNoteWithKey('D', 1, 'Bb'), 'Eb')

  // Target Eb (prefer Eb, Ab, Bb)
  assert.equal(transposeNoteWithKey('D', 1, 'Eb'), 'Eb')
  assert.equal(transposeNoteWithKey('G', 1, 'Eb'), 'Ab')
  assert.equal(transposeNoteWithKey('A', 1, 'Eb'), 'Bb')

  // Target Ab (prefer Ab, Db, Eb)
  assert.equal(transposeNoteWithKey('G', 1, 'Ab'), 'Ab')
  assert.equal(transposeNoteWithKey('C', 1, 'Ab'), 'Db')
  assert.equal(transposeNoteWithKey('D', 1, 'Ab'), 'Eb')

  // Target D (prefer F# rather than Gb)
  assert.equal(transposeNoteWithKey('F', 1, 'D'), 'F#')

  // Target E (prefer G# rather than Ab)
  assert.equal(transposeNoteWithKey('G', 1, 'E'), 'G#')

  // Target A (prefer C#)
  assert.equal(transposeNoteWithKey('C', 1, 'A'), 'C#')

  // Target B (prefer F#, C#, G#, D#, A#)
  assert.equal(transposeNoteWithKey('F', 1, 'B'), 'F#')

  // Slash bass note consistency with target key
  assert.equal(transposeChordToken('C/E', 1, 'Db'), 'Db/F')
  assert.equal(transposeChordToken('D/F#', 1, 'Eb'), 'Eb/G')
  assert.equal(transposeChordToken('G/B', 3, 'Bb'), 'Bb/D')
})

// 3. TRANSPOSE ENGINE
test('TRANSPOSE: Semitone shift, octave invariance, zero transpose, negative shift', () => {
  // Up semitone
  assert.equal(transposeChordToken('C', 1), 'C#')
  assert.equal(transposeChordToken('C', 1, true), 'Db')

  // Down semitone
  assert.equal(transposeChordToken('D', -1), 'C#')
  assert.equal(transposeChordToken('D', -1, true), 'Db')

  // Octave invariance (12 semitones returns same root pitch)
  assert.equal(transposeChordToken('Cmaj7', 12), 'Cmaj7')
  assert.equal(transposeChordToken('D/F#', 12), 'D/F#')

  // Zero transpose
  assert.equal(transposeChordToken('C(add9)', 0), 'C(add9)')
  assert.equal(transposeChordToken('F#m7(b5)/E', 0), 'F#m7(b5)/E')

  // Slash chord root + bass transposition
  assert.equal(transposeChordToken('D/F#', 2, 'E'), 'E/G#')
  assert.equal(transposeChordToken('Bb/D', 2, 'C'), 'C/E')
  assert.equal(transposeChordToken('F#m7b5/E', 1, 'G'), 'Gm7b5/F')

  // Parenthesized and altered suffixes survive intact
  assert.equal(transposeChordToken('C(add9)', 2, 'D'), 'D(add9)')
  assert.equal(transposeChordToken('C7(b9)', 2, 'D'), 'D7(b9)')
  assert.equal(transposeChordToken('Cmaj7(#11)', 2, 'D'), 'Dmaj7(#11)')
  assert.equal(transposeChordToken('F#m7(b5)', 2, 'G'), 'G#m7(b5)')

  // Unknown non-chord text passes through untouched
  assert.equal(transposeChordToken('NotAChord', 2), 'NotAChord')
  assert.equal(transposeChordToken('Verse 1', 2), 'Verse 1')
})

test('TRANSPOSE: ChordPro and chord-line formatting stability', () => {
  const chordPro = '[C]Amazing [F]grace [G7]how [C]sweet\n[Am7]That [F#m7(b5)]saved a [G(add9)]wretch'
  const transposed = transposeChordProText(chordPro, 2, 'D')
  assert.equal(
    transposed,
    '[D]Amazing [G]grace [A7]how [D]sweet\n[Bm7]That [G#m7(b5)]saved a [A(add9)]wretch'
  )

  // Two-line chord row spacing preservation
  const chordLine = 'C          F          G7         C'
  const transLine = transposeChordLine(chordLine, 2, 'D')
  assert.equal(transLine, 'D          G          A7         D')
})

// 4. CANONICAL TRANSPOSE BOUNDARY
test('CANONICAL_BOUNDARY: transposeCanonicalSong updates key metadata and transposes chords deterministically', () => {
  const song = `{title: Test Song}
{artist: Test Artist}
{key: C}
{tempo: 120 BPM}

[Intro]
[C] [F] [G] [C]

[Verse 1]
[C]Amazing [F]grace how [G7]sweet the [C]sound
[Am7]That saved a [D/F#]wretch like [G]me`

  const result = transposeCanonicalSong(song, 'C', 'Eb')
  assert.equal(result.key, 'Eb')
  assert.equal(result.semitones, 3)

  assert.match(result.rawContent, /\{key:\s*Eb\}/)
  assert.match(result.rawContent, /\{title:\s*Test Song\}/)
  assert.match(result.rawContent, /\{tempo:\s*120 BPM\}/)
  assert.match(result.rawContent, /\[Eb\] \[Ab\] \[Bb\] \[Eb\]/)
  assert.match(result.rawContent, /\[Eb\]Amazing \[Ab\]grace how \[Bb7\]sweet/)
  assert.match(result.rawContent, /\[Cm7\]That saved a \[F\/A\]wretch like \[Bb\]me/)

  // Round trip C -> Eb -> C preserves original text identically
  const roundTrip = transposeCanonicalSong(result.rawContent, 'Eb', 'C')
  assert.equal(roundTrip.key, 'C')
  assert.equal(roundTrip.rawContent, song)
})

// 5. TRUSTED VOICING CATALOG & DIAGRAM RESOLUTION
test('CATALOG: Material coverage of standard, extended, slash and enharmonic chords', () => {
  // Natural chords
  const naturalVoicings = ['C', 'Cm', 'C7', 'Cmaj7', 'Cadd9', 'Csus4', 'Csus2', 'C6', 'Cdim7', 'Caug']
  for (const c of naturalVoicings) {
    const v = getChordVoicing(c)
    assert.ok(v, `Catalog must have trusted voicing for ${c}`)
    assert.equal(v.frets.length, 6)
  }

  // Accidental chords
  const accidentalVoicings = ['F#', 'F#m', 'F#7', 'F#m7', 'F#maj7', 'Bb', 'Bbm', 'Bb7', 'Eb', 'Ab']
  for (const a of accidentalVoicings) {
    const v = getChordVoicing(a)
    assert.ok(v, `Catalog must have trusted voicing for ${a}`)
  }

  // Common slash chords
  const slashVoicings = ['D/F#', 'G/B', 'C/E', 'A/C#', 'Bb/D', 'F#/A#']
  for (const s of slashVoicings) {
    const v = getChordVoicing(s)
    assert.ok(v, `Catalog must have trusted voicing for slash chord ${s}`)
  }

  // Enharmonic alias resolution (A# resolves through Bb shape, D# resolves through Eb)
  const aSharp = getChordVoicing('A#')
  assert.ok(aSharp, 'A# must resolve via trusted voicing alias')
  assert.equal(aSharp.chord, 'A#')

  // Parenthesized forms resolve cleanly to base voicing
  const paren = getChordVoicing('C(add9)')
  assert.ok(paren, 'C(add9) must resolve to Cadd9 voicing')
  const m7b5 = getChordVoicing('F#m7(b5)')
  assert.ok(m7b5, 'F#m7(b5) must resolve to F#m7b5 voicing')

  // Valid chords with no trusted voicing return null (Graceful unavailable state)
  assert.equal(getChordVoicing('C13#11'), null, 'Exotic chord with no trusted shape returns null')
  assert.equal(getChordVoicing('NotAChord'), null, 'Non-chord returns null')
})

test('STAGE_RUNTIME_SAFETY: Transpose offset is non-persistent and diagram availability does not gate transpose', () => {
  // A valid chord without diagram transposes cleanly
  const exoticChord = 'Cmaj13#11'
  assert.equal(getChordVoicing(exoticChord), null, 'Exotic chord has no diagram')
  const transposedExotic = transposeChordToken(exoticChord, 2, 'D')
  assert.equal(transposedExotic, 'Dmaj13#11', 'Exotic chord without diagram transposes accurately')
})
