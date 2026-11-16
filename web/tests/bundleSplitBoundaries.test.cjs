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

// #536 Slice 1: web/src/midi is pure logic that nothing uses yet. Until a later slice wires it
// in behind the MIDI switch, no app file may reach it, so none of it is in any bundle.
test('MIDI logic is not wired in: no app file imports web/src/midi, and it imports no app file', () => {
  const root = path.join(__dirname, '..', 'src')
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [path.join(dir, entry.name)] : [])
  const files = walk(root)
  const midiDir = path.join(root, 'midi') + path.sep
  const specifiers = file => [...fs.readFileSync(file, 'utf8').matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map(match => match[1])
  const midiFiles = files.filter(file => file.startsWith(midiDir))
  assert.deepEqual(midiFiles.map(file => path.basename(file)).sort(), ['actions.ts', 'limits.ts', 'mapping.ts', 'message.ts', 'settings.ts'])
  for (const file of files.filter(file => !file.startsWith(midiDir))) {
    const reaching = specifiers(file).filter(spec => spec.startsWith('.') && (path.resolve(path.dirname(file), spec) + path.sep).startsWith(midiDir))
    assert.deepEqual(reaching, [], `${path.relative(root, file)} must not import web/src/midi (static or dynamic)`)
  }
  for (const file of midiFiles) {
    const outside = specifiers(file).filter(spec => !/^\.\/(actions|limits|mapping|message|settings)$/.test(spec))
    assert.deepEqual(outside, [], `${path.basename(file)} imports only its own siblings`)
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /requestMIDIAccess|onmidimessage|MIDIAccess\b|navigator\./, `${path.basename(file)} uses no browser MIDI API`)
  }
})
