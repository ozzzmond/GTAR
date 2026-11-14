import React, { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { trapTab } from '../utils/focusTrap'
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

interface ManageSourcesModalProps {
  isOpen: boolean
  onClose: () => void
  /** Global Online song sources flag, shown as context only; it is toggled in Advanced Tools. */
  onlineSourcesEnabled: boolean
}

const MODE_OPTIONS: Array<{ value: SearchMode; label: string }> = [
  { value: 'all', label: 'All enabled supported search providers' },
  { value: 'primary', label: 'Primary provider only' },
]

const iconButton = 'relative flex w-9 h-9 shrink-0 items-center justify-center rounded-lg border border-app-border bg-app-base text-app-muted hover:text-app-heading hover:border-app-action disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer before:absolute before:-inset-1 before:content-[\'\'] focus-visible:outline-2 focus-visible:outline-app-action'
const fieldClass = 'w-full min-h-11 bg-app-base border border-app-border rounded-lg px-3 py-2 text-xs text-app-heading placeholder-app-muted/60 focus:outline-none focus:border-app-action'
const sectionHeading = 'text-xs font-bold text-app-heading'

export const ManageSourcesModal: React.FC<ManageSourcesModalProps> = ({ isOpen, onClose, onlineSourcesEnabled }) => {
  const settings = useOnlineSourceSettings()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => { if (isOpen) closeRef.current?.focus() }, [isOpen])

  if (!isOpen) return null

  const save = (next: OnlineSourceSettings, message?: string) => {
    saveOnlineSourceSettings(next)
    if (message) setStatus(message)
  }
  const applyResult = (result: Result<OnlineSourceSettings>, message: string): boolean => {
    if (!result.ok) { setStatus(''); setFormError(result.error); return false }
    setFormError(null)
    save(result.value, message)
    return true
  }
  const resetForm = () => { setEditingId(null); setFormName(''); setFormUrl(''); setFormError(null) }

  const submitForm = (event: React.FormEvent) => {
    event.preventDefault()
    const done = editingId
      ? applyResult(updateShortcut(settings, editingId, { name: formName, url: formUrl }), 'Website shortcut updated.')
      : applyResult(addShortcut(settings, { name: formName, url: formUrl }), 'Website shortcut added.')
    if (done) resetForm()
  }
  const startEdit = (id: string) => {
    const entry = settings.sources.find(source => source.id === id)
    if (!entry || entry.kind !== 'shortcut') return
    setEditingId(id)
    setFormName(entry.name)
    setFormUrl(entry.url)
    setFormError(null)
  }
  const remove = (id: string, name: string) => {
    if (editingId === id) resetForm()
    save(removeSource(settings, id), `${name} removed.`)
  }

  const firstEnabledProviderId = settings.sources.find(source => source.kind === 'provider' && source.enabled)?.id
  const remainingSupported = SUPPORTED_SOURCES.filter(supported => !settings.sources.some(source => source.id === supported.id))
  const searchableCount = settings.sources.filter(source => source.kind === 'provider' && source.enabled).length

  return (
    <div
      data-testid="manage-sources-backdrop"
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
      className="fixed inset-0 z-[110] flex items-stretch sm:items-center justify-center sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-sources-title"
        data-testid="manage-sources-modal"
        onKeyDown={event => {
          if (trapTab(event, dialogRef.current)) return
          if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose() }
        }}
        className="w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl border-app-border sm:border bg-app-surface text-app-heading shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="px-4 py-3 border-b border-app-border flex items-center justify-between gap-2 bg-app-base/60">
          <h2 id="manage-sources-title" className="font-extrabold text-sm sm:text-base tracking-wide">Manage Sources</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close Manage Sources" className={iconButton}>
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-5">
          <p data-testid="manage-sources-global-status" className="text-xs text-app-muted">
            {onlineSourcesEnabled
              ? 'Online song sources is On. Enabled search providers are used by the search bar.'
              : 'Online song sources is Off, so no online search runs. Turn it on in Advanced Tools. Local search always works.'}
          </p>

          <section aria-labelledby="manage-sources-mode-heading" className="space-y-2">
            <h3 id="manage-sources-mode-heading" className={sectionHeading}>Search mode</h3>
            <div role="radiogroup" aria-labelledby="manage-sources-mode-heading" className="space-y-1">
              {MODE_OPTIONS.map(option => (
                <label key={option.value} className="flex min-h-11 items-center gap-2.5 rounded-lg px-2 text-xs text-app-text cursor-pointer">
                  <input
                    type="radio"
                    name="manage-sources-mode"
                    value={option.value}
                    checked={settings.mode === option.value}
                    onChange={() => save(setSearchMode(settings, option.value))}
                    className="h-4 w-4 accent-app-action"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-app-muted">Priority sets the order, and the first enabled search provider is the primary one. It does not rank by relevance.</p>
          </section>

          <section aria-labelledby="manage-sources-list-heading" className="space-y-2">
            <h3 id="manage-sources-list-heading" className={sectionHeading}>Your sources</h3>
            {settings.sources.length === 0 ? (
              <p data-testid="manage-sources-empty" className="rounded-lg border border-dashed border-app-border px-3 py-3 text-xs text-app-muted">
                No sources yet, so online search has nothing to use. Add a supported source or a website shortcut below, or restore the defaults. Local search still works.
              </p>
            ) : (
              <ul data-testid="manage-sources-list" className="space-y-2">
                {settings.sources.map((source, index) => (
                  <li key={source.id} data-testid={`manage-source-${source.id}`} className="rounded-xl border border-app-border bg-app-base/40 p-2.5">
                    <div className="flex items-center gap-2">
                      <label className="flex min-h-11 flex-1 min-w-0 items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={source.enabled}
                          onChange={event => save(setSourceEnabled(settings, source.id, event.target.checked))}
                          aria-label={`Enable ${source.name}`}
                          className="h-4 w-4 shrink-0 accent-app-action"
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-app-heading break-words">{source.name}</span>
                          <span className="block text-[11px] text-app-muted break-all">
                            {source.kind === 'provider' ? 'Search provider: results appear in GTAR' : `Website shortcut: opens in your browser (${new URL(source.url).hostname})`}
                          </span>
                        </span>
                      </label>
                      <span className="shrink-0 text-[10px] font-mono text-app-muted" aria-label={`Priority ${index + 1}`}>#{index + 1}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {source.kind === 'provider' && settings.mode === 'primary' && source.id === firstEnabledProviderId && (
                        <span className="rounded-full border border-app-action/50 px-1.5 py-0.5 text-[10px] text-app-action">Primary</span>
                      )}
                      {source.kind === 'provider' && !source.enabled && <span className="text-[10px] text-app-muted">Disabled</span>}
                      <span className="flex-1" />
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
            {settings.sources.length > 0 && searchableCount === 0 && (
              <p className="text-[11px] text-app-muted">No search provider is enabled, so only local results show.</p>
            )}
          </section>

          <section aria-labelledby="manage-sources-supported-heading" className="space-y-2">
            <h3 id="manage-sources-supported-heading" className={sectionHeading}>Supported Song Sources</h3>
            <p className="text-[11px] text-app-muted">A curated list, not an endorsement. Websites listed as shortcuts open in your browser and do not show results in GTAR.</p>
            {remainingSupported.length === 0 ? (
              <p className="text-xs text-app-muted">All supported sources are already in your list.</p>
            ) : (
              <ul className="space-y-2">
                {remainingSupported.map(supported => (
                  <li key={supported.id} className="flex items-center gap-2 rounded-xl border border-app-border bg-app-base/40 p-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-app-heading">{supported.name}</span>
                      <span className="block text-[11px] text-app-muted">{supported.kind === 'provider' ? 'Search provider' : 'Website shortcut'}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => applyResult(addSupportedSource(settings, supported.id), `${supported.name} added.`)}
                      aria-label={`Add ${supported.name}`}
                      className="min-h-11 shrink-0 rounded-lg border border-app-action/50 px-3 text-xs font-bold text-app-action hover:bg-app-action/10 cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action"
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="manage-sources-custom-heading" className="space-y-2">
            <h3 id="manage-sources-custom-heading" className={sectionHeading}>{editingId ? 'Edit website shortcut' : 'Add custom website URL'}</h3>
            <p className="text-[11px] text-app-muted">Custom websites are shortcuts only. GTAR does not search them or read their pages.</p>
            <form onSubmit={submitForm} noValidate className="space-y-2" data-testid="manage-sources-form">
              <label className="block text-[11px] text-app-muted">
                Name (optional)
                <input type="text" value={formName} maxLength={60} onChange={event => setFormName(event.target.value)} placeholder="Church chord site" className={`${fieldClass} mt-1`} />
              </label>
              <label className="block text-[11px] text-app-muted">
                Website URL
                <input
                  type="url"
                  inputMode="url"
                  value={formUrl}
                  maxLength={2048}
                  onChange={event => { setFormUrl(event.target.value); if (formError) setFormError(null) }}
                  placeholder="https://example.com"
                  aria-invalid={formError ? true : undefined}
                  aria-describedby={formError ? 'manage-sources-form-error' : undefined}
                  className={`${fieldClass} mt-1`}
                />
              </label>
              {formError && <p id="manage-sources-form-error" role="alert" className="text-xs text-status-error">{formError}</p>}
              <div className="flex justify-end gap-2">
                {editingId && (
                  <button type="button" onClick={resetForm} className="min-h-11 rounded-lg px-3 text-xs text-app-muted hover:text-app-heading cursor-pointer">Cancel</button>
                )}
                <button type="submit" className="min-h-11 flex items-center gap-1.5 rounded-lg bg-app-action px-4 text-xs font-bold text-app-on-action cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action">
                  {!editingId && <Plus className="w-4 h-4" aria-hidden="true" />}
                  <span>{editingId ? 'Save changes' : 'Add website'}</span>
                </button>
              </div>
            </form>
          </section>

          <section aria-labelledby="manage-sources-restore-heading" className="space-y-2 border-t border-app-border pt-3">
            <h3 id="manage-sources-restore-heading" className={sectionHeading}>Defaults</h3>
            {confirmRestore ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm restore defaults">
                <span className="text-xs text-app-muted">Replace your list, order and mode with the defaults?</span>
                <button type="button" className="min-h-11 rounded-lg border border-app-action/50 px-3 text-xs font-bold text-app-action cursor-pointer" onClick={() => { save(restoreDefaultSettings(), 'Defaults restored.'); resetForm(); setConfirmRestore(false) }}>Restore defaults</button>
                <button type="button" className="min-h-11 rounded-lg px-3 text-xs text-app-muted hover:text-app-heading cursor-pointer" onClick={() => setConfirmRestore(false)}>Keep my list</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmRestore(true)} className="min-h-11 flex items-center gap-2 rounded-lg border border-app-border px-3 text-xs font-semibold text-app-heading hover:border-app-action cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action">
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                <span>Restore Defaults</span>
              </button>
            )}
          </section>

          <p role="status" aria-live="polite" data-testid="manage-sources-status" className="sr-only">{status}</p>
        </div>
      </div>
    </div>
  )
}
