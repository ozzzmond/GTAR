const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync, execFileSync } = require('node:child_process')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const root = path.resolve(__dirname, '../..')
const webDir = path.resolve(__dirname, '..')

const { parseDevTag, inspectCheckpoint, main: releaseMetadataMain, HISTORICAL_TAG_EXCEPTIONS } = require('../../.github/release_metadata.cjs')
const { resolveReleaseIdentity, resolveDevIdentity } = require('../../.github/release_identity.cjs')

// STEP_6.1: Historical DEV.2 tag metadata mismatch classified accurately
test('STEP_6.1: Historical DEV.2 tag metadata mismatch classified accurately and fails closed for promotion', () => {
  const exception = HISTORICAL_TAG_EXCEPTIONS['v1.0.130-dev.2']
  assert.ok(exception, 'v1.0.130-dev.2 must be in HISTORICAL_TAG_EXCEPTIONS')
  assert.equal(exception.sha, 'd32e8d42781f890f2ecf681ac3131913272b7ae8')
  assert.equal(exception.committedVersion, '1.0.130-dev.2c')
  assert.equal(exception.classification, 'LEGACY_METADATA_MISMATCH')
  assert.equal(exception.promotable, false)

  const checkpoint = inspectCheckpoint(root, 'v1.0.130-dev.2')
  assert.equal(checkpoint.sha, exception.sha)
  assert.equal(checkpoint.promotable, false)
  assert.equal(checkpoint.classification, 'LEGACY_METADATA_MISMATCH')
  assert.equal(checkpoint.tag, 'v1.0.130-dev.2')
})

// STEP_6.2: Exact clean numeric DEV tag identity
test('STEP_6.2: Exact clean numeric DEV tag resolves exact version and promotable state', () => {
  const parsed3 = parseDevTag('v1.0.130-dev.3')
  assert.equal(parsed3.tag, 'v1.0.130-dev.3')
  assert.equal(parsed3.base, 130)
  assert.equal(parsed3.iteration, 3)
  assert.equal(parsed3.suffix, '')
  assert.equal(parsed3.promotable, true)
  assert.equal(parsed3.prodTag, 'v1.1.133')
  assert.equal(parsed3.nextDevTag, 'v1.0.133-dev.1')

  const gitMock = (...args) => {
    const cmd = args.join(' ')
    if (cmd === 'rev-parse HEAD') return '0123456789abcdef0123456789abcdef01234567'
    if (cmd === 'rev-parse --short HEAD') return '0123456'
    if (cmd === 'tag --points-at HEAD') return 'v1.0.130-dev.3'
    return ''
  }
  const identity = resolveDevIdentity(root, {}, gitMock)
  assert.equal(identity.version, '1.0.130-dev.3')
  assert.equal(identity.tag, 'v1.0.130-dev.3')
  assert.equal(identity.isTagged, true)
  assert.equal(identity.promotable, true)
})

// STEP_6.3: Lettered DEV tag identity and non-promotability
test('STEP_6.3: Lettered DEV tag resolves identity but is non-promotable', () => {
  for (const tag of ['v1.0.130-dev.1a', 'v1.0.130-dev.2c', 'v1.0.130-dev.3a']) {
    const parsed = parseDevTag(tag)
    assert.equal(parsed.promotable, false)
    assert.ok(parsed.suffix.length > 0)

    const gitMock = (...args) => {
      const cmd = args.join(' ')
      if (cmd === 'rev-parse HEAD') return 'fedcba9876543210fedcba9876543210fedcba98'
      if (cmd === 'rev-parse --short HEAD') return 'fedcba9'
      if (cmd === 'tag --points-at HEAD') return tag
      return ''
    }
    const identity = resolveDevIdentity(root, {}, gitMock)
    assert.equal(identity.version, tag.slice(1))
    assert.equal(identity.tag, tag)
    assert.equal(identity.isTagged, true)
    assert.equal(identity.promotable, false)
  }
})

// STEP_6.4: Untagged DEV HEAD identity
test('STEP_6.4: Untagged DEV HEAD resolves version with actual short SHA and is not labeled DEV.3', () => {
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const shortSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

  const liveIdentity = resolveDevIdentity(root)
  assert.equal(liveIdentity.version, `untagged-${shortSha}`)
  assert.equal(liveIdentity.shortSha, shortSha)
  assert.equal(liveIdentity.sha, headSha)
  assert.equal(liveIdentity.isTagged, false)
  assert.equal(liveIdentity.tag, null)
  assert.equal(liveIdentity.promotable, false)
  assert.ok(!liveIdentity.version.includes('dev.3'), 'Untagged HEAD must not be labeled as DEV.3')
  assert.ok(!liveIdentity.version.includes('dev.2c'), 'Untagged HEAD must not be labeled as stale DEV.2c')
})

// STEP_6.5: Missing Git metadata fallback
test('STEP_6.5: Missing Git metadata returns deterministic fallback', () => {
  const failingGit = () => { throw new Error('git not found') }
  const fallback = resolveDevIdentity(root, {}, failingGit)
  assert.equal(fallback.version, 'untagged-dev')
  assert.equal(fallback.isTagged, false)
  assert.equal(fallback.tag, null)
  assert.equal(fallback.promotable, false)
})

// STEP_6.6: PROD tag identity and PROD patch arithmetic
test('STEP_6.6: PROD tag identity and arithmetic: v1.0.130-dev.3 -> v1.1.133', () => {
  const p1 = parseDevTag('v1.0.130-dev.1')
  assert.equal(p1.prodTag, 'v1.1.131')
  assert.equal(p1.nextDevTag, 'v1.0.131-dev.1')

  const p2 = parseDevTag('v1.0.130-dev.2')
  assert.equal(p2.prodTag, 'v1.1.132')

  const p3 = parseDevTag('v1.0.130-dev.3')
  assert.equal(p3.prodTag, 'v1.1.133')
  assert.equal(p3.nextDevTag, 'v1.0.133-dev.1')

  assert.throws(() => parseDevTag('v1.0.130-dev.0'))
  assert.throws(() => parseDevTag('v1.0.0130-dev.1'))
  assert.throws(() => parseDevTag('v1.1.130'))
})

// STEP_6.7: Invalid/mismatched tags rejected for promotion
test('STEP_6.7: Invalid or mismatched tags fail closed and are rejected for promotion', () => {
  const C = require('../../.github/prod_controller.cjs')
  assert.throws(() => parseDevTag('invalid-tag'))

  // Historical DEV.2 cannot be promoted because checkpoint.promotable is false
  assert.throws(() => {
    C.plan(root, 'v1.0.130-dev.2', 'd32e8d42781f890f2ecf681ac3131913272b7ae8', 'refs/heads/main', 'a'.repeat(40))
  })
})

// STEP_6.8: Header environment and version label correctness
test('STEP_6.8: Header environment and version label format correctly', () => {
  const formatHeaderVersion = (isDev, devVer, prodVer) => {
    return isDev
      ? (devVer.startsWith('untagged') ? devVer : `v${devVer.replace(/^v/, '')}`)
      : `v${prodVer.replace(/^v/, '')}`
  }

  // Untagged DEV commit format
  assert.equal(formatHeaderVersion(true, 'untagged-0da1f4a', '1.1.130'), 'untagged-0da1f4a')
  // Exact tagged DEV format
  assert.equal(formatHeaderVersion(true, '1.0.130-dev.2', '1.1.130'), 'v1.0.130-dev.2')
  assert.equal(formatHeaderVersion(true, '1.0.130-dev.3', '1.1.130'), 'v1.0.130-dev.3')
  // Fallback DEV format
  assert.equal(formatHeaderVersion(true, 'untagged-dev', '1.1.130'), 'untagged-dev')
  // PROD format
  assert.equal(formatHeaderVersion(false, 'untagged-0da1f4a', '1.1.130'), 'v1.1.130')
  assert.equal(formatHeaderVersion(false, 'untagged-0da1f4a', 'v1.1.133'), 'v1.1.133')
})

// STEP_6.9: Release artifact metadata consistency
test('STEP_6.9: DEV preview workflows do not emit PROD release.json', () => {
  const prodIdentity = resolveReleaseIdentity(root, { CF_PAGES_BRANCH: 'dev' })
  assert.equal(prodIdentity, null, 'DEV preview must not resolve PROD release identity')

  const validationIdentity = resolveReleaseIdentity(root, {})
  assert.equal(validationIdentity, null, 'Untagged dev must not resolve PROD release identity')
})

// STEP_6.10: CLI execution of release_metadata.cjs for historical DEV.2 tag
test('STEP_6.10: CLI execution of release_metadata.cjs classifies historical DEV.2 and rejects unclassified mismatches', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-relmeta-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim()
  const put = (file, data) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), data) }

  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com')
  put('.github/release_metadata.cjs', fs.readFileSync(path.join(root, '.github/release_metadata.cjs'), 'utf8'))
  put('web/package.json', JSON.stringify({ version: '1.0.130-dev.2c' }))
  git('add', '.'); git('commit', '-m', 'fixture')

  // Normal tag with mismatched package version must fail closed
  git('tag', 'v1.0.130-dev.4')
  const rejected = spawnSync(process.execPath, [path.join(repo, '.github/release_metadata.cjs'), '--tag', 'v1.0.130-dev.4'], {
    cwd: repo, encoding: 'utf8'
  })
  assert.notEqual(rejected.status, 0)
  assert.ok(rejected.stderr.includes('web/package.json version must equal tag without leading v'))

  // Historical tag whose commit moved must fail closed
  git('tag', 'v1.0.130-dev.2')
  const movedHistorical = spawnSync(process.execPath, [path.join(repo, '.github/release_metadata.cjs'), '--tag', 'v1.0.130-dev.2'], {
    cwd: repo, encoding: 'utf8'
  })
  assert.notEqual(movedHistorical.status, 0)
  assert.ok(movedHistorical.stderr.includes('Historical tag moved; immutable history required'))
})

// STEP_6.11: Future clean DEV.3 tag passes checkpoint validation with tag-derived runtime identity
test('STEP_6.11: Future clean DEV.3 tag passes inspectCheckpoint and CLI release_metadata with IS_PROMOTABLE=true', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-dev3-pass-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim()
  const put = (file, data) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), data) }

  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com')
  put('.github/release_metadata.cjs', fs.readFileSync(path.join(root, '.github/release_metadata.cjs'), 'utf8'))
  put('web/package.json', JSON.stringify({ version: '1.0.130-dev.3' }))
  put('web/package-lock.json', JSON.stringify({ version: '1.0.130-dev.3', packages: { '': { version: '1.0.130-dev.3' } } }))
  put('web/src/types/gtar.ts', fs.readFileSync(path.join(root, 'web/src/types/gtar.ts'), 'utf8'))
  put('web/functions/lib/authCore.ts', '/**\n * GTAR Server-Authoritative Account & Access Control (v1.0.130-dev.3)\n */\n')
  git('add', '.'); git('commit', '-m', 'future dev.3 commit')
  const headSha = git('rev-parse', 'HEAD')

  git('tag', 'v1.0.130-dev.3')

  // CLI execution succeeds
  const cli = spawnSync(process.execPath, [path.join(repo, '.github/release_metadata.cjs'), '--tag', 'v1.0.130-dev.3'], {
    cwd: repo, encoding: 'utf8'
  })
  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(cli.stdout, 'RELEASE_TAG=v1.0.130-dev.3\nRELEASE_TITLE=GTAR v1.0.130-dev.3\nIS_PRERELEASE=true\nIS_PROMOTABLE=true\n')

  // inspectCheckpoint succeeds and marks promotable: true
  const relMeta = require(path.join(repo, '.github/release_metadata.cjs'))
  const checkpoint = relMeta.inspectCheckpoint(repo, 'v1.0.130-dev.3')
  assert.equal(checkpoint.sha, headSha)
  assert.equal(checkpoint.tag, 'v1.0.130-dev.3')
  assert.equal(checkpoint.promotable, true)
  assert.equal(checkpoint.prodTag, 'v1.1.133')
  assert.equal(checkpoint.nextDevTag, 'v1.0.133-dev.1')
})

// STEP_6.12: Future DEV.3 rejected mismatches fail closed
test('STEP_6.12: Future DEV.3 rejected mismatches fail closed across checkpoint and CLI', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-dev3-fail-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim()
  const put = (file, data) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), data) }

  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com')
  put('.github/release_metadata.cjs', fs.readFileSync(path.join(root, '.github/release_metadata.cjs'), 'utf8'))
  put('web/package.json', JSON.stringify({ version: '1.0.130-dev.3' }))
  put('web/package-lock.json', JSON.stringify({ version: '1.0.130-dev.3', packages: { '': { version: '1.0.130-dev.3' } } }))
  put('web/src/types/gtar.ts', fs.readFileSync(path.join(root, 'web/src/types/gtar.ts'), 'utf8'))
  put('web/functions/lib/authCore.ts', '/**\n * GTAR Server-Authoritative Account & Access Control (v1.0.130-dev.3)\n */\n')
  git('add', '.'); git('commit', '-m', 'fixture')

  const relMeta = require(path.join(repo, '.github/release_metadata.cjs'))

  // Tag pointing to older commit fails closed
  git('tag', 'v1.0.130-dev.3')
  put('other.txt', 'change')
  git('add', '.'); git('commit', '-m', 'new commit')
  const oldTagRun = spawnSync(process.execPath, [path.join(repo, '.github/release_metadata.cjs'), '--tag', 'v1.0.130-dev.3'], {
    cwd: repo, encoding: 'utf8'
  })
  assert.notEqual(oldTagRun.status, 0)
  assert.ok(oldTagRun.stderr.includes('Peeled tag commit must equal HEAD'))

  // Mismatched future tag fails closed in inspectCheckpoint
  git('tag', 'v1.0.130-dev.4')
  assert.throws(() => {
    relMeta.inspectCheckpoint(repo, 'v1.0.130-dev.4')
  }, /Checkpoint version metadata mismatch/)
})
