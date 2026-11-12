import type { RegistryEntry } from './contract'

// Static metadata only. No connector or implementation chunk ships in slice 1.
export const registry: readonly RegistryEntry[] = [{
  manifest: {
    id: 'propresenter-follower', name: 'ProPresenter', version: '0.0.0', contractVersion: 1,
    summary: 'Read-only ProPresenter follower', capabilities: ['net:lan', 'ui:panel'], settings: [],
  },
  checkAvailability: () => ({ available: false, reason: 'Not yet available' }),
}]
