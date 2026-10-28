import { useCallback, useEffect, useState } from 'react'
import { Flag, Loader2, RotateCcw } from 'lucide-react'
import {
  REPORT_REASON_LABELS, adminUnpublishSetlist, listCatalogReports, resolveCatalogReport,
  type CatalogReport, type ReportStatus,
} from '../utils/catalogReports'
import { unpublishSharedCatalogSong } from '../utils/sharedCatalogClient'
import { CatalogApiError } from '../types/sharedCatalog'

const failure = (error: unknown) => {
  if (error instanceof CatalogApiError && error.status === 501) return 'Reporting is not available on this server yet.'
  if (error instanceof CatalogApiError && error.status === 409) return 'This changed in the meantime. Refresh and review again.'
  return error instanceof Error ? error.message : 'Moderation request failed.'
}

/** #253 admin moderation queue (reactive). The server re-checks the admin role on every call. */
export function CatalogReportsQueue({ onOpenCount }: { onOpenCount?: (count: number) => void }) {
  const [status, setStatus] = useState<ReportStatus | 'all'>('open')
  const [reports, setReports] = useState<CatalogReport[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const rows = await listCatalogReports(status)
      setReports(rows)
      if (status === 'open') onOpenCount?.(rows.length)
    } catch (err) { setError(failure(err)) } finally { setLoading(false) }
  }, [status, onOpenCount])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- External admin request on open/filter change, same pattern as the accounts list.
    void load()
  }, [load])

  const act = async (report: CatalogReport, action: 'dismiss' | 'remove' | 'actioned') => {
    setBusyId(report.id); setError('')
    try {
      if (action === 'remove' && !report.target_deleted && report.target_current_revision) {
        if (report.target_kind === 'song') {
          await unpublishSharedCatalogSong({ id: report.target_id, expected_revision: report.target_current_revision })
        } else {
          await adminUnpublishSetlist(report.target_id, report.target_current_revision)
        }
      }
      await resolveCatalogReport(report.id, action === 'dismiss' ? 'dismissed' : 'actioned')
      setConfirmRemove(null)
      await load()
    } catch (err) { setError(failure(err)) } finally { setBusyId(null) }
  }

  const tab = (value: ReportStatus | 'all', label: string) => (
    <button type="button" key={value} onClick={() => setStatus(value)}
      className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${status === value ? 'bg-app-action text-app-on-action' : 'bg-app-base text-app-muted hover:text-app-heading'}`}>
      {label}
    </button>
  )

  return <div data-testid="catalog-reports-queue" className="space-y-3">
    <div className="flex items-center justify-between gap-2 border-b border-app-border/60 pb-3">
      <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
        {tab('open', 'Open')}{tab('actioned', 'Actioned')}{tab('dismissed', 'Dismissed')}{tab('all', 'All')}
      </div>
      <button type="button" onClick={() => void load()} disabled={loading}
        className="text-[11px] text-app-muted hover:text-app-heading flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
        <RotateCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /><span>Refresh</span>
      </button>
    </div>
    <p className="text-[11px] text-app-muted">Reports never hide content on their own. Review the item, then dismiss or remove it.</p>
    {error && <p role="alert" className="text-xs text-status-error font-semibold">{error}</p>}
    {loading && reports.length === 0 ? (
      <div className="py-8 flex items-center justify-center gap-2 text-xs text-app-muted"><Loader2 className="w-4 h-4 animate-spin text-app-action" /><span>Loading reports…</span></div>
    ) : reports.length === 0 ? (
      <p className="py-8 text-center text-xs text-app-muted">{status === 'open' ? 'No open reports.' : 'No reports.'}</p>
    ) : <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
      {reports.map(report => {
        const busy = busyId === report.id
        const gone = !!report.target_deleted || report.target_current_revision === null
        return <li key={report.id} data-testid={`catalog-report-${report.id}`} className="p-3 rounded-xl bg-app-base border border-app-border/60 space-y-1.5 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-app-heading break-words flex items-center gap-1.5">
                <Flag className="w-3 h-3 text-status-warning shrink-0" />
                <span>{report.target_title || report.target_id}</span>
              </p>
              <p className="text-[10px] font-mono text-app-muted">
                {report.target_kind === 'song' ? 'Song' : 'Setlist'} · reported r{report.target_revision}
                {report.target_current_revision ? ` · current r${report.target_current_revision}` : ''}
                {gone ? ' · removed' : ''}{report.open_reports > 1 ? ` · ${report.open_reports} open reports` : ''}
              </p>
            </div>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-app-surface border border-app-border text-app-muted shrink-0 uppercase">{report.status}</span>
          </div>
          <p className="text-app-text">{REPORT_REASON_LABELS[report.reason] ?? report.reason}{report.note ? `: ${report.note}` : ''}</p>
          <p className="text-[10px] text-app-muted font-mono truncate">By {report.reporter_name || report.reporter_email} · {new Date(report.created_at).toLocaleString()}</p>
          {report.status === 'open' && <div className="flex flex-wrap justify-end gap-1.5 pt-1">
            <button type="button" disabled={busy} onClick={() => void act(report, 'dismiss')}
              className="min-h-9 px-2.5 py-1 rounded-lg bg-app-surface text-app-muted hover:text-app-heading border border-app-border font-bold cursor-pointer disabled:opacity-50">Dismiss</button>
            {gone ? (
              <button type="button" disabled={busy} onClick={() => void act(report, 'actioned')}
                className="min-h-9 px-2.5 py-1 rounded-lg bg-app-surface text-app-heading border border-app-border font-bold cursor-pointer disabled:opacity-50">Mark actioned</button>
            ) : confirmRemove === report.id ? (
              <button type="button" disabled={busy} data-testid={`confirm-remove-${report.id}`} onClick={() => void act(report, 'remove')}
                className="min-h-9 px-2.5 py-1 rounded-lg bg-status-error text-white font-bold cursor-pointer disabled:opacity-50">{busy ? 'Removing…' : 'Confirm remove'}</button>
            ) : (
              <button type="button" disabled={busy} onClick={() => setConfirmRemove(report.id)}
                className="min-h-9 px-2.5 py-1 rounded-lg text-status-error border border-status-error/40 hover:bg-status-error/10 font-bold cursor-pointer disabled:opacity-50">Remove content</button>
            )}
          </div>}
          {report.resolution_note && <p className="text-[10px] text-app-muted">Resolution: {report.resolution_note}</p>}
        </li>
      })}
    </ul>}
  </div>
}
