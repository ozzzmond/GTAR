const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { R2_CHECKPOINT: R2, parseDevTag, compareDevTags, parseProdTag, compareProdTags, inspectCheckpoint, verifyStabilizationPair } = require('../../.github/release_metadata.cjs')
const { resolveReleaseIdentity, resolveDevIdentity, CANONICAL_REPOSITORY } = require('../../.github/release_identity.cjs')
const controller = require('../../.github/prod_controller.cjs')
const root = path.resolve(__dirname, '../..')

test('R2 is exactly one provisional tag; historical and subsequent formulas stay distinct', () => {
  for (const [tag, prod, next] of [
    ['v1.0.145-dev.2', 'v1.1.147', 'v1.0.147-dev.1'],
    [R2.tag, 'v1.2.0', 'v1.1.0-dev.1'],
    ['v1.0.145-dev.3a', 'v1.1.148', 'v1.0.148-dev.1'],
    ['v1.0.145-dev.4', 'v1.1.149', 'v1.0.149-dev.1'],
    ['v1.1.0-dev.1', 'v1.2.1', 'v1.1.1-dev.1'],
    ['v1.1.0-dev.2', 'v1.2.2', 'v1.1.2-dev.1'],
    ['v1.1.5-dev.3', 'v1.2.8', 'v1.1.8-dev.1'],
  ]) {
    const p = parseDevTag(tag)
    assert.equal(p.prodTag, prod); assert.equal(p.nextDevTag, next)
    assert.equal(p.promotable, !p.suffix)
  }
  for (const tag of ['v1.1.0-dev.1a', 'v1.1.5-dev.3z']) assert.equal(parseDevTag(tag).promotable, false)
})

test('strict canonical syntax, safe arithmetic, ordering and same-scheme stabilization', () => {
  for (const tag of ['v1.0.0-dev.1', 'v1.1.00-dev.1', 'v1.1.1-dev.01', 'v1.1.0-dev.0',
    'v1.1.-1-dev.1', 'v1.1.0-dev.1A', 'v1.1.0-dev.1aa', 'v1.1.0-dev.1\n',
    'v1.1.0-dev.1\r', 'v1.2.0-dev.1', 'v1.1.9007199254740991-dev.1',
    'v1.1.0-dev.9007199254740992', 'v1.0.9007199254740992-dev.1']) assert.throws(() => parseDevTag(tag), tag)
  assert.equal(parseDevTag('v1.1.0-dev.9007199254740991').prodTag, 'v1.2.9007199254740991')
  const tags = ['v1.0.999-dev.99z', 'v1.1.0-dev.1', 'v1.1.0-dev.1a'].map(parseDevTag)
  assert.deepEqual(tags.sort((a, b) => compareDevTags(b, a)).map(p => p.tag), ['v1.1.0-dev.1a', 'v1.1.0-dev.1', 'v1.0.999-dev.99z'])
  assert.ok(compareProdTags('v1.2.0', 'v1.1.145') > 0)
  assert.ok(compareProdTags('v1.2.1', 'v1.2.0') > 0)
  for (const tag of ['v1.1.0', 'v1.2.00', 'v1.2.0\n', 'v1.2.9007199254740992', 'v1.3.1']) assert.throws(() => parseProdTag(tag))
  const sha = 'a'.repeat(40), git = () => sha
  assert.equal(verifyStabilizationPair(git, 'v1.1.0-dev.2', '1.1.0-dev.1a', sha).companionTag, 'v1.1.0-dev.1a')
  assert.equal(verifyStabilizationPair(git, 'v1.1.5-dev.2', '1.0.5-dev.1a', sha), null)
})

// All branches/tags/pushes below belong only to a disposable local repository.
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-r2-bootstrap-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const repo = path.join(directory, 'work'); fs.mkdirSync(repo)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const put = (file, content) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), content) }
  const helpers = ['.github/release_metadata.cjs', '.github/release_identity.cjs']
  const install = () => { for (const file of helpers) put(file, fs.readFileSync(path.join(root, file), 'utf8')) }
  const stamps = tag => {
    const version = tag.slice(1)
    put('web/package.json', JSON.stringify({ version }))
    put('web/package-lock.json', JSON.stringify({ version, packages: { '': { version } } }))
    put('web/src/types/gtar.ts', `export const GTAR_APP_VERSION = typeof __GTAR_PROD_VERSION__ === 'string' ? __GTAR_PROD_VERSION__ : '0.0.0-unversioned';\nexport const GTAR_DEV_VERSION = '${version}'`)
    put('web/functions/lib/authCore.ts', `// GTAR Server-Authoritative Account & Access Control (${tag})`)
    put('web/vite.config.ts', 'resolveReleaseIdentity')
  }
  const commit = message => { git('add', '.'); git('commit', '-m', message); return git('rev-parse', 'HEAD') }
  git('init', '-b', 'main'); git('config', 'user.name', 'Bootstrap test'); git('config', 'user.email', 'test@example.com')
  install(); stamps('v1.0.143-dev.2')
  for (const file of helpers) put(file, fs.readFileSync(path.join(repo, file), 'utf8') + '\n// Previous reviewed controller bytes.\n')
  const baseline = commit('historical production baseline')
  git('tag', 'v1.0.143-dev.2'); git('tag', 'v1.1.145')
  git('checkout', '-b', 'dev'); install(); stamps(R2.tag)
  const a = commit('A reviewed DEV version implementation')
  git('checkout', 'main'); install()
  const b = commit('B owner-only controller installation')
  assert.equal(git('rev-parse', `${b}:web`), git('rev-parse', `${baseline}:web`))
  git('checkout', 'dev'); git('merge', '--no-ff', 'main', '-m', 'C ancestry-preserving reconciliation')
  const c = git('rev-parse', 'HEAD'); git('tag', R2.tag)
  const remote = path.join(directory, 'remote.git'); git('init', '--bare', remote)
  git('remote', 'add', 'origin', remote); git('push', 'origin', 'main', 'dev', '--tags')
  const plan = (tag = R2.tag, sha = c) => controller.plan(repo, tag, sha, 'refs/heads/main', b)
  const adapter = (...args) => {
    if (args[0] === 'fetch') { assert.equal(args[1], CANONICAL_REPOSITORY); return '' }
    if (args[0] === 'ls-remote') { assert.ok(args.includes(CANONICAL_REPOSITORY)); return git('show-ref', '--tags') }
    return git(...args)
  }
  return { repo, git, put, commit, stamps, install, a, b, c, baseline, plan, adapter }
}

test('A/B/C bootstrap preserves web tree, ancestry and exact trusted helper bytes', t => {
  const f = fixture(t), before = f.git('show-ref')
  f.git('merge-base', '--is-ancestor', f.a, f.c)
  f.git('merge-base', '--is-ancestor', f.b, f.c)
  assert.notEqual(f.b, f.c)
  const p = f.plan()
  assert.equal(p.prodTag, R2.prodTag); assert.equal(p.nextDevTag, R2.nextDevTag)
  assert.equal(p.baseline, 'v1.1.145'); assert.equal(p.mainSha, f.b)
  assert.equal(before, f.git('show-ref'))
  assert.equal(controller.runtimeContract(f.repo, f.c), true)
  assert.equal(controller.runtimeContract(f.repo, f.baseline), false)
  assert.equal(controller.runtimeContract(f.repo, f.baseline, false), true)
})

test('bootstrap B cannot build PROD; C needs atomic PROD identity; validation cannot emit it', t => {
  const f = fixture(t)
  f.git('checkout', '--detach', f.b)
  assert.throws(() => resolveReleaseIdentity(f.repo, { CF_PAGES_BRANCH: 'main', CF_PAGES_COMMIT_SHA: f.b }, f.adapter), /one exact clean DEV/)
  f.git('checkout', 'dev')
  assert.equal(resolveReleaseIdentity(f.repo, { GTAR_VALIDATE_SHA: f.c }, f.adapter), null)
  const env = { CF_PAGES_BRANCH: 'main', CF_PAGES_COMMIT_SHA: f.c }
  assert.throws(() => resolveReleaseIdentity(f.repo, env, f.adapter), /Canonical release tag/)
  f.git('tag', R2.prodTag, f.c)
  assert.deepEqual(resolveReleaseIdentity(f.repo, env, f.adapter), { version: '1.2.0', sourceTag: R2.tag, sha: f.c })
  controller.runtimeProof({ version: '1.2.0', sourceTag: R2.tag, sha: f.c }, f.c, R2.prodTag)
  assert.throws(() => controller.runtimeProof({ version: '1.2.0', sourceTag: 'v1.0.145-dev.2', sha: f.c }, f.c, R2.prodTag))
})

test('R2 rejects wrong checkpoint, SHA drift, moved tag, lettered and duplicate tags', t => {
  const f = fixture(t)
  assert.throws(() => f.plan('v1.0.145-dev.2'))
  assert.throws(() => f.plan(R2.tag, f.a), /Exact tag/)
  f.git('tag', '-f', R2.tag, f.a)
  assert.throws(f.plan, /Exact tag/)
  f.git('tag', '-f', R2.tag, f.c)
  f.git('tag', R2.tag + 'a', f.c)
  assert.throws(() => f.plan(R2.tag + 'a'), /Lettered/)
  assert.throws(f.plan, /latest canonical/)
  assert.throws(() => resolveReleaseIdentity(f.repo, { CF_PAGES_BRANCH: 'main', CF_PAGES_COMMIT_SHA: f.c }, (...args) => {
    if (args[0] === 'ls-remote') return `${'a'.repeat(40)}\trefs/tags/${R2.tag}`
    return f.adapter(...args)
  }), /Canonical release tag/)
  f.git('tag', '-d', R2.tag + 'a'); f.git('tag', 'v1.0.145-dev.4', f.c)
  assert.throws(() => resolveReleaseIdentity(f.repo, { GTAR_VALIDATE_SHA: f.c }, f.adapter), /one exact clean DEV/)
})

test('R2 collision, main already at checkpoint, divergent ancestry and helper drift block', t => {
  const f = fixture(t)
  f.git('tag', R2.prodTag, f.baseline); assert.throws(f.plan, /collision/)
  f.git('tag', '-d', R2.prodTag)
  f.git('update-ref', 'refs/remotes/origin/main', f.c)
  assert.throws(() => controller.plan(f.repo, R2.tag, f.c, 'refs/heads/main', f.c), /already equals/)
  f.git('update-ref', 'refs/remotes/origin/main', f.b)
  f.git('checkout', '--detach', f.a); f.put('unrelated', 'divergent main'); const divergent = f.commit('unreconciled main')
  f.git('update-ref', 'refs/remotes/origin/main', divergent)
  assert.throws(() => controller.plan(f.repo, R2.tag, f.c, 'refs/heads/main', divergent))
  f.git('update-ref', 'refs/remotes/origin/main', f.b); f.git('checkout', 'dev')
  f.put('.github/release_metadata.cjs', '// unreviewed helper')
  const drift = f.commit('helper drift'); f.git('tag', '-f', R2.tag, drift)
  f.git('update-ref', 'refs/remotes/origin/dev', drift)
  assert.throws(() => f.plan(R2.tag, drift), /runtime identity contract/)
})

test('R2 baseline supports new DEV zero and blocks obsolete scheme promotions', t => {
  const f = fixture(t)
  f.git('tag', R2.prodTag, f.c)
  f.git('update-ref', 'refs/remotes/origin/main', f.c)
  f.stamps(R2.nextDevTag); const next = f.commit('post VERIFIED_PROD metadata')
  f.git('tag', R2.nextDevTag, next); f.git('update-ref', 'refs/remotes/origin/dev', next)
  const p = controller.plan(f.repo, R2.nextDevTag, next, 'refs/heads/main', f.c)
  assert.equal(p.baseline, 'v1.2.0'); assert.equal(p.prodTag, 'v1.2.1'); assert.equal(p.nextDevTag, 'v1.1.1-dev.1')
  const identity = resolveDevIdentity(f.repo, {}, f.adapter)
  assert.equal(identity.tag, R2.nextDevTag)
  f.git('tag', 'v1.1.0-dev.1a', next)
  assert.throws(() => controller.plan(f.repo, R2.nextDevTag, next, 'refs/heads/main', f.c), /latest canonical/)
})

test('R2 requires direct stamps rather than a stabilization alias', t => {
  const f = fixture(t)
  f.stamps('v1.0.145-dev.2a'); const alias = f.commit('alias metadata')
  f.git('tag', 'v1.0.145-dev.2a', alias); f.git('tag', '-f', R2.tag, alias)
  assert.throws(() => inspectCheckpoint(f.repo, R2.tag), /R2 checkpoint requires exact/)
})


test('post-R2 baseline rejects an obsolete old-scheme candidate even at the DEV tip', t => {
  const f = fixture(t)
  f.git('tag', R2.prodTag, f.c); f.git('update-ref', 'refs/remotes/origin/main', f.c)
  const oldTag = 'v1.0.145-dev.4'
  f.stamps(oldTag); const sha = f.commit('obsolete scheme')
  f.git('tag', oldTag, sha); f.git('update-ref', 'refs/remotes/origin/dev', sha)
  assert.throws(() => controller.plan(f.repo, oldTag, sha, 'refs/heads/main', f.c), /PROD version must exceed baseline/)
})

test('R2 validates the committed DEV fallback even with tag-derived runtime defines', t => {
  const f = fixture(t)
  f.put('web/src/types/gtar.ts', "export const GTAR_APP_VERSION = typeof __GTAR_PROD_VERSION__ === 'string' ? __GTAR_PROD_VERSION__ : '0.0.0-unversioned';\nexport const GTAR_DEV_VERSION = typeof __GTAR_DEV_VERSION__ === 'string' ? __GTAR_DEV_VERSION__ : '1.0.145-dev.2';")
  const sha = f.commit('wrong fallback'); f.git('tag', '-f', R2.tag, sha)
  assert.throws(() => inspectCheckpoint(f.repo, R2.tag), /R2 checkpoint requires exact/)
})
