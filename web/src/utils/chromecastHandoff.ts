import type { Cast2Client } from './stageCast2Client'

export const CHROMECAST_NAMESPACE = 'urn:x-cast:com.gtar.pairing.v1'
const opaque = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

export type ChromecastHandoff = { version: 1; type: 'PAIR'; nonce: string; ref: string; pin: string; expiresAt: number } |
  { version: 1; type: 'PAIRED'; nonce: string; ref: string }

/** Exact, small schema: no credentials, URLs, presentation content or arbitrary fields. */
export function parseChromecastHandoff(input: unknown, nonce: string, now: number): ChromecastHandoff | null {
  try {
    if (typeof input === 'string' && input.length > 512) return null
    const value = typeof input === 'string' ? JSON.parse(input) : input
    if (!value || value.version !== 1 || !opaque(nonce) || value.nonce !== nonce || !opaque(value.ref)) return null
    const keys = Object.keys(value).sort().join(',')
    if (value.type === 'PAIRED' && keys === 'nonce,ref,type,version') return value
    if (value.type !== 'PAIR' || keys !== 'expiresAt,nonce,pin,ref,type,version' ||
      typeof value.pin !== 'string' || !/^\d{6}$/.test(value.pin) || !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= now || value.expiresAt > now + 120_000) return null
    return value
  } catch { return null }
}

export interface ChromecastReceiverContext {
  addCustomMessageListener(namespace: string, listener: (event: { senderId: string; data: unknown }) => void): void
  removeCustomMessageListener(namespace: string, listener: (event: { senderId: string; data: unknown }) => void): void
  sendCustomMessage(namespace: string, senderId: string, message: ChromecastHandoff): void
  start(options: { disableIdleTimeout: boolean; customNamespaces: Record<string, string> }): void
}

/** Cast transports possession pairing only. Cast2 owns authorization, expiry and synchronization. */
export function attachChromecastReceiver(context: ChromecastReceiverContext, client: Cast2Client) {
  let sender = '', disposed = false
  let pending = false
  const listener = (event: { senderId: string; data: unknown }) => {
    const message = event.data as { version?: unknown; type?: unknown; nonce?: unknown } | null
    if (!message || message.version !== 1 || message.type !== 'HELLO' || !opaque(message.nonce) ||
      Object.keys(message).sort().join(',') !== 'nonce,type,version' || !event.senderId || (sender && sender !== event.senderId) || pending) return
    sender = event.senderId
    const nonce = message.nonce
    pending = true
    void (async () => {
      if (disposed) return
      if (['IDLE', 'ENDED', 'EXPIRED', 'REVOKED', 'ERROR', 'REPLACED'].includes(client.view.state)) {
        client.dispose()
        await client.start()
      }
      if (disposed) return
      const view = client.view
      if (view.pin && view.pairingExpiresAt > Date.now()) {
        context.sendCustomMessage(CHROMECAST_NAMESPACE, sender, { version: 1, type: 'PAIR', nonce,
          ref: view.ref, pin: view.pin, expiresAt: view.pairingExpiresAt })
      } else if (['CONNECTED', 'PAIRED', 'DISCONNECTED'].includes(view.state)) {
        context.sendCustomMessage(CHROMECAST_NAMESPACE, sender, { version: 1, type: 'PAIRED', nonce, ref: view.ref })
      }
    })().catch(() => { /* Sender timeout provides a bounded recovery action. */ }).finally(() => { pending = false })
  }
  context.addCustomMessageListener(CHROMECAST_NAMESPACE, listener)
  // Non-media presenter: keep the application alive while Cast2 performs its own expiry checks.
  context.start({ disableIdleTimeout: true, customNamespaces: { [CHROMECAST_NAMESPACE]: 'JSON' } })
  return () => { disposed = true; context.removeCustomMessageListener(CHROMECAST_NAMESPACE, listener) }
}
