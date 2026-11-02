/**
 * #304 item 8: plain-language summary of the recovery copies kept on this device (the sources of
 * the full recovery export, without the current library). Read-only.
 */
import { inspectRecovery, type RecoveryReview } from './syncJournal'

/** What the last successful "Save recovery data" in this app session covered (memory only). */
export interface SavedRecoveryData { sources: Array<[key: string, raw: string]>; decisionRaw: string | null }
let savedThisSession: SavedRecoveryData | null = null
const snapshot = (review: RecoveryReview): SavedRecoveryData => ({ sources: review.sources.map(source => [source.key, source.raw]), decisionRaw: review.decisionRaw })
export const recoveryDataSignature = (review: RecoveryReview) => JSON.stringify(snapshot(review))
export function markRecoveryDataSaved(review: RecoveryReview): void { savedThisSession = snapshot(review) }
export function recoveryDataSavedFor(review: RecoveryReview): boolean { return savedThisSession !== null && JSON.stringify(savedThisSession) === recoveryDataSignature(review) }
export function savedRecoveryData(): SavedRecoveryData | null { return savedThisSession }
/** Test hook: forget the in-session Save. */
export function resetRecoverySaveForTests(): void { savedThisSession = null }

export interface RecoveryDataSummary { count: number; bytes: number; unreadable: boolean }

export function summarizeRecoveryData(review: RecoveryReview = inspectRecovery()): RecoveryDataSummary {
  const count = review.sources.length
  const bytes = review.sources.reduce((sum, source) => sum + 2 * (source.key.length + source.raw.length), 0)
  return { count, bytes, unreadable: count > 0 && (review.invalid || review.sources.some(source => source.status === 'invalid')) }
}

/** "48 KB" below 1 MB, otherwise "13.7 MB". */
export function formatRecoverySize(bytes: number): string {
  const mb = bytes / 1024 / 1024
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${mb.toFixed(1)} MB`
}
