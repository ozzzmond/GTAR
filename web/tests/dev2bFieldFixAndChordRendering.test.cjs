const { test } = require('node:test')
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
require.extensions['.png'] = module => { module.exports = '/logo.png' }

const { JSDOM } = require('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173/' })
Object.assign(global, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: fn => fn(),
})
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.prompt = (_msg, src) => src

const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')

const { GTAR_DEV_VERSION } = require('../src/types/gtar.ts')
const { parseGtarSong } = require('../src/utils/songParser.ts')
const {
  transposeKey,
  formatEnharmonicKey,
  transposeChordProText,
} = require('../src/utils/chordTransposer.ts')
const { DesktopEditor } = require('../src/components/DesktopEditor.tsx')
const { KeyPickerModal } = require('../src/components/KeyPickerModal.tsx')

// ---------------------------------------------------------------------------
// 0. VERSION ALIGNMENT
// ---------------------------------------------------------------------------
test('DEV Version Alignment: target version is 1.0.123-dev.5d', () => {
  assert.equal(GTAR_DEV_VERSION, '1.0.123-dev.5d')
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'))
  assert.equal(pkg.version, '1.0.123-dev.5d')
  const pkgLock = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'))
  assert.equal(pkgLock.version, '1.0.123-dev.5d')
})

// ---------------------------------------------------------------------------
// SCOPE 1: SAVE BEHAVIOR & DIRECTIVES PRESERVATION
// ---------------------------------------------------------------------------
test('SCOPE 1: Editor Save preserves user-edited directives without undo/revert', async () => {
  let persistedSong = {
    id: 'test-song-1',
    title: 'Initial Title',
    artist: 'Initial Artist',
    key: 'C',
    bpm: '100',
    time: '4/4',
    year: '2020',
    tags: 'Worship',
    rawContent: '{title: Initial Title}\n{artist: Initial Artist}\n{key: C}\n{tempo: 100}\n{time: 4/4}\n{year: 2020}\n[C]Amazing [F]grace',
    format: 'CHORD_PRO',
    transposeOffset: 0,
  }

  let saveCalled = 0
  const props = {
    song: persistedSong,
    transposeOffset: 0,
    onClose: () => {},
    onUpdateSong: update => {
      persistedSong = { ...persistedSong, ...update }
      return true
    },
    onSaveSong: update => {
      saveCalled++
      persistedSong = { ...update }
      return true
    },
  }

  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(DesktopEditor, props)))

    const textarea = document.querySelector('textarea')
    assert.ok(textarea, 'Editor textarea must be rendered')

    // 1. User types in textarea to change the key directive to G and tempo to 128
    const updatedContent = '{title: Initial Title}\n{artist: Initial Artist}\n{key: G}\n{tempo: 128}\n{time: 4/4}\n{year: 2020}\n[G]Amazing [C]grace'
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, updatedContent)
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
    })

    // Textarea value must reflect user edit immediately (no bouncing back)
    assert.equal(textarea.value, updatedContent, 'Textarea value must remain what was input')

    // 2. Click Save button
    const saveButton = document.querySelector('[aria-label="Save changes"]')
    assert.ok(saveButton, 'Save button must be present')
    await act(async () => {
      saveButton.click()
    })

    assert.equal(saveCalled, 1, 'onSaveSong must be called exactly once')

    // 3. Verify that Save did NOT revert key back to C or strip tempo
    assert.equal(persistedSong.key, 'G', 'Persisted key must be updated to G')
    assert.equal(persistedSong.bpm, '128', 'Persisted BPM must be updated to 128')
    assert.ok(persistedSong.rawContent.includes('{key: G}'), 'Persisted rawContent must have {key: G}')
    assert.ok(persistedSong.rawContent.includes('128'), 'Persisted rawContent must have tempo directive')
    assert.ok(persistedSong.rawContent.includes('{time: 4/4}'), 'Persisted rawContent must keep {time: 4/4}')
    assert.ok(persistedSong.rawContent.includes('{year: 2020}'), 'Persisted rawContent must keep {year: 2020}')

    // 4. Verify editor displays "Saved" state
    assert.match(document.body.textContent, /Saved/)
    assert.doesNotMatch(document.body.textContent, /Unsaved/)
  } finally {
    await act(async () => root.unmount())
  }
})

// ---------------------------------------------------------------------------
// SCOPE 2: CHORDPRO RENDERING FIDELITY
// ---------------------------------------------------------------------------
test('SCOPE 2: Authored structure Intro: [G] - [Am7]... renders as inline CHORD_PRO without artificial section header', () => {
  const authoredLine = 'Intro: [G] - [Am7] - [D] - [G] - [Gsus] - [G] (Pause)'
  const songText = `{title: Field Check Song}\n{key: G}\n\n${authoredLine}\n\n[Verse 1]\n[G]When I wake up`

  const parsed = parseGtarSong(songText, 0)

  // Verify that "Intro:" was NOT turned into a SECTION_HEADER line
  const sectionHeaders = parsed.lines.filter(l => l.type === 'SECTION_HEADER')
  const introSection = sectionHeaders.find(h => h.title.toLowerCase() === 'intro')
  assert.equal(introSection, undefined, 'Must NOT create an artificial [Intro] section header from inline "Intro: ..."')

  // Verify that the line was parsed as CHORD_PRO with segments preserving authored text
  const chordProLines = parsed.lines.filter(l => l.type === 'CHORD_PRO')
  const targetLine = chordProLines.find(l => l.raw.includes('Intro:'))
  assert.ok(targetLine, 'Authored line must be parsed as CHORD_PRO')

  // The first segment must contain "Intro: " with null chord
  assert.equal(targetLine.segments[0].chord, null, 'First segment has no chord')
  assert.equal(targetLine.segments[0].text, 'Intro: ', 'First segment text is "Intro: "')

  // Chords are associated with their authored surrounding delimiters
  const chords = targetLine.segments.filter(s => s.chord !== null).map(s => s.chord)
  assert.deepEqual(chords, ['G', 'Am7', 'D', 'G', 'Gsus', 'G'], 'All bracketed chords are preserved in sequence')

  // The last segment includes (Pause)
  const lastSegment = targetLine.segments[targetLine.segments.length - 1]
  assert.ok(lastSegment.text.includes('(Pause)'), 'Last segment preserves (Pause) text')
})

test('SCOPE 2: Canonical bracketed section header [Intro] remains a valid SECTION_HEADER', () => {
  const songText = `[Intro]\n[G] [Am7] [D] [G]\n\n[Verse 1]\n[G]Lyric`
  const parsed = parseGtarSong(songText, 0)
  const introSection = parsed.lines.find(l => l.type === 'SECTION_HEADER' && l.title === 'Intro')
  assert.ok(introSection, 'Explicit bracketed [Intro] must be parsed as SECTION_HEADER')
})

// ---------------------------------------------------------------------------
// SCOPE 3: ENHARMONIC DISPLAY POLICY
// ---------------------------------------------------------------------------
test('SCOPE 3: Transpose key prefers conventional flat spellings for musician-facing keys', () => {
  // Key C shifted down 2 semitones must be Bb (not A#)
  assert.equal(transposeKey('C', -2), 'Bb')

  // Key C shifted up 3 semitones must be Eb (not D#)
  assert.equal(transposeKey('C', 3), 'Eb')

  // Key C shifted down 4 semitones must be Ab (not G#)
  assert.equal(transposeKey('C', -4), 'Ab')

  // Flat keys preserve flat spelling: Bb shifted up 2 semitones is C
  assert.equal(transposeKey('Bb', 2), 'C')

  // Transposing does not rewrite authored chord spellings unexpectedly
  const rawChords = '[C] [Am] [F] [G]'
  assert.equal(transposeChordProText(rawChords, 0), rawChords)
})

test('SCOPE 3: formatEnharmonicKey displays enharmonic pairs for accidental keys', () => {
  assert.equal(formatEnharmonicKey('C'), 'C')
  assert.equal(formatEnharmonicKey('G'), 'G')
  assert.equal(formatEnharmonicKey('D'), 'D')
  assert.equal(formatEnharmonicKey('A'), 'A')
  assert.equal(formatEnharmonicKey('E'), 'E')
  assert.equal(formatEnharmonicKey('B'), 'B')
  assert.equal(formatEnharmonicKey('F'), 'F')

  // Accidental keys format with paired enharmonics
  assert.equal(formatEnharmonicKey('C#'), 'C# / Db')
  assert.equal(formatEnharmonicKey('Db'), 'C# / Db')
  assert.equal(formatEnharmonicKey('D#'), 'Eb / D#')
  assert.equal(formatEnharmonicKey('Eb'), 'Eb / D#')
  assert.equal(formatEnharmonicKey('F#'), 'F# / Gb')
  assert.equal(formatEnharmonicKey('Gb'), 'F# / Gb')
  assert.equal(formatEnharmonicKey('G#'), 'Ab / G#')
  assert.equal(formatEnharmonicKey('Ab'), 'Ab / G#')
  assert.equal(formatEnharmonicKey('A#'), 'Bb / A#')
  assert.equal(formatEnharmonicKey('Bb'), 'Bb / A#')

  // Minor qualities preserved
  assert.equal(formatEnharmonicKey('C#m'), 'C#m / Dbm')
  assert.equal(formatEnharmonicKey('Bbm'), 'Bbm / A#m')
})

// ---------------------------------------------------------------------------
// SCOPE 4: TRANSPOSE KEY UX
// ---------------------------------------------------------------------------
test('SCOPE 4: KeyPickerModal displays "Select Transpose Key:" and enharmonic labels in UI', async () => {
  const root = createRoot(document.getElementById('root'))
  try {
    let selectedOffset = null
    const props = {
      isOpen: true,
      onClose: () => {},
      originalKey: 'C',
      currentOffset: 1, // +1 -> C# / Db
      onSelectOffset: offset => { selectedOffset = offset },
      onReset: () => {},
    }

    await act(async () => root.render(React.createElement(KeyPickerModal, props)))

    // 1. Verify updated label text
    const label = document.querySelector('label')
    assert.ok(label, 'Modal must render a label')
    assert.equal(label.textContent.trim(), 'Select Transpose Key:')

    // 2. Verify Transposed Key header displays enharmonic pair "C# / Db"
    assert.match(document.body.textContent, /C# \/ Db/)

    // 3. Verify grid buttons render enharmonic labels (e.g. Eb / D#, F# / Gb, Bb / A#)
    const buttonTexts = [...document.querySelectorAll('button')].map(b => b.textContent)
    assert.ok(buttonTexts.some(t => t.includes('C# / Db')), 'Must have C# / Db option')
    assert.ok(buttonTexts.some(t => t.includes('Eb / D#')), 'Must have Eb / D# option')
    assert.ok(buttonTexts.some(t => t.includes('Bb / A#')), 'Must have Bb / A# option')

    // 4. Verify Original Key displays C
    assert.match(document.body.textContent, /Original Key/)
  } finally {
    await act(async () => root.unmount())
  }
})
