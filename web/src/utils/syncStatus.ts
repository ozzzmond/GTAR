export function cloudBackupStatus(signedIn: boolean, lastBackup: string | null, backupChecksum: string | null, localChecksum: string | null) {
  if (!signedIn) return { state: 'signed-out', label: 'Not signed in' } as const
  if (lastBackup && backupChecksum && localChecksum === backupChecksum) return { state: 'backed-up', label: 'Backed up' } as const
  return { state: 'not-backed-up', label: 'Not backed up' } as const
}

export function cloudBackupTime(lastBackup: string | null, now = Date.now()): string {
  if (!lastBackup || !Number.isFinite(Date.parse(lastBackup))) return 'No cloud backup yet'
  const minutes = Math.max(0, Math.floor((now - Date.parse(lastBackup)) / 60000))
  const time = minutes < 60 ? `${minutes} m` : minutes < 1440 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 1440)} d`
  return `Last cloud backup: ${time} ago`
}
