const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const C = require('../../.github/prod_controller.cjs')
const { parseDevTag, inspectCheckpoint } = require('../../.github/release_metadata.cjs')
const { resolveReleaseIdentity } = require('../../.github/release_identity.cjs')
const yaml = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8').replace(/\r\n/g, '\n')
function fixture(t, tag = 'v1.0.108-dev.11') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-prod-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const repo = path.join(dir, 'work'); fs.mkdirSync(repo)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim()
  const put = (file, data) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), data) }
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com')
  for (const file of ['release_metadata.cjs', 'release_identity.cjs']) put(`.github/${file}`, fs.readFileSync(path.join(root, '.github', file)))
  put('web/package.json', '{"version":"1.1.62"}')
  put('web/vite.config.ts', 'resolveReleaseIdentity')
  put('web/src/types/gtar.ts', 'typeof __GTAR_PROD_VERSION__')
  git('add', '.'); git('commit', '-m', 'baseline controller'); git('tag', 'v1.1.62')
  const mainSha = git('rev-parse', 'HEAD')
  git('branch', 'main', mainSha)
  put('web/package.json', JSON.stringify({ version: tag.slice(1) }))
  put('web/package-lock.json', JSON.stringify({ version: tag.slice(1), packages: { '': { version: tag.slice(1) } } }))
  put('web/src/types/gtar.ts', `export const GTAR_DEV_VERSION = '${tag.slice(1)}';\ntypeof __GTAR_PROD_VERSION__`)
  put('web/functions/lib/authCore.ts', `// GTAR Server-Authoritative Account & Access Control (${tag})`)
  git('add', '.'); git('commit', '-m', 'checkpoint'); git('tag', tag)
  const sha = git('rev-parse', 'HEAD')
  git('branch', 'dev', sha)
  const remote = path.join(dir, 'remote.git'); git('init', '--bare', remote)
  git('remote', 'add', 'origin', remote); git('push', 'origin', 'main', 'dev', '--tags')
  const plan = () => C.plan(repo, tag, sha, 'refs/heads/main', mainSha)
  return { repo, git, put, tag, sha, mainSha, plan, remote }
}
const protectedEnv = () => ({ name: 'gtar-production', can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { type: 'User', login: 'ozzzmond', id: 17817198 } }] }], deployment_branch_policy: { custom_branch_policies: true, protected_branches: false } })
const policies = { branch_policies: [{ name: 'main', type: 'branch' }] }
const project = () => ({ id: 'project-id', name: 'gtar-web', production_branch: 'main', source: { type: 'github', config: { owner: 'ozzzmond', repo_name: 'GTAR', production_branch: 'main', production_deployments_enabled: true } }, canonical_deployment: { id: 'deployment-id' } })
const deployment = sha => ({ id: 'deployment-id', project_id: 'project-id', project_name: 'gtar-web', environment: 'production', source: { type: 'github', config: { owner: 'ozzzmond', repo_name: 'GTAR' } }, deployment_trigger: { type: 'github:push', metadata: { branch: 'main', commit_hash: sha, commit_dirty: false } }, created_on: '2026-10-04T01:01:00Z', is_skipped: false, latest_stage: { name: 'deploy', status: 'success' } })
test('shared parser retains version policy, safe arithmetic, suffix rejection', () => {
  assert.equal(parseDevTag('v1.0.108-dev.10').prodTag, 'v1.1.118')
  assert.equal(parseDevTag('v1.0.108-dev.10a').promotable, false)
  for (const t of ['v1.0.0108-dev.1', 'v1.0.108-dev.0', 'v1.0.9007199254740991-dev.1', 'v1.0.108-dev.1\n']) assert.throws(() => parseDevTag(t))
})
test('valid exact-source plan is read-only and ignores legacy tags', t => {
  const f = fixture(t); f.git('tag', 'app-v1.1.999'); f.git('tag', 'web-v1.1.999')
  const before = f.git('show-ref'); const p = f.plan()
  assert.equal(p.prodTag, 'v1.1.119'); assert.equal(p.baseline, 'v1.1.62')
  assert.equal(before, f.git('show-ref')); assert.equal(f.git('status', '--porcelain'), '')
  f.put('web/package.json', '{}'); assert.equal(inspectCheckpoint(f.repo, f.tag).sha, f.sha)
})
test('each checkpoint metadata field fails closed', t => {
  for (const file of ['web/package.json', 'web/package-lock.json', 'web/src/types/gtar.ts', 'web/functions/lib/authCore.ts']) {
    const f = fixture(t); const body = fs.readFileSync(path.join(f.repo, file), 'utf8').replaceAll(f.tag.slice(1), '1.0.108-dev.10')
    f.put(file, body); f.git('add', '.'); f.git('commit', '-m', 'mismatch'); const bad = f.git('rev-parse', 'HEAD')
    // Disposable test tag only; no production refs ever involved.
    f.git('tag', 'v1.0.108-dev.12', bad)
    assert.throws(() => inspectCheckpoint(f.repo, 'v1.0.108-dev.12'), /metadata mismatch/)
  }
})
test('exact tag, full SHA, dispatch context, dev drift, suffix/latest and collisions fail closed', t => {
  const f = fixture(t)
  for (const sha of ['', 'deadbee', 'A'.repeat(40), 'a'.repeat(40)]) assert.throws(() => C.plan(f.repo, f.tag, sha, 'refs/heads/main', f.mainSha))
  assert.throws(() => C.plan(f.repo, 'missing', f.sha, 'refs/heads/main', f.mainSha))
  assert.throws(() => C.plan(f.repo, f.tag, f.sha, 'refs/heads/dev', f.mainSha))
  assert.throws(() => C.plan(f.repo, f.tag, f.sha, 'refs/heads/main', f.sha), /Controller\/main/)
  f.git('tag', `${f.tag}a`); assert.throws(f.plan, /latest canonical/)
  assert.throws(() => C.plan(f.repo, `${f.tag}a`, f.sha, 'refs/heads/main', f.mainSha), /Lettered/)
  f.git('tag', 'v1.1.119'); assert.throws(f.plan)
  f.git('update-ref', 'refs/remotes/origin/dev', f.mainSha); assert.throws(f.plan, /dev tip/)
})
test('divergent main, baseline discrepancy/missing, higher baseline and missing runtime block', t => {
  const f = fixture(t)
  f.git('update-ref', 'refs/remotes/origin/main', f.sha)
  assert.throws(() => C.plan(f.repo, f.tag, f.sha, 'refs/heads/main', f.sha), /already equals/)
  f.git('checkout', 'main'); f.put('different', 'main-only'); f.git('add', '.'); f.git('commit', '-m', 'diverge')
  const divergent = f.git('rev-parse', 'HEAD'); f.git('update-ref', 'refs/remotes/origin/main', divergent)
  assert.throws(() => C.plan(f.repo, f.tag, f.sha, 'refs/heads/main', divergent))
  const g = fixture(t); g.git('tag', 'v1.1.999'); assert.throws(g.plan, /exceed/)
  const h = fixture(t); h.git('tag', '-d', 'v1.1.62'); assert.throws(h.plan, /baseline missing/)
  const j = fixture(t); j.git('checkout', 'main'); j.put('web/package.json', '{"version":"1.1.108"}'); j.git('add', '.'); j.git('commit', '-m', 'discrepancy')
  const tip = j.git('rev-parse', 'HEAD'); j.git('checkout', 'dev'); j.git('merge', 'main', '-s', 'ours', '-m', 'reviewed ancestry fixture')
  const next = j.git('rev-parse', 'HEAD'); j.git('tag', 'v1.0.108-dev.12'); j.git('update-ref', 'refs/remotes/origin/main', tip); j.git('update-ref', 'refs/remotes/origin/dev', next)
  assert.throws(() => C.plan(j.repo, 'v1.0.108-dev.12', next, 'refs/heads/main', tip))
  assert.equal(C.runtimeContract(f.repo, 'a'.repeat(40)), false)
})
test('solo maintainer can separately approve their own protected run', () => {
  const env = protectedEnv()
  assert.equal(env.protection_rules[0].prevent_self_review, false)
  assert.equal(env.protection_rules[0].reviewers.length, 1)
  C.approvalContract(env, policies)
})
test('solo approval fails closed without the human maintainer, no bypass or exact main policy', () => {
  for (const change of [
    e => { e.name = 'production' },
    e => { e.can_admins_bypass = true },
    e => { delete e.can_admins_bypass },
    e => { e.protection_rules[0].prevent_self_review = true },
    e => { delete e.protection_rules[0].prevent_self_review },
    e => { e.protection_rules = [] },
    e => { e.protection_rules[0].reviewers = [] },
    e => { e.protection_rules[0].reviewers[0].type = 'Team' },
    e => { e.protection_rules[0].reviewers[0].reviewer.type = 'Bot' },
    e => { e.protection_rules[0].reviewers[0].reviewer.login = 'other' },
    e => { e.protection_rules[0].reviewers[0].reviewer.id = 1 },
    e => { e.deployment_branch_policy.custom_branch_policies = false },
    e => { e.deployment_branch_policy.protected_branches = true }
  ]) {
    const env = protectedEnv(); change(env); assert.throws(() => C.approvalContract(env, policies))
  }
  for (const branch_policies of [[], [{ name: '*', type: 'branch' }], [{ name: 'main', type: 'tag' }],
    [{ name: 'dev', type: 'branch' }], [...policies.branch_policies, { name: 'dev', type: 'branch' }]]) {
    assert.throws(() => C.approvalContract(protectedEnv(), { branch_policies }))
  }
})
test('Cloudflare proof rejects preview, generic success, old/short SHA, wrong producer/project and old time', () => {
  const sha = 'a'.repeat(40), after = '2026-10-04T01:00:00Z'
  assert.equal(C.deploymentProof(project(), deployment(sha), sha, after).project, 'gtar-web')
  for (const mutate of [d => { d.environment = 'preview' }, d => { d.deployment_trigger.metadata.commit_hash = sha.slice(0, 7) }, d => { d.deployment_trigger.type = 'ad_hoc' }, d => { d.project_id = 'other' }, d => { d.project_name = 'other' }, d => { d.created_on = after }, d => { d.created_on = 'invalid' }, d => { d.latest_stage.name = 'build' }, d => { d.latest_stage.status = 'failure' }, d => { d.source.type = 'gitlab' }, d => { d.deployment_trigger.metadata.branch = 'dev' }, d => { d.is_skipped = true }, d => { d.deployment_trigger.metadata.commit_dirty = true }]) {
    const d = deployment(sha); mutate(d); assert.throws(() => C.deploymentProof(project(), d, sha, after))
  }
  assert.throws(() => C.deploymentProof(project(), { conclusion: 'success', head_sha: sha }, sha, after))
  const p = project(); p.canonical_deployment.id = 'other'; assert.throws(() => C.deploymentProof(p, deployment(sha), sha, after))
  const q = project(); q.source.config.production_deployments_enabled = false; assert.throws(() => C.projectContract(q))
})
test('atomic non-force promotion preserves exact source tree and never changes dev', t => {
  const f = fixture(t), p = f.plan(), tree = f.git('rev-parse', `${f.sha}^{tree}`)
  const result = C.promote(f.repo, p)
  assert.equal(result.state, 'PROD_PROMOTED_BUT_UNVERIFIED'); assert.equal(result.pushExit, 0)
  const refs = f.git('ls-remote', '--refs', 'origin'); assert.ok(refs.includes(`${f.sha}\trefs/tags/${p.prodTag}`)); assert.ok(refs.includes(`${f.sha}\trefs/heads/main`)); assert.ok(refs.includes(`${f.sha}\trefs/heads/dev`))
  assert.equal(f.git('rev-parse', `${f.sha}^{tree}`), tree)
  assert.throws(() => C.promote(f.repo, p), /stale/)
})
test('lost push response recovers by refs; rejection does not retry; partial/unknown refs require review', t => {
  const f = fixture(t), p = f.plan(); let calls = 0
  const result = C.promote(f.repo, p, (...args) => { calls++; spawnSync(...args); return { status: 1 } })
  assert.equal(calls, 1); assert.equal(result.state, 'PROD_PROMOTED_BUT_UNVERIFIED')
  const g = fixture(t), q = g.plan(); let rejected = 0
  assert.equal(C.promote(g.repo, q, () => { rejected++; return { status: 1 } }).state, 'NOT_PROMOTED'); assert.equal(rejected, 1)
  assert.equal(C.classify({ 'refs/heads/main': q.sha }, q), 'AMBIGUOUS_REFS_MANUAL_REVIEW')
  let reads = 0
  assert.equal(C.promote(g.repo, q, () => ({ status: 1 }), () => { if (++reads === 1) return { 'refs/heads/main': q.mainSha, 'refs/heads/dev': q.sha }; throw new Error('offline') }).state, 'AMBIGUOUS_REFS_MANUAL_REVIEW')
})
test('advertised main race rejects before mutation; unsupported atomic push fails closed', t => {
  const f = fixture(t), p = f.plan()
  const result = C.promote(f.repo, p, (cmd, args, opts) => {
    f.git('--git-dir', f.remote, 'update-ref', 'refs/heads/main', f.sha)
    return spawnSync(cmd, args, opts)
  })
  assert.notEqual(result.pushExit, 0); assert.equal(result.state, 'AMBIGUOUS_REFS_MANUAL_REVIEW')
  assert.ok(!f.git('ls-remote', '--refs', 'origin').includes(`refs/tags/${p.prodTag}`))
  const g = fixture(t); g.git('--git-dir', g.remote, 'config', 'receive.advertiseAtomic', 'false')
  assert.equal(C.promote(g.repo, g.plan()).state, 'NOT_PROMOTED')
})
test('main build identity derives exact DEV and PROD tags without source rewrites', t => {
  const f = fixture(t), env = { CF_PAGES_BRANCH: 'main', CF_PAGES_COMMIT_SHA: f.sha }
  const adapter = (...args) => f.git(...args.map(a => a === 'https://github.com/ozzzmond/GTAR.git' ? 'origin' : a))
  assert.equal(resolveReleaseIdentity(f.repo, { CF_PAGES_BRANCH: 'dev' }), null)
  assert.throws(() => resolveReleaseIdentity(f.repo, env, adapter), /release tag missing/)
  C.promote(f.repo, f.plan())
  const before = f.git('status', '--porcelain')
  assert.deepEqual(resolveReleaseIdentity(f.repo, env, adapter), { version: '1.1.119', sourceTag: f.tag, sha: f.sha })
  assert.equal(f.git('status', '--porcelain'), before)
  assert.throws(() => resolveReleaseIdentity(f.repo, { ...env, CF_PAGES_COMMIT_SHA: 'bad' }, adapter), /full commit/)
  assert.throws(() => resolveReleaseIdentity(f.repo, { ...env, VITE_APP_ENV: 'debug' }, adapter), /debug/)
  f.git('tag', 'v1.0.108-dev.12'); assert.throws(() => resolveReleaseIdentity(f.repo, env, adapter), /one exact clean/)
})
test('readiness needs no retired DEV rulesets; remaining external gates fail closed', async () => {
  const e = { GITHUB_REPOSITORY: 'ozzzmond/GTAR', APPROVAL_READ_TOKEN: 'test', CF_ACCOUNT_ID: 'a'.repeat(32), CF_PAGES_READ_TOKEN: 'test' }
  const calls = []
  const fetcher = async url => {
    calls.push(url)
    if (url.endsWith('/gtar-production')) return protectedEnv()
    if (url.endsWith('/deployment-branch-policies')) return policies
    if (url.startsWith('https://api.cloudflare.com/')) return project()
    throw new Error(`Unexpected API read: ${url}`)
  }
  const ready = await C.externalGate(e, fetcher)
  assert.equal(ready.project.name, 'gtar-web')
  assert.equal(calls.length, 3)
  assert.ok(calls.every(url => !url.includes('/rulesets')))
  await assert.rejects(C.externalGate(e, async () => { throw new Error('403') }), /403/)
  await assert.rejects(C.externalGate({ ...e, CF_ACCOUNT_ID: '' }, fetcher), /CF_ACCOUNT_ID/)
  for (const endpoint of ['/gtar-production', '/deployment-branch-policies', '/pages/projects/gtar-web']) {
    await assert.rejects(C.externalGate(e, async url => url.endsWith(endpoint) ? {} : fetcher(url)))
    await assert.rejects(C.externalGate(e, async url => {
      if (url.endsWith(endpoint)) throw new Error('read unavailable')
      return fetcher(url)
    }), /read unavailable/)
  }
  const p = { sha: 'a'.repeat(40), mainSha: 'b'.repeat(40), prodTag: 'v1.1.119' }, refs = { 'refs/heads/dev': p.sha }
  const validated = { VALIDATED_SHA: p.sha, PLANNED_MAIN: p.mainSha, PLANNED_PROD: p.prodTag, PLANNED_REFS: JSON.stringify(refs), PLANNED_PROTECTION: ready.protection }
  for (const change of [
    (url, data) => { if (url.endsWith('/gtar-production')) data.protection_rules.push({ type: 'wait_timer', wait_timer: 1 }) },
    (url, data) => { if (url.includes('api.cloudflare.com')) data.build_config = { build_command: 'changed' } }
  ]) {
    const fresh = await C.externalGate(e, async url => { const data = structuredClone(await fetcher(url)); change(url, data); return data })
    assert.notEqual(fresh.protection, ready.protection)
    assert.throws(() => C.freshContract(p, validated, refs, fresh.protection), /Post-approval/)
  }
})
test('workflow isolates tested source and protected mutation; fresh recheck, one validation, terminal report', () => {
  const promoteJob = yaml.split('  promote:\n')[1].split('  verify:\n')[0]
  assert.match(promoteJob, /needs: \[plan, validate\]/)
  assert.match(promoteJob, /environment: gtar-production/)
  assert.match(promoteJob, /name: Authorize \$\{\{ needs.plan.outputs.prod_tag \}\} from \$\{\{ needs.plan.outputs.sha \}\}/)
  assert.equal(yaml.split('environment: gtar-production').length - 1, 1)
  assert.equal(yaml.split('secrets.PROD_PUSH_TOKEN').length - 1, 1)
  assert.match(promoteJob, /secrets.PROD_PUSH_TOKEN/)
  assert.doesNotMatch(yaml, /review_pending_deployments|pending_deployments|environment:.*inputs/)
  const readme = fs.readFileSync(path.join(root, 'RELEASE_WORKFLOW_README.md'), 'utf8')
  assert.match(readme, /self-review\*\* unchecked \(`false`\)/)
  assert.match(readme, /Approve and deploy/)
  assert.match(readme, /Dispatch,[\s\S]*are not\napproval/)
  assert.match(yaml, /environment: gtar-production/)
  assert.match(yaml, /ref: \$\{\{ github.sha \}\}/)
  assert.match(yaml, /ref: \$\{\{ needs.plan.outputs.sha \}\}/)
  assert.match(yaml, /VALIDATED_SHA:[\s\S]+PLANNED_REFS:/)
  assert.match(yaml, /token: \$\{\{ secrets.PROD_PUSH_TOKEN \}\}/)
  for (const cmd of ['npm ci', 'npm test', 'npm run lint:sync', 'npm run build']) assert.equal(yaml.split(`run: ${cmd}\n`).length - 1, 1)
  assert.match(yaml, /needs: \[plan, validate, promote, verify\]/)
  assert.doesNotMatch(yaml, /contents: write|wrangler|gradle|\.apk|setup-java|release_metadata\.py/)
  assert.doesNotMatch(yaml, /^  (push|schedule|pull_request):/m)
  const source = fs.readFileSync(path.join(root, '.github/prod_controller.cjs'), 'utf8')
  assert.match(source, /Post-approval state differs/); assert.match(source, /'push', '--atomic'/)
  assert.doesNotMatch(source, /--force|force-with-lease/)
  assert.doesNotMatch(source, /freezeContract|gtar-release-freeze|\/rulesets/)
  assert.doesNotMatch(yaml, /gtar-release-freeze|\/rulesets/)
  assert.match(source, /PROD_PROMOTED_BUT_UNVERIFIED/)
})
test('post approval rejects any validated SHA/main/tag/ref/protection drift', () => {
  const p = { sha: 'a'.repeat(40), mainSha: 'b'.repeat(40), prodTag: 'v1.1.119' }, refs = { 'refs/heads/dev': p.sha }
  const e = { VALIDATED_SHA: p.sha, PLANNED_MAIN: p.mainSha, PLANNED_PROD: p.prodTag, PLANNED_REFS: JSON.stringify(refs), PLANNED_PROTECTION: 'protected' }
  C.freshContract(p, e, refs, 'protected')
  for (const key of Object.keys(e)) assert.throws(() => C.freshContract(p, { ...e, [key]: 'changed' }, refs, 'protected'), /Post-approval/)
})
test('tag inventory rejects deletion/movement without rewriting historical tags', t => {
  const f = fixture(t)
  const refs = Object.fromEntries(f.git('ls-remote', '--refs', 'origin').split('\n').map(line => { const [sha, ref] = line.split(/\s+/); return [ref, sha] }))
  C.inventoryContract(f.repo, refs)
  const missing = { ...refs }; delete missing['refs/tags/v1.1.62']; assert.throws(() => C.inventoryContract(f.repo, missing))
  assert.throws(() => C.inventoryContract(f.repo, { ...refs, 'refs/tags/v1.1.62': f.sha }))
})
test('runtime proof binds deployed artifact version and source tag to exact promoted SHA', () => {
  const sha = 'a'.repeat(40), identity = { sha, version: '1.1.119', sourceTag: 'v1.0.108-dev.11' }
  C.runtimeProof(identity, sha, 'v1.1.119')
  for (const changed of [{ sha: 'b'.repeat(40) }, { version: '1.1.108' }, { sourceTag: 'v1.0.108-dev.11a' }, { sourceTag: 'v1.0.108-dev.10' }]) assert.throws(() => C.runtimeProof({ ...identity, ...changed }, sha, 'v1.1.119'))
})
test('terminal report keeps dry, verified, unverified and ambiguous outcomes distinct', () => {
  const report = yaml.split('      - name: Report actual terminal state')[1].split('        run: |\n')[1]
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-report-'))
  try {
    for (const [dry, planResult, promotion, verify, exit, text] of [
      ['true', 'success', '', '', 0, 'DRY_RUN_READY'], ['false', 'success', 'PROD_PROMOTED_BUT_UNVERIFIED', 'VERIFIED_PROD', 0, 'VERIFIED_PROD'],
      ['false', 'success', 'PROD_PROMOTED_BUT_UNVERIFIED', '', 1, 'PROD_PROMOTED_BUT_UNVERIFIED'], ['false', 'success', 'AMBIGUOUS_REFS_MANUAL_REVIEW', '', 1, 'AMBIGUOUS_REFS_MANUAL_REVIEW'],
      ['false', 'failure', '', '', 1, 'BLOCKED_NOT_PROMOTED']
    ]) {
      const summary = path.join(dir, 'summary'); fs.writeFileSync(summary, '')
      const r = spawnSync('bash', ['-c', report], { env: { ...process.env, GITHUB_STEP_SUMMARY: summary, DRY_RUN: dry, PLAN_RESULT: planResult, PROMOTE_STATE: promotion, VERIFY_STATE: verify } })
      assert.equal(r.status, exit); assert.ok(fs.readFileSync(summary, 'utf8').includes(text))
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
