const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const C = require('../.github/prod_controller.cjs')
const { parseDevTag, inspectCheckpoint, HISTORICAL_TAG_EXCEPTIONS } = require('../.github/release_metadata.cjs')
const { resolveReleaseIdentity, ABANDONED_PROD } = require('../.github/release_identity.cjs')

function createRepoFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-stabilization-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const repo = path.join(dir, 'repo')
  fs.mkdirSync(repo)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim()
  const put = (file, content) => {
    const full = path.join(repo, file)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf8')
  }

  git('init')
  git('config', 'user.name', 'GTAR Release Test')
  git('config', 'user.email', 'release-test@example.com')

  // Copy release controller files
  for (const f of ['prod_controller.cjs', 'release_metadata.cjs', 'release_identity.cjs', 'release_repository.cjs']) {
    put(`.github/${f}`, fs.readFileSync(path.join(root, '.github', f), 'utf8'))
  }

  // Baseline commit (v1.1.130)
  put('web/package.json', JSON.stringify({ name: 'web', version: '1.0.123-dev.7' }))
  put('web/package-lock.json', JSON.stringify({ name: 'web', version: '1.0.123-dev.7', packages: { '': { version: '1.0.123-dev.7' } } }))
  put('web/src/types/gtar.ts', `export const GTAR_APP_VERSION = typeof __GTAR_PROD_VERSION__ === 'string' ? __GTAR_PROD_VERSION__ : '1.1.108';\nexport const GTAR_DEV_VERSION = typeof __GTAR_DEV_VERSION__ === 'string' ? __GTAR_DEV_VERSION__ : '1.0.123-dev.7';\n`)
  put('web/functions/lib/authCore.ts', `// GTAR Server-Authoritative Account & Access Control (v1.0.123-dev.7)`)
  put('web/vite.config.ts', `const { resolveReleaseIdentity } = require('../.github/release_identity.cjs'); export default {}`)
  put('web/wrangler.jsonc', JSON.stringify({
    d1_databases: [{ binding: 'DB', database_name: 'gtar-db-prod', database_id: '11111111-2222-3333-4444-555555555555' }],
    env: {
      production: { d1_databases: [{ binding: 'DB', database_name: 'gtar-db-prod', database_id: '11111111-2222-3333-4444-555555555555' }] },
      preview: { d1_databases: [{ binding: 'DB', database_name: 'gtar-db-dev', database_id: '99999999-8888-7777-6666-555555555555' }] }
    }
  }))
  put('web/migrations/0001_initial.sql', 'CREATE TABLE test (id INT);')

  git('add', '.')
  git('commit', '-m', 'prod baseline v1.1.130')
  const baselineSha = git('rev-parse', 'HEAD')
  git('tag', 'v1.0.123-dev.7')
  git('tag', 'v1.1.130')
  git('branch', '-M', 'main')

  // Create dev branch from baseline and commit checkpoint on dev
  git('checkout', '-b', 'dev')
  put('web/package.json', JSON.stringify({ name: 'web', version: '1.0.130-dev.5' }))
  put('web/package-lock.json', JSON.stringify({ name: 'web', version: '1.0.130-dev.5', packages: { '': { version: '1.0.130-dev.5' } } }))
  put('web/src/types/gtar.ts', `export const GTAR_APP_VERSION = typeof __GTAR_PROD_VERSION__ === 'string' ? __GTAR_PROD_VERSION__ : '1.1.108';\nexport const GTAR_DEV_VERSION = typeof __GTAR_DEV_VERSION__ === 'string' ? __GTAR_DEV_VERSION__ : '1.0.130-dev.5';\n`)
  put('web/functions/lib/authCore.ts', `// GTAR Server-Authoritative Account & Access Control (v1.0.130-dev.5)`)

  git('add', '.')
  git('commit', '-m', 'numeric checkpoint')
  const checkpointSha = git('rev-parse', 'HEAD')
  git('tag', 'v1.0.130-dev.4a')
  git('tag', 'v1.0.130-dev.5')

  // Bare origin
  const remote = path.join(dir, 'origin.git')
  git('init', '--bare', remote)
  git('remote', 'add', 'origin', remote)
  git('push', 'origin', 'main', 'dev', '--tags')
  git('fetch', 'origin')

  // Switch repo HEAD to main
  git('checkout', 'main')

  return { repo, git, put, baselineSha, checkpointSha }
}

test('direct numeric DEV.5 checkpoint inspects and plans despite a lettered tag', t => {
  const f = createRepoFixture(t)
  const checkpoint = inspectCheckpoint(f.repo, 'v1.0.130-dev.5')
  assert.equal(checkpoint.tag, 'v1.0.130-dev.5')
  assert.equal(checkpoint.sha, f.checkpointSha)
  assert.equal(checkpoint.promotable, undefined)
  assert.equal(checkpoint.prodTag, 'v1.1.135')

  const plan = C.plan(f.repo, 'v1.0.130-dev.5', f.checkpointSha, 'refs/heads/main', f.baselineSha)
  assert.equal(plan.tag, 'v1.0.130-dev.5')
  assert.equal(plan.prodTag, 'v1.1.135')
  assert.equal(plan.baseline, 'v1.1.130')
  assert.equal(plan.baselineSha, f.baselineSha)
  assert.equal(plan.sha, f.checkpointSha)
})

test('numeric checkpoint needs no lettered companion', t => {
  const f = createRepoFixture(t)
  f.git('tag', '-d', 'v1.0.130-dev.4a')
  assert.equal(inspectCheckpoint(f.repo, 'v1.0.130-dev.5').sha, f.checkpointSha)
})

test('lettered tag movement cannot affect numeric checkpoint', t => {
  const f = createRepoFixture(t)
  f.git('tag', '-f', 'v1.0.130-dev.4a', f.baselineSha)
  assert.equal(C.plan(f.repo, 'v1.0.130-dev.5', f.checkpointSha, 'refs/heads/main', f.baselineSha).sha, f.checkpointSha)
})

test('numeric checkpoint rejects mismatched auth metadata', t => {
  const f = createRepoFixture(t)
  // Put a mismatched version in authCore
  f.put('web/functions/lib/authCore.ts', `// GTAR Server-Authoritative Account & Access Control (v1.0.130-dev.3c)`)
  f.git('add', 'web/functions/lib/authCore.ts')
  f.git('commit', '-m', 'mismatched auth')
  const badSha = f.git('rev-parse', 'HEAD')
  f.git('tag', '-f', 'v1.0.130-dev.5', badSha)
  assert.throws(
    () => inspectCheckpoint(f.repo, 'v1.0.130-dev.5'),
    /Checkpoint version metadata mismatch/
  )
})

test('existing immutable PROD tags and abandoned release are strictly rejected on collision or reuse', t => {
  const f = createRepoFixture(t)
  // Attempt to plan when target prodTag already exists
  f.git('tag', 'v1.1.135', f.baselineSha)
  assert.throws(
    () => C.plan(f.repo, 'v1.0.130-dev.5', f.checkpointSha, 'refs/heads/main', f.baselineSha),
    /PROD tag collision; never overwrite/
  )

  // Abandoned PROD release cannot be reused
  assert.throws(
    () => C.plan(f.repo, ABANDONED_PROD.sourceTag, ABANDONED_PROD.sha, 'refs/heads/main', f.baselineSha),
    /Abandoned PROD release cannot be reused; new identity required/
  )
})

test('historical legacy tag metadata exceptions remain non-promotable', t => {
  const f = createRepoFixture(t)
  // v1.0.130-dev.2 is in HISTORICAL_TAG_EXCEPTIONS
  const legacy = HISTORICAL_TAG_EXCEPTIONS['v1.0.130-dev.2']
  assert.ok(legacy)
  assert.equal(legacy.promotable, false)
  // Fake the historical commit for test
  f.put('web/package.json', JSON.stringify({ name: 'web', version: legacy.committedVersion }))
  f.put('web/package-lock.json', JSON.stringify({ name: 'web', version: legacy.committedVersion, packages: { '': { version: legacy.committedVersion } } }))
  f.put('web/src/types/gtar.ts', `export const GTAR_APP_VERSION = '1.1.108';\nexport const GTAR_DEV_VERSION = '${legacy.committedVersion}';\n`)
  f.put('web/functions/lib/authCore.ts', `// GTAR Server-Authoritative Account & Access Control (v${legacy.committedVersion})`)
  f.git('add', '.')
  f.git('commit', '-m', 'legacy checkpoint')
  const legacySha = f.git('rev-parse', 'HEAD')
  f.git('tag', 'v1.0.130-dev.2', legacySha)

  // With sha mismatch vs pinned sha
  assert.throws(
    () => inspectCheckpoint(f.repo, 'v1.0.130-dev.2'),
    /Historical tag moved; immutable history required/
  )
})

test('DEV runtime identity contract strictly verifies exact match with controller on main', t => {
  const f = createRepoFixture(t)
  assert.equal(C.runtimeContract(f.repo, f.checkpointSha, true), true)
  assert.equal(C.runtimeContract(f.repo, f.checkpointSha, false), true)

  // If DEV checkpoint has altered release_metadata.cjs
  f.put('.github/release_metadata.cjs', '// altered release metadata')
  f.git('add', '.github/release_metadata.cjs')
  f.git('commit', '-m', 'altered controller')
  const alteredSha = f.git('rev-parse', 'HEAD')
  assert.equal(C.runtimeContract(f.repo, alteredSha, true), false)
})

test('production security gates reject lettered checkpoints, non-ancestor main, and dev drift', t => {
  const f = createRepoFixture(t)
  // Lettered checkpoint is not promotable
  assert.throws(
    () => C.plan(f.repo, 'v1.0.130-dev.4a', f.checkpointSha, 'refs/heads/main', f.baselineSha),
    /Invalid canonical DEV tag/
  )

  // Wrong dispatch ref
  assert.throws(
    () => C.plan(f.repo, 'v1.0.130-dev.5', f.checkpointSha, 'refs/heads/dev', f.baselineSha),
    /Dispatch reviewed main controller only/
  )

  // Dev tip drift
  f.git('update-ref', 'refs/remotes/origin/dev', f.baselineSha)
  assert.throws(
    () => C.plan(f.repo, 'v1.0.130-dev.5', f.checkpointSha, 'refs/heads/main', f.baselineSha),
    /dev tip is not exactly checkpoint/
  )
})

test('historical numeric alias with mismatched committed metadata rejects', () => {
  assert.throws(() => inspectCheckpoint(root, 'v1.0.130-dev.5'), /Checkpoint version metadata mismatch/)
})
