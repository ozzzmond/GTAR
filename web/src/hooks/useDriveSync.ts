import { useCallback, useEffect, useRef, useState } from 'react'
import { createBackupPayload, exportRecoveryData } from '../utils/jsonBackup'
import { clearDriveSession, readCloudRecovery, prepareCloudResolution, DriveSyncError, pullCloudBackup, pushCloudBackup } from '../utils/driveSync'
import { validSession } from '../utils/googleAuth'
import { openSyncJournal, persistLibrary, readRecoverySnapshots, isQuotaError } from '../utils/syncJournal'
import { getAuthorizedEmailsList, mergeCloudAuthorizedEmails } from '../utils/authPolicy'
import { useGoogleAuth } from '../components/AuthGate'
import { mergeSyncLibrary, type SyncLibrary } from '../utils/syncMerge'
import { isDefaultTemplateLibrary } from '../utils/defaultTemplateLibrary'

function formatSyncError(error: unknown, fallback: string): string {
  if (isQuotaError(error)) {
    return 'Local browser storage quota exceeded. Free up device storage or export a backup.'
  }
  if (error instanceof DriveSyncError && error.isDriveQuota) {
    return error.message
  }
  return error instanceof Error ? error.message : fallback
}

export function useDriveSync(library: SyncLibrary, apply: (library: SyncLibrary) => void) {
  const { session, signOut: lockApp, signIn, ready } = useGoogleAuth()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(import.meta.env.VITE_GOOGLE_CLIENT_ID ? 'Local changes are saved on this device.' : 'Google sync is not configured. Local editing is available.')
  const latest = useRef({ library, apply, session })
  useEffect(() => { latest.current = { library, apply, session } }, [library, apply, session])
  const generation = useRef(0)
  const running = useRef(false)
  const queued = useRef(false)
  const signOut = useCallback(() => {
    generation.current++
    if (latest.current.session) clearDriveSession(latest.current.session.token)
    latest.current.session = null
    lockApp()
    setStatus('Signed out. Sign in to access your saved device library.')
  }, [lockApp])
  useEffect(() => {
    if (!session) return
    const timer = setTimeout(() => {
      setStatus('Drive sync paused (offline).')
    }, Math.max(0, session.expiresAt - Date.now() - 30000))
    return () => clearTimeout(timer)
  }, [session])
  useEffect(() => () => {
    generation.current++
    const token = latest.current.session?.token
    if (token) clearDriveSession(token)
    latest.current.session = null
    queued.current = false
  }, [])
  const syncNow = useCallback(async function runSync() {
    const auth = latest.current.session
    if (!auth) return
    if (running.current) { queued.current = true; return }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatus('Drive sync paused (offline). Local changes are saved.')
      return
    }
    if (!validSession(auth)) {
      setStatus('Drive sync paused (offline).')
      return
    }
    const epoch = generation.current
    running.current = true
    setBusy(true)
    setStatus('Syncing...')
    try {
      const latestAtStart = latest.current.library
      const journal = openSyncJournal(auth.user.sub, latest.current.library)
      journal.archive(null)
      const cloud = await pullCloudBackup(auth.token)
      if (epoch !== generation.current || latest.current.session?.user.sub !== auth.user.sub) return
      if (cloud?.allowedUsers && Array.isArray(cloud.allowedUsers)) {
        mergeCloudAuthorizedEmails(cloud.allowedUsers)
      }
      journal.archive(cloud)
      const before = latest.current.library

      // First-connect reconciliation: If this device has no baseline yet and local state is just
      // default template songs (or empty), adopt the cloud library cleanly as the initial restore baseline.
      let merged: SyncLibrary
      if (cloud && journal.baseline === null && isDefaultTemplateLibrary(before)) {
        merged = cloud
      } else {
        // Rebase edits made during the download onto any interrupted local apply.
        const resumed = mergeSyncLibrary(before, journal.local, latestAtStart)
        merged = mergeSyncLibrary(resumed, cloud, journal.baseline)
      }

      journal.prepare(before, merged)
      const currentAllowedUsers = getAuthorizedEmailsList()
      await pushCloudBackup(auth.token, createBackupPayload(merged.songs, merged.setlists, undefined, currentAllowedUsers))
      if (epoch !== generation.current || latest.current.session?.user.sub !== auth.user.sub) return
      journal.acknowledge()
      const current = mergeSyncLibrary(latest.current.library, merged, before)
      persistLibrary(current)
      if (JSON.stringify(current) !== JSON.stringify(latest.current.library)) {
        latest.current.library = current
        latest.current.apply(current)
      }
      journal.complete()
      setStatus('Synced with Google Drive.')
    } catch (error) {
      if (epoch !== generation.current) return
      if (error instanceof DriveSyncError && error.status === 401) signOut()
      setStatus(formatSyncError(error, 'Sync failed. Local changes are saved.'))
    } finally {
      running.current = false; setBusy(false)
      if (queued.current) { queued.current = false; setTimeout(() => { void runSync() }, 1500) }
    }
  }, [signOut])
  useEffect(() => {
    if (!session) return
    const timer = setTimeout(() => { void syncNow() }, 0)
    return () => clearTimeout(timer)
  }, [session, syncNow])
  // Debounced auto-sync after library modifications (5-minute cooldown)
  useEffect(() => {
    if (!session) return
    const timer = setTimeout(() => { void syncNow() }, 5 * 60 * 1000)
    return () => clearTimeout(timer)
  }, [library.songs, library.setlists, session, syncNow])
  // Periodic safety net sync every 1 hour
  useEffect(() => {
    if (!session) return
    const interval = setInterval(() => { void syncNow() }, 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [session, syncNow])
  useEffect(() => {
    const online = () => { void syncNow() }
    window.addEventListener('online', online)
    return () => window.removeEventListener('online', online)
  }, [syncNow])
  // Auto-sync when dynamic user whitelist is updated
  useEffect(() => {
    const handleAuthUpdate = () => { void syncNow() }
    window.addEventListener('gtar:auth_updated', handleAuthUpdate)
    return () => window.removeEventListener('gtar:auth_updated', handleAuthUpdate)
  }, [syncNow])
  const publishResolvedLibrary = async () => {
    const auth = latest.current.session
    if (!auth || running.current) return
    const epoch = generation.current
    running.current = true; setBusy(true)
    try {
      const before = latest.current.library
      const journal = openSyncJournal(auth.user.sub, before, localStorage, false)
      journal.archive(null)
      await prepareCloudResolution(auth.token)
      if (epoch !== generation.current) return
      journal.prepare(before, before)
      const currentAllowedUsers = getAuthorizedEmailsList()
      await pushCloudBackup(auth.token, createBackupPayload(before.songs, before.setlists, undefined, currentAllowedUsers))
      if (epoch !== generation.current) return
      journal.acknowledge()
      persistLibrary(latest.current.library)
      journal.complete()
      setStatus('Resolved device library published. Previous cloud revisions are retained.')
    } catch (error) { setStatus(formatSyncError(error, 'Resolution failed; recovery copies retained.')) }
    finally { running.current = false; setBusy(false) }
  }
  const adoptCloudLibrary = async () => {
    const auth = latest.current.session
    if (!auth || running.current) return
    const epoch = generation.current
    running.current = true; setBusy(true)
    setStatus('Adopting cloud library...')
    try {
      const before = latest.current.library
      const journal = openSyncJournal(auth.user.sub, before, localStorage, false)
      journal.archive(null)
      let cloud: SyncLibrary | null = null
      try {
        cloud = await pullCloudBackup(auth.token)
      } catch {
        // If there are divergent cloud revisions, prepareCloudResolution sets up parents to resolve them
        await prepareCloudResolution(auth.token)
        cloud = await pullCloudBackup(auth.token)
      }
      if (epoch !== generation.current) return
      if (!cloud) {
        setStatus('Cloud library is empty. Nothing to adopt.')
        return
      }
      if (cloud.allowedUsers && Array.isArray(cloud.allowedUsers)) {
        mergeCloudAuthorizedEmails(cloud.allowedUsers)
      }
      journal.archive(cloud)
      journal.prepare(before, cloud)
      journal.acknowledge()
      persistLibrary(cloud)
      latest.current.library = cloud
      latest.current.apply(cloud)
      journal.complete()
      setStatus('Cloud library adopted successfully.')
    } catch (error) {
      setStatus(formatSyncError(error, 'Failed to adopt cloud library.'))
    } finally {
      running.current = false; setBusy(false)
    }
  }
  const exportRecovery = async () => {
    const auth = latest.current.session
    if (!auth) return
    const local = latest.current.library
    const snapshots = readRecoverySnapshots(auth.user.sub)
    try { exportRecoveryData({ local, snapshots, cloud: await readCloudRecovery(auth.token) }) }
    catch (error) {
      exportRecoveryData({ local, snapshots, cloudError: error instanceof Error ? error.message : 'Cloud unavailable' })
      setStatus('Device recovery archive exported. Cloud download failed; cloud revisions are retained in Drive.')
    }
  }
  return { session, busy, status, exportRecovery, publishResolvedLibrary, adoptCloudLibrary, signIn, signOut, syncNow, ready }
}

