/**
 * #251 Cloud V2 P0: what this device knows about its last backup, and when to remind.
 *
 * GTAR can only know that it created a verified backup file and handed it to the share sheet,
 * the browser's downloads or the clipboard. It cannot see whether the file was saved in Files,
 * iCloud Drive, Google Drive or OneDrive, so nothing here claims that. Only counts, sizes and a
 * content fingerprint are kept (no song content, no account data). Device state: never part of
 * a backup, never uploaded.
 */
export const BACKUP_STATUS_KEY = 'gtar_backup_status_v1'
export const BACKUP_REMINDER_KEY = 'gtar_backup_reminder_v1'

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
export interface BackupReminderSettings { enabled: boolean; intervalDays: number }
export const BACKUP_REMINDER_INTERVALS = [7, 14, 30] as const
export const DEFAULT_BACKUP_REMINDER: BackupReminderSettings = { enabled: true, intervalDays: 14 }
/** A library this much larger or smaller (songs + setlists) than the last backup is a substantial change. */
export const BACKUP_REMINDER_COUNT_DELTA = 25
const DAY_MS = 24 * 60 * 60 * 1000

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

export function readBackupReminder(storage: Pick<Storage, 'getItem'> | null = defaultStore()): BackupReminderSettings {
  try {
    const value = JSON.parse(storage?.getItem(BACKUP_REMINDER_KEY) ?? 'null') as Partial<BackupReminderSettings> | null
    if (value && typeof value.enabled === 'boolean' && (BACKUP_REMINDER_INTERVALS as readonly number[]).includes(value.intervalDays as number)) {
      return { enabled: value.enabled, intervalDays: value.intervalDays as number }
    }
  } catch { /* defaults */ }
  return { ...DEFAULT_BACKUP_REMINDER }
}
export function saveBackupReminder(settings: BackupReminderSettings, storage: Store | null = defaultStore()): void {
  try { storage?.setItem(BACKUP_REMINDER_KEY, JSON.stringify(settings)) } catch { /* preference only */ }
}

export type BackupReminderReason = 'never' | 'stale' | 'changed'
export interface BackupReminder { due: boolean; reason?: BackupReminderReason; daysSince?: number }

/**
 * Whether to show a non-blocking reminder. `fingerprint` is computed only when needed (it reads
 * the whole library). Never: library has songs and no backup was made on this device. Stale: the
 * interval passed and the library changed since. Changed: song + setlist count moved a lot.
 */
export function backupReminderDue(
  status: BackupStatus | null, library: { songs: number; trash: number; setlists: number }, fingerprint: () => string | null,
  settings: BackupReminderSettings = readBackupReminder(), now = Date.now(),
): BackupReminder {
  if (!settings.enabled) return { due: false }
  if (!status) return library.songs + library.trash > 0 ? { due: true, reason: 'never' } : { due: false }
  const daysSince = Math.max(0, Math.floor((now - Date.parse(status.at)) / DAY_MS))
  const delta = Math.abs((library.songs + library.trash + library.setlists) - (status.songs + status.trash + status.setlists))
  if (delta >= BACKUP_REMINDER_COUNT_DELTA) return { due: true, reason: 'changed', daysSince }
  if (daysSince >= settings.intervalDays) {
    const current = (() => { try { return fingerprint() } catch { return null } })()
    if (current === null || current !== status.fingerprint) return { due: true, reason: 'stale', daysSince }
  }
  return { due: false, daysSince }
}

export function backupReminderMessage(reminder: BackupReminder): string | null {
  if (!reminder.due) return null
  if (reminder.reason === 'never') return 'No backup saved from this device yet. Open Backup & Restore to save a backup file.'
  if (reminder.reason === 'changed') return 'Your library changed a lot since the last backup. Open Backup & Restore to save a new backup file.'
  return `Last backup was ${reminder.daysSince} days ago and your library changed since. Open Backup & Restore to save a new backup file.`
}

export const DELIVERY_LABEL: Record<BackupDelivery, string> = {
  share: 'sent to the share sheet',
  download: 'handed to browser downloads',
  copy: 'copied to the clipboard',
}
