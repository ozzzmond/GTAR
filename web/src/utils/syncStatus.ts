/**
 * #191 (RFC #188 S3): one header status pill for save and sync. Pure derivation; the hook that
 * feeds it lives in useSyncStatus.ts.
 *
 * Priority when several apply: attention › syncing › pending › synced › device.
 */
import type { CloudSyncStatus, SongbookHeadroomLevel, SyncReferenceState } from './cloudSongbookSync'

export type SyncPillKind = 'device' | 'syncing' | 'synced' | 'pending' | 'attention'

export interface SyncPillInput {
  signedIn: boolean
  status: CloudSyncStatus
  isProcessing: boolean
  /** Last successful sync on this device (ms epoch), from the sync metadata. */
  lastSyncedAt: number | null
  /** The saved library differs from what was last synced. */
  localChanged: boolean
  recoveryNeedsDecision: boolean
  syncReference: SyncReferenceState
  headroom: SongbookHeadroomLevel | null
  now: number
}

export interface SyncAttentionItem { id: 'conflict' | 'sync-error' | 'recovery' | 'sync-reference' | 'size-limit'; label: string }

export interface SyncPill {
  kind: SyncPillKind
  /** Visible text, e.g. "Synced · 2m". */
  label: string
  /** Full sentence for screen readers and the tooltip. */
  description: string
  attention: SyncAttentionItem[]
}

/** Compact age: "now", "5m", "3h", "2d". */
export function formatSyncAge(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function syncAttentionItems(input: Pick<SyncPillInput, 'status' | 'isProcessing' | 'recoveryNeedsDecision' | 'syncReference' | 'headroom'>): SyncAttentionItem[] {
  const items: SyncAttentionItem[] = []
  if (!input.isProcessing && input.status === 'CONFLICT') items.push({ id: 'conflict', label: 'Edited here and in the cloud' })
  if (!input.isProcessing && input.status === 'ERROR') items.push({ id: 'sync-error', label: 'Last sync did not finish' })
  if (input.recoveryNeedsDecision) items.push({ id: 'recovery', label: 'Local recovery needs a decision' })
  if (input.syncReference === 'missing') items.push({ id: 'sync-reference', label: 'Sync reference not saved on this device' })
  if (input.headroom === 'over') items.push({ id: 'size-limit', label: 'Songbook is over the cloud sync limit' })
  return items
}

export function deriveSyncPill(input: SyncPillInput): SyncPill {
  const attention = syncAttentionItems(input)
  if (attention.length) {
    return { kind: 'attention', label: `Needs attention · ${attention.length}`, attention,
      description: `Sync needs attention: ${attention.map(item => item.label).join('; ')}. Your edits are safe on this device. Open Sync Center.` }
  }
  if (input.isProcessing || input.status === 'SYNCING') {
    return { kind: 'syncing', label: 'Syncing…', attention, description: 'Syncing with the cloud. Open Sync Center.' }
  }
  if (!input.signedIn || input.lastSyncedAt === null) {
    return { kind: 'device', label: 'Saved on device', attention,
      description: input.signedIn ? 'Saved on this device. Not synced to the cloud yet. Open Sync Center.'
        : 'Saved on this device. Sign in to sync. Open Sync Center.' }
  }
  if (input.localChanged || input.status === 'OFFLINE' || input.status === 'LOCAL_NEWER' || input.status === 'CLOUD_NEWER') {
    return { kind: 'pending', label: 'Not synced yet', attention,
      description: 'Changes on this device are not synced yet. They are saved here. Open Sync Center.' }
  }
  const age = formatSyncAge(input.now - input.lastSyncedAt)
  return { kind: 'synced', label: age === 'now' ? 'Synced' : `Synced · ${age}`, attention,
    description: `Synced with the cloud${age === 'now' ? ' just now' : `, ${age} ago`}. Open Sync Center.` }
}
