import React, { useState, useEffect } from 'react'
import {
  X,
  Plus,
  Play,
  Check,
  Globe,
  Loader2,
  ExternalLink,
} from 'lucide-react'
import type { OnlineChordResult, FetchedChordSheet } from '../utils/onlineSearch'
import { fetchOnlineChordSheet } from '../utils/onlineSearch'
import { SongLineRenderer } from './SongLineRenderer'
import { parseGtarSong } from '../utils/songParser'

interface ChordPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  result: OnlineChordResult | null
  onImportSong: (sheet: FetchedChordSheet, openStage?: boolean) => void
}

export const ChordPreviewModal: React.FC<ChordPreviewModalProps> = ({
  isOpen,
  onClose,
  result,
  onImportSong,
}) => {
  const [loading, setLoading] = useState(false)
  const [sheet, setSheet] = useState<FetchedChordSheet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imported, setImported] = useState(false)

  useEffect(() => {
    if (!isOpen || !result) {
      setSheet(null)
      setError(null)
      setImported(false)
      return
    }

    let isMounted = true
    setLoading(true)
    setError(null)

    fetchOnlineChordSheet(result)
      .then((data) => {
        if (isMounted) {
          setSheet(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message || 'Failed to fetch chord sheet.')
          setLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [isOpen, result])

  if (!isOpen || !result) return null

  const parsed = sheet ? parseGtarSong(sheet.rawContent, 0) : null

  const handleImport = (openInStage = false) => {
    if (!sheet) return
    onImportSong(sheet, openInStage)
    setImported(true)
    if (openInStage) {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-fade-in select-none">
      <div className="w-full max-w-3xl rounded-3xl bg-app-surface border border-app-border shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-5 sm:px-7 py-4 border-b border-app-border flex items-center justify-between bg-app-base/80 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-app-action/20 border border-app-action/40 flex items-center justify-center text-app-action shrink-0">
              <Globe className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-app-heading truncate">
                  {result.songName}
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-app-accent/20 text-app-accent font-bold border border-app-accent/30 shrink-0">
                  {result.type} v{result.version}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-app-muted mt-0.5 font-medium">
                <span className="truncate">{result.artistName}</span>
                <span>•</span>
                <span className="text-app-accent font-bold">★ {result.rating.toFixed(1)}</span>
                <span className="text-[11px]">({result.votes.toLocaleString()} votes)</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-app-muted hover:text-app-heading hover:bg-app-base transition-colors cursor-pointer shrink-0"
            title="Close preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body / Chord Preview */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 bg-app-base text-app-text relative">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
              <Loader2 className="w-8 h-8 text-app-action animate-spin" />
              <div>
                <p className="text-sm font-bold text-app-heading">
                  Fetching Online Chord Sheet...
                </p>
                <p className="text-xs text-app-muted mt-1">
                  Extracting lyrics, chords, and key tonality from Ultimate-Guitar
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="py-12 text-center text-xs text-status-error">
              <p className="font-bold">{error}</p>
              <button
                type="button"
                onClick={() => window.open(result.tabUrl, '_blank')}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-app-surface text-app-action border border-app-border font-bold hover:underline"
              >
                <span>Open original web page</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : sheet && parsed ? (
            <div>
              {/* Metadata Badges */}
              <div className="flex flex-wrap items-center gap-2 mb-5 pb-4 border-b border-app-border/60 text-xs font-mono">
                {sheet.key && (
                  <span className="px-2.5 py-1 rounded-lg bg-app-surface border border-app-border text-app-accent font-bold">
                    Key: {sheet.key}
                  </span>
                )}
                {sheet.capo && (
                  <span className="px-2.5 py-1 rounded-lg bg-app-surface border border-app-border text-app-action">
                    {sheet.capo}
                  </span>
                )}
                {sheet.bpm && (
                  <span className="px-2.5 py-1 rounded-lg bg-app-surface border border-app-border text-app-muted">
                    {sheet.bpm} BPM
                  </span>
                )}
                <a
                  href={result.tabUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-[11px] text-app-action hover:underline"
                >
                  <span>Source Web Link</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Rendered Live Chords */}
              <div className="font-mono text-sm leading-relaxed overflow-x-auto select-text">
                <SongLineRenderer
                  lines={parsed.lines}
                  fontSizePx={15}
                  fontFamily="mono"
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* Modal Footer Actions */}
        <div className="px-5 sm:px-7 py-4 border-t border-app-border bg-app-surface flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-app-muted">
            {imported ? (
              <span className="text-app-action font-bold flex items-center gap-1.5">
                <Check className="w-4 h-4" />
                <span>Successfully added to your local Songbook!</span>
              </span>
            ) : (
              <span>Ready to add to local offline library</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-app-muted hover:text-app-text hover:bg-app-base transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={loading || !sheet}
              onClick={() => handleImport(false)}
              className="px-4 py-2.5 rounded-xl bg-app-base border border-app-action/40 hover:border-app-action text-app-action font-bold text-xs flex items-center gap-2 transition-all cursor-pointer disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Import to Songbook</span>
            </button>

            <button
              type="button"
              disabled={loading || !sheet}
              onClick={() => handleImport(true)}
              className="px-4 py-2.5 rounded-xl bg-app-action text-app-on-action font-bold text-xs flex items-center gap-2 hover:bg-app-action transition-all cursor-pointer shadow-lg disabled:opacity-40 active:scale-95"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Import & Open Stage</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
