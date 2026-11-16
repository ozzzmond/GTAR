import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Download, Search, FileText, Printer } from 'lucide-react'
import type { ActiveSongState } from '../types/gtar'
import { downloadText, printSongs, songsToTxt, type ExportKeyMode } from '../utils/songExport'
import { ExportSongsHelp } from './menuHelp'

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
  const toggle = (id: string) => setChosen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

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

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        if (dialog.current?.querySelector('[data-contextual-help]')) {
          e.preventDefault()
          return
        }
        onClose()
      }}
      onClick={(e) => {
        if (e.target === dialog.current) {
          if (dialog.current?.querySelector('[data-contextual-help]')) return
          onClose()
        }
      }}
      aria-labelledby="export-songs-title"
      data-testid="export-songs-dialog"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-app-border bg-app-surface text-app-heading p-0 shadow-2xl backdrop:bg-black/70 backdrop-blur-sm flex flex-col max-h-[90vh] animate-fade-in select-none"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-app-border flex items-center justify-between bg-app-base/70 rounded-t-2xl">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-app-action/20 border border-app-action/40 flex items-center justify-center text-app-action shrink-0">
            <Download className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id="export-songs-title" className="text-sm sm:text-base font-bold text-app-heading truncate">
              Export Songs
            </h2>
            <p className="text-[11px] text-app-muted truncate">ChordPro text or printable PDF</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExportSongsHelp />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export"
            className="p-1.5 rounded-lg text-app-muted hover:text-app-heading hover:bg-app-base transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1 custom-scrollbar">
        {/* Format Selection Cards */}
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-semibold text-app-heading">Export Format</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                format === 'txt'
                  ? 'bg-app-base border-app-action shadow-xs ring-1 ring-app-action/40 text-app-heading'
                  : 'bg-app-base/50 border-app-border/70 hover:border-app-action/50 hover:bg-app-base text-app-text'
              }`}
            >
              <input
                type="radio"
                name="export-format"
                data-testid="export-format-txt"
                checked={format === 'txt'}
                onChange={() => setFormat('txt')}
                className="accent-app-action w-4 h-4 mt-0.5 shrink-0 cursor-pointer"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-semibold text-xs sm:text-sm">
                  <FileText className="w-3.5 h-3.5 text-app-action shrink-0" aria-hidden="true" />
                  <span>TXT (ChordPro)</span>
                </div>
                <p className="text-[11px] text-app-muted mt-0.5 leading-tight">
                  Plain text chart for backup & sharing
                </p>
              </div>
            </label>

            <label
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                format === 'pdf'
                  ? 'bg-app-base border-app-action shadow-xs ring-1 ring-app-action/40 text-app-heading'
                  : 'bg-app-base/50 border-app-border/70 hover:border-app-action/50 hover:bg-app-base text-app-text'
              }`}
            >
              <input
                type="radio"
                name="export-format"
                data-testid="export-format-pdf"
                checked={format === 'pdf'}
                onChange={() => setFormat('pdf')}
                className="accent-app-action w-4 h-4 mt-0.5 shrink-0 cursor-pointer"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-semibold text-xs sm:text-sm">
                  <Printer className="w-3.5 h-3.5 text-app-action shrink-0" aria-hidden="true" />
                  <span>PDF (print)</span>
                </div>
                <p className="text-[11px] text-app-muted mt-0.5 leading-tight">
                  Formatted sheet for printing or PDF
                </p>
              </div>
            </label>
          </div>
        </fieldset>

        {/* Format Specific Options */}
        {format === 'pdf' ? (
          <fieldset className="p-3 rounded-xl bg-app-base/60 border border-app-border/70 space-y-2">
            <legend className="text-xs font-semibold text-app-heading px-1">Song Key</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <label
                className={`flex items-center gap-2.5 p-2 rounded-lg border transition-all cursor-pointer ${
                  keyMode === 'saved'
                    ? 'bg-app-surface border-app-action/60 text-app-heading shadow-xs'
                    : 'border-transparent text-app-muted hover:text-app-heading hover:bg-app-surface/50'
                }`}
              >
                <input
                  type="radio"
                  name="export-key"
                  data-testid="export-key-saved"
                  checked={keyMode === 'saved'}
                  onChange={() => setKeyMode('saved')}
                  className="accent-app-action w-4 h-4 shrink-0 cursor-pointer"
                />
                <span className="font-medium">Saved key</span>
              </label>
              <label
                className={`flex items-center gap-2.5 p-2 rounded-lg border transition-all cursor-pointer ${
                  keyMode === 'transposed'
                    ? 'bg-app-surface border-app-action/60 text-app-heading shadow-xs'
                    : 'border-transparent text-app-muted hover:text-app-heading hover:bg-app-surface/50'
                }`}
              >
                <input
                  type="radio"
                  name="export-key"
                  data-testid="export-key-transposed"
                  checked={keyMode === 'transposed'}
                  onChange={() => setKeyMode('transposed')}
                  className="accent-app-action w-4 h-4 shrink-0 cursor-pointer"
                />
                <span className="font-medium">Current transposed key</span>
              </label>
            </div>
          </fieldset>
        ) : (
          <div className="p-2.5 rounded-xl bg-app-base/60 border border-app-border/70 text-xs text-app-muted leading-relaxed">
            TXT saves charts as stored. Multiple songs are grouped in one file, separated by{' '}
            <code className="px-1.5 py-0.5 rounded bg-app-surface border border-app-border/80 font-mono text-[11px] text-app-heading">
              {'{new_song}'}
            </code>
            .
          </div>
        )}

        {/* Search Filter */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-app-muted pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter songs by title or artist..."
            aria-label="Filter songs"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-app-base border border-app-border text-xs sm:text-sm text-app-heading placeholder:text-app-muted focus:outline-none focus:border-app-action focus:ring-1 focus:ring-app-action/40 transition-all"
          />
        </div>

        {/* Selected Count & Bulk Actions */}
        <div className="flex items-center justify-between text-xs px-1">
          <span data-testid="export-selected-count" className="font-semibold text-app-heading">
            {selected.length} selected
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-app-action hover:underline cursor-pointer font-medium text-xs transition-colors"
              onClick={() => setChosen(prev => new Set([...prev, ...visible.map(s => String(s.id))]))}
            >
              Select shown
            </button>
            <span className="text-app-border select-none" aria-hidden="true">|</span>
            <button
              type="button"
              className="text-app-muted hover:text-app-heading hover:underline cursor-pointer font-medium text-xs transition-colors"
              onClick={() => setChosen(new Set())}
            >
              Clear
            </button>
          </div>
        </div>

        {/* Song List */}
        <ul className="max-h-[36vh] sm:max-h-[40vh] overflow-y-auto space-y-1 rounded-xl border border-app-border/70 bg-app-base/40 p-1.5 custom-scrollbar">
          {visible.map(s => {
            const isChecked = chosen.has(String(s.id))
            return (
              <li key={String(s.id)}>
                <label
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all cursor-pointer text-xs sm:text-sm select-none ${
                    isChecked
                      ? 'bg-app-surface border border-app-action/40 text-app-heading shadow-xs'
                      : 'border border-transparent text-app-text hover:bg-app-surface/60 hover:text-app-heading'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(String(s.id))}
                    className="accent-app-action w-4 h-4 shrink-0 rounded cursor-pointer"
                  />
                  <span className="min-w-0 truncate flex-1 font-medium">
                    {s.title}
                    {s.artist ? <span className="text-app-muted font-normal"> · {s.artist}</span> : null}
                  </span>
                </label>
              </li>
            )
          })}
          {!visible.length && (
            <li className="text-xs sm:text-sm text-app-muted px-3 py-6 text-center">
              No songs match.
            </li>
          )}
        </ul>
      </div>

      {/* Footer */}
      <div className="px-5 py-3.5 border-t border-app-border flex flex-col sm:flex-row items-center justify-between gap-3 bg-app-base/70 rounded-b-2xl">
        <div className="w-full sm:w-auto min-h-[1.25rem] flex items-center">
          {message ? (
            <p role="status" className="text-xs font-medium text-app-action truncate max-w-full">
              {message}
            </p>
          ) : (
            <span className="hidden sm:inline text-xs text-app-muted">
              {selected.length === 0 ? 'Select songs to export' : `${selected.length} song${selected.length === 1 ? '' : 's'} ready`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-app-border bg-app-surface/60 hover:bg-app-surface text-app-text hover:text-app-heading font-medium text-xs sm:text-sm cursor-pointer transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            data-testid="export-run-btn"
            disabled={!selected.length}
            onClick={run}
            className="px-4 sm:px-5 py-2 rounded-xl bg-app-action hover:bg-app-action/90 text-app-on-action font-bold text-xs sm:text-sm cursor-pointer transition-all shadow-md active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center justify-center gap-1.5"
          >
            <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Export {selected.length || ''} {format.toUpperCase()}</span>
          </button>
        </div>
      </div>
    </dialog>
  )
}
