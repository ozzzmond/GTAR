import React, { useState } from 'react'
import { normalizeTags, tagChipStyle } from '../utils/songTags'
import { useTagLibrary } from '../utils/tagLibraryContext'

const button = 'min-h-11 min-w-11 rounded-lg px-2 text-app-muted hover:bg-app-surface hover:text-app-heading'
const field = 'min-h-11 w-full min-w-0 rounded-lg border border-app-border bg-app-base px-2 text-app-text'
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
      {onChange && <button type="button" aria-label={`Tag actions for ${tag}`} aria-expanded={open} className={button}
        onClick={() => { if (open) close(); else { setName(tag); setHex(savedColor); setOpen(true) } }}>...</button>}
    </div>
    {open && <form aria-label={`Edit tag ${tag}`} className="space-y-2 rounded-lg border border-app-border bg-app-surface p-2"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
      onSubmit={event => {
        event.preventDefault()
        const renamed = normalizeTags([name])[0]
        if (!renamed) { setError('Enter a tag name.'); return }
        if (renamed === tag || onChange?.(tag, renamed)) close()
        else setError('Tag was not saved. Resolve the storage conflict and retry.')
      }}>
      <label className="block">Tag name<input autoFocus aria-label="Tag name" className={field} value={name} onChange={event => setName(event.target.value)} /></label>
      <div className="flex flex-wrap gap-1">
        <button type="submit" className={button}>Save</button>
        <button type="button" className={button} onClick={close}>Cancel</button>
        <button type="button" className={button} onClick={() => { setConfirmRemove(true); setError('') }}>Remove</button>
        {onColorChange && <button type="button" className={button} aria-expanded={showColors} onClick={() => setShowColors(!showColors)}>Color</button>}
      </div>
      {confirmRemove && <div role="alert"><p>Remove #{tag} from every song? Songs will be kept.</p>
        <button type="button" className={button} onClick={() => { if (onChange?.(tag)) close(); else setError('Tag was not saved. Resolve the storage conflict and retry.') }}>Confirm remove tag</button>
        <button type="button" className={button} onClick={() => setConfirmRemove(false)}>Keep tag</button>
      </div>}
      {showColors && <div role="group" aria-label={`Color for ${tag}`} className="space-y-2">
        <div className="flex flex-wrap gap-1">{presets.map(([label, token]) => <button key={token} type="button" aria-label={`${label} tag color`} className={`${button} border border-app-border`}
          style={{ backgroundColor: `var(${token})` }} onClick={() => {
            const color = window.getComputedStyle(document.documentElement).getPropertyValue(token).trim()
            saveColor(color)
          }}><span className="sr-only">{label}</span></button>)}</div>
        <label className="block">Custom hex<input aria-label="Custom tag hex color" className={field} placeholder="#abcdef" value={hex} onChange={event => setHex(event.target.value)} /></label>
        <div className="flex flex-wrap gap-1"><button type="button" className={button} onClick={() => saveColor(hex)}>Apply color</button><button type="button" className={button} onClick={() => saveColor()}>Reset color</button></div>
        <span className="inline-block rounded-md border border-app-border px-1.5 py-0.5" style={tagChipStyle({ [tag]: hex }, tag)}>#{tag}</span>
      </div>}
      {error && <p role="alert" className="text-app-muted">{error}</p>}
    </form>}
  </div>
}
