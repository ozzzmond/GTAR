// #299: the one restore preview for backup files and cloud backups. Same words for both sources:
// Merge into device is the default (deletes nothing); Replace device needs a second, explicit confirmation.
import React, { useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import type { SettingsRestoreChoice } from '../utils/backupSettings'
import { dangerButton, only, outlinedButton, primaryButton, provenanceLine, secondaryButton, type BackupProvenance, type Library } from './backupCenterUi'

export interface RestorePreviewProps {
  /** What the backup is, e.g. "Backup file" or "Cloud backup". */
  sourceLabel: string
  device: Library
  backup: Library
  /** What the backup itself says about where it came from; absent fields are left out, never guessed. */
  provenance?: BackupProvenance
  /** False for a single-setlist file, which can only be merged. */
  canReplace?: boolean
  /** Appearance / preferences choice; shown only when the backup carries settings. */
  settings?: { appearance: number; preferences: number; choice: SettingsRestoreChoice; onChoice: (choice: SettingsRestoreChoice) => void }
  note?: React.ReactNode
  busy?: boolean
  blocked?: boolean
  onMerge: () => void
  onReplace: () => void
  onCancel: () => void
}

/** Like the cloud card's counts, plus deleted setlists (kept in backups and restored with them). */
const previewCounts = (library: Library) => {
  const deleted = library.setlists.filter(setlist => setlist.isDeleted).length
  return `${library.songs.filter(s => !s.isDeleted).length} songs · ${library.setlists.length} setlists${deleted ? ` (${deleted} deleted)` : ''} · ${library.songs.filter(s => s.isDeleted).length} in trash`
}
/** Records in `a` missing from `b`, with trashed songs named apart (as in the counts above). */
const onlyCounts = (a: Library, b: Library) => {
  const ids = new Set(b.songs.map(song => String(song.id)))
  const songs = a.songs.filter(song => !ids.has(String(song.id)))
  const trash = songs.filter(song => song.isDeleted).length
  return `${songs.length - trash} songs${trash ? `, ${trash} in trash` : ''}, ${only(a.setlists, b.setlists)} setlists`
}
const row = (label: string, value: React.ReactNode) => (
  <p><span className="text-app-muted">{label}: </span><span className="text-app-heading font-semibold">{value}</span></p>
)

export const RestorePreview: React.FC<RestorePreviewProps> = ({
  sourceLabel, device, backup, provenance, canReplace = true, settings, note, busy = false, blocked = false, onMerge, onReplace, onCancel,
}) => {
  const [confirmReplace, setConfirmReplace] = useState(false)
  const onlyOnDevice = onlyCounts(device, backup)
  const provenanceText = provenanceLine(provenance)
  return <div role="group" aria-label="Restore preview" data-testid="restore-preview"
    className={`p-4 rounded-xl border space-y-3 ${confirmReplace ? 'bg-status-warning/10 border-status-warning/40' : 'bg-status-info/10 border-status-info/40'}`}>
    <div className={`flex items-center gap-2 ${confirmReplace ? 'text-status-warning' : 'text-status-info'}`}>
      {confirmReplace ? <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> : <Info className="w-4 h-4 shrink-0" aria-hidden="true" />}
      <h3 className="font-bold text-xs">{confirmReplace ? 'Replace device?' : 'Restore preview'}</h3>
    </div>
    {provenanceText && <p data-testid="restore-provenance" className="text-[11px] text-app-muted">{provenanceText}</p>}
    <div className="space-y-1.5 p-2.5 rounded-lg bg-app-base/80 text-[11px]">
      {row('This device', previewCounts(device))}
      {row(sourceLabel, previewCounts(backup))}
      {row('Only on device', onlyOnDevice)}
      {row('Only in backup', onlyCounts(backup, device))}
    </div>
    {settings && !confirmReplace && <fieldset data-testid="restore-settings-choice" className="space-y-1 text-[11px]">
      <legend className="text-app-muted mb-1">This backup has {settings.appearance} appearance and {settings.preferences} preference settings.</legend>
      <label className="min-h-11 flex items-center gap-2.5 text-app-heading cursor-pointer">
        <input type="checkbox" className="w-4 h-4 shrink-0 accent-app-action" checked={settings.choice.appearance} disabled={busy}
          onChange={e => settings.onChoice({ ...settings.choice, appearance: e.target.checked })} />
        <span>Also restore appearance (theme, colours, stage and TV text)</span>
      </label>
      <label className="min-h-11 flex items-center gap-2.5 text-app-heading cursor-pointer">
        <input type="checkbox" className="w-4 h-4 shrink-0 accent-app-action" checked={settings.choice.preferences} disabled={busy}
          onChange={e => settings.onChoice({ ...settings.choice, preferences: e.target.checked })} />
        <span>Also restore preferences (songbook sort, filters, edge-swipe panel)</span>
      </label>
    </fieldset>}
    {note}
    {!confirmReplace ? <>
      <p className="text-[11px] text-app-text">A verified local safety snapshot is saved first. Merge into device: Adds and updates songs; deletes nothing.</p>
      <button type="button" data-testid="restore-merge-button" className={primaryButton} disabled={busy || blocked} onClick={onMerge}>Merge into device</button>
      <div className="grid grid-cols-2 gap-2">
        {canReplace && <button type="button" data-testid="restore-replace-button" className={secondaryButton} disabled={busy || blocked} onClick={() => setConfirmReplace(true)}>Replace device</button>}
        <button type="button" className={`${secondaryButton} ${canReplace ? '' : 'col-span-2'}`} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </> : <>
      <p className="text-[11px] text-app-text">
        Replace device: Replaces all songs, setlists and trash. Everything that is only on this device (<strong>{onlyOnDevice}</strong>) will be removed. A verified local safety snapshot is saved first.
      </p>
      <button type="button" data-testid="restore-confirm-replace-button" className={dangerButton} disabled={busy || blocked} onClick={onReplace}>
        {busy ? 'Restoring…' : 'Confirm replace'}
      </button>
      <button type="button" className={outlinedButton} disabled={busy} onClick={() => setConfirmReplace(false)}>Back</button>
    </>}
  </div>
}
