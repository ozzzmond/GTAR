import { isDebugLoggingEnabled, setDebugLoggingEnabled } from '../utils/logger'
import { recoveryDotClass, useRecoveryAttention } from '../utils/recoveryAttention'
import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Cloud, CloudDownload, CloudUpload, Info, LogIn, User, X } from 'lucide-react'
import { useOptionalGoogleAuth } from '../utils/authContext'
import { estimateSongbookUploadBytes, songbookUploadHeadroom, type CloudSongbookRecord } from '../utils/cloudSongbookSync'
import { isLibraryB2Active, isLibraryIndexActive, readPersistedLibrary } from '../utils/syncJournal'
import type { SyncLibrary } from '../utils/syncMerge'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { CloudBackupChanged, readCloudBackup, restoreCloudBackup, writeCloudBackup } from '../utils/manualCloudBackup'
import { openRecoveryReview } from '../utils/recoveryReview'

interface CloudSyncModalProps {
  isOpen: boolean
  onClose: () => void
  restoreBlocked?: boolean
  onOpenDebugLogs?: () => void
  onSyncApplied?: (library: SyncLibrary) => void
  onBackupSummary?: (date: string | null) => void
  onFullRestore?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[]) => void | Promise<void>
  onSmartMerge?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[]) => void | Promise<void>
}
const RESTORE_BLOCKED_MESSAGE = "Close the editor (save or discard your changes) before restoring."
const listCounts = (library: SyncLibrary) => `${library.songs.filter(s => !s.isDeleted).length} songs · ${library.setlists.length} setlists · ${library.songs.filter(s => s.isDeleted).length} in trash`
const pad = (n: number) => String(n).padStart(2, '0')
/** Local date and time, e.g. 2026-11-02 20:00. Never the raw ISO string. */
const formatDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` : 'Unknown date'
}
const sizeMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2)
const safe = <T,>(read: () => T, fallback: T): T => { try { return read() } catch { return fallback } }
const primaryButton = 'w-full min-h-11 py-2.5 px-4 rounded-xl bg-app-action hover:bg-app-action text-app-on-action font-extrabold text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-98 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
const secondaryButton = 'min-h-11 py-2 px-3 rounded-lg bg-app-base hover:bg-app-border text-app-heading border border-app-border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
const outlinedButton = 'w-full min-h-11 py-2 px-3 rounded-xl bg-app-base hover:bg-app-border text-app-muted hover:text-app-action border border-app-border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
const footerButton = 'relative min-h-11 px-3 py-1.5 rounded-lg border border-app-border bg-app-base hover:bg-app-surface text-app-heading font-semibold transition-colors cursor-pointer disabled:opacity-50'
const tone = {
  success: 'text-xs text-status-success bg-status-success/10 p-2.5 rounded-lg border border-status-success/20',
  warning: 'text-xs text-status-warning bg-status-warning/10 p-2.5 rounded-lg border border-status-warning/20',
  error: 'text-xs text-status-error bg-status-error/10 p-2.5 rounded-lg border border-status-error/20',
}
const only = (a: {id?: string | number}[], b: {id?: string | number}[]) => a.filter(x => !b.some(y => String(y.id) === String(x.id))).length
export const CloudSyncModal: React.FC<CloudSyncModalProps> = ({ isOpen, onClose, onBackupSummary, onFullRestore, onSmartMerge, onOpenDebugLogs, restoreBlocked = false }) => {
  const recoveryAttention = useRecoveryAttention()
  const [debugLogs, setDebugLogs] = useState(() => isDebugLoggingEnabled())
  const auth = useOptionalGoogleAuth()
  const session = auth?.session
  const token = session?.sessionToken || session?.idToken || session?.token || ''
  const userId = String(session?.user?.id || '')
  const signedIn = Boolean(token && userId && auth?.accessStatus === 'active')
  const [cloud, setCloud] = useState<CloudSongbookRecord | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessageText] = useState('')
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('error')
  const setMessage = (text: string, kind: 'success' | 'error' = 'error') => { setMessageText(text); setMessageTone(kind) }
  const [deviceView, setDeviceView] = useState(false)
  const [preview, setPreview] = useState<{ kind: 'backup' | 'restore'; device: SyncLibrary; cloud: CloudSongbookRecord | null } | null>(null)
  const restoreBlockedRef = useRef(restoreBlocked)
  useEffect(() => { restoreBlockedRef.current = restoreBlocked }, [restoreBlocked])
  const identity = useRef('')
  useEffect(() => { identity.current = `${userId}:${token}`; return () => { identity.current = '' } }, [userId, token])
  const summaryCallback = useRef(onBackupSummary)
  useEffect(() => { summaryCallback.current = onBackupSummary }, [onBackupSummary])
  useEffect(() => {
    let active = true
    if (!isOpen) return
    const trigger = document.activeElement as HTMLElement | null
    void Promise.resolve().then(() => { if (active) { setPreview(null); setReady(false); setMessageText(''); setDeviceView(false) } })
    if (signedIn) {
      readCloudBackup({ token, userId }).then(record => {
        if (!active) return
        setCloud(record); setReady(true); summaryCallback.current?.(record?.updatedAt ?? null)
      }).catch(error => { if (active) { setMessageText(String(error.message)); setMessageTone('error') } })
    }
    return () => { active = false; trigger?.focus?.() }
  }, [isOpen, signedIn, token, userId])
  useEffect(() => {
    if (!isOpen) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [isOpen, busy, onClose])
  if (!isOpen) return null
  const account = { token, userId, isCurrent: () => identity.current === `${userId}:${token}` }
  const run = async (action: () => Promise<void>) => {
    if (busy || !signedIn) return
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const prepare = (kind: 'backup' | 'restore') => run(async () => {
    if (kind === 'restore' && restoreBlockedRef.current) throw new Error(RESTORE_BLOCKED_MESSAGE)
    const captured = identity.current
    const record = await readCloudBackup(account)
    if (identity.current !== captured) throw new Error('Account changed; open the dialog again.')
    setCloud(record); summaryCallback.current?.(record?.updatedAt ?? null)
    if (kind === 'restore' && !record) throw new Error('No cloud backup yet')
    const device = readPersistedLibrary()
    if (!device) throw new Error('Device library could not be read')
    if (kind === 'restore' && restoreBlockedRef.current) throw new Error(RESTORE_BLOCKED_MESSAGE)
    setPreview({kind, device, cloud: record})
  })
  const confirm = (mode?: 'replace' | 'merge') => run(async () => {
    if (!preview) return
    if (preview.kind === 'restore' && restoreBlockedRef.current) throw new Error(RESTORE_BLOCKED_MESSAGE)
    const captured = identity.current
    const device = readPersistedLibrary()
    if (!device || JSON.stringify(device) !== JSON.stringify(preview.device)) {
      setPreview(null); throw new Error('Device library changed. Review and confirm again.')
    }
    if (preview.kind === 'backup') {
      try {
        const record = await writeCloudBackup(account, device, preview.cloud)
        if (identity.current !== captured) return
        setCloud(record); summaryCallback.current?.(record.updatedAt); setPreview(null); setMessage('Cloud backup saved and checksum verified.', 'success')
      } catch (error) {
        setPreview(null)
        if (error instanceof CloudBackupChanged) {
          const record = await readCloudBackup(account)
          if (identity.current === captured) { setCloud(record); summaryCallback.current?.(record?.updatedAt ?? null) }
        }
        throw error
      }
    } else {
      const apply = mode === 'replace' ? onFullRestore : onSmartMerge
      if (!apply || !preview.cloud || !mode) throw new Error('Restore unavailable')
      await restoreCloudBackup(device, preview.cloud.data, mode, library => {
        if (restoreBlockedRef.current) throw new Error(RESTORE_BLOCKED_MESSAGE)
        if (identity.current !== captured) throw new Error('Account changed; restore aborted.')
        return apply(library.songs, library.setlists)
      }, localStorage)
      setPreview(null); setMessage('Device library restored and verified.', 'success')
    }
  })
  const device = deviceView || signedIn ? safe(() => readPersistedLibrary(), null) : null
  const headroom = device ? safe(() => songbookUploadHeadroom(estimateSongbookUploadBytes(device)), null) : null
  const indexedDb = deviceView && safe(() => isLibraryB2Active() || isLibraryIndexActive(), false)
  const user = session?.user
  const statusRow = (label: string, value: React.ReactNode, span = false, valueClass = 'text-app-heading font-semibold') => (
    <div className={span ? 'col-span-2' : 'min-w-0'}>
      <span className="text-app-muted block">{label}</span>
      <span className={`${valueClass} block truncate`}>{value}</span>
    </div>
  )
  return <div data-testid="cloud-sync-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose() }}
    className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in">
    <div role="dialog" aria-modal="true" aria-label="Sync Center" data-testid="cloud-sync-modal-card"
      className="w-full max-w-lg rounded-2xl border border-app-border bg-app-surface text-app-heading shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
      <div data-testid="cloud-sync-modal-header" className="px-5 py-3 border-b border-app-border/80 flex items-center justify-between bg-app-base/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-app-action/20 border border-app-action/40 flex items-center justify-center text-app-action">
            <Cloud className="w-4 h-4" aria-hidden="true" />
          </div>
          <h2 className="font-extrabold text-sm sm:text-base tracking-wide">Sync Center</h2>
        </div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close"
          className="w-11 h-11 -mr-2 rounded-xl hover:bg-app-base flex items-center justify-center text-app-muted hover:text-app-heading transition-colors cursor-pointer disabled:opacity-50">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div data-testid="cloud-sync-modal-body" className="p-5 space-y-4 overflow-y-auto flex-1">
        {deviceView ? <div data-testid="sync-center-device-view" className="space-y-3">
          <button type="button" onClick={() => setDeviceView(false)} className={`${footerButton} text-xs`}>Back</button>
          <div className="rounded-xl bg-app-base/70 border border-app-border text-xs divide-y divide-app-border/60">
            <h3 className="px-3.5 pt-3 pb-2 font-bold text-app-heading">This device</h3>
            <div className="px-3.5 py-2 flex justify-between gap-3">
              <span className="text-app-muted">Library</span>
              <span>{device ? listCounts(device) : 'Unavailable'}</span>
            </div>
            <div className="px-3.5 py-2 flex justify-between gap-3">
              <span className="text-app-muted">Chart storage</span>
              <span>{indexedDb ? 'IndexedDB (this browser)' : 'Local storage (this browser)'}</span>
            </div>
            <div className="px-3.5 py-2 pb-3 flex justify-between gap-3">
              <span className="text-app-muted">Backup size</span>
              <span>{headroom ? `${sizeMb(headroom.bytes)} MB` : 'Unavailable'}</span>
            </div>
          </div>
        </div> : <>
          <div data-testid="cloud-sync-account-card" className="p-3.5 rounded-xl bg-app-base/70 border border-app-border flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {signedIn && user?.picture
                ? <img src={user.picture} alt="" referrerPolicy="no-referrer" className="w-8 h-8 rounded-full border border-app-action/40 shrink-0" />
                : <div className="w-8 h-8 rounded-full bg-app-border flex items-center justify-center text-app-muted shrink-0"><User className="w-4 h-4" aria-hidden="true" /></div>}
              <div className="min-w-0">
                <div className="text-xs font-bold truncate">{signedIn ? user?.name || user?.email : 'Guest / Offline'}</div>
                <div className="text-[11px] text-app-muted truncate">{signedIn ? user?.email : 'Not signed in with approved account'}</div>
              </div>
            </div>
            {signedIn
              ? <span className="shrink-0 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-status-success/15 text-status-success border border-status-success/40">Signed in</span>
              : <span className="shrink-0 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-status-error/15 text-status-error border border-status-error/40">Auth Required</span>}
          </div>

          {!signedIn ? <button type="button" className={primaryButton} onClick={() => { void auth?.signIn().catch(error => setMessage(String(error.message))) }}>
            <LogIn className="w-4 h-4" aria-hidden="true" />Sign in to back up to cloud
          </button> : <>
            <div data-testid="cloud-backup-card" className="p-4 rounded-xl bg-app-base/90 border border-app-border space-y-3">
              <span className="text-xs font-bold text-app-muted uppercase tracking-wider font-mono">Cloud Backup</span>
              {headroom && headroom.level !== 'ok' && <p data-testid="cloud-sync-headroom-warning" role="status" className={headroom.level === 'over' ? tone.error : tone.warning}>
                {headroom.level === 'over'
                  ? `Songbook is ${sizeMb(headroom.bytes)} MB, over the ${sizeMb(headroom.limitBytes)} MB cloud backup limit. This device keeps every song; export a backup first.`
                  : `Songbook uses ${Math.round(headroom.ratio * 100)}% of the ${sizeMb(headroom.limitBytes)} MB cloud backup limit.`}
              </p>}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-app-border/60 text-[11px] font-mono">
                {statusRow('Last cloud backup', !ready ? 'Reading cloud backup…' : cloud ? formatDate(cloud.updatedAt) : 'No cloud backup yet')}
                {statusRow('Checksum', ready && cloud ? <span className="block truncate" title={cloud.checksum}>{cloud.checksum}</span> : '—', false, 'text-app-action text-[10px]')}
                {statusRow('Contents', ready && cloud ? listCounts(cloud.data) : '—', true)}
                {headroom && <div className="col-span-2 space-y-1">
                  <span className="text-app-muted block">Cloud size</span>
                  <span data-testid="cloud-sync-headroom" className={headroom.level === 'ok' ? 'text-app-heading font-semibold' : headroom.level === 'over' ? 'text-status-error font-semibold' : 'text-status-warning font-semibold'}>
                    {sizeMb(headroom.bytes)} / {sizeMb(headroom.limitBytes)} MB ({Math.round(headroom.ratio * 100)}%)
                  </span>
                  <div role="meter" aria-label="Cloud size" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(headroom.ratio * 100))}
                    className="h-1.5 rounded-full bg-app-border/60 overflow-hidden">
                    <div className={`h-full rounded-full ${headroom.level === 'ok' ? 'bg-app-action' : headroom.level === 'over' ? 'bg-status-error' : 'bg-status-warning'}`}
                      style={{ width: `${Math.min(100, Math.max(1, headroom.ratio * 100))}%` }} />
                  </div>
                </div>}
              </div>
            </div>

            {restoreBlocked && <p role="status" className={tone.warning}>{RESTORE_BLOCKED_MESSAGE}</p>}

            {!preview ? <div className="space-y-2 pt-1">
              <button type="button" data-testid="cloud-backup-button" className={primaryButton} disabled={busy || !ready} onClick={() => { void prepare('backup') }}>
                <CloudUpload className="w-4 h-4" aria-hidden="true" />Back up to cloud
              </button>
              <button type="button" data-testid="cloud-restore-button" className={outlinedButton} disabled={busy || !ready || !cloud || restoreBlocked} onClick={() => { void prepare('restore') }}>
                <CloudDownload className="w-3.5 h-3.5 text-app-link" aria-hidden="true" />Restore from cloud
              </button>
            </div> : <div role="group" aria-label={preview.kind === 'backup' ? 'Confirm cloud backup' : 'Preview cloud restore'} data-testid="cloud-backup-preview"
              className={`p-4 rounded-xl border space-y-3 ${preview.kind === 'backup' ? 'bg-status-info/10 border-status-info/40' : 'bg-status-warning/10 border-status-warning/40'}`}>
              <div className={`flex items-center gap-2 ${preview.kind === 'backup' ? 'text-status-info' : 'text-status-warning'}`}>
                {preview.kind === 'backup' ? <Info className="w-4 h-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />}
                <h3 className="font-bold text-xs">{preview.kind === 'backup' ? 'Confirm cloud backup' : 'Restore from cloud'}</h3>
              </div>
              <div className="space-y-1.5 p-2.5 rounded-lg bg-app-base/80 text-[11px]">
                <p><span className="text-app-muted">Device: </span><span className="text-app-heading font-semibold">{listCounts(preview.device)}</span></p>
                <p><span className="text-app-muted">Cloud: </span><span className="text-app-heading font-semibold">{preview.cloud ? `${formatDate(preview.cloud.updatedAt)} — ${listCounts(preview.cloud.data)}` : 'No cloud backup yet'}</span></p>
                {preview.kind === 'restore' && preview.cloud && <>
                  <p><span className="text-app-muted">Only on device: </span><span className="text-app-heading font-semibold">{only(preview.device.songs, preview.cloud.data.songs)} songs, {only(preview.device.setlists, preview.cloud.data.setlists)} setlists</span></p>
                  <p><span className="text-app-muted">Only in cloud: </span><span className="text-app-heading font-semibold">{only(preview.cloud.data.songs, preview.device.songs)} songs, {only(preview.cloud.data.setlists, preview.device.setlists)} setlists</span></p>
                </>}
              </div>
              {preview.kind === 'backup' ? <>
                <p className="text-[11px] text-app-text">Back up to <strong>{user?.email}</strong>? This overwrites the cloud backup. The device library stays unchanged.</p>
                <button type="button" className={primaryButton} disabled={busy} onClick={() => { void confirm() }}>Confirm backup</button>
                <button type="button" className={outlinedButton} disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
              </> : <>
                {preview.cloud && <>
                  <p className="text-[11px] text-app-text">A verified local safety snapshot is saved first. Replace removes device-only items; Merge keeps both libraries.</p>
                  <button type="button" className={primaryButton} disabled={busy || restoreBlocked} onClick={() => { void confirm('merge') }}>Merge into device</button>
                </>}
                <div className="grid grid-cols-2 gap-2">
                  {preview.cloud && <button type="button" className={secondaryButton} disabled={busy || restoreBlocked} onClick={() => { void confirm('replace') }}>Replace device</button>}
                  <button type="button" className={`${secondaryButton} ${preview.cloud ? '' : 'col-span-2'}`} disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
                </div>
              </>}
            </div>}
          </>}

          {message && <p role="status" className={messageTone === 'success' ? tone.success : tone.error}>{message}</p>}

          <div data-testid="sync-center-diagnostics" className="rounded-xl bg-app-base/70 border border-app-border flex items-center justify-between gap-3 pr-2">
            {onOpenDebugLogs
              ? <button type="button" disabled={busy} onClick={onOpenDebugLogs}
                  className="flex-1 min-h-11 px-3.5 text-left text-xs font-semibold text-app-heading hover:text-app-action transition-colors cursor-pointer disabled:opacity-50">Diagnostics and debug logs</button>
              : <span className="flex-1 min-h-11 px-3.5 flex items-center text-xs font-semibold text-app-heading">Record debug logs</span>}
            <button type="button" role="switch" data-testid="sync-center-debug-switch" aria-label="Record debug logs" aria-checked={debugLogs}
              onClick={() => { setDebugLoggingEnabled(!debugLogs); setDebugLogs(!debugLogs) }}
              className="relative shrink-0 w-11 h-11 flex items-center justify-center cursor-pointer">
              <span aria-hidden="true" className={`relative block w-11 h-6 rounded-full border transition-colors ${debugLogs ? 'bg-app-action border-app-action' : 'bg-app-border/60 border-app-border'}`}>
                <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${debugLogs ? 'translate-x-5' : ''}`} />
              </span>
            </button>
          </div>
        </>}
      </div>

      <div data-testid="cloud-sync-modal-footer" className="px-5 py-3 border-t border-app-border/80 bg-app-base/60 flex items-center justify-between gap-2 text-[11px] text-app-muted">
        <div className="flex items-center gap-2">
          <button type="button" data-testid="cloud-sync-recovery-button" disabled={busy} onClick={openRecoveryReview} className={footerButton}
            aria-label={recoveryAttention ? 'Review local recovery, needs a decision' : undefined}>Review local recovery{recoveryAttention && <span data-testid="cloud-sync-recovery-dot" aria-hidden="true" className={recoveryDotClass} />}</button>
          <button type="button" data-testid="sync-center-device-button" aria-pressed={deviceView} disabled={busy} onClick={() => setDeviceView(view => !view)} className={footerButton}>This device</button>
        </div>
        <button type="button" data-testid="cloud-sync-close-button" disabled={busy} onClick={onClose}
          className="min-h-11 px-4 py-1.5 rounded-lg bg-app-border/50 hover:bg-app-border text-app-heading font-semibold transition-colors cursor-pointer disabled:opacity-50">Close</button>
      </div>
    </div>
  </div>
}
