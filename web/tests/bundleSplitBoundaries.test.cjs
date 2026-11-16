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

// #536 Slice 3: MIDI is wired in behind its switch. The engine (the only file that touches Web
// MIDI) is reached through one dynamic import() in the loader, so it stays out of the startup
// chunks and is not loaded while MIDI is off. MIDI cannot move Stage yet.
test('MIDI engine is lazy: only the loader imports web/src/midi/engine, and only dynamically', () => {
  const root = path.join(__dirname, '..', 'src')
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [path.join(dir, entry.name)] : [])
  const files = walk(root)
  const midiDir = path.join(root, 'midi') + path.sep
  const rel = file => path.relative(root, file).split(path.sep).join('/')
  const code = file => fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')
  const specifiers = file => [...code(file).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map(match => match[1])
  const resolved = (file, spec) => spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : null
  const midiFiles = files.filter(file => file.startsWith(midiDir))
  assert.deepEqual(midiFiles.map(file => path.basename(file)).sort(),
    ['MidiDialog.tsx', 'MidiHelp.tsx', 'MidiRow.tsx', 'actions.ts', 'engine.ts', 'limits.ts', 'loader.ts', 'mapping.ts', 'message.ts', 'settings.ts'])

  // The engine: one dynamic import in the loader, plus its erased type import. Nothing else, anywhere.
  const enginePath = path.join(midiDir, 'engine')
  const reachesEngine = files.filter(file => specifiers(file).some(spec => resolved(file, spec) === enginePath)).map(rel)
  assert.deepEqual(reachesEngine, ['midi/loader.ts'], 'no app file except the dynamic loader imports web/src/midi/engine')
  const loader = code(path.join(midiDir, 'loader.ts'))
  assert.equal(loader.match(/import\('\.\/engine'\)/g)?.length, 1, 'one dynamic import')
  assert.equal(staticImport(loader, './engine'), false, 'never a static import')
  assert.match(loader, /^import type \{ MidiEngine \} from '\.\/engine'$/m, 'the type import is erased at build')
  assert.deepEqual([...loader.matchAll(/['"]\.\/engine['"]/g)].length, 2)

  // Core reaches MIDI in two places only: the Header (row and dialog) and app start (loader).
  const reaching = Object.fromEntries(files.filter(file => !file.startsWith(midiDir)).map(file =>
    [rel(file), specifiers(file).map(spec => resolved(file, spec)).filter(target => target && (target + path.sep).startsWith(midiDir)).map(target => path.basename(target))]).filter(([, targets]) => targets.length))
  assert.deepEqual(reaching, { 'App.tsx': ['loader'], 'components/Header.tsx': ['MidiRow', 'MidiDialog'] })

  // Web MIDI is touched by the engine alone; the loader only feature-detects it.
  for (const file of midiFiles) {
    const name = path.basename(file), source = code(file)
    if (name !== 'engine.ts') assert.doesNotMatch(source, /requestMIDIAccess\s*\(|onmidimessage|onstatechange|permissions\.query|\bMIDIAccess\b/, `${name} uses no browser MIDI API`)
    if (!['engine.ts', 'loader.ts'].includes(name)) assert.doesNotMatch(source, /requestMIDIAccess|navigator\./, `${name} does not look at the browser`)
    assert.doesNotMatch(source, /sysex|MIDIOutput|\.outputs\b|\.send\(/i, `${name}: no SysEx and no output`)
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML/, `${name}: text only`)
    assert.doesNotMatch(source, /appLogger|console\.|fetch\(|sendBeacon/, `${name}: nothing is logged or sent`)
  }
  const engine = code(path.join(midiDir, 'engine.ts'))
  assert.equal(engine.match(/requestMIDIAccess\(([^)]*)\)/)?.[1], '', 'access is requested with no options')
  assert.deepEqual(specifiers(path.join(midiDir, 'engine.ts')).sort(), ['./loader', './settings'], 'the engine imports its settings constants and loader types only')
  assert.match(engine, /^import type \{[^}]+\} from '\.\/loader'$/m)

  // The Slice 1 logic stays pure: siblings only.
  for (const name of ['actions.ts', 'limits.ts', 'mapping.ts', 'message.ts', 'settings.ts']) {
    const outside = specifiers(path.join(midiDir, name)).filter(spec => !/^\.\/(actions|limits|mapping|message|settings)$/.test(spec))
    assert.deepEqual(outside, [], `${name} imports only its own siblings`)
  }
})

test('MIDI cannot move Stage in this slice: no stageCommands, nothing in StageView, no dispatch', () => {
  const root = path.join(__dirname, '..', 'src')
  const midiDir = path.join(root, 'midi')
  const code = file => fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')
  for (const name of fs.readdirSync(midiDir)) {
    const source = code(path.join(midiDir, name))
    assert.doesNotMatch(source, /stageCommands|runStageCommand|StageView/, `${name} does not reach Stage`)
    if (!['mapping.ts', 'limits.ts', 'settings.ts'].includes(name)) assert.doesNotMatch(source, /from '\.\/(actions|mapping|limits|message)'/, `${name} uses no mapping or dispatch logic yet`)
  }
  for (const file of ['components/StageView.tsx', 'utils/stageCommands.ts', 'components/StageToolRows.tsx', 'stageTools/settings.ts']) {
    assert.doesNotMatch(read(`src/${file}`), /from\s+['"][^'"]*\/midi(\/|['"])|requestMIDIAccess|onmidimessage/, `${file} has no MIDI code`)
  }
  // Nothing is given the engine's message sink, so a received message goes nowhere.
  assert.doesNotMatch(code(path.join(midiDir, 'loader.ts')), /onMessage/)
  assert.equal(read('src/midi/loader.ts').match(/createMidiEngine\(\{ onChange: [^}]+\} \}\)/)?.length, 1, 'the engine is created with a status callback only')
})

test('MIDI settings stay local: the key is not in backups or cloud sync, and headers are untouched', () => {
  assert.doesNotMatch(read('src/utils/backupSettings.ts'), /midi/i)
  for (const file of ['public/_headers', 'functions/lib/securityHeaders.ts']) assert.doesNotMatch(read(file), /\bmidi\b/i, `${file} has no midi entry; the default allowlist (self) applies`)
})
