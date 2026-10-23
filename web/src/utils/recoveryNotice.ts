// Recovery notice identity and startup recovery status (moved from App.tsx, #85).
import { LIBRARY_KEY, hasActionableRecovery, readPersistedLibrary, recoveryData } from './syncJournal'

export const RECOVERY_NOTICE_ACK_KEY = 'gtar_recovery_notice_ack_v1'

// Compact 128-bit content identity; never duplicate archives in acknowledgement storage.
export function recoveryNoticeFingerprint(value: string): string {
  let a = 1779033703, b = 3144134277, c = 1013904242, d = 2773480762
  for (let i = 0; i < value.length; i++) {
    const k = value.charCodeAt(i)
    a = b ^ Math.imul(a ^ k, 597399067)
    b = c ^ Math.imul(b ^ k, 2869860233)
    c = d ^ Math.imul(c ^ k, 951274213)
    d = a ^ Math.imul(d ^ k, 2716044179)
  }
  a = Math.imul(c ^ (a >>> 18), 597399067)
  b = Math.imul(d ^ (b >>> 22), 2869860233)
  c = Math.imul(a ^ (c >>> 17), 951274213)
  d = Math.imul(b ^ (d >>> 19), 2716044179)
  return `v2:${value.length}:` + [a ^ b ^ c ^ d, b ^ a, c ^ a, d ^ a]
    .map(part => (part >>> 0).toString(16).padStart(8, '0')).join('')
}

// Acknowledge this exact archive set only. New/changed sources need attention.
export const recoveryNoticeId = () => recoveryNoticeFingerprint(JSON.stringify(Object.entries(recoveryData())
  .filter(([key]) => key !== LIBRARY_KEY && key !== 'gtar_sync_library_owner')
  .sort(([a], [b]) => a.localeCompare(b))))
export const checkRecovery = () => {
  try { readPersistedLibrary(); return { retired: !hasActionableRecovery(), damaged: false, noticeId: recoveryNoticeId() } }
  catch { return { retired: false, damaged: true, noticeId: null } }
}
