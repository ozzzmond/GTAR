import React from 'react'
import { Ban, Check, CircleAlert, Cloud } from 'lucide-react'
import { cloudBackupTime, type cloudBackupStatus } from '../utils/syncStatus'
import { recoveryDotClass } from '../utils/recoveryAttention'

export function SyncStatusPill({ status, lastBackup, now, onClick, recoveryAttention = false }: {
  status: ReturnType<typeof cloudBackupStatus>; lastBackup: string | null
  now?: number; onClick: () => void; recoveryAttention?: boolean
}): React.ReactElement {
  const Badge = status.state === 'backed-up' ? Check : status.state === 'signed-out' ? Ban : CircleAlert
  const description = `Backup & Restore — ${status.label}. ${status.state === 'unknown' ? 'Open to verify cloud backup' : status.state === 'signed-out' ? 'Sign in to check cloud backup' : cloudBackupTime(lastBackup, now)}`
  return <button type="button" data-testid="header-cloud-sync-button" data-status={status.state} onClick={onClick}
    aria-label={description} title={description}
    className="relative flex min-h-11 min-w-11 w-11 h-11 shrink-0 items-center justify-center rounded-xl border border-app-border bg-app-base text-app-action hover:border-app-action cursor-pointer">
    <span className="relative inline-flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center shrink-0" aria-hidden="true">
      <Cloud className="h-5 w-5 text-app-action" />
      <Badge className={`absolute -right-1 bottom-0 h-3.5 w-3.5 rounded-full bg-app-base ${status.state === 'backed-up' ? 'text-app-action' : 'text-status-error'}`} />
    </span>
    {recoveryAttention && <span data-testid="cloud-recovery-dot" aria-hidden="true" className={recoveryDotClass} />}
  </button>
}
