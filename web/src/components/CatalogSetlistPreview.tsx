import { openRecoveryReview } from '../utils/recoveryReview'
import { useContext, useEffect, useRef, useState } from 'react'
import { CatalogImportContext } from '../utils/catalogImportContext'
import { existingCatalogImports, importCatalogSetlist, openCatalogImport, previewCatalogSetlist, type CatalogPreview } from '../utils/sharedSetlistImport'
import { CatalogApiError } from '../types/sharedCatalog'
import { getAuthenticatedSessionToken } from '../utils/sharedCatalogClient'

function errorMessage(error: unknown) {
  if (error instanceof CatalogApiError) {
    if ([404, 410].includes(error.status)) return 'Publication unavailable, deleted or unpublished. Refresh the catalog.'
    if ([401, 403].includes(error.status)) return 'Approved membership and a current session are required.'
    if ([0, 408].includes(error.status)) return 'Network error. Retry preview when connected.'
  }
  return error instanceof Error ? error.message : 'Import could not be verified.'
}
export function CatalogSetlistPreview({ id, revision, onClose }: { id: string; revision: number; onClose: () => void }) {
  const host = useContext(CatalogImportContext)
  const dialog = useRef<HTMLDialogElement>(null)
  const busyRef = useRef(false)
  const [preview, setPreview] = useState<CatalogPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState<string | number | null>(null)
  const [approval, setApproval] = useState<'new' | 'revision' | 'duplicate' | 'restore' | null>(null)
  const [restoreId, setRestoreId] = useState<string | number>()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    let live = true
    previewCatalogSetlist(id, revision).then(value => { if (live) setPreview(value) }).catch(e => { if (live) setError(errorMessage(e)) })
    return () => { live = false; previous?.focus() }
  }, [id, revision])
  useEffect(() => {
    const changed = () => {
      try {
        const current = getAuthenticatedSessionToken()
        if (preview && current.accountId === preview.account && current.token === preview.token) return
      } catch { /* Session loss clears private preview. */ }
      setPreview(null); setApproval(null); setSavedId(null); setError('Account changed. Close and reopen preview.')
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [preview])
  const copies = preview && host ? existingCatalogImports(host.getLocal(), preview) : []
  const exact = copies.filter(copy => copy.catalogSource!.revision === revision)
  async function commit() {
    if (!preview || !host || !approval || busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      const destination = await importCatalogSetlist(preview, host, { kind: approval, existingId: restoreId })
      setSavedId(destination); setApproval(null)
    } catch (e) { setError(errorMessage(e)); setApproval(null) }
    finally { busyRef.current = false; setBusy(false) }
  }
  function open(destination: string | number) {
    try { if (preview && host) { openCatalogImport(destination, preview, host); onClose() } }
    catch (e) { setError(errorMessage(e)); setSavedId(null) }
  }
  const buttonClass = 'min-h-11 px-3 border border-app-border rounded-lg disabled:opacity-40'
  return <dialog ref={dialog} aria-label="Published setlist preview" onCancel={event => { event.preventDefault(); if (!busyRef.current) onClose() }} className="bg-app-surface text-app-text rounded-xl p-4 w-full max-w-lg max-h-[90dvh] overflow-y-auto backdrop:bg-black/60">
    <button type="button" className={buttonClass} disabled={busy} onClick={onClose}>Close preview</button>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="min-h-11 border border-app-border rounded px-3 py-2" disabled={busy} onClick={openRecoveryReview}>Review local recovery</button>
    {!preview && !error && <p role="status">Loading exact revision…</p>}
    {preview && <>
      <h2 className="font-bold text-lg break-words">{preview.snapshot.name}</h2>
      <p>{preview.snapshot.entries.length} songs · Revision {revision}</p>
      <ol className="list-decimal pl-6 space-y-3">{preview.snapshot.entries.map((song, index) => <li key={index}>
        <strong className="break-words">{String(song.title)}</strong> {String(song.artist ?? '')}
        <p className="text-sm">{['format', 'key', 'originalKey', 'confirmedChartKey', 'capo', 'transposeOffset', 'bpm', 'time', 'year'].filter(key => song[key] !== undefined && song[key] !== null).map(key => `${key}: ${song[key]}`).join(' · ')}</p>
        <details><summary className="min-h-11 cursor-pointer">Chart</summary><pre className="whitespace-pre-wrap break-words text-sm">{String(song.rawContent)}</pre></details>
      </li>)}</ol>
      {!host && <p>Personal library is unavailable in this view.</p>}
      {host && !savedId && <div className="flex flex-wrap gap-2 mt-4">
        {exact.map(copy => copy.isDeleted
          ? <button key={copy.id} className={buttonClass} disabled={busy} onClick={() => { setRestoreId(copy.id); setApproval('restore') }}>Restore Existing: {copy.name}</button>
          : <button key={copy.id} className={buttonClass} disabled={busy} onClick={() => open(copy.id)}>Open Existing: {copy.name}</button>)}
        <button className={buttonClass} disabled={busy} onClick={() => setApproval(exact.length ? 'duplicate' : copies.length ? 'revision' : 'new')}>
          {exact.length ? 'Create deliberate duplicate' : copies.length ? 'Import new revision separately' : 'Import personal copy'}
        </button>
      </div>}
      {approval && <div className="mt-4 border rounded-lg p-3">
        <p>{approval === 'restore' ? 'Restore this existing personal setlist?' : approval === 'duplicate' ? 'Create another independent copy of the same revision?' : approval === 'revision' ? 'Create an independent copy of this revision? Earlier imports stay unchanged.' : 'Create a personal setlist and independent song for every occurrence?'}</p>
        <button className={buttonClass} disabled={busy} onClick={commit}>Confirm {approval === 'restore' ? 'restore' : 'import'}</button>
        <button className={buttonClass} disabled={busy} onClick={() => setApproval(null)}>Cancel import</button>
      </div>}
      {busy && <p role="status">Verifying publication and saving…</p>}
      {savedId && <div role="status"><p>Personal copy saved and verified locally. Cloud sync is pending; use Cloud Sync and resolve any reported limit or failure.</p><button className={buttonClass} onClick={() => open(savedId)}>Open Setlist</button></div>}
    </>}
  </dialog>
}
