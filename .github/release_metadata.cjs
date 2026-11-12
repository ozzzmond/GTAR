#!/usr/bin/env node
// Read-only metadata for an explicitly requested canonical GitHub DEV tag.
const { execFileSync } = require('node:child_process')
const { readFileSync, appendFileSync } = require('node:fs')
const path = require('node:path')

// Provisional tag name only: final SHA is selected/approved separately, never inferred.
// Keep this mapping after release so immutable R2 identity remains reproducible.
const R2_CHECKPOINT = Object.freeze({
  tag: 'v1.0.145-dev.3', prodTag: 'v1.2.0', nextDevTag: 'v1.1.0-dev.1',
})

function parseDevTag(tag) {
  const match = /^v1\.([01])\.(0|[1-9]\d*)-dev\.([1-9]\d*)$/.exec(tag)
  if (!match || match[0] !== tag) throw new Error('Invalid canonical DEV tag')
  const minor = Number(match[1]), base = Number(match[2]), iteration = Number(match[3])
  if (!Number.isSafeInteger(base) || !Number.isSafeInteger(iteration) || !Number.isSafeInteger(base + iteration)) throw new Error('Unsafe canonical version arithmetic')
  const patch = base + iteration
  const r2 = tag === R2_CHECKPOINT.tag
  return { tag, minor, base, iteration,
    prodTag: r2 ? R2_CHECKPOINT.prodTag : `v1.${minor + 1}.${patch}`,
    nextDevTag: r2 ? R2_CHECKPOINT.nextDevTag : `v1.${minor}.${patch}-dev.1` }
}

// Ascending scheme/version order; callers reverse it for latest-first selection.
function compareDevTags(a, b) {
  return a.minor - b.minor || a.base - b.base || a.iteration - b.iteration
}

function parseProdTag(tag) {
  const match = /^v1\.([12])\.(0|[1-9]\d*)$/.exec(tag)
  if (!match || match[0] !== tag) throw new Error('Invalid canonical PROD tag')
  const minor = Number(match[1]), patch = Number(match[2])
  if ((minor === 1 && patch === 0) || !Number.isSafeInteger(patch)) throw new Error('Unsafe/invalid canonical PROD version')
  return { tag, minor, patch }
}

function compareProdTags(a, b) {
  const left = parseProdTag(a), right = parseProdTag(b)
  return left.minor - right.minor || left.patch - right.patch
}

const HISTORICAL_TAG_EXCEPTIONS = Object.freeze({
  'v1.0.130-dev.2': Object.freeze({
    sha: 'd32e8d42781f890f2ecf681ac3131913272b7ae8',
    committedVersion: '1.0.130-dev.2c',
    classification: 'LEGACY_METADATA_MISMATCH',
    promotable: false,
  }),
})

// Fetch only canonical release refs. Inert/unrelated tags cannot obstruct refresh.
// Numeric R2 DEV refs may move; PROD and historical DEV refs stay non-forced.
function fetchReleaseTags(git, remote, branches = []) {
  const refs = git('ls-remote', '--refs', remote, 'refs/tags/*').split('\n').filter(Boolean)
  const specs = refs.flatMap(line => {
    const ref = line.split(/\s+/)[1]
    if (!ref?.startsWith('refs/tags/')) return []
    const tag = ref.slice('refs/tags/'.length)
    try { return [`${parseDevTag(tag).minor === 1 ? '+' : ''}${ref}:${ref}`] } catch {}
    try { parseProdTag(tag); return [`${ref}:${ref}`] } catch { return [] }
  })
  if (!specs.length) throw new Error('Canonical release tag inventory missing')
  return git('fetch', remote, '--no-tags', ...branches, ...specs)
}

// Reads committed files at the selected checkpoint, never the working tree.
function inspectCheckpoint(root, tag) {
  const parsed = parseDevTag(tag)
  const git = (...argv) => execFileSync('git', argv, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const sha = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`)
  const legacy = HISTORICAL_TAG_EXCEPTIONS[tag]
  if (legacy) {
    if (sha !== legacy.sha) throw new Error('Historical tag moved; immutable history required')
    const read = file => git('show', `${sha}:${file}`)
    const pkg = JSON.parse(read('web/package.json'))
    const lock = JSON.parse(read('web/package-lock.json'))
    const types = read('web/src/types/gtar.ts')
    const dev = /GTAR_DEV_VERSION\s*=\s*(?:typeof __GTAR_DEV_VERSION__ === 'string'\s*\?\s*__GTAR_DEV_VERSION__\s*:\s*)?'([^']+)'/.exec(types)?.[1]
    const runtimeProd = /export const GTAR_APP_VERSION = '([^']+)'/.exec(types)?.[1]
    const auth = read('web/functions/lib/authCore.ts')
    if ([pkg.version, lock.version, lock.packages?.['']?.version, dev].some(v => v !== legacy.committedVersion) ||
        !auth.includes(`GTAR Server-Authoritative Account & Access Control (v${legacy.committedVersion})`)) {
      throw new Error('Historical checkpoint content mismatch')
    }
    return { ...parsed, sha, runtimeProd, promotable: false, classification: legacy.classification }
  }
  const read = file => git('show', `${sha}:${file}`)
  const version = tag.slice(1)
  const pkg = JSON.parse(read('web/package.json'))
  const lock = JSON.parse(read('web/package-lock.json'))
  const types = read('web/src/types/gtar.ts')
  const hasTagDerivedDev = types.includes('typeof __GTAR_DEV_VERSION__')
  const dev = hasTagDerivedDev ? version : (/export const GTAR_DEV_VERSION = '([^']+)'/.exec(types)?.[1] || /GTAR_DEV_VERSION\s*=\s*(?:typeof __GTAR_DEV_VERSION__ === 'string'\s*\?\s*__GTAR_DEV_VERSION__\s*:\s*)?'([^']+)'/.exec(types)?.[1])
  const runtimeProd = /export const GTAR_APP_VERSION = '([^']+)'/.exec(types)?.[1]
  const auth = read('web/functions/lib/authCore.ts')
  const directMatch = [pkg.version, lock.version, lock.packages?.['']?.version, dev].every(v => v === version) &&
    auth.includes(`GTAR Server-Authoritative Account & Access Control (${tag})`)
  if (tag === R2_CHECKPOINT.tag) {
    const sourceDev = /GTAR_DEV_VERSION\s*=\s*(?:typeof __GTAR_DEV_VERSION__ === 'string'\s*\?\s*__GTAR_DEV_VERSION__\s*:\s*)?'([^']+)'/.exec(types)?.[1]
    if (!directMatch || sourceDev !== version) throw new Error('R2 checkpoint requires exact version metadata')
  }
  if (!directMatch) throw new Error('Checkpoint version metadata mismatch')
  return { ...parsed, sha, runtimeProd }
}

function main(args = process.argv.slice(2)) {
  try {
    if (args.length !== 2 || args[0] !== '--tag') throw new Error('Require exactly --tag <canonical DEV tag>')
    const tag = args[1]
    parseDevTag(tag)
    const root = path.resolve(__dirname, '..')
    const git = (...argv) => execFileSync('git', argv, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    // Exact ref lookup accepts lightweight and annotated tags, and rejects branch aliases.
    git('show-ref', '--verify', `refs/tags/${tag}`)
    const taggedCommit = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`)
    if (taggedCommit !== git('rev-parse', '--verify', 'HEAD')) throw new Error('Peeled tag commit must equal HEAD')
    const legacy = HISTORICAL_TAG_EXCEPTIONS[tag]
    let promotable = true
    let statusLine = ''
    if (legacy) {
      if (taggedCommit !== legacy.sha) throw new Error('Historical tag moved; immutable history required')
      const version = JSON.parse(readFileSync(path.join(root, 'web/package.json'), 'utf8')).version
      if (version !== legacy.committedVersion) throw new Error('web/package.json version must equal historical committed version')
      promotable = false
      statusLine = `METADATA_STATUS=${legacy.classification}\n`
    } else {
      const version = JSON.parse(readFileSync(path.join(root, 'web/package.json'), 'utf8')).version
      if (version !== tag.slice(1)) throw new Error('web/package.json version must equal tag without leading v')
    }
    const output = `RELEASE_TAG=${tag}\nRELEASE_TITLE=GTAR ${tag}\nIS_PRERELEASE=true\nIS_PROMOTABLE=${promotable}\n${statusLine}`
    // No metadata is emitted or appended until every validation above succeeds.
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, output, 'utf8')
    process.stdout.write(output)
    return 0
  } catch (error) {
    process.stderr.write(`Release metadata error: ${error.message}\n`)
    return 1
  }
}
if (require.main === module) process.exitCode = main()
module.exports = { R2_CHECKPOINT, compareDevTags, parseProdTag, compareProdTags, main, parseDevTag, inspectCheckpoint, HISTORICAL_TAG_EXCEPTIONS, fetchReleaseTags }
