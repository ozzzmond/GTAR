import React, { useState } from 'react'
import { normalizeTags, tagChipStyle } from '../utils/songTags'
import { useTagLibrary } from '../utils/tagLibraryContext'

const rowActionBtn = 'min-h-11 min-w-11 rounded-lg text-app-muted hover:bg-app-surface hover:text-app-heading flex items-center justify-center transition-colors'
const pillInput = 'min-h-11 w-full min-w-0 rounded-full border border-app-border hover:border-app-border/80 bg-app-base px-3.5 text-xs text-app-text font-medium placeholder:text-app-muted focus:border-app-accent focus:ring-2 focus:ring-app-accent/20 focus:outline-none transition-all'
const primaryPillBtn = 'min-h-11 px-3.5 rounded-full bg-app-action hover:brightness-110 text-app-on-action font-semibold text-xs transition-colors flex items-center justify-center cursor-pointer'
const secondaryPillBtn = 'min-h-11 px-3.5 rounded-full bg-app-button hover:brightness-110 border border-app-border text-app-button-text font-semibold text-xs transition-colors flex items-center justify-center cursor-pointer'
const labelStyle = 'text-[11px] font-semibold text-app-muted'

const presets = [
  ['Action', '--custom-actionColor'], ['Accent', '--custom-control-accent'],
  ['Section', '--custom-sectionIconColor'], ['Heading', '--custom-uiSectionText'],
  ['Text', '--custom-uiPrimaryText'], ['Muted', '--custom-uiMutedText'],
] as const

/** Reuses the Explorer row and folder editor patterns; no browser dialogs. */
export function TagRow({ tag, onChange, children }: { tag: string; onChange?: (tag: string, renamed?: string) => boolean; children: React.ReactNode }) {
  const { colors, onColorChange } = useTagLibrary()
  const savedColor = tagChipStyle(colors, tag)?.backgroundColor ?? ''
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(tag)
  const [hex, setHex] = useState(savedColor)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState('')
  const [showColors, setShowColors] = useState(false)
  const close = () => { setOpen(false); setError(''); setConfirmRemove(false); setShowColors(false) }
  const saveColor = (color?: string) => {
    if (color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(color)) { setError('Enter a six-digit hex color, such as #abcdef.'); return }
    if (onColorChange?.(tag, color?.toLowerCase())) { setHex(color ?? ''); setError('') }
    else setError('Tag color was not saved. Resolve the storage conflict and retry.')
  }
  return <div>
    <div className="flex items-center min-w-0">{children}
      {onChange && <button type="button" aria-label={`Tag actions for ${tag}`} aria-expanded={open} className={rowActionBtn}
        onClick={() => { if (open) close(); else { setName(tag); setHex(savedColor); setOpen(true) } }}>...</button>}
    </div>
    {open && <form aria-label={`Edit tag ${tag}`} className="space-y-1.5 rounded-xl border border-app-border bg-app-surface p-2.5 my-1"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
      onSubmit={event => {
        event.preventDefault()
        const renamed = normalizeTags([name])[0]
        if (!renamed) { setError('Enter a tag name.'); return }
        if (renamed === tag || onChange?.(tag, renamed)) close()
        else setError('Tag was not saved. Resolve the storage conflict and retry.')
      }}>
      <label className="block space-y-1">
        <span className={labelStyle}>Tag name</span>
        <input autoFocus aria-label="Tag name" className={pillInput} value={name} onChange={event => setName(event.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="submit" className={primaryPillBtn}>Save</button>
        <button type="button" className={secondaryPillBtn} onClick={close}>Cancel</button>
        <button type="button" className={secondaryPillBtn} onClick={() => { setConfirmRemove(true); setError('') }}>Remove</button>
        {onColorChange && <button type="button" className={secondaryPillBtn} aria-expanded={showColors} onClick={() => setShowColors(!showColors)}>Color</button>}
      </div>
      {confirmRemove && (
        <div role="alert" className="space-y-1.5 rounded-lg border border-status-error/30 bg-status-error/10 p-2 text-xs">
          <p className="text-app-heading font-medium leading-relaxed">Remove #{tag} from every song? Songs will be kept.</p>
          <div className="flex items-center gap-1.5">
            <button type="button" className="min-h-11 px-3.5 rounded-full bg-status-error hover:brightness-110 text-white font-semibold text-xs transition-colors flex items-center justify-center cursor-pointer" onClick={() => { if (onChange?.(tag)) close(); else setError('Tag was not saved. Resolve the storage conflict and retry.') }}>Confirm remove tag</button>
            <button type="button" className={secondaryPillBtn} onClick={() => setConfirmRemove(false)}>Keep tag</button>
          </div>
        </div>
      )}
      {showColors && (
        <div role="group" aria-label={`Color for ${tag}`} className="space-y-1.5 pt-0.5">
          <div className="flex items-center gap-0.5 flex-wrap">
            {presets.map(([label, token]) => (
              <button
                key={token}
                type="button"
                aria-label={`${label} tag color`}
                className="min-h-11 min-w-11 flex items-center justify-center rounded-full hover:bg-app-base/60 transition-colors cursor-pointer"
                onClick={() => {
                  const color = window.getComputedStyle(document.documentElement).getPropertyValue(token).trim()
                  saveColor(color)
                }}
              >
                <span className="w-4 h-4 rounded-full border border-app-border/40 shadow-sm" style={{ backgroundColor: `var(${token})` }} />
                <span className="sr-only">{label}</span>
              </button>
            ))}
          </div>
          <label className="block space-y-1">
            <span className={labelStyle}>Custom hex</span>
            <input aria-label="Custom tag hex color" className={pillInput} placeholder="#abcdef" value={hex} onChange={event => setHex(event.target.value)} />
          </label>
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            <button type="button" className={secondaryPillBtn} onClick={() => saveColor(hex)}>Apply color</button>
            <button type="button" className={secondaryPillBtn} onClick={() => saveColor()}>Reset color</button>
            <span className="inline-block rounded-full border border-app-border px-2.5 py-0.5 text-xs font-medium" style={tagChipStyle({ [tag]: hex }, tag)}>#{tag}</span>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs font-medium text-status-error">{error}</p>}
    </form>}
  </div>
}
