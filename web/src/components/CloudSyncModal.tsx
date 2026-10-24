import { openRecoveryReview } from '../utils/recoveryReview'
import { isRecordsServerUnavailable, isRecordsSyncEnabled, performSongbookSync, setRecordsSyncEnabled } from '../utils/recordsSync'
import { isDebugLoggingEnabled, setDebugLoggingEnabled } from '../utils/logger'
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
  Palette,
} from 'lucide-react'
import { useOptionalGoogleAuth } from '../utils/authContext'
import {
  readCloudSyncMeta,
  computeSongbookChecksum,
  estimateSongbookUploadBytes,
  songbookUploadHeadroom,
  type CloudSyncStatus,
  type CloudSyncResult,
  type ConflictingItem,
} from '../utils/cloudSongbookSync'
import { readPersistedLibrary } from '../utils/syncJournal'
import { recoveryDotClass, useRecoveryAttention } from '../utils/recoveryAttention'
import { tryReadCloudThemeSettings } from '../utils/backupSettings'
import type { SyncLibrary } from '../utils/syncMerge'
import type { SyncPill } from '../utils/syncStatus'
import type { SyncDeviceFacts } from '../utils/useSyncStatus'

interface CloudSyncModalProps {
  isOpen: boolean
  onClose: () => void
  onSyncApplied?: (updatedLibrary: SyncLibrary) => void
  onSyncStateChange?: (status: CloudSyncStatus, isProcessing: boolean) => void
  /** #191: DEV Sync Center. When set, the dialog is titled Sync Center and shows device facts. */
  syncCenter?: { pill: SyncPill; facts: SyncDeviceFacts; onOpenDebugLogs?: () => void }
}

export const CloudSyncModal: React.FC<CloudSyncModalProps> = ({
  isOpen,
  onClose,
  onSyncApplied,
  onSyncStateChange,
  syncCenter,
}) => {
  const recoveryAttention = useRecoveryAttention() // #181
  const authContext = useOptionalGoogleAuth()

  const session = authContext?.session
  const token = session?.sessionToken || session?.idToken || session?.token
  const isAuthenticated = Boolean(session && token && authContext?.accessStatus === 'active')

  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('IDLE')
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [warningMessage, setWarningMessage] = useState<string>('')
  const [conflicts, setConflicts] = useState<ConflictingItem[]>([])
  const [lastMeta, setLastMeta] = useState(() => readCloudSyncMeta())
  const [recordsSync, setRecordsSync] = useState(() => { try { return isRecordsSyncEnabled() } catch { return false } })
  const [debugLogs, setDebugLogs] = useState(() => isDebugLoggingEnabled())
  // Read on each render: the last sync updates it, and the device view is opened after a sync.
  let recordsServerOff = false
  try { recordsServerOff = isRecordsServerUnavailable() } catch { /* storage unavailable */ }
  // Sync Center: "This device" view (library and sync engine) instead of the main view.
  const [deviceView, setDeviceView] = useState(false)
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (wasOpen !== isOpen) { setWasOpen(isOpen); if (!isOpen) setDeviceView(false) }

  // Focus restoration to triggering element upon modal close
  const previousActiveElementRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (isOpen) {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null
    } else if (previousActiveElementRef.current) {
      previousActiveElementRef.current.focus?.()
      previousActiveElementRef.current = null
    }
  }, [isOpen])
  useEffect(() => {
    return () => {
      previousActiveElementRef.current?.focus?.()
    }
  }, [])

  // Safe Escape key dismissal (guarded during in-flight operations)
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isProcessing) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isProcessing, onClose])

  // Parent callbacks can change when applying React state; that must not start another sync.
  const onSyncAppliedRef = useRef(onSyncApplied)
  useEffect(() => { onSyncAppliedRef.current = onSyncApplied }, [onSyncApplied])

  const refreshSyncState = useCallback(async () => {
    if (!token || !isAuthenticated) return
    setIsProcessing(true)
    setErrorMessage('')
    setWarningMessage('')
    try {
      const result = await performSongbookSync(token)
      setSyncStatus(result.status)
      setLastMeta(readCloudSyncMeta())

      if (result.success) {
        setWarningMessage(result.warning || '')
        if (result.updatedLibrary) onSyncAppliedRef.current?.(result.updatedLibrary)
        const hasTheme = Boolean(result.updatedLibrary?.themeSettings)
        if (result.actionTaken === 'NONE') {
          setStatusMessage('')
        } else if (result.actionTaken === 'UPLOADED') {
          setStatusMessage(
            hasTheme
              ? 'Local songbook and theme settings uploaded to cloud successfully.'
              : 'Local songbook uploaded to cloud successfully.'
          )
        } else if (result.actionTaken === 'DOWNLOADED') {
          setStatusMessage(
            hasTheme
              ? 'Newer cloud songbook and theme settings downloaded to this device.'
              : 'Newer cloud songbook downloaded to this device.'
          )
        } else if (result.actionTaken === 'MERGED') {
          setStatusMessage(
            hasTheme
              ? 'Songbooks and theme settings merged safely. All changes preserved.'
              : 'Songbooks merged safely. All changes preserved.'
          )
        }
      } else if (result.status === 'CONFLICT') {
        if (result.updatedLibrary) onSyncAppliedRef.current?.(result.updatedLibrary)
        const hasThemeConflict = (result.conflicts || []).some((c) => c.type === 'theme')
        setStatusMessage(
          hasThemeConflict
            ? 'Conflicting songbook or theme edits detected between this device and the cloud.'
            : 'Conflicting edits detected between this device and the cloud.'
        )
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
    setWarningMessage('')
    try {
      const result: CloudSyncResult = await performSongbookSync(token, { forceAction })
      setSyncStatus(result.status)
      setLastMeta(readCloudSyncMeta())
      if (result.success) {
        setConflicts([])
        setWarningMessage(result.warning || '')
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
  const currentTheme = typeof localStorage !== 'undefined' ? tryReadCloudThemeSettings(localStorage) : undefined
  const localChecksum = currentLocal
    ? computeSongbookChecksum({
        ...currentLocal,
        ...(currentTheme ? { themeSettings: currentTheme } : {}),
      })
    : null
  // #190: how close an upload of this library is to the 2 MB cloud limit.
  const headroom = currentLocal
    ? songbookUploadHeadroom(estimateSongbookUploadBytes({
        ...currentLocal,
        ...(currentTheme ? { themeSettings: currentTheme } : {}),
      }))
    : null
  const sizeMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2)

  return (
    <div
      data-testid="cloud-sync-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing) {
          onClose()
        }
      }}
    >
      <div
        data-testid="cloud-sync-modal-card"
        className="w-full max-w-lg rounded-2xl border border-app-border bg-app-surface text-app-heading shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: Cloud icon | Cloud Songbook Sync | Close X */}
        <div className="px-5 py-4 border-b border-app-border/80 flex items-center justify-between bg-app-base/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-app-action/20 border border-app-action/40 flex items-center justify-center text-app-action">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-extrabold text-sm sm:text-base tracking-wide">
                {syncCenter ? 'Sync Center' : 'Cloud Songbook Sync'}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            aria-label="Close"
            className="w-8 h-8 rounded-xl hover:bg-app-base flex items-center justify-center text-app-muted hover:text-app-heading transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {syncCenter && deviceView ? (
            <div data-testid="sync-center-device-view" className="space-y-3">
              <button
                type="button"
                onClick={() => setDeviceView(false)}
                className="min-h-11 px-3 rounded-lg border border-app-border bg-app-base hover:bg-app-surface text-xs font-semibold text-app-heading cursor-pointer"
              >
                Back
              </button>
              <div className="rounded-xl bg-app-base/70 border border-app-border text-xs">
                <h3 className="px-3.5 pt-3 pb-1 font-bold text-app-heading">This device</h3>
                <div className="px-3.5 py-2 pb-3 flex justify-between gap-3">
                  <span className="text-app-muted">Library</span>
                  <span>{syncCenter.facts.songs === null ? 'Unavailable' : `${syncCenter.facts.songs} songs · ${syncCenter.facts.setlists} setlists`}</span>
                </div>
              </div>
              <div className="rounded-xl bg-app-base/70 border border-app-border text-xs px-3.5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-app-heading">Sync engine</div>
                  <div className="text-[11px] text-app-muted">
                    {!recordsSync ? 'Classic: syncs the whole songbook at once.'
                      : recordsServerOff ? 'Per-record is not available on the server yet, so Classic is used.'
                      : 'Per-record: syncs only the songs and setlists that changed.'}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="sync-center-engine-toggle"
                  aria-pressed={recordsSync}
                  disabled={isProcessing}
                  onClick={() => {
                    const next = !recordsSync
                    try { setRecordsSyncEnabled(next) } catch { return }
                    setRecordsSync(next)
                  }}
                  className="shrink-0 min-h-11 px-3 rounded-lg border border-app-border bg-app-surface hover:border-app-action font-semibold text-app-heading cursor-pointer disabled:opacity-50"
                >
                  {recordsSync ? (recordsServerOff ? 'Per-record (unavailable)' : 'Per-record') : 'Classic'}
                </button>
              </div>
            </div>
          ) : (<>
          {/* Account Card: Avatar | Display name | Email | Role badge */}
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

          {/* Status Card: Sync status | Last synced | Fingerprint */}
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

            {warningMessage && (
              <p className="text-xs text-status-warning bg-status-warning/10 p-2.5 rounded-lg border border-status-warning/20" role="status">
                {warningMessage}
              </p>
            )}

            {errorMessage && (
              <p className="text-xs text-status-error bg-[#DC6E67]/10 p-2.5 rounded-lg border border-[#DC6E67]/20">
                {errorMessage}
              </p>
            )}

            {headroom && headroom.level !== 'ok' && (
              <p
                data-testid="cloud-sync-headroom-warning"
                role="status"
                className={headroom.level === 'over'
                  ? 'text-xs text-status-error bg-[#DC6E67]/10 p-2.5 rounded-lg border border-[#DC6E67]/20'
                  : 'text-xs text-status-warning bg-status-warning/10 p-2.5 rounded-lg border border-status-warning/20'}
              >
                {headroom.level === 'over'
                  ? `Songbook is ${sizeMb(headroom.bytes)} MB, over the ${sizeMb(headroom.limitBytes)} MB cloud sync limit. Sync will not upload until it is smaller. This device keeps every song; export a backup first.`
                  : `Songbook uses ${Math.round(headroom.ratio * 100)}% of the ${sizeMb(headroom.limitBytes)} MB cloud sync limit. Export a backup and consider removing unused songs before it fills.`}
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
              {headroom && (
                <div className="col-span-2">
                  <span className="text-app-muted block">Cloud size</span>
                  <span data-testid="cloud-sync-headroom" className={headroom.level === 'ok' ? 'text-app-heading font-semibold' : headroom.level === 'over' ? 'text-status-error font-semibold' : 'text-status-warning font-semibold'}>
                    {sizeMb(headroom.bytes)} / {sizeMb(headroom.limitBytes)} MB ({Math.round(headroom.ratio * 100)}%)
                  </span>
                </div>
              )}
            </div>
          </div>

          {syncCenter && (
            <div data-testid="sync-center-details" className="space-y-3">
              {syncCenter.pill.attention.length > 0 && (
                <div className="p-3.5 rounded-xl bg-status-error/10 border border-status-error/40 space-y-2">
                  <h3 className="text-xs font-bold text-status-error">
                    {syncCenter.pill.attention.length === 1 ? '1 item needs a decision' : `${syncCenter.pill.attention.length} items need a decision`}
                  </h3>
                  <ul className="space-y-1 text-xs text-app-heading">
                    {syncCenter.pill.attention.map(item => <li key={item.id}>{item.label}</li>)}
                  </ul>
                  <p className="text-[11px] text-app-muted">Your edits are safe on this device. Export a backup before choosing.</p>
                </div>
              )}
              {syncCenter.onOpenDebugLogs && (
                <div className="rounded-xl bg-app-base/70 border border-app-border flex items-center justify-between gap-3 pr-2">
                  <button
                    type="button"
                    onClick={syncCenter.onOpenDebugLogs}
                    className="flex-1 min-h-11 px-3.5 text-left text-xs font-semibold text-app-heading hover:text-app-action transition-colors cursor-pointer"
                  >
                    Diagnostics and debug logs
                  </button>
                  <button
                    type="button"
                    role="switch"
                    data-testid="sync-center-debug-switch"
                    aria-checked={debugLogs}
                    aria-label="Record debug logs"
                    onClick={() => { const next = !debugLogs; setDebugLoggingEnabled(next); setDebugLogs(next) }}
                    className={`relative shrink-0 w-11 h-6 rounded-full border transition-colors cursor-pointer ${debugLogs ? 'bg-app-action border-app-action' : 'bg-app-border/60 border-app-border'}`}
                  >
                    <span aria-hidden="true" className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${debugLogs ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
              )}
            </div>
          )}

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
                      {item.type === 'song' ? (
                        <FileText className="w-3 h-3 text-app-action" />
                      ) : item.type === 'theme' ? (
                        <Palette className="w-3 h-3 text-app-accent" />
                      ) : (
                        <Layers className="w-3 h-3 text-app-accent" />
                      )}
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
          </>)}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-app-border/80 bg-app-base/60 flex items-center justify-between gap-3 text-[11px] text-app-muted">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="cloud-sync-recovery-button"
              disabled={isProcessing}
              onClick={openRecoveryReview}
              aria-label={recoveryAttention ? 'Review local recovery, needs a decision' : undefined}
              className="relative min-h-11 px-3 py-1.5 rounded-lg border border-app-border bg-app-base hover:bg-app-surface text-app-heading font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              Review local recovery
              {recoveryAttention && <span data-testid="cloud-sync-recovery-dot" aria-hidden="true" className={recoveryDotClass} />}
            </button>
            {syncCenter ? (
              <button
                type="button"
                data-testid="sync-center-device-button"
                aria-pressed={deviceView}
                onClick={() => setDeviceView(view => !view)}
                className="min-h-11 px-3 py-1.5 rounded-lg border border-app-border bg-app-base hover:bg-app-surface text-app-heading font-semibold transition-colors cursor-pointer"
              >
                This device
              </button>
            ) : (
              <span className="hidden sm:inline text-[10px] text-app-muted">Offline edits preserved safely</span>
            )}
          </div>
          <button
            type="button"
            data-testid="cloud-sync-close-button"
            disabled={isProcessing}
            onClick={onClose}
            className="min-h-11 px-4 py-1.5 rounded-lg bg-app-border/50 hover:bg-app-border text-app-heading font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
