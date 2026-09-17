import React, { useRef, useState } from 'react'
import { CloudUpload, CloudDownload, Download, Copy, Check, AlertCircle, X, Database } from 'lucide-react'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { GTAR_APP_VERSION, GTAR_DEV_VERSION } from '../types/gtar'
import { isDevEnv } from '../utils/env'
import { exportRecoveryData, createBackupPayload, exportAllDataJson, parseBackupJson } from '../utils/jsonBackup'
import { restoreBackupSettings } from '../utils/backupSettings'

interface BackupRestoreDialogModalProps {
  isOpen: boolean
  onClose: () => void
  currentSong: ActiveSongState
  allSongs: ActiveSongState[]
  setlists?: WebSetlist[]
  onImportAllSongs: (songs: Array<Partial<ActiveSongState>>) => void
  onFullRestoreSongs?: (songs: Array<Partial<ActiveSongState>>) => void
  onFullRestore?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[]) => void
  onSmartMerge?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[]) => void
  onOpenAdvancedBridge?: () => void
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
}) => {
  const restoreFileInputRef = useRef<HTMLInputElement>(null)
  const [isWipeAndReplace, setIsWipeAndReplace] = useState(false)
  const [showExportOptions, setShowExportOptions] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  )

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

  // Restore backup from .json file (Wipe & Replace vs Smart Merge)
  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = parseBackupJson(text, { mode: isWipeAndReplace ? 'replace' : 'merge', existingSongs: allSongs })
      if (!parsed.isValid) {
        showFeedback('error', parsed.error || 'Invalid GTAR backup.')
        return
      }
      if (isWipeAndReplace && !parsed.isSingleSetlist) {
        if (onFullRestore) onFullRestore(parsed.songs, parsed.setlists)
        else if (onFullRestoreSongs) onFullRestoreSongs(parsed.songs)
        else onImportAllSongs(parsed.songs)
      } else if (onSmartMerge) onSmartMerge(parsed.songs, parsed.setlists)
      else onImportAllSongs(parsed.songs)

      // Parsing and reference validation have succeeded before the first write.
      const { themeMode, customThemeColors, stageSettings } = parsed
      restoreBackupSettings({
        ...(themeMode !== undefined ? { themeMode } : {}),
        ...(customThemeColors !== undefined ? { customThemeColors } : {}),
        ...(stageSettings !== undefined ? { stageSettings } : {}),
      })
      showFeedback('success', `Backup restored: ${parsed.songs.length} songs, ${parsed.setlists.length} setlists`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showFeedback('error', `Failed to parse backup JSON: ${msg}`)
    }

    if (e.target) e.target.value = ''
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-2xl bg-[#073642] border border-[#1A4A55] shadow-2xl overflow-hidden flex flex-col">
        {/* Hidden file input for SAF backup restore */}
        <input
          ref={restoreFileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleRestoreFile}
          className="hidden"
        />

        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1A4A55] flex items-center justify-between bg-[#002B36]/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#B58900]/20 border border-[#B58900]/30 flex items-center justify-center text-[#B58900]">
              <CloudUpload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#FDF6E3]">Backup & Restore</h2>
              <p className="text-xs text-[#93A1A1]">Manage songbook and setlists backup</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#002B36] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <p className="text-xs text-[#93A1A1] leading-relaxed">
            Manage your GTAR songbook and setlists backup:
          </p>

          {feedback && (
            <div
              className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                feedback.type === 'success'
                  ? 'bg-[#2AA198]/15 border-[#2AA198]/40 text-[#2AA198]'
                  : 'bg-[#DC6E67]/15 border-[#DC6E67]/40 text-[#DC6E67]'
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

          {/* Option 1: Export Backup */}
          {!showExportOptions ? (
            <button
              type="button"
              onClick={() => setShowExportOptions(true)}
              className="w-full text-left p-4 rounded-xl bg-[#002B36] border border-[#1A4A55] hover:border-[#B58900] hover:bg-[#094352]/30 transition-all flex items-center gap-3.5 group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-[#073642] flex items-center justify-center text-[#B58900] group-hover:scale-105 transition-transform">
                <CloudUpload className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-[#FDF6E3] group-hover:text-[#B58900] transition-colors">
                  Export Backup
                </div>
                <div className="text-[11px] text-[#93A1A1] mt-0.5 leading-snug">
                  Save to Device (.json) or share via files
                </div>
              </div>
            </button>
          ) : (
            <div className="p-4 rounded-xl bg-[#002B36] border border-[#B58900]/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#B58900]">Export Backup Options</span>
                <button
                  type="button"
                  onClick={() => setShowExportOptions(false)}
                  className="text-[11px] text-[#93A1A1] hover:text-[#FDF6E3]"
                >
                  Back
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  className="py-2.5 px-3 rounded-xl bg-[#073642] border border-[#1A4A55] hover:border-[#2AA198] text-[#FDF6E3] text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4 text-[#2AA198]" />
                  <span>Download .json</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyBackup}
                  className="py-2.5 px-3 rounded-xl bg-[#073642] border border-[#1A4A55] hover:border-[#B58900] text-[#FDF6E3] text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer"
                >
                  <Copy className="w-4 h-4 text-[#B58900]" />
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
                  className="w-full text-center text-[11px] text-[#2AA198] hover:underline cursor-pointer pt-1 flex items-center justify-center gap-1"
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
            className="w-full text-left p-4 rounded-xl bg-[#002B36] border border-[#1A4A55] hover:border-[#DC6E67] hover:bg-[#094352]/30 transition-all flex items-center gap-3.5 group cursor-pointer"
          >
            <div className="w-10 h-10 rounded-xl bg-[#073642] flex items-center justify-center text-[#DC6E67] group-hover:scale-105 transition-transform">
              <CloudDownload className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-[#FDF6E3] group-hover:text-[#DC6E67] transition-colors">
                Full Restore (Wipe & Replace)
              </div>
              <div className="text-[11px] text-[#93A1A1] mt-0.5 leading-snug">
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
            className="w-full text-left p-4 rounded-xl bg-[#002B36] border border-[#1A4A55] hover:border-[#2AA198] hover:bg-[#094352]/30 transition-all flex items-center gap-3.5 group cursor-pointer"
          >
            <div className="w-10 h-10 rounded-xl bg-[#073642] flex items-center justify-center text-[#2AA198] group-hover:scale-105 transition-transform">
              <CloudDownload className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-[#FDF6E3] group-hover:text-[#2AA198] transition-colors">
                Restore Backup (Smart Merge)
              </div>
              <div className="text-[11px] text-[#93A1A1] mt-0.5 leading-snug">
                Updates existing songs and appends new ones without deleting current local data
              </div>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#1A4A55] bg-[#002B36]/30 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#002B36] border border-[#1A4A55] text-xs font-semibold text-[#93A1A1] hover:text-[#FDF6E3] transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
