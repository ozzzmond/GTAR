// #314 (Codex P2): keep Tab / Shift+Tab inside the topmost dialog. Each dialog layer calls this from
// its own onKeyDown; the call stops propagation so an outer layer does not handle the same Tab.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface TabEvent {
  key: string
  shiftKey: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

export function focusableIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.closest('[inert]'))
}

/** Wraps Tab at the container's edges; returns true when the event was a Tab. */
export function trapTab(event: TabEvent, container: HTMLElement | null): boolean {
  if (event.key !== 'Tab' || !container) return false
  event.stopPropagation()
  const items = focusableIn(container)
  const active = document.activeElement as HTMLElement | null
  if (items.length === 0) { event.preventDefault(); return true }
  const first = items[0]
  const last = items[items.length - 1]
  const inside = !!active && container.contains(active)
  const atStart = !inside || active === first || !items.includes(active as HTMLElement)
  if (event.shiftKey ? atStart : (!inside || active === last)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  }
  return true
}
