import type { Availability, RegistryEntry } from './contract'

export function proPresenterAvailability(): Availability {
  const nav = globalThis.navigator
  const ua = nav?.userAgent ?? ''
  const ios = /iPad|iPhone|iPod/i.test(ua) || (/Macintosh|MacIntel/i.test(`${ua} ${nav?.platform}`) && (nav?.maxTouchPoints ?? 0) > 1)
  return !ios && /(?:Chrome|Chromium)\/\d+/.test(ua) && globalThis.isSecureContext === true &&
    typeof globalThis.fetch === 'function' && typeof globalThis.ReadableStream === 'function'
    ? { available: true } : { available: false, reason: 'Not available on this device/browser' }
}
const manifest: RegistryEntry['manifest'] = {
  id: 'propresenter-follower', name: 'ProPresenter', version: '0.1.0', contractVersion: 1,
  summary: 'Read-only ProPresenter follower', capabilities: ['net:lan', 'ui:panel'],
  settings: [
    { key: 'host', type: 'host', label: 'Host', default: '', placeholder: '192.168.1.100' },
    { key: 'port', type: 'port', label: 'Port', default: 1025, min: 1025, max: 1025, readOnly: true, note: 'The current CSP permits only port 1025.' },
  ],
}
export const registry: readonly RegistryEntry[] = [{
  manifest, checkAvailability: proPresenterAvailability,
  load: async () => {
    const { activate } = await import('./propresenter-follower')
    return { manifest, checkAvailability: proPresenterAvailability, activate }
  },
}]
