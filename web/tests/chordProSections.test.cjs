const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename)

const { parseChordProSections, detectSectionHeader } = require('../src/utils/chordProSections.ts')

test('SECTION_RECOGNITION: Recognizes standard ChordPro section labels', () => {
  const standardHeaders = [
    '[Verse]',
    '[Verse 1]',
    '[Verse 2]',
    '[Chorus]',
    '[Chorus 1]',
    '[Bridge]',
    '[Intro]',
    '[Outro]',
    '[Pre-Chorus]',
    '[Post-Chorus]',
    '[Instrumental]',
    '[Solo]',
    '[Interlude]',
    '[Refrain]',
    '[Tag]',
    '[Ending]',
  ]

  for (const h of standardHeaders) {
    const d = detectSectionHeader(h)
    assert.equal(d.isHeader, true, `Expected ${h} to be recognized as header`)
    assert.ok(d.label.length > 0, `Expected label for ${h}`)
  }
})

test('SECTION_RECOGNITION: Recognizes custom section labels', () => {
  const customHeaders = ['[Vamp]', '[Spoken Word]', '[Prayer]', '[Turnaround]', '[Special]', '[Part A]']
  for (const h of customHeaders) {
    const d = detectSectionHeader(h)
    assert.equal(d.isHeader, true, `Expected custom header ${h} to be recognized`)
  }
})

test('SECTION_RECOGNITION: Rejects single chords and chord progressions', () => {
  const chords = ['[G]', '[D/F#]', '[Am7]', '[C#m]', '[G - D - Em - C]', '[A/C#]']
  for (const c of chords) {
    const d = detectSectionHeader(c)
    assert.equal(d.isHeader, false, `Expected chord ${c} NOT to be a section header`)
  }
})

test('SECTION_RECOGNITION: Recognizes ChordPro directives and comments', () => {
  assert.equal(detectSectionHeader('{soc}').isHeader, true)
  assert.equal(detectSectionHeader('{start_of_chorus}').isHeader, true)
  assert.equal(detectSectionHeader('{sob}').isHeader, true)
  assert.equal(detectSectionHeader('{c: Chorus 2}').isHeader, true)
  assert.equal(detectSectionHeader('{comment: Bridge}').isHeader, true)
})

test('SECTION_RECOGNITION: Gracefully handles malformed directives and plain lines', () => {
  assert.equal(detectSectionHeader('{soc').isHeader, false)
  assert.equal(detectSectionHeader('[Verse 1').isHeader, false)
  assert.equal(detectSectionHeader('When the night has come').isHeader, false)
  assert.equal(detectSectionHeader('').isHeader, false)
})

test('SOURCE_INTEGRITY: Exact round-trip concatenation preserves source character-for-character', () => {
  const rawText = `{title: Amazing Grace}
{artist: John Newton}
{key: G}

[Intro]
[G]  [C]  [G]  [D]

[Verse 1]
[G]Amazing grace how [C]sweet the [G]sound
That saved a wretch like [D]me!

[Chorus]
My chains are [C]gone, I've been set [G]free
My God, my [C]Savior has ransomed [G]me

[Verse 2]
'Twas [G]grace that taught my [C]heart to [G]fear
And grace my fears [D]relieved

[Outro]
[G]  [D]  [G]
`
  const result = parseChordProSections(rawText)
  assert.equal(result.hasSections, true)
  assert.equal(result.sections.length, 6) // Prelude + Intro + Verse 1 + Chorus + Verse 2 + Outro

  const reconstructed = result.sections.map((s) => s.fullText).join('')
  assert.equal(reconstructed, rawText, 'Reconstructed text must equal original raw text exactly')
})

test('REPEATED_SECTIONS: Repeated section labels receive unique identifiers and independent spans', () => {
  const rawText = `[Chorus]
First chorus lyrics

[Chorus]
Second chorus lyrics
`
  const result = parseChordProSections(rawText)
  assert.equal(result.sections.length, 2)
  assert.equal(result.sections[0].id, 'sec-0')
  assert.equal(result.sections[1].id, 'sec-1')
  assert.equal(result.sections[0].cleanLabel, 'Chorus')
  assert.equal(result.sections[1].cleanLabel, 'Chorus')
  assert.notEqual(result.sections[0].fullText, result.sections[1].fullText)
  assert.ok(result.sections[0].fullText.includes('First chorus'))
  assert.ok(result.sections[1].fullText.includes('Second chorus'))
})

test('PLAIN_TEXT_HANDLING: Plain text songs without sections are handled gracefully', () => {
  const plainText = `Just regular lyrics
without any section headings
line three
`
  const result = parseChordProSections(plainText)
  assert.equal(result.hasSections, false)
  assert.equal(result.sections.length, 1)
  assert.equal(result.sections[0].fullText, plainText)
})
