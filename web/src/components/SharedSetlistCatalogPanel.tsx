import { CatalogSetlistPreview } from './CatalogSetlistPreview'
import { useState } from 'react'
import { useSharedSetlists } from '../utils/useSharedSetlists'
import { RefreshCw, ListMusic, ChevronLeft, ChevronRight } from 'lucide-react'

export function SharedSetlistCatalogPanel() {
  const [selected, setSelected] = useState<{ id: string; revision: number } | null>(null)
  const [offset, setOffset] = useState(0)
  const catalog = useSharedSetlists(true, offset)

  return (
    <section aria-label="Published setlists" className="space-y-4">
      {catalog.message && (
        <p role="status" className="text-xs font-mono text-app-muted">
          {catalog.message}
        </p>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          data-testid="catalog-setlist-refresh-button"
          className="min-h-11 px-3 py-2 rounded-xl border border-app-border bg-app-surface text-app-heading hover:border-app-action font-mono text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
          onClick={catalog.reload}
          title="Refresh"
          aria-label="Refresh"
        ><RefreshCw className="w-3.5 h-3.5" /><span>Refresh</span></button>
      </div>

      {/* Empty State */}
      {catalog.enabled && catalog.rows.length === 0 && (
        <div data-testid="catalog-setlists-empty-state" className="p-12 text-center rounded-2xl border border-app-border bg-app-surface/50 space-y-3">
          <ListMusic className="w-8 h-8 mx-auto text-app-action" />
          <div className="text-base font-bold text-app-heading">No shared setlists yet.</div>
          <p className="text-xs text-app-muted max-w-sm mx-auto">
            Setlists shared with your team will appear here.
          </p>
        </div>
      )}

      {/* Setlists Cards Grid */}
      {catalog.rows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5" data-testid="catalog-setlist-list">
          {catalog.rows.map((setlist) => (
            <article
              key={setlist.id}
              data-testid={`catalog-setlist-card-${setlist.id}`}
              className="p-3 rounded-xl border border-app-border bg-app-surface/70 hover:border-app-action hover:bg-app-surface transition-all flex flex-col justify-between gap-2.5 group select-none min-w-0"
            >
              <div className="min-w-0">
                <h3 className="font-bold text-xs sm:text-sm text-app-heading group-hover:text-app-action transition-colors truncate break-words">
                  {setlist.name}
                </h3>
                <p className="text-[11px] text-app-muted truncate mt-0.5">
                  {setlist.occurrences} {setlist.occurrences === 1 ? 'song' : 'songs'}
                </p>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-app-border/40 text-[10px] font-mono text-app-muted">
                <span className="truncate">Updated: {setlist.updated_at}</span>
                <button
                  type="button"
                  data-testid={`preview-setlist-btn-${setlist.id}`}
                  className="min-h-11 px-3 py-1 rounded-lg border border-app-border bg-app-action text-app-on-action hover:bg-app-action/90 font-mono text-xs font-bold transition-all cursor-pointer shrink-0"
                  onClick={() => setSelected(setlist)}
                >
                  Preview setlist
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {selected && catalog.enabled && (
        <CatalogSetlistPreview
          key={`${selected.id}:${selected.revision}`}
          {...selected}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Pagination */}
      <nav aria-label="Setlist pages" className="flex items-center justify-between pt-3 border-t border-app-border text-xs font-mono text-app-muted px-1">
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
