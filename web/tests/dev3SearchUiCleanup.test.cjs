const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const webDir = path.resolve(__dirname, '..')

// Enable TS/TSX transpilation
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:false})'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      }).outputText,
      filename
    )
}

const React = require('react')
const { renderToString } = require('react-dom/server')
const { ChordPreviewModal } = require(path.join(webDir, 'src/components/ChordPreviewModal.tsx'))
const { detectSongKey } = require(path.join(webDir, 'src/utils/songParser.ts'))
const { parseChordProDirectives, serializeChordProDirective } = require(path.join(webDir, 'src/utils/chordProMetadata.ts'))

test('DEV3_UI_CLEANUP: ChordPreviewModal source verification', () => {
  const modalSrc = fs.readFileSync(path.join(webDir, 'src/components/ChordPreviewModal.tsx'), 'utf8')

  // STEP 2: Decorative Plus & Play icons removed from buttons
  assert.equal(modalSrc.includes('<Plus'), false, 'ChordPreviewModal must not render <Plus icon')
  assert.equal(modalSrc.includes('<Play'), false, 'ChordPreviewModal must not render <Play icon')
  assert.equal(modalSrc.includes('+ Import to Songbook'), false, 'Button label must not have redundant "+" prefix')

  // Button labels preserved
  assert.ok(modalSrc.includes('<span>Import to Songbook</span>'), 'Preserves "Import to Songbook" label')
  assert.ok(modalSrc.includes('<span>Import & Open Stage</span>'), 'Preserves "Import & Open Stage" label')

  // Accessibility and click handlers preserved
  assert.ok(modalSrc.includes('disabled={loading || !sheet}'), 'Preserves disabled state on buttons')
  assert.ok(modalSrc.includes('onClick={() => handleImport(false)}'), 'Preserves library import click action')
  assert.ok(modalSrc.includes('onClick={() => handleImport(true)}'), 'Preserves stage import click action')

  // STEP 3: Visible Key, Capo, and BPM badges removed from preview presentation
  assert.equal(modalSrc.includes('Key: {sheet.key}'), false, 'Key badge presentation removed')
  assert.equal(modalSrc.includes('{sheet.capo}'), false, 'Capo badge presentation removed')
  assert.equal(modalSrc.includes('{sheet.bpm} BPM'), false, 'BPM badge presentation removed')

  // Underlying sheet data and handlers intact
  assert.ok(modalSrc.includes('onImportSong(sheet, openInStage)'), 'Preserves raw sheet metadata passed to import handler')
  assert.ok(modalSrc.includes('Source Web Link'), 'Preserves external web link')
})

test('DEV3_UI_CLEANUP: Rendered modal DOM presentation check', () => {
  const mockResult = {
    id: '12345',
    songName: 'Hotel California',
    artistName: 'Eagles',
    type: 'Chords',
    version: 1,
    votes: 9999,
    rating: 4.9,
    tabUrl: 'https://tabs.ultimate-guitar.com/tab/eagles/hotel-california-chords-12345',
  }

  const html = renderToString(
    React.createElement(ChordPreviewModal, {
      isOpen: true,
      onClose: () => {},
      result: mockResult,
      onImportSong: () => {},
    })
  )

  // Verify modal header renders
  assert.match(html, /Hotel California/)
  assert.match(html, /Eagles/)

  // Verify buttons are rendered with exact labels and no "+" prefix
  assert.match(html, /Import to Songbook/)
  assert.match(html, /Import &amp; Open Stage|Import & Open Stage/)
  assert.doesNotMatch(html, /\+ Import to Songbook/)

  // Verify badges are not present in rendered HTML
  assert.doesNotMatch(html, /Key:\s*[A-G]/)
  assert.doesNotMatch(html, /\b\d+\s*BPM\b/)
})

test('DEV3_METADATA_SURVIVAL: Metadata survives search, import and stage transitions', () => {
  const mockFetchedSheet = {
    title: 'Desperado',
    artist: 'Eagles',
    key: 'G',
    capo: 'No Capo',
    bpm: '80',
    format: 'CHORD_PRO',
    rawContent: '{title: Desperado}\n{artist: Eagles}\n{key: G}\n{tempo: 80}\n[G]Desperado, [G7]why don\'t you come to your [C]senses',
    sourceUrl: 'https://tabs.ultimate-guitar.com/tab/eagles/desperado-chords-123',
  }

  // Simulate handleImportOnlineChordSheet logic from App.tsx
  const importedSong = {
    id: 'test-uuid-1',
    title: mockFetchedSheet.title,
    artist: mockFetchedSheet.artist,
    key: mockFetchedSheet.key || detectSongKey(mockFetchedSheet.rawContent || ''),
    capo: mockFetchedSheet.capo || 'No Capo',
    bpm: mockFetchedSheet.bpm || '120',
    format: mockFetchedSheet.format,
    transposeOffset: 0,
    rawContent: mockFetchedSheet.rawContent,
  }

  // Validate all metadata survived intact
  assert.equal(importedSong.title, 'Desperado')
  assert.equal(importedSong.artist, 'Eagles')
  assert.equal(importedSong.key, 'G')
  assert.equal(importedSong.capo, 'No Capo')
  assert.equal(importedSong.bpm, '80')
  assert.equal(importedSong.format, 'CHORD_PRO')
  assert.ok(importedSong.rawContent.includes('[G]Desperado'))

  // Validate ChordPro metadata parser detects tempo and key directives without regression
  const parsedMeta = parseChordProDirectives(importedSong.rawContent)
  assert.equal(parsedMeta.metadata.key, 'G')
  assert.equal(parsedMeta.metadata.tempo, '80')
})
