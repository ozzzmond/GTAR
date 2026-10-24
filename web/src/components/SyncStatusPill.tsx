import React from 'react'
import { AlertTriangle, Check, CloudUpload, RotateCw, Smartphone } from 'lucide-react'
import type { SyncPill, SyncPillKind } from '../utils/syncStatus'
import { recoveryDotClass } from '../utils/recoveryAttention'

/** #191 (RFC #188 S3): header status pill, one of five states; always opens the Sync Center. */
const STYLE: Record<SyncPillKind, { tone: string; Icon: typeof Check; spin?: boolean }> = {
  device: { tone: 'text-app-muted bg-app-base border-app-border hover:border-app-action', Icon: Smartphone },
  syncing: { tone: 'text-app-action bg-app-action/10 border-app-action/40', Icon: RotateCw, spin: true },
  synced: { tone: 'text-status-success bg-status-success/10 border-status-success/40', Icon: Check },
  pending: { tone: 'text-status-warning bg-status-warning/10 border-status-warning/40', Icon: CloudUpload },
  attention: { tone: 'text-status-error bg-status-error/10 border-status-error/50', Icon: AlertTriangle },
}

/** `recoveryDot` keeps the #181 red dot for local recovery decisions on the pill. */
export const SyncStatusPill: React.FC<{ pill: SyncPill; onOpen: () => void; recoveryDot?: boolean }> = ({ pill, onOpen, recoveryDot }) => {
  const { tone, Icon, spin } = STYLE[pill.kind]
  return (
    <button
      type="button"
      data-testid="header-cloud-sync-button"
      data-sync-state={pill.kind}
      onClick={onOpen}
      title={pill.description}
      aria-label={pill.description}
      className={`relative min-h-11 min-w-11 px-2.5 sm:px-3 rounded-full border ${tone} transition-colors flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer active:scale-95`}
    >
      <Icon aria-hidden="true" className={`w-4 h-4 shrink-0${spin ? ' motion-safe:animate-spin' : ''}`} />
      {/* Phones show the icon (and the attention count); the full label from md up. */}
      {pill.kind === 'attention' && <span className="md:hidden font-mono text-[11px]">{pill.attention.length}</span>}
      <span className="hidden md:inline text-[12px] whitespace-nowrap">{pill.label}</span>
      {recoveryDot && <span data-testid="header-recovery-dot" aria-hidden="true" className={recoveryDotClass} />}
    </button>
  )
}
