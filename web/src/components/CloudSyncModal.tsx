import { isDebugLoggingEnabled, setDebugLoggingEnabled } from '../utils/logger'
import { recoveryDotClass, useRecoveryAttention } from '../utils/recoveryAttention'
import React, { useEffect, useRef, useState } from 'react'
import { useOptionalGoogleAuth } from '../utils/authContext'
import type { CloudSongbookRecord } from '../utils/cloudSongbookSync'
import { readPersistedLibrary } from '../utils/syncJournal'
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
const counts = (library: SyncLibrary) => `${library.songs.filter(s => !s.isDeleted).length} songs, ${library.setlists.length} setlists, ${library.songs.filter(s => s.isDeleted).length} in trash`
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
  const [message, setMessage] = useState('')
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
    void Promise.resolve().then(() => { if (active) { setPreview(null); setReady(false); setMessage('') } })
    if (signedIn) {
      readCloudBackup({ token, userId }).then(record => {
        if (!active) return
        setCloud(record); setReady(true); summaryCallback.current?.(record?.updatedAt ?? null)
      }).catch(error => { if (active) setMessage(String(error.message)) })
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
        setCloud(record); summaryCallback.current?.(record.updatedAt); setPreview(null); setMessage('Cloud backup saved and checksum verified.')
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
      setPreview(null); setMessage('Device library restored and verified.')
    }
  })
  return <div onClick={event => { if (event.target === event.currentTarget && !busy) onClose() }} className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
    <div role="dialog" aria-modal="true" aria-label="Sync Center" className="bg-app-surface text-app-heading p-5 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-4 [&_button]:min-h-11 [&_button]:px-3 [&_button]:py-2 [&_button]:rounded-lg [&_button]:border [&_button]:border-app-border [&_button]:bg-app-base [&_button]:cursor-pointer [&_button:disabled]:opacity-50">
      <h2>Sync Center</h2>
      {!signedIn ? <button onClick={() => { void auth?.signIn().catch(error => setMessage(String(error.message))) }}>Sign in to back up to cloud</button> : <>
        <p>{session?.user?.email}</p>
        <p>{ready ? cloud ? `Cloud backup: ${new Date(cloud.updatedAt).toLocaleString()} — ${counts(cloud.data)}` : 'No cloud backup yet' : 'Reading cloud backup…'}</p>
        {restoreBlocked && <p role="status">{RESTORE_BLOCKED_MESSAGE}</p>}
        {!preview ? <div className="flex gap-3">
          <button disabled={busy || !ready} onClick={() => { void prepare('backup') }}>Back up to cloud</button>
          <button disabled={busy || !ready || !cloud || restoreBlocked} onClick={() => { void prepare('restore') }}>Restore from cloud</button>
        </div> : <div role="group" aria-label={preview.kind === 'backup' ? 'Confirm cloud backup' : 'Preview cloud restore'} className="space-y-3">
          <p>Device: {counts(preview.device)}</p>
          <p>Cloud: {preview.cloud ? `${preview.cloud.updatedAt} — ${counts(preview.cloud.data)}` : 'No cloud backup yet'}</p>
          {preview.kind === 'backup' ? <>
            <p>Back up to {session?.user?.email}? This overwrites the cloud backup. The device library stays unchanged.</p>
            <button disabled={busy} onClick={() => { void confirm() }}>Confirm backup</button>
          </> : preview.cloud && <>
            <p>Only on device: {only(preview.device.songs, preview.cloud.data.songs)} songs, {only(preview.device.setlists, preview.cloud.data.setlists)} setlists.</p>
            <p>Only in cloud: {only(preview.cloud.data.songs, preview.device.songs)} songs, {only(preview.cloud.data.setlists, preview.device.setlists)} setlists.</p>
            <p>A verified local safety snapshot is saved first. Replace removes device-only items; Merge keeps both libraries.</p>
            <button disabled={busy || restoreBlocked} onClick={() => { void confirm('replace') }}>Replace device</button>
            <button disabled={busy || restoreBlocked} onClick={() => { void confirm('merge') }}>Merge into device</button>
          </>}
          <button disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
        </div>}
      </>}
      {onOpenDebugLogs && <div className="flex gap-2">
        <button disabled={busy} onClick={onOpenDebugLogs}>Diagnostics and debug logs</button>
        <button role="switch" aria-label="Record debug logs" aria-checked={debugLogs} onClick={() => { setDebugLoggingEnabled(!debugLogs); setDebugLogs(!debugLogs) }}>Record debug logs</button>
      </div>}
      {message && <p role="status">{message}</p>}
      <button disabled={busy} onClick={openRecoveryReview}>Review local recovery{recoveryAttention && <span data-testid="cloud-sync-recovery-dot" aria-hidden="true" className={recoveryDotClass} />}</button>
      <button disabled={busy} onClick={onClose}>Close</button>
    </div>
  </div>
}
