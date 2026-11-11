import { useSyncExternalStore } from 'react'

/** Online song sources are opt-in and off by default; no account is involved (#453 N1). */
export const ONLINE_SOURCES_KEY = 'gtar_online_sources'
export const ONLINE_SOURCES_CHANGED = 'gtar-online-sources-changed'

export function isOnlineSourcesEnabled(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try { return storage?.getItem(ONLINE_SOURCES_KEY) === '1' } catch { return false }
}

export function setOnlineSourcesEnabled(enabled: boolean, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
  try {
    if (enabled) storage?.setItem(ONLINE_SOURCES_KEY, '1')
    else storage?.removeItem(ONLINE_SOURCES_KEY)
  } catch { /* Storage can be unavailable; the choice then applies to this page view only. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ONLINE_SOURCES_CHANGED))
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(ONLINE_SOURCES_CHANGED, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(ONLINE_SOURCES_CHANGED, listener)
    window.removeEventListener('storage', listener)
  }
}

export function useOnlineSourcesEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => isOnlineSourcesEnabled(), () => false)
}
