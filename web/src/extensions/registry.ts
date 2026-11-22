import type { Availability, RegistryEntry } from './contract'
import { bandSyncAvailability, bandSyncManifest } from './band-sync/manifest'
import { isIosDevice } from '../utils/iosDevice'
import { isDevHost } from './host/devHost'

export { isDevHost }

export function proPresenterAvailability(): Availability {
  const nav = globalThis.navigator
  // issue#600: iPhone/iPad stay N/A in PROD. On DEV hosts they are available so the real WebKit result
  // (mixed content, Local Network) can be recorded on a device; no other platform rule changes.
  const iosDevTest = isIosDevice(nav) && isDevHost(globalThis.location?.hostname)
  const browserOk = iosDevTest || (!isIosDevice(nav) && /(?:Chrome|Chromium)\/\d+/.test(nav?.userAgent ?? ''))
  return browserOk && globalThis.isSecureContext === true &&
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
}, {
  manifest: bandSyncManifest, checkAvailability: bandSyncAvailability,
  load: async () => ({ manifest: bandSyncManifest, checkAvailability: bandSyncAvailability, activate: (await import('./band-sync')).activate }),
}]
