const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const E = require('../scripts/gtar1-export.cjs')

test('GTAR PROD v1.2.N maps to GTAR1 v1.0.N and rejects everything else', () => {
  assert.deepEqual(E.mapSourceTag('v1.2.0'), { sourceTag: 'v1.2.0', gtar1Tag: 'v1.0.0', version: '1.0.0' })
  assert.equal(E.mapSourceTag('v1.2.17').gtar1Tag, 'v1.0.17')
  for (const bad of ['v1.1.141', 'v1.2.01', 'v1.2.0-dev.1', 'v1.1.0-dev.1', '1.2.0', 'v1.3.0', '', undefined]) {
    assert.throws(() => E.mapSourceTag(bad), /canonical GTAR PROD tag/, String(bad))
  }
})

test('internal files are excluded and app sources are kept', () => {
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'plan.md', '.github/workflows/release.yml', '.agents/skills/x/SKILL.md', 'docs/release-history.md',
    'tests/a.test.cjs', 'web/tests/a.test.cjs', 'README.md', 'web/.dev.vars', 'web/.env.local', 'web/STAGE_CAST2_P0.md', 'RELEASE_WORKFLOW_README.md']) {
    assert.ok(E.isExcluded(f), f)
  }
  for (const f of ['web/src/App.tsx', 'web/package.json', 'web/vite.config.ts', 'web/public/pwa-192x192.png', 'web/functions/lib/authCore.ts', 'web/migrations/0001.sql']) {
    assert.ok(!E.isExcluded(f), f)
  }
})

test('GTAR build identity is replaced by a GTAR1 shim that never reads .github or tags', () => {
  const source = fs.readFileSync(path.join(__dirname, '../vite.config.ts'), 'utf8')
  const out = E.patchViteConfig(source)
  assert.ok(!out.includes('.github'))
  assert.ok(!out.includes('createRequire'))
  assert.ok(out.includes('gtar1-release.json'))
  assert.ok(out.includes("env.CF_PAGES_BRANCH === 'main'"), 'only main carries a release identity')
  assert.throws(() => E.patchViteConfig('// unrelated'), /needs review/)
})

test('package versions are rewritten in package.json and both lockfile locations', () => {
  const lock = JSON.stringify({ name: 'web', version: '1.0.145-dev.3', packages: { '': { name: 'web', version: '1.0.145-dev.3' }, 'node_modules/x': { version: '9.9.9' } } })
  const parsed = JSON.parse(E.patchPackageVersion(lock, '1.0.0'))
  assert.equal(parsed.version, '1.0.0')
  assert.equal(parsed.packages[''].version, '1.0.0')
  assert.equal(parsed.packages['node_modules/x'].version, '9.9.9')
})

test('secret scan flags keys and tokens and skips binaries', () => {
  assert.equal(E.scanForSecrets('a.txt', Buffer.from('hello')).length, 0)
  assert.equal(E.scanForSecrets('k.pem', Buffer.from('-----BEGIN PRIVATE KEY-----\nabc')).length, 1)
  assert.equal(E.scanForSecrets('t.txt', Buffer.from('ghp_' + 'a'.repeat(36))).length, 1)
  assert.equal(E.scanForSecrets('b.png', Buffer.from([0, 1, 2, 3])).length, 0)
})

test('tag annotation records source tag and full SHA', () => {
  const sha = 'a'.repeat(40)
  assert.equal(E.annotation(E.mapSourceTag('v1.2.0'), sha), `GTAR1 v1.0.0 = GTAR PROD v1.2.0 @ ${sha}`)
})

test('wrangler config is rewritten for GTAR1 and never binds GTAR resources', () => {
  const source = fs.readFileSync(path.join(__dirname, '../wrangler.jsonc'), 'utf8')
  const ids = { prod: '11111111-1111-4111-8111-111111111111', dev: '22222222-2222-4222-8222-222222222222' }
  const out = E.patchWrangler(source, ids)
  const json = JSON.parse(out)
  assert.equal(json.name, 'gtar1')
  assert.deepEqual(json.d1_databases.map(d => [d.database_name, d.database_id]), [['gtar1-db-prod', ids.prod]])
  assert.equal(json.env.preview.d1_databases[0].database_id, ids.dev)
  assert.equal(json.env.production.d1_databases[0].database_id, ids.prod)
  for (const bad of ['gtar-db-', 'gtar-stage-cast2', 'gtar-web', 'durable_objects', 'CAST2_ORIGIN']) assert.ok(!out.includes(bad), bad)
  assert.throws(() => E.patchWrangler(source, { prod: 'nope', dev: ids.dev }), /must be a UUID/)
  assert.throws(() => E.patchWrangler(source.replace('gtar-db-dev', 'other-db'), ids), /unexpected D1 database/)
  assert.throws(() => E.patchWrangler('{ // comment\n}', ids))
})

test('GTAR-only migration helper is excluded and the About repo link points at GTAR1', () => {
  assert.ok(E.isExcluded('web/scripts/migrate-dev-remote.cjs'))
  const pkg = JSON.parse(E.patchPackageVersion(JSON.stringify({ version: '1', scripts: { build: 'x', 'd1:migrate:dev:remote': 'y' } }), '1.0.0'))
  assert.deepEqual(Object.keys(pkg.scripts), ['build'])
  const about = fs.readFileSync(path.join(__dirname, '../src/components/AboutModal.tsx'), 'utf8')
  const out = E.patchAboutModal(about)
  assert.ok(out.includes('href="https://github.com/ozzzmond/GTAR1"') && !out.includes('href="https://github.com/ozzzmond/GTAR"'))
  assert.throws(() => E.patchAboutModal('<a>none</a>'), /needs review/)
})

test('public branding says GTAR1 and Demo, and fails closed when source text drifts', () => {
  const root = path.join(__dirname, '..')
  const files = [...new Set(E.BRANDING.map(r => r.file))]
  for (const f of files) {
    let src = fs.readFileSync(path.join(root, '..', f), 'utf8')
    if (f === 'web/vite.config.ts') src = E.patchViteConfig(src)
    if (f === 'web/src/components/AboutModal.tsx') src = E.patchAboutModal(src)
    const out = E.patchBranding(f, src)
    assert.notEqual(out, src, f)
    assert.throws(() => E.patchBranding(f, 'unrelated'), /branding text/, f)
  }
  const header = E.patchBranding('web/src/components/Header.tsx', fs.readFileSync(path.join(root, 'src/components/Header.tsx'), 'utf8'))
  assert.ok(header.includes('>DEMO</span>') && !header.includes('>DEV</span>'))
  const vite = E.patchBranding('web/vite.config.ts', E.patchViteConfig(fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8')))
  assert.ok(vite.includes("gtar1IsDemo ? 'GTAR1 Demo'") && vite.includes('?? gtar1Release.version'))
})

test('GTAR1 icon assets exist, are transparent PNG/ICO and every icon target is mapped', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  for (const asset of new Set(E.ICONS.map(([, a]) => a))) {
    const buf = fs.readFileSync(path.join(E.ICON_DIR, asset))
    assert.ok(asset.endsWith('.ico') ? buf.readUInt16LE(2) === 1 : buf.subarray(0, 4).equals(png), asset)
  }
  const sizes = { 'gtar1-icon-192.png': 192, 'gtar1-icon-512.png': 512, 'gtar1-icon-180.png': 180, 'gtar1-icon-64.png': 64 }
  for (const [asset, n] of Object.entries(sizes)) {
    const buf = fs.readFileSync(path.join(E.ICON_DIR, asset))
    assert.equal(buf.readUInt32BE(16), n); assert.equal(buf.readUInt32BE(20), n); assert.equal(buf[25], 6, 'RGBA')
  }
  assert.ok(E.ICONS.some(([t]) => t === 'web/public/pwa-prod-512x512.png') && E.ICONS.some(([t]) => t === 'web/src/assets/bebegirl1-transparent.png'))
})

test('demo seed has valid, original-or-public-domain songs and two setlists that resolve', () => {
  const songs = JSON.parse(fs.readFileSync(path.join(E.DEMO_SEED_DIR, 'songs.json'), 'utf8'))
  const setlists = JSON.parse(fs.readFileSync(path.join(E.DEMO_SEED_DIR, 'setlists.json'), 'utf8'))
  assert.ok(songs.length >= 4 && songs.length <= 6)
  assert.equal(setlists.length, 2)
  const ids = new Set(songs.map(s => s.id))
  assert.equal(ids.size, songs.length)
  for (const s of songs) {
    assert.ok(s.title && s.key && s.rawContent.includes(`{title: ${s.title}}`) && s.rawContent.includes(`{key: ${s.key}}`), s.title)
    assert.equal(s.transposeOffset, 0)
  }
  const entries = new Set()
  for (const l of setlists) for (const [i, ref] of l.songs.entries()) {
    assert.ok(ids.has(ref.id), `${l.name}: ${ref.title}`); assert.equal(ref.position, i)
    assert.ok(!entries.has(ref.entryId)); entries.add(ref.entryId)
  }
  assert.ok(fs.readFileSync(path.join(E.DEMO_SEED_DIR, 'LICENSES.md'), 'utf8').includes('Public domain'))
})

test('demo seed is wired through a build flag and fails closed on source drift', () => {
  const lib = "import type { ActiveSongState, WebSetlist } from '../types/gtar'\nexport const DEFAULT_SETLIST: ActiveSongState[] = []\nexport const DEFAULT_SAMPLE_SETLISTS: WebSetlist[] = []\n"
  const out = E.patchDefaultLibrary(lib)
  assert.ok(out.includes("VITE_GTAR1_DEMO === '1' ? GTAR1_DEMO_SONGS : []") && out.includes("from './gtar1DemoSeed'"))
  assert.throws(() => E.patchDefaultLibrary('nothing'), /needs review/)
  assert.throws(() => E.patchViteDemoFlag('nothing'), /needs review/)
  assert.ok(E.patchViteDemoFlag("define: {\n      'import.meta.env.VITE_APP_ENV': JSON.stringify(appEnv),\n}").includes('VITE_GTAR1_DEMO'))
  const mod = E.demoSeedModule()
  assert.ok(mod.includes('export const GTAR1_DEMO_SONGS') && mod.includes('export const GTAR1_DEMO_SETLISTS'))
})

test('demo reset module is generated with a seed-content version and is wired only through the demo gate', () => {
  const mod = E.demoResetModule()
  assert.ok(!mod.includes('__SEED_VERSION__') && /SEED_VERSION = '[0-9a-f]{12}'/.test(mod))
  assert.ok(mod.includes('15 * 60 * 1000') && mod.includes("import.meta.env.VITE_GTAR1_DEMO === '1'") && mod.includes('Reset demo'))
  assert.equal(mod, E.demoResetModule())
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'g1seed-'))
  for (const f of ['songs.json', 'setlists.json', 'gtar1DemoReset.ts.txt']) fs.copyFileSync(path.join(E.DEMO_SEED_DIR, f), path.join(tmp, f))
  fs.writeFileSync(path.join(tmp, 'songs.json'), '[]')
  assert.notEqual(E.demoResetModule(tmp), mod)
  const main = "const App = lazy(() => import('./App.tsx'))"
  const out = E.patchMainDemoReset(main)
  assert.ok(out.includes('await gtar1DemoReady') && out.includes("from './data/gtar1DemoReset'"))
  assert.throws(() => E.patchMainDemoReset('nothing'), /needs review/)
})
