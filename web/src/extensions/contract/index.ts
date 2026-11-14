export const CONTRACT_VERSION = 1 as const
export type Capability = 'events:song' | 'events:section' | 'events:setlist' | 'events:transpose' | 'net:lan' | 'net:https' | 'device:midi' | 'device:bluetooth' | 'device:audio-in' | 'device:audio-out' | 'ui:panel'
export type SettingField =
  | { key: string; type: 'boolean'; label: string; default: boolean }
  | { key: string; type: 'text' | 'host'; label: string; default: string; placeholder?: string }
  | { key: string; type: 'port' | 'number'; label: string; default: number; min?: number; max?: number; readOnly?: boolean; note?: string }
  | { key: string; type: 'select'; label: string; default: string; options: { value: string; label: string }[] }
  | { key: string; type: 'secret'; label: string }
export interface ExtensionManifest {
  id: string
  name: string
  version: string
  contractVersion: typeof CONTRACT_VERSION
  summary: string
  capabilities: readonly Capability[]
  settings: readonly SettingField[]
}
export type ExtensionSettings = Readonly<Record<string, string | number | boolean>>
export type Availability = { available: true } | { available: false; reason: string }
// Feature flags only: no browser objects, permissions or core state cross this boundary.
export interface HostEnv { readonly capabilities: readonly Capability[] }
export type ExtensionState = 'absent' | 'disabled' | 'unavailable' | 'starting' | 'active' | 'offline' | 'error'
// Ephemeral panel data/actions; never persisted or connected to core state.
export interface ExtensionPanel {
  fields: readonly { label: string; value: string }[]
  actions: readonly { label: string; disabled?: boolean; run(): void }[]
}
// Narrow, memory-only observation. Independent feeds are NOT asserted to be correlated.
export interface FollowObservation {
  readonly live: boolean
  readonly presentation: Readonly<{ uuid: string; title: string; slideIndex: number | null }> | null
  readonly current: Readonly<{ uuid: string; text: string }> | null
}
export interface FollowSnapshot extends FollowObservation { readonly session: number }
export interface ExtensionContext {
  settings: { read(): ExtensionSettings; subscribe(listener: () => void): () => void }
  signal: AbortSignal
  reportStatus(state: 'active' | 'offline' | 'error', message?: string): void
  log(message: string): void
  setPanel(panel: ExtensionPanel): void
  publishFollowSnapshot?(snapshot: FollowObservation): void
}
// No events API in slice 1: event capabilities are refused until a consumer is approved.
export interface ExtensionModule {
  manifest: ExtensionManifest
  checkAvailability(env: HostEnv): Availability
  activate(ctx: ExtensionContext): void | (() => void)
}
export interface RegistryEntry {
  manifest: ExtensionManifest
  checkAvailability(env: HostEnv): Availability
  // Omitted for a manifest whose implementation has not shipped.
  load?: () => Promise<ExtensionModule>
}
