import React, { useState } from 'react'
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  ArrowLeft,
} from 'lucide-react'
import type { ActiveSongState } from '../types/gtar'

interface TrashViewProps {
  deletedSongs: ActiveSongState[]
  onRestoreSong: (id: number | string) => void
  onPermanentDeleteSong: (id: number | string) => void
  onEmptyTrash: () => void
  onBackToSongbook: () => void
}

export const TrashView: React.FC<TrashViewProps> = ({
  deletedSongs,
  onRestoreSong,
  onPermanentDeleteSong,
  onEmptyTrash,
  onBackToSongbook,
}) => {
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<ActiveSongState | null>(null)

  return (
    <div className="flex-1 overflow-y-auto bg-app-base px-4 sm:px-8 py-6 max-w-7xl mx-auto w-full select-none animate-fade-in">
      {/* Top Breadcrumb / Back button */}
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={onBackToSongbook}
          className="inline-flex items-center gap-2 text-xs font-bold text-app-action hover:text-app-action cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Songbook</span>
        </button>

        <div className="text-xs font-mono text-app-muted">
          Recycle Bin ({deletedSongs.length})
        </div>
      </div>

      {deletedSongs.length === 0 ? (
        /* Empty Trash State */
        <div className="rounded-3xl border border-app-border bg-app-surface/60 p-12 text-center my-10 max-w-lg mx-auto">
          <div className="w-16 h-16 rounded-full bg-app-base border border-app-border flex items-center justify-center mx-auto mb-4 text-app-muted">
            <Trash2 className="w-8 h-8 opacity-60" />
          </div>
          <h2 className="text-lg font-bold text-app-heading">Trash is Empty</h2>
          <p className="text-xs text-app-muted mt-2 leading-relaxed">
            Songs deleted from your Songbook will appear here.
            <br />
            You can restore them anytime or delete them permanently.
          </p>
          <button
            type="button"
            onClick={onBackToSongbook}
            className="mt-6 px-4 py-2 rounded-xl bg-app-action text-app-on-action font-bold text-xs hover:bg-app-action transition-all cursor-pointer shadow-md"
          >
            Return to Songbook
          </button>
        </div>
      ) : (
        /* Deleted Songs Content */
        <div className="space-y-4">
          {/* Header Row */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-app-surface border border-app-border">
            <div>
              <h1 className="text-base font-black text-app-heading">Recycle Bin</h1>
              <p className="text-xs text-app-muted">
                {deletedSongs.length} deleted {deletedSongs.length === 1 ? 'song' : 'songs'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowEmptyConfirm(true)}
              className="px-3.5 py-2 rounded-xl bg-[#EF4444]/15 hover:bg-[#EF4444]/25 text-status-error border border-[#EF4444]/30 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Empty Trash</span>
            </button>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {deletedSongs.map((song) => {
              const subtitle = [
                song.artist?.trim(),
                song.key ? `Key: ${song.key}` : null,
                song.capo && song.capo !== 'No Capo' ? song.capo : null,
              ]
                .filter(Boolean)
                .join(' • ')

              return (
                <div
                  key={song.id}
                  className="rounded-2xl bg-app-surface/80 border border-app-border p-4 flex flex-col justify-between hover:border-app-action/40 transition-all shadow-sm"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-sm text-app-heading line-clamp-1">
                        {song.title}
                      </h3>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#EF4444]/20 text-status-error">
                        Deleted
                      </span>
                    </div>

                    <div className="text-xs text-app-muted mt-1 line-clamp-1">
                      {subtitle || 'No artist specified'}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-app-border/60">
                    <button
                      type="button"
                      onClick={() => onRestoreSong(song.id ?? '')}
                      className="px-3 py-1.5 rounded-xl bg-app-action/20 hover:bg-app-action/30 text-app-action border border-app-action/40 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                      title="Restore song to Songbook library"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restore</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPermanentDeleteTarget(song)}
                      className="p-1.5 rounded-xl text-status-error hover:bg-[#EF4444]/15 border border-transparent hover:border-[#EF4444]/30 transition-all cursor-pointer"
                      title="Permanently delete this song"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Empty Trash */}
      {showEmptyConfirm && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-app-base border border-[#EF4444]/60 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 text-status-error">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-sm font-bold text-app-heading">Empty Trash?</h3>
            </div>
            <p className="text-xs text-app-muted leading-relaxed">
              This will permanently delete all {deletedSongs.length} songs currently in the Trash. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowEmptyConfirm(false)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold text-app-text hover:bg-app-surface cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onEmptyTrash()
                  setShowEmptyConfirm(false)
                }}
                className="px-3.5 py-1.5 rounded-xl bg-[#EF4444] text-white text-xs font-bold hover:bg-[#DC2626] transition-colors cursor-pointer shadow-md"
              >
                Permanently Empty
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Delete Single Song Permanently */}
      {permanentDeleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-app-base border border-[#EF4444]/60 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 text-status-error">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-sm font-bold text-app-heading">Delete Permanently?</h3>
            </div>
            <p className="text-xs text-app-muted leading-relaxed">
              Permanently delete &quot;{permanentDeleteTarget.title}&quot;? You will not be able to recover this song.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPermanentDeleteTarget(null)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold text-app-text hover:bg-app-surface cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onPermanentDeleteSong(permanentDeleteTarget.id ?? '')
                  setPermanentDeleteTarget(null)
                }}
                className="px-3.5 py-1.5 rounded-xl bg-[#EF4444] text-white text-xs font-bold hover:bg-[#DC2626] transition-colors cursor-pointer shadow-md"
              >
                Delete Forever
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
