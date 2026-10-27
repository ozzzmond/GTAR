import { useEffect, useRef, useState } from 'react'
import { inspectRecovery, recordRecoveryChoice, recoveryExportData, planRecoveryCleanup, confirmRecoveryCleanup, localStorageBytes, recoveryRetentionUsage, isLibraryIndexActive, enableLibraryIndex, disableLibraryIndex,
  isLibraryB2Active, enableLibraryB2, disableLibraryB2, libraryB2Status } from '../utils/syncJournal'
import { B2_FLAG_KEY, clearB2Hold, holdMessage } from '../utils/libraryB2'

import { isDevEnv } from '../utils/env'
import type { ShadowCleanupPlan } from '../utils/libraryBodyStore'

// Shared by startup notice, Cloud Sync and the catalog import preview.
export function RecoveryReviewDialog({ blocked, onClose }: { blocked: () => boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [review, setReview] = useState(() => inspectRecovery())
  const [choice, setChoice] = useState<'keep-current' | 'reopen' | 'cleanup' | 'shadow' | 'b1' | 'b2' | null>(null)
  const [approved, setApproved] = useState(false)
  const [shadow, setShadow] = useState<ShadowCleanupPlan | null>(null)
  const cleanup = planRecoveryCleanup(review)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => previous?.focus()
  }, [])

  const refresh = () => { setReview(inspectRecovery()); setChoice(null); setApproved(false); setError(''); setShadow(null) }

  const archiveSources = review.sources.filter(source => source.key.startsWith('gtar_sync_recovery:'))
  const actionable = review.sources.filter(source => source.status === 'actionable')
  const resolved = review.sources.filter(source => source.status === 'resolved')
  const invalid = review.sources.filter(source => source.status === 'invalid')

  const hasNoActionable = actionable.length === 0
  const b1On = isDevEnv && isLibraryIndexActive()
  // #252 B2 (DEV toggle, off by default): per-record IndexedDB storage.
  const b2 = libraryB2Status()
  const b2Enabled = (() => { try { return localStorage.getItem(B2_FLAG_KEY) === '1' } catch { return false } })()
  const b2On = isDevEnv && isLibraryB2Active()
  const retention = recoveryRetentionUsage(localStorage)
  const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(2)
  // Distinct missing records across actionable sources; titles stay behind a disclosure.
  const missingTitles = [...new Map(actionable.flatMap(source => source.differences)
    .filter(record => record.difference === 'missing')
    .map(record => [`${record.kind}:${record.id}`, record] as const)).values()]
  const keepCurrentDisabledReason = review.invalid
    ? 'Cannot proceed: one or more recovery sources are invalid or unreadable. Export all recovery data first.'
    : hasNoActionable && !archiveSources.some(source => source.status === 'represented')
      ? 'No actionable conflicts exist. Your current library already accounts for all recovery records.'
      : actionable.some(source => !source.canKeepCurrent)
        ? 'One or more sources contain pending operations or legacy access-setting conflicts requiring manual recovery.'
        : null

  async function confirm() {
    if (!choice || !approved || busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      if (choice === 'cleanup') await confirmRecoveryCleanup(review, approved, blocked)
      else if (choice === 'shadow' && shadow) {
        const store = await import('../utils/libraryBodyStore')
        await store.confirmShadowCleanup(shadow, approved, blocked)
      } else if (choice === 'b1') {
        // #171 B1 (DEV): switch under the shared lock, then reload so every view reads the new source.
        if (!navigator.locks?.request) throw new Error('Library storage switch requires Web Locks support.')
        await navigator.locks.request('gtar-catalog-setlist-import', { mode: 'exclusive', ifAvailable: true }, async lock => {
          if (!lock || blocked()) throw new Error('Resolve editor edits or cross-tab conflicts first.')
          if (b1On) disableLibraryIndex()
          else await enableLibraryIndex()
        })
        window.location.reload()
        return
      } else if (choice === 'b2') {
        // #252 B2 (DEV): turning on runs the verified migration on the next start; turning off writes back first.
        if (!navigator.locks?.request) throw new Error('Library storage switch requires Web Locks support.')
        await navigator.locks.request('gtar-catalog-setlist-import', { mode: 'exclusive', ifAvailable: true }, async lock => {
          if (!lock || blocked()) throw new Error('Resolve editor edits or cross-tab conflicts first.')
          if (b2.hold) clearB2Hold(localStorage)
          else if (b2On || b2Enabled) await disableLibraryB2()
          else enableLibraryB2()
        })
        window.location.reload()
        return
      } else if (choice === 'keep-current' || choice === 'reopen') await recordRecoveryChoice(review, choice, blocked)
      refresh()
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Recovery choice failed. Export recovery data.'); setChoice(null); setApproved(false) }
    finally { busyRef.current = false; setBusy(false) }
  }

  async function reviewShadow() {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { const store = await import('../utils/libraryBodyStore'); setShadow(await store.inspectShadowCleanup()); setChoice('shadow'); setApproved(false) }
    catch (err) { setError(err instanceof Error ? err.message : 'Shadow review failed; data retained.') }
    finally { busyRef.current = false; setBusy(false) }
  }

  function exportSources() {
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(recoveryExportData(), null, 2)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = 'GTAR-storage-recovery.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setError('Recovery export failed. Keep browser storage intact and retry.') }
  }

  /** Human-readable source type label from the storage key. */
  function sourceLabel(key: string): string {
    if (key === 'legacy') return 'Legacy stores'
    if (key.startsWith('gtar_sync_v1:')) return 'Legacy journal'
    const kind = key.split(':')[1]
    const labels: Record<string, string> = {
      download: 'Cloud download',
      'cross-tab-conflict': 'Cross-tab conflict',
      replacement: 'Replacement snapshot',
      merge: 'Merge snapshot',
      upload: 'Upload snapshot',
      concurrency: 'Concurrency snapshot',
    }
    return labels[kind] ?? 'Recovery archive'
  }

  /** Classify a missing-record difference for the UI. */
  function classifyMissing(difference: { difference: string; deleted: boolean }): string {
    if (difference.difference === 'missing') {
      return difference.deleted
        ? 'Absent from current library (archived as deleted)'
        : 'Currently missing — not present in current library'
    }
    return 'Divergent — different version in current library'
  }

  const button = 'min-h-11 border border-app-border rounded-lg px-3 py-2 cursor-pointer disabled:opacity-40 font-mono text-xs font-bold transition-colors hover:border-app-action'

  return (
    <dialog
      ref={dialog}
      aria-label="Local recovery review"
      onCancel={event => { event.preventDefault(); if (!busyRef.current) onClose() }}
      className="bg-app-surface text-app-text rounded-xl p-0 w-full max-w-lg max-h-[90dvh] overflow-y-auto backdrop:bg-black/60 flex flex-col"
    >
      {/* Header */}
      <div className="p-4 border-b border-app-border/60 flex items-center justify-between">
        <h2 className="font-bold text-lg">Local Recovery Review</h2>
        <button
          type="button"
          className="min-h-11 px-3 py-1 text-xs font-mono border border-app-border rounded-lg cursor-pointer hover:border-app-action disabled:opacity-40"
          disabled={busy}
          onClick={onClose}
          aria-label="Close recovery review"
        >
          Close
        </button>
      </div>

      <div className="p-4 space-y-4 flex-1 overflow-y-auto">
        {/* Context note */}
        <p className="text-xs text-app-muted">
          Cloud sync does not resolve local recovery history. This review does not change your Songbook.
        </p>

        {/* Summary metrics — separate current vs. historical */}
        <section aria-label="Recovery summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div
            data-testid="recovery-metric-archives"
            className="rounded-lg border border-app-border bg-app-base p-2.5 text-center"
          >
            <div className="text-lg font-bold text-app-heading">{archiveSources.length}</div>
            <div className="text-[10px] font-mono text-app-muted">Archives</div>
          </div>
          <div
            data-testid="recovery-metric-actionable"
            className={`rounded-lg border p-2.5 text-center ${actionable.length > 0 ? 'border-status-warning/50 bg-status-warning/10' : 'border-app-border bg-app-base'}`}
          >
            <div className={`text-lg font-bold ${actionable.length > 0 ? 'text-status-warning' : 'text-app-heading'}`}>
              {actionable.length}
            </div>
            <div className="text-[10px] font-mono text-app-muted">Actionable</div>
          </div>
          <div
            data-testid="recovery-metric-resolved"
            className="rounded-lg border border-status-success/30 bg-status-success/8 p-2.5 text-center"
          >
            <div className="text-lg font-bold text-status-success">{resolved.length}</div>
            <div className="text-[10px] font-mono text-app-muted">Resolved history</div>
          </div>
          <div
            data-testid="recovery-metric-invalid"
            className={`rounded-lg border p-2.5 text-center ${invalid.length > 0 ? 'border-status-error/50 bg-status-error/10' : 'border-app-border bg-app-base'}`}
          >
            <div className={`text-lg font-bold ${invalid.length > 0 ? 'text-status-error' : 'text-app-heading'}`}>
              {invalid.length}
            </div>
            <div className="text-[10px] font-mono text-app-muted">Invalid sources</div>
          </div>
        </section>

        {/* Missing / divergent summary */}
        <div className="text-xs font-mono text-app-muted space-y-0.5">
          <p data-testid="recovery-missing-count">
            <span className="font-bold text-app-heading">{review.missingRecords}</span> distinct missing records
            {review.missingRecords === 0 && ' — none currently absent'}
          </p>
          <p data-testid="recovery-divergent-count">
            <span className="font-bold text-app-heading">{review.divergentVersions}</span> divergent versions (including resolved history)
          </p>
        </div>

        {/* Recovery storage usage and guided order (#173) */}
        <div data-testid="recovery-retention-usage" className="text-xs font-mono text-app-muted">
          Recovery storage{retention.indexedDb ? ' (IndexedDB)' : ''}: {retention.count} of {retention.maxCount} archives · {mib(retention.bytes)} of {mib(retention.maxBytes)} MiB
        </div>
        {!review.invalid && (actionable.length > 0 || cleanup.length > 0) && (
          <ol
            data-testid="recovery-guided-steps"
            aria-label="How to free recovery storage"
            className="p-2.5 rounded-lg border border-status-warning/40 bg-status-warning/8 text-xs space-y-1 list-decimal list-inside"
          >
            <li className={actionable.length ? 'text-app-heading' : 'text-app-muted line-through'}>Export all recovery data (keeps an external copy).</li>
            <li className={actionable.length ? 'text-app-heading' : 'text-app-muted line-through'}>
              Choose current library{actionable.length ? ` for ${actionable.length} undecided ${actionable.length === 1 ? 'archive' : 'archives'}` : ' (done)'}. Undecided archives can't be cleaned up.
            </li>
            <li className="text-app-heading">
              Review decided archive cleanup{cleanup.length ? ` — ${cleanup.length} ready to remove` : ''}, then retry sync.
            </li>
          </ol>
        )}
        {missingTitles.length > 0 && (
          <details data-testid="recovery-missing-titles" className="rounded-lg border border-status-warning/30 text-xs">
            <summary className="min-h-11 cursor-pointer px-3 py-2 select-none font-mono">
              Show {missingTitles.length} missing {missingTitles.length === 1 ? 'record' : 'records'} before deciding
            </summary>
            <ul className="px-3 pb-3 space-y-1">
              {missingTitles.map(record => (
                <li key={`${record.kind}:${record.id}`} className="break-words">
                  <span className="font-bold text-app-heading">{record.kind === 'song' ? '♪' : '☰'} {record.title}</span>
                  <span className="text-app-muted ml-2">{classifyMissing(record)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* Invalid banner */}
        {review.invalid && (
          <p
            role="alert"
            data-testid="recovery-invalid-banner"
            className="p-2.5 rounded-lg bg-status-error/15 border border-status-error/30 text-status-error text-xs font-mono"
          >
            Invalid or unreadable recovery requires manual recovery. Keep browser storage intact and export all recovery data.
          </p>
        )}

        {/* Zero-actionable empty state */}
        {hasNoActionable && !review.invalid && (
          <div
            data-testid="recovery-no-actionable-state"
            className="p-4 rounded-lg border border-status-success/30 bg-status-success/8 text-center space-y-1"
          >
            <p className="text-sm font-bold text-status-success">No active conflicts</p>
            <p className="text-xs text-app-muted">
              {resolved.length > 0
                ? `${resolved.length} resolved ${resolved.length === 1 ? 'source is' : 'sources are'} retained as history. Your current library is consistent with all recovery records.`
                : 'Your current library accounts for all recovery records.'}
            </p>
          </div>
        )}

        {/* Source details */}
        {review.sources.map((source, index) => {
          const isResolved = source.status === 'resolved'
          const isInvalid = source.status === 'invalid'
          const isActionable = source.status === 'actionable'
          const isRepresented = source.status === 'represented'

          let statusColor = 'text-app-muted'
          if (isActionable) statusColor = 'text-status-warning'
          if (isResolved) statusColor = 'text-status-success'
          if (isInvalid) statusColor = 'text-status-error'

          let statusLabel: string = source.status
          if (isResolved) statusLabel = 'resolved (retained history)'
          if (isRepresented) statusLabel = 'represented in current library'

          return (
            <details
              key={source.key}
              data-testid={`recovery-source-${index}`}
              className={`rounded-lg border ${isActionable ? 'border-status-warning/40' : isResolved ? 'border-status-success/30' : isInvalid ? 'border-status-error/40' : 'border-app-border'} overflow-hidden`}
            >
              <summary
                className="min-h-11 cursor-pointer px-3 py-2 flex items-center justify-between gap-2 select-none"
                aria-label={`Recovery source ${index + 1}: ${sourceLabel(source.key)}`}
              >
                <span className="font-mono text-xs font-bold text-app-heading truncate">
                  {sourceLabel(source.key)}
                </span>
                <span className={`text-[10px] font-mono shrink-0 ${statusColor}`}>
                  {statusLabel} · {source.differences.length} difference{source.differences.length !== 1 ? 's' : ''}
                </span>
              </summary>

              <div className="px-3 pb-3 space-y-2 text-xs font-mono">
                <p className="text-app-muted break-all">{retention.indexedDb ? 'IndexedDB' : 'localStorage'}: {source.key} · {source.raw.length.toLocaleString()} chars · {((source.key.length + source.raw.length) * 2).toLocaleString()} bytes (UTF-16 estimate)</p>
                {source.cloudRecordsOnly && (
                  <p data-testid={`source-cloud-records-note-${index}`} className="p-2 rounded bg-status-warning/8 border border-status-warning/30 text-[11px] text-app-text font-sans">
                    This archive also holds the cloud versions a conflict choice did not keep (listed below with their cloud revision). They are included in “Export all recovery data” but cannot be restored from this review.
                  </p>
                )}
                {source.unreadable && (
                  <p data-testid={`source-unreadable-note-${index}`} className="p-2 rounded bg-status-warning/8 border border-status-warning/30 text-[11px] text-app-text font-sans">
                    The {source.unreadable.join(' and ')} in this archive is not a valid library, so only this device's copy is reviewed here. The full archive is kept and is included in “Export all recovery data”.
                  </p>
                )}
                {/* Resolved history note */}
                {isResolved && (
                  <p
                    data-testid={`source-resolved-note-${index}`}
                    className="p-2 rounded bg-status-success/8 border border-status-success/20 text-status-success text-[11px]"
                  >
                    This source was explicitly accepted. Its history is retained. No action needed.
                  </p>
                )}

                {/* Represented note */}
                {isRepresented && (
                  <p className="text-app-muted text-[11px]">
                    All records from this source are already represented in your current library.
                  </p>
                )}

                {/* Pending operations warning */}
                {isActionable && !source.canKeepCurrent && (
                  <p
                    data-testid={`source-pending-warning-${index}`}
                    className="p-2 rounded bg-status-error/10 border border-status-error/30 text-status-error text-[11px]"
                  >
                    Pending operations or legacy settings need manual recovery.
                  </p>
                )}

                {/* Privacy note — titles only shown when opened */}
                <p className="text-[10px] text-app-muted italic">
                  Titles appear only when you open this source. Same-title songs with different IDs remain separate records. Deleted versions stay deleted.
                </p>

                {/* Differences list */}
                {source.differences.length > 0 && (
                  <ul className="space-y-1" aria-label="Record differences">
                    {source.differences.map((record, position) => (
                      <li
                        key={position}
                        data-testid={`difference-${index}-${position}`}
                        className={`p-1.5 rounded border text-[11px] break-words ${record.difference === 'missing' ? 'border-status-warning/30 bg-status-warning/8' : 'border-app-border bg-app-base/60'}`}
                      >
                        <span className="font-bold text-app-heading">
                          {record.kind === 'song' ? '♪' : '☰'} {record.title}
                        </span>
                        <span className="text-app-muted ml-2">
                          {classifyMissing(record)} · ID {record.id}{typeof record.revision === 'number' ? ` · cloud revision ${record.revision}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          )
        })}

        {/* Export privacy note */}
        <p className="text-[10px] text-app-muted">
          Export includes private library data, every recovery source and previous decisions. Keep it private.
          Use the existing Backup / Restore workflow for a supported backup;
          historical raw recovery may require manual recovery.
        </p>

        {isDevEnv && (b2On || b2Enabled || b2.hold) && <p className="text-xs text-app-muted" data-testid="library-b2-status">
          {b2On
            ? `Library storage B2: on (${b2.identity?.kind === 'account' ? 'account' : 'this device, not linked'}) · ${b2.songs.toLocaleString()} songs, ${b2.setlists.toLocaleString()} setlists · revision ${b2.libraryRev}${b2.pending ? `, ${b2.pending} saving` : ''}. Personal cloud sync is paused; use Backup for an off-device copy.`
            : b2.hold ? `Library storage B2 on hold: ${holdMessage(b2.hold)}` : 'Library storage B2: on after reload.'}
        </p>}
        <p className="text-xs text-app-muted">{b2On ? 'IndexedDB gtar_library_b2 (B2, per record)' : isLibraryIndexActive() ? 'localStorage gtar_library_v2 (B1 index)' : 'localStorage gtar_library_v1'}: {(2 * (review.libraryRaw?.length ?? 0)).toLocaleString()} bytes; gtar_recovery_decisions_v1: {(2 * (review.decisionRaw?.length ?? 0)).toLocaleString()} bytes. Browser storage: approximately {localStorageBytes(localStorage).toLocaleString()} bytes in localStorage. {cleanup.length} decided archives eligible for confirmed cleanup. Undecided archives are never removed. Retention limit: {retention.maxCount} archives / {mib(retention.maxBytes)} MiB{retention.indexedDb ? ' (archives in IndexedDB)' : ''}; review is required when full.</p>
        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy || review.invalid || !review.decisionRaw} onClick={() => { setChoice('cleanup'); setApproved(false) }} data-testid="review-cleanup-btn">Review decided archive cleanup</button>
          {isDevEnv && <button className={button} disabled={busy} onClick={reviewShadow}>Review shadow storage</button>}
          {isDevEnv && <button className={button} disabled={busy} onClick={() => { setChoice('b1'); setApproved(false) }} data-testid="library-b1-toggle-btn">
            Library storage B1: {b1On ? 'On — turn off' : 'Off — turn on'}
          </button>}
          {isDevEnv && <button className={button} disabled={busy} onClick={() => { setChoice('b2'); setApproved(false) }} data-testid="library-b2-toggle-btn">
            Library storage B2: {b2.hold ? 'On hold — retry' : b2On || b2Enabled ? 'On — turn off' : 'Off — turn on'}
          </button>}
          <button className={button} disabled={busy} onClick={exportSources} data-testid="export-recovery-btn">
            Export all recovery data
          </button>
          <button className={button} disabled={busy} onClick={refresh} data-testid="refresh-recovery-btn">
            Refresh review
          </button>
          <button
            className={button}
            disabled={busy || !!keepCurrentDisabledReason}
            onClick={() => { setChoice('keep-current'); setApproved(false) }}
            data-testid="choose-current-library-btn"
            aria-describedby={keepCurrentDisabledReason ? 'keep-current-disabled-reason' : undefined}
          >
            Choose current library
          </button>
          {/* Explain why Choose current library is disabled */}
          {keepCurrentDisabledReason && (
            <p
              id="keep-current-disabled-reason"
              data-testid="keep-current-disabled-reason"
              className="w-full text-[10px] text-app-muted"
              role="note"
            >
              {keepCurrentDisabledReason}
            </p>
          )}
          {!!resolved.length && (
            <button
              className={button}
              disabled={busy || review.invalid}
              onClick={() => { setChoice('reopen'); setApproved(false) }}
              data-testid="reopen-recovery-btn"
            >
              Reopen recovery conflicts
            </button>
          )}
        </div>

        {/* Confirmation section for chosen action */}
        {choice && (
          <section
            data-testid="recovery-confirmation-section"
            className="border border-app-border rounded-lg p-3 space-y-2"
            aria-label="Confirm recovery choice"
          >
            <p className="text-xs text-app-heading">
              {choice === 'cleanup'
                ? `Remove ${cleanup.length} decided archives (${cleanup.reduce((sum, item) => sum + 2 * (item.key.length + item.raw.length), 0).toLocaleString()} bytes), oldest first, only if their recorded SHA-256 still matches. Compact historical decisions to library digests and counts. This removes archived versions and historical library baselines; export first if you need those copies. Your Songbook and undecided archives stay intact.`
                : choice === 'b1'
                ? (b1On
                  ? 'Turn off B1: write the full library (with every edit made while on) back to gtar_library_v1, verify it, then reload. IndexedDB bodies stay.'
                  : 'Turn on B1: copy every chart body to IndexedDB, verify, write the slim gtar_library_v2 index, then reload. On DEV, the next clean startup retires gtar_library_v1 to a verified IndexedDB copy. Export recovery data first.')
                : choice === 'b2'
                ? (b2.hold
                  ? 'Retry B2: on reload the move is checked again from the start. Nothing was deleted; if it fails again the earlier library stays in use.'
                  : b2On || b2Enabled
                  ? 'Turn off B2: save a copy of the earlier library in recovery, write the B2 library (with every edit made while on) back to it, verify, then reload. The B2 copy stays on this device. Personal cloud sync resumes.'
                  : 'Turn on B2: on reload every song and setlist is copied into per-record IndexedDB storage for this account, read back and checked (counts and checksums) before it is used. The earlier library is kept unchanged. Personal cloud sync pauses while B2 is on. Export a backup first.')
                : choice === 'shadow'
                ? `IndexedDB gtar_library_bodies_db / bodies: ${shadow?.totalCount ?? 0} bodies, approximately ${shadow?.totalBytes ?? 0} bytes. Remove ${shadow?.records.length ?? 0} unreferenced bodies (${shadow?.orphanBytes ?? 0} bytes). Bodies referenced by your Songbook and retained recovery history are protected. Superseded chart history will be removed.`
                : choice === 'keep-current'
                ? 'Keep the current Songbook and its deletion choices. Missing songs and historical edits will remain only in preserved recovery data; they will not be imported or resurrected. This decision saves a digest, counts, timestamp and integrity references to the reviewed sources. All existing recovery sources and previous decisions stay intact. Export first if you need an external copy.'
                : 'Reopen these recovery conflicts and block new catalog imports until they are resolved again. Your library and archives stay intact.'}
            </p>
            <label className="block py-2 text-xs">
              <input
                type="checkbox"
                checked={approved}
                onChange={event => setApproved(event.target.checked)}
                className="mr-2"
              />
              I explicitly approve this recovery choice.
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className={button}
                disabled={busy || !approved}
                onClick={confirm}
                data-testid="confirm-recovery-choice-btn"
              >
                Confirm recovery choice
              </button>
              <button
                className={button}
                disabled={busy}
                onClick={() => { setChoice(null); setApproved(false) }}
                data-testid="cancel-recovery-choice-btn"
              >
                Cancel recovery choice
              </button>
            </div>
          </section>
        )}

        {error && <p role="alert" className="text-xs text-status-error">{error}</p>}
      </div>
    </dialog>
  )
}
