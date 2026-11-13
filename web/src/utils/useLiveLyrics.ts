import { useContext, useMemo, useState, useSyncExternalStore } from 'react'
import { ExtensionHostContext } from '../extensions/host/ExtensionHostContext'
import { useOptionalGoogleAuth } from './authContext'
import { matchLiveLyrics, projectLyrics } from './liveLyrics'
import type { ActiveSongState, SongLine } from '../types/gtar'

const emptySubscribe = () => () => {}
const emptySnapshot = () => null
const emptyIds: ReadonlySet<number> = new Set()

export function useLiveLyrics(song: ActiveSongState, lines: readonly SongLine[], fullscreen: boolean, suspended: boolean, navigationScope: string) {
  const host = useContext(ExtensionHostContext)
  const auth = useOptionalGoogleAuth()
  const account = JSON.stringify([auth?.bypass ?? false, auth?.session?.user?.sub ?? null, auth?.session?.user?.id ?? null])
  const snapshot = useSyncExternalStore(host?.subscribeFollow ?? emptySubscribe, host?.getFollowSnapshot ?? emptySnapshot, emptySnapshot)
  const projection = useMemo(() => snapshot?.live ? projectLyrics(lines) : [], [lines, snapshot?.live])
  const matches = useMemo(() => snapshot?.live && snapshot.current ? matchLiveLyrics(projection, snapshot.current.text) : emptyIds, [projection, snapshot])
  const scope = useMemo(() => ({ songId: song.id, content: song.rawContent, missing: song.isMissing, account, fullscreen, suspended, navigationScope, session: snapshot?.session }), [song.id, song.rawContent, song.isMissing, account, fullscreen, suspended, navigationScope, snapshot?.session])
  const [confirmation, setConfirmation] = useState({ scope, enabled: false })
  // Clear before paint; exiting cannot revive an old confirmation on re-entry.
  if (confirmation.scope !== scope) setConfirmation({ scope, enabled: false })
  const eligible = fullscreen && !suspended && !song.isMissing && !!snapshot?.live && !!snapshot.presentation && !!snapshot.current
  const confirmed = eligible && confirmation.scope === scope && confirmation.enabled
  const canConfirm = eligible && matches.size > 0
  const confirm = () => {
    if (canConfirm && host?.getFollowSnapshot() === snapshot) setConfirmation({ scope, enabled: true })
  }
  const stop = () => setConfirmation({ scope, enabled: false })
  const status = !snapshot?.live ? 'Waiting for fresh presentation and slide data'
    : !snapshot.current?.text.trim() ? 'Blank slide'
    : matches.size === 0 ? 'Slide not matched' : confirmed ? 'Live lyrics on · assisted session' : 'Live lyrics off'
  return { activeLineIds: confirmed ? matches : emptyIds, snapshot, confirmed, canConfirm, confirm, stop, status }
}
