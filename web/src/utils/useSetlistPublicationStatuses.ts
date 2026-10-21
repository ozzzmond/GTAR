import { useEffect, useMemo, useState } from 'react'
import type { ActiveSongState, SongEntity, WebSetlist } from '../types/gtar'
import { readPublicationLink } from './sharedSetlistPublishing'
import { resolveSetlistPublicationStatus, type SetlistPublicationStatus } from './setlistPublicationStatus'
import type { useSharedSetlists } from './useSharedSetlists'

export function useSetlistPublicationStatuses(options: {
  setlists: WebSetlist[]
  songs: (SongEntity | ActiveSongState)[]
  accountId?: string | null
  setlistCapability: ReturnType<typeof useSharedSetlists>
}) {
  const { setlists, songs, accountId, setlistCapability } = options
  const [publicationVersion, setPublicationVersion] = useState(0)
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))

  useEffect(() => {
    const handlePublicationUpdate = () => setPublicationVersion(v => v + 1)
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('gtar-setlist-publication-updated', handlePublicationUpdate)
    window.addEventListener('storage', handlePublicationUpdate)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('gtar-setlist-publication-updated', handlePublicationUpdate)
      window.removeEventListener('storage', handlePublicationUpdate)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const statusMap = useMemo(() => {
    const map = new Map<string | number, SetlistPublicationStatus>()
    for (const sl of setlists) {
      const link = accountId ? readPublicationLink (accountId, sl.id) : null
      const status = resolveSetlistPublicationStatus({
        setlist: sl,
        songs,
        accountId,
        isOnline,
        catalogEnabled: setlistCapability.enabled,
        catalogError: setlistCapability.message && !setlistCapability.enabled ? setlistCapability.message : null,
        publishedSetlists: setlistCapability.rows,
        localLink: link,
      })
      map.set(sl.id, status)
    }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps -- publicationVersion invalidates memo when local journal changes
  }, [
    setlists,
    songs,
    accountId,
    isOnline,
    setlistCapability.enabled,
    setlistCapability.rows,
    setlistCapability.message,
    publicationVersion,
  ])

  return statusMap
}
