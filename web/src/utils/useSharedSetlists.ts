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
    const changed = () => setGeneration(n => n + 1)
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])
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
