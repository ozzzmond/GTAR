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

const webDir = path.resolve(__dirname, '..')

// 1. LOOKUP ENTRY POINT PLACEMENT & MODAL CLEANUP
test('ENTRY_POINT_PLACEMENT: Primary Lookup Metadata action is on main editor toolbar and removed from Song Details modal', () => {
  const editorSource = fs.readFileSync(path.join(webDir, 'src/components/DesktopEditor.tsx'), 'utf8')

  // Main Action Editing Toolbar contains the lookup button
  assert.ok(editorSource.includes('data-testid="editor-lookup-metadata-button"'), 'DesktopEditor must have primary lookup button on main toolbar')
  assert.ok(editorSource.includes('title="Lookup Metadata suggestion (Original Key, Tempo, Year)"'), 'Toolbar lookup button has descriptive suggestion tooltip')

  // Check the Song Details & Metadata modal header does NOT have the duplicate button
  const modalSectionMatch = editorSource.match(/\{isMetadataModalOpen && \([\s\S]*?Song Details & Metadata[\s\S]*?Canonical Metadata Inputs/)
  assert.ok(modalSectionMatch, 'Must find Song Details modal markup')
  const modalMarkup = modalSectionMatch[0]
  assert.ok(!modalMarkup.includes('handleLookupMetadata'), 'Song Details modal header must NOT contain redundant handleLookupMetadata action')
  assert.ok(!modalMarkup.includes('<span>Lookup Metadata</span>'), 'Song Details modal must NOT contain duplicate Lookup Metadata text')
})

// 2. CANONICAL CHORDPRO METADATA EXTRACTION & INPUTS
test('CANONICAL_METADATA_INPUTS: Lookup derives input from canonical structured ChordPro directives, sends no body/lyrics', () => {
  const { parseChordProDirectives } = require(path.join(webDir, 'src/utils/chordProMetadata.ts'))
  const { validateMetadataPayload } = require(path.join(webDir, 'functions/api/songbook/metadata.ts'))

  // Hillsong United - Go canonical fixture
  const sampleChordPro = `{title: Go}
{artist: Hillsong United}
{key: G}
{tempo: 130 BPM}
{time: 4/4}
{year: 2011}

{comment: Chorus 1}
We're giving it [G]all away, away
We're giving it [C]all to go Your way`

  const parsed = parseChordProDirectives(sampleChordPro).metadata
  assert.equal(parsed.title, 'Go')
  assert.equal(parsed.artist, 'Hillsong United')
  assert.equal(parsed.key, 'G')
  assert.equal(parsed.tempo, '130 BPM')
  assert.equal(parsed.time, '4/4')
  assert.equal(parsed.year, '2011')

  // Validation accepts extended fields
  const validated = validateMetadataPayload({
    title: parsed.title,
    artist: parsed.artist,
    currentKey: parsed.key,
    tempo: parsed.tempo,
    timeSignature: parsed.time,
    year: parsed.year,
  })
  assert.equal(validated.isValid, true)
  assert.equal(validated.data.title, 'Go')
  assert.equal(validated.data.artist, 'Hillsong United')
  assert.equal(validated.data.currentKey, 'G')
  assert.equal(validated.data.tempo, '130 BPM')
  assert.equal(validated.data.timeSignature, '4/4')
  assert.equal(validated.data.year, '2011')

  // Ensure body/lyrics are NEVER included in request payload
  assert.equal(validated.data.rawContent, undefined)
  assert.equal(validated.data.body, undefined)
  assert.equal(validated.data.lyrics, undefined)
})

// 3. PROMPT SEMANTICS: CURRENT KEY VS ORIGINAL KEY & ZERO TRANSPOSE INSTRUCTIONS
test('PROMPT_SEMANTICS: Prompt explicitly distinguishes current chart key from original key, instructs zero transposition', () => {
  const { buildWorkersAiMetadataPrompt } = require(path.join(webDir, 'functions/api/songbook/metadata.ts'))

  const prompt = buildWorkersAiMetadataPrompt('Go', 'Hillsong United', 'G', {
    tempo: '130 BPM',
    timeSignature: '4/4',
    year: '2011',
  })

  // System prompt requirements
  assert.ok(prompt.system.includes('metadata suggestion assistant'), 'System prompt identifies as metadata suggestion assistant')
  assert.ok(prompt.system.includes('Do not alter chord charts'), 'System prompt prohibits chord chart alterations')
  assert.ok(prompt.system.includes('Do not transpose anything'), 'System prompt prohibits transposition')

  // User prompt requirements
  assert.ok(prompt.user.includes('Title: "Go"'), 'User prompt contains Title')
  assert.ok(prompt.user.includes('Artist: "Hillsong United"'), 'User prompt contains Artist')
  assert.ok(prompt.user.includes('Current Chart Key: "G"'), 'User prompt identifies G as Current Chart Key')
  assert.ok(prompt.user.includes('CURRENT/PERFORMANCE chart key, NOT necessarily the original recording key'), 'User prompt explicitly warns key is performance key')
  assert.ok(prompt.user.includes('Existing Tempo Hint: "130 BPM"'), 'User prompt includes tempo hint')
  assert.ok(prompt.user.includes('Existing Time Signature Hint: "4/4"'), 'User prompt includes time hint')
  assert.ok(prompt.user.includes('Existing Release Year Hint: "2011"'), 'User prompt includes year hint')
  assert.ok(prompt.user.includes('currentKey MUST NOT automatically be reported as originalKey'), 'Prompt forbids equating currentKey to originalKey')
  assert.ok(prompt.user.includes('No Transposition / No Chords: Do not alter chord charts. Do not transpose anything'), 'Prompt re-asserts no transposition')
})

// 4. METADATA PREVIEW UX & SEPARATION OF APPLY METADATA VS TRANSPOSE TO ORIGINAL KEY
test('PREVIEW_UX_AND_TRANSPOSE_SEPARATION: Suggestion Preview provides Requested vs Suggested, Apply Metadata updates metadata without transposing chords', () => {
  const editorSource = fs.readFileSync(path.join(webDir, 'src/components/DesktopEditor.tsx'), 'utf8')
  const { syncCanonicalDirectives } = require(path.join(webDir, 'src/utils/chordProMetadata.ts'))
  const { transposeCanonicalSong } = require(path.join(webDir, 'src/utils/chartKeyAlignment.ts'))

  // DesktopEditor has Preview Modal
  assert.ok(editorSource.includes('data-testid="metadata-lookup-preview-modal"'), 'Must have preview modal')
  assert.ok(editorSource.includes('Metadata Suggestion Preview'), 'Must have suggestion preview title')
  assert.ok(editorSource.includes('Requested'), 'Must show Requested section')
  assert.ok(editorSource.includes('Suggested'), 'Must show Suggested section')
  assert.ok(editorSource.includes('Cancel'), 'Must have Cancel button')
  assert.ok(editorSource.includes('data-testid="apply-metadata-button"'), 'Must have Apply Metadata button')

  // Verify Apply Metadata only mutates metadata directives
  const initialChart = `{title: Go}
{artist: Hillsong United}
{key: G}
{tempo: 130 BPM}
{time: 4/4}
{year: 2011}

[G]Giving it all away`

  // Scenario: AI suggests originalKey "Bb", tempo 130, year 2011
  const updatedDirectivesChart = syncCanonicalDirectives(initialChart, {
    originalKey: 'Bb',
    artist: 'Hillsong United',
    year: '2011',
  })

  // Invariant 1: Key directive remains G
  assert.ok(updatedDirectivesChart.includes('{key: G}'), 'Chart key must remain G after Apply Metadata')
  assert.ok(updatedDirectivesChart.includes('{original_key: Bb}'), 'Chart gets {original_key: Bb}')
  // Invariant 2: Chord symbols remain completely unchanged during Apply Metadata
  assert.ok(updatedDirectivesChart.includes('[G]Giving it all away'), 'Chord symbols must NOT transpose during Apply Metadata')

  // Invariant 3: Transpose to Original Key is separate explicit user action
  const transposedChart = transposeCanonicalSong(updatedDirectivesChart, 'G', 'Bb')
  assert.equal(transposedChart.key, 'Bb')
  assert.ok(transposedChart.rawContent.includes('{key: Bb}'), 'Transposition changes key to Bb')
  assert.ok(transposedChart.rawContent.includes('[Bb]Giving it all away'), 'Chords are transposed only upon explicit transpose action')
})

// 5. FAILURE & AMBIGUITY WORDING
test('FAILURE_UX_WORDING: Displays accurate suggestion-based failure wording without claiming external factual DB search', () => {
  const { validateAndReconcileAiOutput } = require(path.join(webDir, 'functions/api/songbook/metadata.ts'))
  const editorSource = fs.readFileSync(path.join(webDir, 'src/components/DesktopEditor.tsx'), 'utf8')

  // not_found from model returns "No confident metadata suggestion found"
  const notFoundRes = validateAndReconcileAiOutput({
    response: JSON.stringify({ status: 'not_found' }),
  }, 'Obscure Unknown Track')
  assert.equal(notFoundRes.status, 'not_found')
  assert.ok(notFoundRes.error.includes('No confident metadata suggestion found'))

  // DesktopEditor includes the updated user-facing failure string
  assert.ok(editorSource.includes('No confident metadata suggestion found'), 'Editor displays "No confident metadata suggestion found"')
})
