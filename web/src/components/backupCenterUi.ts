// #299: class constants and helpers shared by the Backup & Restore center cards (from the #296 Sync Center layout).
import type { ActiveSongState, WebSetlist } from '../types/gtar'

export type Library = { songs: Array<Partial<ActiveSongState>>; setlists: WebSetlist[] }

export const primaryButton = 'w-full min-h-11 py-2.5 px-4 rounded-xl bg-app-action hover:bg-app-action text-app-on-action font-extrabold text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-98 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
export const secondaryButton = 'min-h-11 py-2 px-3 rounded-lg bg-app-base hover:bg-app-border text-app-heading border border-app-border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
export const outlinedButton = 'w-full min-h-11 py-2 px-3 rounded-xl bg-app-base hover:bg-app-border text-app-muted hover:text-app-action border border-app-border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
export const dangerButton = 'w-full min-h-11 py-2 px-3 rounded-xl bg-status-error/10 hover:bg-status-error/20 text-status-error border border-status-error/40 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
export const sectionCard = 'p-4 rounded-xl bg-app-base/90 border border-app-border space-y-3'
export const sectionLabel = 'text-xs font-bold text-app-muted uppercase tracking-wider font-mono'
export const tone = {
  success: 'text-xs text-status-success bg-status-success/10 p-2.5 rounded-lg border border-status-success/20',
  info: 'text-xs text-app-heading bg-status-info/10 p-2.5 rounded-lg border border-status-info/20',
  warning: 'text-xs text-status-warning bg-status-warning/10 p-2.5 rounded-lg border border-status-warning/20',
  error: 'text-xs text-status-error bg-status-error/10 p-2.5 rounded-lg border border-status-error/20',
}

export const RESTORE_BLOCKED_MESSAGE = 'Close the editor (save or discard your changes) before restoring.'

export const listCounts = (library: Library) =>
  `${library.songs.filter(s => !s.isDeleted).length} songs · ${library.setlists.length} setlists · ${library.songs.filter(s => s.isDeleted).length} in trash`
const pad = (n: number) => String(n).padStart(2, '0')
/** Local date and time, e.g. 2026-11-02 20:00. Never the raw ISO string. */
export const formatDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` : 'Unknown date'
}
/** Records in `a` whose id is not in `b`. */
export const only = (a: { id?: string | number }[], b: { id?: string | number }[]) => {
  const ids = new Set(b.map(y => String(y.id)))
  return a.filter(x => !ids.has(String(x.id))).length
}

export interface BackupProvenance { appVersion?: string; schemaVersion?: number; createdAt?: string }
/** "Backup made with GTAR <version> · format v<schema> · <date>", leaving out whatever the backup does not state. */
export function provenanceLine(provenance?: BackupProvenance): string | null {
  if (!provenance) return null
  const version = typeof provenance.appVersion === 'string' && provenance.appVersion.trim() ? provenance.appVersion.trim() : null
  const schema = typeof provenance.schemaVersion === 'number' && Number.isSafeInteger(provenance.schemaVersion) ? provenance.schemaVersion : null
  const created = typeof provenance.createdAt === 'string' && Number.isFinite(Date.parse(provenance.createdAt)) ? formatDate(provenance.createdAt) : null
  if (version === null && schema === null && created === null) return null
  return [`Backup made${version !== null ? ` with GTAR ${version}` : ''}`, schema !== null ? `format v${schema}` : null, created].filter(Boolean).join(' · ')
}
