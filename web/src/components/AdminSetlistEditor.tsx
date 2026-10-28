import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Pencil, Trash2, X } from 'lucide-react'
import { CatalogApiError } from '../types/sharedCatalog'
import { catalogFetch, getAuthenticatedSessionToken } from '../utils/sharedCatalogClient'
import { canonical, clientSnapshotsSupported, type SetlistSnapshot } from '../utils/sharedSetlistPublishing'
import { normalizeSnapshot } from '../utils/sharedSetlistSnapshot'
import { generateUUID } from '../utils/uuid'

type Entry = Record<string, unknown>
const inputClass = 'w-full min-h-9 rounded-lg border border-app-border bg-app-base p-1.5 text-xs text-app-heading focus:border-app-action focus:outline-none'
const buttonClass = 'min-h-11 px-3 py-2 rounded-lg border border-app-border bg-app-base text-app-muted hover:text-app-heading font-mono text-xs font-bold cursor-pointer disabled:opacity-40'
const ambiguous = (error: unknown) => !(error instanceof CatalogApiError) || error.status === 0 || error.status === 408 || error.status >= 500

function saveMessage(error: unknown) {
  if (error instanceof CatalogApiError) {
    if (error.status === 409) return 'This setlist changed since you opened it, or you can no longer edit it. Nothing was saved. Close, refresh and edit the latest revision.'
    if (error.status === 413) return 'The edited setlist is too large to share (256 KB limit).'
    if (error.status === 422) return 'The edited setlist has invalid content. Check titles and charts.'
    if (error.status === 403) return 'An active admin session is required.'
    if (error.status === 501) return 'This server does not support catalog edits yet.'
  }
  return ambiguous(error) ? 'Result unknown. Retry to send the same reviewed revision; it will not be saved twice.'
    : error instanceof Error ? error.message : 'Save failed.'
}

/**
 * #253 B3: admin edit of another publisher's shared setlist. Review, then save one new revision
 * with expected_revision CAS. The server keeps publisher_user_id and records the admin as editor.
 */
export function AdminSetlistEditor({ id, revision, onClose, onSaved }: {
  id: string; revision: number; onClose: () => void; onSaved?: (revision: number) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [original, setOriginal] = useState<SetlistSnapshot | null>(null)
  const [name, setName] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [supported, setSupported] = useState<boolean | null>(null)
  const [reviewed, setReviewed] = useState<SetlistSnapshot | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState<number | null>(null)
  const [conflict, setConflict] = useState(false)
  // One idempotency key per reviewed body, reused only to retry an ambiguous attempt.
  const pendingKey = useRef<{ body: string; key: string } | null>(null)

  useEffect(() => {
    const element = dialog.current
    element?.showModal?.()
    let alive = true
    void (async () => {
      try {
        const { token } = getAuthenticatedSessionToken()
        const [response, capable] = await Promise.all([
          catalogFetch<{ snapshot: SetlistSnapshot }>(`/api/catalog/setlists/${encodeURIComponent(id)}?revision=${revision}`, { token }),
          clientSnapshotsSupported(token),
        ])
        if (!alive) return
        const snapshot = normalizeSnapshot(response.snapshot)
        setOriginal(snapshot); setName(snapshot.name); setEntries(snapshot.entries.map(entry => ({ ...entry }))); setSupported(capable)
      } catch (error) { if (alive) setMessage(error instanceof Error ? error.message : 'Setlist could not be loaded.') }
    })()
    return () => { alive = false; element?.close?.() }
  }, [id, revision])

  const edit = (next: () => void) => { next(); setReviewed(null); setConfirmed(false); setMessage('') }
  const update = (index: number, key: string, value: string) => edit(() => setEntries(list => list.map((entry, i) => i === index ? { ...entry, [key]: value } : entry)))
  const move = (index: number, delta: number) => edit(() => setEntries(list => {
    const next = [...list]; const [item] = next.splice(index, 1); next.splice(index + delta, 0, item); return next
  }))
  const review = () => {
    try {
      const snapshot = normalizeSnapshot({ version: 1, name, entries })
      if (original && canonical(snapshot) === canonical(original)) { setMessage('No changes to save.'); return }
      setReviewed(snapshot); setConfirmed(false); setMessage('')
    } catch (error) { setReviewed(null); setMessage(error instanceof Error ? error.message : 'Invalid setlist') }
  }
  const save = async () => {
    if (!reviewed || !confirmed || busy) return
    const body = { snapshot_version: 1, expected_revision: revision, snapshot: reviewed }
    const raw = canonical(body)
    if (pendingKey.current?.body !== raw) pendingKey.current = { body: raw, key: generateUUID() }
    setBusy(true); setMessage('')
    try {
      const { token } = getAuthenticatedSessionToken()
      const result = await catalogFetch<{ id: string; revision: number; unpublished: boolean }>(`/api/catalog/setlists/${encodeURIComponent(id)}`, {
        method: 'PUT', token, body, idempotencyKey: pendingKey.current.key,
      })
      if (result?.id !== id || result.revision !== revision + 1 || result.unpublished) throw new Error('Invalid server confirmation. Refresh before editing again.')
      pendingKey.current = null
      setSaved(result.revision)
      setMessage(`Saved revision ${result.revision}. The original publisher stays recorded; you are recorded as the editor.`)
      onSaved?.(result.revision)
    } catch (error) {
      if (!ambiguous(error)) pendingKey.current = null
      if (error instanceof CatalogApiError && error.status === 409) setConflict(true)
      setMessage(saveMessage(error))
    } finally { setBusy(false) }
  }

  const changes = reviewed && original ? [
    ...(reviewed.name !== original.name ? [`Name: “${original.name}” → “${reviewed.name}”`] : []),
    ...(reviewed.entries.length !== original.entries.length ? [`Songs: ${original.entries.length} → ${reviewed.entries.length}`] : []),
    ...reviewed.entries.flatMap((entry, i) => canonical(entry) !== canonical(original.entries[i]) ? [`#${i + 1} ${String(entry.title)} changed`] : []),
  ] : []
  const locked = busy || saved !== null || conflict || !supported

  return <dialog ref={dialog} aria-labelledby="admin-setlist-edit-title" data-testid="admin-setlist-editor"
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
    className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-2xl max-h-[90dvh] overflow-y-auto rounded-2xl p-5 bg-app-surface text-app-heading border border-app-border backdrop:bg-black/60 shadow-2xl z-50">
    <div className="flex items-center justify-between gap-2 mb-3">
      <h2 id="admin-setlist-edit-title" className="text-sm font-bold flex items-center gap-2"><Pencil className="w-4 h-4 text-app-action" />Edit shared setlist (admin) · r{revision}</h2>
      <button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="p-1 rounded-lg hover:bg-app-base text-app-muted cursor-pointer"><X className="w-4 h-4" /></button>
    </div>
    <p className="text-[11px] text-app-muted mb-3">Saves a new revision of another publisher's setlist. The publisher is not changed and earlier revisions stay in history. Members' imported copies are not touched.</p>
    {supported === false && <p role="alert" className="text-xs text-status-error mb-3">This server does not support catalog edits yet.</p>}
    {!original && !message && <p role="status" className="text-xs text-app-muted">Loading revision {revision}…</p>}
    {original && <div className="space-y-3">
      <label className="block text-xs"><span className="block text-[11px] text-app-muted mb-1">Setlist name</span>
        <input data-testid="admin-edit-name" className={inputClass} value={name} maxLength={200} disabled={locked} onChange={e => edit(() => setName(e.target.value))} /></label>
      <ol className="space-y-2">{entries.map((entry, index) => <li key={index} className="p-2.5 rounded-xl border border-app-border bg-app-base/60 space-y-1.5" data-testid={`admin-edit-entry-${index}`}>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-app-muted w-6">#{index + 1}</span>
          <input aria-label={`Song ${index + 1} title`} className={inputClass} value={String(entry.title ?? '')} maxLength={200} disabled={locked} onChange={e => update(index, 'title', e.target.value)} />
          <button type="button" aria-label={`Move song ${index + 1} up`} disabled={locked || index === 0} onClick={() => move(index, -1)} className="p-1.5 rounded-lg text-app-muted hover:text-app-heading disabled:opacity-30 cursor-pointer"><ArrowUp className="w-3.5 h-3.5" /></button>
          <button type="button" aria-label={`Move song ${index + 1} down`} disabled={locked || index === entries.length - 1} onClick={() => move(index, 1)} className="p-1.5 rounded-lg text-app-muted hover:text-app-heading disabled:opacity-30 cursor-pointer"><ArrowDown className="w-3.5 h-3.5" /></button>
          <button type="button" aria-label={`Remove song ${index + 1}`} disabled={locked || entries.length === 1} onClick={() => edit(() => setEntries(list => list.filter((_, i) => i !== index)))} className="p-1.5 rounded-lg text-app-muted hover:text-status-error disabled:opacity-30 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <input aria-label={`Song ${index + 1} artist`} placeholder="Artist" className={inputClass} value={String(entry.artist ?? '')} maxLength={200} disabled={locked} onChange={e => update(index, 'artist', e.target.value)} />
          <input aria-label={`Song ${index + 1} key`} placeholder="Key" className={inputClass} value={String(entry.key ?? '')} maxLength={50} disabled={locked} onChange={e => update(index, 'key', e.target.value)} />
        </div>
        <textarea aria-label={`Song ${index + 1} chart`} rows={4} className={`${inputClass} font-mono`} value={String(entry.rawContent ?? '')} disabled={locked} onChange={e => update(index, 'rawContent', e.target.value)} />
      </li>)}</ol>
    </div>}
    {reviewed && <section aria-label="Review changes" data-testid="admin-edit-review" className="mt-3 p-3 rounded-xl border border-app-border bg-app-base text-xs space-y-1.5">
      <p className="font-semibold">Review: r{revision} → r{revision + 1}</p>
      <ul className="list-disc pl-5 text-app-muted">{changes.map(change => <li key={change}>{change}</li>)}</ul>
      <label className="flex items-center gap-2 min-h-11 font-medium cursor-pointer"><input type="checkbox" checked={confirmed} disabled={locked} onChange={e => setConfirmed(e.target.checked)} />I reviewed these changes and approve saving them for all members.</label>
    </section>}
    {message && <p role="status" className="mt-3 text-xs font-mono whitespace-pre-wrap break-words">{message}</p>}
    <div className="flex flex-wrap gap-2 justify-end mt-4">
      <button type="button" className={buttonClass} disabled={busy} onClick={onClose}>{saved !== null || conflict ? 'Close' : 'Cancel'}</button>
      <button type="button" className={buttonClass} disabled={locked || !original} onClick={review}>Review changes</button>
      <button type="button" data-testid="admin-edit-save" disabled={locked || !reviewed || !confirmed} onClick={() => void save()}
        className="min-h-11 px-4 py-2 rounded-lg bg-app-action text-app-on-action font-mono text-xs font-bold cursor-pointer disabled:opacity-40">{busy ? 'Saving…' : 'Save revision'}</button>
    </div>
  </dialog>
}
