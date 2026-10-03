const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const { parseDevTag, inspectCheckpoint } = require('../../.github/release_metadata.cjs')
const yaml = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8')
// Execute the approved workflow's actual inline planner in disposable repositories.
const planner = /          node <<'NODE'\n([\s\S]*?)          NODE/.exec(yaml)?.[1]
assert.ok(planner, 'inline planner is present')
function createPlan(dir, tag, expectedSha = '', controllerRef = 'refs/heads/main') {
  const summary = path.join(dir, 'summary.txt'), output = path.join(dir, 'output.txt')
  const r = spawnSync(process.execPath, ['-e', planner], { cwd: dir, encoding: 'utf8', env: {
    ...process.env, DEV_TAG: tag, EXPECTED_SHA: expectedSha, CONTROLLER_REF: controllerRef,
    CONTROLLER_SHA: 'a'.repeat(40), GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output
  } })
  assert.equal(r.status, 0, r.stderr)
  const plan = JSON.parse(r.stdout)
  assert.match(fs.readFileSync(output, 'utf8'), /^ready=false\n/)
  assert.match(fs.readFileSync(summary, 'utf8'), /Web tests\/lint\/build are not claimed as run/)
  fs.rmSync(summary); fs.rmSync(output)
  return plan
}
function fixture(t, tag = 'v1.0.108-dev.9') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-prod-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const files = {
    '.github/release_metadata.cjs': fs.readFileSync(path.join(root, '.github/release_metadata.cjs'), 'utf8'),
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
  const plan = createPlan(f.dir, 'v1.0.108-dev.9', f.sha)
  assert.equal(plan.ready, false); assert.equal(plan.prodTag, 'v1.1.117'); assert.equal(plan.prodBaseline, null)
  for (const message of ['Canonical PROD baseline missing', 'Cloudflare', 'human approval', 'runtime release identity']) assert.ok(plan.blockers.some(b => b.includes(message)))
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
  assert.ok(plan.blockers.some(b => b.includes('dev tip is not exactly')))
  assert.ok(plan.blockers.some(b => b.includes('main must be an ancestor')))
})
test('required full SHA, exact equality and reviewed main controller fail closed', t => {
  const f = fixture(t)
  for (const sha of ['', f.sha.slice(0, 8), 'A'.repeat(40), 'a'.repeat(40)]) {
    assert.ok(createPlan(f.dir, 'v1.0.108-dev.9', sha).blockers.some(b => b.includes('expected_sha')))
  }
  const plan = createPlan(f.dir, 'v1.0.108-dev.9', f.sha, 'refs/heads/dev')
  assert.ok(plan.blockers.some(b => b.includes('Controller must be dispatched from reviewed main')))
  assert.ok(plan.blockers.some(b => b.includes('main already equals checkpoint')))
  assert.equal(createPlan(f.dir, 'invalid', f.sha).ready, false)
  fs.writeFileSync(path.join(f.dir, '.github/release_metadata.cjs'), 'module.exports = {}')
  assert.ok(createPlan(f.dir, 'v1.0.108-dev.9', f.sha).blockers.some(b => b.includes('helper exports are unavailable')))
})
test('latest canonical DEV includes letters; next DEV existence is advisory', t => {
  const f = fixture(t)
  f.git('tag', 'v1.0.108-dev.9a')
  const plan = createPlan(f.dir, 'v1.0.108-dev.9', f.sha)
  assert.equal(plan.latestCanonicalDev, 'v1.0.108-dev.9a')
  assert.ok(plan.blockers.some(b => b.includes('not the latest canonical DEV')))
  f.git('tag', 'v1.0.117-dev.1')
  assert.equal(createPlan(f.dir, 'v1.0.108-dev.9', f.sha).nextDevTagExists, true)
})
test('baseline checks its own tagged package separately from main metadata', t => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.dir, 'web/package.json'), JSON.stringify({ version: '1.1.62' }))
  f.git('add', '.'); f.git('commit', '-m', 'baseline'); f.git('tag', 'v1.1.62')
  f.git('update-ref', 'refs/remotes/origin/main', f.git('rev-parse', 'HEAD'))
  let plan = createPlan(f.dir, 'v1.0.108-dev.9', f.sha)
  assert.equal(plan.baselinePackage, '1.1.62')
  assert.equal(plan.mainPackage, '1.1.62')
  assert.ok(!plan.blockers.some(b => b.includes('own committed package disagree')))
  fs.writeFileSync(path.join(f.dir, 'web/package.json'), JSON.stringify({ version: '1.1.108' }))
  f.git('add', '.'); f.git('commit', '-m', 'main discrepancy')
  f.git('update-ref', 'refs/remotes/origin/main', f.git('rev-parse', 'HEAD'))
  plan = createPlan(f.dir, 'v1.0.108-dev.9', f.sha)
  assert.ok(plan.blockers.some(b => b.includes('conflicts with main package 1.1.108')))
  f.git('tag', 'v1.1.63')
  assert.ok(createPlan(f.dir, 'v1.0.108-dev.9', f.sha).blockers.some(b => b.includes('own committed package disagree')))
})
test('report succeeds only for completed dry planning; real attempt always fails', t => {
  const f = fixture(t)
  const report = /      - name: Report reviewed candidate outcome[\s\S]*?        run: \|\n([\s\S]*)/.exec(yaml)?.[1]
  assert.ok(report)
  for (const [dry, result, status] of [['true', 'success', 0], ['false', 'success', 1], ['true', 'failure', 1]]) {
    const summary = path.join(f.dir, 'summary.txt')
    const r = spawnSync('bash', ['-c', report], { encoding: 'utf8', env: {
      ...process.env, DRY_RUN: dry, PLAN_RESULT: result, READY: 'false',
      VALIDATE_RESULT: 'skipped', GITHUB_STEP_SUMMARY: summary
    } })
    assert.equal(r.status, status, r.stderr)
    assert.match(fs.readFileSync(summary, 'utf8'), /REMOTE_MUTATION:NONE\|PRODUCTION_EXECUTION:DISABLED/)
  }
})
test('release static contract preserves exact source, validation and disabled production', () => {
  assert.match(yaml, /workflow_dispatch:/); assert.doesNotMatch(yaml, /^  (push|pull_request|schedule):/m)
  assert.match(yaml, /expected_sha:\s+description:[^\n]+\s+required: true/)
  assert.match(yaml, /type: boolean\s+default: true/)
  assert.match(yaml, /node-version: '22'/)
  for (const cmd of ['npm ci', 'npm test', 'npm run lint:sync', 'npm run build']) assert.equal(yaml.split(`run: ${cmd}\n`).length - 1, 1)
  assert.match(yaml, /ref: \$\{\{ github.sha \}\}/)
  assert.match(yaml, /ref: \$\{\{ needs.plan.outputs.sha \}\}/)
  assert.match(yaml, /needs: \[plan, validate\]/)
  assert.match(yaml, /Fail closed at the production execution boundary[\s\S]+exit 1/)
  assert.match(yaml, /needs: \[plan, validate, production-boundary\]\s+if: \$\{\{ always\(\) \}\}/)
  const active = yaml.split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n')
  assert.doesNotMatch(active, /contents: write|environment:|git (push|tag|merge|rebase|reset)|--force|upload-artifact|wrangler|release_plan\.cjs|vars\./)
  assert.doesNotMatch(yaml, /v1\\\.0/)
  assert.equal(fs.existsSync(path.join(root, '.github/release_plan.cjs')), false)
  const preview = fs.readFileSync(path.join(root, '.github/workflows/web-preview.yml'), 'utf8')
  assert.doesNotMatch(preview, /\[1-9\]/)
  assert.match(preview, /git check-ref-format/)
})
