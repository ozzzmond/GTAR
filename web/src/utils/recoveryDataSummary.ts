/**
 * #304 item 8: plain-language summary of the recovery copies kept on this device (the sources of
 * the full recovery export, without the current library). Read-only.
 */
import { inspectRecovery, type RecoveryReview } from './syncJournal'

/** Exact copies covered by the last successful "Save recovery data" in this app session (memory only). */
let savedThisSession: string | null = null
export const recoveryDataSignature = (review: RecoveryReview) => JSON.stringify(review.sources.map(source => [source.key, source.raw]))
export function markRecoveryDataSaved(review: RecoveryReview): void { savedThisSession = recoveryDataSignature(review) }
export function recoveryDataSavedFor(review: RecoveryReview): boolean { return savedThisSession !== null && savedThisSession === recoveryDataSignature(review) }
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
