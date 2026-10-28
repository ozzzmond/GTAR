// #253 reactive moderation client. Reports never hide content; admins resolve them.
import { catalogFetch, getAuthenticatedSessionToken } from './sharedCatalogClient'
import { generateUUID } from './uuid'

export type ReportTargetKind = 'song' | 'setlist'
export type ReportReason = 'copyright' | 'wrong_content' | 'spam_abuse' | 'other'
export type ReportStatus = 'open' | 'dismissed' | 'actioned'
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  copyright: 'Copyright or permission problem',
  wrong_content: 'Wrong or broken chart',
  spam_abuse: 'Spam or abuse',
  other: 'Other',
}
export const REPORT_NOTE_MAX = 500

export interface CatalogReport {
  id: number
  target_kind: ReportTargetKind
  target_id: string
  target_revision: number
  reason: ReportReason
  note: string | null
  status: ReportStatus
  created_at: string
  resolved_at: string | null
  resolution_note: string | null
  reporter_email: string
  reporter_name: string | null
  target_title: string | null
  target_artist: string | null
  target_current_revision: number | null
  target_deleted: number | null
  open_reports: number
}

export async function reportCatalogItem(input: {
  target_kind: ReportTargetKind; target_id: string; target_revision: number; reason: ReportReason; note?: string
}): Promise<{ id: number; status: 'open' }> {
  const { token } = getAuthenticatedSessionToken()
  const note = input.note?.trim()
  return catalogFetch('/api/catalog/reports', {
    method: 'POST', token,
    body: { target_kind: input.target_kind, target_id: input.target_id, target_revision: input.target_revision, reason: input.reason,
      ...(note ? { note: note.slice(0, REPORT_NOTE_MAX) } : {}) },
  })
}

export async function listCatalogReports(status: ReportStatus | 'all' = 'open'): Promise<CatalogReport[]> {
  const { token } = getAuthenticatedSessionToken()
  const response = await catalogFetch<{ reports?: CatalogReport[] }>(`/api/admin/catalog-reports?status=${status}&limit=50`, { token })
  if (!response || !Array.isArray(response.reports)) throw new Error('Invalid moderation response')
  return response.reports
}

export async function resolveCatalogReport(id: number, status: 'dismissed' | 'actioned', note?: string) {
  const { token } = getAuthenticatedSessionToken()
  return catalogFetch<{ id: number; status: ReportStatus }>(`/api/admin/catalog-reports/${encodeURIComponent(String(id))}`, {
    method: 'POST', token, body: { status, ...(note?.trim() ? { note: note.trim().slice(0, REPORT_NOTE_MAX) } : {}) },
  })
}

/** Admin moderation unpublish of any shared setlist (server re-checks the admin role and revision). */
export async function adminUnpublishSetlist(id: string, expectedRevision: number) {
  const { token } = getAuthenticatedSessionToken()
  return catalogFetch<{ id: string; revision: number; unpublished: boolean }>(`/api/catalog/setlists/${encodeURIComponent(id)}`, {
    method: 'DELETE', token, body: { expected_revision: expectedRevision }, idempotencyKey: generateUUID().replace(/[^A-Za-z0-9_-]/g, ''),
  })
}
