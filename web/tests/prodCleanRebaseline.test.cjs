const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const C = require('../../.github/prod_controller.cjs')
const { resolveReleaseIdentity, CANONICAL_REPOSITORY, ABANDONED_PROD } = require('../../.github/release_identity.cjs')
function fixture(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-rebaseline-'))
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim()
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), text) }
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com')
  // Synthetic fixture identity only; no version recommendation or real repository mutation.
  const tag = 'v1.0.500-dev.1', prod = 'v1.1.501'
  put('web/package.json', JSON.stringify({ version: tag.slice(1) }))
  put('web/package-lock.json', JSON.stringify({ version: tag.slice(1), packages: { '': { version: tag.slice(1) } } }))
  put('web/src/types/gtar.ts', `export const GTAR_DEV_VERSION = '${tag.slice(1)}'`)
  put('web/functions/lib/authCore.ts', `// GTAR Server-Authoritative Account & Access Control (${tag})`)
  git('add', '.'); git('commit', '-m', 'synthetic checkpoint'); git('tag', tag)
  const sha = git('rev-parse', 'HEAD'), calls = []
  let remoteProd = false, remoteDev = true, drift = false, unavailable = false
  const adapter = (...args) => {
    calls.push(args)
    if (args[0] === 'remote') throw new Error('Checkout origin must not be consulted')
    if (['fetch', 'ls-remote'].includes(args[0])) {
      assert.ok(args.includes(CANONICAL_REPOSITORY))
      if (unavailable) throw new Error('Canonical GitHub unavailable')
      if (args[0] === 'fetch') return ''
      return [remoteDev && `${drift ? 'a'.repeat(40) : git('rev-parse', 'refs/tags/' + tag)}\trefs/tags/${tag}`,
        remoteProd && `${git('rev-parse', 'refs/tags/' + prod)}\trefs/tags/${prod}`].filter(Boolean).join('\n')
    }
    return git(...args)
  }
  return { repo, git, sha, tag, prod, calls, adapter, publish: () => { git('tag', prod); remoteProd = true },
    alter: change => { if ('remoteDev' in change) remoteDev = change.remoteDev; if ('remoteProd' in change) remoteProd = change.remoteProd; if ('drift' in change) drift = change.drift; if ('unavailable' in change) unavailable = change.unavailable } }
}
test('validation checks canonical exact source before PROD tag exists and emits no PROD identity', t => {
  const f = fixture(t), refs = f.git('show-ref')
  assert.equal(resolveReleaseIdentity(f.repo, { GTAR_VALIDATE_SHA: f.sha }, f.adapter), null)
  assert.equal(f.git('show-ref'), refs)
  for (const sha of ['', f.sha.slice(0, 7), 'a'.repeat(40)]) assert.throws(() => resolveReleaseIdentity(f.repo, { GTAR_VALIDATE_SHA: sha }, f.adapter), /full commit SHA/)
})
test('provider mirror transport works but local, absent and moved remote release tags fail closed', t => {
  const f = fixture(t), env = { CF_PAGES_BRANCH: 'main', CF_PAGES_COMMIT_SHA: f.sha }
  f.git('remote', 'add', 'origin', 'https://provider.invalid/checkout-mirror')
  assert.throws(() => resolveReleaseIdentity(f.repo, env, f.adapter), /release tag missing/)
  f.publish()
  assert.deepEqual(resolveReleaseIdentity(f.repo, env, f.adapter), { version: f.prod.slice(1), sourceTag: f.tag, sha: f.sha })
  const refs = f.git('show-ref')
  for (const change of [{ remoteProd: false }, { remoteDev: false }, { drift: true }, { unavailable: true }]) {
    f.alter(change); assert.throws(() => resolveReleaseIdentity(f.repo, env, f.adapter))
    f.alter({ remoteProd: true, remoteDev: true, drift: false, unavailable: false })
  }
  assert.equal(f.git('show-ref'), refs)
  assert.equal(f.git('remote', 'get-url', 'origin'), 'https://provider.invalid/checkout-mirror')
  assert.ok(f.calls.every(args => !args.includes('--force')))
})
test('annotated DEV/PROD refs bind both canonical objects and peeled commit', t => {
  const f = fixture(t)
  f.git('tag', '-a', f.prod, '-m', 'synthetic annotated production')
  f.alter({ remoteProd: true })
  assert.equal(resolveReleaseIdentity(f.repo, { CF_PAGES_BRANCH: 'main', CF_PAGES_COMMIT_SHA: f.sha }, f.adapter).sha, f.sha)
})
test('DEV and feature previews avoid PROD identity; production debug and validation bypass fail', t => {
  const f = fixture(t)
  for (const branch of ['dev', 'codex/prod-clean-rebaseline-from-dev']) assert.equal(resolveReleaseIdentity(f.repo, { CF_PAGES_BRANCH: branch }, f.adapter), null)
  assert.equal(f.calls.length, 0)
  const env = { CF_PAGES_BRANCH: 'main', CF_PAGES_COMMIT_SHA: f.sha }
  for (const change of [{ VITE_APP_ENV: 'debug' }, { GTAR_BUILD_MODE: 'debug' }, { GTAR_VALIDATE_SHA: f.sha }]) assert.throws(() => resolveReleaseIdentity(f.repo, { ...env, ...change }, f.adapter))
})
test('failed immutable baseline permits reviewed ancestry without deployed recovery and blocks reuse', () => {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  assert.equal(C.abandonedBaseline(root, ABANDONED_PROD.tag, ABANDONED_PROD.sha, git('rev-parse', 'HEAD')), true)
  assert.throws(() => C.abandonedBaseline(root, ABANDONED_PROD.tag, 'a'.repeat(40), git('rev-parse', 'HEAD')), /tag moved/)
  assert.throws(() => C.abandonedBaseline(root, ABANDONED_PROD.tag, ABANDONED_PROD.sha, git('rev-parse', 'HEAD'), () => 'bad'), /tree mismatch/)
  assert.equal(C.abandonedBaseline(root, 'v1.1.999', 'a'.repeat(40), 'b'.repeat(40)), false)
  assert.throws(() => C.plan(root, ABANDONED_PROD.sourceTag, ABANDONED_PROD.sha, 'refs/heads/main', git('rev-parse', 'HEAD')), /new identity required/)
  assert.throws(() => resolveReleaseIdentity(root, { CF_PAGES_BRANCH: 'main', CF_PAGES_COMMIT_SHA: ABANDONED_PROD.sha }, (...args) => {
    if (args.join(' ') === 'rev-parse HEAD') return ABANDONED_PROD.sha
    if (args.join(' ') === 'tag --points-at HEAD') return git('tag', '--points-at', ABANDONED_PROD.sha)
    if (args[0] === 'fetch') return ''
    if (args[0] === 'ls-remote') return [ABANDONED_PROD.sourceTag, ABANDONED_PROD.tag].map(t => `${git('rev-parse', 'refs/tags/' + t)}\trefs/tags/${t}`).join('\n')
    return git(...args)
  }), /Abandoned PROD/)
})
test('release validation explicitly binds build SHA without creating tags or claiming production', () => {
  const yaml = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8')
  assert.match(yaml, /GTAR_VALIDATE_SHA: \$\{\{ needs.plan.outputs.sha \}\}/)
  assert.match(yaml, /ref: \$\{\{ needs.plan.outputs.sha \}\}\s+fetch-depth: 0/)
})
test('future checkpoint plans from abandoned baseline without requiring old deployment or old helper bytes', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-next-baseline-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const repo = path.join(dir, 'work')
  execFileSync('git', ['clone', '--shared', '--no-checkout', root, repo], { stdio: 'pipe' })
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim()
  for (const t of git('tag', '--list').split('\n')) {
    if (/^v1\.1\.[1-9]\d*$/.test(t) && Number(t.slice(5)) > Number(ABANDONED_PROD.tag.slice(5))) git('tag', '-d', t)
  }
  git('checkout', '-b', 'reviewed-main', ABANDONED_PROD.sha)
  git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com')
  for (const file of ['.github/release_identity.cjs', '.github/release_metadata.cjs', 'web/vite.config.ts']) fs.copyFileSync(path.join(root, file), path.join(repo, file))
  git('add', '.'); git('commit', '-m', 'reviewed synthetic rebaseline')
  const main = git('rev-parse', 'HEAD')
  git('update-ref', 'refs/remotes/origin/main', main)
  const tag = 'v1.0.500-dev.1'
  for (const file of ['web/package.json', 'web/package-lock.json', 'web/src/types/gtar.ts', 'web/functions/lib/authCore.ts']) {
    const p = path.join(repo, file)
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll(ABANDONED_PROD.sourceTag.slice(1), tag.slice(1)))
  }
  git('add', '.'); git('commit', '-m', 'synthetic future checkpoint'); git('tag', tag)
  const sha = git('rev-parse', 'HEAD'); git('update-ref', 'refs/remotes/origin/dev', sha)
  const before = git('show-ref'), plan = C.plan(repo, tag, sha, 'refs/heads/main', main)
  assert.equal(plan.baseline, ABANDONED_PROD.tag)
  assert.equal(plan.baselineSha, ABANDONED_PROD.sha)
  assert.equal(plan.sha, sha)
  assert.equal(git('show-ref'), before)
  git('update-ref', 'refs/remotes/origin/dev', main)
  assert.throws(() => C.plan(repo, tag, sha, 'refs/heads/main', main), /dev tip/)
})
