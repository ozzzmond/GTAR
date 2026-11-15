import type { Availability, ExtensionManifest } from '../contract'
export const bandSyncManifest: ExtensionManifest = {
  id: 'band-sync', name: 'Band Sync', version: '0.1.0', contractVersion: 1,
  summary: 'Turn on to see Band Sync on Stage.', capabilities: ['net:https', 'ui:panel', 'events:song', 'events:transpose'], settings: [],
}
export function bandSyncAvailability(): Availability {
  return globalThis.isSecureContext === true && typeof globalThis.fetch === 'function' && typeof globalThis.WebSocket === 'function'
    ? { available: true } : { available: false, reason: 'Not available on this device/browser' }
}
