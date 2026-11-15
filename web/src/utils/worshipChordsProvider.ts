import { OnlineSearchError, type OnlineChordResult, type FetchedChordSheet, type OnlineSearchProvider } from './onlineSearchProvider'

/**
 * Non-fetching #525 scaffold. Deliberately NOT registered or offered as an integrated
 * source: no authorized upstream access path has been established. Keep the existing
 * optional external shortcut until permission and deployed retrieval are verified.
 * There is no client flag, injectable transport or endpoint that can enable fetching.
 */
export class WorshipChordsProvider implements OnlineSearchProvider {
  readonly id = 'worshipchords'
  readonly name = 'WorshipChords'

  async search(query: string): Promise<OnlineChordResult[]> {
    void query // Reject every query before any retrieval, including empty queries.
    throw new OnlineSearchError('WorshipChords integration requires an authorized access path. Use the external search link.', { code: 'RESTRICTED' })
  }

  async fetchSheet(result: OnlineChordResult): Promise<FetchedChordSheet> {
    void result // No source URL can authorize access.
    throw new OnlineSearchError('WorshipChords retrieval/import is unavailable until an authorized access path is established.', { code: 'RESTRICTED' })
  }
}
