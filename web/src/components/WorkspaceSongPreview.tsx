import React, { useMemo } from 'react'
import { Maximize2, Music, Tag } from 'lucide-react'
import type { ActiveSongState } from '../types/gtar'
import { parseGtarSong } from '../utils/songParser'
import { SongLineRenderer } from './SongLineRenderer'
import { transposeContext, wrapKeyOffset } from '../utils/songKeySemantics'
import { normalizeTags } from '../utils/songTags'

export interface WorkspaceSongPreviewProps {
  song: ActiveSongState | null
  onMaximize: () => void
  onTransposeChange?: (newOffset: number) => void
  fontSizePx?: number
  fontFamily?: 'mono' | 'sans' | 'serif'
}

export function WorkspaceSongPreview({
  song,
  onMaximize,
  onTransposeChange,
  fontSizePx = 14,
  fontFamily = 'mono',
}: WorkspaceSongPreviewProps): React.ReactElement {
  const currentOffset = song?.transposeOffset || 0

  const context = useMemo(
    () => (song ? transposeContext(song, currentOffset) : null),
    [song, currentOffset]
  )

  const parsedSong = useMemo(() => {
    if (!song?.rawContent) return null
    return parseGtarSong(song.rawContent, currentOffset)
  }, [song, currentOffset])

  const tags = useMemo(() => (song ? normalizeTags(song.tags) : []), [song])

  if (!song) {
    return (
      <div
        data-testid="workspace-song-preview-empty"
        className="h-full flex flex-col items-center justify-center p-6 text-center text-app-muted select-none"
      >
        <Music className="w-10 h-10 mb-2 opacity-30 text-app-muted" />
        <h3 className="text-sm font-semibold text-app-heading">Select a song to preview</h3>
        <p className="text-xs text-app-muted max-w-xs mt-1">
          Title, chords, lyrics, and metadata will appear in this preview pane.
        </p>
      </div>
    )
  }

  const handleStepTranspose = (delta: number) => {
    if (!onTransposeChange) return
    onTransposeChange(wrapKeyOffset(currentOffset + delta))
  }

  const handleResetTranspose = () => {
    if (!onTransposeChange) return
    onTransposeChange(context?.resetOffset ?? 0)
  }

  return (
    <div
      key={song.id ?? song.title}
      data-testid="workspace-song-preview"
      className="h-full flex flex-col min-h-0 animate-in fade-in duration-150 motion-reduce:animate-none"
    >
      {/* Top preview header with title, artist and Maximize button */}
      <div className="shrink-0 p-3.5 sm:p-4 border-b border-app-border bg-app-surface/90 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-app-action/15 text-app-action shrink-0">
              <Music className="w-3.5 h-3.5" />
            </span>
            <h3
              data-testid="workspace-preview-title"
              className="ui-primary-text text-base font-bold text-app-heading truncate"
            >
              {song.title}
            </h3>
          </div>
          <p
            data-testid="workspace-preview-artist"
            className="text-xs text-app-muted truncate mt-0.5 ml-6"
          >
            {song.artist || 'Unknown Artist'}
          </p>
        </div>

        {/* Maximize / Open in Stage button */}
        <button
          type="button"
          data-testid="workspace-maximize-btn"
          aria-label="Open in Stage"
          onClick={onMaximize}
          className="min-h-9 min-w-9 p-2 rounded-xl border border-app-border bg-app-button hover:bg-app-surface text-app-action hover:text-app-heading shadow-sm transition-colors flex items-center justify-center cursor-pointer shrink-0"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Metadata bar: Keys, Transpose controls, BPM, Time, Tags */}
      <div className="shrink-0 px-3.5 py-2 border-b border-app-border bg-app-base/60 flex flex-wrap items-center gap-2 text-xs">
        {context?.performanceKey && (
          <div
            data-testid="workspace-preview-key-badge"
            className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-app-surface border border-app-border text-app-heading font-mono font-semibold"
          >
            <span>Key:</span>
            <span className="text-app-action">{context.performanceKey}</span>
            {context.originalKey && context.originalKey !== context.performanceKey && (
              <span className="text-[10px] text-app-muted font-normal">
                (orig: {context.originalKey})
              </span>
            )}
          </div>
        )}

        {/* Inline transposition controls */}
        {onTransposeChange && (
          <div
            role="group"
            aria-label="Song transposition"
            className="flex items-center rounded-md border border-app-border bg-app-surface overflow-hidden"
          >
            <button
              type="button"
              data-testid="workspace-transpose-down"
              aria-label="Transpose down one semitone"
              onClick={() => handleStepTranspose(-1)}
              className="px-2 py-0.5 text-app-muted hover:text-app-heading hover:bg-app-base font-mono cursor-pointer"
            >
              -
            </button>
            <span
              data-testid="workspace-transpose-value"
              className="px-1.5 py-0.5 text-[11px] font-mono text-app-text min-w-[2.2rem] text-center"
            >
              {context?.displayOffset ? (context.displayOffset > 0 ? `+${context.displayOffset}` : context.displayOffset) : '0'}
            </span>
            <button
              type="button"
              data-testid="workspace-transpose-up"
              aria-label="Transpose up one semitone"
              onClick={() => handleStepTranspose(1)}
              className="px-2 py-0.5 text-app-muted hover:text-app-heading hover:bg-app-base font-mono cursor-pointer"
            >
              +
            </button>
            {currentOffset !== 0 && (
              <button
                type="button"
                data-testid="workspace-transpose-reset"
                aria-label="Reset transposition"
                onClick={handleResetTranspose}
                className="border-l border-app-border px-1.5 py-0.5 text-[10px] text-app-muted hover:text-app-heading hover:bg-app-base cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        )}

        {song.bpm && (
          <span className="px-2 py-0.5 rounded-md bg-app-surface border border-app-border text-app-muted font-mono">
            {song.bpm} BPM
          </span>
        )}

        {song.time && (
          <span className="px-2 py-0.5 rounded-md bg-app-surface border border-app-border text-app-muted font-mono">
            {song.time}
          </span>
        )}

        {tags.length > 0 && (
          <div className="flex items-center gap-1">
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-app-surface border border-app-border text-[10px] text-app-accent"
              >
                <Tag className="w-2.5 h-2.5" />
                <span>{tag}</span>
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-[10px] text-app-muted">+{tags.length - 3}</span>
            )}
          </div>
        )}
      </div>

      {/* Lyrics & Chords body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 select-text">
        {parsedSong?.lines && parsedSong.lines.length > 0 ? (
          <SongLineRenderer
            readOnly
            lines={parsedSong.lines}
            fontSizePx={fontSizePx}
            fontFamily={fontFamily}
            chordScale={1.0}
            fontWeight="medium"
            lineSpacing="compact"
            notation="chords"
          />
        ) : (
          <div className="py-8 text-center text-app-muted text-xs">
            No lyrics or chords available for this song.
          </div>
        )}
      </div>
    </div>
  )
}
