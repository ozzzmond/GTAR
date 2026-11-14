import { useContext, useMemo, useState, useSyncExternalStore } from 'react'
import { ExtensionHostContext } from '../extensions/host/ExtensionHostContext'
import { useOptionalGoogleAuth } from './authContext'
import { matchLiveLyricRanges, projectLyrics, resolveLiveLyricSection } from './liveLyrics'
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
  const currentText = snapshot?.live ? snapshot.current?.text ?? '' : ''
  const ranges = useMemo(() => matchLiveLyricRanges(projection, currentText), [projection, currentText])
  const matches = useMemo(() => new Set(ranges.flat()), [ranges])
  const scope = useMemo(() => ({ songId: song.id, content: song.rawContent, missing: song.isMissing, account, fullscreen, suspended, navigationScope, session: snapshot?.session }), [song.id, song.rawContent, song.isMissing, account, fullscreen, suspended, navigationScope, snapshot?.session])
  const [confirmation, setConfirmation] = useState({ scope, enabled: false })
  // Clear before paint; exiting cannot revive an old confirmation on re-entry.
  if (confirmation.scope !== scope) setConfirmation({ scope, enabled: false })
  const eligible = fullscreen && !suspended && !song.isMissing && !!snapshot?.live && !!snapshot.presentation && !!snapshot.current
  const confirmed = eligible && confirmation.scope === scope && confirmation.enabled
  const canConfirm = eligible && matches.size > 0
  const confirm = () => {
    if (canConfirm && host?.getFollowSnapshot() === snapshot) { setConfirmation({ scope, enabled: true }); return true }
    return false
  }
  const stop = () => setConfirmation({ scope, enabled: false })
  const status = !snapshot?.live ? 'Waiting for fresh presentation and slide data'
    : !snapshot.current?.text.trim() ? 'Blank slide'
    : matches.size === 0 ? 'Slide not matched' : confirmed ? 'Live lyrics on · assisted session' : 'Live lyrics off'
  const scrollRange = confirmed && ranges.length === 1 ? ranges[0] : null
  const slideKey = JSON.stringify([snapshot?.current?.uuid, currentText])
  return { sectionLineId: resolveLiveLyricSection(projection, ranges), eligible, matchingRanges: ranges, matchedLineIds: matches, scrollRange, slideKey, verificationScope: scope, activeLineIds: confirmed ? matches : emptyIds, snapshot, confirmed, canConfirm, confirm, stop, status }
}
