import React, { useState } from 'react'
import { MoreHorizontal, Tag } from 'lucide-react'
import { normalizeTags, tagChipStyle } from '../utils/songTags'
import { useTagLibrary } from '../utils/tagLibraryContext'

const rowActionBtn = 'min-h-11 min-w-11 rounded-xl sm:rounded-lg max-sm:h-(--control-h) max-sm:min-h-(--control-h) max-sm:shrink-0 text-app-muted hover:bg-app-surface hover:text-app-heading flex items-center justify-center transition-colors'
const editorButton = 'max-sm:h-(--control-h) max-sm:min-h-(--control-h) max-sm:after:hidden'
const searchBoxInput = 'min-h-[36px] max-sm:min-h-(--control-h) w-full min-w-0 rounded-xl border border-app-border hover:border-app-border/80 bg-app-surface px-3 py-1.5 text-xs text-app-text placeholder:text-app-muted focus:border-app-accent focus:ring-2 focus:ring-app-accent/20 focus:outline-none transition-all duration-200'
const primaryPillBtn = `${editorButton} relative h-7 px-2.5 rounded-xl bg-app-action hover:brightness-110 text-app-on-action border border-app-action/50 font-medium text-xs transition-colors flex items-center justify-center cursor-pointer whitespace-nowrap after:absolute after:-inset-y-2 after:-inset-x-0.5 after:content-['']`
const secondaryPillBtn = `${editorButton} relative h-7 px-2.5 rounded-xl bg-app-surface hover:bg-app-base border border-app-border hover:border-app-border/80 text-app-text font-medium text-xs transition-colors flex items-center justify-center cursor-pointer whitespace-nowrap after:absolute after:-inset-y-2 after:-inset-x-0.5 after:content-['']`

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
    <div className="flex items-center min-w-0 max-sm:rounded-xl">{children}
      {onChange && <button type="button" aria-label={`Tag actions for ${tag}`} aria-expanded={open} className={rowActionBtn}
        onClick={() => { if (open) close(); else { setName(tag); setHex(savedColor); setOpen(true) } }}>
        <span className="max-sm:hidden">...</span>
        <MoreHorizontal className="size-5 sm:hidden" aria-hidden="true" />
      </button>}
    </div>
    {open && <form aria-label={`Edit tag ${tag}`} className="my-1.5 space-y-1.5 pl-3.5 pr-1 max-sm:my-2 max-sm:space-y-2 max-sm:pl-2 max-sm:pr-0"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
      onSubmit={event => {
        event.preventDefault()
        const renamed = normalizeTags([name])[0]
        if (!renamed) { setError('Enter a tag name.'); return }
        if (renamed === tag || onChange?.(tag, renamed)) close()
        else setError('Tag was not saved. Resolve the storage conflict and retry.')
      }}>
      <div className="relative flex items-center min-w-0 w-full">
        <Tag className="absolute left-2.5 w-3.5 h-3.5 text-app-muted pointer-events-none" />
        <input autoFocus aria-label="Tag name" placeholder="Tag name" className={`${searchBoxInput} pl-8`} value={name} onChange={event => setName(event.target.value)} />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap max-sm:gap-2 max-sm:grid max-sm:grid-cols-2">
        <button type="submit" className={primaryPillBtn}>Save</button>
        <button type="button" className={secondaryPillBtn} onClick={close}>Cancel</button>
        <button type="button" className={secondaryPillBtn} onClick={() => { setConfirmRemove(true); setError('') }}>Remove</button>
        {onColorChange && <button type="button" className={secondaryPillBtn} aria-expanded={showColors} onClick={() => setShowColors(!showColors)}>Color</button>}
      </div>
      {confirmRemove && (
        <div role="alert" className="space-y-1.5 max-sm:space-y-2 rounded-xl max-sm:rounded-2xl border border-status-error/30 bg-status-error/10 p-2 text-xs">
          <p className="text-app-heading font-medium leading-relaxed max-sm:wrap-anywhere">Remove #{tag} from every song? Songs will be kept.</p>
          <div className="flex items-center gap-1.5 flex-nowrap max-sm:flex-wrap max-sm:gap-2">
            <button type="button" className={`${editorButton} relative h-7 px-2.5 rounded-xl bg-status-error hover:brightness-110 text-white font-medium text-xs max-sm:whitespace-nowrap transition-colors flex items-center justify-center cursor-pointer after:absolute after:-inset-y-2 after:content-['']`} onClick={() => { if (onChange?.(tag)) close(); else setError('Tag was not saved. Resolve the storage conflict and retry.') }}>Confirm remove tag</button>
            <button type="button" className={secondaryPillBtn} onClick={() => setConfirmRemove(false)}>Keep tag</button>
          </div>
        </div>
      )}
      {showColors && (
        <div role="group" aria-label={`Color for ${tag}`} className="space-y-1.5 pt-0.5 max-sm:space-y-2 max-sm:pt-1">
          <div className="flex items-center gap-1.5 flex-wrap max-sm:gap-2">
            <div className="flex items-center gap-1 max-sm:flex-wrap">
              {presets.map(([label, token]) => (
                <button
                  key={token}
                  type="button"
                  aria-label={`${label} tag color`}
                  className="relative p-1 rounded-full max-sm:flex max-sm:size-(--control-h) max-sm:items-center max-sm:justify-center max-sm:after:hidden hover:scale-110 transition-transform cursor-pointer after:absolute after:-inset-2 after:content-['']"
                  onClick={() => {
                    const color = window.getComputedStyle(document.documentElement).getPropertyValue(token).trim()
                    saveColor(color)
                  }}
                >
                  <span className="w-3.5 h-3.5 block rounded-full border border-app-border/60 shadow-sm" style={{ backgroundColor: `var(${token})` }} />
                  <span className="sr-only">{label}</span>
                </button>
              ))}
            </div>
            <button type="button" className={secondaryPillBtn} onClick={() => saveColor()}>Reset color</button>
          </div>
          <input
            aria-label="Custom tag hex color"
            placeholder="Custom hex (#abcdef)"
            className={searchBoxInput}
            value={hex}
            onChange={event => setHex(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
                saveColor(hex)
              }
            }}
            onBlur={() => {
              if (hex.trim() && hex.toLowerCase() !== savedColor.toLowerCase()) {
                saveColor(hex)
              }
            }}
          />
        </div>
      )}
      {error && <p role="alert" className="text-xs font-medium text-status-error">{error}</p>}
    </form>}
  </div>
}
