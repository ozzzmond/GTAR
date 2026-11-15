import React, { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ExternalLink, Globe, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { ContextualHelp } from './ContextualHelp'
import {
  SUPPORTED_SOURCES,
  addShortcut,
  addSupportedSource,
  moveSource,
  removeSource,
  restoreDefaultSettings,
  saveOnlineSourceSettings,
  setSearchMode,
  setSourceEnabled,
  updateShortcut,
  useOnlineSourceSettings,
  type OnlineSourceSettings,
  type Result,
  type SearchMode,
} from '../utils/onlineSourceSettings'

interface OnlineSourcesRowProps {
  /** Same row style the Advanced Tools popover uses for its other rows. */
  rowClass: string
  enabled: boolean
  onToggle: (next: boolean) => void
}

const MODES: Array<{ value: SearchMode; label: string }> = [
  { value: 'all', label: 'All sources' },
  { value: 'primary', label: 'Primary only' },
]

const iconButton = 'relative flex w-9 h-9 shrink-0 items-center justify-center rounded-lg border border-app-border bg-app-base text-app-muted hover:text-app-heading hover:border-app-action disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer before:absolute before:-inset-1 before:content-[\'\'] focus-visible:outline-2 focus-visible:outline-app-action'
const smallAction = 'min-h-11 px-3 rounded-xl border border-app-border bg-app-base hover:bg-app-surface text-app-heading text-xs font-semibold flex items-center gap-1.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action'
const fieldClass = 'w-full min-h-11 bg-app-base border border-app-border rounded-xl px-3 py-2 text-xs text-app-heading placeholder-app-muted/60 focus:outline-none focus:border-app-action'
const pill = 'text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-app-surface text-app-muted ui-secondary-text border border-app-border'

/**
 * #516: the Online song sources row in Advanced Tools. The switch turns online search on or off;
 * the row itself expands to the source list, so the menu stays short until it is needed.
 */
export const OnlineSourcesRow: React.FC<OnlineSourcesRowProps> = ({ rowClass, enabled, onToggle }) => {
  const settings = useOnlineSourceSettings()
  const [open, setOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formSearchUrl, setFormSearchUrl] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [status, setStatus] = useState('')

  const save = (next: OnlineSourceSettings, message?: string) => {
    saveOnlineSourceSettings(next)
    if (message) setStatus(message)
  }
  const resetForm = () => { setFormOpen(false); setEditingId(null); setFormName(''); setFormUrl(''); setFormSearchUrl(''); setFormError(null) }
  const applyResult = (result: Result<OnlineSourceSettings>, message: string): boolean => {
    if (!result.ok) { setStatus(''); setFormError(result.error); return false }
    setFormError(null)
    save(result.value, message)
    return true
  }
  const submitForm = (event: React.FormEvent) => {
    event.preventDefault()
    const done = editingId
      ? applyResult(updateShortcut(settings, editingId, { name: formName, url: formUrl, searchUrl: formSearchUrl }), 'Website updated.')
      : applyResult(addShortcut(settings, { name: formName, url: formUrl, searchUrl: formSearchUrl }), 'Website added.')
    if (done) resetForm()
  }
  const startEdit = (id: string) => {
    const entry = settings.sources.find(source => source.id === id)
    if (!entry || entry.kind !== 'shortcut') return
    setFormOpen(true)
    setEditingId(id)
    setFormName(entry.name)
    setFormUrl(entry.url)
    setFormSearchUrl(entry.searchUrl ?? '')
    setFormError(null)
  }
  const remove = (id: string, name: string) => {
    if (editingId === id) resetForm()
    save(removeSource(settings, id), `${name} removed.`)
  }

  const firstEnabledProviderId = settings.sources.find(source => source.kind === 'provider' && source.enabled)?.id
  const remainingSupported = SUPPORTED_SOURCES.filter(supported => !settings.sources.some(source => source.id === supported.id))

  return (
    <div data-testid="online-sources-row" className="rounded-xl border border-app-border/80 bg-app-surface/50 overflow-hidden mb-2">
      <div className={`${rowClass.replace('cursor-pointer', '')} justify-between p-2.5`}>
        <button
          type="button"
          data-testid="online-sources-expand"
          aria-expanded={open}
          aria-controls="online-sources-panel"
          onClick={() => setOpen(value => !value)}
          className="flex flex-1 min-w-0 min-h-11 items-center gap-2.5 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action rounded-lg"
        >
          <Globe className="w-4 h-4 text-app-action shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-app-heading truncate">Online song sources</span>
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-app-surface text-app-muted border border-app-border">
                {settings.sources.filter(s => s.enabled).length} active
              </span>
            </div>
            <span className="block text-app-muted text-[10px] truncate">Search web providers &amp; custom link shortcuts</span>
          </div>
          {open ? <ChevronUp className="w-3.5 h-3.5 text-app-muted shrink-0" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5 text-app-muted shrink-0" aria-hidden="true" />}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Online song sources"
          data-testid="settings-online-sources"
          onClick={() => onToggle(!enabled)}
          className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
        >
          <span className={`block w-11 h-6 rounded-full transition-colors relative p-0.5 border ${enabled ? 'bg-app-action border-app-action' : 'bg-app-button border-app-border'}`}>
            <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </span>
        </button>
      </div>

      {open && (
        <div id="online-sources-panel" data-testid="online-sources-panel" className="pl-3 border-l-2 border-app-border/60 my-1 space-y-3 p-2 bg-app-base/40 rounded-r-xl">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-app-heading">Sources</span>
            <ContextualHelp
              id="online-sources-help"
              title="Online Sources"
              buttonLabel="Help for sources"
              buttonTestId="online-sources-help-button"
              panelTestId="online-sources-help"
              quickSummary="Configure online song providers and custom chord chart shortcuts for instant searching."
              topics={[
                {
                  title: 'Search vs Link Sources',
                  content: (
                    <>
                      <p><strong className="text-app-heading">Search</strong> sources show results in GTAR.</p>
                      <p><strong className="text-app-heading">Link</strong> sources only open in your browser.</p>
                      <p>A Link with a Search URL (use {'{query}'}) also adds a search link under your results.</p>
                    </>
                  ),
                },
                {
                  title: 'Priority & Ordering',
                  content: (
                    <>
                      <p>Arrows set the order. Primary only uses the first enabled search source.</p>
                      <p>All sources searches every enabled provider at the same time.</p>
                    </>
                  ),
                },
                {
                  title: 'Adding & Removing Sources',
                  content: (
                    <>
                      <p>Tap &quot;+ Website&quot; to save custom song and chord website shortcuts.</p>
                      <p>Removed sources stay removed until you add them again or restore defaults.</p>
                    </>
                  ),
                },
              ]}
            />
          </div>

          <div role="radiogroup" aria-label="Search mode" className="grid grid-cols-2 gap-1 rounded-xl border border-app-border bg-app-base p-1">
            {MODES.map(mode => (
              <button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={settings.mode === mode.value}
                onClick={() => save(setSearchMode(settings, mode.value))}
                className={`min-h-9 rounded-lg px-2 text-[11px] font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action ${settings.mode === mode.value ? 'bg-app-action text-app-on-action' : 'text-app-muted hover:text-app-heading'}`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {settings.sources.length === 0 ? (
            <p data-testid="manage-sources-empty" className="text-[11px] text-app-muted px-1">No sources added.</p>
          ) : (
            <ul data-testid="manage-sources-list" className="space-y-1.5">
              {settings.sources.map((source, index) => (
                <li key={source.id} data-testid={`manage-source-${source.id}`} className="rounded-xl border border-app-border bg-app-base p-2">
                  <div className="flex items-center gap-2">
                    <label className="flex min-h-11 flex-1 min-w-0 items-center gap-2 cursor-pointer text-xs font-semibold text-app-heading">
                      <input
                        type="checkbox"
                        checked={source.enabled}
                        onChange={event => save(setSourceEnabled(settings, source.id, event.target.checked))}
                        aria-label={`Enable ${source.name}`}
                        className="h-4 w-4 shrink-0 accent-app-action"
                      />
                      <span className="min-w-0 break-words">{source.name}</span>
                    </label>
                    <span className={pill}>{source.kind === 'provider' ? (settings.mode === 'primary' && source.id === firstEnabledProviderId ? 'Primary' : 'Search') : 'Link'}</span>
                  </div>
                  <div className="flex items-center justify-end gap-1.5">
                    <button type="button" className={iconButton} disabled={index === 0} onClick={() => save(moveSource(settings, source.id, -1), `${source.name} moved up.`)} aria-label={`Move ${source.name} up`}>
                      <ArrowUp className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button type="button" className={iconButton} disabled={index === settings.sources.length - 1} onClick={() => save(moveSource(settings, source.id, 1), `${source.name} moved down.`)} aria-label={`Move ${source.name} down`}>
                      <ArrowDown className="w-4 h-4" aria-hidden="true" />
                    </button>
                    {source.kind === 'shortcut' && (
                      <>
                        <a href={source.url} target="_blank" rel="noopener noreferrer" className={iconButton} aria-label={`Open ${source.name} in a new tab`}>
                          <ExternalLink className="w-4 h-4" aria-hidden="true" />
                        </a>
                        <button type="button" className={iconButton} onClick={() => startEdit(source.id)} aria-label={`Edit ${source.name}`}>
                          <Pencil className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </>
                    )}
                    <button type="button" className={iconButton} onClick={() => remove(source.id, source.name)} aria-label={`Remove ${source.name}`}>
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-1.5" data-testid="online-sources-add">
            {remainingSupported.map(supported => (
              <button
                key={supported.id}
                type="button"
                aria-label={`Add ${supported.name}`}
                onClick={() => applyResult(addSupportedSource(settings, supported.id), `${supported.name} added.`)}
                className={smallAction}
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>{supported.name}</span>
              </button>
            ))}
            {!formOpen && (
              <button type="button" onClick={() => setFormOpen(true)} className={smallAction}>
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Website</span>
              </button>
            )}
          </div>

          {formOpen && (
            <form onSubmit={submitForm} noValidate className="space-y-1.5" data-testid="manage-sources-form" aria-label={editingId ? 'Edit website' : 'Add website'}>
              <input type="text" aria-label="Name (optional)" value={formName} maxLength={60} onChange={event => setFormName(event.target.value)} placeholder="Name (optional)" className={fieldClass} />
              <input
                type="url"
                inputMode="url"
                aria-label="Website URL"
                value={formUrl}
                maxLength={2048}
                onChange={event => { setFormUrl(event.target.value); if (formError) setFormError(null) }}
                placeholder="https://example.com"
                aria-invalid={formError ? true : undefined}
                aria-describedby={formError ? 'online-sources-form-error' : undefined}
                className={fieldClass}
              />
              <input
                type="text"
                inputMode="url"
                aria-label="Search URL (optional)"
                value={formSearchUrl}
                maxLength={2048}
                onChange={event => { setFormSearchUrl(event.target.value); if (formError) setFormError(null) }}
                placeholder="Search URL, e.g. https://example.com/?s={query}"
                className={fieldClass}
              />
              {formError && <p id="online-sources-form-error" role="alert" className="text-[11px] text-status-error">{formError}</p>}
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={resetForm} className="min-h-11 rounded-xl px-3 text-xs text-app-muted hover:text-app-heading cursor-pointer">Cancel</button>
                <button type="submit" className="min-h-11 rounded-xl bg-app-action px-4 text-xs font-bold text-app-on-action cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action">{editingId ? 'Save' : 'Add'}</button>
              </div>
            </form>
          )}

          {confirmRestore ? (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Confirm restore defaults">
              <button type="button" className={smallAction} onClick={() => { save(restoreDefaultSettings(), 'Defaults restored.'); resetForm(); setConfirmRestore(false) }}>Restore defaults</button>
              <button type="button" className="min-h-11 rounded-xl px-3 text-xs text-app-muted hover:text-app-heading cursor-pointer" onClick={() => setConfirmRestore(false)}>Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmRestore(true)} className={smallAction}>
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              <span>Restore Defaults</span>
            </button>
          )}

          <p role="status" aria-live="polite" data-testid="manage-sources-status" className="sr-only">{status}</p>
        </div>
      )}
    </div>
  )
}
