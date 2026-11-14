import { useContext, useEffect, useMemo } from 'react'
import { ExtensionHostContext } from '../extensions/host/ExtensionHostContext'
import { parseGtarSong } from './songParser'
import { matchLiveLyricRanges, projectLyrics } from './liveLyrics'
import type { ActiveSongState } from '../types/gtar'
import type { useLiveLyrics } from './useLiveLyrics'
import type { useSetlistAutoFollow } from './useSetlistAutoFollow'
import type { FollowSetlist } from './setlistAutoFollow'
import { setlistAutoFollowDev } from './setlistAutoFollowDev'
const noLines: ReadonlySet<number> = new Set()

export function useAutoLiveLyrics(manual: ReturnType<typeof useLiveLyrics>, song: ActiveSongState, follow: ReturnType<typeof useSetlistAutoFollow>, context: FollowSetlist | null, selectedIndex: number) {
  const host = useContext(ExtensionHostContext)
  const automaticMode = setlistAutoFollowDev && follow.state.mode === 'auto'
  const target = follow.state.target
  const snapshot = manual.snapshot
  const eligible = automaticMode && !follow.state.paused && manual.eligible && !!target && target.context === context && target.index === selectedIndex && target.songId === song.id &&
    target.context.entries[selectedIndex]?.eligible && target.connection === snapshot?.connection && target.identityRevision === snapshot?.identityRevision && target.presentationUuid === snapshot?.presentation?.uuid
  const fresh = !!eligible && snapshot?.currentReadIdentityRevision === target?.identityRevision && (snapshot?.currentReadSequence ?? 0) > target!.currentReadAfter
  const needsRead = !!eligible && !fresh
  useEffect(() => {
    if (!needsRead || !host) return
    const controller = new AbortController()
    void host.requestCurrentSlideRead(controller.signal).catch(() => {})
    return () => controller.abort()
  }, [host, needsRead, target, snapshot?.current?.uuid, snapshot?.current?.text])

  // Read only the active setlist. Repeated entries of one song are not distinct identities.
  const charts = useMemo(() => {
    const result = new Map<string | number, { chart: string; lyrics: ReturnType<typeof projectLyrics> }>()
    let consistent = true
    if (automaticMode && context) for (const entry of context.entries) {
      if (!entry.eligible) continue
      const previous = result.get(entry.songId)
      if (previous && previous.chart !== entry.chart) { consistent = false; continue }
      if (!previous) result.set(entry.songId, { chart: entry.chart, lyrics: projectLyrics(parseGtarSong(entry.chart, 0).lines) })
    }
    return { result, consistent }
  }, [automaticMode, context])
  const shared = useMemo(() => {
    if (!fresh || !snapshot?.current) return false
    for (const [id, chart] of charts.result) if (id !== song.id && matchLiveLyricRanges(chart.lyrics, snapshot.current.text).length) return true
    return false
  }, [fresh, snapshot, charts, song.id])
  const sectionScope = useMemo(() => ({ context, selectedIndex, songId: song.id, chart: song.rawContent }), [context, selectedIndex, song.id, song.rawContent])
  if (!automaticMode) return { ...manual, automaticMode: false, section: null }
  const confirmed = fresh && charts.consistent && !shared && manual.matchingRanges.length > 0
  const status = !eligible ? 'Auto lyrics neutral - waiting for a settled eligible song'
    : !fresh ? 'Auto lyrics neutral - checking fresh current slide'
    : !snapshot?.current?.text.trim() ? 'Blank slide'
    : !charts.consistent || shared ? 'Auto lyrics neutral - shared or ambiguous slide text'
    : !manual.matchingRanges.length ? 'Slide not matched'
    : 'Live lyrics on - automatic DEV checks'
  const section = confirmed && manual.sectionLineId !== null ? { scope: sectionScope, lineId: manual.sectionLineId } : null
  // Validate all matched geometry for a unique section; never choose a duplicate line occurrence.
  return { ...manual, section, automaticMode: true, confirmed, canConfirm: false, status,
    activeLineIds: confirmed ? manual.matchedLineIds : noLines,
    scrollRange: section ? [...manual.matchedLineIds] : confirmed && manual.matchingRanges.length === 1 ? manual.matchingRanges[0] : null }
}
