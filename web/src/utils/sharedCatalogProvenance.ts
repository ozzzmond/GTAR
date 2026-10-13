/**
 * Shared Catalog Provenance Resolution (Phase 5)
 * Safely resolves publication and import provenance for personal songs
 * without exposing email addresses or inferring source from titles/artists.
 */

export interface CatalogSongMetadataLookup {
  id?: string
  publisher_user_id?: string
  publisher_name?: string | null
  publisher_display_name?: string | null
}

/**
 * Safely shortens publisher ID without exposing email addresses.
 */
export function shortenPublisherId(id?: string | null): string {
  if (!id) return ''
  const trimmed = id.trim()
  if (!trimmed) return ''
  // Guard against exposing raw email in display name or ID
  if (trimmed.includes('@')) {
    const prefix = trimmed.split('@')[0]
    return prefix.length > 8 ? `${prefix.slice(0, 8)}...` : prefix
  }
  if (trimmed.length > 12) {
    return `${trimmed.slice(0, 10)}...`
  }
  return trimmed
}

/**
 * Sanitizes display name, ensuring email addresses are not leaked as names.
 */
export function sanitizeDisplayName(name?: string | null): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  if (trimmed.includes('@')) {
    const prefix = trimmed.split('@')[0]
    return prefix.length > 8 ? `${prefix.slice(0, 8)}...` : prefix
  }
  return trimmed
}

export interface PublishedProvenance {
  publisherText: string
  isOwner: boolean
  statusText: 'Server Confirmed' | 'Cached/Offline'
  isFresh: boolean
}

/**
 * Resolves provenance information for a published song.
 * Publisher is "You" ONLY when current account identity is verified as the actual publisher.
 * Never labels stale publication as server-confirmed.
 * Never infers ownership from song title or artist.
 */
export function resolvePublishedProvenance(
  _catalogSongId: string,
  options: {
    currentAccountId?: string | null
    catalogItem?: CatalogSongMetadataLookup | null
    isFresh: boolean
    activeUserEmail?: string | null
  }
): PublishedProvenance {
  const { currentAccountId, catalogItem, isFresh, activeUserEmail } = options
  const isFreshStatus = Boolean(isFresh)

  const publisherId = catalogItem?.publisher_user_id ? catalogItem.publisher_user_id.trim().toLowerCase() : null
  const accountId = currentAccountId ? currentAccountId.trim().toLowerCase() : null
  const userEmail = activeUserEmail ? activeUserEmail.trim().toLowerCase() : null

  // Verified owner check: only when current account identity matches the actual publisher
  const isOwner = Boolean(
    (accountId && publisherId && accountId === publisherId) ||
    (userEmail && publisherId && userEmail === publisherId)
  )

  let publisherText: string
  if (isOwner) {
    publisherText = 'You'
  } else {
    const verifiedName = sanitizeDisplayName(catalogItem?.publisher_display_name || catalogItem?.publisher_name)
    if (verifiedName) {
      publisherText = verifiedName
    } else if (catalogItem?.publisher_user_id) {
      publisherText = shortenPublisherId(catalogItem.publisher_user_id)
    } else {
      publisherText = 'Unknown publisher'
    }
  }

  return {
    publisherText,
    isOwner,
    statusText: isFreshStatus ? 'Server Confirmed' : 'Cached/Offline',
    isFresh: isFreshStatus,
  }
}

export interface ImportedProvenance {
  publisherText: string | null
  isResolved: boolean
}

/**
 * Resolves provenance information for an imported personal song.
 * Uses stable sharedSourceSongId and catalog metadata or persisted provenance.
 * Never infers source from matching titles or artists.
 * Returns publisherText: null when publisher identity cannot be safely resolved ("Source unavailable").
 */
export function resolveImportedProvenance(
  _sourceSongId: string,
  options: {
    catalogItem?: CatalogSongMetadataLookup | null
    persistedPublisherId?: string | null
    persistedPublisherName?: string | null
    currentAccountId?: string | null
  }
): ImportedProvenance {
  const { catalogItem, persistedPublisherId, persistedPublisherName } = options

  // 1. Verified display name where available
  const verifiedName = sanitizeDisplayName(
    catalogItem?.publisher_display_name ||
    catalogItem?.publisher_name ||
    persistedPublisherName
  )

  if (verifiedName) {
    return {
      publisherText: verifiedName,
      isResolved: true,
    }
  }

  // 2. Otherwise shortened publisher ID
  const rawId = catalogItem?.publisher_user_id || persistedPublisherId
  if (rawId && rawId.trim()) {
    return {
      publisherText: shortenPublisherId(rawId),
      isResolved: true,
    }
  }

  // 3. Source unavailable when publisher identity cannot be safely resolved
  return {
    publisherText: null,
    isResolved: false,
  }
}
