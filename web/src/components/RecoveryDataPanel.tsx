// #304 item 8: "Recovery data" — older copies of the songbook kept on this device, in plain language.
// Same modal shell and card styles as the Backup & Restore center. Save hands out the full recovery
// export unchanged; Delete (only after Save in this session, for exactly the saved copies) removes the
// saved recovery copies by compare-and-delete (recoveryDataDelete), never the current library, backups or settings.
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Download, History, Trash2, X } from 'lucide-react'
import { inspectRecovery } from '../utils/syncJournal'
import { downloadRecoveryExport } from '../utils/recoveryExport'
import { RecoveryDataChangedError, deleteSavedRecoveryData } from '../utils/recoveryDataDelete'
import { notifyRecoveryChanged } from '../utils/recoveryAttention'
import { formatRecoverySize, markRecoveryDataSaved, recoveryDataSavedFor, savedRecoveryData, summarizeRecoveryData } from '../utils/recoveryDataSummary'
import { dangerButton, outlinedButton, primaryButton, sectionCard, sectionLabel, tone } from './backupCenterUi'

export function RecoveryDataPanel({ blocked, onClose }: { blocked: () => boolean; onClose: () => void }) {
  const [review, setReview] = useState(() => inspectRecovery())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const busyRef = useRef(false)
  const card = useRef<HTMLDivElement>(null)
  const summary = summarizeRecoveryData(review)
  const saved = summary.count > 0 && recoveryDataSavedFor(review)
  // Unreadable copies are inside the saved file, so they may be deleted too.
  const canDelete = saved

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    card.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
    return () => previous?.focus?.()
  }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busyRef.current) onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])

  async function run(task: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setMessage(null)
    try { await task() } finally { busyRef.current = false; setBusy(false) }
  }

  const save = () => run(async () => {
    const current = inspectRecovery()
    try {
      await downloadRecoveryExport()
      markRecoveryDataSaved(current)
      setReview(current)
      setMessage({ tone: 'success', text: 'Recovery data saved.' })
    } catch { setMessage({ tone: 'error', text: 'Recovery data could not be saved. Nothing was changed. Try again.' }) }
  })

  const changed = 'Recovery data changed since you saved it. Save it again first.'
  const remove = () => run(async () => {
    setConfirming(false)
    try {
      const saved = savedRecoveryData()
      if (!saved || !recoveryDataSavedFor(inspectRecovery())) throw new RecoveryDataChangedError()
      const { kept } = await deleteSavedRecoveryData(saved, blocked)
      notifyRecoveryChanged()
      const left = kept.length
      setMessage({ tone: 'success', text: left ? `Recovery data deleted. ${left} ${left === 1 ? 'copy' : 'copies'} could not be deleted here and stay${left === 1 ? 's' : ''} on this device.` : 'Recovery data deleted.' })
    } catch (error) {
      notifyRecoveryChanged()
      setMessage({ tone: 'error', text: error instanceof RecoveryDataChangedError ? changed : 'Nothing was deleted. Close the editor and any other GTAR tabs, then try again.' })
    } finally { setReview(inspectRecovery()) }
  })

  const row = (label: string, value: string, testId: string) => (
    <div className="min-w-0">
      <span className="text-app-muted block">{label}</span>
      <span data-testid={testId} className="text-app-heading font-semibold font-mono block truncate">{value}</span>
    </div>
  )

  return <div data-testid="recovery-data-backdrop" onClick={event => { if (event.target === event.currentTarget && !busyRef.current) onClose() }}
    className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in">
    <div ref={card} role="dialog" aria-modal="true" aria-label="Recovery data" data-testid="recovery-data-panel"
      className="w-full max-w-lg rounded-2xl border border-app-border bg-app-surface text-app-heading shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
      <div className="px-5 py-3 border-b border-app-border/80 flex items-center justify-between bg-app-base/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-app-action/20 border border-app-action/40 flex items-center justify-center text-app-action">
            <History className="w-4 h-4" aria-hidden="true" />
          </div>
          <h2 className="font-extrabold text-sm sm:text-base tracking-wide">Recovery data</h2>
        </div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close"
          className="w-11 h-11 -mr-2 rounded-xl hover:bg-app-base flex items-center justify-center text-app-muted hover:text-app-heading transition-colors cursor-pointer disabled:opacity-50">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="p-5 space-y-4 overflow-y-auto flex-1">
        <p className="text-xs text-app-muted">Older copies of your songbook that GTAR kept on this device. Your current songbook is not affected.</p>

        <div data-testid="recovery-data-card" className={sectionCard}>
          <span className={sectionLabel}>On this device</span>
          {summary.count === 0 ? <p data-testid="recovery-data-empty" className="pt-2 border-t border-app-border/60 text-xs text-app-heading">No recovery data on this device.</p> : <>
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-app-border/60 text-[11px]">
              {row('Saved copies', String(summary.count), 'recovery-data-count')}
              {row('Size', formatRecoverySize(summary.bytes), 'recovery-data-size')}
            </div>
            {summary.unreadable && <p data-testid="recovery-data-unreadable" role="status" className={tone.warning}>Some copies can't be opened. Save them before deleting.</p>}

            {!confirming ? <div className="space-y-2 pt-1">
              <button type="button" data-testid="recovery-data-save" className={primaryButton} disabled={busy} onClick={() => { void save() }}>
                <Download className="w-4 h-4" aria-hidden="true" />Save recovery data
              </button>
              <button type="button" data-testid="recovery-data-delete" className={dangerButton} disabled={busy || !canDelete}
                aria-describedby={canDelete ? undefined : 'recovery-data-delete-hint'} onClick={() => { setMessage(null); setConfirming(true) }}>
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />Delete recovery data
              </button>
              {!canDelete && <p id="recovery-data-delete-hint" className="text-[11px] text-app-muted">Save recovery data first to delete it.</p>}
            </div> : <div role="group" aria-label="Confirm delete" data-testid="recovery-data-confirm"
              className="p-4 rounded-xl border space-y-3 bg-status-warning/10 border-status-warning/40">
              <div className="flex items-center gap-2 text-status-warning">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <h3 className="font-bold text-xs">Delete recovery data?</h3>
              </div>
              <p className="text-[11px] text-app-text">Delete all saved copies from this device? Your current songbook stays.</p>
              <button type="button" data-testid="recovery-data-confirm-delete" className={dangerButton} disabled={busy} onClick={() => { void remove() }}>
                {busy ? 'Deleting…' : 'Delete'}
              </button>
              <button type="button" className={outlinedButton} disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
            </div>}
          </>}
          {message && <p role="status" data-testid="recovery-data-message" className={message.tone === 'success' ? tone.success : tone.error}>{message.text}</p>}
        </div>
      </div>

      <div className="px-5 py-3 border-t border-app-border/80 bg-app-base/60 flex items-center justify-end gap-2 text-[11px] text-app-muted">
        <button type="button" data-testid="recovery-data-close" disabled={busy} onClick={onClose}
          className="min-h-11 px-4 py-1.5 rounded-lg bg-app-border/50 hover:bg-app-border text-app-heading font-semibold transition-colors cursor-pointer disabled:opacity-50">Close</button>
      </div>
    </div>
  </div>
}
