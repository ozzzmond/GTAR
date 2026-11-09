// #304 item 8: "Recovery data" — older copies of the songbook kept on this device, in plain language.
import { useEffect, useRef } from 'react'
import { History, X } from 'lucide-react'
import { RecoveryDataCard } from './RecoveryDataCard'

export function RecoveryDataPanel({ blocked = () => false, onClose }: { blocked?: () => boolean; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    card.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
    return () => previous?.focus?.()
  }, [])

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busyRef.current) onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])

  return (
    <div
      data-testid="recovery-data-backdrop"
      onClick={event => { if (event.target === event.currentTarget && !busyRef.current) onClose() }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in"
    >
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label="Recovery data"
        data-testid="recovery-data-panel"
        className="w-full max-w-lg rounded-2xl border border-app-border bg-app-surface text-app-heading shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="px-5 py-3 border-b border-app-border/80 flex items-center justify-between bg-app-base/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-app-action/20 border border-app-action/40 flex items-center justify-center text-app-action">
              <History className="w-4 h-4" aria-hidden="true" />
            </div>
            <h2 className="font-extrabold text-sm sm:text-base tracking-wide">Recovery data</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 -mr-2 rounded-xl hover:bg-app-base flex items-center justify-center text-app-muted hover:text-app-heading transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <p className="text-xs text-app-muted">Older copies of your songbook that GTAR kept on this device. Your current songbook is not affected.</p>
          <RecoveryDataCard blocked={blocked} />
        </div>

        <div className="px-5 py-3 border-t border-app-border/80 bg-app-base/60 flex items-center justify-end gap-2 text-[11px] text-app-muted">
          <button
            type="button"
            data-testid="recovery-data-close"
            onClick={onClose}
            className="min-h-11 px-4 py-1.5 rounded-lg bg-app-border/50 hover:bg-app-border text-app-heading font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
export { RecoveryDataCard }
