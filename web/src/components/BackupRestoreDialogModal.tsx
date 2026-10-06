import React, { useRef, useState } from 'react'
import { CloudUpload, CloudDownload, Download, Copy, Check, AlertCircle, AlertTriangle, X, Database } from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { GTAR_APP_VERSION, GTAR_DEV_VERSION } from '../types/gtar'
import { isDevEnv } from '../utils/env'
import {
  exportRecoveryData,
  createBackupPayload,
  exportAllDataJson,
  parseBackupJson,
  createRestoreSafetySnapshot,
  clearRestoreSafetySnapshot,
  type ParsedBackupResult,
} from '../utils/jsonBackup'
import { restoreBackupSettings } from '../utils/backupSettings'
import { isQuotaError } from '../utils/syncJournal'

interface BackupRestoreDialogModalProps {
  isOpen: boolean
  onClose: () => void
  currentSong?: ActiveSongState
  allSongs: ActiveSongState[]
  setlists?: WebSetlist[]
  onImportAllSongs: (songs: Array<Partial<ActiveSongState>>) => void
  onFullRestoreSongs?: (songs: Array<Partial<ActiveSongState>>) => void
  onFullRestore?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[]) => void | Promise<void>
  onSmartMerge?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[]) => void | Promise<void>
  onOpenAdvancedBridge?: () => void
  storage?: Storage
}

export const BackupRestoreDialogModal: React.FC<BackupRestoreDialogModalProps> = ({
  isOpen,
  onClose,
  allSongs,
  setlists = [],
  onImportAllSongs,
  onFullRestoreSongs,
  onFullRestore,
  onSmartMerge,
  onOpenAdvancedBridge,
  storage,
}) => {
  const targetStorage = storage || (typeof localStorage !== 'undefined' ? localStorage : ({} as Storage))
  const restoreFileInputRef = useRef<HTMLInputElement>(null)
  const [isWipeAndReplace, setIsWipeAndReplace] = useState(false)
  const [showExportOptions, setShowExportOptions] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  )
  const [pendingRestore, setPendingRestore] = useState<{
    rawText: string
    parsed: ParsedBackupResult
  } | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)

  if (!isOpen) return null

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message })
    if (type === 'error') return
    setTimeout(() => {
      setFeedback(null)
      if (type === 'success') {
        onClose()
      }
    }, 2200)
  }

  // Download structured backup JSON file: gtar-stage-backup-YYYY-MM-DD.json
  const handleDownloadBackup = () => {
    try {
      const fileName = exportAllDataJson(allSongs, setlists)
      showFeedback('success', `Exported backup as ${fileName}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      exportRecoveryData({ songs: allSongs, setlists })
      showFeedback('error', `Failed to export backup: ${msg}. A raw recovery archive was downloaded with every original entry.`)
    }
  }

  // Copy backup to clipboard
  const handleCopyBackup = async () => {
    try {
      const jsonContent = JSON.stringify(createBackupPayload(allSongs, setlists,
        isDevEnv ? GTAR_DEV_VERSION : GTAR_APP_VERSION), null, 2)
      await navigator.clipboard.writeText(jsonContent)
      showFeedback('success', 'Backup JSON copied to clipboard!')
    } catch (error) {
      showFeedback('error', error instanceof Error ? error.message : 'Failed to copy to clipboard.')
    }
  }

  const executeRestore = async (parsed: ParsedBackupResult, isDestructive: boolean) => {
    setIsRestoring(true)
    try {
      if (isDestructive && !parsed.isSingleSetlist) {
        if (onFullRestore) {
          await onFullRestore(parsed.songs, parsed.setlists)
        } else if (onFullRestoreSongs) {
          await onFullRestoreSongs(parsed.songs)
        } else {
          onImportAllSongs(parsed.songs)
        }
      } else if (onSmartMerge) {
        await onSmartMerge(parsed.songs, parsed.setlists)
      } else {
        onImportAllSongs(parsed.songs)
      }

      // Parsing and reference validation have succeeded before the first write.
      const { themeMode, customThemeColors, stageSettings } = parsed
      restoreBackupSettings({
        ...(themeMode !== undefined ? { themeMode } : {}),
        ...(customThemeColors !== undefined ? { customThemeColors } : {}),
        ...(stageSettings !== undefined ? { stageSettings } : {}),
      }, targetStorage)

      // Minimum safe recovery policy: delete snapshot only after new library persistence is confirmed
      if (isDestructive) {
        clearRestoreSafetySnapshot(targetStorage)
      }

      setPendingRestore(null)
      showFeedback('success', `Backup restored: ${parsed.songs.length} songs, ${parsed.setlists.length} setlists`)
    } catch (err: unknown) {
      throw err
    } finally {
      setIsRestoring(false)
    }
  }

  // Restore backup from .json file (Wipe & Replace vs Smart Merge)
  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = parseBackupJson(text, { mode: isWipeAndReplace ? 'replace' : 'merge', existingSongs: allSongs })
      if (!parsed.isValid) {
        showFeedback('error', parsed.error || 'Invalid GTAR backup.')
        if (e.target) e.target.value = ''
        return
      }

      if (isWipeAndReplace && !parsed.isSingleSetlist) {
        // ACTION 1: Do NOT immediately mutate the library!
        // Show decision-useful preview summary and wait for explicit confirmation.
        setPendingRestore({ rawText: text, parsed })
        if (e.target) e.target.value = ''
        return
      }

      // ACTION 1: SMART_MERGE_FLOW_MUST_NOT_GAIN_UNNECESSARY_DESTRUCTIVE_CONFIRMATION
      await executeRestore(parsed, false)
    } catch (err: unknown) {
      const msg = isQuotaError(err)
        ? 'Storage quota exceeded: restore aborted and changes could not be saved to device storage.'
        : (err instanceof Error ? err.message : String(err))
      showFeedback('error', `Failed to restore backup: ${msg}`)
    }

    if (e.target) e.target.value = ''
  }

  const handleConfirmWipeAndReplace = async () => {
    if (!pendingRestore) return
    const { parsed } = pendingRestore

    // ACTION 5: Pre-restore safety snapshot for destructive wipe
    try {
      createRestoreSafetySnapshot({ songs: allSongs, setlists }, targetStorage)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showFeedback('error', `Restore aborted: pre-restore safety snapshot failed to save (${msg}). Current library preserved.`)
      setPendingRestore(null)
      return
    }

    // ACTION 4: Coordinate restore success with durable persistence
    try {
      await executeRestore(parsed, true)
    } catch (err: unknown) {
      const msg = isQuotaError(err)
        ? 'Storage quota exceeded: restore aborted and changes could not be saved to device storage.'
        : (err instanceof Error ? err.message : String(err))
      showFeedback('error', `Restore failed: ${msg}. Pre-restore library preserved in safety snapshot.`)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-2xl bg-app-surface border border-app-border shadow-2xl overflow-hidden flex flex-col">
        {/* Hidden file input for SAF backup restore */}
        <input
          ref={restoreFileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleRestoreFile}
          className="hidden"
        />

        {/* Header */}
        <div className="px-6 py-4 border-b border-app-border flex items-center justify-between bg-app-base/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-app-accent/20 border border-app-accent/30 flex items-center justify-center text-app-accent">
              <CloudUpload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-app-heading">
                {pendingRestore ? 'Confirm Full Restore' : 'Backup & Restore'}
              </h2>
              <p className="text-xs text-app-muted">
                {pendingRestore ? 'Review backup contents before replacing library' : 'Manage songbook and setlists backup'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-app-muted hover:text-app-heading hover:bg-app-base transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {feedback && (
            <div
              className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                feedback.type === 'success'
                  ? 'bg-app-action/15 border-app-action/40 text-app-action'
                  : 'bg-[#DC6E67]/15 border-[#DC6E67]/40 text-status-error'
              }`}
            >
              {feedback.type === 'success' ? (
                <Check className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span className="whitespace-pre-wrap">{feedback.message}</span>
            </div>
          )}

          {pendingRestore ? (
            <div className="space-y-4">
              {/* Destructive Warning Alert */}
              <div className="p-3.5 rounded-xl bg-[#DC6E67]/15 border border-[#DC6E67]/40 text-status-error flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-status-error" />
                <div className="text-xs">
                  <div className="font-bold">Destructive Wipe & Replace</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-app-heading">
                    This action will permanently drop your current songs, setlists, and trash, replacing them with the backup contents below.
                  </div>
                </div>
              </div>

              {/* Decision-Useful Summary */}
              <div className="p-4 rounded-xl bg-app-base border border-app-border space-y-2.5">
                <div className="text-xs font-bold text-app-accent border-b border-app-border pb-1.5 flex items-center justify-between">
                  <span>Backup Preview</span>
                  <span className="text-[10px] text-app-muted font-normal">Ready to restore</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-app-muted">App Version:</span>{' '}
                    <span className="font-semibold text-app-heading">
                      {pendingRestore.parsed.metadata?.version || 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-app-muted">Schema Version:</span>{' '}
                    <span className="font-semibold text-app-heading">
                      {pendingRestore.parsed.metadata?.schemaVersion !== undefined
                        ? `v${pendingRestore.parsed.metadata.schemaVersion}`
                        : 'Legacy (unversioned)'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-app-muted">Exported At:</span>{' '}
                    <span className="font-semibold text-app-heading">
                      {pendingRestore.parsed.metadata?.exportedAt
                        ? new Date(pendingRestore.parsed.metadata.exportedAt).toLocaleString()
                        : 'N/A'}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-app-surface border border-app-border">
                    <div className="text-[10px] text-app-muted">Active Songs</div>
                    <div className="text-sm font-bold text-app-action">
                      {pendingRestore.parsed.metadata?.songCount ?? 0}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-app-surface border border-app-border">
                    <div className="text-[10px] text-app-muted">Setlists</div>
                    <div className="text-sm font-bold text-app-action">
                      {pendingRestore.parsed.metadata?.setlistCount ?? 0}
                    </div>
                  </div>
                  <div className="col-span-2 p-2 rounded-lg bg-app-surface border border-app-border flex justify-between items-center">
                    <span className="text-[10px] text-app-muted">Trash Bin (Archived Songs)</span>
                    <span className="text-xs font-semibold text-app-heading">
                      {pendingRestore.parsed.metadata?.trashCount ?? 0}
                    </span>
                  </div>
                </div>
              </div>

              {/* Confirmation Action Buttons */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={isRestoring}
                  onClick={() => setPendingRestore(null)}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-app-base border border-app-border text-xs font-semibold text-app-muted hover:text-app-heading hover:bg-app-surface transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isRestoring}
                  onClick={handleConfirmWipeAndReplace}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-[#DC6E67] hover:bg-[#C95B54] text-white text-xs font-bold transition-all shadow-lg cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <CloudDownload className="w-4 h-4 shrink-0" />
                  <span>{isRestoring ? 'Restoring...' : 'Confirm Wipe & Replace'}</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs text-app-muted leading-relaxed">
                Manage your GTAR songbook and setlists backup:
              </p>

              {/* Option 1: Export Backup */}
              {!showExportOptions ? (
                <button
                  type="button"
                  onClick={() => setShowExportOptions(true)}
                  className="w-full text-left p-4 rounded-xl bg-app-base border border-app-border hover:border-app-accent hover:bg-app-accent/30 transition-all flex items-center gap-3.5 group cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-xl bg-app-surface flex items-center justify-center text-app-accent group-hover:scale-105 transition-transform">
                    <CloudUpload className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-app-heading group-hover:text-app-accent transition-colors">
                      Export Backup
                    </div>
                    <div className="text-[11px] text-app-muted mt-0.5 leading-snug">
                      Save to Device (.json) or share via files
                    </div>
                  </div>
                </button>
              ) : (
                <div className="p-4 rounded-xl bg-app-base border border-app-accent/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-app-accent">Export Backup Options</span>
                    <button
                      type="button"
                      onClick={() => setShowExportOptions(false)}
                      className="text-[11px] text-app-muted hover:text-app-heading"
                    >
                      Back
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadBackup}
                      className="py-2.5 px-3 rounded-xl bg-app-surface border border-app-border hover:border-app-action text-app-heading text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer"
                    >
                      <Download className="w-4 h-4 text-app-action" />
                      <span>Download .json</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyBackup}
                      className="py-2.5 px-3 rounded-xl bg-app-surface border border-app-border hover:border-app-accent text-app-heading text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer"
                    >
                      <Copy className="w-4 h-4 text-app-accent" />
                      <span>Copy JSON</span>
                    </button>
                  </div>

                  {onOpenAdvancedBridge && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose()
                        onOpenAdvancedBridge()
                      }}
                      className="w-full text-center text-[11px] text-app-action hover:underline cursor-pointer pt-1 flex items-center justify-center gap-1"
                    >
                      <Database className="w-3.5 h-3.5" />
                      <span>Open Advanced JSON Bridge Modal</span>
                    </button>
                  )}
                </div>
              )}

              {/* Option 2: Full Restore (Wipe & Replace) */}
              <button
                type="button"
                onClick={() => {
                  setIsWipeAndReplace(true)
                  restoreFileInputRef.current?.click()
                }}
                className="w-full text-left p-4 rounded-xl bg-app-base border border-app-border hover:border-[#DC6E67] hover:bg-app-accent/30 transition-all flex items-center gap-3.5 group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-app-surface flex items-center justify-center text-status-error group-hover:scale-105 transition-transform">
                  <CloudDownload className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-app-heading group-hover:text-status-error transition-colors">
                    Full Restore (Wipe & Replace)
                  </div>
                  <div className="text-[11px] text-app-muted mt-0.5 leading-snug">
                    Drops/resets existing songs & setlists, then imports complete backup
                  </div>
                </div>
              </button>

              {/* Option 3: Restore Backup (Smart Merge) */}
              <button
                type="button"
                onClick={() => {
                  setIsWipeAndReplace(false)
                  restoreFileInputRef.current?.click()
                }}
                className="w-full text-left p-4 rounded-xl bg-app-base border border-app-border hover:border-app-action hover:bg-app-accent/30 transition-all flex items-center gap-3.5 group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-app-surface flex items-center justify-center text-app-action group-hover:scale-105 transition-transform">
                  <CloudDownload className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-app-heading group-hover:text-app-action transition-colors">
                    Restore Backup (Smart Merge)
                  </div>
                  <div className="text-[11px] text-app-muted mt-0.5 leading-snug">
                    Updates existing songs and appends new ones without deleting current local data
                  </div>
                </div>
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        {!pendingRestore && (
          <div className="px-6 py-3 border-t border-app-border bg-app-base/30 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl bg-app-base border border-app-border text-xs font-semibold text-app-muted hover:text-app-heading transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
