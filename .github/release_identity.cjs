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

function selectCandidate(candidates, headSha, shortSha, env, getTagSha) {
  const requested = env.REQUESTED_TAG || env.RELEASE_TAG
  if (requested) {
    try {
      const p = parseDevTag(requested)
      const tagSha = getTagSha(requested)
      if (tagSha === headSha) {
        return {
          version: p.tag.slice(1),
          tag: p.tag,
          sha: headSha,
          shortSha,
          isTagged: true,
          promotable: p.promotable
        }
      }
    } catch {}
    return {
      version: `untagged-${shortSha}`,
      tag: null,
      sha: headSha,
      shortSha,
      isTagged: false,
      promotable: false
    }
  }

  if (candidates.length === 1) {
    const selected = candidates[0]
    return {
      version: selected.tag.slice(1),
      tag: selected.tag,
      sha: headSha,
      shortSha,
      isTagged: true,
      promotable: selected.promotable
    }
  }

  if (candidates.length === 2) {
    const clean = candidates.find(p => p.promotable)
    const lettered = candidates.find(p => !p.promotable)
    if (clean && lettered && clean.base === lettered.base && clean.iteration === lettered.iteration + 1) {
      return {
        version: clean.tag.slice(1),
        tag: clean.tag,
        sha: headSha,
        shortSha,
        isTagged: true,
        promotable: clean.promotable
      }
    }
  }

  return {
    version: `untagged-${shortSha}`,
    tag: null,
    sha: headSha,
    shortSha,
    isTagged: false,
    promotable: false
  }
}

function resolveDevIdentity(root, env = process.env, gitOverride) {
  const git = gitOverride || ((...args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    } catch {
      return null
    }
  })
  try {
    if (env.CF_PAGES_BRANCH === 'main') return null
    const headSha = git('rev-parse', 'HEAD')
    if (!headSha || !/^[0-9a-f]{40}$/.test(headSha)) {
      return { version: 'untagged-dev', tag: null, sha: null, shortSha: null, isTagged: false, promotable: false }
    }
    const shortSha = git('rev-parse', '--short', 'HEAD') || headSha.slice(0, 7)

    const isCloudflare = Boolean(env.CF_PAGES || env.CF_PAGES_BRANCH || env.CF_PAGES_COMMIT_SHA || env.GTAR_VERIFY_TAGS)
    const canonicalRepo = env.CANONICAL_REPOSITORY || CANONICAL_REPOSITORY

    if (isCloudflare) {
      if (env.CF_PAGES_COMMIT_SHA && (!/^[0-9a-f]{40}$/.test(env.CF_PAGES_COMMIT_SHA) || env.CF_PAGES_COMMIT_SHA !== headSha)) {
        return { version: `untagged-${shortSha}`, tag: null, sha: headSha, shortSha, isTagged: false, promotable: false }
      }

      try {
        git('fetch', canonicalRepo, 'refs/tags/v1.*:refs/tags/v1.*')
      } catch {}

      let canonicalTagMap = null
      try {
        const lsOutput = git('ls-remote', '--tags', canonicalRepo, 'refs/tags/v1.*')
        if (typeof lsOutput === 'string' && lsOutput.length > 0) {
          canonicalTagMap = new Map()
          for (const line of lsOutput.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed) continue
            const [objSha, ref] = trimmed.split(/\s+/)
            if (!objSha || !ref) continue
            if (ref.endsWith('^{}')) {
              canonicalTagMap.set(ref.slice('refs/tags/'.length, -3), objSha)
            } else if (!canonicalTagMap.has(ref.slice('refs/tags/'.length))) {
              canonicalTagMap.set(ref.slice('refs/tags/'.length), objSha)
            }
          }
        }
      } catch {
        canonicalTagMap = null
      }

      if (!canonicalTagMap) {
        return { version: `untagged-${shortSha}`, tag: null, sha: headSha, shortSha, isTagged: false, promotable: false }
      }

      const verifiedTags = []
      for (const [tag, tagSha] of canonicalTagMap.entries()) {
        if (tagSha === headSha) verifiedTags.push(tag)
      }

      const candidates = verifiedTags.flatMap(t => {
        try {
          const p = parseDevTag(t)
          return [p]
        } catch {
          return []
        }
      })

      return selectCandidate(candidates, headSha, shortSha, env, tag => canonicalTagMap.get(tag))
    }

    // Local / unverified fallback path
    const tagsOutput = git('tag', '--points-at', 'HEAD')
    const tags = tagsOutput ? tagsOutput.split('\n').map(t => t.trim()).filter(Boolean) : []
    const candidates = tags.flatMap(t => {
      try {
        const p = parseDevTag(t)
        return [p]
      } catch {
        return []
      }
    })

    return selectCandidate(candidates, headSha, shortSha, env, tag => git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`))
  } catch {
    return { version: 'untagged-dev', tag: null, sha: null, shortSha: null, isTagged: false, promotable: false }
  }
}

module.exports = { resolveReleaseIdentity, resolveDevIdentity, CANONICAL_REPOSITORY, ABANDONED_PROD }
