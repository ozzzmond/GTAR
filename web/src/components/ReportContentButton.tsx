import { useState } from 'react'
import { Flag } from 'lucide-react'
import { CatalogApiError } from '../types/sharedCatalog'
import {
  REPORT_NOTE_MAX, REPORT_REASON_LABELS, reportCatalogItem,
  type ReportReason, type ReportTargetKind,
} from '../utils/catalogReports'

const reportMessage = (error: unknown) => {
  if (error instanceof CatalogApiError) {
    if (error.status === 409) return 'You already reported this. An admin will review it.'
    if (error.status === 429) return 'Report limit reached. Try again later.'
    if (error.status === 404) return 'This item is no longer available.'
    if (error.status === 501) return 'Reporting is not available on this server yet.'
  }
  return error instanceof Error ? error.message : 'Report could not be sent.'
}

/** #253: reactive report. Nothing is hidden automatically; admins review reports in User Management. */
export function ReportContentButton({ kind, id, revision, label }: {
  kind: ReportTargetKind; id: string; revision: number; label: string
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason>('wrong_content')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  if (!open) {
    return <button type="button" data-testid={`report-${kind}-btn`} onClick={() => { setOpen(true); setMessage('') }}
      className="min-h-9 px-3 py-1.5 rounded-lg text-app-muted hover:text-status-warning hover:bg-status-warning/10 flex items-center gap-1.5 text-xs font-mono transition-colors cursor-pointer"
      aria-label={`Report ${label}`}>
      <Flag className="w-3.5 h-3.5" /><span>Report</span>
    </button>
  }
  const submit = async () => {
    setBusy(true); setMessage('')
    try {
      await reportCatalogItem({ target_kind: kind, target_id: id, target_revision: revision, reason, note })
      setSent(true); setMessage('Thanks. An admin will review this report.')
    } catch (error) { setMessage(reportMessage(error)) } finally { setBusy(false) }
  }
  return <div role="group" aria-label={`Report ${label}`} data-testid={`report-${kind}-form`}
    className="w-full p-3 rounded-xl border border-app-border bg-app-base space-y-2 text-xs text-left">
    <p className="font-semibold text-app-heading">Report “{label}”</p>
    {!sent && <>
      <label className="block">
        <span className="block text-[11px] text-app-muted mb-1">Reason</span>
        <select value={reason} disabled={busy} onChange={e => setReason(e.target.value as ReportReason)}
          className="w-full min-h-9 rounded-lg border border-app-border bg-app-surface p-1.5 text-app-heading">
          {(Object.keys(REPORT_REASON_LABELS) as ReportReason[]).map(key => <option key={key} value={key}>{REPORT_REASON_LABELS[key]}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="block text-[11px] text-app-muted mb-1">Details (optional)</span>
        <textarea value={note} maxLength={REPORT_NOTE_MAX} rows={2} disabled={busy} onChange={e => setNote(e.target.value)}
          className="w-full rounded-lg border border-app-border bg-app-surface p-1.5 text-app-heading" />
      </label>
    </>}
    {message && <p role="status" className="text-app-muted">{message}</p>}
    <div className="flex justify-end gap-2 font-mono font-bold">
      <button type="button" disabled={busy} onClick={() => { setOpen(false); setSent(false); setNote('') }}
        className="min-h-9 px-3 py-1.5 rounded-lg bg-app-surface text-app-muted hover:text-app-heading cursor-pointer">{sent ? 'Close' : 'Cancel'}</button>
      {!sent && <button type="button" disabled={busy} onClick={() => void submit()} data-testid={`report-${kind}-submit`}
        className="min-h-9 px-3 py-1.5 rounded-lg bg-amber-400 text-black hover:bg-amber-300 cursor-pointer disabled:opacity-50">{busy ? 'Sending…' : 'Send report'}</button>}
    </div>
  </div>
}
