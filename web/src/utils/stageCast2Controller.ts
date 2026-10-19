import { Cast2Client, type Cast2View } from './stageCast2Client'
import { cast2LocalEnabled } from './stageCast2Local'
import { validSession, hasServerApproval, type GoogleSession } from './googleAuth'
import { stageCast, type StageCastState } from './stageCast'
import { projectCast2Presentation } from './stageCast2Projection'

export class StageCast2ControllerManager {
  private client: Cast2Client | null = null
  private session: GoogleSession | null = null
  private chords = false
  private timer: ReturnType<typeof setInterval> | null = null
  private clock: ReturnType<typeof setInterval> | null = null
  private unsubProjection: (() => void) | null = null
  private listeners = new Set<() => void>()
  private now = Date.now()

  constructor() {
    stageCast.registerStopHandler(() => {
      void this.end()
    })
  }

  public setSession(session: GoogleSession | null) {
    this.session = session
    if (this.client && !session && this.client.view.ref) {
      void this.end()
    }
  }

  public getSession(): GoogleSession | null {
    return this.session
  }

  public getClient(): Cast2Client {
    if (!this.client) {
      this.client = this.createClient()
      this.ensureRunning()
    }
    return this.client
  }

  private createClient(): Cast2Client {
    return new Cast2Client(
      'controller',
      {
        now: () => Date.now(),
        post: async (path, data, controller) => {
          if (!cast2LocalEnabled) throw Error('DISABLED')
          const session = this.session
          if (controller && (!validSession(session) || !hasServerApproval(session) || !session?.sessionToken)) {
            throw Error('AUTH_REQUIRED')
          }
          const response = await fetch('/cast2-api' + path, {
            method: 'POST',
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            signal: AbortSignal.timeout(8000),
            headers: {
              'Content-Type': 'application/json',
              ...(controller && session?.sessionToken ? { Authorization: `Bearer ${session.sessionToken}` } : {}),
            },
            body: JSON.stringify(data),
          })
          const result = await response.json()
          if (!response.ok) {
            throw Error(['DENIED', 'AUTH_REQUIRED', 'DISABLED'].includes(result.error) ? result.error : 'UNAVAILABLE')
          }
          return result
        },
        socket: (ticket) => {
          const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
          const url = new URL('/cast2-api/socket', origin)
          url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
          return new WebSocket(url, ['cast2', 'ticket.' + ticket])
        },
      },
      (view) => {
        const isConnected = view.state === 'CONNECTED'
        stageCast.setCast2Connected(isConnected)
        this.notify()
      }
    )
  }

  public ensureRunning() {
    if (!this.timer && typeof window !== 'undefined') {
      this.timer = setInterval(() => {
        if (this.client) void this.client.tick()
      }, 5000);
      if (typeof this.timer?.unref === 'function') this.timer.unref()
    }
    if (!this.clock && typeof window !== 'undefined') {
      this.clock = setInterval(() => {
        this.now = Date.now()
        this.notify()
      }, 1000);
      if (typeof this.clock?.unref === 'function') this.clock.unref()
    }
    if (!this.unsubProjection) {
      let pending: ReturnType<typeof setTimeout> | undefined
      let latestState: StageCastState | null = null
      let latestScroll: { scrollTop: number; scrollFraction: number } | null = null

      this.unsubProjection = stageCast.subscribeProjection((state, scroll) => {
        latestState = state
        latestScroll = scroll
        if (pending) return
        pending = setTimeout(() => {
          pending = undefined
          if (!latestState || !this.client) return
          const projected = projectCast2Presentation(latestState, {
            lineIndex: 0,
            scrollTop: latestScroll?.scrollTop ?? 0,
            scrollFraction: latestScroll?.scrollFraction ?? 0,
            chordsVisible: this.chords,
          })
          if (projected.ok) {
            this.client.publish(projected.value)
          }
        }, 150)
      })
    }
  }

  public async start(ref: string, pin: string) {
    const client = this.getClient()
    client.dispose()
    this.ensureRunning()
    await client.start(ref, pin)
    this.notify()
  }

  public async end() {
    if (this.client) {
      await this.client.end()
      stageCast.setCast2Connected(false)
      this.notify()
    }
  }

  public setChords(visible: boolean) {
    this.chords = visible
    const cached = stageCast.getCachedState()
    if (cached && this.client) {
      const projected = projectCast2Presentation(cached, {
        lineIndex: 0,
        scrollTop: 0,
        scrollFraction: 0,
        chordsVisible: visible,
      })
      if (projected.ok) {
        this.client.publish(projected.value)
      }
    }
    this.notify()
  }

  public getChords(): boolean {
    return this.chords
  }

  public getView(): Cast2View {
    return this.getClient().view
  }

  public getNow(): number {
    return this.now
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch { /* best effort */ }
    }
  }

  public resetForTesting() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    if (this.clock) { clearInterval(this.clock); this.clock = null }
    if (this.unsubProjection) { this.unsubProjection(); this.unsubProjection = null }
    if (this.client) { this.client.dispose(); this.client = null }
    this.session = null
    this.chords = false
    stageCast.setCast2Connected(false)
  }
}

export const stageCast2Controller = new StageCast2ControllerManager()
