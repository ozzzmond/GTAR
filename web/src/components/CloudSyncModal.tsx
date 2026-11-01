// #299: the single Backup & Restore center (header cloud button). Two cards with the same verbs —
// "This device (file)" (works signed out) and "Cloud (Google)" — and one restore preview for both.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Cloud, CloudDownload, CloudUpload, Info, LogIn, User, X } from 'lucide-react'
import { useOptionalGoogleAuth } from '../utils/authContext'
import { estimateSongbookUploadBytes, songbookUploadHeadroom, type CloudSongbookRecord } from '../utils/cloudSongbookSync'
import { readPersistedLibrary } from '../utils/syncJournal'
import type { SyncLibrary } from '../utils/syncMerge'
import type { ActiveSongState, WebSetlist } from '../types/gtar'
import { CloudBackupChanged, readCloudBackup, restoreCloudBackup, writeCloudBackup } from '../utils/manualCloudBackup'
import { exportOldRecoveryData, useOldRecoveryData } from '../utils/recoveryExport'
import { recoveryDotClass } from '../utils/recoveryAttention'
import type { ExportEnvironment } from '../utils/backupExport'
import { DeviceBackupCard } from './DeviceBackupCard'
import { RestorePreview } from './RestorePreview'
import {
  RESTORE_BLOCKED_MESSAGE, footerButton, formatDate, listCounts, outlinedButton, primaryButton, sectionCard, sectionLabel, tone,
} from './backupCenterUi'

interface CloudSyncModalProps {
  isOpen: boolean
  onClose: () => void
  restoreBlocked?: boolean
  onSyncApplied?: (library: SyncLibrary) => void
  onBackupSummary?: (date: string | null) => void
  onFullRestore?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[]) => void | Promise<void>
  onSmartMerge?: (songs: Array<Partial<ActiveSongState>>, setlists: WebSetlist[]) => void | Promise<void>
  /** App library (songs including trash) for the file card; read from device storage when omitted. */
  deviceSongs?: ActiveSongState[]
  deviceSetlists?: WebSetlist[]
  onImportAllSongs?: (songs: Array<Partial<ActiveSongState>>) => void
  /** Test seam for the share sheet, file and download APIs. */
  exportEnv?: ExportEnvironment
}
const sizeMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2)
const safe = <T,>(read: () => T, fallback: T): T => { try { return read() } catch { return fallback } }
const restoredMessage = (library: SyncLibrary) => `Backup restored: ${library.songs.length} songs, ${library.setlists.length} setlists (verified after saving).`
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
  isOpen, onClose, onBackupSummary, onFullRestore, onSmartMerge, restoreBlocked = false, deviceSongs, deviceSetlists, onImportAllSongs, exportEnv,
}) => {
  const auth = useOptionalGoogleAuth()
  const session = auth?.session
  const token = session?.sessionToken || session?.idToken || session?.token || ''
  const userId = String(session?.user?.id || '')
  const signedIn = Boolean(token && userId && auth?.accessStatus === 'active')
  const oldRecovery = useOldRecoveryData()
  const [cloud, setCloud] = useState<CloudSongbookRecord | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fileBusy, setFileBusy] = useState(false)
  const [message, setMessageText] = useState('')
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('error')
  const setMessage = (text: string, kind: 'success' | 'error' = 'error') => { setMessageText(text); setMessageTone(kind) }
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [preview, setPreview] = useState<{ kind: 'backup' | 'restore'; device: SyncLibrary; cloud: CloudSongbookRecord | null } | null>(null)
  const persisted = usePersistedLibrary(isOpen && (!deviceSongs || signedIn))
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
    void Promise.resolve().then(() => { if (active) { setPreview(null); setReady(false); setMessageText(''); setRecoveryMessage('') } })
    if (signedIn) {
      readCloudBackup({ token, userId }).then(record => {
        if (!active) return
        setCloud(record); setReady(true); summaryCallback.current?.(record?.updatedAt ?? null)
      }).catch(error => { if (active) { setMessageText(String(error.message)); setMessageTone('error') } })
    }
    return () => { active = false; trigger?.focus?.() }
  }, [isOpen, signedIn, token, userId])
  const locked = busy || fileBusy
  useEffect(() => {
    if (!isOpen) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !locked) onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [isOpen, locked, onClose])
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
      setPreview(null); setMessage(restoredMessage(preview.cloud.data), 'success')
    }
  })
  const exportRecovery = async () => {
    setRecoveryMessage('')
    try { await exportOldRecoveryData(); setRecoveryMessage('Old recovery data handed to browser downloads as GTAR-storage-recovery.json. Check that it was saved.') }
    catch { setRecoveryMessage('Recovery export failed. Nothing was changed; retry.') }
  }
  const device = signedIn ? persisted : null
  const headroom = device ? safe(() => songbookUploadHeadroom(estimateSongbookUploadBytes(device)), null) : null
  const fileSongs = deviceSongs ?? (persisted?.songs as ActiveSongState[] | undefined) ?? NO_SONGS
  const fileSetlists = deviceSetlists ?? persisted?.setlists ?? NO_SETLISTS
  const user = session?.user
  const statusRow = (label: string, value: React.ReactNode, span = false, valueClass = 'text-app-heading font-semibold') => (
    <div className={span ? 'col-span-2' : 'min-w-0'}>
      <span className="text-app-muted block">{label}</span>
      <span className={`${valueClass} block truncate`}>{value}</span>
    </div>
  )
  return <div data-testid="cloud-sync-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !locked) onClose() }}
    className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in">
    <div role="dialog" aria-modal="true" aria-label="Backup & Restore" data-testid="cloud-sync-modal-card"
      className="w-full max-w-lg rounded-2xl border border-app-border bg-app-surface text-app-heading shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
      <div data-testid="cloud-sync-modal-header" className="px-5 py-3 border-b border-app-border/80 flex items-center justify-between bg-app-base/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-app-action/20 border border-app-action/40 flex items-center justify-center text-app-action">
            <Cloud className="w-4 h-4" aria-hidden="true" />
          </div>
          <h2 className="font-extrabold text-sm sm:text-base tracking-wide">Backup &amp; Restore</h2>
        </div>
        <button type="button" onClick={onClose} disabled={locked} aria-label="Close"
          className="w-11 h-11 -mr-2 rounded-xl hover:bg-app-base flex items-center justify-center text-app-muted hover:text-app-heading transition-colors cursor-pointer disabled:opacity-50">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div data-testid="cloud-sync-modal-body" className="p-5 space-y-4 overflow-y-auto flex-1">
        <DeviceBackupCard
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

        <div data-testid="cloud-backup-card" className={sectionCard}>
          <span className={sectionLabel}>Cloud (Google)</span>
          <div data-testid="cloud-sync-account-card" className="pt-2 border-t border-app-border/60 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {signedIn && user?.picture
                ? <img src={user.picture} alt="" referrerPolicy="no-referrer" className="w-8 h-8 rounded-full border border-app-action/40 shrink-0" />
                : <div className="w-8 h-8 rounded-full bg-app-border flex items-center justify-center text-app-muted shrink-0"><User className="w-4 h-4" aria-hidden="true" /></div>}
              <div className="min-w-0">
                <div className="text-xs font-bold truncate">{signedIn ? user?.name || user?.email : 'Guest / Offline'}</div>
                <div className="text-[11px] text-app-muted truncate">{signedIn ? user?.email : 'Not signed in'}</div>
              </div>
            </div>
            {signedIn
              ? <span className="shrink-0 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-status-success/15 text-status-success border border-status-success/40">Signed in</span>
              : <span className="shrink-0 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-status-error/15 text-status-error border border-status-error/40">Auth Required</span>}
          </div>

          {!signedIn ? <button type="button" className={primaryButton} onClick={() => { void auth?.signIn().catch(error => setMessage(String(error.message))) }}>
            <LogIn className="w-4 h-4" aria-hidden="true" />Sign in to use cloud backup
          </button> : <>
            {headroom && headroom.level !== 'ok' && <p data-testid="cloud-sync-headroom-warning" role="status" className={headroom.level === 'over' ? tone.error : tone.warning}>
              {headroom.level === 'over'
                ? `Songbook is ${sizeMb(headroom.bytes)} MB, over the ${sizeMb(headroom.limitBytes)} MB cloud backup limit. This device keeps every song; save a backup file first.`
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

            {restoreBlocked && <p role="status" className={tone.warning}>{RESTORE_BLOCKED_MESSAGE}</p>}

            {!preview ? <div className="space-y-2 pt-1">
              <button type="button" data-testid="cloud-backup-button" className={primaryButton} disabled={busy || !ready} onClick={() => { void prepare('backup') }}>
                <CloudUpload className="w-4 h-4" aria-hidden="true" />Back up to cloud
              </button>
              <button type="button" data-testid="cloud-restore-button" className={outlinedButton} disabled={busy || !ready || !cloud || restoreBlocked} onClick={() => { void prepare('restore') }}>
                <CloudDownload className="w-3.5 h-3.5 text-app-link" aria-hidden="true" />Restore from cloud
              </button>
            </div> : preview.kind === 'restore' && preview.cloud ? <RestorePreview
              sourceLabel="Cloud backup"
              device={preview.device}
              backup={preview.cloud.data}
              provenance={{ createdAt: preview.cloud.updatedAt }}
              busy={busy}
              blocked={restoreBlocked}
              onMerge={() => { void confirm('merge') }}
              onReplace={() => { void confirm('replace') }}
              onCancel={() => setPreview(null)}
            /> : <div role="group" aria-label="Confirm cloud backup" data-testid="cloud-backup-preview"
              className="p-4 rounded-xl border space-y-3 bg-status-info/10 border-status-info/40">
              <div className="flex items-center gap-2 text-status-info">
                <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
                <h3 className="font-bold text-xs">Confirm cloud backup</h3>
              </div>
              <div className="space-y-1.5 p-2.5 rounded-lg bg-app-base/80 text-[11px]">
                <p><span className="text-app-muted">This device: </span><span className="text-app-heading font-semibold">{listCounts(preview.device)}</span></p>
                <p><span className="text-app-muted">Cloud backup: </span><span className="text-app-heading font-semibold">{preview.cloud ? `${formatDate(preview.cloud.updatedAt)} — ${listCounts(preview.cloud.data)}` : 'No cloud backup yet'}</span></p>
              </div>
              <p className="text-[11px] text-app-text">Back up to <strong>{user?.email}</strong>? This overwrites the cloud backup. The device library stays unchanged.</p>
              <button type="button" className={primaryButton} disabled={busy} onClick={() => { void confirm() }}>Confirm backup</button>
              <button type="button" className={outlinedButton} disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
            </div>}
          </>}

          {message && <p role="status" className={messageTone === 'success' ? tone.success : tone.error}>{message}</p>}
        </div>

        {recoveryMessage && <p role="status" data-testid="old-recovery-message" className={tone.info}>{recoveryMessage}</p>}
      </div>

      <div data-testid="cloud-sync-modal-footer" className="px-5 py-3 border-t border-app-border/80 bg-app-base/60 flex items-center justify-between gap-2 text-[11px] text-app-muted">
        <div className="flex items-center gap-2">
          {oldRecovery.exists && <button type="button" data-testid="export-old-recovery-button" disabled={locked} onClick={() => { void exportRecovery() }} className={footerButton}
            aria-label={oldRecovery.exported ? undefined : 'Export old recovery data, not saved on this device yet'}>
            Export old recovery data{!oldRecovery.exported && <span data-testid="old-recovery-dot" aria-hidden="true" className={recoveryDotClass} />}
          </button>}
        </div>
        <button type="button" data-testid="cloud-sync-close-button" disabled={locked} onClick={onClose}
          className="min-h-11 px-4 py-1.5 rounded-lg bg-app-border/50 hover:bg-app-border text-app-heading font-semibold transition-colors cursor-pointer disabled:opacity-50">Close</button>
      </div>
    </div>
  </div>
}
