// Build identity only: never edits source. GitHub tags remain authoritative.
const { execFileSync } = require('node:child_process')
const { parseDevTag, inspectCheckpoint } = require('./release_metadata.cjs')
function resolveReleaseIdentity(root, env = process.env, gitOverride) {
  if (!env.CF_PAGES_BRANCH || env.CF_PAGES_BRANCH !== 'main') return null
  if (env.VITE_APP_ENV === 'debug') throw new Error('main cannot build debug identity')
  const git = gitOverride || ((...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim())
  if (!/^[0-9a-f]{40}$/.test(env.CF_PAGES_COMMIT_SHA || '') || git('rev-parse', 'HEAD') !== env.CF_PAGES_COMMIT_SHA) throw new Error('Pages full commit SHA must equal build HEAD')
  // Pages clones may omit tags. Read tags from canonical origin; never force/move them.
  const origin = git('remote', 'get-url', 'origin')
  if (!/^(https:\/\/github\.com\/ozzzmond\/GTAR(?:\.git)?|git@github\.com:ozzzmond\/GTAR(?:\.git)?)$/.test(origin)) throw new Error('Noncanonical build origin')
  git('fetch', 'origin', 'refs/tags/v1.*:refs/tags/v1.*')
  const tags = git('tag', '--points-at', 'HEAD').split('\n')
  const candidates = tags.flatMap(t => { try { const p = parseDevTag(t); return p.promotable ? [p] : [] } catch { return [] } })
  if (candidates.length !== 1) throw new Error('Build requires one exact clean DEV checkpoint tag')
  const checkpoint = inspectCheckpoint(root, candidates[0].tag)
  if (checkpoint.sha !== env.CF_PAGES_COMMIT_SHA || !tags.includes(checkpoint.prodTag)) throw new Error('Atomic PROD tag missing/mismatched at build SHA')
  return { version: checkpoint.prodTag.slice(1), sourceTag: checkpoint.tag, sha: checkpoint.sha }
}
module.exports = { resolveReleaseIdentity }
