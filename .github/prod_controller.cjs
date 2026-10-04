// Trusted controller code: executed only from the reviewed dispatch SHA.
const { execFileSync, spawnSync } = require('node:child_process')
const { readFileSync, writeFileSync, appendFileSync, mkdirSync } = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { parseDevTag, inspectCheckpoint } = require('./release_metadata.cjs')
const gitAt = root => (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const must = (ok, message) => { if (!ok) throw new Error(message) }

function plan(root, tag, expectedSha, controllerRef, controllerSha) {
  const git = gitAt(root)
  must(controllerRef === 'refs/heads/main', 'Dispatch reviewed main controller only')
  must(/^[0-9a-f]{40}$/.test(expectedSha), 'expected_sha must be full lowercase SHA')
  const parsed = parseDevTag(tag)
  must(parsed.promotable, 'Lettered checkpoint is not promotable')
  const checkpoint = inspectCheckpoint(root, tag)
  must(checkpoint.sha === expectedSha, 'Exact tag must equal expected_sha')
  const devSha = git('rev-parse', 'refs/remotes/origin/dev^{commit}')
  const mainSha = git('rev-parse', 'refs/remotes/origin/main^{commit}')
  must(devSha === expectedSha, 'dev tip is not exactly checkpoint')
  must(mainSha === controllerSha, 'Controller/main changed since dispatch')
  must(mainSha !== expectedSha, 'main already equals checkpoint')
  git('merge-base', '--is-ancestor', mainSha, expectedSha)
  const tags = git('tag', '--list').split('\n').filter(Boolean)
  const devTags = tags.flatMap(t => { try { return [parseDevTag(t)] } catch { return [] } })
    .sort((a, b) => b.base - a.base || b.iteration - a.iteration || b.suffix.localeCompare(a.suffix))
  must(devTags[0]?.tag === tag, 'Not latest canonical DEV (including letters)')
  must(!tags.includes(parsed.prodTag), 'PROD tag collision; never overwrite')
  const prod = tags.filter(t => /^v1\.1\.[1-9]\d*$/.test(t)).sort((a, b) => Number(b.slice(5)) - Number(a.slice(5)))
  must(prod.length && prod.every(t => Number.isSafeInteger(Number(t.slice(5)))), 'Canonical PROD baseline missing/unsafe')
  const baseline = prod[0], baselineSha = git('rev-parse', `refs/tags/${baseline}^{commit}`)
  must(Number(parsed.prodTag.slice(5)) > Number(baseline.slice(5)), 'PROD patch must exceed baseline')
  git('merge-base', '--is-ancestor', baselineSha, mainSha)
  const pkg = sha => JSON.parse(git('show', `${sha}:web/package.json`)).version
  // Legacy PROD uses committed package. Future exact-source PROD uses tag/build identity.
  const derived = sha => {
    const candidates = tags.flatMap(t => { try { const p = inspectCheckpoint(root, t); return p.sha === sha && p.promotable && p.prodTag === baseline ? [p] : [] } catch { return [] } })
    return candidates.length === 1 && runtimeContract(root, sha)
  }
  must(pkg(baselineSha) === baseline.slice(1) || derived(baselineSha), 'Baseline tagged metadata conflicts with release identity')
  must(pkg(mainSha) === baseline.slice(1) || (runtimeContract(root, mainSha) && derived(baselineSha)), 'main package/baseline discrepancy requires reviewed reconciliation')
  must(runtimeContract(root, expectedSha), 'Tag-derived runtime identity contract missing/different from controller')
  return { ...parsed, sha: expectedSha, devSha, mainSha, baseline, baselineSha, controllerSha }
}
function runtimeContract(root, sha) {
  const git = gitAt(root)
  try {
    for (const file of ['.github/release_identity.cjs', '.github/release_metadata.cjs']) {
      if (git('show', `${sha}:${file}`) !== readFileSync(path.join(__dirname, path.basename(file)), 'utf8').trim()) return false
    }
    return git('show', `${sha}:web/vite.config.ts`).includes('resolveReleaseIdentity') &&
      git('show', `${sha}:web/src/types/gtar.ts`).includes('typeof __GTAR_PROD_VERSION__')
  } catch { return false }
}
function approvalContract(env, policies) {
  const reviewers = env.protection_rules?.find(r => r.type === 'required_reviewers')
  // Native environment approval is a separate human action after validation.
  // The sole maintainer may approve their own run; dispatch alone never releases secrets.
  const maintainer = reviewers?.reviewers?.some(r => r.type === 'User' &&
    r.reviewer?.type === 'User' && r.reviewer.login === 'ozzzmond' && r.reviewer.id === 17817198)
  must(env.name === 'gtar-production' && reviewers?.prevent_self_review === false && maintainer && env.can_admins_bypass === false,
    'gtar-production requires maintainer ozzzmond as human reviewer, self approval allowed, no admin bypass')
  must(env.deployment_branch_policy?.custom_branch_policies === true && env.deployment_branch_policy?.protected_branches === false &&
    policies.branch_policies?.length === 1 && policies.branch_policies[0].name === 'main' && policies.branch_policies[0].type === 'branch',
    'Approval environment must allow only main branch')
}
function freezeContract(rulesets) {
  // Server-enforced freeze closes the dev/tag race that a no-op git push cannot CAS.
  for (const [name, target, ref, rules] of [
    ['gtar-release-freeze-dev', 'branch', 'refs/heads/dev', ['update', 'deletion']],
    ['gtar-release-freeze-dev-tags', 'tag', 'refs/tags/v1.0.*', ['creation', 'update', 'deletion']]
  ]) {
    const r = rulesets.find(s => s.name === name)
    must(r?.target === target && r.enforcement === 'active' && Array.isArray(r.bypass_actors) && r.bypass_actors.length === 0 &&
      r.conditions?.ref_name?.include?.includes(ref) && r.conditions.ref_name.exclude?.length === 0 && rules.every(type => r.rules?.some(rule => rule.type === type)),
      `Required server freeze: ${name}; no bypass actors`)
  }
}
function projectContract(p) {
  const c = p.source?.config
  must(p.name === 'gtar-web' && typeof p.id === 'string' && p.id && p.production_branch === 'main' && p.source?.type === 'github' &&
    c?.owner === 'ozzzmond' && c.repo_name === 'GTAR' && c.production_branch === 'main' && c.production_deployments_enabled === true,
    'Cloudflare gtar-web must use ozzzmond/GTAR Git integration with main production enabled')
}
function deploymentProof(p, d, sha, after) {
  projectContract(p)
  const m = d.deployment_trigger?.metadata
  must(d.project_name === p.name && d.project_id === p.id && d.environment === 'production' &&
    d.source?.type === 'github' && d.source.config?.owner === 'ozzzmond' && d.source.config?.repo_name === 'GTAR' &&
    d.deployment_trigger?.type === 'github:push' && m?.branch === 'main' && m.commit_hash === sha && m.commit_dirty === false &&
    d.is_skipped === false && d.latest_stage?.name === 'deploy' && d.latest_stage.status === 'success' &&
    Number.isFinite(Date.parse(d.created_on)) && Date.parse(d.created_on) > Date.parse(after) &&
    p.canonical_deployment?.id === d.id,
    'Insufficient trusted fresh exact-SHA production deployment proof')
  return { deployment: d.id, sha, environment: d.environment, project: p.name }
}
async function getJson(url, token, cloudflare = false) {
  must(token, 'Required read/push credential missing')
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000), redirect: 'error' })
  must(response.ok, `Read API HTTP ${response.status}`)
  const data = await response.json()
  if (cloudflare) { must(data.success === true, 'Cloudflare read API unsuccessful'); return data.result }
  return data
}
async function externalGate(e, fetcher = getJson) {
  const base = `https://api.github.com/repos/${e.GITHUB_REPOSITORY}`
  const env = await fetcher(`${base}/environments/gtar-production`, e.APPROVAL_READ_TOKEN)
  const policies = await fetcher(`${base}/environments/gtar-production/deployment-branch-policies`, e.APPROVAL_READ_TOKEN)
  approvalContract(env, policies)
  const list = await fetcher(`${base}/rulesets?includes_parents=true&per_page=100`, e.APPROVAL_READ_TOKEN)
  must(list.length < 100, 'Ruleset pagination requires explicit integration support')
  const freezes = await Promise.all(list.filter(r => r.name.startsWith('gtar-release-freeze-')).map(r => fetcher(`${base}/rulesets/${r.id}`, e.APPROVAL_READ_TOKEN)))
  freezeContract(freezes)
  must(/^[0-9a-f]{32}$/.test(e.CF_ACCOUNT_ID || ''), 'CF_ACCOUNT_ID missing/invalid')
  const cf = `https://api.cloudflare.com/client/v4/accounts/${e.CF_ACCOUNT_ID}/pages/projects/gtar-web`
  const project = await fetcher(cf, e.CF_PAGES_READ_TOKEN, true)
  projectContract(project)
  const protection = createHash('sha256').update(JSON.stringify({ env, policies, freezes: freezes.sort((a, b) => a.id - b.id), project: { id: project.id, name: project.name, production_branch: project.production_branch, source: project.source, build_config: project.build_config } })).digest('hex')
  return { project, cf, protection }
}
function refresh(root) {
  const git = gitAt(root)
  // New, complete tag namespace on every job/recheck. Detect moved/deleted tags via snapshot comparison.
  git('fetch', 'origin', '+refs/heads/dev:refs/remotes/origin/dev', '+refs/heads/main:refs/remotes/origin/main', 'refs/tags/*:refs/tags/*')
}
function inventoryContract(root, refs) {
  const git = gitAt(root)
  const local = git('for-each-ref', '--format=%(objectname) %(refname)', 'refs/tags').split('\n').filter(Boolean)
  const remote = Object.entries(refs).filter(([ref]) => ref.startsWith('refs/tags/'))
  must(local.length === remote.length && local.every(line => { const [sha, ref] = line.split(' '); return refs[ref] === sha }), 'Tag inventory moved/deleted/stale; no rewriting allowed')
}
function freshContract(p, e, refs, protection) {
  must(e.VALIDATED_SHA === p.sha && e.PLANNED_MAIN === p.mainSha && e.PLANNED_PROD === p.prodTag && e.PLANNED_REFS === JSON.stringify(refs) && e.PLANNED_PROTECTION === protection, 'Post-approval state differs from validated plan')
}
function remoteRefs(root) { return gitAt(root)('ls-remote', '--refs', 'origin').split('\n').filter(Boolean).map(line => line.split(/\s+/)).reduce((o, [sha, ref]) => ({ ...o, [ref]: sha }), {}) }
function classify(refs, p) {
  const main = refs['refs/heads/main'], tag = refs[`refs/tags/${p.prodTag}`]
  if (main === p.sha && tag === p.sha) return 'PROD_PROMOTED_BUT_UNVERIFIED'
  if (main === p.mainSha && !tag) return 'NOT_PROMOTED'
  return 'AMBIGUOUS_REFS_MANUAL_REVIEW'
}
function promote(root, p, runner = spawnSync, inspect = remoteRefs) {
  const before = inspect(root)
  must(before['refs/heads/main'] === p.mainSha && before['refs/heads/dev'] === p.sha && !before[`refs/tags/${p.prodTag}`], 'Refs stale before push')
  // pre-push receives server-advertised old SHA; git receive-pack CAS rejects a later race.
  const hooks = path.join(root, '.git', 'promotion-hooks'); mkdirSync(hooks, { recursive: true })
  writeFileSync(path.join(hooks, 'pre-push'), `#!/bin/sh\nsaw_main=0\nsaw_tag=0\nwhile read local_ref local_sha remote_ref remote_sha; do\ncase "$remote_ref" in\nrefs/heads/main) saw_main=1; [ "$remote_sha" = "${p.mainSha}" ] && [ "$local_sha" = "${p.sha}" ] || exit 1 ;;\nrefs/tags/${p.prodTag}) saw_tag=1; [ "$remote_sha" = "${'0'.repeat(40)}" ] && [ "$local_sha" = "${p.sha}" ] || exit 1 ;;\n*) exit 1 ;;\nesac\ndone\n[ "$saw_main" = 1 ] && [ "$saw_tag" = 1 ]\n`, { mode: 0o700 })
  const started = new Date().toISOString()
  const r = runner('git', ['-c', `core.hooksPath=${hooks}`, 'push', '--atomic', 'origin', `${p.sha}:refs/heads/main`, `${p.sha}:refs/tags/${p.prodTag}`], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
  // Always inspect, including transport errors. Never retry, force or roll back.
  let state
  try { state = classify(inspect(root), p) } catch { state = 'AMBIGUOUS_REFS_MANUAL_REVIEW' }
  return { state, started, pushExit: r.status ?? null }
}
function runtimeProof(identity, sha, prodTag) {
  must(identity?.sha === sha && identity.version === prodTag.slice(1) && parseDevTag(identity.sourceTag).prodTag === prodTag && parseDevTag(identity.sourceTag).promotable, 'Deployed runtime release identity mismatch')
}
function emit(values) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''))
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, JSON.stringify(values) + '\n')
  console.log(JSON.stringify(values))
}
async function main(mode, e = process.env) {
  const root = process.cwd()
  if (mode === 'verify') {
    let last = 'No trusted fresh production signal'
    for (let n = 0; n < 40; n++) {
      try {
        const { project, cf } = await externalGate(e)
        const d = project.canonical_deployment
        deploymentProof(project, d || {}, e.EXPECTED_SHA, e.PROMOTION_STARTED)
        const exact = await getJson(`${cf}/deployments/${encodeURIComponent(d.id)}`, e.CF_PAGES_READ_TOKEN, true)
        const proof = deploymentProof(project, exact, e.EXPECTED_SHA, e.PROMOTION_STARTED)
        must(/^https:\/\/[0-9a-f]{8}\.gtar-web\.pages\.dev$/.test(exact.url || ''), 'Noncanonical immutable deployment URL')
        const runtimeResponse = await fetch(`${exact.url}/release.json`, { redirect: 'error', signal: AbortSignal.timeout(20000) })
        must(runtimeResponse.ok, 'Deployed runtime release identity unavailable')
        runtimeProof(await runtimeResponse.json(), e.EXPECTED_SHA, e.PROD_TAG)
        const refs = remoteRefs(root)
        must(refs['refs/heads/main'] === e.EXPECTED_SHA && refs[`refs/tags/${e.PROD_TAG}`] === e.EXPECTED_SHA, 'Production refs changed during verification')
        emit({ state: 'VERIFIED_PROD', ...proof }); return
      } catch (error) { last = error.message }
      if (n < 39) await new Promise(r => setTimeout(r, 15000))
    }
    emit({ state: 'PROD_PROMOTED_BUT_UNVERIFIED', reason: last }); throw new Error(last)
  }
  refresh(root)
  const p = plan(root, e.DEV_TAG, e.EXPECTED_SHA, e.CONTROLLER_REF, e.CONTROLLER_SHA)
  const refs = remoteRefs(root)
  inventoryContract(root, refs)
  const external = await externalGate(e)
  if (mode === 'plan') { emit({ ready: true, sha: p.sha, prod_tag: p.prodTag, main_sha: p.mainSha, next_dev_tag: p.nextDevTag, protection: external.protection, refs: JSON.stringify(refs) }); return }
  must(mode === 'promote', 'Unknown controller command')
  freshContract(p, e, refs, external.protection)
  // Re-read refs after external protection/project reads, immediately before mutation.
  must(JSON.stringify(remoteRefs(root)) === JSON.stringify(refs), 'Remote refs changed during fresh gate')
  emit({ state: 'AMBIGUOUS_REFS_MANUAL_REVIEW', started: new Date().toISOString() })
  const result = promote(root, p)
  emit(result)
  must(result.state === 'PROD_PROMOTED_BUT_UNVERIFIED', result.state)
}
if (require.main === module) main(process.argv[2]).catch(error => { emit({ error: error.message }); process.exitCode = 1 })
module.exports = { plan, runtimeContract, approvalContract, freezeContract, projectContract, deploymentProof, classify, promote, externalGate, runtimeProof, inventoryContract, freshContract, main }
