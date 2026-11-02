/** #304: opens the "Recovery data" panel (rendered by App). */
export const OPEN_RECOVERY_DATA_EVENT = 'gtar-open-recovery-data'
export function openRecoveryData() {
  window.dispatchEvent(new Event(OPEN_RECOVERY_DATA_EVENT))
}
