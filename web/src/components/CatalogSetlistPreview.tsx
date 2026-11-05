import { ReportContentButton } from './ReportContentButton'
import { openRecoveryData } from '../utils/recoveryReview'
import { useContext, useEffect, useRef, useState } from 'react'
import { ListMusic, X } from 'lucide-react'
import { CatalogImportContext } from '../utils/catalogImportContext'
import { existingCatalogImports, importCatalogSetlist, openCatalogImport, previewCatalogSetlist, type CatalogPreview } from '../utils/sharedSetlistImport'
import { CatalogApiError } from '../types/sharedCatalog'
import { getAuthenticatedSessionToken } from '../utils/sharedCatalogClient'
import { primaryButton, secondaryButton, sectionCard, sectionLabel, tone } from './backupCenterUi'

function errorMessage(error: unknown) {
  if (error instanceof CatalogApiError) {
    if ([404, 410].includes(error.status)) return 'Publication unavailable, deleted or unpublished. Refresh the catalog.'
    if ([401, 403].includes(error.status)) return 'Approved membership and a current session are required.'
    if ([0, 408].includes(error.status)) return 'Network error. Retry preview when connected.'
  }
  return error instanceof Error ? error.message : 'Import could not be verified.'
}

const metaText = (value: unknown) => {
  if (typeof value === 'string') return value.trim()
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}
/** "90" → "90 BPM"; an explicit "90 BPM" stays as written. */
function bpmValue(value: unknown) {
  const raw = metaText(value)
  if (!raw) return ''
  return /^\d+$/.test(raw) ? `${raw} BPM` : raw
}
/** Default-equivalent capo values are not worth a chip. */
function capoValue(value: unknown) {
  const raw = metaText(value)
  if (!raw || /^(no capo|0|none)$/i.test(raw)) return ''
  return /^capo\b/i.test(raw) ? raw : `Capo ${raw}`
}
/** Human-readable chips only: no internal field names, no empty or default values. */
function songMeta(song: Record<string, unknown>) {
  const chips: Array<[string, string]> = []
  const add = (label: string, value: string) => { if (value) chips.push([label, value]) }
  add('Key', metaText(song.key))
  add('Original key', metaText(song.originalKey))
  add('Capo', capoValue(song.capo))
  add('BPM', bpmValue(song.bpm))
  add('Time', metaText(song.time))
  add('Year', metaText(song.year))
  const offset = Number(song.transposeOffset ?? 0)
  if (Number.isFinite(offset) && offset !== 0) add('Transpose', `${offset > 0 ? '+' : ''}${offset}`)
  return chips
}

const chipClass = 'inline-flex max-w-full items-center gap-1 rounded-full border border-app-border bg-app-base px-2.5 py-0.5 text-[11px] leading-5 text-app-muted'

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

  // Action hierarchy: exactly one primary action, Close secondary, everything else discoverable below it.
  const primaryAction = `${primaryButton.replace('w-full ', '')} w-full sm:w-auto`
  const secondaryAction = `${secondaryButton.replace('flex items-center', 'inline-flex items-center')} w-full sm:w-auto`
  const importLabel = exact.length ? 'Create deliberate duplicate' : copies.length ? 'Import new revision separately' : 'Import personal copy'
  const chooseImport = () => setApproval(exact.length ? 'duplicate' : copies.length ? 'revision' : 'new')
  const exactActive = exact.filter(copy => !copy.isDeleted)
  const exactDeleted = exact.filter(copy => copy.isDeleted)
  const primaryCopy = exactActive[0] ?? exactDeleted[0]
  // While a confirmation is open the footer primary is hidden, so keep every existing copy reachable there.
  const extraCopies = primaryCopy ? exact.filter(copy => copy.id !== primaryCopy.id) : []
  const listedCopies = approval ? exact : extraCopies
  const primary = !host || savedId || approval
    ? null
    : exactActive.length
      ? { id: 'open-existing', label: `Open Existing: ${exactActive[0].name}`, run: () => open(exactActive[0].id) }
      : exactDeleted.length
        ? { id: 'restore-existing', label: `Restore Existing: ${exactDeleted[0].name}`, run: () => { setRestoreId(exactDeleted[0].id); setApproval('restore') } }
        : { id: 'import', label: importLabel, run: chooseImport }

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
      className="m-auto w-[calc(100vw-1rem)] max-w-lg sm:max-w-2xl max-h-[calc(100dvh-1rem)] sm:max-h-[90vh] overflow-hidden rounded-2xl border border-app-border bg-app-surface p-0 text-app-heading shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-xs open:flex open:flex-col animate-fade-in"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-app-border/80 bg-app-base/60 px-4 py-3 sm:px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-app-action/40 bg-app-action/20 text-app-action" aria-hidden="true">
          <ListMusic className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-app-muted">Published setlist preview</p>
          <h2 className="break-words text-sm font-extrabold text-app-heading sm:text-base">
            {preview ? preview.snapshot.name : error ? 'Preview unavailable' : 'Loading preview…'}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close preview"
          className="flex h-11 w-11 shrink-0 -mr-2 items-center justify-center rounded-xl text-app-muted transition-colors hover:bg-app-base hover:text-app-heading cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={busy}
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
        {error && <p role="alert" className={`${tone.error} font-semibold`}>{error}</p>}

        {!preview && !error && <p role="status" className="text-sm text-app-muted">Loading exact revision…</p>}

        {preview && <>
          {/* Revision badge and comparison summary */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-testid="preview-revision-badge"
              className="rounded-full border border-app-border bg-app-base px-2.5 py-0.5 font-mono text-[11px] font-bold text-app-muted"
            >
              r{revision}
            </span>
            <span className="text-xs text-app-muted">{preview.snapshot.entries.length} songs</span>

            {/* Stale imported copies: show revision metadata comparison and explicit limitation */}
            {staleImports.length > 0 && (
              <div
                data-testid="preview-stale-import-notice"
                className={`${tone.warning} w-full space-y-1`}
                role="status"
                aria-label={`You have ${staleImports.length} imported copy at an earlier revision`}
              >
                <div className="font-bold">
                  Your copy: r{staleImports[0].catalogSource!.revision} → this is r{revision}
                </div>
                <p className="text-[11px] leading-relaxed text-app-muted">
                  Only revision numbers and details are compared; earlier song text isn't kept. Re-import makes a new copy and will never overwrite existing imported setlists.
                </p>
              </div>
            )}

            {/* Up-to-date imported copies */}
            {upToDateImports.length > 0 && staleImports.length === 0 && (
              <span
                data-testid="preview-imported-current-notice"
                className={`${tone.success} inline-block`}
                role="status"
              >
                You have an imported copy at this revision
              </span>
            )}
          </div>

          {/* Song list — titles lazy-disclosed inside details */}
          <section className={sectionCard} aria-label="Songs in this published setlist">
            <h3 className={sectionLabel}>Songs</h3>
            <ol className="space-y-3" data-testid="preview-song-list">
              {preview.snapshot.entries.map((song, index) => {
                const artist = String(song.artist ?? '').trim()
                const chips = songMeta(song)
                return (
                  <li key={index} className="space-y-1.5 rounded-xl border border-app-border/70 bg-app-surface p-3">
                    <p className="min-w-0 break-words text-sm font-bold text-app-heading">
                      {String(song.title)}
                      {artist && <span className="ml-1.5 text-xs font-medium text-app-muted">{artist}</span>}
                    </p>
                    {chips.length > 0 && (
                      <ul data-testid="preview-song-metadata" aria-label="Song details" className="flex flex-wrap gap-1.5">
                        {chips.map(([label, value]) => (
                          <li key={label} className={chipClass}>
                            <span className="shrink-0">{label}</span>{' '}
                            <span className="break-words font-bold text-app-heading">{value}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {/* Chart content lazy-disclosed; preserves privacy until user explicitly opens */}
                    <details>
                      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-lg px-2 text-xs font-semibold text-app-muted transition-colors hover:bg-app-base hover:text-app-heading">Chart</summary>
                      <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-app-border bg-app-base p-2 text-sm text-app-text">{String(song.rawContent)}</pre>
                    </details>
                  </li>
                )
              })}
            </ol>
          </section>

          {!host && <p className="text-sm text-app-muted">Personal library is unavailable in this view.</p>}

          {host && !savedId && (listedCopies.length > 0 || (primaryCopy && !approval)) && (
            <section className={sectionCard} aria-label="Your personal copies">
              <h3 className={sectionLabel}>Your copies</h3>
              <p className="text-xs text-app-muted">Imported copies are independent and never update on their own.</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {listedCopies.map(copy =>
                  copy.isDeleted
                    ? <button key={copy.id} type="button" className={secondaryAction} disabled={busy} onClick={() => { setRestoreId(copy.id); setApproval('restore') }}>Restore Existing: {copy.name}</button>
                    : <button key={copy.id} type="button" className={secondaryAction} disabled={busy} onClick={() => open(copy.id)}>Open Existing: {copy.name}</button>
                )}
                {primaryCopy && !approval && (
                  <button type="button" className={secondaryAction} disabled={busy} onClick={chooseImport}>{importLabel}</button>
                )}
              </div>
            </section>
          )}

          {approval && (
            <section className={`${sectionCard} border-app-action/40 bg-app-action/5`} aria-label="Confirm import">
              <h3 className={sectionLabel}>Confirm</h3>
              <p className="text-sm text-app-heading">
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
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" className={primaryAction} disabled={busy} onClick={commit}>Confirm {approval === 'restore' ? 'restore' : 'import'}</button>
                <button type="button" className={secondaryAction} disabled={busy} onClick={() => setApproval(null)}>Cancel import</button>
              </div>
            </section>
          )}

          {busy && <p role="status" className="text-xs text-app-muted">Verifying publication and saving…</p>}

          {savedId && (
            <div role="status" className={`${sectionCard} border-status-success/30 bg-status-success/10`}>
              <p className="text-sm font-bold text-status-success">Personal copy saved and verified locally.</p>
              <p className="mt-1 text-xs text-app-muted">Use Backup & Restore to keep a backup of your personal copy.</p>
              <button type="button" className={`${primaryAction} mt-3`} onClick={() => open(savedId)}>Open Setlist</button>
            </div>
          )}

          {/* #253 reactive moderation: report only; nothing is hidden automatically. */}
          <div className="flex justify-end border-t border-app-border/40 pt-2">
            <ReportContentButton kind="setlist" id={id} revision={revision} label={preview.snapshot.name} />
          </div>
        </>}
      </div>

      <div className="shrink-0 border-t border-app-border bg-app-base/60 px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
          {primary && (
            <button
              type="button"
              data-testid="preview-primary-action"
              className={primaryAction}
              disabled={busy}
              onClick={primary.run}
            >
              {primary.label}
            </button>
          )}
          <button type="button" data-testid="preview-secondary-close" className={secondaryAction} disabled={busy} onClick={onClose}>Close</button>
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 font-mono text-xs font-semibold text-app-muted transition-colors hover:bg-app-border/60 hover:text-app-heading cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed sm:mr-auto"
            disabled={busy}
            onClick={openRecoveryData}
          >
            Recovery data
          </button>
        </div>
      </div>
    </dialog>
  )
}
