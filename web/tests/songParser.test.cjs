const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
// Compile the actual utilities in memory; no generated files in src.
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText, filename)
}
const { parseGtarSong } = require('../src/utils/songParser.ts')
test('mixed brackets preserve syllables, trailing chords, headers and transpose', () => {
  const song = parseGtarSong('{title: Test}\n(Verse I)\n{Cadd9}Sing [G/B]on{D}\n{soc}\n[Cadd9]Again\n{eoc}', 2)
  assert.equal(song.title, 'Test')
  assert.deepEqual(song.lines.filter(l => l.type === 'SECTION_HEADER').map(l => l.title), ['Verse I', 'Chorus'])
  assert.deepEqual(song.lines.find(l => l.type === 'CHORD_PRO').segments, [
    { chord: 'Dadd9', text: 'Sing ' }, { chord: 'A/C#', text: 'on' }, { chord: 'E', text: '' }
  ])
})
test('two-line columns and standalone curly chords survive parsing', () => {
  const song = parseGtarSong('C     G\nSing along', 2)
  assert.equal(song.lines[0].raw.indexOf('A'), 6)
  assert.equal(song.lines[0].isOverLyric, true)
  assert.deepEqual(parseGtarSong('{Cadd9}').lines[0].chords, ['Cadd9'])
  assert.equal(parseGtarSong('[C]   [G]\nSing along').lines[0].isOverLyric, true)
})

require.extensions['.tsx'] = require.extensions['.ts']
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { SongLineRenderer } = require('../src/components/SongLineRenderer.tsx')
test('stage renders transposed tokens in stacked units at multiple font sizes', () => {
  const song = parseGtarSong('{Cadd9}Sing [G/B]on{D}', 2)
  for (const fontSizePx of [18, 36, 60]) {
    const html = renderToStaticMarkup(React.createElement(SongLineRenderer, { lines: song.lines, fontSizePx }))
    assert.equal((html.match(/data-chord=/g) || []).length, 3)
    assert.ok(html.includes('Dadd9'))
    assert.ok(html.includes('A/C#'))
    assert.ok(!html.includes('{Cadd9}') && !html.includes('[G/B]'))
    assert.ok(!html.includes('>Cadd9<'))
  }
})
