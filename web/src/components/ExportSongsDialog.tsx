import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Download } from 'lucide-react'
import type { ActiveSongState } from '../types/gtar'
import { downloadText, printSongs, songsToTxt, type ExportKeyMode } from '../utils/songExport'

interface Props {
  songs: ActiveSongState[]
  /** Songs chosen in Manage mode, if any; otherwise nothing is preselected. */
  preselected?: Array<string | number>
  onClose: () => void
}

/** #149 S5: Songs Library ⋯ → Export songs… (TXT / PDF). Local only; songs are not changed. */
export function ExportSongsDialog({ songs, preselected = [], onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const exportable = useMemo(() => songs.filter(s => s.id !== undefined && s.rawContent?.trim()), [songs])
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(preselected.map(String)))
  const [query, setQuery] = useState('')
  const [format, setFormat] = useState<'txt' | 'pdf'>('txt')
  const [keyMode, setKeyMode] = useState<ExportKeyMode>('saved')
  const [message, setMessage] = useState('')
  useEffect(() => {
    const element = dialog.current!
    if (typeof element.showModal === 'function') element.showModal()
    return () => { if (typeof element.close === 'function') element.close() }
  }, [])

  const visible = exportable.filter(s => {
    const q = query.trim().toLowerCase()
    return !q || s.title.toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q)
  })
  const selected = exportable.filter(s => chosen.has(String(s.id)))
  const toggle = (id: string) => setChosen(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })

  const run = () => {
    if (!selected.length) return
    if (format === 'txt') {
      const { filename, text } = songsToTxt(selected)
      downloadText(filename, text)
      setMessage(`Saved ${filename}.`)
    } else if (printSongs(selected, keyMode)) {
      setMessage('Print dialog opened. Choose “Save as PDF”.')
    } else {
      setMessage('The print page could not open. Allow pop-ups for this site and try again.')
    }
  }

  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="export-songs-title" data-testid="export-songs-dialog"
    className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-app-border bg-app-surface text-app-heading p-0 shadow-2xl backdrop:bg-black/60">
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="export-songs-title" className="font-bold flex items-center gap-2"><Download className="w-5 h-5 text-app-action" />Export songs</h2>
        <button type="button" onClick={onClose} aria-label="Close export" className="p-2 rounded-lg hover:bg-app-base"><X className="w-4 h-4" /></button>
      </div>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Format</legend>
        <label className="flex items-center gap-2"><input type="radio" name="export-format" data-testid="export-format-txt" checked={format === 'txt'} onChange={() => setFormat('txt')} className="accent-app-action" />TXT (ChordPro)</label>
        <label className="flex items-center gap-2"><input type="radio" name="export-format" data-testid="export-format-pdf" checked={format === 'pdf'} onChange={() => setFormat('pdf')} className="accent-app-action" />PDF (print)</label>
      </fieldset>
      {format === 'pdf' ? <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="text-xs text-app-muted mb-1">Key</legend>
        <label className="flex items-center gap-2"><input type="radio" name="export-key" data-testid="export-key-saved" checked={keyMode === 'saved'} onChange={() => setKeyMode('saved')} className="accent-app-action" />Saved key</label>
        <label className="flex items-center gap-2"><input type="radio" name="export-key" data-testid="export-key-transposed" checked={keyMode === 'transposed'} onChange={() => setKeyMode('transposed')} className="accent-app-action" />Current transposed key</label>
      </fieldset> : <p className="text-xs text-app-muted">TXT is the saved chart as stored. Several songs go into one file, separated by <code>{'{new_song}'}</code>.</p>}
      <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter songs" aria-label="Filter songs"
        className="w-full px-3 py-2 rounded-lg bg-app-base border border-app-border text-sm" />
      <div className="flex items-center justify-between text-xs">
        <span data-testid="export-selected-count">{selected.length} selected</span>
        <span className="flex gap-2">
          <button type="button" className="text-app-action underline" onClick={() => setChosen(prev => new Set([...prev, ...visible.map(s => String(s.id))]))}>Select shown</button>
          <button type="button" className="text-app-muted underline" onClick={() => setChosen(new Set())}>Clear</button>
        </span>
      </div>
      <ul className="max-h-[40vh] overflow-y-auto space-y-0.5">
        {visible.map(s => <li key={String(s.id)}>
          <label className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-app-base cursor-pointer text-sm">
            <input type="checkbox" checked={chosen.has(String(s.id))} onChange={() => toggle(String(s.id))} className="accent-app-action w-4 h-4 shrink-0" />
            <span className="min-w-0 truncate">{s.title}{s.artist ? <span className="text-app-muted"> · {s.artist}</span> : null}</span>
          </label>
        </li>)}
        {!visible.length && <li className="text-sm text-app-muted px-2 py-3">No songs match.</li>}
      </ul>
      {message && <p role="status" className="text-xs text-app-action">{message}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-app-border text-sm">Close</button>
        <button type="button" data-testid="export-run-btn" disabled={!selected.length} onClick={run}
          className="px-3 py-2 rounded-lg bg-app-action text-app-on-action text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed">
          Export {selected.length || ''} {format.toUpperCase()}
        </button>
      </div>
    </div>
  </dialog>
}
