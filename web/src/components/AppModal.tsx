import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface AppModalProps {
  onClose: () => void
  title: string
  /** Id of the heading; the dialog is named by it. */
  titleId: string
  icon: React.ReactNode
  /** Extra header controls, placed before the close button. */
  headerActions?: React.ReactNode
  /** Footer actions; a Close button is always appended. */
  footerActions?: React.ReactNode
  panelId?: string
  testId?: string
  backdropTestId?: string
  /** Focused on close when the element that opened the dialog is gone. */
  returnFocusRef?: React.RefObject<HTMLElement | null>
  children: React.ReactNode
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Application-level modal dialog with the Backup & Restore layout: dimmed backdrop, centered card,
 * icon/title/close header, one scrollable body and a footer. Rendered into document.body, so it is
 * never clipped or re-anchored by the menu that launched it and stays mounted after that menu closes.
 */
export const AppModal: React.FC<AppModalProps> = ({
  onClose, title, titleId, icon, headerActions, footerActions, panelId, testId, backdropTestId, returnFocusRef, children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fallback = returnFocusRef
    closeButtonRef.current?.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current
      if (!dialog) return
      if (event.key === 'Escape') {
        // An open contextual help panel takes Escape first.
        if (dialog.querySelector('[role="note"]')) return
        event.preventDefault()
        onCloseRef.current()
      } else if (event.key === 'Tab') {
        const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
        if (items.length === 0) return
        const first = items[0], last = items[items.length - 1]
        const active = document.activeElement
        if (!dialog.contains(active)) { event.preventDefault(); first.focus() }
        else if (event.shiftKey && active === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('keydown', keydown)
      // The launcher is usually gone by now (its menu closed), which leaves <body> as the opener.
      const target = opener && opener !== document.body && opener.isConnected ? opener : fallback?.current
      target?.focus({ preventScroll: true })
    }
  }, [returnFocusRef])

  return createPortal(
    <div
      data-testid={backdropTestId}
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        id={panelId}
        data-testid={testId}
        className="w-full max-w-lg min-h-[min(26rem,90dvh)] max-h-[90dvh] rounded-2xl border border-app-border bg-app-surface text-app-heading shadow-2xl flex flex-col"
      >
        <div data-app-modal="header" className="relative z-10 shrink-0 px-5 py-3.5 border-b border-app-border/80 flex items-center justify-between gap-3 bg-app-base/60 rounded-t-2xl">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-xl bg-app-action/20 border border-app-action/40 flex items-center justify-center text-app-action">
              {icon}
            </div>
            <h2 id={titleId} className="font-extrabold text-sm sm:text-base tracking-wide text-app-heading">{title}</h2>
          </div>
          {/* Help panels drop below the header; cap them so they stay inside the viewport. */}
          <div className="flex items-center gap-2 shrink-0 [&_[role=note]]:max-h-[calc(50dvh+5rem)]">
            {headerActions}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-9 h-9 rounded-xl hover:bg-app-base flex items-center justify-center text-app-muted hover:text-app-heading transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div data-app-modal="body" className="p-5 space-y-6 overflow-y-auto overscroll-contain flex-1 min-h-0 text-sm">
          {children}
        </div>

        <div data-app-modal="footer" className="shrink-0 px-5 py-3.5 border-t border-app-border/80 bg-app-base/60 flex flex-wrap items-center justify-end gap-2 rounded-b-2xl">
          {footerActions}
          <button
            type="button"
            data-testid={testId ? `${testId}-close` : undefined}
            onClick={onClose}
            className="min-h-11 px-4 py-2 rounded-xl bg-app-base hover:bg-app-surface border border-app-border text-app-heading text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** A titled group of settings inside an AppModal body. */
export const AppModalSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2.5">
    <h3 className="text-[11px] font-bold uppercase tracking-wider text-app-muted">{title}</h3>
    {children}
  </section>
)
