import React, { useState, useEffect, useCallback, useRef } from 'react'
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
import { useOptionalGoogleAuth } from '../utils/authContext'
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
  onSyncStateChange?: (status: CloudSyncStatus, isProcessing: boolean) => void
}

export const CloudSyncModal: React.FC<CloudSyncModalProps> = ({
  isOpen,
  onClose,
  onSyncApplied,
  onSyncStateChange,
}) => {
  const authContext = useOptionalGoogleAuth()

  const session = authContext?.session
  const token = session?.sessionToken || session?.idToken || session?.token
  const isAuthenticated = Boolean(session && token && authContext?.accessStatus === 'active')

  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('IDLE')
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [conflicts, setConflicts] = useState<ConflictingItem[]>([])
  const [lastMeta, setLastMeta] = useState(() => readCloudSyncMeta())

  // Parent callbacks can change when applying React state; that must not start another sync.
  const onSyncAppliedRef = useRef(onSyncApplied)
  useEffect(() => { onSyncAppliedRef.current = onSyncApplied }, [onSyncApplied])

  const refreshSyncState = useCallback(async () => {
    if (!token || !isAuthenticated) return
    setIsProcessing(true)
    setErrorMessage('')
    try {
      const result = await performCloudSongbookSync(token)
      setSyncStatus(result.status)
      setLastMeta(readCloudSyncMeta())

      if (result.success) {
        if (result.updatedLibrary) onSyncAppliedRef.current?.(result.updatedLibrary)
        if (result.actionTaken === 'NONE') {
          setStatusMessage('')
        } else if (result.actionTaken === 'UPLOADED') {
          setStatusMessage('Local songbook uploaded to cloud successfully.')
        } else if (result.actionTaken === 'DOWNLOADED') {
          setStatusMessage('Newer cloud songbook downloaded to this device.')
        } else if (result.actionTaken === 'MERGED') {
          setStatusMessage('Songbooks merged safely. All changes preserved.')
        }
      } else if (result.status === 'CONFLICT') {
        setStatusMessage('Conflicting edits detected between this device and the cloud.')
        setErrorMessage(result.error || '')
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
  }, [token, isAuthenticated])

  useEffect(() => {
    if (isOpen && isAuthenticated) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the external sync request with its existing synchronous busy guard.
      void refreshSyncState()
    }
  }, [isOpen, isAuthenticated, refreshSyncState])

  useEffect(() => {
    onSyncStateChange?.(syncStatus, isProcessing)
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        const Evt = window.CustomEvent || CustomEvent
        window.dispatchEvent(
          new Evt('gtar:cloud_sync_state', {
            detail: { status: syncStatus, isProcessing },
          })
        )
      } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
    }
  }, [syncStatus, isProcessing, onSyncStateChange])

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
  void handleForceUpload

  const handleForceDownload = async () => {
    await handleResolveConflict('download')
  }

  const currentLocal = typeof localStorage !== 'undefined' ? readPersistedLibrary() : null
  const localChecksum = currentLocal ? computeSongbookChecksum(currentLocal) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in">
      <div
        className="w-full max-w-lg rounded-2xl border border-app-border bg-app-surface text-app-heading shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-app-border/80 flex items-center justify-between bg-app-base/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-app-action/20 border border-app-action/40 flex items-center justify-center text-app-action">
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
            className="w-8 h-8 rounded-xl hover:bg-app-base flex items-center justify-center text-app-muted hover:text-app-heading transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* User Account Info */}
          <div className="p-3.5 rounded-xl bg-app-base/70 border border-app-border flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {session?.user?.picture ? (
                <img
                  src={session.user.picture}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full border border-app-action/40 shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-app-border flex items-center justify-center text-app-muted shrink-0">
                  <User className="w-4 h-4" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-xs font-bold truncate">
                  {session?.user?.name || session?.user?.email || 'Guest / Offline'}
                </div>
                <div className="text-[10px] text-app-muted truncate">
                  {isAuthenticated ? session?.user?.email : 'Not signed in with approved account'}
                </div>
              </div>
            </div>

            <div className="shrink-0 text-right">
              {isAuthenticated ? (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-app-action/20 text-app-action border border-app-action/40">
                  Active {session?.user?.role === 'admin' ? 'Admin' : 'Member'}
                </span>
              ) : (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#DC6E67]/20 text-status-error border border-[#DC6E67]/40">
                  Auth Required
                </span>
              )}
            </div>
          </div>

          {/* Sync Status Card */}
          <div className="p-4 rounded-xl bg-app-base/90 border border-app-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-app-muted uppercase tracking-wider font-mono">
                Sync Status
              </span>
              <div>
                {syncStatus === 'IN_SYNC' && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-500/20 text-status-success border border-emerald-500/40 inline-flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    <span>In Sync</span>
                  </span>
                )}
                {syncStatus === 'LOCAL_NEWER' && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-amber-400/20 text-status-warning border border-amber-400/40 inline-flex items-center gap-1.5">
                    <CloudUpload className="w-3.5 h-3.5" />
                    <span>Local Newer</span>
                  </span>
                )}
                {syncStatus === 'CLOUD_NEWER' && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-sky-500/20 text-status-info border border-sky-500/40 inline-flex items-center gap-1.5">
                    <CloudDownload className="w-3.5 h-3.5" />
                    <span>Cloud Newer</span>
                  </span>
                )}
                {syncStatus === 'CONFLICT' && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-[#DC6E67]/20 text-status-error border border-[#DC6E67]/40 inline-flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Conflict</span>
                  </span>
                )}
                {syncStatus === 'OFFLINE' && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-app-muted/20 text-app-muted border border-app-muted/40 inline-flex items-center gap-1.5">
                    <CloudOff className="w-3.5 h-3.5" />
                    <span>Offline</span>
                  </span>
                )}
                {(syncStatus === 'IDLE' || syncStatus === 'SYNCING') && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-app-border/40 text-app-muted border border-app-border inline-flex items-center gap-1.5">
                    <RefreshCw className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} />
                    <span>{isProcessing ? 'Syncing...' : 'Idle'}</span>
                  </span>
                )}
                {syncStatus === 'ERROR' && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-[#DC6E67]/20 text-status-error border border-[#DC6E67]/40 inline-flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Error</span>
                  </span>
                )}
              </div>
            </div>

            {/* Status Message / Description */}
            {statusMessage && (
              <p className="text-xs text-app-action bg-app-action/10 p-2.5 rounded-lg border border-app-action/20">
                {statusMessage}
              </p>
            )}

            {errorMessage && (
              <p className="text-xs text-status-error bg-[#DC6E67]/10 p-2.5 rounded-lg border border-[#DC6E67]/20">
                {errorMessage}
              </p>
            )}

            {/* Metadata Details */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-app-border/60 text-[11px] font-mono">
              <div>
                <span className="text-app-muted block">Last Synced</span>
                <span className="text-app-heading font-semibold">
                  {lastMeta.lastSyncedAt
                    ? new Date(lastMeta.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : 'Never'}
                </span>
              </div>
              <div>
                <span className="text-app-muted block">Fingerprint</span>
                <span className="text-app-action truncate block text-[10px]" title={localChecksum || undefined}>
                  {localChecksum || 'None'}
                </span>
              </div>
            </div>
          </div>

          {/* Conflict Resolution Section */}
          {syncStatus === 'CONFLICT' && conflicts.length > 0 && (
            <div className="p-4 rounded-xl bg-[#DC6E67]/10 border border-[#DC6E67]/40 space-y-3">
              <div className="flex items-center gap-2 text-status-error">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <h3 className="font-bold text-xs">Conflict Resolution</h3>
              </div>
              <p className="text-[11px] text-app-text">
                Independent edits were made on this device and on the cloud. Choose how you want to resolve this:
              </p>

              <div className="max-h-32 overflow-y-auto space-y-1.5 p-2 rounded-lg bg-app-base/80 text-[11px]">
                {conflicts.map((item, idx) => (
                  <div key={`${item.id}-${idx}`} className="flex items-center justify-between text-xs py-0.5">
                    <span className="text-app-heading font-semibold truncate flex items-center gap-1.5">
                      {item.type === 'song' ? <FileText className="w-3 h-3 text-app-action" /> : <Layers className="w-3 h-3 text-app-accent" />}
                      {item.title}
                    </span>
                    <span className="text-[10px] text-status-error font-mono shrink-0">Diverged</span>
                  </div>
                ))}
              </div>

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleResolveConflict('merge_preserve')}
                  disabled={isProcessing}
                  className="w-full py-2 px-3 rounded-xl bg-app-action hover:bg-app-action text-app-on-action font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm disabled:opacity-50"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Merge &amp; Preserve Both (Keep Conflict Copies)</span>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleResolveConflict('upload')}
                    disabled={isProcessing}
                    className="py-1.5 px-3 rounded-lg bg-app-base hover:bg-app-border text-app-heading border border-app-border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <CloudUpload className="w-3.5 h-3.5 text-app-accent" />
                    <span>Keep Local Only</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleResolveConflict('download')}
                    disabled={isProcessing}
                    className="py-1.5 px-3 rounded-lg bg-app-base hover:bg-app-border text-app-heading border border-app-border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <CloudDownload className="w-3.5 h-3.5 text-app-link" />
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
              data-testid="sync-now-button"
              onClick={refreshSyncState}
              disabled={isProcessing || !isAuthenticated}
              className="w-full py-2.5 px-4 rounded-xl bg-app-action hover:bg-app-action text-app-on-action font-extrabold text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-98 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} />
              <span>{isProcessing ? 'Synchronizing...' : 'Sync Now'}</span>
            </button>

            <button
              type="button"
              data-testid="download-from-cloud-button"
              onClick={handleForceDownload}
              disabled={isProcessing || !isAuthenticated}
              className="w-full py-2 px-3 rounded-xl bg-app-base hover:bg-app-border text-app-muted hover:text-app-action border border-app-border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              title="Download from cloud library to device"
            >
              <CloudDownload className="w-3.5 h-3.5 text-app-link" />
              <span>Download from Cloud</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-app-border/80 bg-app-base/60 flex items-center justify-between text-[11px] text-app-muted">
          <span>Offline edits preserved safely</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-app-border/50 hover:bg-app-border text-app-heading font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
