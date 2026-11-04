import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { WebSetlist } from '../types/gtar'

/** Matches the Songbook inline delete surface and buttons, with modal keyboard handling. */
export function SetlistTrashConfirmation({ setlist, onCancel, onConfirm }: {
  setlist?: WebSetlist; onCancel: () => void; onConfirm: () => void
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const submitted = useRef(false)
  useEffect(() => {
    const previous = document.activeElement
    cancel.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() }
      if (event.key === 'Tab') {
        event.preventDefault()
        if (document.activeElement === cancel.current) confirm.current?.focus()
        else cancel.current?.focus()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [onCancel])
  if (!setlist) return null
  return <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onCancel}>
    <div role="dialog" aria-modal="true" aria-label={`Move setlist ${setlist.name} to Trash?`}
      data-testid="setlist-trash-confirmation" onClick={e => e.stopPropagation()}
      className="bg-app-surface border border-status-error rounded-2xl p-3 flex items-center justify-between gap-3 max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center gap-2 text-xs text-status-error font-semibold">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>Move “{setlist.name}” to Trash? Songs stay in your Songbook. Restore this setlist from Trash.</span>
      </div>
      <div className="flex items-center gap-2 text-xs font-bold">
        <button ref={confirm} type="button" data-testid="confirm-trash-setlist" onClick={() => {
          if (submitted.current) return
          submitted.current = true
          onConfirm()
        }} className="min-h-11 px-3 rounded-lg bg-status-error text-app-base hover:brightness-110 transition-colors cursor-pointer">Delete</button>
        <button ref={cancel} type="button" data-testid="cancel-trash-setlist" onClick={onCancel}
          className="min-h-11 px-2.5 rounded-lg bg-app-base text-app-muted hover:text-app-heading transition-colors cursor-pointer">Cancel</button>
      </div>
    </div>
  </div>
}
