import { isRoomCode } from './bandSyncProtocol'

/** A join link grants follower access only; never accept a credential/ticket-shaped value. */
export function parseBandSyncQr(value: string, origin: string): string | null {
  try {
    const url = new URL(value), hash = new URLSearchParams(url.hash.slice(1)), code = hash.get('bandsync')
    return url.origin === origin && url.pathname === '/' && !url.search && !url.username && !url.password &&
      [...hash.keys()].length === 1 && isRoomCode(code) ? code : null
  } catch { return null }
}
export function bandSyncJoinUrl(origin: string, code: string): string {
  if (!isRoomCode(code) || new URL(origin).origin !== origin) throw Error('Invalid room code')
  return `${origin}/#bandsync=${code}`
}
export async function createBandSyncQr(origin: string, code: string): Promise<string> {
  const url = bandSyncJoinUrl(origin, code)
  const qr = await import('qrcode')
  return qr.toDataURL(url, { width: 280, margin: 4, errorCorrectionLevel: 'M' })
}
/** Called once at host boot. OFF discards the code; every Band Sync hash is scrubbed before activation. */
export function consumeBandSyncHash(location: Pick<Location, 'href' | 'origin' | 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'state' | 'replaceState'>, enabled: boolean): string | null {
  if (!new URLSearchParams(location.hash.slice(1)).has('bandsync')) return null
  const code = parseBandSyncQr(location.href, location.origin)
  history.replaceState(history.state, '', location.pathname + location.search)
  return enabled ? code : null
}
