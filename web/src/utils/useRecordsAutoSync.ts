/**
 * RFC #188 S6: automatic per-record sync on DEV.
 *
 * Exactly one tab per browser runs it: the tab holding the Web Locks leader lock
 * (`gtar-records-sync-leader`); when that tab closes, another tab takes over. The leader syncs
 * a few seconds after a save (this tab or another), when the device comes back online or the
 * page becomes visible again, and every two minutes. Runs are skipped while the editor is open
 * or a cross-tab conflict is unresolved (`blocked`), and resume when that clears. Each run uses
 * the same per-record sync as "Sync Now", so conflicts are queued, never merged automatically.
 */
import { useEffect, useRef } from 'react'
import type { CloudSyncResult, CloudSyncStatus } from './cloudSongbookSync'
import { isLibraryStorageKey } from './syncJournal'
import { isRecordsSyncEnabled, performRecordsSync } from './recordsSync'
import type { SyncLibrary } from './syncMerge'

export const AUTO_SYNC_LEADER_LOCK = 'gtar-records-sync-leader'
export const AUTO_SYNC_DEBOUNCE_MS = 4000
export const AUTO_SYNC_INTERVAL_MS = 120000

export interface RecordsAutoSyncInput {
  enabled: boolean
  token: string | null | undefined
  blocked: boolean
  onApplied?: (library: SyncLibrary) => void
  onState?: (status: CloudSyncStatus, isProcessing: boolean) => void
  /** Test hooks. */
  sync?: (token: string, options?: { canApply?: () => boolean }) => Promise<CloudSyncResult | null>
  debounceMs?: number
}

export function useRecordsAutoSync(input: RecordsAutoSyncInput): void {
  const latest = useRef(input)
  useEffect(() => { latest.current = input })
  const scheduleRef = useRef<(() => void) | null>(null)
  // #208 F6: a result that arrives while blocked is delivered when the block ends, never during it.
  const pendingRef = useRef<SyncLibrary | null>(null)
  const { enabled, token, blocked } = input

  useEffect(() => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!enabled || !token || typeof window === 'undefined' || !locks?.request) return
    let disposed = false
    let leader = false
    let running = false
    let again = false
    let release: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const run = async () => {
      timer = null
      if (!leader || disposed) return
      if (running) { again = true; return }
      const current = latest.current
      if (current.blocked || !current.token || !isRecordsSyncEnabled() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
      running = true
      current.onState?.('SYNCING', true)
      try {
        const result = await (current.sync ?? performRecordsSync)(current.token, { canApply: () => !latest.current.blocked })
        if (disposed) return
        if (!result || result.deferred) { current.onState?.('IDLE', false); return }
        if (result.updatedLibrary) {
          if (latest.current.blocked) pendingRef.current = result.updatedLibrary
          else latest.current.onApplied?.(result.updatedLibrary)
        }
        latest.current.onState?.(result.status, false)
      } catch {
        latest.current.onState?.('ERROR', false)
      } finally {
        running = false
        if (again && !disposed) { again = false; schedule() }
      }
    }
    const schedule = () => {
      if (!leader || disposed) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void run() }, latest.current.debounceMs ?? AUTO_SYNC_DEBOUNCE_MS)
    }
    scheduleRef.current = schedule

    void locks.request(AUTO_SYNC_LEADER_LOCK, () => new Promise<void>(resolve => {
      if (disposed) { resolve(); return }
      leader = true
      release = resolve
      schedule()
    })).catch(() => { /* lock unavailable: no auto-sync in this tab */ })

    const onStorage = (event: StorageEvent) => { if (isLibraryStorageKey(event.key)) schedule() }
    const onVisible = () => { if (document.visibilityState === 'visible') schedule() }
    window.addEventListener('gtar-library-persisted', schedule)
    window.addEventListener('storage', onStorage)
    window.addEventListener('online', schedule)
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(() => { void run() }, AUTO_SYNC_INTERVAL_MS)

    return () => {
      disposed = true
      leader = false
      scheduleRef.current = null
      if (timer) clearTimeout(timer)
      clearInterval(interval)
      window.removeEventListener('gtar-library-persisted', schedule)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('online', schedule)
      document.removeEventListener('visibilitychange', onVisible)
      release?.()
    }
  }, [enabled, token])

  // Leaving the editor or resolving a cross-tab conflict catches up right away.
  useEffect(() => {
    if (blocked) return
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending) latest.current.onApplied?.(pending)
    scheduleRef.current?.()
  }, [blocked])
}
