import React, { useState, useEffect, useCallback } from 'react'
import {
  Cloud,
  CloudUpload,
  CloudDownload,
  CloudOff,
  RefreshCw,
  Check,
  AlertTriangle,
  AlertCircle,
  X,
  User,
  Shield,
  Layers,
  FileText,
} from 'lucide-react'
import { useGoogleAuth } from './AuthGate'
import {
  performCloudSongbookSync,
  readCloudSyncMeta,
  computeSongbookChecksum,
  type CloudSyncStatus,
  type CloudSyncResult,
  type ConflictingItem,
} from '../utils/cloudSongbookSync'
import { readPersistedLibrary } from '../utils/syncJournal'
import type { SyncLibrary } from '../utils/syncMerge'

interface CloudSyncModalProps {
  isOpen: boolean
  onClose: () => void
  onSyncApplied?: (updatedLibrary: SyncLibrary) => void
}

export const CloudSyncModal: React.FC<CloudSyncModalProps> = ({
  isOpen,
  onClose,
  onSyncApplied,
}) => {
  let authContext
  try {
    authContext = useGoogleAuth()
  } catch {
    authContext = null
  }

  const session = authContext?.session
  const token = session?.sessionToken || session?.idToken || session?.token
  const isAuthenticated = Boolean(session && token && authContext?.accessStatus === 'active')

  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('IDLE')
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [conflicts, setConflicts] = useState<ConflictingItem[]>([])
  const [lastMeta, setLastMeta] = useState(() => readCloudSyncMeta())

  const refreshSyncState = useCallback(async () => {
    if (!token || !isAuthenticated) return
    setIsProcessing(true)
    setErrorMessage('')
    try {
      const result = await performCloudSongbookSync(token)
      setSyncStatus(result.status)
      setLastMeta(readCloudSyncMeta())

      if (result.success) {
        if (result.actionTaken === 'NONE') {
          setStatusMessage('')
        } else if (result.actionTaken === 'UPLOADED') {
          setStatusMessage('Local songbook uploaded to cloud successfully.')
        } else if (result.actionTaken === 'DOWNLOADED') {
          setStatusMessage('Newer cloud songbook downloaded to this device.')
          if (result.updatedLibrary && onSyncApplied) {
            onSyncApplied(result.updatedLibrary)
          }
        } else if (result.actionTaken === 'MERGED') {
          setStatusMessage('Songbooks merged safely. All changes preserved.')
          if (result.updatedLibrary && onSyncApplied) {
            onSyncApplied(result.updatedLibrary)
          }
        }
      } else if (result.status === 'CONFLICT') {
        setStatusMessage('Conflicting edits detected between this device and the cloud.')
        setConflicts(result.conflicts || [])
      } else {
        setErrorMessage(result.error || 'Failed to sync with cloud.')
      }
    } catch (err) {
      setSyncStatus('ERROR')
      setErrorMessage(err instanceof Error ? err.message : 'Sync failed.')
    } finally {
      setIsProcessing(false)
    }
  }, [token, isAuthenticated, onSyncApplied])

  useEffect(() => {
    if (isOpen && isAuthenticated) {
      void refreshSyncState()
    }
  }, [isOpen, isAuthenticated, refreshSyncState])

  if (!isOpen) return null

  const handleResolveConflict = async (forceAction: 'upload' | 'download' | 'merge_preserve') => {
    if (!token) return
    setIsProcessing(true)
    setErrorMessage('')
    try {
      const result: CloudSyncResult = await performCloudSongbookSync(token, { forceAction })
      setSyncStatus(result.status)
      setLastMeta(readCloudSyncMeta())
      if (result.success) {
        setConflicts([])
        if (forceAction === 'merge_preserve') {
          setStatusMessage('Merged local and cloud songbooks safely with conflict copies.')
        } else if (forceAction === 'upload') {
          setStatusMessage('Uploaded local songbook to cloud.')
        } else {
          setStatusMessage('Downloaded cloud songbook (local safety backup saved).')
        }
        if (result.updatedLibrary && onSyncApplied) {
          onSyncApplied(result.updatedLibrary)
        }
      } else {
        setErrorMessage(result.error || 'Resolution failed.')
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Resolution failed.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleForceUpload = async () => {
    await handleResolveConflict('upload')
  }

  const handleForceDownload = async () => {
    await handleResolveConflict('download')
  }

  const currentLocal = typeof localStorage !== 'undefined' ? readPersistedLibrary() : null
  const localChecksum = currentLocal ? computeSongbookChecksum(currentLocal) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in">
      <div
        className="w-full max-w-lg rounded-2xl border border-[#1A4A55] bg-[#073642] text-[#FDF6E3] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1A4A55]/80 flex items-center justify-between bg-[#002B36]/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#2AA198]/20 border border-[#2AA198]/40 flex items-center justify-center text-[#2AA198]">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-extrabold text-sm sm:text-base tracking-wide">
                Cloud Songbook Sync
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl hover:bg-[#002B36] flex items-center justify-center text-[#93A1A1] hover:text-[#FDF6E3] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* User Account Info */}
          <div className="p-3.5 rounded-xl bg-[#002B36]/70 border border-[#1A4A55] flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {session?.user?.picture ? (
                <img
                  src={session.user.picture}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full border border-[#2AA198]/40 shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-[#1A4A55] flex items-center justify-center text-[#93A1A1] shrink-0">
                  <User className="w-4 h-4" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-xs font-bold truncate">
                  {session?.user?.name || session?.user?.email || 'Guest / Offline'}
                </div>
                <div className="text-[10px] text-[#93A1A1] truncate">
                  {isAuthenticated ? session?.user?.email : 'Not signed in with approved account'}
                </div>
              </div>
            </div>

            <div className="shrink-0 text-right">
              {isAuthenticated ? (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#2AA198]/20 text-[#2AA198] border border-[#2AA198]/40">
                  Active {session?.user?.role === 'admin' ? 'Admin' : 'Member'}
                </span>
              ) : (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#DC6E67]/20 text-[#DC6E67] border border-[#DC6E67]/40">
                  Auth Required
                </span>
              )}
            </div>
          </div>

          {/* Sync Status Card */}
          <div className="p-4 rounded-xl bg-[#002B36]/90 border border-[#1A4A55] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#93A1A1] uppercase tracking-wider font-mono">
                Sync Status
              </span>
              <div>
                {syncStatus === 'IN_SYNC' && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-[#2AA198]/20 text-[#2AA198] border border-[#2AA198]/40 inline-flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    <span>In Sync</span>
                  </span>
                )}
                {syncStatus === 'LOCAL_NEWER' && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-[#B58900]/20 text-[#B58900] border border-[#B58900]/40 inline-flex items-center gap-1.5">
                    <CloudUpload className="w-3.5 h-3.5" />
                    <span>Local Newer</span>
                  </span>
                )}
                {syncStatus === 'CLOUD_NEWER' && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-[#268BD2]/20 text-[#268BD2] border border-[#268BD2]/40 inline-flex items-center gap-1.5">
                    <CloudDownload className="w-3.5 h-3.5" />
                    <span>Cloud Newer</span>
                  </span>
                )}
                {syncStatus === 'CONFLICT' && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-[#DC6E67]/20 text-[#DC6E67] border border-[#DC6E67]/40 inline-flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Conflict</span>
                  </span>
                )}
                {syncStatus === 'OFFLINE' && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-[#93A1A1]/20 text-[#93A1A1] border border-[#93A1A1]/40 inline-flex items-center gap-1.5">
                    <CloudOff className="w-3.5 h-3.5" />
                    <span>Offline</span>
                  </span>
                )}
                {(syncStatus === 'IDLE' || syncStatus === 'SYNCING') && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-[#1A4A55]/40 text-[#93A1A1] border border-[#1A4A55] inline-flex items-center gap-1.5">
                    <RefreshCw className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} />
                    <span>{isProcessing ? 'Syncing...' : 'Idle'}</span>
                  </span>
                )}
                {syncStatus === 'ERROR' && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-[#DC6E67]/20 text-[#DC6E67] border border-[#DC6E67]/40 inline-flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Error</span>
                  </span>
                )}
              </div>
            </div>

            {/* Status Message / Description */}
            {statusMessage && (
              <p className="text-xs text-[#2AA198] bg-[#2AA198]/10 p-2.5 rounded-lg border border-[#2AA198]/20">
                {statusMessage}
              </p>
            )}

            {errorMessage && (
              <p className="text-xs text-[#DC6E67] bg-[#DC6E67]/10 p-2.5 rounded-lg border border-[#DC6E67]/20">
                {errorMessage}
              </p>
            )}

            {/* Metadata Details */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1A4A55]/60 text-[11px] font-mono">
              <div>
                <span className="text-[#93A1A1] block">Last Synced</span>
                <span className="text-[#FDF6E3] font-semibold">
                  {lastMeta.lastSyncedAt
                    ? new Date(lastMeta.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : 'Never'}
                </span>
              </div>
              <div>
                <span className="text-[#93A1A1] block">Fingerprint</span>
                <span className="text-[#2AA198] truncate block text-[10px]" title={localChecksum || undefined}>
                  {localChecksum || 'None'}
                </span>
              </div>
            </div>
          </div>

          {/* Conflict Resolution Section */}
          {syncStatus === 'CONFLICT' && conflicts.length > 0 && (
            <div className="p-4 rounded-xl bg-[#DC6E67]/10 border border-[#DC6E67]/40 space-y-3">
              <div className="flex items-center gap-2 text-[#DC6E67]">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <h3 className="font-bold text-xs">Conflict Resolution</h3>
              </div>
              <p className="text-[11px] text-[#EEE8D5]">
                Independent edits were made on this device and on the cloud. Choose how you want to resolve this:
              </p>

              <div className="max-h-32 overflow-y-auto space-y-1.5 p-2 rounded-lg bg-[#002B36]/80 text-[11px]">
                {conflicts.map((item, idx) => (
                  <div key={`${item.id}-${idx}`} className="flex items-center justify-between text-xs py-0.5">
                    <span className="text-[#FDF6E3] font-semibold truncate flex items-center gap-1.5">
                      {item.type === 'song' ? <FileText className="w-3 h-3 text-[#2AA198]" /> : <Layers className="w-3 h-3 text-[#B58900]" />}
                      {item.title}
                    </span>
                    <span className="text-[10px] text-[#DC6E67] font-mono shrink-0">Diverged</span>
                  </div>
                ))}
              </div>

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleResolveConflict('merge_preserve')}
                  disabled={isProcessing}
                  className="w-full py-2 px-3 rounded-xl bg-[#2AA198] hover:bg-[#35B8AD] text-[#002B36] font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm disabled:opacity-50"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Merge &amp; Preserve Both (Keep Conflict Copies)</span>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleResolveConflict('upload')}
                    disabled={isProcessing}
                    className="py-1.5 px-3 rounded-lg bg-[#002B36] hover:bg-[#1A4A55] text-[#FDF6E3] border border-[#1A4A55] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <CloudUpload className="w-3.5 h-3.5 text-[#B58900]" />
                    <span>Keep Local Only</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleResolveConflict('download')}
                    disabled={isProcessing}
                    className="py-1.5 px-3 rounded-lg bg-[#002B36] hover:bg-[#1A4A55] text-[#FDF6E3] border border-[#1A4A55] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <CloudDownload className="w-3.5 h-3.5 text-[#268BD2]" />
                    <span>Download Cloud</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Sync Actions */}
          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={refreshSyncState}
              disabled={isProcessing || !isAuthenticated}
              className="w-full py-2.5 px-4 rounded-xl bg-[#2AA198] hover:bg-[#35B8AD] text-[#002B36] font-extrabold text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-98 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} />
              <span>{isProcessing ? 'Synchronizing...' : 'Sync Now'}</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleForceUpload}
                disabled={isProcessing || !isAuthenticated}
                className="py-2 px-3 rounded-xl bg-[#002B36] hover:bg-[#1A4A55] text-[#FDF6E3] hover:text-[#2AA198] border border-[#1A4A55] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                title="Force upload local library to cloud"
              >
                <CloudUpload className="w-3.5 h-3.5 text-[#B58900]" />
                <span>Upload to Cloud</span>
              </button>

              <button
                type="button"
                onClick={handleForceDownload}
                disabled={isProcessing || !isAuthenticated}
                className="py-2 px-3 rounded-xl bg-[#002B36] hover:bg-[#1A4A55] text-[#FDF6E3] hover:text-[#2AA198] border border-[#1A4A55] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                title="Force download cloud library to device"
              >
                <CloudDownload className="w-3.5 h-3.5 text-[#268BD2]" />
                <span>Download from Cloud</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1A4A55]/80 bg-[#002B36]/60 flex items-center justify-between text-[11px] text-[#93A1A1]">
          <span>Offline edits preserved safely</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-[#1A4A55]/50 hover:bg-[#1A4A55] text-[#FDF6E3] font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
