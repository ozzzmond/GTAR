import React, { useState, useEffect, useRef } from 'react'
import {
  stageCast,
  type StageCastState,
  type PresentationConnection,
  type PresentationConnectionList,
  type NavigatorWithPresentation,
  isPresentationConnectionAvailableEvent,
} from '../utils/stageCast'
import { parseGtarSong, splitSongLinesForColumns } from '../utils/songParser'
import { SongLineRenderer } from './SongLineRenderer'
import { applyCustomThemeStyles } from './ThemeModal'
import type { ActiveSongState } from '../types/gtar'
import {
  createFullscreenController,
  createWakeLockController,
} from '../utils/stagePerformance'

const DEFAULT_FALLBACK_SONG: ActiveSongState = {
  id: 0,
  title: 'Stage Teleprompter Ready',
  artist: 'Connect from GTAR Stage View',
  key: 'C',
  capo: 'No Capo',
  bpm: '120',
  format: 'CHORD_PRO',
  transposeOffset: 0,
  rawContent: `{title: Stage Teleprompter Ready}\n{artist: Waiting for Song Selection...}\n\n[Instructions]\nOpen Stage View on your main device to start projecting.\nChords, lyrics, and autoscroll mirror here in real time.\n`,
}

export const StagePresentationView: React.FC = () => {
  const [castState, setCastState] = useState<StageCastState>(() => {
    return (
      stageCast.getCachedState() || {
        song: DEFAULT_FALLBACK_SONG,
        effectiveKey: 'C',
        transposeOffset: 0,
        fontSizePx: 28,
        fontStyle: 'mono',
        isTwoColumn: false,
      }
    )
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const isSyncingScrollRef = useRef(false)

  const sessionId = React.useMemo(() => {
    if (typeof window === 'undefined') return null
    try {
      return new URLSearchParams(window.location.search).get('session')
    } catch {
      return null
    }
  }, [])

  // Listen to real-time Stage Cast updates and Presentation API receiver connections
  useEffect(() => {
    // Set clean secondary window title so presentation banner doesn't show duplicate lines
    document.title = import.meta.env.DEV ? 'GTAR-Dev Live Stage Companion' : 'GTAR Stage Display'

    const applyScroll = (scrollTop: number, scrollFraction: number) => {
      const container = containerRef.current
      if (!container) return

      isSyncingScrollRef.current = true
      const maxScroll = container.scrollHeight - container.clientHeight
      if (maxScroll > 0) {
        const targetScroll = Math.round(scrollFraction * maxScroll)
        container.scrollTo({
          top: targetScroll,
          behavior: 'smooth',
        })
      } else {
        container.scrollTop = scrollTop
      }

      setTimeout(() => {
        isSyncingScrollRef.current = false
      }, 100)
    }

    const applyIncomingData = (rawData: unknown) => {
      let data: unknown = rawData
      if (typeof rawData === 'string') {
        try {
          data = JSON.parse(rawData)
        } catch {
          return
        }
      }
      if (!data || typeof data !== 'object') return

      const obj = data as Record<string, unknown>
      const inner =
        obj.source === 'GTAR_CAST' && obj.message && typeof obj.message === 'object'
          ? (obj.message as Record<string, unknown>)
          : obj

      // 1. STATE_UPDATE
      if (inner.type === 'STATE_UPDATE' && inner.payload && typeof inner.payload === 'object') {
        const payload = inner.payload as StageCastState
        setCastState((prev) => ({ ...prev, ...payload }))
        if (payload.customThemeColors) {
          applyCustomThemeStyles(payload.customThemeColors)
        }
        return
      }

      // 2. SCROLL_UPDATE
      if (inner.type === 'SCROLL_UPDATE' && inner.payload && typeof inner.payload === 'object') {
        const scrollPayload = inner.payload as { scrollTop?: number; scrollFraction?: number }
        applyScroll(scrollPayload.scrollTop || 0, scrollPayload.scrollFraction || 0)
        return
      }

      // 3. Direct stage state payload (e.g. currentStageState)
      if (inner.song && typeof inner.song === 'object') {
        const song = inner.song as ActiveSongState
        if (song.rawContent || song.title) {
          const newState: StageCastState = {
            song,
            effectiveKey: typeof inner.effectiveKey === 'string' ? inner.effectiveKey : (song.key || 'C'),
            transposeOffset: typeof inner.transposeOffset === 'number' ? inner.transposeOffset : 0,
            fontSizePx: typeof inner.fontSizePx === 'number' ? inner.fontSizePx : 28,
            fontStyle: inner.fontStyle === 'sans' ? 'sans' : 'mono',
            isTwoColumn: Boolean(inner.isTwoColumn),
            themeMode: typeof inner.themeMode === 'string' ? (inner.themeMode as StageCastState['themeMode']) : undefined,
            customThemeColors: inner.customThemeColors as StageCastState['customThemeColors'],
          }
          setCastState((prev) => ({ ...prev, ...newState }))
          if (newState.customThemeColors) {
            applyCustomThemeStyles(newState.customThemeColors)
          }
          if (typeof inner.scrollFraction === 'number') {
            applyScroll(typeof inner.scrollTop === 'number' ? inner.scrollTop : 0, inner.scrollFraction)
          }
        }
      }
    }

    // Direct listener on browser Presentation API receiver connections for instant display
    let receiverCleanup: (() => void) | null = null
    const navWithPresentation = typeof navigator !== 'undefined' ? (navigator as NavigatorWithPresentation) : null
    if (navWithPresentation?.presentation?.receiver) {
      const receiver = navWithPresentation.presentation.receiver
      if (receiver.connectionList) {
        receiver.connectionList
          .then((list: PresentationConnectionList) => {
            const handlePresentationConn = (conn: PresentationConnection) => {
              conn.onmessage = (event: MessageEvent) => {
                applyIncomingData(event.data)
              }
              // Immediately request latest stage state
              try {
                conn.send(JSON.stringify({ type: 'REQUEST_STATE', source: 'GTAR_CAST' }))
              } catch {}
            }

            list.connections.forEach(handlePresentationConn)
            const onAvail = (evt: Event) => {
              if (isPresentationConnectionAvailableEvent(evt)) {
                handlePresentationConn(evt.connection)
              }
            }
            list.addEventListener('connectionavailable', onAvail)
            receiverCleanup = () => {
              list.removeEventListener('connectionavailable', onAvail)
            }
          })
          .catch(() => {})
      }
    }

    // Request current state on mount
    stageCast.requestState()

    const unsubscribe = stageCast.subscribe(
      (newState) => {
        setCastState((prev) => ({
          ...prev,
          ...newState,
        }))

        // Apply custom theme colors if present
        if (newState.customThemeColors) {
          applyCustomThemeStyles(newState.customThemeColors)
        }
      },
      applyScroll
    )

    // Keyboard shortcut 'F' to toggle browser fullscreen (with feature detection)
    const fsCtrl = createFullscreenController()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        if (fsCtrl.isSupported) {
          fsCtrl.toggle()
        }
        // On iOS where fullscreen is unsupported, 'F' is a no-op here.
        // The double-click handler also guards with isSupported.
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      unsubscribe()
      if (receiverCleanup) {
        receiverCleanup()
      }
      window.removeEventListener('keydown', handleKeyDown)
      fsCtrl.cleanup()
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Screen Wake Lock — keep the presentation screen awake during gigs
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const wakeLock = createWakeLockController()
    wakeLock.acquire()
    return () => {
      wakeLock.cleanup()
    }
  }, [])

  const song = castState.song
  const transposeOffset = castState.transposeOffset || 0
  const effectiveKey = castState.effectiveKey || song.key || ''
  const fontSizePx = Math.max(18, castState.fontSizePx || 28)
  const fontStyle = castState.fontStyle || 'mono'
  const isTwoColumn = !!castState.isTwoColumn

  // Parse song with current transpose offset applied
  const parsedSong = React.useMemo(() => {
    return parseGtarSong(song.rawContent || '', transposeOffset)
  }, [song.rawContent, transposeOffset])

  // Split lines for 2-column mode
  const [col1Lines, col2Lines] = React.useMemo(() => {
    return splitSongLinesForColumns(parsedSong.lines)
  }, [parsedSong.lines])

  return (
    <div
      ref={containerRef}
      onDoubleClick={() => {
        // Guard: iOS Safari doesn't support requestFullscreen on non-video elements
        const fsCtrl = createFullscreenController()
        if (fsCtrl.isSupported) {
          fsCtrl.toggle()
        }
        // fsCtrl has no persistent listeners here so no cleanup needed
      }}
      className="fixed inset-0 w-screen h-screen overflow-y-auto bg-[#002B36] text-[#EEE8D5] select-none scroll-smooth px-6 sm:px-12 md:px-16 py-8"
      style={{
        backgroundColor: 'var(--custom-stage-bg, #002B36)',
        color: 'var(--custom-stage-text, #EEE8D5)',
      }}
    >
      {/* Distraction-Free Teleprompter Layout (Zero buttons, Zero controls) */}
      <div className={`mx-auto ${isTwoColumn ? 'max-w-[96vw]' : 'max-w-5xl'}`}>
        {/* Subtle Song Metadata Header */}
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-[#1A4A55] mb-6 flex-wrap opacity-80">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight truncate text-[#FDF6E3]">
              {song.title || 'Untitled Song'}
            </h1>
            {song.artist && (
              <p className="text-base sm:text-lg text-[#2AA198] font-medium truncate mt-0.5">
                {song.id === 0 && sessionId
                  ? `Session: ${sessionId} • Connect from GTAR Stage View`
                  : song.artist}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 font-mono text-sm font-bold">
            {effectiveKey && (
              <span className="px-2.5 py-1 rounded-md bg-[#073642] border border-[#1A4A55] text-[#B58900]">
                KEY: {effectiveKey}
              </span>
            )}
            {song.capo &&
              song.capo.toLowerCase() !== 'no capo' &&
              song.capo.toLowerCase() !== 'none' && (
                <span className="px-2.5 py-1 rounded-md bg-[#073642] border border-[#1A4A55] text-[#2AA198]">
                  {song.capo.toUpperCase()}
                </span>
              )}
          </div>
        </div>

        {/* Chords & Lyrics Display */}
        {isTwoColumn && col2Lines.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-14 items-start">
            <div className="min-w-0">
              <SongLineRenderer
                lines={col1Lines}
                fontSizePx={fontSizePx}
                fontFamily={fontStyle}
                chordScale={castState.chordScale}
                fontWeight={castState.fontWeight}
                lineSpacing={castState.lineSpacing}
              />
            </div>
            <div className="min-w-0 md:border-l md:border-[#1A4A55]/60 md:pl-8 lg:pl-14">
              <SongLineRenderer
                lines={col2Lines}
                fontSizePx={fontSizePx}
                fontFamily={fontStyle}
                chordScale={castState.chordScale}
                fontWeight={castState.fontWeight}
                lineSpacing={castState.lineSpacing}
              />
            </div>
          </div>
        ) : (
          <SongLineRenderer
            lines={parsedSong.lines}
            fontSizePx={fontSizePx}
            fontFamily={fontStyle}
            chordScale={castState.chordScale}
            fontWeight={castState.fontWeight}
            lineSpacing={castState.lineSpacing}
          />
        )}

        {/* Bottom breathing room for smooth autoscrolling to end of song */}
        <div className="h-64 sm:h-80" />
      </div>
    </div>
  )
}
