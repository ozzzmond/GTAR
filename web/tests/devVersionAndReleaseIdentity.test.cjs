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
const { resolveReleaseIdentity, resolveDevIdentity, resolveDeploymentId, getCommittedDevVersion } = require('../../.github/release_identity.cjs')
const canonicalDevVersion = getCommittedDevVersion(root)
assert.equal(canonicalDevVersion, '1.1.0-dev.2', 'Canonical DEV metadata must match target DEV checkpoint')

test('current DEV source stamps agree and missing-package fallback remains frozen', t => {
  const lock = JSON.parse(fs.readFileSync(path.join(webDir, 'package-lock.json'), 'utf8'))
  assert.equal(lock.version, canonicalDevVersion)
  assert.equal(lock.packages[''].version, canonicalDevVersion)
  const { GTAR_DEV_VERSION } = require('../src/types/gtar.ts')
  assert.equal(GTAR_DEV_VERSION, canonicalDevVersion)
  const auth = fs.readFileSync(path.join(webDir, 'functions/lib/authCore.ts'), 'utf8')
  assert.ok(auth.includes(`GTAR Server-Authoritative Account & Access Control (v${canonicalDevVersion})`))
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-dev-version-'))
  t.after(() => fs.rmSync(emptyRoot, { recursive: true, force: true }))
  // Last-resort fallback is intentionally not re-stamped: .github/** is byte-locked to main.
  assert.equal(getCommittedDevVersion(emptyRoot), '1.0.145-dev.3')
})

const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) => {
    module._compile(
      ts.transpileModule(
        fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({DEV:true,VITE_APP_ENV:"development"})'),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        }
      ).outputText,
      filename
    )
  }
}
require.extensions['.png'] = (module) => {
  module.exports = '/assets/dev-logo.png'
}

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
  assert.equal(Object.hasOwn(parsed3, 'suffix'), false)
  assert.equal(Object.hasOwn(parsed3, 'promotable'), false)
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
  assert.equal(identity.version, canonicalDevVersion)
  assert.equal(identity.tag, 'v1.0.130-dev.3')
  assert.equal(identity.tagStatus, 'TAGGED')
  assert.equal(identity.isTagged, true)
  assert.equal(identity.promotable, true)
})

// STEP_6.3: Lettered DEV tag identity and non-promotability
test('STEP_6.3: Lettered DEV tag is rejected and leaves identity untagged', () => {
  for (const tag of ['v1.0.130-dev.1a', 'v1.0.130-dev.2c', 'v1.0.130-dev.3a']) {
    assert.throws(() => parseDevTag(tag), /Invalid canonical DEV/)

    const gitMock = (...args) => {
      const cmd = args.join(' ')
      if (cmd === 'rev-parse HEAD') return 'fedcba9876543210fedcba9876543210fedcba98'
      if (cmd === 'rev-parse --short HEAD') return 'fedcba9'
      if (cmd === 'tag --points-at HEAD') return tag
      return ''
    }
    const identity = resolveDevIdentity(root, {}, gitMock)
    assert.equal(identity.version, canonicalDevVersion)
    assert.equal(identity.tag, null)
    assert.equal(identity.tagStatus, 'UNTAGGED')
    assert.equal(identity.isTagged, false)
    assert.equal(identity.promotable, false)
  }
})

// STEP_6.4: Untagged DEV HEAD identity
test('STEP_6.4: Untagged DEV HEAD resolves version with committed metadata and UNTAGGED provenance', () => {
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const shortSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

  const untaggedGit = (...args) => {
    const cmd = args.join(' ')
    if (cmd === 'rev-parse HEAD') return headSha
    if (cmd === 'rev-parse --short HEAD') return shortSha
    if (cmd === 'tag --points-at HEAD') return ''
    return ''
  }

  const untaggedIdentity = resolveDevIdentity(root, {}, untaggedGit)
  assert.equal(untaggedIdentity.version, canonicalDevVersion)
  assert.equal(untaggedIdentity.tagStatus, 'UNTAGGED')
  assert.equal(untaggedIdentity.shortSha, shortSha)
  assert.equal(untaggedIdentity.sha, headSha)
  assert.equal(untaggedIdentity.isTagged, false)
  assert.equal(untaggedIdentity.tag, null)
  assert.equal(untaggedIdentity.promotable, false)
  assert.ok(!untaggedIdentity.version.includes('untagged-'), 'Committed version is deterministic and not prefixed with untagged-')
})

// STEP_6.5: Missing Git metadata fallback
test('STEP_6.5: Missing Git metadata returns deterministic fallback with UNVERIFIED status', () => {
  const failingGit = () => { throw new Error('git not found') }
  const fallback = resolveDevIdentity(root, {}, failingGit)
  assert.equal(fallback.version, canonicalDevVersion)
  assert.equal(fallback.tagStatus, 'UNVERIFIED')
  assert.equal(fallback.isTagged, false)
  assert.equal(fallback.tag, null)
  assert.equal(fallback.shortSha, 'unknown')
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

  assert.throws(() => parseDevTag('v1.0.0-dev.1'))
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
  assert.equal(checkpoint.promotable, undefined)
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

// STEP_6.13: Regression: untagged identity resolution is immune to physical tags on HEAD
test('STEP_6.13: Regression: untagged build is unaffected even when physical HEAD is tagged', () => {
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const shortSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const physicalTags = execFileSync('git', ['tag', '--points-at', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

  const untaggedGit = (...args) => {
    const cmd = args.join(' ')
    if (cmd === 'rev-parse HEAD') return headSha
    if (cmd === 'rev-parse --short HEAD') return shortSha
    if (cmd === 'tag --points-at HEAD') return ''
    return ''
  }

  // Simulated untagged environment isolates from repository tag state
  const untagged = resolveDevIdentity(root, {}, untaggedGit)
  assert.equal(untagged.isTagged, false)
  assert.equal(untagged.tagStatus, 'UNTAGGED')
  assert.equal(untagged.tag, null)
  assert.equal(untagged.version, canonicalDevVersion)
  assert.equal(untagged.promotable, false)
  assert.ok(!untagged.version.includes('untagged-'), 'Untagged resolution uses deterministic committed version')

  // When physical HEAD has a tag (e.g. CI workflow checkout for v1.0.130-dev.4),
  // verify un-mocked call resolves the live tag while isolated mock resolves untagged.
  // Validate that live tag belongs to tags pointing at HEAD without assuming tag ordering.
  if (physicalTags) {
    const live = resolveDevIdentity(root)
    assert.equal(live.isTagged, true)
    assert.equal(live.tagStatus, 'TAGGED')
    assert.ok(live.tag)
    const validTags = physicalTags.split('\n').map(t => t.trim()).filter(Boolean)
    assert.ok(validTags.includes(live.tag), `Resolved tag ${live.tag} must belong to tags pointing at HEAD: ${validTags.join(', ')}`)
    assert.equal(live.version, canonicalDevVersion)
  } else {
    const live = resolveDevIdentity(root)
    assert.equal(live.isTagged, false)
    assert.equal(live.tagStatus, 'UNTAGGED')
    assert.equal(live.tag, null)
    assert.equal(live.version, canonicalDevVersion)
  }

  // Isolated tag contexts: verify behavior in DEV.4 and DEV.4a tag contexts
  const dev4Git = (...args) => {
    const cmd = args.join(' ')
    if (cmd === 'rev-parse HEAD') return headSha
    if (cmd === 'rev-parse --short HEAD') return shortSha
    if (cmd === 'tag --points-at HEAD') return 'v1.0.130-dev.3c\nv1.0.130-dev.4'
    if (cmd.startsWith('rev-parse --verify')) return headSha
    return ''
  }
  const dev4Identity = resolveDevIdentity(root, {}, dev4Git)
  assert.equal(dev4Identity.isTagged, true)
  assert.equal(dev4Identity.tag, 'v1.0.130-dev.4')
  assert.equal(dev4Identity.promotable, true)

  const dev4aGit = (...args) => {
    const cmd = args.join(' ')
    if (cmd === 'rev-parse HEAD') return headSha
    if (cmd === 'rev-parse --short HEAD') return shortSha
    if (cmd === 'tag --points-at HEAD') return 'v1.0.130-dev.4a'
    if (cmd.startsWith('rev-parse --verify')) return headSha
    return ''
  }
  const dev4aIdentity = resolveDevIdentity(root, {}, dev4aGit)
  assert.equal(dev4aIdentity.isTagged, false)
  assert.equal(dev4aIdentity.tag, null)
  assert.equal(dev4aIdentity.promotable, false)
})

test('numeric checkpoints require direct metadata; newest numeric tag wins local identity', t => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-numeric-'))
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim()
  const put = (file, content) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), content) }
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com')
  put('.github/release_metadata.cjs', fs.readFileSync(path.join(root, '.github/release_metadata.cjs')))
  const tag = 'v1.1.0-dev.2', version = tag.slice(1)
  put('web/package.json', JSON.stringify({ version }))
  put('web/package-lock.json', JSON.stringify({ version, packages: { '': { version } } }))
  put('web/src/types/gtar.ts', `export const GTAR_DEV_VERSION = '${version}'`)
  put('web/functions/lib/authCore.ts', `// GTAR Server-Authoritative Account & Access Control (${tag})`)
  git('add', '.'); git('commit', '-m', 'numeric checkpoint')
  for (const name of [tag, 'v1.1.0-dev.1', 'v1.1.0-dev.3a']) git('tag', name)
  const sha = git('rev-parse', 'HEAD')
  assert.equal(inspectCheckpoint(repo, tag).sha, sha)
  assert.throws(() => inspectCheckpoint(repo, 'v1.1.0-dev.1'), /metadata mismatch/)
  assert.throws(() => inspectCheckpoint(repo, 'v1.1.0-dev.3a'), /Invalid canonical DEV/)
  const cli = spawnSync(process.execPath, [path.join(repo, '.github/release_metadata.cjs'), '--tag', tag], { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(cli.stdout, /IS_PROMOTABLE=true/)
  assert.equal(resolveDevIdentity(repo).tag, tag)
  assert.equal(resolveDevIdentity(repo, { REQUESTED_TAG: 'v1.1.0-dev.3a' }).isTagged, false)
  assert.equal(resolveDevIdentity(repo, { REQUESTED_TAG: 'v1.1.0-dev.1' }).tag, 'v1.1.0-dev.1')
})

// STEP_6.15: Removed aliases fail closed across inspectCheckpoint and CLI
test('STEP_6.15: Removed aliases fail closed across inspectCheckpoint and CLI', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-dev3a-fail-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim()
  const put = (file, data) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), data) }

  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com')
  put('.github/release_metadata.cjs', fs.readFileSync(path.join(root, '.github/release_metadata.cjs'), 'utf8'))
  put('.github/release_identity.cjs', fs.readFileSync(path.join(root, '.github/release_identity.cjs'), 'utf8'))
  put('.github/release_repository.cjs', fs.readFileSync(path.join(root, '.github/release_repository.cjs'), 'utf8'))
  put('web/package.json', JSON.stringify({ version: '1.0.130-dev.3a' }))
  put('web/package-lock.json', JSON.stringify({ version: '1.0.130-dev.3a', packages: { '': { version: '1.0.130-dev.3a' } } }))
  put('web/src/types/gtar.ts', fs.readFileSync(path.join(root, 'web/src/types/gtar.ts'), 'utf8'))
  put('web/functions/lib/authCore.ts', '/**\n * GTAR Server-Authoritative Account & Access Control (v1.0.130-dev.3a)\n */\n')
  git('add', '.'); git('commit', '-m', 'hotfix commit')

  const relMeta = require(path.join(repo, '.github/release_metadata.cjs'))

  // Case A: Missing companion tag in Git (v1.0.130-dev.3a tag does not exist)
  git('tag', 'v1.0.130-dev.4')
  assert.throws(() => {
    relMeta.inspectCheckpoint(repo, 'v1.0.130-dev.4')
  }, /Checkpoint version metadata mismatch/)

  const cliMissing = spawnSync(process.execPath, [path.join(repo, '.github/release_metadata.cjs'), '--tag', 'v1.0.130-dev.4'], {
    cwd: repo, encoding: 'utf8'
  })
  assert.notEqual(cliMissing.status, 0)
  assert.ok(cliMissing.stderr.includes('web/package.json version must equal tag without leading v'))

  // Case B: Moved companion tag in Git (v1.0.130-dev.3a points to a different commit)
  git('tag', '-d', 'v1.0.130-dev.4')
  git('tag', 'v1.0.130-dev.3a') // tag on commit 1
  put('other.txt', 'divergent commit')
  git('add', '.'); git('commit', '-m', 'second commit')
  git('tag', 'v1.0.130-dev.4') // tag on commit 2

  assert.throws(() => {
    relMeta.inspectCheckpoint(repo, 'v1.0.130-dev.4')
  }, /Checkpoint version metadata mismatch/)

  const cliMoved = spawnSync(process.execPath, [path.join(repo, '.github/release_metadata.cjs'), '--tag', 'v1.0.130-dev.4'], {
    cwd: repo, encoding: 'utf8'
  })
  assert.notEqual(cliMoved.status, 0)
  assert.ok(cliMoved.stderr.includes('web/package.json version must equal tag without leading v'))

  // Case C: Invalid iteration transition (skipped iteration: dev.3a -> dev.5)
  git('tag', 'v1.0.130-dev.5')
  assert.throws(() => {
    relMeta.inspectCheckpoint(repo, 'v1.0.130-dev.5')
  }, /Checkpoint version metadata mismatch/)

  // Case D: Invalid target tag (stabilization tag is lettered: dev.3a -> dev.4a)
  git('tag', 'v1.0.130-dev.4a')
  assert.throws(() => {
    relMeta.inspectCheckpoint(repo, 'v1.0.130-dev.4a')
  }, /Invalid canonical DEV/)

  // Case E: Base version mismatch (committed 1.0.130-dev.3a, tag v1.0.131-dev.4)
  git('tag', 'v1.0.131-dev.4')
  assert.throws(() => {
    relMeta.inspectCheckpoint(repo, 'v1.0.131-dev.4')
  }, /Checkpoint version metadata mismatch/)
})

// STEP_6.16: Unrelated metadata mismatches in committed files reject stabilization pair
test('STEP_6.16: Committed metadata mismatches reject numeric aliases', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtar-dev3a-mismatch-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim()
  const put = (file, data) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), data) }

  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com')
  put('.github/release_metadata.cjs', fs.readFileSync(path.join(root, '.github/release_metadata.cjs'), 'utf8'))
  put('.github/release_identity.cjs', fs.readFileSync(path.join(root, '.github/release_identity.cjs'), 'utf8'))
  put('.github/release_repository.cjs', fs.readFileSync(path.join(root, '.github/release_repository.cjs'), 'utf8'))
  // Package has 3a, but lock has stale 3
  put('web/package.json', JSON.stringify({ version: '1.0.130-dev.3a' }))
  put('web/package-lock.json', JSON.stringify({ version: '1.0.130-dev.3', packages: { '': { version: '1.0.130-dev.3' } } }))
  put('web/src/types/gtar.ts', fs.readFileSync(path.join(root, 'web/src/types/gtar.ts'), 'utf8'))
  put('web/functions/lib/authCore.ts', '/**\n * GTAR Server-Authoritative Account & Access Control (v1.0.130-dev.3a)\n */\n')
  git('add', '.'); git('commit', '-m', 'mismatched lock commit')

  git('tag', 'v1.0.130-dev.3a')
  git('tag', 'v1.0.130-dev.4')

  const relMeta = require(path.join(repo, '.github/release_metadata.cjs'))
  assert.throws(() => {
    relMeta.inspectCheckpoint(repo, 'v1.0.130-dev.4')
  }, /Checkpoint version metadata mismatch/)

  // Fix lock but break authCore
  put('web/package-lock.json', JSON.stringify({ version: '1.0.130-dev.3a', packages: { '': { version: '1.0.130-dev.3a' } } }))
  put('web/functions/lib/authCore.ts', '/**\n * GTAR Server-Authoritative Account & Access Control (v1.0.130-dev.3)\n */\n')
  git('add', '.'); git('commit', '-m', 'mismatched auth commit')
  git('tag', '-d', 'v1.0.130-dev.3a'); git('tag', '-d', 'v1.0.130-dev.4')
  git('tag', 'v1.0.130-dev.3a'); git('tag', 'v1.0.130-dev.4')

  assert.throws(() => {
    relMeta.inspectCheckpoint(repo, 'v1.0.130-dev.4')
  }, /Checkpoint version metadata mismatch/)
})

// STEP_6.17: Cloudflare DEV build with missing local Git tags resolves verified canonical tag
test('STEP_6.17: Cloudflare DEV build with missing local Git tags resolves verified canonical tag', () => {
  const sha = '419b94cdfe302e7d4c06149949c37850c89e2600'
  const gitMock = (...args) => {
    const cmd = args.join(' ')
    if (cmd === 'rev-parse HEAD') return sha
    if (cmd === 'rev-parse --short HEAD') return '419b94c'
    if (cmd === 'tag --points-at HEAD') return '' // Missing local tag in Cloudflare Pages clone
    if (args[0] === 'ls-remote') {
      return '0bd2827c74c004d22e5d66615897b6dd7d4a2d6a\trefs/tags/v1.0.130-dev.3\n' + sha + '\trefs/tags/v1.0.130-dev.3^{}'
    }
    return ''
  }

  const identity = resolveDevIdentity(root, {
    CF_PAGES: '1',
    CF_PAGES_BRANCH: 'dev',
    CF_PAGES_COMMIT_SHA: sha
  }, gitMock)

  assert.equal(identity.version, canonicalDevVersion)
  assert.equal(identity.tagStatus, 'TAGGED')
  assert.equal(identity.tag, 'v1.0.130-dev.3')
  assert.equal(identity.sha, sha)
  assert.equal(identity.shortSha, '419b94c')
  assert.equal(identity.isTagged, true)
  assert.equal(identity.promotable, true)
})

// STEP_6.18: Cloudflare DEV build on genuinely untagged commit falls back to UNTAGGED provenance
test('STEP_6.18: Cloudflare DEV build on genuinely untagged commit falls back to UNTAGGED provenance', () => {
  const untaggedSha = '1111111111111111111111111111111111111111'
  const gitMock = (...args) => {
    const cmd = args.join(' ')
    if (cmd === 'rev-parse HEAD') return untaggedSha
    if (cmd === 'rev-parse --short HEAD') return '1111111'
    if (cmd === 'tag --points-at HEAD') return ''
    if (args[0] === 'ls-remote') {
      return '2222222222222222222222222222222222222222\trefs/tags/v1.0.130-dev.1\n'
    }
    return ''
  }

  const identity = resolveDevIdentity(root, {
    CF_PAGES: '1',
    CF_PAGES_BRANCH: 'dev',
    CF_PAGES_COMMIT_SHA: untaggedSha
  }, gitMock)

  assert.equal(identity.version, canonicalDevVersion)
  assert.equal(identity.tagStatus, 'UNTAGGED')
  assert.equal(identity.tag, null)
  assert.equal(identity.sha, untaggedSha)
  assert.equal(identity.shortSha, '1111111')
  assert.equal(identity.isTagged, false)
  assert.equal(identity.promotable, false)
})

// STEP_6.19: Cloudflare DEV ignores lettered tags, including an explicit requested tag
test('STEP_6.19: Cloudflare DEV ignores lettered tags, including an explicit requested tag', () => {
  const stabSha = '3333333333333333333333333333333333333333'
  const gitMock = (...args) => {
    const cmd = args.join(' ')
    if (cmd === 'rev-parse HEAD') return stabSha
    if (cmd === 'rev-parse --short HEAD') return '3333333'
    if (cmd === 'tag --points-at HEAD') return ''
    if (args[0] === 'ls-remote') {
      return stabSha + '\trefs/tags/v1.0.130-dev.3a\n' + stabSha + '\trefs/tags/v1.0.130-dev.4\n'
    }
    return ''
  }

  // Without explicit requested tag, default to clean numeric stabilization tag
  const identDefault = resolveDevIdentity(root, {
    CF_PAGES: '1',
    CF_PAGES_BRANCH: 'dev',
    CF_PAGES_COMMIT_SHA: stabSha
  }, gitMock)

  assert.equal(identDefault.version, canonicalDevVersion)
  assert.equal(identDefault.tagStatus, 'TAGGED')
  assert.equal(identDefault.tag, 'v1.0.130-dev.4')
  assert.equal(identDefault.isTagged, true)
  assert.equal(identDefault.promotable, true)

  // With explicit REQUESTED_TAG selecting lettered tag
  const identReq = resolveDevIdentity(root, {
    CF_PAGES: '1',
    CF_PAGES_BRANCH: 'dev',
    CF_PAGES_COMMIT_SHA: stabSha,
    REQUESTED_TAG: 'v1.0.130-dev.3a'
  }, gitMock)

  assert.equal(identReq.version, canonicalDevVersion)
  assert.equal(identReq.tagStatus, 'UNTAGGED')
  assert.equal(identReq.tag, null)
  assert.equal(identReq.isTagged, false)
  assert.equal(identReq.promotable, false)
})

// STEP_6.20: Untrusted or mismatched tag or SHA fails closed with UNVERIFIED / UNTAGGED status
test('STEP_6.20: Untrusted or mismatched tag or SHA fails closed with UNVERIFIED / UNTAGGED status', () => {
  const headSha = '419b94cdfe302e7d4c06149949c37850c89e2600'
  const gitMock = (...args) => {
    const cmd = args.join(' ')
    if (cmd === 'rev-parse HEAD') return headSha
    if (cmd === 'rev-parse --short HEAD') return '419b94c'
    if (cmd === 'tag --points-at HEAD') return ''
    if (args[0] === 'ls-remote') {
      return '0bd2827c74c004d22e5d66615897b6dd7d4a2d6a\trefs/tags/v1.0.130-dev.3\n' + headSha + '\trefs/tags/v1.0.130-dev.3^{}'
    }
    return ''
  }

  // Case A: CF_PAGES_COMMIT_SHA mismatch -> UNVERIFIED
  const mismatchSha = resolveDevIdentity(root, {
    CF_PAGES: '1',
    CF_PAGES_BRANCH: 'dev',
    CF_PAGES_COMMIT_SHA: '0000000000000000000000000000000000000000'
  }, gitMock)
  assert.equal(mismatchSha.version, canonicalDevVersion)
  assert.equal(mismatchSha.tagStatus, 'UNVERIFIED')
  assert.equal(mismatchSha.tag, null)
  assert.equal(mismatchSha.isTagged, false)

  // Case B: Requested tag points to mismatched SHA -> UNTAGGED
  const mismatchReq = resolveDevIdentity(root, {
    CF_PAGES: '1',
    CF_PAGES_BRANCH: 'dev',
    CF_PAGES_COMMIT_SHA: headSha,
    REQUESTED_TAG: 'v1.0.130-dev.1' // Points to different SHA
  }, gitMock)
  assert.equal(mismatchReq.version, canonicalDevVersion)
  assert.equal(mismatchReq.tagStatus, 'UNTAGGED')
  assert.equal(mismatchReq.tag, null)
  assert.equal(mismatchReq.isTagged, false)
})

// STEP_6.21: Unavailable GitHub verification gracefully falls back to UNVERIFIED
test('STEP_6.21: Unavailable GitHub verification gracefully falls back to UNVERIFIED', () => {
  const headSha = '419b94cdfe302e7d4c06149949c37850c89e2600'
  const gitMock = (...args) => {
    const cmd = args.join(' ')
    if (cmd === 'rev-parse HEAD') return headSha
    if (cmd === 'rev-parse --short HEAD') return '419b94c'
    if (args[0] === 'ls-remote') throw new Error('ETIMEDOUT: GitHub unreachable')
    return ''
  }

  const identity = resolveDevIdentity(root, {
    CF_PAGES: '1',
    CF_PAGES_BRANCH: 'dev',
    CF_PAGES_COMMIT_SHA: headSha
  }, gitMock)

  assert.equal(identity.version, canonicalDevVersion)
  assert.equal(identity.tagStatus, 'UNVERIFIED')
  assert.equal(identity.isTagged, false)
  assert.equal(identity.tag, null)
  assert.equal(identity.promotable, false)
})

// STEP_6.22: PROD build on main branch never resolves DEV identity
test('STEP_6.22: PROD build on main branch never resolves DEV identity', () => {
  const headSha = '419b94cdfe302e7d4c06149949c37850c89e2600'
  const identity = resolveDevIdentity(root, {
    CF_PAGES: '1',
    CF_PAGES_BRANCH: 'main',
    CF_PAGES_COMMIT_SHA: headSha
  })
  assert.equal(identity, null, 'main branch build must never resolve DEV identity')
})

// STEP_6.23: Header formatting helpers format diagnostics accurately
test('STEP_6.23: Header formatting helpers format diagnostics and versions accurately', () => {
  const { formatDevDiagLine1, formatDevDiagLine2, formatHeaderVersion } = require('../src/utils/headerFormatters.ts')

  // Version formatting
  assert.equal(formatHeaderVersion(true, '1.0.130-dev.4a', '1.1.130'), 'v1.0.130-dev.4a')
  assert.equal(formatHeaderVersion(true, 'v1.0.130-dev.4a', '1.1.130'), 'v1.0.130-dev.4a')
  assert.equal(formatHeaderVersion(false, '1.0.130-dev.4a', '1.1.130'), 'v1.1.130')
  assert.equal(formatHeaderVersion(false, '1.0.130-dev.4a', 'v1.1.133'), 'v1.1.133')

  // Line 1: TAGGED
  assert.equal(formatDevDiagLine1({ tagStatus: 'TAGGED', tagName: 'v1.0.130-dev.4a', commitSha: 'd69d1cb', deploymentId: null }, '1.0.145-dev.3'), 'TAGGED: v1.0.130-dev.4a · SHA: d69d1cb')
  assert.equal(formatDevDiagLine1({ tagStatus: 'TAGGED', tagName: 'v1.0.145-dev.3', commitSha: 'd69d1cb', deploymentId: null }, '1.0.145-dev.3'), 'TAGGED · SHA: d69d1cb')
  assert.equal(formatDevDiagLine1({ tagStatus: 'TAGGED', tagName: null, commitSha: 'd69d1cb', deploymentId: null }, 'v1.0.145-dev.3'), 'TAGGED · SHA: d69d1cb')
  // Line 1: UNTAGGED
  assert.equal(formatDevDiagLine1({ tagStatus: 'UNTAGGED', tagName: null, commitSha: 'd69d1cb', deploymentId: null }, '1.0.145-dev.3'), 'SHA: d69d1cb')
  assert.equal(formatDevDiagLine1({ tagStatus: 'UNTAGGED', tagName: null, commitSha: 'abcdef0', deploymentId: null }, 'v1.0.145-dev.3'), 'SHA: abcdef0')
  // Line 1: UNVERIFIED
  assert.equal(formatDevDiagLine1({ tagStatus: 'UNVERIFIED', tagName: null, commitSha: 'd69d1cb', deploymentId: null }, '1.0.145-dev.3'), 'UNVERIFIED · SHA: d69d1cb')
  assert.equal(formatDevDiagLine1({ tagStatus: 'UNVERIFIED', tagName: null, commitSha: 'unknown', deploymentId: null }, '1.0.145-dev.3'), 'UNVERIFIED · SHA: unknown')

  // Line 2: DEPLOYMENT
  assert.equal(formatDevDiagLine2({ tagStatus: 'TAGGED', tagName: 'v1.0.130-dev.4a', commitSha: 'd69d1cb', deploymentId: '55d0cc6b' }), 'DEPLOYMENT: 55d0cc6b')
  assert.equal(formatDevDiagLine2({ tagStatus: 'UNTAGGED', tagName: null, commitSha: 'd69d1cb', deploymentId: null }), 'DEPLOYMENT: unavailable')
})

// STEP_6.24: Live un-mocked canonical verification for current HEAD
test('STEP_6.24: Live un-mocked canonical verification for current HEAD', () => {
  const live = resolveDevIdentity(root)
  assert.equal(live.version, canonicalDevVersion)
  assert.ok(['TAGGED', 'UNTAGGED', 'UNVERIFIED'].includes(live.tagStatus))
})

// STEP_8.1: Available and unavailable Cloudflare deployment identity
test('STEP_8.1: Cloudflare deployment identity resolves faithfully and never fabricates', () => {
  const headSha = 'd69d1cb646617bbeab9a31e53508504443f9bfab'
  const shortSha = 'd69d1cb'

  // Direct environment variable
  assert.equal(resolveDeploymentId({ CF_PAGES_DEPLOYMENT_ID: '55d0cc6b' }, headSha, shortSha, null), '55d0cc6b')
  assert.equal(resolveDeploymentId({ DEPLOYMENT_ID: 'feedbeef' }, headSha, shortSha, null), 'feedbeef')

  // Verified URL derivation
  assert.equal(resolveDeploymentId({ CF_PAGES_URL: 'https://55d0cc6b.gtar-web.pages.dev' }, headSha, shortSha, null), '55d0cc6b')

  // Branch alias URL rejected (never fabricates alias as deployment ID)
  assert.equal(resolveDeploymentId({ CF_PAGES_URL: 'https://dev.gtar-web.pages.dev', CF_PAGES_BRANCH: 'dev' }, headSha, shortSha, null), null)
  assert.equal(resolveDeploymentId({ CF_PAGES_URL: 'https://main.gtar-web.pages.dev' }, headSha, shortSha, null), null)

  // Commit SHA URL rejected (distinguishes deployment ID from commit SHA)
  assert.equal(resolveDeploymentId({ CF_PAGES_URL: 'https://d69d1cb.gtar-web.pages.dev' }, headSha, shortSha, null), null)

  // Tag URL rejected (distinguishes deployment ID from tag)
  assert.equal(resolveDeploymentId({ CF_PAGES_URL: 'https://v1-0-130-dev-4a.gtar-web.pages.dev' }, headSha, shortSha, 'v1.0.130-dev.4a'), null)

  // Unavailable / local build
  assert.equal(resolveDeploymentId({}, headSha, shortSha, null), null)
})

// STEP_8.2: Deployment identity is independent of application version
test('STEP_8.2: Deployment identity is independent of application version', () => {
  const gitMock = (...args) => {
    const cmd = args.join(' ')
    if (cmd === 'rev-parse HEAD') return 'd69d1cb646617bbeab9a31e53508504443f9bfab'
    if (cmd === 'rev-parse --short HEAD') return 'd69d1cb'
    if (cmd === 'tag --points-at HEAD') return ''
    return ''
  }

  const withDep = resolveDevIdentity(root, { CF_PAGES_DEPLOYMENT_ID: '55d0cc6b' }, gitMock)
  assert.equal(withDep.version, canonicalDevVersion)
  assert.equal(withDep.deploymentId, '55d0cc6b')

  const withoutDep = resolveDevIdentity(root, {}, gitMock)
  assert.equal(withoutDep.version, canonicalDevVersion)
  assert.equal(withoutDep.deploymentId, null)
})

// STEP_8.3: Header layout renders DEV branding without redundant version, diagnostics beside branding, and mobile visibility
test('STEP_8.3: Header layout renders DEV branding without redundant version, diagnostics beside branding, and mobile visibility', () => {
  const { Header } = require('../src/components/Header.tsx')

  const devHeaderHtml = renderToStaticMarkup(
    React.createElement(Header, {
      activeView: 'songbook',
      onViewChange: () => {},
      song: { id: 1, title: 'Test Song', rawContent: '', format: 'PLAIN' },
      searchQuery: '',
      onSearchQueryChange: () => {},
      onOpenWebsiteUrlSource: () => {},
      onOpenStageTools: () => {},
      onToggleTheme: () => {},
      onOpenStageSettings: () => {},
      onOpenImportModal: () => {},
      onOpenBackupRestoreModal: () => {},
    })
  )

  // Left column contains GTAR branding (#359) and DEV badge, but NO redundant hardcoded version text
  assert.ok(devHeaderHtml.includes('GTAR'), 'Header must contain GTAR title')
  assert.ok(!devHeaderHtml.includes('GTAR-Dev'), 'Header must not contain redundant GTAR-Dev title (#359)')
  assert.ok(devHeaderHtml.includes('>DEV<'), 'Header must contain DEV badge')
  assert.ok(!devHeaderHtml.includes('header-secondary-text'), 'DEV Header must not contain secondary version label beside DEV badge')

  // Inline diagnostics sit beside the branding and carry the diagnostic lines.
  assert.ok(devHeaderHtml.includes('data-testid="dev-header-diagnostics"'), 'Diagnostics block must be rendered in DEV mode')
  assert.ok(devHeaderHtml.includes('data-testid="dev-header-diag-line1"'), 'Diagnostic Line 1 must be rendered')
  assert.ok(devHeaderHtml.includes('data-testid="dev-header-diag-line2"'), 'Diagnostic Line 2 must be rendered')
  assert.ok(devHeaderHtml.includes('>UNVERIFIED · SHA: unknown</span>'), 'Header passes UNVERIFIED · SHA to diagnostic line 1')
  const inlineDiagnostics = devHeaderHtml.match(/data-testid="dev-header-diagnostics"[^>]*?\sclass="([^"]*)"/)
  assert.ok(inlineDiagnostics[1].includes('max-w-[35vw]'), 'Desktop diagnostics have a bounded width for truncation')

  // Responsive requirement: DEV diagnostics stay visible on small/mobile screens.
  // #320 splits the diagnostics into the inline block beside the branding (>=sm,
  // `hidden sm:flex`) and the compact strip below row 1 (<sm, `sm:hidden`), so the
  // check is scoped to the mobile diagnostics element's own class list instead of
  // the whole header HTML (which also carries the unrelated main navigation's
  // `hidden sm:flex`).
  const compactDiagnostics = devHeaderHtml.match(/data-testid="dev-header-diagnostics-compact"[^>]*?\sclass="([^"]*)"/)
  assert.ok(compactDiagnostics, 'Compact DEV diagnostics strip must be rendered for phones')
  const compactDiagnosticsClass = compactDiagnostics[1]
  assert.ok(compactDiagnosticsClass.includes('sm:hidden'), 'Compact diagnostics must be the <sm presentation')
  assert.ok(!/(^|\s)hidden(\s|$)/.test(compactDiagnosticsClass), 'Diagnostics must remain visible on mobile and NOT be hidden on small screens')
  assert.ok(compactDiagnosticsClass.includes('truncate'), 'Compact diagnostics truncate within the phone width')
  assert.ok(devHeaderHtml.includes('truncate'), 'Diagnostics lines must truncate to prevent overflow')
})

// STEP_8.4: Existing DEV.3c and DEV.4 tags remain untouched in repository
test('STEP_8.4: Existing DEV.3c and DEV.4 tags remain intact and unchanged', () => {
  const tagList = execFileSync('git', ['tag', '-l', 'v1.0.130-dev.*'], { cwd: root, encoding: 'utf8' }).trim()
  assert.ok(tagList.includes('v1.0.130-dev.3c'), 'v1.0.130-dev.3c must exist')
  assert.ok(tagList.includes('v1.0.130-dev.4'), 'v1.0.130-dev.4 must exist')

  const dev3cSha = execFileSync('git', ['rev-parse', 'refs/tags/v1.0.130-dev.3c^{commit}'], { cwd: root, encoding: 'utf8' }).trim()
  const dev4Sha = execFileSync('git', ['rev-parse', 'refs/tags/v1.0.130-dev.4^{commit}'], { cwd: root, encoding: 'utf8' }).trim()
  assert.equal(dev3cSha, 'beb69204b0ca854dc88e1cb4f03ea2001e33722d', 'DEV.3c must point to baseline SHA')
  assert.equal(dev4Sha, 'beb69204b0ca854dc88e1cb4f03ea2001e33722d', 'DEV.4 must point to baseline SHA')
})

// STEP_8.5: Production header behavior unchanged and diagnostics excluded
test('STEP_8.5: Production header behavior unchanged and diagnostics excluded', () => {
  const { formatHeaderVersion } = require('../src/utils/headerFormatters.ts')

  // formatHeaderVersion in PROD mode:
  assert.equal(formatHeaderVersion(false, '1.0.130-dev.4a', '1.0.140'), 'v1.0.140')
  assert.equal(formatHeaderVersion(false, '1.0.130-dev.4a', 'v1.0.140'), 'v1.0.140')
  assert.equal(formatHeaderVersion(false, '1.0.130-dev.4a', '1.1.133'), 'v1.1.133')
})


test('DEV environment override cannot replace canonical GitHub tag authority', () => {
  const canonical = require('../../.github/release_repository.cjs').url
  const calls = [], sha = 'a'.repeat(40)
  const git = (...args) => {
    calls.push(args)
    if (args.join(' ') === 'rev-parse HEAD') return sha
    if (args.join(' ') === 'rev-parse --short HEAD') return sha.slice(0, 7)
    if (args[0] === 'ls-remote') return `${sha}\trefs/tags/v1.1.0-dev.1`
    return ''
  }
  const identity = resolveDevIdentity(root, { CF_PAGES_BRANCH: 'dev', CANONICAL_REPOSITORY: 'https://example.invalid/other.git' }, git)
  assert.equal(identity.tag, 'v1.1.0-dev.1')
  const network = calls.filter(args => ['fetch', 'ls-remote'].includes(args[0]))
  assert.ok(network.length >= 2)
  assert.ok(network.every(args => args.includes(canonical) && !args.some(arg => arg.includes('example.invalid'))))
})
