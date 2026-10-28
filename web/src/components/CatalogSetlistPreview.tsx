import { ReportContentButton } from './ReportContentButton'
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

  // Revision comparison for imported copies at an earlier revision
  const staleImports = copies.filter(copy => copy.catalogSource!.revision < revision && !copy.isDeleted)
  const upToDateImports = exact.filter(copy => !copy.isDeleted)

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
  return (
    <dialog
      ref={dialog}
      aria-label="Published setlist preview"
      onCancel={event => { event.preventDefault(); if (!busyRef.current) onClose() }}
      onClick={event => {
        if (busyRef.current) return
        if (event.target === dialog.current) {
          const rect = dialog.current.getBoundingClientRect()
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          ) {
            onClose()
          }
        }
      }}
      className="bg-app-surface text-app-text rounded-xl p-4 w-full max-w-lg max-h-[90dvh] overflow-y-auto backdrop:bg-black/60"
    >
      <button type="button" className={buttonClass} disabled={busy} onClick={onClose}>Close preview</button>
      {error && <p role="alert" className="mt-2 text-sm text-status-error">{error}</p>}
      <button
        type="button"
        className="min-h-11 border border-app-border rounded px-3 py-2 ml-2"
        disabled={busy}
        onClick={openRecoveryReview}
      >
        Review local recovery
      </button>

      {!preview && !error && <p role="status" className="mt-3">Loading exact revision…</p>}

      {preview && <>
        <h2 className="font-bold text-lg break-words mt-3">{preview.snapshot.name}</h2>

        {/* Revision badge and comparison summary */}
        <div className="flex flex-wrap gap-2 items-center mt-1 mb-3 text-xs font-mono">
          <span
            data-testid="preview-revision-badge"
            className="px-2 py-0.5 rounded bg-app-base border border-app-border text-app-muted"
          >
            r{revision}
          </span>
          <span className="text-app-muted">{preview.snapshot.entries.length} songs</span>

          {/* Stale imported copies: show revision metadata comparison and explicit limitation */}
          {staleImports.length > 0 && (
            <div
              data-testid="preview-stale-import-notice"
              className="w-full flex flex-col gap-1 p-2 rounded bg-status-warning/10 border border-status-warning/30 text-status-warning text-xs font-mono"
              role="status"
              aria-label={`You have ${staleImports.length} imported copy at an earlier revision`}
            >
              <div className="font-bold">
                Your copy: r{staleImports[0].catalogSource!.revision} → this is r{revision}
              </div>
              <p className="text-[11px] text-app-muted font-sans leading-relaxed">
                Only revision numbers and details are compared; earlier song text isn't kept. Re-import makes a new copy and will never overwrite existing imported setlists.
              </p>
            </div>
          )}

          {/* Up-to-date imported copies */}
          {upToDateImports.length > 0 && staleImports.length === 0 && (
            <span
              data-testid="preview-imported-current-notice"
              className="px-2 py-0.5 rounded bg-status-success/15 border border-status-success/30 text-status-success"
              role="status"
            >
              You have an imported copy at this revision
            </span>
          )}
        </div>

        {/* Song list — titles lazy-disclosed inside details */}
        <ol className="list-decimal pl-6 space-y-3" data-testid="preview-song-list">
          {preview.snapshot.entries.map((song, index) => (
            <li key={index}>
              <strong className="break-words">{String(song.title)}</strong>{' '}
              {String(song.artist ?? '')}
              <p className="text-sm text-app-muted">
                {(['format', 'key', 'originalKey', 'confirmedChartKey', 'capo', 'transposeOffset', 'bpm', 'time', 'year'] as const)
                  .filter(key => (song as Record<string, unknown>)[key] !== undefined && (song as Record<string, unknown>)[key] !== null)
                  .map(key => `${key}: ${(song as Record<string, unknown>)[key]}`)
                  .join(' · ')}
              </p>
              {/* Chart content lazy-disclosed; preserves privacy until user explicitly opens */}
              <details>
                <summary className="min-h-11 cursor-pointer text-xs text-app-muted">Chart</summary>
                <pre className="whitespace-pre-wrap break-words text-sm mt-1 p-2 rounded bg-app-base border border-app-border">{String(song.rawContent)}</pre>
              </details>
            </li>
          ))}
        </ol>

        {!host && <p className="mt-3 text-sm text-app-muted">Personal library is unavailable in this view.</p>}

        {host && !savedId && (
          <div className="flex flex-wrap gap-2 mt-4">
            {exact.map(copy =>
              copy.isDeleted
                ? <button key={copy.id} className={buttonClass} disabled={busy} onClick={() => { setRestoreId(copy.id); setApproval('restore') }}>Restore Existing: {copy.name}</button>
                : <button key={copy.id} className={buttonClass} disabled={busy} onClick={() => open(copy.id)}>Open Existing: {copy.name}</button>
            )}
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => setApproval(exact.length ? 'duplicate' : copies.length ? 'revision' : 'new')}
            >
              {exact.length ? 'Create deliberate duplicate' : copies.length ? 'Import new revision separately' : 'Import personal copy'}
            </button>
          </div>
        )}

        {approval && (
          <div className="mt-4 border border-app-border rounded-lg p-3 space-y-2">
            <p className="text-sm">
              {approval === 'restore'
                ? 'Restore this existing personal setlist?'
                : approval === 'duplicate'
                  ? 'Create another independent copy of the same revision?'
                  : approval === 'revision'
                    ? 'Create an independent copy of this revision? Earlier imports stay unchanged.'
                    : 'Create a personal setlist and independent song for every occurrence?'}
            </p>
            <p className="text-xs text-app-muted">
              Your copy is independent and never updates on its own.
            </p>
            <div className="flex flex-wrap gap-2">
              <button className={buttonClass} disabled={busy} onClick={commit}>Confirm {approval === 'restore' ? 'restore' : 'import'}</button>
              <button className={buttonClass} disabled={busy} onClick={() => setApproval(null)}>Cancel import</button>
            </div>
          </div>
        )}

        {busy && <p role="status" className="mt-2">Verifying publication and saving…</p>}

        {/* #253 reactive moderation: report only; nothing is hidden automatically. */}
        <div className="mt-3 pt-2 border-t border-app-border/40">
          <ReportContentButton kind="setlist" id={id} revision={revision} label={preview.snapshot.name} />
        </div>

        {savedId && (
          <div role="status" className="mt-3 p-3 rounded-lg bg-status-success/10 border border-status-success/30">
            <p className="text-sm font-bold text-status-success">Personal copy saved and verified locally.</p>
            <p className="text-xs text-app-muted mt-1">Cloud sync is pending; use Cloud Sync and resolve any reported limit or failure.</p>
            <button className={`${buttonClass} mt-2`} onClick={() => open(savedId)}>Open Setlist</button>
          </div>
        )}
      </>}
    </dialog>
  )
}
