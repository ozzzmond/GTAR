import { useSyncExternalStore } from 'react'
import { GUITARSONGS_LIVE_ACCESS_PERMITTED } from './guitarSongsCore'

/**
 * #632 simplified online song sources:
 * Exactly two fixed integrated providers (Ultimate Guitar and GuitarSongs.club).
 * The global Online song sources ON/OFF flag stays in onlineSources.ts.
 */
export const ONLINE_SOURCE_SETTINGS_KEY = 'gtar_online_source_settings'
export const ONLINE_SOURCE_SETTINGS_CHANGED = 'gtar-online-source-settings-changed'
export const ONLINE_SOURCE_SETTINGS_VERSION = 1

export type FixedProviderId = 'ultimate-guitar' | 'guitarsongs'

export interface ProviderSource {
  kind: 'provider'
  id: FixedProviderId
  name: string
  providerId: FixedProviderId
  enabled: boolean
}

export interface OnlineSourceSettings {
  version: typeof ONLINE_SOURCE_SETTINGS_VERSION
  sources: ProviderSource[]
}

export interface FixedProviderDefinition {
  id: FixedProviderId
  name: string
  providerId: FixedProviderId
  defaultEnabled: boolean
}

export const FIXED_PROVIDERS: readonly FixedProviderDefinition[] = [
  { id: 'ultimate-guitar', name: 'Ultimate Guitar', providerId: 'ultimate-guitar', defaultEnabled: true },
  { id: 'guitarsongs', name: 'GuitarSongs.club', providerId: 'guitarsongs', defaultEnabled: false },
]

export interface ProviderAvailability {
  permitted: boolean
  reason?: string
}

export function getProviderAvailability(id: FixedProviderId | string): ProviderAvailability {
  if (id === 'ultimate-guitar') {
    return { permitted: true }
  }
  if (id === 'guitarsongs') {
    return GUITARSONGS_LIVE_ACCESS_PERMITTED
      ? { permitted: true }
      : { permitted: false, reason: 'Automated access pending verification' }
  }
  return { permitted: false, reason: 'Unsupported provider' }
}

export function isProviderPermitted(id: string): boolean {
  return getProviderAvailability(id).permitted
}

export interface SearchLink {
  id: string
  name: string
  href: string
}

/** Custom external shortcut links were removed in #632. */
export function getSearchLinks(): SearchLink[] {
  return []
}

function buildSources(overrides?: Partial<Record<FixedProviderId, boolean>>): ProviderSource[] {
  return FIXED_PROVIDERS.map((provider) => {
    const requested = overrides?.[provider.id]
    const permitted = isProviderPermitted(provider.id)
    const enabled = permitted ? (requested ?? provider.defaultEnabled) : false
    return {
      kind: 'provider',
      id: provider.id,
      name: provider.name,
      providerId: provider.providerId,
      enabled,
    }
  })
}

export function createDefaultSettings(): OnlineSourceSettings {
  return {
    version: ONLINE_SOURCE_SETTINGS_VERSION,
    sources: buildSources(),
  }
}

/**
 * Safely migrates legacy or untrusted gtar_online_source_settings into the fixed two-provider model.
 * - Preserves existing Ultimate Guitar enabled preference (false if UG was removed in legacy settings).
 * - Drops obsolete mode, WorshipChords, custom shortcuts and unsupported providers.
 * - Never silently enables an unverified provider.
 */
export function sanitizeSettings(raw: unknown): OnlineSourceSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as { version?: unknown; sources?: unknown }
  if (input.version !== ONLINE_SOURCE_SETTINGS_VERSION || !Array.isArray(input.sources)) return null

  let ugEnabled = false
  let gsEnabled = false

  for (const item of input.sources) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const providerId = typeof entry.providerId === 'string' ? entry.providerId.trim() : ''
    const enabled = entry.enabled !== false

    if (entry.kind === 'provider' && (id === 'ultimate-guitar' || providerId === 'ultimate-guitar')) {
      ugEnabled = enabled
    } else if (entry.kind === 'provider' && (id === 'guitarsongs' || providerId === 'guitarsongs')) {
      gsEnabled = entry.enabled === true && isProviderPermitted('guitarsongs')
    }
  }

  return {
    version: ONLINE_SOURCE_SETTINGS_VERSION,
    sources: buildSources({
      'ultimate-guitar': ugEnabled,
      guitarsongs: gsEnabled,
    }),
  }
}

export function parseStoredSettings(rawText: string | null): OnlineSourceSettings {
  if (rawText === null) return createDefaultSettings()
  try {
    return sanitizeSettings(JSON.parse(rawText)) ?? createDefaultSettings()
  } catch {
    return createDefaultSettings()
  }
}

export function setSourceEnabled(
  settings: OnlineSourceSettings,
  id: string,
  enabled: boolean
): OnlineSourceSettings {
  const target = FIXED_PROVIDERS.find((provider) => provider.id === id)
  if (!target) return settings
  const nextEnabled = isProviderPermitted(target.id) ? Boolean(enabled) : false
  return {
    version: ONLINE_SOURCE_SETTINGS_VERSION,
    sources: settings.sources.map((source) =>
      source.id === id ? { ...source, enabled: nextEnabled } : source
    ),
  }
}

export function restoreDefaultSettings(): OnlineSourceSettings {
  return createDefaultSettings()
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readRaw(storage: StorageRead | null): string | null {
  try {
    return storage?.getItem(ONLINE_SOURCE_SETTINGS_KEY) ?? null
  } catch {
    return null
  }
}

type StorageRead = Pick<Storage, 'getItem'>
type StorageWrite = Pick<Storage, 'setItem'>

export function loadOnlineSourceSettings(storage: StorageRead | null = safeStorage()): OnlineSourceSettings {
  return parseStoredSettings(readRaw(storage))
}

export function saveOnlineSourceSettings(
  settings: OnlineSourceSettings,
  storage: StorageWrite | null = safeStorage()
): boolean {
  let saved = false
  try {
    storage?.setItem(ONLINE_SOURCE_SETTINGS_KEY, JSON.stringify(settings))
    saved = storage !== null
  } catch {
    /* Storage can be unavailable; the change then applies to this page view only. */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ONLINE_SOURCE_SETTINGS_CHANGED))
  return saved
}

const SERVER_SNAPSHOT = createDefaultSettings()
let snapshotRaw: string | null | undefined
let snapshotValue: OnlineSourceSettings = SERVER_SNAPSHOT

function getSnapshot(): OnlineSourceSettings {
  const raw = readRaw(safeStorage())
  if (raw !== snapshotRaw) {
    snapshotRaw = raw
    snapshotValue = parseStoredSettings(raw)
  }
  return snapshotValue
}

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(ONLINE_SOURCE_SETTINGS_CHANGED, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(ONLINE_SOURCE_SETTINGS_CHANGED, listener)
    window.removeEventListener('storage', listener)
  }
}

export function useOnlineSourceSettings(): OnlineSourceSettings {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT)
}
