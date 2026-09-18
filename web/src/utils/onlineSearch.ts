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
  isOnline,
  CURATED_CATALOG,
} from './onlineSearchProvider'

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
  const provider = getActiveSearchProvider()
  return provider.fetchSheet(result)
}
