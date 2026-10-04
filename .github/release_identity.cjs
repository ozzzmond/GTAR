// Build identity only: never edits source. Transport origin is not release authority.
const { execFileSync } = require('node:child_process')
const { parseDevTag, inspectCheckpoint } = require('./release_metadata.cjs')
const CANONICAL_REPOSITORY = 'https://github.com/ozzzmond/GTAR.git'
const ABANDONED_PROD = Object.freeze({
  tag: 'v1.1.122', sha: 'c254195e6dfc946138336551e4ce8a87520baf7f',
  sourceTag: 'v1.0.108-dev.14', tree: '59ca0769cee12f5d73f03e067c5b54be9a848de0'
})
function resolveReleaseIdentity(root, env = process.env, gitOverride) {
  const production = env.CF_PAGES_BRANCH === 'main'
  const validation = Object.hasOwn(env, 'GTAR_VALIDATE_SHA')
  if (!production && !validation) return null // DEV/Pages preview never claims PROD identity.
  if (production && (env.VITE_APP_ENV === 'debug' || env.GTAR_BUILD_MODE === 'debug')) throw new Error('main cannot build debug identity')
  const git = gitOverride || ((...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim())
  const sha = production ? env.CF_PAGES_COMMIT_SHA : env.GTAR_VALIDATE_SHA
  if (!/^[0-9a-f]{40}$/.test(sha || '') || git('rev-parse', 'HEAD') !== sha) throw new Error('Release full commit SHA must equal build HEAD')
  if (production && validation) throw new Error('Production cannot use validation identity')
  // Pages may use a provider-owned mirror. Fetch canonical authority explicitly;
  // never change origin, trust its URL, or force any existing tag.
  git('fetch', CANONICAL_REPOSITORY, 'refs/tags/v1.*:refs/tags/v1.*')
  const tags = git('tag', '--points-at', 'HEAD').split('\n')
  const candidates = tags.flatMap(t => { try { const p = parseDevTag(t); return p.promotable ? [p] : [] } catch { return [] } })
  if (candidates.length !== 1) throw new Error('Build requires one exact clean DEV checkpoint tag')
  const checkpoint = inspectCheckpoint(root, candidates[0].tag)
  const selected = production ? [checkpoint.tag, checkpoint.prodTag] : [checkpoint.tag]
  const refs = Object.fromEntries(git('ls-remote', '--refs', CANONICAL_REPOSITORY, ...selected.map(t => 'refs/tags/' + t))
    .split('\n').filter(Boolean).map(line => { const [object, ref] = line.split(/\s+/); return [ref, object] }))
  if (checkpoint.sha !== sha || selected.some(t => !refs['refs/tags/' + t] ||
    refs['refs/tags/' + t] !== git('rev-parse', 'refs/tags/' + t))) throw new Error('Canonical release tag missing/mismatched at build SHA')
  if (validation) return null // Validate before tag creation; emit no release.json.
  if (checkpoint.prodTag === ABANDONED_PROD.tag || sha === ABANDONED_PROD.sha) throw new Error('Abandoned PROD release cannot be rebuilt or reused')
  if (!tags.includes(checkpoint.prodTag) || git('rev-parse', 'refs/tags/' + checkpoint.prodTag + '^{commit}') !== sha) throw new Error('Atomic PROD tag missing/mismatched at build SHA')
  return { version: checkpoint.prodTag.slice(1), sourceTag: checkpoint.tag, sha }
}
module.exports = { resolveReleaseIdentity, CANONICAL_REPOSITORY, ABANDONED_PROD }
