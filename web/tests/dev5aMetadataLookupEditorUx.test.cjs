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

// 1. LOOKUP ENTRY POINT RETIREMENT & MANUAL DETAILS PRESERVATION
test('ENTRY_POINT_PLACEMENT: Primary Lookup Metadata action is retired from editor toolbar while manual Song Details modal is preserved', () => {
  const editorSource = fs.readFileSync(path.join(webDir, 'src/components/DesktopEditor.tsx'), 'utf8')

  // Lookup button removed from editor toolbar per PR #435 QA follow-up
  assert.ok(!editorSource.includes('data-testid="editor-lookup-metadata-button"'), 'DesktopEditor must not have lookup button on main toolbar')
  assert.ok(!editorSource.includes('aria-label="Lookup Metadata"'), 'Toolbar lookup button accessible name removed')

  // Check the Song Details & Metadata modal markup is preserved for manual editing
  const modalSectionMatch = editorSource.match(/\{isMetadataModalOpen && \([\s\S]*?Song Details & Metadata[\s\S]*?Canonical Metadata Inputs/)
  assert.ok(modalSectionMatch, 'Must find Song Details modal markup')
  const modalMarkup = modalSectionMatch[0]
  assert.ok(!modalMarkup.includes('handleLookupMetadata'), 'Song Details modal must NOT contain handleLookupMetadata action')
  assert.ok(!modalMarkup.includes('<span>Lookup Metadata</span>'), 'Song Details modal must NOT contain Lookup Metadata text')
})

// 2. CANONICAL CHORDPRO METADATA EXTRACTION & INPUTS
// 3. PROMPT SEMANTICS: CURRENT KEY VS ORIGINAL KEY & ZERO TRANSPOSE INSTRUCTIONS
// 4. METADATA PREVIEW RETIREMENT & DIRECTIVE SYNCHRONIZATION PRESERVATION
test('PREVIEW_UX_RETIREMENT_AND_DIRECTIVES: Suggestion Preview modal removed from editor while directive sync and transpose are preserved', () => {
  const editorSource = fs.readFileSync(path.join(webDir, 'src/components/DesktopEditor.tsx'), 'utf8')
  const { syncCanonicalDirectives } = require(path.join(webDir, 'src/utils/chordProMetadata.ts'))
  const { transposeCanonicalSong } = require(path.join(webDir, 'src/utils/chartKeyAlignment.ts'))

  // DesktopEditor has Preview Modal removed
  assert.ok(!editorSource.includes('data-testid="metadata-lookup-preview-modal"'), 'Preview modal removed from editor')
  assert.ok(!editorSource.includes('Metadata Suggestion Preview'), 'Suggestion preview title removed from editor')

  // Verify directive synchronization and transposition remain intact
  const initialChart = `{title: Go}
{artist: Hillsong United}
{key: G}
{tempo: 130 BPM}
{time: 4/4}
{year: 2011}

[G]Giving it all away`

  // Scenario: Canonical directives updated with originalKey "Bb", tempo 130, year 2011
  const updatedDirectivesChart = syncCanonicalDirectives(initialChart, {
    originalKey: 'Bb',
    artist: 'Hillsong United',
    year: '2011',
  })

  // Invariant 1: Key directive remains G
  assert.ok(updatedDirectivesChart.includes('{key: G}'), 'Chart key must remain G after sync')
  assert.ok(updatedDirectivesChart.includes('{original_key: Bb}'), 'Chart gets {original_key: Bb}')
  // Invariant 2: Chord symbols remain completely unchanged during sync
  assert.ok(updatedDirectivesChart.includes('[G]Giving it all away'), 'Chord symbols must NOT transpose during directive sync')

  // Invariant 3: Transpose to Original Key is separate explicit user action
  const transposedChart = transposeCanonicalSong(updatedDirectivesChart, 'G', 'Bb')
  assert.equal(transposedChart.key, 'Bb')
  assert.ok(transposedChart.rawContent.includes('{key: Bb}'), 'Transposition changes key to Bb')
  assert.ok(transposedChart.rawContent.includes('[Bb]Giving it all away'), 'Chords are transposed only upon explicit transpose action')
})

// 5. FAILURE & AMBIGUITY WORDING IN BACKEND API
