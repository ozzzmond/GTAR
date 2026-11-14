import { useSyncExternalStore } from 'react'

/**
 * #516 configurable online song sources.
 * Pure settings model plus a small localStorage-backed store. The global Online song
 * sources ON/OFF flag stays in onlineSources.ts and is not touched here.
 */
export const ONLINE_SOURCE_SETTINGS_KEY = 'gtar_online_source_settings'
export const ONLINE_SOURCE_SETTINGS_CHANGED = 'gtar-online-source-settings-changed'
export const ONLINE_SOURCE_SETTINGS_VERSION = 1
export const MAX_SOURCES = 24
export const MAX_SOURCE_NAME_LENGTH = 60
export const MAX_SOURCE_URL_LENGTH = 2048
export const MAX_LINK_QUERY_LENGTH = 200
export const SEARCH_URL_PLACEHOLDER = '{query}'
const PLACEHOLDER_TOKEN = 'GTARQUERYPLACEHOLDER'

export type SearchMode = 'all' | 'primary'

/** Integrated provider: results are displayed inside GTAR. */
export interface ProviderSource {
  kind: 'provider'
  id: string
  name: string
  providerId: string
  enabled: boolean
}

/**
 * External website shortcut: opens in the browser, never searched by GTAR.
 * An optional searchUrl (containing {query}) adds a "Search on <site>" link to the search
 * dropdown; GTAR never requests that page, the browser opens it.
 */
export interface ShortcutSource {
  kind: 'shortcut'
  id: string
  name: string
  url: string
  searchUrl?: string
  enabled: boolean
}

export type SourceEntry = ProviderSource | ShortcutSource

export interface OnlineSourceSettings {
  version: typeof ONLINE_SOURCE_SETTINGS_VERSION
  mode: SearchMode
  sources: SourceEntry[]
}

export interface SupportedSource {
  id: string
  name: string
  kind: 'provider' | 'shortcut'
  providerId?: string
  url?: string
  searchUrl?: string
  defaultEnabled: boolean
}

/**
 * Curated list, not an endorsement. WorshipChords stays an external link: its terms of use
 * allow personal viewing only and forbid copying or mirroring, so GTAR never fetches its pages.
 */
export const SUPPORTED_SOURCES: readonly SupportedSource[] = [
  { id: 'ultimate-guitar', name: 'Ultimate Guitar', kind: 'provider', providerId: 'ultimate-guitar', defaultEnabled: true },
  { id: 'worshipchords', name: 'WorshipChords', kind: 'shortcut', url: 'https://worshipchords.com/', searchUrl: 'https://worshipchords.com/?s={query}', defaultEnabled: false },
]

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

type StorageRead = Pick<Storage, 'getItem'>
type StorageWrite = Pick<Storage, 'setItem'>

function entryFromSupported(source: SupportedSource): SourceEntry {
  return source.kind === 'provider'
    ? { kind: 'provider', id: source.id, name: source.name, providerId: source.providerId ?? source.id, enabled: true }
    : {
        kind: 'shortcut', id: source.id, name: source.name, url: source.url ?? '',
        ...(source.searchUrl ? { searchUrl: source.searchUrl } : {}), enabled: true,
      }
}

export function createDefaultSettings(): OnlineSourceSettings {
  return {
    version: ONLINE_SOURCE_SETTINGS_VERSION,
    mode: 'all',
    sources: SUPPORTED_SOURCES.filter(source => source.defaultEnabled).map(entryFromSupported),
  }
}

/**
 * Accepts a typed website address and returns a normalized http(s) URL.
 * Rejects other schemes, embedded credentials, hosts without a dot and oversized input.
 */
export function validateSourceUrl(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'URL cannot be empty' }
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, error: 'URL cannot be empty' }
  if (trimmed.length > MAX_SOURCE_URL_LENGTH) return { ok: false, error: 'URL is too long' }
  let candidate = trimmed
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    // A bare "scheme:" prefix (javascript:, data:, mailto:) is rejected; "host:port" is allowed.
    if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) && !/^[^\s/:]+:\d+(\/|$)/.test(candidate)) {
      return { ok: false, error: 'Only http and https website addresses are allowed' }
    }
    candidate = `https://${candidate}`
  }
  let parsed: URL
  try { parsed = new URL(candidate) } catch { return { ok: false, error: 'Invalid URL format' } }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, error: 'Only http and https website addresses are allowed' }
  if (parsed.username || parsed.password) return { ok: false, error: 'URLs with embedded credentials are not allowed' }
  if (!parsed.hostname.includes('.')) return { ok: false, error: 'Enter a full website address, for example example.com' }
  return { ok: true, value: parsed.href }
}

/**
 * Validates a search URL template: a normal http(s) address with {query} in the path, query or
 * hash (never the host). Returns the template in its original {query} form.
 */
export function validateSearchUrlTemplate(raw: unknown): Result<string> {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'Search URL cannot be empty' }
  const text = raw.trim()
  if (!text.includes(SEARCH_URL_PLACEHOLDER)) return { ok: false, error: `Search URL must contain ${SEARCH_URL_PLACEHOLDER}` }
  const checked = validateSourceUrl(text.split(SEARCH_URL_PLACEHOLDER).join(PLACEHOLDER_TOKEN))
  if (!checked.ok) return checked
  const parsed = new URL(checked.value)
  if (parsed.hostname.toLowerCase().includes(PLACEHOLDER_TOKEN.toLowerCase()) || parsed.port.includes(PLACEHOLDER_TOKEN)) {
    return { ok: false, error: `${SEARCH_URL_PLACEHOLDER} must not be part of the website name` }
  }
  const template = checked.value.split(PLACEHOLDER_TOKEN).join(SEARCH_URL_PLACEHOLDER)
  if (template.length > MAX_SOURCE_URL_LENGTH) return { ok: false, error: 'URL is too long' }
  return { ok: true, value: template }
}

/** Builds the browser URL for a search template, or null when the query is empty or the template is invalid. */
export function buildSearchUrl(template: string, query: string): string | null {
  const q = query.trim().slice(0, MAX_LINK_QUERY_LENGTH)
  if (!q || !validateSearchUrlTemplate(template).ok) return null
  return template.split(SEARCH_URL_PLACEHOLDER).join(encodeURIComponent(q))
}

export interface SearchLink { id: string; name: string; href: string }

/** Enabled Link sources that can open a site search for this query, in list order. */
export function getSearchLinks(settings: OnlineSourceSettings, query: string): SearchLink[] {
  const links: SearchLink[] = []
  for (const source of settings.sources) {
    if (source.kind !== 'shortcut' || !source.enabled || !source.searchUrl) continue
    const href = buildSearchUrl(source.searchUrl, query)
    if (href) links.push({ id: source.id, name: source.name, href })
  }
  return links
}

function hostKey(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

function cleanName(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_SOURCE_NAME_LENGTH) : ''
}

/**
 * Rebuilds settings from untrusted stored JSON. Invalid entries are dropped, never replaced
 * with defaults: a removed source stays removed and an empty list stays empty.
 */
export function sanitizeSettings(raw: unknown): OnlineSourceSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as { version?: unknown; mode?: unknown; sources?: unknown }
  if (input.version !== ONLINE_SOURCE_SETTINGS_VERSION || !Array.isArray(input.sources)) return null
  const seen = new Set<string>()
  const sources: SourceEntry[] = []
  for (const item of input.sources) {
    if (sources.length >= MAX_SOURCES) break
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const name = cleanName(entry.name)
    if (!id || !name || seen.has(id)) continue
    const enabled = entry.enabled !== false
    if (entry.kind === 'provider' && typeof entry.providerId === 'string' && entry.providerId) {
      seen.add(id)
      sources.push({ kind: 'provider', id, name, providerId: entry.providerId, enabled })
    } else if (entry.kind === 'shortcut') {
      const url = validateSourceUrl(entry.url)
      if (!url.ok) continue
      seen.add(id)
      const stored = validateSearchUrlTemplate(entry.searchUrl)
      // A shortcut saved before search URLs existed gains the curated one, but only while it
      // still points at the curated site.
      const curated = SUPPORTED_SOURCES.find(source => source.id === id && source.kind === 'shortcut')
      const searchUrl = stored.ok
        ? stored.value
        : entry.searchUrl === undefined && curated?.searchUrl && hostKey(curated.url ?? '') === hostKey(url.value)
          ? curated.searchUrl
          : undefined
      sources.push({ kind: 'shortcut', id, name, url: url.value, ...(searchUrl ? { searchUrl } : {}), enabled })
    }
  }
  return { version: ONLINE_SOURCE_SETTINGS_VERSION, mode: input.mode === 'primary' ? 'primary' : 'all', sources }
}

/**
 * First run (nothing stored) and corrupt storage both yield the defaults, so existing
 * users keep Ultimate Guitar. Anything saved afterwards, including an empty list, is honored.
 */
export function parseStoredSettings(rawText: string | null): OnlineSourceSettings {
  if (rawText === null) return createDefaultSettings()
  try { return sanitizeSettings(JSON.parse(rawText)) ?? createDefaultSettings() } catch { return createDefaultSettings() }
}

function nextId(prefix: string, existing: SourceEntry[]): string {
  const taken = new Set(existing.map(source => source.id))
  let index = existing.length + 1
  while (taken.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function withSources(settings: OnlineSourceSettings, sources: SourceEntry[]): OnlineSourceSettings {
  return { ...settings, sources }
}

export function addSupportedSource(settings: OnlineSourceSettings, supportedId: string): Result<OnlineSourceSettings> {
  const supported = SUPPORTED_SOURCES.find(source => source.id === supportedId)
  if (!supported) return { ok: false, error: 'Unknown supported source' }
  if (settings.sources.some(source => source.id === supported.id)) return { ok: false, error: `${supported.name} is already in your list` }
  if (settings.sources.length >= MAX_SOURCES) return { ok: false, error: 'Source list is full' }
  return { ok: true, value: withSources(settings, [...settings.sources, entryFromSupported(supported)]) }
}

function duplicateUrl(sources: SourceEntry[], url: string, ignoreId?: string): boolean {
  return sources.some(source => source.kind === 'shortcut' && source.id !== ignoreId && source.url === url)
}

/** Empty or missing means no search link; anything else must be a valid template. */
function resolveSearchUrl(raw: string | undefined): Result<string | undefined> {
  if (raw === undefined || !raw.trim()) return { ok: true, value: undefined }
  return validateSearchUrlTemplate(raw)
}

export function addShortcut(settings: OnlineSourceSettings, input: { name?: string; url: string; searchUrl?: string }): Result<OnlineSourceSettings> {
  if (settings.sources.length >= MAX_SOURCES) return { ok: false, error: 'Source list is full' }
  const url = validateSourceUrl(input.url)
  if (!url.ok) return url
  const searchUrl = resolveSearchUrl(input.searchUrl)
  if (!searchUrl.ok) return searchUrl
  if (duplicateUrl(settings.sources, url.value)) return { ok: false, error: 'That website is already in your list' }
  const name = cleanName(input.name) || new URL(url.value).hostname.replace(/^www\./, '')
  const entry: ShortcutSource = {
    kind: 'shortcut', id: nextId('custom', settings.sources), name, url: url.value,
    ...(searchUrl.value ? { searchUrl: searchUrl.value } : {}), enabled: true,
  }
  return { ok: true, value: withSources(settings, [...settings.sources, entry]) }
}

export function updateShortcut(settings: OnlineSourceSettings, id: string, input: { name?: string; url: string; searchUrl?: string }): Result<OnlineSourceSettings> {
  const current = settings.sources.find(source => source.id === id)
  if (!current || current.kind !== 'shortcut') return { ok: false, error: 'Shortcut not found' }
  const url = validateSourceUrl(input.url)
  if (!url.ok) return url
  const searchUrl = resolveSearchUrl(input.searchUrl)
  if (!searchUrl.ok) return searchUrl
  if (duplicateUrl(settings.sources, url.value, id)) return { ok: false, error: 'That website is already in your list' }
  const name = cleanName(input.name) || new URL(url.value).hostname.replace(/^www\./, '')
  const updated: ShortcutSource = { kind: 'shortcut', id: current.id, name, url: url.value, ...(searchUrl.value ? { searchUrl: searchUrl.value } : {}), enabled: current.enabled }
  return { ok: true, value: withSources(settings, settings.sources.map(source => (source.id === id ? updated : source))) }
}

export function removeSource(settings: OnlineSourceSettings, id: string): OnlineSourceSettings {
  return withSources(settings, settings.sources.filter(source => source.id !== id))
}

export function setSourceEnabled(settings: OnlineSourceSettings, id: string, enabled: boolean): OnlineSourceSettings {
  return withSources(settings, settings.sources.map(source => (source.id === id ? { ...source, enabled } : source)))
}

/** Moves one entry by delta positions (negative = earlier = higher priority). */
export function moveSource(settings: OnlineSourceSettings, id: string, delta: number): OnlineSourceSettings {
  const from = settings.sources.findIndex(source => source.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= settings.sources.length || from === to) return settings
  const next = [...settings.sources]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return withSources(settings, next)
}

export function setSearchMode(settings: OnlineSourceSettings, mode: SearchMode): OnlineSourceSettings {
  return mode === settings.mode ? settings : { ...settings, mode: mode === 'primary' ? 'primary' : 'all' }
}

export function restoreDefaultSettings(): OnlineSourceSettings {
  return createDefaultSettings()
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function readRaw(storage: StorageRead | null): string | null {
  try { return storage?.getItem(ONLINE_SOURCE_SETTINGS_KEY) ?? null } catch { return null }
}

export function loadOnlineSourceSettings(storage: StorageRead | null = safeStorage()): OnlineSourceSettings {
  return parseStoredSettings(readRaw(storage))
}

export function saveOnlineSourceSettings(settings: OnlineSourceSettings, storage: StorageWrite | null = safeStorage()): boolean {
  let saved = false
  try {
    storage?.setItem(ONLINE_SOURCE_SETTINGS_KEY, JSON.stringify(settings))
    saved = storage !== null
  } catch { /* Storage can be unavailable; the change then applies to this page view only. */ }
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
