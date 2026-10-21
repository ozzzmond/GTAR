import { CatalogSetlistPreview } from './CatalogSetlistPreview'
import { useState, useRef, useEffect } from 'react'
import { useSharedSetlists } from '../utils/useSharedSetlists'
import { RefreshCw, ListMusic, ChevronLeft, ChevronRight, ArrowUpCircle, AlertTriangle, X } from 'lucide-react'
import {
  readPublicationLink,
  makePublicationIntent,
  sendPublicationIntent,
  type PublishedSetlist,
} from '../utils/sharedSetlistPublishing'
import type { WebSetlist } from '../types/gtar'

export interface SharedSetlistCatalogPanelProps {
  /** Personal setlists, used to detect imported copies and compare revisions. */
  personalSetlists?: WebSetlist[]
  /** Authenticated user ID; enables publisher-only management controls. */
  currentUserId?: string | null
  /** Called after a successful unpublish so the parent can reload. */
  onUnpublished?: (id: string) => void
}

/**
 * Finds the saved source revision for a personal setlist imported from the
 * given catalog publication ID in the current environment origin.
 * Returns undefined when no such imported copy exists.
 */
function savedImportRevision(
  personalSetlists: WebSetlist[],
  catalogId: string,
  scope: string,
): number | undefined {
  const match = personalSetlists.find(
    (l) =>
      !l.isDeleted &&
      l.catalogSource?.environmentScope === scope &&
      l.catalogSource?.setlistId === catalogId,
  )
  return match?.catalogSource?.revision
}

// Read-only scan: one corrupt entry must not hide other saved requests. An
// incomplete scan is always reported; source records remain untouched.
function scanPublicationLinks(account: string) {
  const entries: { sourceId: string; link: import('../utils/sharedSetlistPublishing').PublicationLink }[] = []
  const prefix = `gtar_setlist_publication_v1:${encodeURIComponent(account)}:`
  let incomplete = false
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      try {
        const sourceId = decodeURIComponent(key.slice(prefix.length))
        // Reject aliases rather than reading a different record via re-encoding.
        if (encodeURIComponent(sourceId) !== key.slice(prefix.length)) throw new Error('Invalid journal key')
        const link = readPublicationLink(account, sourceId)
        if (link) entries.push({ sourceId, link })
        else incomplete = true
      } catch { incomplete = true }
    }
  } catch { incomplete = true }
  return { entries, incomplete }
}

/** Finds an owned publication without letting unrelated corrupt records abort lookup. */
function findOwnPublicationLink(currentUserId: string, catalogSetlistId: string) {
  const { entries } = scanPublicationLinks(currentUserId)
  const matches = entries.filter(({ link }) => link.result?.id === catalogSetlistId && !link.result.unpublished)
  return matches.find(({ sourceId }) => sourceId === catalogSetlistId) || matches[0] || null
}

// Pending deletes remain recoverable even when a committed timeout has already
// removed the row from the active catalog. No replacement intent is generated.
function pendingUnpublishes(account: string) {
  const { entries, incomplete } = scanPublicationLinks(account)
  const rows = new Map<string, PublishedSetlist>()
  for (const { link } of entries) {
    if (link.pending?.method === 'DELETE' && link.result && !link.result.unpublished && link.pending.id === link.result.id) {
      rows.set(link.result.id, { ...link.result, name: 'Pending unpublish', occurrences: 0, updated_at: '' })
    }
  }
  return { rows: [...rows.values()], incomplete }
}

/**
 * Returns whether the currentUserId has a publisher journal entry for the
 * given catalog setlist, checked client-side only. Server always re-validates.
 */
function isOwnPublication(currentUserId: string, setlistId: string): boolean {
  return findOwnPublicationLink(currentUserId, setlistId) !== null
}

/** Convert unknown unpublish error to a user-facing string. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'Unpublish failed. Ensure your session is active and retry.'
}

export function SharedSetlistCatalogPanel({
  personalSetlists = [],
  currentUserId,
  onUnpublished,
}: SharedSetlistCatalogPanelProps) {
  const [selected, setSelected] = useState<{ id: string; revision: number } | null>(null)
  const [offset, setOffset] = useState(0)
  const catalog = useSharedSetlists(true, offset)

  // Publisher Unpublish confirmation state
  const [unpublishTarget, setUnpublishTarget] = useState<PublishedSetlist | null>(null)
  const [isUnpublishing, setIsUnpublishing] = useState(false)
  const [unpublishError, setUnpublishError] = useState<string | null>(null)
  const [unpublishFeedback, setUnpublishFeedback] = useState<string | null>(null)

  const unpublishDialogRef = useRef<HTMLDialogElement>(null)
  const unpublishTriggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (unpublishTarget) {
      unpublishDialogRef.current?.showModal()
    }
  }, [unpublishTarget])

  function closeUnpublishDialog() {
    if (isUnpublishing) return
    unpublishDialogRef.current?.close()
    setUnpublishTarget(null)
    setUnpublishError(null)
    unpublishTriggerRef.current?.focus()
  }

  const recovery = currentUserId ? pendingUnpublishes(currentUserId) : { rows: [], incomplete: false }

  // Stable origin scope for catalogSource comparison
  const scope = typeof window !== 'undefined' ? window.location.origin : ''

  async function handleUnpublishConfirm() {
    if (!unpublishTarget || !currentUserId || isUnpublishing) return
    setIsUnpublishing(true)
    setUnpublishError(null)
    try {
      const own = findOwnPublicationLink(currentUserId, unpublishTarget.id)
      if (!own) {
        throw new Error(
          'Publication journal entry not found on this device. Reload the catalog and confirm you are the publisher before retrying.',
        )
      }
      if (own.link.pending && (own.link.pending.method !== 'DELETE' || own.link.pending.id !== unpublishTarget.id)) {
        throw new Error('Recover the pending publication request before unpublishing.')
      }
      const intent = own.link.pending || makePublicationIntent(own.link, undefined, true)
      const withPending: import('../utils/sharedSetlistPublishing').PublicationLink = { ...own.link, pending: intent }
      const outcome = await sendPublicationIntent(currentUserId, own.sourceId, withPending)
      if (!outcome.saved) {
        setUnpublishError('Server confirmed unpublish; local recovery record could not be saved. Retry this same request to recover. Preserve browser data.')
        return
      }
      onUnpublished?.(unpublishTarget.id)
      const name = unpublishTarget.name
      unpublishDialogRef.current?.close()
      setUnpublishTarget(null)
      unpublishTriggerRef.current?.focus()
      setUnpublishFeedback(`"${name}" has been unpublished.`)
      setTimeout(() => setUnpublishFeedback(null), 5000)
    } catch (err: unknown) {
      setUnpublishError(errorMessage(err))
    } finally {
      setIsUnpublishing(false)
    }
  }

  return (
    <section aria-label="Published setlists" className="space-y-4">
      {catalog.message && (
        <p role="status" className="text-xs font-mono text-app-muted">
          {catalog.message}
        </p>
      )}

      {/* Unpublish success toast */}
      {unpublishFeedback && (
        <div
          role="status"
          aria-live="polite"
          data-testid="setlist-unpublish-feedback"
          className="p-3 bg-app-surface border border-app-border rounded-xl text-xs font-mono font-bold text-app-heading flex items-center gap-2 shadow-lg"
        >
          <span className="flex-1">{unpublishFeedback}</span>
        </div>
      )}

      {recovery.incomplete && (
        <p role="alert" data-testid="setlist-recovery-warning" className="text-xs text-status-warning">
          Publication recovery scan is incomplete. Preserve browser data and contact the operator for manual recovery or export. Some saved operations may be unavailable.
        </p>
      )}
      {recovery.rows.map(row => (
        <button type="button" key={row.id} className="min-h-11 px-3 py-2 border border-app-border rounded-xl text-xs"
          onClick={event => { unpublishTriggerRef.current = event.currentTarget; setUnpublishTarget(row); setUnpublishError(null) }}>
          Recover unpublish: {row.id}
        </button>
      ))}

      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          data-testid="catalog-setlist-refresh-button"
          className="min-h-11 px-3 py-2 rounded-xl border border-app-border bg-app-surface text-app-heading hover:border-app-action font-mono text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
          onClick={catalog.reload}
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Empty State */}
      {catalog.enabled && catalog.rows.length === 0 && (
        <div
          data-testid="catalog-setlists-empty-state"
          className="p-12 text-center rounded-2xl border border-app-border bg-app-surface/50 space-y-3"
        >
          <ListMusic className="w-8 h-8 mx-auto text-app-action" />
          <div className="text-base font-bold text-app-heading">No shared setlists yet.</div>
          <p className="text-xs text-app-muted max-w-sm mx-auto">
            Setlists shared with your team will appear here.
          </p>
        </div>
      )}

      {/* Setlists Cards Grid */}
      {catalog.rows.length > 0 && (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5"
          data-testid="catalog-setlist-list"
        >
          {catalog.rows.map((setlist) => {
            const importedRevision = savedImportRevision(personalSetlists, setlist.id, scope)
            const hasImportedCopy = importedRevision !== undefined
            const updateAvailable = hasImportedCopy && setlist.revision > importedRevision
            const isPublisher = !!currentUserId && isOwnPublication(currentUserId, setlist.id)

            return (
              <article
                key={setlist.id}
                data-testid={`catalog-setlist-card-${setlist.id}`}
                className="p-3 rounded-xl border border-app-border bg-app-surface/70 hover:border-app-action hover:bg-app-surface transition-all flex flex-col justify-between gap-2.5 group select-none min-w-0"
              >
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-xs sm:text-sm text-app-heading group-hover:text-app-action transition-colors break-words min-w-0 flex-1">
                      {setlist.name}
                    </h3>
                    {/* Revision badge */}
                    <span
                      data-testid={`setlist-revision-badge-${setlist.id}`}
                      className="px-1.5 py-0.5 rounded bg-app-base border border-app-border text-[9px] font-mono text-app-muted shrink-0"
                      title={`Revision ${setlist.revision}`}
                      aria-label={`Revision ${setlist.revision}`}
                    >
                      r{setlist.revision}
                    </span>
                  </div>
                  <p className="text-[11px] text-app-muted truncate mt-0.5">
                    {setlist.occurrences} {setlist.occurrences === 1 ? 'song' : 'songs'}
                  </p>

                  {/* "Update available" — imported copy is behind the catalog revision */}
                  {updateAvailable && (
                    <div
                      data-testid={`setlist-update-available-${setlist.id}`}
                      className="mt-1.5 flex items-center gap-1 text-[10px] font-mono text-status-warning"
                      role="status"
                      aria-label={`Newer revision available: your import is r${importedRevision}, catalog is r${setlist.revision}`}
                    >
                      <ArrowUpCircle className="w-3 h-3 shrink-0" />
                      <span>
                        Update available (your copy: r{importedRevision} → r{setlist.revision})
                      </span>
                    </div>
                  )}

                  {/* Up-to-date imported copy indicator */}
                  {hasImportedCopy && !updateAvailable && (
                    <div
                      data-testid={`setlist-imported-current-${setlist.id}`}
                      className="mt-1.5 text-[10px] font-mono text-status-success"
                      aria-label={`Your imported copy is up to date at r${importedRevision}`}
                    >
                      ✓ Imported copy at r{importedRevision}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-app-border/40 text-[10px] font-mono text-app-muted">
                  <span className="truncate">Updated: {setlist.updated_at}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Publisher-only: Unpublish */}
                    {isPublisher && (
                      <button
                        type="button"
                        data-testid={`unpublish-setlist-btn-${setlist.id}`}
                        className="min-h-11 px-2 py-1 rounded-lg border border-app-border text-app-muted hover:text-status-error hover:border-status-error/40 font-mono text-[10px] font-bold transition-all cursor-pointer"
                        title={`Unpublish "${setlist.name}"`}
                        aria-label={`Unpublish ${setlist.name}`}
                        onClick={(e) => {
                          unpublishTriggerRef.current = e.currentTarget
                          setUnpublishTarget(setlist)
                          setUnpublishError(null)
                        }}
                      >
                        Unpublish
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid={`preview-setlist-btn-${setlist.id}`}
                      className="min-h-11 px-3 py-1 rounded-lg border border-app-border bg-app-action text-app-on-action hover:bg-app-action/90 font-mono text-xs font-bold transition-all cursor-pointer shrink-0"
                      onClick={() => setSelected(setlist)}
                    >
                      Preview setlist
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {selected && catalog.enabled && (
        <CatalogSetlistPreview
          key={`${selected.id}:${selected.revision}`}
          {...selected}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Publisher Unpublish Confirmation Dialog */}
      {unpublishTarget && (
        <dialog
          ref={unpublishDialogRef}
          data-testid="setlist-unpublish-confirm-dialog"
          aria-labelledby="unpublish-dialog-title"
          aria-modal="true"
          onCancel={(e) => {
            e.preventDefault()
            closeUnpublishDialog()
          }}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-app-border bg-app-surface text-app-heading p-0 shadow-2xl z-50 flex flex-col overflow-hidden backdrop:bg-black/60"
        >
          <div className="p-4 border-b border-app-border/60 flex items-center justify-between">
            <h2 id="unpublish-dialog-title" className="text-sm font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-status-warning" />
              Unpublish setlist
            </h2>
            <button
              type="button"
              onClick={closeUnpublishDialog}
              className="p-1 rounded-lg hover:bg-app-base text-app-muted hover:text-app-heading cursor-pointer"
              aria-label="Cancel"
              disabled={isUnpublishing}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-3 font-mono text-xs">
            <p className="text-app-heading">
              Remove <strong className="break-words">"{unpublishTarget.name}"</strong> (r
              {unpublishTarget.revision}) from the Shared Catalog?
            </p>
            <p className="text-app-muted">
              Team members who already imported a personal copy keep their independent copy unchanged.
              This action uses your active publisher session and cannot be undone by other users.
            </p>
            <p className="text-[10px] text-app-muted">
              Note: Rename and permanent deletion are deferred backend tasks. Unpublish hides this setlist from new imports only.
            </p>

            {unpublishError && (
              <p
                role="alert"
                data-testid="setlist-unpublish-error"
                className="p-2.5 rounded-lg bg-status-error/15 border border-status-error/30 text-status-error"
              >
                {unpublishError}
              </p>
            )}
          </div>

          <div className="p-4 border-t border-app-border/60 flex justify-end gap-2">
            <button
              type="button"
              data-testid="setlist-unpublish-cancel"
              disabled={isUnpublishing}
              onClick={closeUnpublishDialog}
              className="px-3.5 py-2 rounded-lg bg-app-base text-app-muted hover:text-app-heading transition-colors cursor-pointer font-mono text-xs font-bold"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="setlist-unpublish-confirm"
              disabled={isUnpublishing}
              onClick={handleUnpublishConfirm}
              className="px-4 py-2 rounded-lg bg-status-error text-white hover:bg-status-error/90 font-mono text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
            >
              {isUnpublishing ? 'Unpublishing…' : 'Unpublish setlist'}
            </button>
          </div>
        </dialog>
      )}

      {/* Pagination */}
      <nav
        aria-label="Setlist pages"
        className="flex items-center justify-between pt-3 border-t border-app-border text-xs font-mono text-app-muted px-1"
      >
        <span>Showing {catalog.rows.length} setlists</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="min-h-11 px-2.5 py-1 rounded-lg border border-app-border bg-app-surface text-app-heading disabled:opacity-30 disabled:cursor-not-allowed hover:border-app-action flex items-center gap-1 cursor-pointer transition-colors"
            disabled={!offset}
            onClick={() => setOffset((n) => Math.max(0, n - 20))}
            aria-label="Previous setlists"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Previous</span>
          </button>
          <button
            type="button"
            className="min-h-11 px-2.5 py-1 rounded-lg border border-app-border bg-app-surface text-app-heading disabled:opacity-30 disabled:cursor-not-allowed hover:border-app-action flex items-center gap-1 cursor-pointer transition-colors"
            disabled={!catalog.enabled || catalog.rows.length < 20}
            onClick={() => setOffset((n) => n + 20)}
            aria-label="Next setlists"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </nav>
    </section>
  )
}
