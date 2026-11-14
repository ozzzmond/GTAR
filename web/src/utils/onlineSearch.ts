/**
 * Online Chord Search & Fetch Engine (Parity with Android WebScraperEngine.kt)
 * Routes search and sheet retrieval requests through the active OnlineSearchProvider.
 * Decouples consumers from provider-specific endpoints and parsing.
 */

import {
  type OnlineChordResult,
  type FetchedChordSheet,
  type OnlineSearchResult,
  type OnlineSheetResult,
  type OnlineSearchErrorCode,
  type OnlineSearchProvider,
  OnlineSearchError,
  UltimateGuitarProvider,
  getActiveSearchProvider,
  setActiveSearchProvider,
  registerSearchProvider,
  resetSearchProvider,
  getRegisteredSearchProviders,
  getSearchProviderById,
  isOnline,
  CURATED_CATALOG,
} from './onlineSearchProvider'
import { loadOnlineSourceSettings, type OnlineSourceSettings } from './onlineSourceSettings'

export {
  type OnlineChordResult,
  type FetchedChordSheet,
  type OnlineSearchResult,
  type OnlineSheetResult,
  type OnlineSearchErrorCode,
  type OnlineSearchProvider,
  OnlineSearchError,
  UltimateGuitarProvider,
  getActiveSearchProvider,
  setActiveSearchProvider,
  registerSearchProvider,
  resetSearchProvider,
  getRegisteredSearchProviders,
  getSearchProviderById,
  isOnline,
  CURATED_CATALOG,
}

/**
 * Searches for chord charts online via the active search provider (defaults to Ultimate Guitar).
 */
export async function searchOnlineChords(query: string): Promise<OnlineChordResult[]> {
  const provider = getActiveSearchProvider()
  return provider.search(query)
}

/**
 * Fetches and parses chord sheet text from a tab reference via the active search provider (defaults to Ultimate Guitar).
 */
export async function fetchOnlineChordSheet(result: OnlineChordResult): Promise<FetchedChordSheet> {
  const provider = (result.providerId && getSearchProviderById(result.providerId)) || getActiveSearchProvider()
  return provider.fetchSheet(result)
}

/** Per-provider ceiling so one slow source cannot hold back the others (#516). */
export const PROVIDER_SEARCH_TIMEOUT_MS = 12000

export interface SourceSearchFailure {
  providerId: string
  name: string
  code: OnlineSearchErrorCode
  message: string
}

export interface SourceSearchOutcome {
  results: OnlineChordResult[]
  errors: SourceSearchFailure[]
  searchedProviderIds: string[]
}

/**
 * Enabled integrated providers in priority order. Shortcuts are never searchable and
 * entries whose provider is not registered are skipped. Primary mode keeps only the first.
 */
export function getSearchableProviders(
  settings: OnlineSourceSettings,
  lookup: (id: string) => OnlineSearchProvider | undefined = getSearchProviderById,
): OnlineSearchProvider[] {
  const providers: OnlineSearchProvider[] = []
  for (const source of settings.sources) {
    if (source.kind !== 'provider' || !source.enabled) continue
    const provider = lookup(source.providerId)
    if (provider && !providers.includes(provider)) providers.push(provider)
  }
  return settings.mode === 'primary' ? providers.slice(0, 1) : providers
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OnlineSearchError('Online search timed out — please try again', { code: 'TIMEOUT' })), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}

/**
 * Searches every enabled integrated provider (or only the primary one) independently.
 * A failing or slow provider never blocks results from the others. Results keep provider
 * priority order, are tagged with their provider id and de-duplicated per provider.
 */
export async function searchConfiguredSources(
  query: string,
  settings: OnlineSourceSettings = loadOnlineSourceSettings(),
  options: { lookup?: (id: string) => OnlineSearchProvider | undefined; timeoutMs?: number } = {},
): Promise<SourceSearchOutcome> {
  const providers = getSearchableProviders(settings, options.lookup)
  const timeoutMs = options.timeoutMs ?? PROVIDER_SEARCH_TIMEOUT_MS
  const settled = await Promise.allSettled(
    providers.map(provider => withTimeout(Promise.resolve().then(() => provider.search(query)), timeoutMs)),
  )
  const results: OnlineChordResult[] = []
  const errors: SourceSearchFailure[] = []
  const seen = new Set<string>()
  settled.forEach((outcome, index) => {
    const provider = providers[index]
    if (outcome.status === 'fulfilled') {
      for (const item of outcome.value) {
        const key = `${provider.id}:${item.id}`
        if (seen.has(key)) continue
        seen.add(key)
        results.push({ ...item, providerId: item.providerId ?? provider.id, providerName: item.providerName ?? provider.name })
      }
      return
    }
    const reason = outcome.reason
    errors.push({
      providerId: provider.id,
      name: provider.name,
      code: reason instanceof OnlineSearchError ? reason.code : 'UNKNOWN',
      message: reason instanceof Error && reason.message ? reason.message : 'Network error — unable to reach search service',
    })
  })
  return { results, errors, searchedProviderIds: providers.map(provider => provider.id) }
}

/** One quiet message: shown only when nothing was found, with identical messages merged. */
export function summarizeSearchErrors(outcome: SourceSearchOutcome): string | null {
  if (outcome.results.length > 0 || outcome.errors.length === 0) return null
  return Array.from(new Set(outcome.errors.map(error => error.message))).join(' · ')
}
