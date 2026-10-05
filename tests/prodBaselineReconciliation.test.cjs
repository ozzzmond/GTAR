const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const C = require('../.github/prod_controller.cjs')
const metadata = require('../.github/release_metadata.cjs')
const source = fs.readFileSync(path.join(root, '.github/prod_controller.cjs'), 'utf8')
const tag = 'v1.1.62', baseline = 'b7c51af72e63c9e77c3b8f7ee558d4198dd5fa0e'
const anchor = '95408a9234f59fe83bb6d2e85a4d38e73d4d1117', tree = '9558867c347fecbc67d4dfe8b97c549c36d390ef'
const main = 'a'.repeat(40), checkpoint = 'c'.repeat(40), devTag = 'v1.0.108-dev.13'

// Model committed Git reads, not working-tree contents. Unknown reads always fail.
function fixture(change = {}) {
  const calls = []
  const git = (...args) => {
    const cmd = args.join(' '); calls.push(cmd)
    if (change.fail === cmd) throw new Error('Git ancestry/object check failed')
    if (cmd === 'rev-parse refs/remotes/origin/dev^{commit}') return change.devSha || checkpoint
    if (cmd === 'rev-parse refs/remotes/origin/main^{commit}') return main
    if (cmd === 'tag --list') return [change.tag || tag, devTag].join('\n')
    if (cmd === `rev-parse refs/tags/${change.tag || tag}^{commit}`) return change.baseline || baseline
    if (cmd === `rev-parse --verify ${anchor}^{commit}`) return change.anchor || anchor
    if ([`merge-base --is-ancestor ${main} ${checkpoint}`, `merge-base --is-ancestor ${change.baseline || baseline} ${main}`,
      `merge-base --is-ancestor ${baseline} ${anchor}`, `merge-base --is-ancestor ${anchor} ${main}`].includes(cmd)) return ''
    for (const sha of [anchor, main]) {
      const alter = !change.at || change.at === sha
      if (cmd === `rev-parse ${sha}:web`) return alter && change.tree || tree
      if (cmd === `show ${sha}:web/package.json`) return JSON.stringify({ version: alter && change.pkg || '1.1.108' })
      if (cmd === `show ${sha}:web/package-lock.json`) return JSON.stringify({ version: alter && change.lock || '1.1.108', packages: { '': { version: alter && change.lockRoot || '1.1.108' } } })
      if (cmd === `show ${sha}:web/src/types/gtar.ts`) return `export const GTAR_APP_VERSION = '${alter && change.runtime || '1.1.108'}';\nexport const GTAR_DEV_VERSION = '${alter && change.dev || '1.0.106-dev.2'}';`
    }
    if (cmd === `show ${change.baseline || baseline}:web/package.json`) return JSON.stringify({ version: (change.tag || tag).slice(1) })
    if (cmd === `show ${main}:.github/release_identity.cjs`) throw new Error('Legacy main has no runtime identity contract')
    for (const file of ['release_identity.cjs', 'release_metadata.cjs']) {
      if (cmd === `show ${checkpoint}:.github/${file}`) return fs.readFileSync(path.join(root, '.github', file), 'utf8').trim()
    }
    if (cmd === `show ${checkpoint}:web/vite.config.ts`) return change.missingRuntime ? '' : 'resolveReleaseIdentity'
    if (cmd === `show ${checkpoint}:web/src/types/gtar.ts`) return 'typeof __GTAR_PROD_VERSION__'
    throw new Error(`Unexpected Git read: ${cmd}`)
  }
  const module = { exports: {} }
  const sandbox = { module, __dirname: path.join(root, '.github'), process, console, require: name => {
    if (name === './release_identity.cjs') return require('../.github/release_identity.cjs')
    if (name === 'node:child_process') return { execFileSync: (_, args) => git(...args) }
    if (name === './release_metadata.cjs') return { ...metadata, inspectCheckpoint: (_, selected) => ({ ...metadata.parseDevTag(selected), sha: selected === devTag ? checkpoint : baseline }) }
    return require(name)
  } }
  vm.runInNewContext(source, sandbox, { filename: 'prod_controller.cjs' })
  return { git, calls, reconcile: () => C.legacyReconciliation(root, change.tag || tag, change.baseline || baseline, main, git),
    plan: () => module.exports.plan(root, devTag, checkpoint, 'refs/heads/main', main) }
}

test('exact reviewed historical state reconciles without changing canonical PROD identity', () => {
  const f = fixture(), p = f.plan()
  assert.equal(f.reconcile(), true)
  assert.equal(p.baseline, tag); assert.equal(p.baselineSha, baseline)
  assert.equal(p.mainSha, main); assert.equal(p.prodTag, 'v1.1.121')
  assert.ok(f.calls.includes(`merge-base --is-ancestor ${baseline} ${anchor}`))
  assert.ok(f.calls.includes(`merge-base --is-ancestor ${anchor} ${main}`))
})

for (const [name, change, error] of [
  ['canonical tag', { tag: 'v1.1.61' }, /requires reviewed reconciliation/],
  ['canonical SHA', { baseline: 'b'.repeat(40) }, /canonical PROD SHA mismatch/],
  ['reviewed anchor', { anchor: 'd'.repeat(40) }, /reviewed main anchor mismatch/],
  ['missing anchor', { fail: `rev-parse --verify ${anchor}^{commit}` }, /object check failed/],
  ['baseline ancestry', { fail: `merge-base --is-ancestor ${baseline} ${anchor}` }, /ancestry/],
  ['main ancestry', { fail: `merge-base --is-ancestor ${anchor} ${main}` }, /ancestry/],
  ['reviewed anchor Web tree', { at: anchor, tree: 'd'.repeat(40) }, /Web tree mismatch/],
  ['current main Web tree', { at: main, tree: 'd'.repeat(40) }, /Web tree mismatch/],
  ['package version', { pkg: '1.1.109' }, /package\/lock stamps/],
  ['lock version', { lock: '1.1.109' }, /package\/lock stamps/],
  ['lock root version', { lockRoot: '1.1.109' }, /package\/lock stamps/],
  ['runtime PROD stamp', { runtime: '1.1.109' }, /runtime stamps/],
  ['runtime DEV stamp', { dev: '1.0.106-dev.3' }, /runtime stamps/],
  ['current main lock stamp', { at: main, lock: '1.1.109' }, /package\/lock stamps/],
  ['current main runtime stamp', { at: main, runtime: '1.1.109' }, /runtime stamps/]
]) test(`altered ${name} fails closed in the planner`, () => assert.throws(fixture(change).plan, error))

test('new canonical PROD retires reconciliation and normal discrepancy gate remains enforced', () => {
  const f = fixture({ tag: 'v1.1.63' })
  assert.equal(f.reconcile(), false)
  assert.throws(f.plan, /requires reviewed reconciliation/)
  assert.ok(!f.calls.some(cmd => cmd.includes(`${anchor}^{commit}`)))
})

test('reconciliation cannot bypass checkpoint runtime, dev-tip or main-to-checkpoint ancestry gates', () => {
  assert.throws(fixture({ missingRuntime: true }).plan, /runtime identity contract missing/)
  assert.throws(fixture({ devSha: 'd'.repeat(40) }).plan, /dev tip/)
  assert.throws(fixture({ fail: `merge-base --is-ancestor ${main} ${checkpoint}` }).plan, /ancestry/)
})

test('actual reviewed Git history matches all hard-coded pins when history is available', t => {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  try { git('cat-file', '-e', `${anchor}^{commit}`); git('cat-file', '-e', `${baseline}^{commit}`) }
  catch { t.skip('Shallow checkout lacks historical objects; deterministic planner tests still run'); return }
  const before = git('show-ref')
  assert.equal(C.legacyReconciliation(root, tag, baseline, anchor), true)
  assert.equal(git('show-ref'), before)
})
