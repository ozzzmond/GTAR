/** #299: opens the Backup & Restore center (owned by the header) from anywhere, e.g. Stage Settings. */
export const OPEN_BACKUP_CENTER_EVENT = 'gtar-open-backup-center'
export function openBackupCenter() {
  window.dispatchEvent(new Event(OPEN_BACKUP_CENTER_EVENT))
}
