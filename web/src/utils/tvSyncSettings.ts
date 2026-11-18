import { useSyncExternalStore } from 'react'
import { stageCast } from './stageCast'
import { stageCast2Controller } from './stageCast2Controller'

export const TV_SYNC_KEY = 'gtar_tv_sync'
export const TV_SYNC_CHANGED = 'gtar-tv-sync-changed'

export function isTvSyncEnabled(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    const val = storage?.getItem(TV_SYNC_KEY)
    if (val === '0') return false
    if (val === '1') return true
    return true
  } catch {
    return true
  }
}

export function setTvSyncEnabled(enabled: boolean, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(TV_SYNC_KEY, enabled ? '1' : '0')
  } catch {
    /* Storage can be unavailable; the choice then applies to this page view only. */
  }
  if (!enabled) {
    try {
      stageCast.stopPresentation()
      stageCast2Controller.end()
    } catch {
      /* Best-effort operation: failure must not interrupt the workflow. */
    }
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TV_SYNC_CHANGED))
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(TV_SYNC_CHANGED, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(TV_SYNC_CHANGED, listener)
    window.removeEventListener('storage', listener)
  }
}

export function useTvSyncEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => isTvSyncEnabled(), () => true)
}
