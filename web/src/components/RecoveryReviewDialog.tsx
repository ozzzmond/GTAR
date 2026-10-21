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
  const actionable = review.sources.filter(source => source.status === 'actionable')
  const resolved = review.sources.filter(source => source.status === 'resolved')
  const invalid = review.sources.filter(source => source.status === 'invalid')
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
  const button = 'min-h-11 border border-app-border rounded px-3 py-2 cursor-pointer disabled:opacity-40'
  return <dialog ref={dialog} aria-label="Local recovery review" onCancel={event => { event.preventDefault(); if (!busyRef.current) onClose() }} className="bg-app-surface text-app-text rounded-xl p-4 w-full max-w-lg max-h-[90dvh] overflow-y-auto backdrop:bg-black/60">
    <h2 className="font-bold text-lg">Local recovery review</h2>
    <p>Cloud sync status does not resolve local recovery history. This review does not change your Songbook.</p>
    <p>{review.sources.filter(source => source.key.startsWith('gtar_sync_recovery:')).length} archives · {actionable.length} actionable sources · {resolved.length} explicitly resolved sources · {invalid.length} invalid sources</p>
    <p>{review.missingRecords} distinct missing records · {review.divergentVersions} distinct divergent versions (including resolved history)</p>
    {review.invalid && <p role="alert">Invalid or unreadable recovery requires manual recovery. Keep browser storage intact and export all recovery data.</p>}
    {review.sources.map((source, index) => <details key={source.key} className="my-2 border rounded p-2">
      <summary className="min-h-11 cursor-pointer">Source {index + 1}: {source.key === 'legacy' ? 'legacy stores' : source.key.startsWith('gtar_sync_v1:') ? 'legacy journal' : (['download', 'cross-tab-conflict', 'replacement', 'merge', 'upload', 'concurrency'].includes(source.key.split(':')[1]) ? source.key.split(':')[1] : 'recovery archive')} · {source.status} · {source.differences.length} record differences</summary>
      <p>Titles appear only when you open this source. Same-title songs with different IDs remain separate records. Deleted versions stay deleted.</p>
      <ul>{source.differences.map((record, position) => <li key={position} className="break-words">{record.kind}: {record.title} · {record.difference} · {record.deleted ? 'deleted version' : 'active version'} · ID {record.id}</li>)}</ul>
      {source.status === 'actionable' && !source.canKeepCurrent && <p>Pending operations or legacy settings need manual recovery.</p>}
    </details>)}
    <p>Export includes private library data, every recovery source and previous decisions. Keep it private. Use the existing Backup / Restore workflow for a supported backup; historical raw recovery may require manual recovery.</p>
    <div className="flex flex-wrap gap-2 my-3">
      <button className={button} disabled={busy} onClick={exportSources}>Export all recovery data</button>
      <button className={button} disabled={busy} onClick={refresh}>Refresh review</button>
      <button className={button} disabled={busy || review.invalid || !actionable.length || actionable.some(source => !source.canKeepCurrent)} onClick={() => { setChoice('keep-current'); setApproved(false) }}>Choose current library</button>
      {!!resolved.length && <button className={button} disabled={busy || review.invalid} onClick={() => { setChoice('reopen'); setApproved(false) }}>Reopen recovery conflicts</button>}
    </div>
    {choice && <section className="border rounded p-3">
      <p>{choice === 'keep-current' ? 'Keep the current Songbook and its deletion choices. Missing songs and historical edits will remain only in preserved recovery data; they will not be imported or resurrected. The current library and exact reviewed sources will also be preserved with this decision. Export first if you need an external copy.' : 'Reopen these recovery conflicts and block new catalog imports until they are resolved again. Your library and archives stay intact.'}</p>
      <label className="block py-3"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} /> I explicitly approve this recovery choice.</label>
      <button className={button} disabled={busy || !approved} onClick={confirm}>Confirm recovery choice</button>
      <button className={button} disabled={busy} onClick={() => { setChoice(null); setApproved(false) }}>Cancel recovery choice</button>
    </section>}
    {error && <p role="alert">{error}</p>}
    <button className={button} disabled={busy} onClick={onClose}>Close recovery review</button>
  </dialog>
}
