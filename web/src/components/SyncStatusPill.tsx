import React from 'react'
import { Ban, Check, CircleAlert, Cloud } from 'lucide-react'
import { cloudBackupStatus, cloudBackupTime } from '../utils/syncStatus'
import { recoveryDotClass } from '../utils/recoveryAttention'

export function SyncStatusPill({ signedIn, lastBackup, backupChecksum, localChecksum, now, onClick, recoveryAttention = false }: {
  signedIn: boolean; lastBackup: string | null; backupChecksum: string | null; localChecksum: string | null
  now?: number; onClick: () => void; recoveryAttention?: boolean
}): React.ReactElement {
  const status = cloudBackupStatus(signedIn, lastBackup, backupChecksum, localChecksum)
  const Badge = status.state === 'backed-up' ? Check : status.state === 'signed-out' ? Ban : CircleAlert
  const description = `Backup & Restore — ${status.label}. ${cloudBackupTime(lastBackup, now)}`
  return <button type="button" data-testid="header-cloud-sync-button" data-status={status.state} onClick={onClick}
    aria-label={description} title={description}
    className="relative flex min-h-11 min-w-9 sm:min-w-11 w-9 sm:w-auto shrink-0 items-center justify-center gap-1 sm:gap-2 rounded-xl border border-app-border bg-app-base px-1.5 sm:px-2 text-app-action hover:border-app-action cursor-pointer">
    <span className="relative inline-flex h-5 w-5 sm:h-6 sm:w-7 items-center justify-center shrink-0" aria-hidden="true">
      <Cloud className="h-4 w-4 sm:h-5 sm:w-5 text-app-action" />
      <Badge className={`absolute -right-1 bottom-0 h-3 w-3 sm:h-3.5 sm:w-3.5 rounded-full bg-app-base ${status.state === 'backed-up' ? 'text-app-action' : 'text-status-error'}`} />
    </span>
    <span className="hidden lg:inline text-xs font-semibold">{status.label}</span>
    {recoveryAttention && <span data-testid="cloud-recovery-dot" aria-hidden="true" className={recoveryDotClass} />}
  </button>
}
