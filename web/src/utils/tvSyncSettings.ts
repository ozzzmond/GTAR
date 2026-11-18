import { useSyncExternalStore } from 'react'

export const TV_SYNC_KEY = 'gtar_tv_sync'
export const TV_SYNC_CHANGED = 'gtar-tv-sync-changed'

export function isTvSyncEnabled(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(TV_SYNC_KEY) === '1'
  } catch {
    return false
  }
}

export function setTvSyncEnabled(enabled: boolean, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
  try {
    if (enabled) storage?.setItem(TV_SYNC_KEY, '1')
    else storage?.removeItem(TV_SYNC_KEY)
  } catch {
    /* Storage can be unavailable; the choice then applies to this page view only. */
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
  return useSyncExternalStore(subscribe, () => isTvSyncEnabled(), () => false)
}
