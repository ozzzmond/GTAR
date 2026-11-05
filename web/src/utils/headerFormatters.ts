import type { DevBuildProvenance } from '../types/gtar'

export function formatDevDiagLine1(prov: DevBuildProvenance, devVersion: string): string {
  const version = `v${devVersion.replace(/^v/, '')}`
  const status = prov.tagStatus || 'UNVERIFIED'
  const sha = prov.commitSha || 'unknown'
  if (status === 'TAGGED' && prov.tagName && prov.tagName !== version) {
    return `${version} · TAGGED: ${prov.tagName} · SHA: ${sha}`
  }
  return `${version} · ${status} · SHA: ${sha}`
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
