import React, { useState, useRef } from 'react'
import { AlertTriangle, Download, Trash2 } from 'lucide-react'
import { inspectRecovery } from '../utils/syncJournal'
import { downloadRecoveryExport } from '../utils/recoveryExport'
import { RecoveryDataChangedError, deleteSavedRecoveryData } from '../utils/recoveryDataDelete'
import { notifyRecoveryChanged } from '../utils/recoveryAttention'
import {
  formatRecoverySize,
  markRecoveryDataSaved,
  recoveryDataSavedFor,
  savedRecoveryData,
  summarizeRecoveryData,
} from '../utils/recoveryDataSummary'
import {
  dangerButton,
  outlinedButton,
  primaryButton,
  sectionCard,
  sectionLabel,
  tone,
} from './backupCenterUi'

export interface RecoveryDataCardProps {
  blocked?: () => boolean
}

export const RecoveryDataCard: React.FC<RecoveryDataCardProps> = ({ blocked = () => false }) => {
  const [review, setReview] = useState(() => inspectRecovery())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const busyRef = useRef(false)

  const summary = summarizeRecoveryData(review)
  const saved = summary.count > 0 && recoveryDataSavedFor(review)
  const canDelete = saved

  async function run(task: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMessage(null)
    try {
      await task()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      const current = inspectRecovery()
      try {
        await downloadRecoveryExport()
        markRecoveryDataSaved(current)
        setReview(current)
        setMessage({ tone: 'success', text: 'Recovery data saved.' })
      } catch {
        setMessage({
          tone: 'error',
          text: 'Recovery data could not be saved. Nothing was changed. Try again.',
        })
      }
    })

  const changed = 'Recovery data changed since you saved it. Save it again first.'
  const remove = () =>
    run(async () => {
      setConfirming(false)
      try {
        const saved = savedRecoveryData()
        if (!saved || !recoveryDataSavedFor(inspectRecovery())) throw new RecoveryDataChangedError()
        const { kept } = await deleteSavedRecoveryData(saved, blocked)
        notifyRecoveryChanged()
        const left = kept.length
        setMessage({
          tone: 'success',
          text: left
            ? `Recovery data deleted. ${left} ${left === 1 ? 'copy' : 'copies'} could not be deleted here and stay${left === 1 ? 's' : ''} on this device.`
            : 'Recovery data deleted.',
        })
      } catch (error) {
        notifyRecoveryChanged()
        setMessage({
          tone: 'error',
          text:
            error instanceof RecoveryDataChangedError
              ? changed
              : 'Nothing was deleted. Close the editor and any other GTAR tabs, then try again.',
        })
      } finally {
        setReview(inspectRecovery())
      }
    })

  const row = (label: string, value: string, testId: string) => (
    <div className="min-w-0">
      <span className="text-app-muted block">{label}</span>
      <span
        data-testid={testId}
        className="text-app-heading font-semibold font-mono block truncate"
      >
        {value}
      </span>
    </div>
  )

  return (
    <div data-testid="recovery-data-card" className={sectionCard}>
      <span className={sectionLabel}>On this device</span>
      {summary.count === 0 ? (
        <p
          data-testid="recovery-data-empty"
          className="pt-2 border-t border-app-border/60 text-xs text-app-heading"
        >
          No recovery data on this device.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-app-border/60 text-[11px]">
            {row('Saved copies', String(summary.count), 'recovery-data-count')}
            {row('Size', formatRecoverySize(summary.bytes), 'recovery-data-size')}
          </div>
          {summary.unreadable && (
            <p
              data-testid="recovery-data-unreadable"
              role="status"
              className={tone.warning}
            >
              Some copies can&apos;t be opened. Save them before deleting.
            </p>
          )}

          {!confirming ? (
            <div className="space-y-2 pt-1">
              <button
                type="button"
                data-testid="recovery-data-save"
                className={primaryButton}
                disabled={busy}
                onClick={() => {
                  void save()
                }}
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>Save recovery data</span>
              </button>
              <button
                type="button"
                data-testid="recovery-data-delete"
                className={dangerButton}
                disabled={busy || !canDelete}
                aria-describedby={canDelete ? undefined : 'recovery-data-delete-hint'}
                onClick={() => {
                  setMessage(null)
                  setConfirming(true)
                }}
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Delete recovery data</span>
              </button>
              {!canDelete && (
                <p id="recovery-data-delete-hint" className="text-[11px] text-app-muted">
                  Save recovery data first to delete it.
                </p>
              )}
            </div>
          ) : (
            <div
              role="group"
              aria-label="Confirm delete"
              data-testid="recovery-data-confirm"
              className="p-4 rounded-xl border space-y-3 bg-status-warning/10 border-status-warning/40"
            >
              <div className="flex items-center gap-2 text-status-warning">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <h3 className="font-bold text-xs">Delete recovery data?</h3>
              </div>
              <p className="text-[11px] text-app-text">
                Delete all saved copies from this device? Your current songbook stays.
              </p>
              <button
                type="button"
                data-testid="recovery-data-confirm-delete"
                className={dangerButton}
                disabled={busy}
                onClick={() => {
                  void remove()
                }}
              >
                {busy ? 'Deleting…' : 'Delete'}
              </button>
              <button
                type="button"
                data-testid="recovery-data-confirm-keep"
                className={outlinedButton}
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}
      {message && (
        <p
          role="status"
          data-testid="recovery-data-message"
          className={message.tone === 'success' ? tone.success : tone.error}
        >
          {message.text}
        </p>
      )}
    </div>
  )
}
