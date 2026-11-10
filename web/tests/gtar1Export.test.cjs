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
