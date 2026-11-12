import type { ChromecastReceiverContext } from './chromecastHandoff'

export interface ChromecastSession {
  addMessageListener(namespace: string, listener: (namespace: string, message: string) => void): void
  removeMessageListener(namespace: string, listener: (namespace: string, message: string) => void): void
  sendMessage(namespace: string, message: object): Promise<void>
  endSession(stop: boolean): void
  getCastDevice(): { friendlyName: string }
}
export interface ChromecastContext {
  setOptions(options: { receiverApplicationId: string; autoJoinPolicy: string; resumeSavedSession: boolean }): void
  requestSession(): Promise<void>
  getCurrentSession(): ChromecastSession | null
  getCastState(): string
  addEventListener(type: string, listener: (event?: { sessionState?: string }) => void): void
  removeEventListener(type: string, listener: (event?: { sessionState?: string }) => void): void
}
export interface ChromecastWindow extends Window {
  __onGCastApiAvailable?: (available: boolean) => void
  cast?: { framework?: {
    CastContext?: { getInstance(): ChromecastContext }
    CastReceiverContext?: { getInstance(): ChromecastReceiverContext }
  } }
}

export const CHROMECAST_SENDER_SDK = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'
export const CHROMECAST_RECEIVER_SDK = 'https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js'

let senderLoading: Promise<ChromecastContext> | undefined
export function loadChromecastSender(): Promise<ChromecastContext> {
  if (senderLoading) return senderLoading
  senderLoading = new Promise<ChromecastContext>((resolve, reject) => {
    const win = window as ChromecastWindow
    const script = document.createElement('script')
    const finish = (available: boolean) => {
      clearTimeout(timeout)
      win.__onGCastApiAvailable = undefined
      const context = available && win.cast?.framework?.CastContext?.getInstance()
      if (context) resolve(context)
      else { script.remove(); reject(Error('Google Chromecast is unavailable. Use Browser / QR pairing.')) }
    }
    const timeout = setTimeout(() => finish(false), 10_000)
    win.__onGCastApiAvailable = finish
    script.src = CHROMECAST_SENDER_SDK
    script.async = true
    script.onerror = () => finish(false)
    document.head.appendChild(script)
  }).catch(error => { senderLoading = undefined; throw error })
  return senderLoading
}

export async function loadChromecastReceiver(): Promise<ChromecastReceiverContext> {
  const script = document.createElement('script')
  script.src = CHROMECAST_RECEIVER_SDK
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Chromecast receiver SDK timed out. Reconnect from the controller.')), 10_000)
    script.onload = () => { clearTimeout(timeout); resolve() }
    script.onerror = () => { clearTimeout(timeout); reject(Error('Chromecast receiver SDK could not load. Reconnect from the controller.')) }
    document.head.appendChild(script)
  })
  const context = (window as ChromecastWindow).cast?.framework?.CastReceiverContext?.getInstance()
  if (!context) throw Error('Chromecast receiver is unavailable.')
  return context
}
