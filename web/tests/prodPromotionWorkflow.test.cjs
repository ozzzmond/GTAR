const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const { parseDevTag, inspectCheckpoint } = require('../../.github/release_metadata.cjs')
const { createPlan } = require('../../.github/release_plan.cjs')
function fixture(t, tag = 'v1.0.108-dev.9') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-prod-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const files = {
    'web/package.json': JSON.stringify({ version: tag.slice(1) }),
    'web/package-lock.json': JSON.stringify({ version: tag.slice(1), packages: { '': { version: tag.slice(1) } } }),
    'web/src/types/gtar.ts': `export const GTAR_DEV_VERSION = '${tag.slice(1)}';\nexport const GTAR_APP_VERSION = '1.1.117';`,
    'web/functions/lib/authCore.ts': `// GTAR Server-Authoritative Account & Access Control (${tag})`
  }
  for (const [file, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), body) }
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim()
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com')
  git('add', '.'); git('commit', '-m', 'fixture'); git('tag', tag)
  const sha = git('rev-parse', 'HEAD')
  git('update-ref', 'refs/remotes/origin/dev', sha); git('update-ref', 'refs/remotes/origin/main', sha)
  return { dir, git, sha }
}
test('one DEV parser computes safe numeric arithmetic and suffix promotability', () => {
  assert.deepEqual(parseDevTag('v1.0.108-dev.9'), { tag: 'v1.0.108-dev.9', base: 108, iteration: 9, suffix: '', promotable: true, prodTag: 'v1.1.117', nextDevTag: 'v1.0.117-dev.1' })
  assert.equal(parseDevTag('v1.0.108-dev.9a').promotable, false)
  for (const tag of ['v1.0.0108-dev.9', 'web-v1.0.108-dev.9', 'v1.0.108-dev.0', 'v1.0.9007199254740991-dev.1', 'v1.0.108-dev.9\n']) assert.throws(() => parseDevTag(tag))
})
test('checkpoint inspection uses committed metadata, ignoring worktree edits', t => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.dir, 'web/package.json'), '{}')
  assert.equal(inspectCheckpoint(f.dir, 'v1.0.108-dev.9').sha, f.sha)
  assert.throws(() => inspectCheckpoint(f.dir, 'v1.0.108-dev.8'))
})
test('each supported checkpoint metadata field fails closed when inconsistent', t => {
  for (const file of ['web/package.json', 'web/package-lock.json', 'web/src/types/gtar.ts', 'web/functions/lib/authCore.ts']) {
    const f = fixture(t)
    const p = path.join(f.dir, file)
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('1.0.108-dev.9', '1.0.108-dev.8j'))
    f.git('add', '.'); f.git('commit', '-m', 'bad metadata'); f.git('tag', '-f', 'v1.0.108-dev.9')
    assert.throws(() => inspectCheckpoint(f.dir, 'v1.0.108-dev.9'), /metadata mismatch/)
  }
})
test('dry plan remains read-only and reports missing baseline and unresolved gates', t => {
  const f = fixture(t)
  const before = f.git('show-ref')
  const plan = createPlan(f.dir, 'v1.0.108-dev.9', f.sha.slice(0, 8))
  assert.equal(plan.ready, false); assert.equal(plan.prodTag, 'v1.1.117'); assert.equal(plan.prodBaseline, null)
  for (const message of ['First production run', 'Cloudflare', 'Human approval', 'Runtime identity']) assert.ok(plan.blockers.some(b => b.includes(message)))
  assert.equal(f.git('show-ref'), before); assert.equal(f.git('status', '--porcelain'), '')
})
test('canonical baseline ignores legacy tags; equal/newer targets block; letters block', t => {
  const f = fixture(t)
  f.git('tag', 'web-v1.1.999'); f.git('tag', 'app-v1.1.999'); f.git('tag', 'v1.1.117')
  const plan = createPlan(f.dir, 'v1.0.108-dev.9', 'deadbee')
  assert.equal(plan.prodBaseline, 'v1.1.117')
  for (const message of ['expected_sha', 'must exceed', 'already exists']) assert.ok(plan.blockers.some(b => b.includes(message)))
  const letter = fixture(t, 'v1.0.108-dev.9a')
  assert.ok(createPlan(letter.dir, 'v1.0.108-dev.9a').blockers.some(b => b.includes('Lettered')))
})
test('later dev commits and divergent main are reported without reconciliation', t => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.dir, 'later'), 'later'); f.git('add', '.'); f.git('commit', '-m', 'later')
  f.git('update-ref', 'refs/remotes/origin/dev', f.git('rev-parse', 'HEAD'))
  f.git('update-ref', 'refs/remotes/origin/main', f.git('rev-parse', 'HEAD'))
  const plan = createPlan(f.dir, 'v1.0.108-dev.9')
  assert.ok(plan.blockers.some(b => b.includes('origin/dev is not exactly')))
  assert.ok(plan.blockers.some(b => b.includes('main ancestry')))
})
test('CLI invalid input: dry run reports successfully; real run exits nonzero; no environment exports', () => {
  for (const dry of ['true', 'false']) {
    const r = spawnSync(process.execPath, [path.join(root, '.github/release_plan.cjs')], { encoding: 'utf8', env: { ...process.env, DEV_TAG: 'invalid', DRY_RUN: dry, GITHUB_ENV: '', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' } })
    assert.equal(r.status, dry === 'true' ? 0 : 1)
    assert.equal(JSON.parse(r.stdout).ready, false)
  }
})
test('release static contract preserves exact source, validation, approval and deploy boundaries', () => {
  const yaml = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8')
  assert.match(yaml, /workflow_dispatch:/); assert.doesNotMatch(yaml, /^  (push|pull_request|schedule):/m)
  assert.match(yaml, /type: boolean\s+default: true/)
  assert.match(yaml, /node-version: '22'/)
  for (const cmd of ['npm ci', 'npm test', 'npm run lint:sync', 'npm run build']) assert.equal(yaml.split(`run: ${cmd}\n`).length - 1, 1)
  assert.match(yaml, /ref: \$\{\{ needs.plan.outputs.sha \}\}/)
  assert.match(yaml, /needs: \[plan, approval\]/)
  assert.match(yaml, /Human approval boundary[\s\S]+exit 1/)
  assert.match(yaml, /git push --atomic origin "\$SHA:refs\/heads\/main" "refs\/tags\/\$PROD_TAG"/)
  assert.doesNotMatch(yaml, /--force|upload-artifact|wrangler|GTAR_CF_SIGNAL_CONFIRMED|git (merge|rebase|reset)|git tag.*NEXT_DEV/)
  assert.doesNotMatch(yaml, /v1\\\.0/)
  assert.match(yaml, /Production deployment verification boundary[\s\S]+exit 1/)
  const preview = fs.readFileSync(path.join(root, '.github/workflows/web-preview.yml'), 'utf8')
  assert.doesNotMatch(preview, /\[1-9\]/)
  assert.match(preview, /git check-ref-format/)
})
