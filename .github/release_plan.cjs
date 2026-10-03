#!/usr/bin/env node
// Read-only planning. DEV policy lives exclusively in release_metadata.cjs.
const { execFileSync } = require('node:child_process')
const { appendFileSync } = require('node:fs')
const path = require('node:path')
const { parseDevTag, inspectCheckpoint } = require('./release_metadata.cjs')

const unresolved = [
  'Cloudflare: confirm gtar-web production branch, a main-push trigger and an exact-SHA production-only signal with trusted app identity and post-push timestamp. Deployments API currently has no records; preview checks are insufficient. Implement verifier in a reviewed PR.',
  'Human approval: no GitHub environments exist in the audited repository. Select an approval environment and configure required reviewers plus prevent-self-review; implement an evidence-backed protection check before enabling writes.',
  'Runtime identity: exact source retains GTAR_APP_VERSION; decide how a PROD tag supplies release identity separately from DEV source identity, then implement and validate in a reviewed DEV checkpoint.'
]
function createPlan(root, tag, expectedSha = '') {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const blockers = [...unresolved]
  const result = { tag, blockers, ready: false }
  const attempt = (label, fn) => { try { return fn() } catch (e) { blockers.push(`${label}: ${e.message}`); return undefined } }
  const parsed = attempt('DEV policy', () => parseDevTag(tag))
  if (parsed) {
    Object.assign(result, parsed)
    if (!parsed.promotable) blockers.push('Lettered DEV checkpoint is not promotable')
    const checkpoint = attempt('Checkpoint metadata', () => inspectCheckpoint(root, tag))
    if (checkpoint) Object.assign(result, checkpoint)
    else result.sha = attempt('Exact tag', () => git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`))
  }
  if (expectedSha && (!/^[0-9a-f]{7,40}$/.test(expectedSha) || !result.sha?.startsWith(expectedSha))) blockers.push('expected_sha must be a matching lowercase SHA (7–40 hex characters)')
  result.devSha = attempt('dev branch', () => git('rev-parse', '--verify', 'refs/remotes/origin/dev'))
  result.mainSha = attempt('main branch', () => git('rev-parse', '--verify', 'refs/remotes/origin/main'))
  if (result.sha && result.devSha !== result.sha) blockers.push('origin/dev is not exactly the selected checkpoint; review and tag all later work separately')
  if (result.sha && result.mainSha) attempt('main ancestry (separate reviewed reconciliation required; no release-time merge/rebase/reset)', () => git('merge-base', '--is-ancestor', result.mainSha, result.sha))
  const tags = attempt('Tag inventory', () => git('tag', '--list'))?.split('\n') || []
  const prod = tags.filter(t => /^v1\.1\.[1-9]\d*$/.test(t)).map(t => ({ tag: t, patch: Number(t.slice(5)) }))
  if (prod.some(p => !Number.isSafeInteger(p.patch))) blockers.push('Unsafe canonical PROD version arithmetic')
  prod.sort((a, b) => b.patch - a.patch)
  result.prodBaseline = prod[0]?.tag || null
  if (!result.prodBaseline) blockers.push('First production run: canonical v1.1.<patch> baseline missing; establish historical identity separately, never invent one here')
  if (parsed?.promotable) {
    if (prod[0] && parsed.base + parsed.iteration <= prod[0].patch) blockers.push('Computed PROD patch must exceed current canonical PROD patch')
    if (tags.includes(parsed.prodTag)) blockers.push('Computed PROD tag already exists')
    if (result.runtimeProd !== parsed.prodTag.slice(1)) blockers.push(`Runtime PROD constant ${result.runtimeProd || 'unknown'} differs from computed ${parsed.prodTag}; checkpoint will not be mutated`)
  }
  if (result.prodBaseline && result.mainSha) {
    attempt('Canonical PROD baseline ancestry', () => git('merge-base', '--is-ancestor', `refs/tags/${result.prodBaseline}^{commit}`, result.mainSha))
    const mainVersion = attempt('main metadata', () => JSON.parse(git('show', `${result.mainSha}:web/package.json`)).version)
    result.mainVersion = mainVersion
    if (mainVersion !== result.prodBaseline.slice(1)) blockers.push(`Canonical PROD baseline ${result.prodBaseline} does not match main package ${mainVersion}; review existing production history separately`)
  }
  result.ready = blockers.length === 0
  return result
}
function main() {
  const plan = createPlan(path.resolve(__dirname, '..'), process.env.DEV_TAG || '', process.env.EXPECTED_SHA || '')
  const summary = `### GTAR PROD plan (read-only)\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n\nValidation: Node 22; web: npm ci → npm test → npm run lint:sync → npm run build. No deploy artifact.\nNext DEV baseline is report-only: reviewed metadata PR, then later manual tag.\n`
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ready=${plan.ready}\nsha=${plan.sha || ''}\nprod_tag=${plan.prodTag || ''}\nnext_dev_tag=${plan.nextDevTag || ''}\n`)
  process.stdout.write(JSON.stringify(plan, null, 2) + '\n')
  return process.env.DRY_RUN === 'true' || plan.ready ? 0 : 1
}
if (require.main === module) process.exitCode = main()
module.exports = { createPlan, unresolved }
