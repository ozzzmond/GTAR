/**
 * #251 Cloud V2 P0: what this device knows about its last backup file.
 *
 * GTAR can only know that it created a verified backup file and handed it to the share sheet,
 * the browser's downloads or the clipboard. It cannot see whether the file was saved in Files,
 * iCloud Drive, Google Drive or OneDrive, so nothing here claims that. Only counts, sizes and a
 * content fingerprint are kept (no song content, no account data). Device state: never part of
 * a backup, never uploaded.
 */
export const BACKUP_STATUS_KEY = 'gtar_backup_status_v1'

export type BackupDelivery = 'share' | 'download' | 'copy'
export interface BackupStatus {
  v: 1
  /** When the verified file was handed out (ISO). */
  at: string
  delivery: BackupDelivery
  schemaVersion: number
  bytes: number
  songs: number
  trash: number
  setlists: number
  fingerprint: string
  /** Settings in the file (#257 F3); absent on statuses written before it existed. */
  settingsFingerprint?: string
}
type Store = Pick<Storage, 'getItem' | 'setItem'>
const defaultStore = (): Store | null => { try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null } }

export function readBackupStatus(storage: Pick<Storage, 'getItem'> | null = defaultStore()): BackupStatus | null {
  try {
    const value = JSON.parse(storage?.getItem(BACKUP_STATUS_KEY) ?? 'null') as Partial<BackupStatus> | null
    if (!value || value.v !== 1 || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at)) ||
      !['share', 'download', 'copy'].includes(String(value.delivery)) || typeof value.fingerprint !== 'string') return null
    for (const field of ['schemaVersion', 'bytes', 'songs', 'trash', 'setlists'] as const) if (!Number.isSafeInteger(value[field])) return null
    if (value.settingsFingerprint !== undefined && typeof value.settingsFingerprint !== 'string') return null
    return value as BackupStatus
  } catch { return null }
}

/** Best effort: a status write failure never affects the backup itself. */
export function recordBackupStatus(
  backup: { bytes: number; counts: { songs: number; trash: number; setlists: number }; fingerprint: string; settingsFingerprint?: string; schemaVersion: number },
  delivery: BackupDelivery, storage: Store | null = defaultStore(), now = new Date(),
): BackupStatus | null {
  const status: BackupStatus = { v: 1, at: now.toISOString(), delivery, schemaVersion: backup.schemaVersion, bytes: backup.bytes,
    songs: backup.counts.songs, trash: backup.counts.trash, setlists: backup.counts.setlists, fingerprint: backup.fingerprint,
    ...(backup.settingsFingerprint ? { settingsFingerprint: backup.settingsFingerprint } : {}) }
  try { storage?.setItem(BACKUP_STATUS_KEY, JSON.stringify(status)); return status } catch { return null }
}
