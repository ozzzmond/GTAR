/**
 * #299: the one recovery action left in the normal UI. Old recovery archives (left by the removed
 * auto-sync, restore snapshots that went to the archive store, legacy stores) stay on the device;
 * users can only export them. The export is the same full set Local Recovery Review exports,
 * B2 partitions included. Nothing here deletes or changes recovery data.
 */
import { useSyncExternalStore } from 'react'
import { inspectRecovery, recoveryExportData } from './syncJournal'
import { b2RecoveryScopes, exportB2Partition } from './libraryB2'
import { RECOVERY_CHANGED_EVENT } from './recoveryAttention'

/** Signature of the archives covered by the last export handed out on this device. */
export const RECOVERY_EXPORT_SAVED_KEY = 'gtar_recovery_export_saved_v1'
export const RECOVERY_EXPORT_FILE_NAME = 'GTAR-storage-recovery.json'
const SAVED_EVENT = 'gtar-recovery-export-saved'
const EVENTS = ['gtar-library-persisted', 'storage', RECOVERY_CHANGED_EVENT, SAVED_EVENT] as const

/** Full recovery export: every recovery source plus every B2 partition (a failing partition is recorded, not fatal). */
export async function recoveryExportWithPartitions(storage: Storage = localStorage): Promise<Record<string, string>> {
  const data = recoveryExportData(storage)
  for (const scope of b2RecoveryScopes(storage)) {
    try { data[`gtar_library_b2::${scope}`] = JSON.stringify(await exportB2Partition(scope, storage)) }
    catch (error) {
      data[`gtar_library_b2_error::${scope}`] = JSON.stringify({ scope, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return data
}

/** Hands the full recovery export to browser downloads. Throws when it could not be built. */
export async function downloadRecoveryExport(storage: Storage = localStorage): Promise<void> {
  const data = await recoveryExportWithPartitions(storage)
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = RECOVERY_EXPORT_FILE_NAME; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const hash = (text: string) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = (h * 33 + text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** Signature of the recovery archives on this device, or null when there are none. */
export function oldRecoveryDataSignature(storage: Storage = localStorage): string | null {
  const sources = inspectRecovery(storage).sources
  if (!sources.length) return null
  return `${sources.length}:${hash(sources.map(source => `${source.key}\u0000${source.raw}`).sort().join('\u0001'))}`
}

/** Exports old recovery data and remembers (on this device) which archives that export covered. */
export async function exportOldRecoveryData(storage: Storage = localStorage): Promise<void> {
  const signature = oldRecoveryDataSignature(storage)
  await downloadRecoveryExport(storage)
  try { if (signature) storage.setItem(RECOVERY_EXPORT_SAVED_KEY, signature) } catch { /* reminder state is optional */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new window.Event(SAVED_EVENT))
}

export interface OldRecoveryData { exists: boolean; exported: boolean }
const NONE: OldRecoveryData = { exists: false, exported: false }
let current: OldRecoveryData = NONE
let computed = false
const listeners = new Set<() => void>()

function compute(): OldRecoveryData {
  try {
    const signature = oldRecoveryDataSignature()
    if (!signature) return NONE
    let saved: string | null = null
    try { saved = localStorage.getItem(RECOVERY_EXPORT_SAVED_KEY) } catch { /* treat as not saved */ }
    return { exists: true, exported: saved === signature }
  } catch { return NONE }
}
function refresh() {
  const next = compute()
  computed = true
  if (next.exists !== current.exists || next.exported !== current.exported) { current = next; listeners.forEach(listener => listener()) }
}
function subscribe(listener: () => void) {
  if (listeners.size === 0 && typeof window !== 'undefined') EVENTS.forEach(type => window.addEventListener(type, refresh))
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    // Unwatched storage can change; the next subscriber recomputes.
    computed = false
    if (typeof window !== 'undefined') EVENTS.forEach(type => window.removeEventListener(type, refresh))
  }
}
function snapshot() {
  if (!computed) { current = compute(); computed = true }
  return current
}

/** Whether old recovery archives exist, and whether their export was already handed out on this device. */
export function useOldRecoveryData(): OldRecoveryData {
  return useSyncExternalStore(subscribe, snapshot, () => NONE)
}
