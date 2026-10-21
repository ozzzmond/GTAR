import { useEffect, useState } from 'react'
import { getStoredSessionStatus } from './googleAuth'
import { listPublishedSetlists, publicationError, type PublishedSetlist } from './sharedSetlistPublishing'

export function useSharedSetlists(active = true, offset = 0) {
  const { session, isExpired } = getStoredSessionStatus()
  const identity = !isExpired && session ? `${session.user.id}:${session.sessionToken || session.idToken || session.token}` : ''
  const [generation, setGeneration] = useState(0)
  const request = `${identity}:${offset}:${generation}`
  const [state, setState] = useState<{ request: string; rows: PublishedSetlist[]; error?: string }>({ request: '', rows: [] })
  useEffect(() => {
    if (!active || !identity) return
    const account = identity.slice(0, identity.indexOf(':'))
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (timer !== undefined) return
      timer = setTimeout(() => { timer = undefined; setGeneration(n => n + 1) }, 0)
    }
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key?.startsWith(`gtar_setlist_publication_v1:${encodeURIComponent(account)}:`) || event.key === 'gtar_auth_session') refresh()
    }
    const confirmations = new Map<string, string>()
    const published = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.account !== account) return
      if (detail.id) {
        const confirmation = `${detail.revision}:${detail.unpublished}`
        if (confirmations.get(detail.id) === confirmation) return
        confirmations.set(detail.id, confirmation)
      }
      refresh()
    }
    window.addEventListener('storage', changed)
    window.addEventListener('gtar-setlist-publication-updated', published)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('storage', changed)
      window.removeEventListener('gtar-setlist-publication-updated', published)
    }
  }, [active, identity])
  useEffect(() => {
    if (!active || !identity) return
    const controller = new AbortController()
    listPublishedSetlists(offset, controller.signal).then(rows => {
      if (!controller.signal.aborted) setState({ request, rows })
    }).catch(error => {
      if (!controller.signal.aborted) setState({ request, rows: [], error: publicationError(error) })
    })
    return () => controller.abort()
  }, [active, identity, offset, request])
  const current = state.request === request && active && !!identity
  return { rows: current ? state.rows : [], enabled: current && !state.error,
    message: !identity ? 'Sign in to check Shared Setlists availability.' : current ? state.error : 'Checking Shared Setlists availability…',
    reload: () => setGeneration(n => n + 1) }
}
