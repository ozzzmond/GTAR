// Build identity only: never edits source. Transport origin is not release authority.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { parseDevTag, inspectCheckpoint } = require('./release_metadata.cjs')
const CANONICAL_REPOSITORY = 'https://github.com/ozzzmond/GTAR.git'
const ABANDONED_PROD = Object.freeze({
  tag: 'v1.1.122', sha: 'c254195e6dfc946138336551e4ce8a87520baf7f',
  sourceTag: 'v1.0.108-dev.14', tree: '59ca0769cee12f5d73f03e067c5b54be9a848de0'
})

function getCommittedDevVersion(root) {
  try {
    const pkgPaths = [
      path.join(root, 'web/package.json'),
      path.join(root, 'package.json')
    ]
    for (const p of pkgPaths) {
      if (fs.existsSync(p)) {
        const content = JSON.parse(fs.readFileSync(p, 'utf8'))
        if (content && typeof content.version === 'string' && content.version.trim()) {
          return content.version.trim()
        }
      }
    }
  } catch {}
  return '1.0.130-dev.4a'
}

function resolveDeploymentId(env, headSha, shortSha, tagName) {
  const direct = env.CF_PAGES_DEPLOYMENT_ID || env.DEPLOYMENT_ID
  if (direct && typeof direct === 'string') {
    const trimmed = direct.trim()
    if (trimmed && trimmed !== headSha && trimmed !== shortSha && trimmed !== tagName && trimmed !== env.CF_PAGES_BRANCH) {
      return trimmed
    }
  }

  const urlStr = env.CF_PAGES_URL
  if (urlStr && typeof urlStr === 'string') {
    try {
      const url = new URL(urlStr)
      if (url.hostname.endsWith('.pages.dev')) {
        const subdomain = url.hostname.split('.')[0]
        const isBranchAlias = subdomain === (env.CF_PAGES_BRANCH || 'dev') || subdomain === 'main'
        const isSha = subdomain === headSha || subdomain === shortSha
        const isTag = tagName && (subdomain === tagName || subdomain === tagName.replace(/^v/, ''))
        if (!isBranchAlias && !isSha && !isTag && /^[0-9a-f]{7,32}$/i.test(subdomain)) {
          return subdomain
        }
      }
    } catch {}
  }

  return null
}

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
          tag: p.tag,
          promotable: p.promotable
        }
      }
    } catch {}
    return null
  }

  if (candidates.length === 0) return null

  if (candidates.length === 1) {
    return {
      tag: candidates[0].tag,
      promotable: candidates[0].promotable
    }
  }

  // Multiple candidates: deterministically prefer clean numeric stabilization tag
  const cleanCandidates = candidates.filter(p => p.promotable)
  if (cleanCandidates.length > 0) {
    cleanCandidates.sort((a, b) => {
      if (b.base !== a.base) return b.base - a.base
      return b.iteration - a.iteration
    })
    return {
      tag: cleanCandidates[0].tag,
      promotable: true
    }
  }

  const sorted = [...candidates].sort((a, b) => {
    if (b.base !== a.base) return b.base - a.base
    if (b.iteration !== a.iteration) return b.iteration - a.iteration
    return (b.suffix || '').localeCompare(a.suffix || '')
  })
  return {
    tag: sorted[0].tag,
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
    const committedVersion = getCommittedDevVersion(root)
    const headSha = git('rev-parse', 'HEAD')
    if (!headSha || !/^[0-9a-f]{40}$/.test(headSha)) {
      const deploymentId = resolveDeploymentId(env, null, 'unknown', null)
      return {
        version: committedVersion,
        tagStatus: 'UNVERIFIED',
        tag: null,
        sha: null,
        shortSha: 'unknown',
        deploymentId,
        isTagged: false,
        promotable: false
      }
    }
    const shortSha = git('rev-parse', '--short', 'HEAD') || headSha.slice(0, 7)

    const isCloudflare = Boolean(env.CF_PAGES || env.CF_PAGES_BRANCH || env.CF_PAGES_COMMIT_SHA || env.GTAR_VERIFY_TAGS)
    const canonicalRepo = env.CANONICAL_REPOSITORY || CANONICAL_REPOSITORY

    if (isCloudflare) {
      if (env.CF_PAGES_COMMIT_SHA && (!/^[0-9a-f]{40}$/.test(env.CF_PAGES_COMMIT_SHA) || env.CF_PAGES_COMMIT_SHA !== headSha)) {
        const deploymentId = resolveDeploymentId(env, headSha, shortSha, null)
        return {
          version: committedVersion,
          tagStatus: 'UNVERIFIED',
          tag: null,
          sha: headSha,
          shortSha,
          deploymentId,
          isTagged: false,
          promotable: false
        }
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
        } else if (typeof lsOutput === 'string' && lsOutput.trim() === '') {
          canonicalTagMap = new Map()
        }
      } catch {
        canonicalTagMap = null
      }

      if (canonicalTagMap === null) {
        const deploymentId = resolveDeploymentId(env, headSha, shortSha, null)
        return {
          version: committedVersion,
          tagStatus: 'UNVERIFIED',
          tag: null,
          sha: headSha,
          shortSha,
          deploymentId,
          isTagged: false,
          promotable: false
        }
      }

      const verifiedTags = []
      for (const [tag, tagSha] of canonicalTagMap.entries()) {
        if (tagSha === headSha) verifiedTags.push(tag)
      }

      const candidates = verifiedTags.flatMap(t => {
        try {
          return [parseDevTag(t)]
        } catch {
          return []
        }
      })

      const selected = selectCandidate(candidates, headSha, shortSha, env, tag => canonicalTagMap.get(tag))
      if (selected) {
        const deploymentId = resolveDeploymentId(env, headSha, shortSha, selected.tag)
        return {
          version: committedVersion,
          tagStatus: 'TAGGED',
          tag: selected.tag,
          sha: headSha,
          shortSha,
          deploymentId,
          isTagged: true,
          promotable: selected.promotable
        }
      }

      const deploymentId = resolveDeploymentId(env, headSha, shortSha, null)
      return {
        version: committedVersion,
        tagStatus: 'UNTAGGED',
        tag: null,
        sha: headSha,
        shortSha,
        deploymentId,
        isTagged: false,
        promotable: false
      }
    }

    // Local / unverified fallback path
    let tagsOutput
    try {
      tagsOutput = git('tag', '--points-at', 'HEAD')
    } catch {
      tagsOutput = null
    }

    if (tagsOutput === null) {
      const deploymentId = resolveDeploymentId(env, headSha, shortSha, null)
      return {
        version: committedVersion,
        tagStatus: 'UNVERIFIED',
        tag: null,
        sha: headSha,
        shortSha,
        deploymentId,
        isTagged: false,
        promotable: false
      }
    }

    const tags = tagsOutput ? tagsOutput.split('\n').map(t => t.trim()).filter(Boolean) : []
    const candidates = tags.flatMap(t => {
      try {
        return [parseDevTag(t)]
      } catch {
        return []
      }
    })

    const selected = selectCandidate(candidates, headSha, shortSha, env, tag => {
      try {
        return git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`)
      } catch {
        return null
      }
    })

    if (selected) {
      const deploymentId = resolveDeploymentId(env, headSha, shortSha, selected.tag)
      return {
        version: committedVersion,
        tagStatus: 'TAGGED',
        tag: selected.tag,
        sha: headSha,
        shortSha,
        deploymentId,
        isTagged: true,
        promotable: selected.promotable
      }
    }

    const deploymentId = resolveDeploymentId(env, headSha, shortSha, null)
    return {
      version: committedVersion,
      tagStatus: 'UNTAGGED',
      tag: null,
      sha: headSha,
      shortSha,
      deploymentId,
      isTagged: false,
      promotable: false
    }
  } catch {
    const committedVersion = getCommittedDevVersion(root)
    return {
      version: committedVersion,
      tagStatus: 'UNVERIFIED',
      tag: null,
      sha: null,
      shortSha: 'unknown',
      deploymentId: null,
      isTagged: false,
      promotable: false
    }
  }
}

module.exports = {
  resolveReleaseIdentity,
  resolveDevIdentity,
  resolveDeploymentId,
  getCommittedDevVersion,
  CANONICAL_REPOSITORY,
  ABANDONED_PROD
}
