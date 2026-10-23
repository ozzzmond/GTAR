/**
 * #181: whether local recovery needs a decision (any actionable source). DEV only, like the
 * former banner. Shown as a red dot on the header Cloud Sync button and on "Review local recovery".
 * Recomputed only on the events that can change it, never per render.
 */
import { useSyncExternalStore } from 'react'
import { hasActionableRecovery } from './syncJournal'
import { isDevEnv } from './env'

export const RECOVERY_CHANGED_EVENT = 'gtar-recovery-changed'
const EVENTS = ['gtar-library-persisted', 'storage', RECOVERY_CHANGED_EVENT] as const

let current = false
let computed = false
const listeners = new Set<() => void>()

function compute(): boolean {
  if (!isDevEnv) return false
  try { return hasActionableRecovery() } catch { return false }
}
function refresh() {
  const next = compute()
  computed = true
  if (next !== current) { current = next; listeners.forEach(listener => listener()) }
}

function subscribe(listener: () => void) {
  if (listeners.size === 0 && typeof window !== 'undefined') EVENTS.forEach(type => window.addEventListener(type, refresh))
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== 'undefined') EVENTS.forEach(type => window.removeEventListener(type, refresh))
  }
}
function snapshot() {
  if (!computed) { current = compute(); computed = true }
  return current
}

/** Lets recovery writers (archives, decisions, cleanup) prompt an immediate refresh. */
export function notifyRecoveryChanged(): void {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new window.Event(RECOVERY_CHANGED_EVENT)) } catch { /* ignore */ }
}

export function useRecoveryAttention(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

/** Small red dot; `label` is announced to screen readers. */
export const recoveryDotClass = 'absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-status-error ring-2 ring-app-base'
