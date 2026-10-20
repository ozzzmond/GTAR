import { CatalogSetlistPreview } from './CatalogSetlistPreview'
import { useState } from 'react'
import { useSharedSetlists } from '../utils/useSharedSetlists'

export function SharedSetlistCatalogPanel() {
  const [selected, setSelected] = useState<{ id: string; revision: number } | null>(null)
  const [offset, setOffset] = useState(0)
  const catalog = useSharedSetlists(true, offset)
  return <section aria-label="Published setlists" className="space-y-3">
    {catalog.message && <p role="status">{catalog.message}</p>}
    <button type="button" className="min-h-11 px-3 rounded-lg border border-app-border" onClick={catalog.reload}>Refresh setlists</button>
    {catalog.enabled && catalog.rows.length === 0 && <p>No published setlists.</p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {catalog.rows.map(setlist => <article key={setlist.id} className="p-4 rounded-xl border border-app-border bg-app-surface min-w-0">
        <h3 className="font-bold break-words">{setlist.name}</h3>
        <p>{setlist.occurrences} songs · Revision {setlist.revision}</p>
        <p className="text-xs text-app-muted">Updated: {setlist.updated_at}</p>
        <button type="button" className="min-h-11 px-3 border rounded-lg" onClick={() => setSelected(setlist)}>Preview setlist</button>
      </article>)}
    </div>
    {selected && catalog.enabled && <CatalogSetlistPreview key={`${selected.id}:${selected.revision}`} {...selected} onClose={() => setSelected(null)} />}
    <nav aria-label="Setlist pages" className="flex gap-3">
      <button type="button" className="min-h-11 px-3 border rounded-lg disabled:opacity-40" disabled={!offset} onClick={() => setOffset(n => Math.max(0, n - 20))}>Previous setlists</button>
      <button type="button" className="min-h-11 px-3 border rounded-lg disabled:opacity-40" disabled={!catalog.enabled || catalog.rows.length < 20} onClick={() => setOffset(n => n + 20)}>Next setlists</button>
    </nav>
  </section>
}
