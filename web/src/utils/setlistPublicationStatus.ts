import type { ActiveSongState, SongEntity, WebSetlist } from '../types/gtar'
import { snapshotFromSongbook } from './sharedSetlistSnapshot'
import type { PublicationLink, PublishedSetlist, SetlistSnapshot } from './sharedSetlistPublishing'

export type SetlistPublicationStatus =
  | 'CONFIRMED_PUBLISHED'
  | 'LOCAL_CHANGES_NOT_PUBLISHED'
  | 'UNKNOWN_OR_OFFLINE'
  | 'NEVER_PUBLISHED'

export interface SetlistStatusDescriptor {
  status: SetlistPublicationStatus
  title: string
  ariaLabel: string
}

export const SETLIST_STATUS_DESCRIPTORS: Record<SetlistPublicationStatus, { title: string; ariaLabel: string }> = {
  CONFIRMED_PUBLISHED: {
    title: 'Shared with team',
    ariaLabel: 'Shared with team',
  },
  LOCAL_CHANGES_NOT_PUBLISHED: {
    title: 'Changes not shared yet',
    ariaLabel: 'Changes not shared yet',
  },
  UNKNOWN_OR_OFFLINE: {
    title: 'Sharing status unavailable',
    ariaLabel: 'Sharing status unavailable',
  },
  NEVER_PUBLISHED: {
    title: '',
    ariaLabel: '',
  },
}

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
      : v
  )

export function resolveSetlistPublicationStatus(options: {
  setlist: WebSetlist
  songs?: (SongEntity | ActiveSongState)[]
  accountId?: string | null
  isOnline?: boolean
  catalogEnabled?: boolean
  catalogError?: string | boolean | null
  publishedSetlists?: PublishedSetlist[] | null
  localLink?: PublicationLink | null
  hasCandidatePublication?: boolean
}): SetlistPublicationStatus {
  const {
    setlist,
    songs = [],
    isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true,
    catalogEnabled = true,
    catalogError = null,
    publishedSetlists = null,
    localLink,
    hasCandidatePublication,
  } = options

  // 1. Offline condition:
  // Cannot verify cloud publication while offline. Never use only an old local journal entry to claim verified publication.
  if (!isOnline) {
    if (localLink?.result?.unpublished) {
      return 'NEVER_PUBLISHED'
    }
    return 'UNKNOWN_OR_OFFLINE'
  }

  // 2. Catalog unavailable, disabled, or error:
  if (!catalogEnabled || catalogError || !publishedSetlists) {
    if (localLink?.result?.unpublished) {
      return 'NEVER_PUBLISHED'
    }
    return 'UNKNOWN_OR_OFFLINE'
  }

  // 3. Local journal link exists:
  if (localLink) {
    if (localLink.result?.unpublished) {
      return 'NEVER_PUBLISHED'
    }

    if (localLink.pending) {
      return 'LOCAL_CHANGES_NOT_PUBLISHED'
    }

    if (localLink.result && !localLink.result.unpublished) {
      const head = publishedSetlists.find(p => p.id === localLink.result!.id)
      if (!head) {
        // Published ID is not found in active remote heads (e.g. unpublished remotely, deleted, or unverified)
        return 'UNKNOWN_OR_OFFLINE'
      }

      // Check revision match
      if (head.revision !== localLink.result.revision) {
        return 'LOCAL_CHANGES_NOT_PUBLISHED'
      }

      // Check whether local setlist/chart content differs from the published snapshot
      let currentSnapshot: SetlistSnapshot
      try {
        currentSnapshot = snapshotFromSongbook({ songs, setlists: [setlist] }, setlist.id)
      } catch {
        // If snapshot cannot be computed (e.g. missing/corrupt song reference), local differs from valid publication
        return 'LOCAL_CHANGES_NOT_PUBLISHED'
      }

      if (localLink.snapshot) {
        if (canonical(currentSnapshot) !== canonical(localLink.snapshot)) {
          return 'LOCAL_CHANGES_NOT_PUBLISHED'
        }
      } else {
        // Fallback when snapshot was not retained in local link
        if (currentSnapshot.name !== head.name || currentSnapshot.entries.length !== head.occurrences) {
          return 'LOCAL_CHANGES_NOT_PUBLISHED'
        }
      }

      return 'CONFIRMED_PUBLISHED'
    }

    // Link exists with publicationKey only (no result, no pending)
    return 'NEVER_PUBLISHED'
  }

  // 4. No local journal link:
  // "Never claim 'never published' merely because a local link is missing.
  // If ownership or remote publication cannot be resolved reliably, show unknown instead of inventing certainty."
  const candidateMatch = hasCandidatePublication ||
    (publishedSetlists && publishedSetlists.some(p => p.name === setlist.name))

  if (candidateMatch) {
    return 'UNKNOWN_OR_OFFLINE'
  }

  return 'NEVER_PUBLISHED'
}
