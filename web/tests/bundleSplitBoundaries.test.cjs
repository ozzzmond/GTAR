// Keeps the #85 code-splitting boundaries from silently regressing: these heavy modules
// must be reached only through dynamic import() so they stay out of the startup chunks.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
// One import statement at a time: may span lines, but never runs into the next import.
const staticImport = (source, spec) => new RegExp(`^import\\s+(?!type\\b)(?:[^'"\\n]|\\n(?!import\\b))*?from\\s+['"]${spec.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}['"]`, 'm').test(source)

test('jsQR loads only when a TV QR scan runs', () => {
  const qr = read('src/utils/stageCast2Qr.ts')
  assert.equal(staticImport(qr, 'jsqr'), false)
  assert.match(qr, /import\('jsqr'\)/)
})

test('ImportDialogModal (ChordSheetJS) is lazy in App', () => {
  const app = read('src/App.tsx')
  assert.equal(staticImport(app, './components/ImportDialogModal'), false)
  assert.match(app, /lazy\(\(\) => import\('\.\/components\/ImportDialogModal'\)/)
  assert.equal(staticImport(read('src/components/ImportDialogModal.tsx'), 'chordsheetjs'), false, 'parser stays behind chordSheetParser')
})

test('chord voicing catalog is lazy in StageView; only its type is imported statically', () => {
  const stage = read('src/components/StageView.tsx')
  assert.equal(staticImport(stage, '../utils/chordDictionary'), false)
  assert.match(stage, /import\('\.\.\/utils\/chordDictionary'\)/)
})
