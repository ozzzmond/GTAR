import { CHROMECAST_NAMESPACE, parseChromecastHandoff } from './chromecastHandoff'
import { loadChromecastSender, type ChromecastContext, type ChromecastSession } from './chromecastSdk'
import { stageCast2Controller } from './stageCast2Controller'
import { cast2LocalEnabled } from './stageCast2Local'
import { chromecastAppId, configuredChromecastAppId, supportsChromecastSender } from './chromecastConfig'
import { stageCast } from './stageCast'

interface ChromecastView {
  state: 'idle' | 'ready' | 'connecting' | 'connected' | 'error' | 'unavailable'
  error: string
  device: string
  reconnect: boolean
}

export class ChromecastSender {
  private context: ChromecastContext | null = null
  private session: ChromecastSession | null = null
  private ownedRef = ''
  private epoch = 0
  private cleanupHandoff: (() => void) | null = null
  private pairing: Promise<void> | null = null
  private ending = false
  private initializing = false
  private acceptingSession = false
  private requestEpoch = 0
  private listeners = new Set<() => void>()
  private view: ChromecastView = { state: 'idle', error: '', device: '', reconnect: false }

  getView = () => this.view
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit(patch: Partial<ChromecastView>) { this.view = { ...this.view, ...patch }; for (const listener of this.listeners) listener() }

  supported() {
    if (!chromecastAppId(configuredChromecastAppId, cast2LocalEnabled) || typeof window === 'undefined') return false
    const capabilities = stageCast.getPresentationCapabilities()
    return supportsChromecastSender({ secure: window.isSecureContext, android: capabilities.isAndroid,
      presentation: capabilities.supportsPresentationApi, userAgent: navigator.userAgent, vendor: navigator.vendor })
  }

  async initialize() {
    if (!this.supported() || this.context || this.initializing || this.view.state !== 'idle') return
    this.initializing = true
    try {
      this.context = await loadChromecastSender()
      this.context.setOptions({ receiverApplicationId: configuredChromecastAppId, autoJoinPolicy: 'page_scoped', resumeSavedSession: false })
      this.context.addEventListener('caststatechanged', this.castChanged)
      this.context.addEventListener('sessionstatechanged', this.sessionChanged)
      this.castChanged()
    } catch (error) { this.emit({ state: 'unavailable', error: error instanceof Error ? error.message : 'Chromecast is unavailable.' }) }
    finally { this.initializing = false }
  }

  private castChanged = () => {
    if (!this.session && this.view.state !== 'connecting') {
      this.emit({ state: this.context?.getCastState() === 'NO_DEVICES_AVAILABLE' ? 'unavailable' : 'ready', error: '' })
    }
  }

  private sessionChanged = (event?: { sessionState?: string }) => {
    if (this.ending || (event?.sessionState && !['SESSION_STARTED', 'SESSION_RESUMED', 'SESSION_ENDED'].includes(event.sessionState))) return
    if (event?.sessionState === 'SESSION_ENDED') { void this.disconnect(); return }
    const session = this.context?.getCurrentSession() ?? null
    if (session && !this.acceptingSession) { session.endSession(true); return }
    if (session === this.session) return
    this.cleanupHandoff?.(); this.cleanupHandoff = null
    this.session = session
    if (!session) {
      this.epoch++
      this.emit({ state: 'ready', device: '', error: '' })
      return
    }
    this.beginHandoff(session)
  }

  private beginHandoff(session: ChromecastSession) {
    const epoch = ++this.epoch
    this.emit({ state: 'connecting', device: session.getCastDevice().friendlyName, error: '' })
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    let nonce = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    const cleanup = () => { clearInterval(retry); clearTimeout(timeout); session.removeMessageListener(CHROMECAST_NAMESPACE, receive) }
    const receive = (_namespace: string, input: string) => {
      if (epoch !== this.epoch || !nonce) return
      const message = parseChromecastHandoff(input, nonce, Date.now())
      if (!message) return
      nonce = '' // Consume before awaiting HTTP: duplicate/replayed replies cannot claim twice.
      cleanup(); this.cleanupHandoff = null
      this.pairing = (async () => {
        if (message.type === 'PAIR') {
          this.ownedRef = message.ref
          await stageCast2Controller.start(message.ref, message.pin)
          if (epoch !== this.epoch) return
          if (!['PAIRED', 'CONNECTED'].includes(stageCast2Controller.getView().state)) throw Error('TV pairing failed. Disconnect and reconnect Chromecast.')
        } else if (message.ref !== this.ownedRef || message.ref !== stageCast2Controller.getView().ref) {
          throw Error('TV is already paired. Disconnect Chromecast, then reconnect to create a new pairing.')
        }
        await stageCast2Controller.getClient().tick()
        if (epoch === this.epoch) this.emit({ state: 'connected', error: '', reconnect: true })
      })().catch(error => { if (epoch === this.epoch) this.emit({ state: 'error', error: error instanceof Error ? error.message : 'TV pairing failed. Reconnect Chromecast.' }) }).finally(() => { this.pairing = null })
    }
    const hello = () => { if (nonce && epoch === this.epoch) void session.sendMessage(CHROMECAST_NAMESPACE, { version: 1, type: 'HELLO', nonce }).catch(() => {}) }
    const retry = setInterval(hello, 1000)
    const timeout = setTimeout(() => {
      cleanup(); this.cleanupHandoff = null; nonce = ''
      if (epoch === this.epoch) this.emit({ state: 'error', error: 'TV did not respond. Disconnect and reconnect Chromecast.' })
    }, 15_000)
    this.cleanupHandoff = cleanup
    session.addMessageListener(CHROMECAST_NAMESPACE, receive)
    hello()
  }

  /** Called directly from a click, after SDK initialization preserves user activation. */
  async connect() {
    if (!this.context || !this.supported() || this.ending || this.view.state === 'connecting') return
    const current = stageCast2Controller.getView()
    if (current.ref && current.ref !== this.ownedRef && !['IDLE', 'ENDED', 'EXPIRED', 'REVOKED', 'REPLACED', 'ERROR'].includes(current.state)) {
      this.emit({ state: 'error', error: 'End the Browser / QR TV session before connecting Chromecast.' })
      return
    }
    this.emit({ state: 'connecting', error: '' })
    this.acceptingSession = true
    const requestEpoch = ++this.requestEpoch
    try {
      await this.context.requestSession()
      if (requestEpoch !== this.requestEpoch) return
      this.sessionChanged()
    } catch (error) {
      if (requestEpoch !== this.requestEpoch) return
      this.acceptingSession = false
      this.emit({ state: 'ready', error: error === 'cancel' ? '' : 'Chromecast could not connect. Check the TV and try again.' })
    }
  }

  async disconnect() {
    if (this.ending) return
    this.ending = true
    this.acceptingSession = false
    this.requestEpoch++
    this.epoch++
    this.cleanupHandoff?.(); this.cleanupHandoff = null
    const session = this.session
    this.session = null
    let error = ''
    try { session?.endSession(true) } catch { error = 'Chromecast could not stop. Close the receiver from the TV, then reconnect.' }
    await this.pairing
    if (this.ownedRef && stageCast2Controller.getView().ref === this.ownedRef) await stageCast2Controller.end()
    this.ownedRef = ''
    this.ending = false
    this.emit({ state: 'ready', device: '', error })
  }
}

export const chromecastSender = new ChromecastSender()
stageCast.registerStopHandler(() => { void chromecastSender.disconnect() })
