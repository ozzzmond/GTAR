import type { DevBuildProvenance, PreviewBuildIdentity } from '../types/gtar'

export function formatDevDiagLine1(prov: DevBuildProvenance, _devVersion?: string): string {
  const sha = prov.commitSha || 'unknown'
  const status = prov.tagStatus || 'UNVERIFIED'
  if (status === 'TAGGED') {
    if (prov.tagName && prov.tagName !== `v${(_devVersion || '').replace(/^v/, '')}`) {
      return `TAGGED: ${prov.tagName} · SHA: ${sha}`
    }
    return `TAGGED · SHA: ${sha}`
  }
  if (status === 'UNTAGGED') {
    return `SHA: ${sha}`
  }
  return `${status} · SHA: ${sha}`
}

export function formatDevDiagLine2(prov: DevBuildProvenance): string {
  const dep = prov.deploymentId || 'unavailable'
  return `DEPLOYMENT: ${dep}`
}

export function formatHeaderVersion(isDev: boolean, devVer: string, prodVer: string): string {
  return isDev
    ? (devVer.startsWith('untagged') ? devVer : `v${devVer.replace(/^v/, '')}`)
    : `v${prodVer.replace(/^v/, '')}`
}

/** Keep the visible label short on phones. */
export function formatPreviewIdentity(identity: PreviewBuildIdentity): string {
  const sha = identity.commitSha || 'unknown'
  const status = identity.tagStatus
  if (status === 'UNTAGGED') {
    return `PREVIEW · SHA: ${sha}`
  }
  if (status === 'TAGGED') {
    return `PREVIEW · TAGGED · SHA: ${sha}`
  }
  return `PREVIEW · ${status} · SHA: ${sha}`
}
