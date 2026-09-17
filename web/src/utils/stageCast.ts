/**
 * Stage Cast & Secondary Screen Projection Synchronization Engine
 * Mirrors stage state (song, key, transpose, scroll position, fonts, theme)
 * to secondary displays, Chromecasts, TVs, or external teleprompter popouts.
 */

import type { ActiveSongState } from '../types/gtar'
import { appLogger } from './logger'
import { isIosDevice, isStandalonePwa } from './stagePerformance'

export interface PresentationCapabilities {
  supportsPresentationApi: boolean
  supportsMultiWindow: boolean
  canDirectPresent: boolean
  recommendedMode: 'presentation_api' | 'popup_window' | 'tv_pairing'
  platform: 'ios' | 'desktop' | 'mobile_touch' | 'unknown'
  reason?: string
}

export interface PresentationRequestResult {
  success: boolean
  mode: 'presentation_api' | 'popup_window' | 'tv_pairing' | 'cancelled' | 'error'
  window?: Window | null
  error?: string
}

/**
 * Platform and capability detector for stage presentation routing.
 * Evaluates W3C Presentation API, multi-window popup capability, and platform constraints.
 * Ensures iOS/single-screen devices do not blindly open local popups that obscure stage controls.
 */
export function getPresentationCapabilities(): PresentationCapabilities {
  if (typeof window === 'undefined') {
    return {
      supportsPresentationApi: false,
      supportsMultiWindow: false,
      canDirectPresent: false,
      recommendedMode: 'tv_pairing',
      platform: 'unknown',
      reason: 'WINDOW_UNDEFINED_SSR',
    }
  }

  // 1. Capability: W3C Presentation API (Chromecast, Miracast, Google Cast, Smart TVs)
  const supportsPresentationApi =
    'PresentationRequest' in window &&
    typeof (window as unknown as WindowWithPresentationRequest).PresentationRequest === 'function'

  // 2. Capability: iOS platform detection (WebKit environment)
  const isIos = isIosDevice()

  // 3. Capability: Multi-window / multi-display popup support
  const isStandalone = isStandalonePwa()
  const touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0
  const isTouchDevice =
    touchPoints > 0 || (typeof window !== 'undefined' && 'ontouchstart' in window)
  const hasMultiScreenApi =
    typeof screen !== 'undefined' && Boolean((screen as unknown as { isExtended?: boolean }).isExtended)

  // Multi-window popup is safe on desktop where windows can be dragged to secondary displays/projectors.
  // It is UNSAFE on iOS (WebKit replaces or tabs active view) and standalone mobile PWAs.
  const supportsMultiWindow =
    typeof window.open === 'function' &&
    !isIos &&
    !isStandalone &&
    (!isTouchDevice || hasMultiScreenApi)

  const canDirectPresent = supportsPresentationApi || supportsMultiWindow

  let recommendedMode: 'presentation_api' | 'popup_window' | 'tv_pairing' = 'tv_pairing'
  let platform: PresentationCapabilities['platform'] = 'desktop'

  if (isIos) {
    platform = 'ios'
    recommendedMode = supportsPresentationApi ? 'presentation_api' : 'tv_pairing'
  } else if (supportsPresentationApi) {
    recommendedMode = 'presentation_api'
    platform = isTouchDevice ? 'mobile_touch' : 'desktop'
  } else if (supportsMultiWindow) {
    recommendedMode = 'popup_window'
    platform = 'desktop'
  } else {
    platform = isTouchDevice ? 'mobile_touch' : 'unknown'
    recommendedMode = 'tv_pairing'
  }

  return {
    supportsPresentationApi,
    supportsMultiWindow,
    canDirectPresent,
    recommendedMode,
    platform,
    reason: isIos
      ? 'IOS_WEBKIT_NO_MULTIWINDOW_PRESENTATION'
      : !canDirectPresent
      ? 'NO_DIRECT_PRESENTATION_TRANSPORT'
      : undefined,
  }
}

export interface StageCastState {
  song: ActiveSongState
  effectiveKey: string
  transposeOffset: number
  fontSizePx: number
  fontStyle: 'mono' | 'sans' | 'serif'
  isTwoColumn: boolean
  chordScale?: number
  fontWeight?: 'regular' | 'medium' | 'bold'
  lineSpacing?: 'compact' | 'normal' | 'relaxed'
  themeMode?: string
  customThemeColors?: {
    bgHex: string
    textHex: string
    chordHex: string
    sectionHex: string
  }
}

export type StageCastMessage =
  | { type: 'STATE_UPDATE'; payload: StageCastState }
  | { type: 'SCROLL_UPDATE'; payload: { scrollTop: number; scrollFraction: number } }
  | { type: 'REQUEST_STATE' }

export interface PresentationConnection extends EventTarget {
  id: string
  state: 'connecting' | 'connected' | 'closed' | 'terminated'
  send(data: string | Blob | ArrayBuffer | ArrayBufferView): void
  close(): void
  terminate(): void
  onmessage: ((this: PresentationConnection, ev: MessageEvent) => void) | null
  onconnect: ((this: PresentationConnection, ev: Event) => void) | null
  onclose: ((this: PresentationConnection, ev: Event) => void) | null
  onterminate: ((this: PresentationConnection, ev: Event) => void) | null
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void, options?: boolean | AddEventListenerOptions): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: 'message', listener: (ev: MessageEvent) => void, options?: boolean | EventListenerOptions): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void
}

export interface PresentationConnectionAvailableEvent extends Event {
  connection: PresentationConnection
}

export function isPresentationConnectionAvailableEvent(
  evt: Event
): evt is PresentationConnectionAvailableEvent {
  return 'connection' in evt && Boolean((evt as PresentationConnectionAvailableEvent).connection)
}

export interface PresentationConnectionList extends EventTarget {
  connections: PresentationConnection[]
  onconnectionavailable: ((this: PresentationConnectionList, ev: PresentationConnectionAvailableEvent) => void) | null
  addEventListener(type: 'connectionavailable', listener: (evt: PresentationConnectionAvailableEvent) => void, options?: boolean | AddEventListenerOptions): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void
}

export interface PresentationReceiver {
  connectionList: Promise<PresentationConnectionList>
}

export interface PresentationRequest {
  start(): Promise<PresentationConnection>
  reconnect(presentationId: string): Promise<PresentationConnection>
  getAvailability(): Promise<{ value: boolean; onchange: ((this: unknown, ev: Event) => void) | null }>
}

export interface Presentation {
  defaultRequest?: PresentationRequest | null
  receiver?: PresentationReceiver | null
}

export interface NavigatorWithPresentation extends Navigator {
  presentation?: Presentation
}

export interface WindowWithPresentationRequest extends Window {
  PresentationRequest: new (urls: string[]) => PresentationRequest
}

const CHANNEL_NAME = 'gtar_stage_cast'
const STORAGE_KEY = 'gtar_stage_cast_state'

class StageCastEngine {
  private channel: BroadcastChannel | null = null
  private popupWindow: Window | null = null
  private presentationConnection: PresentationConnection | null = null
  private lastState: StageCastState | null = null
  private lastScroll: { scrollTop: number; scrollFraction: number } | null = null
  private sessionListeners: Set<(isActive: boolean) => void> = new Set()
  private sessionId: string | null = null
  private windowCheckTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel(CHANNEL_NAME)
      } catch (err) {
        console.warn('BroadcastChannel not supported in this environment:', err)
      }
    }
  }

  public getPresentationCapabilities(): PresentationCapabilities {
    return getPresentationCapabilities()
  }

  /**
   * Retrieves or initializes a safe, ephemeral presentation session code.
   * Format: GTAR-XXXX (alphanumeric, no sensitive data or library state).
   */
  public getPresentationSessionId(): string {
    if (this.sessionId) return this.sessionId
    if (typeof window !== 'undefined') {
      try {
        const stored = sessionStorage.getItem('gtar_cast_session_id')
        if (stored && stored.length >= 4) {
          this.sessionId = stored
          return stored
        }
      } catch {}
    }
    const code = Math.random().toString(36).substring(2, 6).toUpperCase()
    this.sessionId = `GTAR-${code}`
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('gtar_cast_session_id', this.sessionId)
      } catch {}
    }
    return this.sessionId
  }

  /**
   * Generates a safe pairing URL for secondary TV browser teleprompter display.
   * Strictly adheres to guards: NO song content in URL, NO long-lived secrets in URL,
   * NO cloud storage requirement.
   */
  public getPresentationPairingUrl(hostOverride?: string): string {
    const sessionId = this.getPresentationSessionId()
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
    let baseOrigin = origin
    if (hostOverride && hostOverride.trim()) {
      const cleanHost = hostOverride.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
      const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:'
      baseOrigin = `${protocol}//${cleanHost}`
    }
    return `${baseOrigin}/stage/present?view=present&session=${encodeURIComponent(sessionId)}`
  }

  public isPresentationActive(): boolean {
    const isConnActive =
      this.presentationConnection != null &&
      (this.presentationConnection.state === 'connected' ||
        this.presentationConnection.state === 'connecting')

    const isPopupActive = this.popupWindow != null && !this.popupWindow.closed
    return Boolean(isConnActive || isPopupActive)
  }

  public subscribeSessionState(listener: (isActive: boolean) => void): () => void {
    this.sessionListeners.add(listener)
    listener(this.isPresentationActive())
    return () => {
      this.sessionListeners.delete(listener)
    }
  }

  private notifySessionChange() {
    const active = this.isPresentationActive()
    for (const listener of this.sessionListeners) {
      try {
        listener(active)
      } catch {}
    }
  }

  public setPopupWindow(win: Window | null) {
    this.popupWindow = win
    this.notifySessionChange()
  }

  public getCachedState(): StageCastState | null {
    if (this.lastState) return this.lastState
    if (typeof window === 'undefined') return null
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        return JSON.parse(raw) as StageCastState
      }
    } catch {}
    return null
  }

  public broadcastState(state: StageCastState) {
    this.lastState = state
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {}

    const msg: StageCastMessage = { type: 'STATE_UPDATE', payload: state }

    if (this.channel) {
      try {
        this.channel.postMessage(msg)
      } catch (err) {
        console.error('Failed to post to stageCast channel:', err)
      }
    }

    if (this.popupWindow && !this.popupWindow.closed) {
      try {
        this.popupWindow.postMessage({ source: 'GTAR_CAST', message: msg }, '*')
      } catch {}
    }

    if (this.presentationConnection && this.presentationConnection.state === 'connected') {
      try {
        this.presentationConnection.send(JSON.stringify({ source: 'GTAR_CAST', message: msg }))
      } catch (err) {
        appLogger.warn('StageCast', `Failed to send state over PresentationConnection: ${err}`)
      }
    }
  }

  public broadcastScroll(scrollTop: number, scrollFraction: number) {
    this.lastScroll = { scrollTop, scrollFraction }
    const msg: StageCastMessage = {
      type: 'SCROLL_UPDATE',
      payload: { scrollTop, scrollFraction },
    }

    if (this.channel) {
      try {
        this.channel.postMessage(msg)
      } catch {}
    }

    if (this.popupWindow && !this.popupWindow.closed) {
      try {
        this.popupWindow.postMessage({ source: 'GTAR_CAST', message: msg }, '*')
      } catch {}
    }

    if (this.presentationConnection && this.presentationConnection.state === 'connected') {
      try {
        this.presentationConnection.send(JSON.stringify({ source: 'GTAR_CAST', message: msg }))
      } catch {}
    }
  }

  public sendCurrentStateToConnection(conn: PresentationConnection) {
    if (!conn || conn.state !== 'connected') return
    const currentState = this.lastState || this.getCachedState()
    if (!currentState) return

    const fullPayload = {
      ...currentState,
      scrollTop: this.lastScroll?.scrollTop ?? 0,
      scrollFraction: this.lastScroll?.scrollFraction ?? 0,
    }

    appLogger.info(
      'StageCast',
      `Immediate state injection on connect: sending song "${currentState.song?.title || 'Unknown'}" over PresentationConnection (ID: ${conn.id || 'active'})`
    )

    try {
      conn.send(
        JSON.stringify({
          source: 'GTAR_CAST',
          type: 'STATE_UPDATE',
          payload: currentState,
          ...fullPayload,
          message: { type: 'STATE_UPDATE', payload: currentState },
        })
      )
    } catch (err) {
      appLogger.warn('StageCast', `Failed to inject state on connect: ${err}`)
    }

    if (this.lastScroll) {
      try {
        conn.send(
          JSON.stringify({
            source: 'GTAR_CAST',
            type: 'SCROLL_UPDATE',
            payload: this.lastScroll,
            message: { type: 'SCROLL_UPDATE', payload: this.lastScroll },
          })
        )
      } catch {}
    }
  }

  public requestState() {
    const msg: StageCastMessage = { type: 'REQUEST_STATE' }
    if (this.channel) {
      try {
        this.channel.postMessage(msg)
      } catch {}
    }
  }

  public stopPresentation() {
    let hadSession = false

    if (this.presentationConnection) {
      hadSession = true
      const connId = this.presentationConnection.id || 'active'
      appLogger.info('StageCast', `Explicit session cleanup: Terminating active PresentationConnection (ID: ${connId})...`)
      try {
        if (typeof this.presentationConnection.terminate === 'function') {
          this.presentationConnection.terminate()
        } else if (typeof this.presentationConnection.close === 'function') {
          this.presentationConnection.close()
        }
      } catch (err) {
        appLogger.warn('StageCast', `Error terminating PresentationConnection: ${err}`)
      }
      this.presentationConnection = null
    }

    if (this.popupWindow && !this.popupWindow.closed) {
      hadSession = true
      appLogger.info('StageCast', 'Explicit session cleanup: Closing active external presentation pop-up window...')
      try {
        this.popupWindow.close()
      } catch (err) {
        appLogger.warn('StageCast', `Error closing pop-up window: ${err}`)
      }
      this.popupWindow = null
    }

    if (this.windowCheckTimer) {
      clearInterval(this.windowCheckTimer)
      this.windowCheckTimer = null
    }

    if (hadSession) {
      appLogger.info('StageCast', 'Stage Cast presentation session has been successfully stopped and disconnected.')
    }

    this.notifySessionChange()
  }

  public async requestPresentation(): Promise<PresentationRequestResult> {
    if (typeof window === 'undefined') {
      appLogger.warn('StageCast', 'Cannot request presentation: window is undefined (SSR environment)')
      return { success: false, mode: 'error', error: 'SSR_ENVIRONMENT' }
    }

    // 1. Clean up any existing active session before requesting a new one
    if (this.isPresentationActive()) {
      appLogger.info('StageCast', 'Active presentation session detected. Cleaning up and terminating previous session before starting new one...')
      this.stopPresentation()
    }

    const caps = this.getPresentationCapabilities()
    const targetUrl = `${window.location.origin}/stage/present?view=present`
    const windowFeatures =
      'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no'

    appLogger.info(
      'StageCast',
      `Initiating Stage Cast presentation request (mode: ${caps.recommendedMode}, platform: ${caps.platform}). Target URL: ${targetUrl}`
    )

    // iOS and single-screen mobile devices: MUST NOT attempt local multi-window popups
    if (caps.platform === 'ios' || isIosDevice()) {
      appLogger.info('StageCast', 'iOS device detected. Local popups forbidden; routing to TV pairing path.')
      return {
        success: false,
        mode: 'tv_pairing',
        error: caps.reason || 'IOS_WEBKIT_NO_MULTIWINDOW_PRESENTATION',
      }
    }

    // 2. Try browser Presentation API if supported (Chromecast, Smart TV, Wireless Displays)
    if (caps.supportsPresentationApi) {
      try {
        appLogger.info('StageCast', 'Browser Presentation API detected. Requesting presentation display...')
        const PresentationRequestClass = (window as unknown as WindowWithPresentationRequest).PresentationRequest
        const pr = new PresentationRequestClass([targetUrl])
        const conn = await pr.start()
        this.presentationConnection = conn
        appLogger.info(
          'StageCast',
          `PresentationConnection established on external display. Connection ID: ${conn?.id || 'active'}, State: ${conn?.state}`
        )
        this.notifySessionChange()

        // Immediate state injection if already connected
        if (conn.state === 'connected') {
          this.sendCurrentStateToConnection(conn)
        }

        // Wire connection lifecycle listeners
        conn.onconnect = () => {
          appLogger.info('StageCast', `PresentationConnection connected (ID: ${conn?.id}). Injecting current stage state immediately...`)
          this.notifySessionChange()
          this.sendCurrentStateToConnection(conn)
        }
        conn.onclose = () => {
          appLogger.info('StageCast', `PresentationConnection closed (ID: ${conn?.id})`)
          this.presentationConnection = null
          this.notifySessionChange()
        }
        conn.onterminate = () => {
          appLogger.info('StageCast', `PresentationConnection terminated (ID: ${conn?.id})`)
          this.presentationConnection = null
          this.notifySessionChange()
        }
        conn.onmessage = (event: MessageEvent) => {
          try {
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
            const req = data?.message || data
            if (req?.type === 'REQUEST_STATE') {
              appLogger.info('StageCast', 'Received REQUEST_STATE from PresentationConnection. Re-injecting state...')
              this.sendCurrentStateToConnection(conn)
            }
          } catch {}
        }

        return { success: true, mode: 'presentation_api' }
      } catch (err: unknown) {
        const error = err instanceof Error ? err : null
        if (error?.name === 'AbortError' || error?.name === 'NotAllowedError') {
          appLogger.info('StageCast', 'Presentation request cancelled by user (picker closed).')
          return { success: false, mode: 'cancelled' }
        }
        appLogger.warn(
          'StageCast',
          `Presentation API request failed (${error?.message || 'unknown'}). Evaluating platform fallback...`
        )
        if (caps.supportsMultiWindow) {
          appLogger.info('StageCast', 'Desktop multi-window fallback supported. Opening pop-up window...')
          const win = this.openPopupWindow(targetUrl, windowFeatures)
          return { success: Boolean(win), mode: 'popup_window', window: win }
        }

        appLogger.info('StageCast', 'Multi-window popup unsupported on this platform (e.g. iOS). Recommending secondary TV pairing path.')
        return { success: false, mode: 'tv_pairing', error: error?.message }
      }
    }

    // 3. Fallback: Check if desktop multi-window popup is supported
    if (caps.supportsMultiWindow) {
      appLogger.info('StageCast', 'Opening desktop presentation pop-up window...')
      const win = this.openPopupWindow(targetUrl, windowFeatures)
      return { success: Boolean(win), mode: 'popup_window', window: win }
    }

    // 4. iOS and single-screen mobile devices:
    // MUST NOT blindly open local window.open.
    // Return tv_pairing to route user to safe secondary TV browser pairing or AirPlay fallback.
    appLogger.info(
      'StageCast',
      `Direct presentation unsupported on ${caps.platform}. Recommending secondary TV pairing path.`
    )
    return {
      success: false,
      mode: 'tv_pairing',
      error: caps.reason || 'DIRECT_PRESENTATION_UNSUPPORTED',
    }
  }

  public async openPresentationWindow(): Promise<Window | null> {
    if (isIosDevice()) {
      return null
    }
    const res = await this.requestPresentation()
    return res.window || null
  }

  private openPopupWindow(targetUrl: string, windowFeatures: string): Window | null {
    if (isIosDevice()) {
      appLogger.warn('StageCast', 'Blocked window.open presentation popup on iOS device.')
      return null
    }
    try {
      appLogger.info('StageCast', `Opening fallback presentation pop-up window: ${targetUrl}`)
      const win = window.open(targetUrl, 'gtar_stage_teleprompter', windowFeatures)
      if (win) {
        win.focus()
        this.setPopupWindow(win)
        this.monitorWindowLifecycle(win)
        this.notifySessionChange()
        appLogger.info('StageCast', 'External stage teleprompter pop-up window opened and focused successfully.')

        // Immediately inject state into popup once loaded
        const currentState = this.lastState || this.getCachedState()
        if (currentState) {
          const injectPopupState = () => {
            try {
              if (win && !win.closed) {
                win.postMessage(
                  {
                    source: 'GTAR_CAST',
                    message: { type: 'STATE_UPDATE', payload: currentState },
                  },
                  '*'
                )
                if (this.lastScroll) {
                  win.postMessage(
                    {
                      source: 'GTAR_CAST',
                      message: { type: 'SCROLL_UPDATE', payload: this.lastScroll },
                    },
                    '*'
                  )
                }
              }
            } catch {}
          }
          setTimeout(injectPopupState, 150)
          setTimeout(injectPopupState, 600)
        }
        return win
      } else {
        appLogger.warn('StageCast', 'window.open returned null: The browser popup blocker may be blocking the external stage window.')
        this.notifySessionChange()
        return null
      }
    } catch (openErr) {
      appLogger.error('StageCast', 'Unexpected error opening presentation popup window', openErr as Error)
      this.notifySessionChange()
      return null
    }
  }

  private monitorWindowLifecycle(win: Window) {
    if (this.windowCheckTimer) {
      clearInterval(this.windowCheckTimer)
      this.windowCheckTimer = null
    }
    try {
      this.windowCheckTimer = setInterval(() => {
        try {
          if (win.closed) {
            if (this.windowCheckTimer) {
              clearInterval(this.windowCheckTimer)
              this.windowCheckTimer = null
            }
            this.setPopupWindow(null)
            appLogger.info('StageCast', 'External presentation pop-up window closed by user.')
            this.notifySessionChange()
          }
        } catch {
          if (this.windowCheckTimer) {
            clearInterval(this.windowCheckTimer)
            this.windowCheckTimer = null
          }
        }
      }, 1500)
      if (this.windowCheckTimer && typeof (this.windowCheckTimer as any).unref === 'function') {
        ;(this.windowCheckTimer as any).unref()
      }
    } catch {}
  }

  public subscribe(
    onState: (state: StageCastState) => void,
    onScroll: (scrollTop: number, scrollFraction: number) => void,
    onRequestState?: () => void
  ): () => void {
    const handleMessage = (rawData: unknown) => {
      let msg: unknown = rawData
      if (typeof rawData === 'string') {
        try {
          msg = JSON.parse(rawData)
        } catch {
          return
        }
      }
      if (!msg || typeof msg !== 'object') return

      const obj = msg as Record<string, unknown>
      const inner =
        obj.source === 'GTAR_CAST' && obj.message && typeof obj.message === 'object'
          ? (obj.message as Record<string, unknown>)
          : obj

      if (inner.type === 'STATE_UPDATE' && inner.payload && typeof inner.payload === 'object') {
        onState(inner.payload as StageCastState)
      } else if (inner.type === 'SCROLL_UPDATE' && inner.payload && typeof inner.payload === 'object') {
        const p = inner.payload as { scrollTop?: number; scrollFraction?: number }
        onScroll(p.scrollTop || 0, p.scrollFraction || 0)
      } else if (inner.type === 'REQUEST_STATE' && onRequestState) {
        onRequestState()
      } else if (inner.song && typeof inner.song === 'object') {
        const song = inner.song as ActiveSongState
        if (song.rawContent || song.title) {
          // Direct stage state payload
          onState({
            song,
            effectiveKey: typeof inner.effectiveKey === 'string' ? inner.effectiveKey : (song.key || 'C'),
            transposeOffset: typeof inner.transposeOffset === 'number' ? inner.transposeOffset : 0,
            fontSizePx: typeof inner.fontSizePx === 'number' ? inner.fontSizePx : 28,
            fontStyle: inner.fontStyle === 'sans' ? 'sans' : 'mono',
            isTwoColumn: Boolean(inner.isTwoColumn),
            chordScale: typeof inner.chordScale === 'number' ? inner.chordScale : undefined,
            fontWeight: inner.fontWeight as StageCastState['fontWeight'],
            lineSpacing: inner.lineSpacing as StageCastState['lineSpacing'],
            themeMode: typeof inner.themeMode === 'string' ? inner.themeMode : undefined,
            customThemeColors: inner.customThemeColors as StageCastState['customThemeColors'],
          })
          if (typeof inner.scrollFraction === 'number') {
            onScroll(typeof inner.scrollTop === 'number' ? inner.scrollTop : 0, inner.scrollFraction)
          }
        }
      }
    }

    const channelListener = (e: MessageEvent) => {
      handleMessage(e.data)
    }

    const windowListener = (e: MessageEvent) => {
      if (e.data && e.data.source === 'GTAR_CAST' && e.data.message) {
        handleMessage(e.data.message)
      } else {
        handleMessage(e.data)
      }
    }

    const storageListener = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue)
          if (parsed && typeof parsed === 'object') {
            handleMessage({ type: 'STATE_UPDATE', payload: parsed })
          }
        } catch {}
      }
    }

    if (this.channel) {
      this.channel.addEventListener('message', channelListener)
    }
    window.addEventListener('message', windowListener)
    window.addEventListener('storage', storageListener)

    // Presentation API Receiver listener (Secondary screen / TV receiver side)
    let receiverCleanup: (() => void) | null = null
    const navWithPresentation = typeof navigator !== 'undefined' ? (navigator as NavigatorWithPresentation) : null
    if (navWithPresentation?.presentation?.receiver) {
      const receiver = navWithPresentation.presentation.receiver
      if (receiver.connectionList) {
        receiver.connectionList
          .then((list: PresentationConnectionList) => {
            const listenToConn = (conn: PresentationConnection) => {
              const onMsg = (event: Event) => {
                if ('data' in event) {
                  handleMessage((event as MessageEvent).data)
                }
              }
              conn.addEventListener('message', onMsg)
              try {
                conn.send(JSON.stringify({ type: 'REQUEST_STATE', source: 'GTAR_CAST' }))
              } catch {}
            }
            list.connections.forEach((conn: PresentationConnection) => listenToConn(conn))
            const onAvail = (evt: Event) => {
              if (isPresentationConnectionAvailableEvent(evt)) {
                listenToConn(evt.connection)
              }
            }
            list.addEventListener('connectionavailable', onAvail)
            receiverCleanup = () => {
              list.removeEventListener('connectionavailable', onAvail)
            }
          })
          .catch(() => {})
        }
    }

    return () => {
      if (this.channel) {
        this.channel.removeEventListener('message', channelListener)
      }
      window.removeEventListener('message', windowListener)
      window.removeEventListener('storage', storageListener)
      if (receiverCleanup) {
        receiverCleanup()
      }
    }
  }
}

export const stageCast = new StageCastEngine()
