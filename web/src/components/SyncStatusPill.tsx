import React from 'react'
import { AlertTriangle, Check, Cloud, CloudUpload, RotateCw } from 'lucide-react'
import type { SyncPill, SyncPillKind } from '../utils/syncStatus'
import { recoveryDotClass } from '../utils/recoveryAttention'

/**
 * #191 (RFC #188 S3): header sync button. Keeps the original header button's look and icons
 * (owner request 2026-10-24); the five states come from the shared status derivation and the
 * button always opens the Sync Center.
 */
const BASE = 'p-1.5 sm:px-2.5 sm:py-1 rounded-xl bg-app-base hover:bg-app-surface border transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer active:scale-95 relative'
const STYLE: Record<SyncPillKind, { text: string; Icon: typeof Check; icon: string; button: string }> = {
  device: { text: 'Cloud Sync', Icon: Cloud, icon: 'w-4 h-4 text-app-action', button: 'text-app-action border-app-border hover:border-app-action' },
  syncing: { text: 'Syncing…', Icon: RotateCw, icon: 'w-4 h-4 text-app-action header-sync-spin motion-safe:animate-spin', button: 'text-app-action border-app-border hover:border-app-action' },
  synced: { text: 'In Sync', Icon: Check, icon: 'w-4 h-4 text-app-action', button: 'text-app-action border-app-border hover:border-app-action' },
  pending: { text: 'Not Synced', Icon: CloudUpload, icon: 'w-4 h-4 text-app-action', button: 'text-app-action border-app-border hover:border-app-action' },
  attention: { text: 'Sync Issue', Icon: AlertTriangle, icon: 'w-4 h-4 text-status-error', button: 'text-status-error border-[#DC6E67]/50 hover:border-[#DC6E67]' },
}

/** `recoveryDot` keeps the #181 red dot for local recovery decisions. */
export const SyncStatusPill: React.FC<{ pill: SyncPill; onOpen: () => void; recoveryDot?: boolean }> = ({ pill, onOpen, recoveryDot }) => {
  const { text, Icon, icon, button } = STYLE[pill.kind]
  return (
    <button
      type="button"
      data-testid="header-cloud-sync-button"
      data-sync-state={pill.kind}
      onClick={onOpen}
      aria-label={pill.description}
      className={`${BASE} ${button}`}
    >
      <Icon aria-hidden="true" className={icon} />
      <span className="hidden md:inline font-mono text-[11px]">{text}</span>
      {recoveryDot && <span data-testid="header-recovery-dot" aria-hidden="true" className={recoveryDotClass} />}
    </button>
  )
}
