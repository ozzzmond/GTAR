import { useEffect, useRef, useState } from 'react'
import { inspectRecovery, recordRecoveryChoice, recoveryData } from '../utils/syncJournal'

// Shared by startup notice, Cloud Sync and the catalog import preview.
export function RecoveryReviewDialog({ blocked, onClose }: { blocked: () => boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [review, setReview] = useState(() => inspectRecovery())
  const [choice, setChoice] = useState<'keep-current' | 'reopen' | null>(null)
  const [approved, setApproved] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => previous?.focus()
  }, [])

  const refresh = () => { setReview(inspectRecovery()); setChoice(null); setApproved(false); setError('') }

  const archiveSources = review.sources.filter(source => source.key.startsWith('gtar_sync_recovery:'))
  const actionable = review.sources.filter(source => source.status === 'actionable')
  const resolved = review.sources.filter(source => source.status === 'resolved')
  const invalid = review.sources.filter(source => source.status === 'invalid')

  const hasNoActionable = actionable.length === 0
  const keepCurrentDisabledReason = review.invalid
    ? 'Cannot proceed: one or more recovery sources are invalid or unreadable. Export all recovery data first.'
    : hasNoActionable
      ? 'No actionable conflicts exist. Your current library already accounts for all recovery records.'
      : actionable.some(source => !source.canKeepCurrent)
        ? 'One or more sources contain pending operations or legacy access-setting conflicts requiring manual recovery.'
        : null

  async function confirm() {
    if (!choice || !approved || busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await recordRecoveryChoice(review, choice, blocked); refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Recovery choice failed. Export recovery data.'); setChoice(null); setApproved(false) }
    finally { busyRef.current = false; setBusy(false) }
  }

  function exportSources() {
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(recoveryData(), null, 2)], { type: 'application/json' }))
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
                          {classifyMissing(record)} · ID {record.id}
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

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
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
              {choice === 'keep-current'
                ? 'Keep the current Songbook and its deletion choices. Missing songs and historical edits will remain only in preserved recovery data; they will not be imported or resurrected. This decision saves a snapshot of the current library and integrity references to the reviewed sources. All existing recovery sources and previous decisions stay intact. Export first if you need an external copy.'
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
