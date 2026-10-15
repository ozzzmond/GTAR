#!/usr/bin/env node
// Read-only metadata for an explicitly requested canonical GitHub DEV tag.
const { execFileSync } = require('node:child_process')
const { readFileSync, appendFileSync } = require('node:fs')
const path = require('node:path')

function parseDevTag(tag) {
  const match = /^v1\.0\.([1-9]\d*)-dev\.([1-9]\d*)([a-z]?)$/.exec(tag)
  if (!match) throw new Error('Invalid canonical DEV tag')
  const base = Number(match[1]), iteration = Number(match[2])
  if (!Number.isSafeInteger(base) || !Number.isSafeInteger(iteration) || !Number.isSafeInteger(base + iteration)) throw new Error('Unsafe canonical version arithmetic')
  const patch = base + iteration
  return { tag, base, iteration, suffix: match[3], promotable: match[3] === '', prodTag: `v1.1.${patch}`, nextDevTag: `v1.0.${patch}-dev.1` }
}

const HISTORICAL_TAG_EXCEPTIONS = Object.freeze({
  'v1.0.130-dev.2': Object.freeze({
    sha: 'd32e8d42781f890f2ecf681ac3131913272b7ae8',
    committedVersion: '1.0.130-dev.2c',
    classification: 'LEGACY_METADATA_MISMATCH',
    promotable: false,
  }),
})

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
  if ([pkg.version, lock.version, lock.packages?.['']?.version, dev].some(v => v !== version) ||
      !auth.includes(`GTAR Server-Authoritative Account & Access Control (${tag})`)) throw new Error('Checkpoint version metadata mismatch')
  return { ...parsed, sha, runtimeProd }
}

function main(args = process.argv.slice(2)) {
  try {
    if (args.length !== 2 || args[0] !== '--tag') throw new Error('Require exactly --tag <canonical DEV tag>')
    const tag = args[1]
    const parsed = parseDevTag(tag)
    const root = path.resolve(__dirname, '..')
    const git = (...argv) => execFileSync('git', argv, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    // Exact ref lookup accepts lightweight and annotated tags, and rejects branch aliases.
    git('show-ref', '--verify', `refs/tags/${tag}`)
    const taggedCommit = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`)
    if (taggedCommit !== git('rev-parse', '--verify', 'HEAD')) throw new Error('Peeled tag commit must equal HEAD')
    const legacy = HISTORICAL_TAG_EXCEPTIONS[tag]
    let promotable = parsed.promotable
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
module.exports = { main, parseDevTag, inspectCheckpoint, HISTORICAL_TAG_EXCEPTIONS }
