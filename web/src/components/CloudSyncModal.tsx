import type { TagColors } from '../utils/songTags'
import { TagLibraryContext } from '../utils/tagLibraryContext'
import type { SetlistFolder } from '../types/gtar'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FolderArchive, X } from 'lucide-react'
import { readPersistedLibrary } from '../utils/syncJournal'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import type { ExportEnvironment } from '../utils/backupExport'
import { DeviceBackupCard } from './DeviceBackupCard'

export interface CloudSyncModalProps {
  isOpen: boolean
  onClose: () => void
  restoreBlocked?: boolean
  onFullRestore?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[], folders?: SetlistFolder[], tagColors?: TagColors) => void | Promise<void>
  onSmartMerge?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[], folders?: SetlistFolder[], tagColors?: TagColors) => unknown
  /** App library (songs including trash) for the file card; read from device storage when omitted. */
  deviceSongs?: ActiveSongState[]
  folders?: SetlistFolder[]
  deviceSetlists?: WebSetlist[]
  onImportAllSongs?: (songs: Array<Partial<ActiveSongState>>) => void
  /** Test seam for the share sheet, file and download APIs. */
  exportEnv?: ExportEnvironment
}

const safe = <T,>(read: () => T, fallback: T): T => { try { return read() } catch { return fallback } }
const NO_SONGS: ActiveSongState[] = []
const NO_SETLISTS: WebSetlist[] = []
const noImport = () => { throw new Error('Restore unavailable') }

/** Stored library, read during render (never a stale or empty first frame) and again when this or another tab saves. */
function usePersistedLibrary(enabled: boolean) {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const bump = () => setRevision(value => value + 1)
    window.addEventListener('gtar-library-persisted', bump)
    window.addEventListener('storage', bump)
    return () => { window.removeEventListener('gtar-library-persisted', bump); window.removeEventListener('storage', bump) }
  }, [enabled])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `revision` is the re-read trigger.
  return useMemo(() => enabled ? safe(() => readPersistedLibrary(), null) : null, [enabled, revision])
}

export const CloudSyncModal: React.FC<CloudSyncModalProps> = ({
  isOpen, onClose, onFullRestore, onSmartMerge, restoreBlocked = false, deviceSongs, deviceSetlists, folders, onImportAllSongs, exportEnv,
}) => {
  const [fileBusy, setFileBusy] = useState(false)
  const persisted = usePersistedLibrary(isOpen)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    closeButtonRef.current?.focus({ preventScroll: true })
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !fileBusy) {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [isOpen, fileBusy, onClose])

  if (!isOpen) return null

  const fileSongs = deviceSongs ?? (persisted?.songs as ActiveSongState[] | undefined) ?? NO_SONGS
  const fileSetlists = deviceSetlists ?? persisted?.setlists ?? NO_SETLISTS

  return (
    <div
      data-testid="cloud-sync-modal-backdrop"
      onClick={event => { if (event.target === event.currentTarget && !fileBusy) onClose() }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Backup & Restore"
        data-testid="cloud-sync-modal-card"
        className="w-full max-w-lg rounded-2xl border border-app-border bg-app-surface text-app-heading shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div data-testid="cloud-sync-modal-header" className="px-5 py-3.5 border-b border-app-border/80 flex items-center justify-between bg-app-base/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-app-action/20 border border-app-action/40 flex items-center justify-center text-app-action">
              <FolderArchive className="w-4 h-4" aria-hidden="true" />
            </div>
            <h2 className="font-extrabold text-sm sm:text-base tracking-wide">Backup &amp; Restore</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            disabled={fileBusy}
            aria-label="Close"
            className="w-9 h-9 rounded-xl hover:bg-app-base flex items-center justify-center text-app-muted hover:text-app-heading transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div data-testid="cloud-sync-modal-body" className="p-5 space-y-4 overflow-y-auto flex-1">
          <TagLibraryContext.Provider value={{ colors: persisted?.tagColors }}>
            <DeviceBackupCard
              folders={folders ?? persisted?.folders}
              isOpen={isOpen}
              allSongs={fileSongs}
              setlists={fileSetlists}
              onImportAllSongs={onImportAllSongs ?? noImport}
              onFullRestore={onFullRestore}
              onSmartMerge={onSmartMerge}
              restoreBlocked={restoreBlocked}
              onBusyChange={setFileBusy}
              exportEnv={exportEnv}
            />
          </TagLibraryContext.Provider>
        </div>

        <div data-testid="cloud-sync-modal-footer" className="px-5 py-3.5 border-t border-app-border/80 bg-app-base/60 flex items-center justify-end gap-2 text-xs text-app-muted">
          <button
            type="button"
            data-testid="cloud-sync-close-button"
            disabled={fileBusy}
            onClick={onClose}
            className="min-h-11 px-4 py-2 rounded-xl bg-app-base hover:bg-app-surface border border-app-border text-app-heading text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export const BackupRestoreModal = CloudSyncModal
