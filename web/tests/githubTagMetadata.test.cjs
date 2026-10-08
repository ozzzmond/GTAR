const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const source = path.resolve(__dirname, '../../.github/release_metadata.cjs')
test('current checkpoint DEV stamps agree before human tagging', () => {
  const root = path.resolve(__dirname, '../..')
  const read = file => fs.readFileSync(path.join(root, file), 'utf8')
  const pkg = JSON.parse(read('web/package.json'))
  const lock = JSON.parse(read('web/package-lock.json'))
  const { parseDevTag } = require(source)
  const parsed = parseDevTag(`v${pkg.version}`)
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)
  assert.equal(/export const GTAR_DEV_VERSION = '([^']+)'/.exec(read('web/src/types/gtar.ts'))?.[1], pkg.version)
  assert.ok(read('web/functions/lib/authCore.ts').includes(`GTAR Server-Authoritative Account & Access Control (v${pkg.version})`))
  if (parsed.suffix) assert.equal(parsed.promotable, false)
})
function fixture(t, version = '1.0.108-dev.9') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-tag-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, '.github')); fs.mkdirSync(path.join(root, 'web'))
  fs.copyFileSync(source, path.join(root, '.github/release_metadata.cjs'))
  fs.writeFileSync(path.join(root, 'web/package.json'), JSON.stringify({ version }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  git('init'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test')
  git('add', '.'); git('commit', '-m', 'fixture')
  const envFile = path.join(root, 'env')
  fs.writeFileSync(envFile, 'EXISTING=preserved\n')
  const run = (...args) => spawnSync(process.execPath, [path.join(root, '.github/release_metadata.cjs'), ...args], {
    cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, GITHUB_ENV: envFile }
  })
  return { root, git, run, envFile }
}
function rejected(f, ...args) {
  const r = f.run(...args)
  assert.notEqual(r.status, 0); assert.equal(r.stdout, '')
  assert.equal(fs.readFileSync(f.envFile, 'utf8'), 'EXISTING=preserved\n')
}
test('canonical numeric and lettered tags, lightweight and annotated, emit exact metadata', t => {
  for (const tag of ['v1.0.108-dev.8', 'v1.0.108-dev.9', 'v1.0.108-dev.9a', 'v1.0.117-dev.1']) {
    for (const annotated of [false, true]) {
      const f = fixture(t, tag.slice(1))
      f.git('tag', ...(annotated ? ['-a', tag, '-m', 'annotated'] : [tag]))
      const r = f.run('--tag', tag)
      assert.equal(r.status, 0, r.stderr)
      const expected = `RELEASE_TAG=${tag}\nRELEASE_TITLE=GTAR ${tag}\nIS_PRERELEASE=true\nIS_PROMOTABLE=${!tag.endsWith('a')}\n`
      assert.equal(r.stdout, expected)
      assert.equal(fs.readFileSync(f.envFile, 'utf8'), 'EXISTING=preserved\n' + expected)
    }
  }
})
test('rejects noncanonical tags and missing/ambiguous arguments without exports', t => {
  const f = fixture(t)
  for (const tag of ['v108-dev.8', 'v1.0.0-dev.1', 'v1.0.108-dev.0', 'v1.0.0108-dev.9', 'v1.0.108-dev.09', 'v1.0.108-dev.9A', 'v1.0.108-dev.9aa', 'web-v1.0.108-dev.9', 'v1.1.117', 'v1.0.108-dev.9\n']) rejected(f, '--tag', tag)
  rejected(f); rejected(f, '--tag'); rejected(f, '--tag', 'v1.0.108-dev.9', '--dev-only')
})
test('rejects missing tag and same-named branch', t => {
  const f = fixture(t)
  rejected(f, '--tag', 'v1.0.108-dev.9')
  f.git('branch', 'v1.0.108-dev.9'); rejected(f, '--tag', 'v1.0.108-dev.9')
})
test('rejects tag on earlier commit and tag pointing to noncommit', t => {
  const f = fixture(t)
  f.git('tag', '-a', 'v1.0.108-dev.9', '-m', 'old')
  fs.writeFileSync(path.join(f.root, 'new'), 'new')
  f.git('add', 'new'); f.git('commit', '-m', 'new HEAD')
  rejected(f, '--tag', 'v1.0.108-dev.9')
  f.git('tag', 'v1.0.108-dev.9a', f.git('rev-parse', 'HEAD:web/package.json'))
  rejected(f, '--tag', 'v1.0.108-dev.9a')
})
test('rejects mismatched and malformed package version without exports', t => {
  const f = fixture(t, '1.0.108-dev.8j')
  f.git('tag', 'v1.0.108-dev.9'); rejected(f, '--tag', 'v1.0.108-dev.9')
  fs.writeFileSync(path.join(f.root, 'web/package.json'), '{')
  rejected(f, '--tag', 'v1.0.108-dev.9')
})
test('preview workflow binds exact tag checkout and validates before npm operations', () => {
  const yaml = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/web-preview.yml'), 'utf8')
  assert.match(yaml, /tags: \['v1\.0\.\*-dev\.\*'\]/)
  assert.match(yaml, /tag:\s+description:[^\n]+\s+required: true\s+type: string/)
  assert.match(yaml, /ref: refs\/tags\/\$\{\{ env.REQUESTED_TAG \}\}/)
  assert.match(yaml, /fetch-depth: 0/)
  assert.match(yaml, /run: node \.github\/release_metadata\.cjs --tag "\$REQUESTED_TAG"/)
  assert.ok(yaml.indexOf('run: node .github/release_metadata.cjs') < yaml.indexOf('run: npm ci'))
  assert.match(yaml, /name: \$\{\{ env.RELEASE_TAG \}\}/)
})
