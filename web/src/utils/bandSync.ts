import type { ActiveSongState } from '../types/gtar'
import { formatLeaderAddress, formatLeaderDisplay } from './bandSyncAddress'
export { formatLeaderAddress, formatLeaderDisplay } from './bandSyncAddress'
/**
 * GTAR Band Sync Real-time Synchronization Engine (1:1 with Android BandSyncManager)
 * Enables real-time stage sync (active song, transpose key, scroll position, and autoscroll)
 * across multiple browser windows, tablets, laptops, and stage teleprompter screens.
 */

export type BandSyncRole = 'OFF' | 'HOST' | 'CLIENT'

export interface BandSyncPayload extends Partial<ActiveSongState> {
  role?: BandSyncRole
  content?: string
  songTitle?: string
  songIndex?: number
  songId?: number
  queueType?: string
  queueIndex?: number
  setlistIndex?: number
  transpose?: number
  offset?: number
  scroll?: number
  scrollTop?: number
  scrollFraction?: number
  scrollProgress?: number
  isAutoScrolling?: boolean
  scrollSpeed?: number
  disconnecting?: boolean
  setlistName?: string
  songs?: Array<Partial<ActiveSongState>>
}

export interface BandSyncMessage {
  type: 'SONG_SYNC' | 'SCROLL_SYNC' | 'AUTOSCROLL_SYNC' | 'SETLIST_SYNC' | 'HEARTBEAT'
  senderId: string
  role: BandSyncRole
  payload: BandSyncPayload
  timestamp: number
}

export type ConnectionStatus = 'Disconnected' | 'Connecting...' | 'Connected to Leader (synced)'

export interface BandSyncState {
  role: BandSyncRole
  connectedPeers: number
  isLive: boolean
  lastMessage?: string
  wsConnected: boolean
  wsConnecting: boolean
  wsLeaderIp: string
  customHostIp: string
  detectedLanIp: string
  hasLanIp: boolean
  wsStatus: ConnectionStatus
  roomId: string
  leaderEndpoint: string
}

type SyncListener = (state: BandSyncState) => void
type MessageHandler = (msg: BandSyncMessage) => void

/**
 * Automatically attempts to detect local machine LAN IP using WebRTC ICE candidates.
 */
export async function detectLanIp(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  const legacyWindow = window as Window & { webkitRTCPeerConnection?: typeof RTCPeerConnection }
  const RTCPeer = window.RTCPeerConnection || legacyWindow.webkitRTCPeerConnection
  if (!RTCPeer) return null

  return new Promise((resolve) => {
    try {
      const pc = new RTCPeer({ iceServers: [] })
      pc.createDataChannel('')
      let resolved = false
      const finish = (ip: string | null) => {
        if (!resolved) {
          resolved = true
          try {
            pc.close()
          } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
          resolve(ip)
        }
      }

      pc.onicecandidate = (e: RTCPeerConnectionIceEvent) => {
        if (!e || !e.candidate || !e.candidate.candidate) return
        const cand = e.candidate.candidate
        // Match private IPv4 address (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
        const match = cand.match(/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})/)
        if (match && match[1]) {
          finish(match[1])
        }
      }

      pc.createOffer()
        .then((offer: RTCSessionDescriptionInit) => pc.setLocalDescription(offer))
        .catch(() => finish(null))

      setTimeout(() => finish(null), 1200)
    } catch {
      resolve(null)
    }
  })
}

export const RECENT_LEADERS_KEY = 'gtar_recent_leaders'
export const MAX_RECENT_LEADERS = 5

/**
 * Automatically prepends "ws://" and appends ":8765" if the user types raw numbers/IPs.
 */
/**
 * Retrieve recent leaders from localStorage (max 5 items, clean display format)
 */
export function getRecentLeaders(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(RECENT_LEADERS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === 'string' ? formatLeaderDisplay(item) : ''))
        .filter((item) => item.length > 0)
    }
  } catch (e) {
    console.warn('Failed to parse recent leaders:', e)
  }
  return []
}

/**
 * Save a successfully connected leader address to recent history (de-duplicated, max 5)
 */
export function saveRecentLeader(address: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const clean = formatLeaderDisplay(address)
    if (!clean) return getRecentLeaders()
    const current = getRecentLeaders()
    const updated = [clean, ...current.filter((item) => item !== clean)].slice(0, MAX_RECENT_LEADERS)
    localStorage.setItem(RECENT_LEADERS_KEY, JSON.stringify(updated))
    return updated
  } catch (e) {
    console.warn('Failed to save recent leader:', e)
    return getRecentLeaders()
  }
}

/**
 * Clear the stored recent leaders from localStorage
 */
export function clearRecentLeaders(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(RECENT_LEADERS_KEY)
  } catch (e) {
    console.warn('Failed to clear recent leaders:', e)
  }
}

class BandSyncEngine {
  private channel: BroadcastChannel | null = null
  private role: BandSyncRole = 'OFF'
  private peerId: string = Math.random().toString(36).substring(2, 9)
  private listeners: Set<SyncListener> = new Set()
  private messageHandlers: Set<MessageHandler> = new Set()
  private knownPeers: Map<string, number> = new Map()
  private heartbeatInterval: number | null = null
  private pruneInterval: number | null = null

  // Live WebSocket Connection to Android Stage Leader (port 8765)
  private ws: WebSocket | null = null
  private wsLeaderIp: string = ''
  private wsEndpoint = ''
  private wsConnected: boolean = false
  private wsConnecting: boolean = false
  private wsReconnectTimer: number | null = null
  private shouldReconnectWs: boolean = false

  private customHostIp: string = ''
  private detectedLanIp: string = ''

  constructor() {
    this.initChannel()
    if (typeof window !== 'undefined') {
      this.wsLeaderIp = localStorage.getItem('gtar_band_sync_leader_ip') || ''
      this.customHostIp = localStorage.getItem('gtar_band_sync_custom_host_ip') || ''
      detectLanIp().then((ip) => {
        if (ip) {
          this.detectedLanIp = ip
          this.notify()
        }
      })
    }
  }

  public setCustomHostIp(ip: string) {
    this.customHostIp = ip.trim()
    if (typeof window !== 'undefined') {
      localStorage.setItem('gtar_band_sync_custom_host_ip', this.customHostIp)
    }
    this.notify()
  }

  private initChannel() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel('gtar_stage_band_sync')
        this.channel.onmessage = (event) => {
          this.handleIncoming(event.data)
        }
      } catch (err) {
        console.warn('BroadcastChannel not supported, falling back to storage sync', err)
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === 'gtar_storage_sync_event' && e.newValue) {
          try {
            const parsed = JSON.parse(e.newValue)
            this.handleIncoming(parsed)
          } catch {
            // ignore
          }
        }
      })
    }
  }

  public getRole(): BandSyncRole {
    return this.role
  }

  public getState(): BandSyncState {
    const now = Date.now()
    let activeCount = 0
    this.knownPeers.forEach((lastSeen, id) => {
      if (id !== this.peerId && now - lastSeen < 4500) {
        activeCount++
      }
    })

    let status: ConnectionStatus
    if (this.wsConnected) {
      status = 'Connected to Leader (synced)'
    } else if (this.wsConnecting || this.shouldReconnectWs) {
      status = 'Connecting...'
    } else {
      status = 'Disconnected'
    }

    const browserHost =
      typeof window !== 'undefined' && window.location.hostname
        ? window.location.hostname
        : ''
    const isBrowserHostLan =
      browserHost &&
      browserHost !== 'localhost' &&
      browserHost !== '127.0.0.1' &&
      browserHost !== '::1'

    let effectiveHost: string
    let hasLanIp: boolean

    if (this.customHostIp) {
      effectiveHost = this.customHostIp
      hasLanIp = true
    } else if (isBrowserHostLan) {
      effectiveHost = browserHost
      hasLanIp = true
    } else if (this.detectedLanIp) {
      effectiveHost = this.detectedLanIp
      hasLanIp = true
    } else {
      effectiveHost = ''
      hasLanIp = false
    }

    const leaderEndpoint = hasLanIp
      ? formatLeaderAddress(effectiveHost)
      : 'ws://<SET-LAN-IP>:8765'

    return {
      role: this.role,
      connectedPeers: this.role === 'HOST' ? activeCount : this.wsConnected ? 1 : 0,
      isLive: this.role !== 'OFF',
      wsConnected: this.wsConnected,
      wsConnecting: this.wsConnecting,
      wsLeaderIp: this.wsLeaderIp,
      customHostIp: this.customHostIp,
      detectedLanIp: this.detectedLanIp,
      hasLanIp,
      wsStatus: status,
      roomId: 'gtar_stage_band_sync',
      leaderEndpoint,
    }
  }

  public connectWebSocket(leaderIp: string) {
    const formatted = formatLeaderAddress(leaderIp)
    if (!formatted) return
    const endpoint = new URL(formatted)
    this.wsLeaderIp = endpoint.hostname
    this.wsEndpoint = formatted
    if (typeof window !== 'undefined') {
      localStorage.setItem('gtar_band_sync_leader_ip', formatted)
    }

    this.shouldReconnectWs = true
    this.wsConnecting = true
    this.wsConnected = false
    this.setRole('CLIENT')
    this.initWebSocketConnection()
  }

  public disconnectWebSocket() {
    this.shouldReconnectWs = false
    this.wsConnecting = false
    this.wsConnected = false
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer)
      this.wsReconnectTimer = null
    }
    if (this.ws) {
      try {
        this.ws.close()
      } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
      this.ws = null
    }
    this.notify()
  }

  private initWebSocketConnection() {
    if (!this.shouldReconnectWs || !this.wsLeaderIp) return

    if (this.ws) {
      try {
        this.ws.close()
      } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
      this.ws = null
    }

    const wsUrl = this.wsEndpoint
    this.wsConnecting = true
    this.notify()

    try {
      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        this.wsConnected = true
        this.wsConnecting = false
        const fullHost = this.wsEndpoint
        saveRecentLeader(fullHost)
        if (typeof window !== 'undefined') {
          localStorage.setItem('gtar_band_sync_leader_ip', fullHost)
        }
        // Send join identifier
        const joinMsg = JSON.stringify({ type: 'JOIN', name: 'Web Member' })
        this.ws?.send(joinMsg)
        this.notify()
      }

      this.ws.onmessage = (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : ''
          if (!raw) return
          const data = JSON.parse(raw)
          this.handleWebSocketMessage(data)
        } catch (e) {
          console.warn('Failed to parse WebSocket message:', e)
        }
      }

      this.ws.onclose = () => {
        this.wsConnected = false
        if (this.shouldReconnectWs) {
          this.wsConnecting = true
          this.scheduleWsReconnect()
        } else {
          this.wsConnecting = false
        }
        this.notify()
      }

      this.ws.onerror = () => {
        this.wsConnected = false
        this.notify()
      }
    } catch {
      this.wsConnected = false
      if (this.shouldReconnectWs) {
        this.wsConnecting = true
        this.scheduleWsReconnect()
      } else {
        this.wsConnecting = false
      }
      this.notify()
    }
  }

  private scheduleWsReconnect() {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer)
    }
    this.wsReconnectTimer = window.setTimeout(() => {
      if (this.shouldReconnectWs) {
        this.initWebSocketConnection()
      }
    }, 2500)
  }

  private handleWebSocketMessage(input: unknown) {
    if (!input || typeof input !== 'object') return
    const data = input as BandSyncPayload & { type?: string }

    // Convert Android SyncMessage JSON to web BandSyncMessage
    if (data.type === 'SONG' || data.type === 'SONG_CHANGE') {
      const qType = (data.queueType || (data.setlistIndex !== undefined ? 'SETLIST' : 'LIBRARY')).toUpperCase()
      const qIndex = data.queueIndex ?? data.setlistIndex ?? data.songIndex ?? 0
      const transpose = data.transpose ?? data.transposeOffset ?? data.offset ?? 0
      const scrollProgress = data.scrollProgress ?? data.scroll ?? 0
      const msg: BandSyncMessage = {
        type: 'SONG_SYNC',
        senderId: 'android_leader',
        role: 'HOST',
        payload: {
          title: data.title || '',
          artist: data.artist || '',
          queueType: qType,
          queueIndex: qIndex,
          songIndex: qIndex,
          songTitle: data.title || '',
          transposeOffset: transpose,
          transpose: transpose,
          scrollProgress: scrollProgress,
          rawContent: data.content || data.rawContent || '',
          key: data.key || '',
          capo: data.capo || '',
        },
        timestamp: Date.now(),
      }
      this.dispatchSyncMessage(msg)
    } else if (data.type === 'SCROLL') {
      const scrollVal =
        typeof data.scroll === 'number'
          ? data.scroll
          : typeof data.scrollFraction === 'number'
          ? data.scrollFraction
          : typeof data.scrollProgress === 'number'
          ? data.scrollProgress
          : 0
      const msg: BandSyncMessage = {
        type: 'SCROLL_SYNC',
        senderId: 'android_leader',
        role: 'HOST',
        payload: {
          scrollFraction: scrollVal,
          scrollProgress: scrollVal,
          scroll: scrollVal,
          scrollTop: typeof data.scrollTop === 'number' ? data.scrollTop : 0,
        },
        timestamp: Date.now(),
      }
      this.dispatchSyncMessage(msg)
    } else if (data.type === 'TRANSPOSE') {
      const msg: BandSyncMessage = {
        type: 'SONG_SYNC',
        senderId: 'android_leader',
        role: 'HOST',
        payload: {
          transposeOffset: data.transposeOffset ?? data.offset ?? 0,
        },
        timestamp: Date.now(),
      }
      this.dispatchSyncMessage(msg)
    } else if (data.type === 'SETLIST_SYNC') {
      const msg: BandSyncMessage = {
        type: 'SETLIST_SYNC',
        senderId: 'android_leader',
        role: 'HOST',
        payload: {
          setlistName: data.setlistName || 'Band Setlist',
          songs: Array.isArray(data.songs) ? data.songs : [],
        },
        timestamp: Date.now(),
      }
      this.dispatchSyncMessage(msg)
    }
  }

  private dispatchSyncMessage(msg: BandSyncMessage) {
    this.messageHandlers.forEach((handler) => {
      try {
        handler(msg)
      } catch (err) {
        console.error('BandSync handler error:', err)
      }
    })
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  public onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  private notify() {
    const st = this.getState()
    this.listeners.forEach((l) => l(st))
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.broadcastMessage('HEARTBEAT', { role: this.role })
    this.heartbeatInterval = window.setInterval(() => {
      this.broadcastMessage('HEARTBEAT', { role: this.role })
    }, 1800)

    this.pruneInterval = window.setInterval(() => {
      this.notify()
    }, 2000)
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval)
      this.pruneInterval = null
    }
  }

  public setRole(newRole: BandSyncRole) {
    this.role = newRole
    if (newRole !== 'OFF') {
      this.startHeartbeat()
    } else {
      this.stopHeartbeat()
      this.disconnectWebSocket()
      this.broadcastMessage('HEARTBEAT', { role: 'OFF', disconnecting: true })
    }
    this.notify()
  }

  public broadcastMessage(type: BandSyncMessage['type'], payload: BandSyncPayload) {
    if (this.role === 'OFF') return

    const msg: BandSyncMessage = {
      type,
      senderId: this.peerId,
      role: this.role,
      payload,
      timestamp: Date.now(),
    }

    try {
      this.channel?.postMessage(msg)
    } catch {
      // ignore
    }

    try {
      localStorage.setItem('gtar_storage_sync_event', JSON.stringify(msg))
    } catch {
      // ignore
    }
  }

  // Specialized broadcast actions (used by Band Leader)
  public broadcastSong(
    songIndex: number,
    songTitle: string,
    transposeOffset: number,
    extra?: {
      artist?: string
      queueType?: 'SETLIST' | 'LIBRARY'
      scrollProgress?: number
      rawContent?: string
      key?: string
      capo?: string
      songId?: number | string
    }
  ) {
    if (this.role === 'HOST') {
      const qType = extra?.queueType || 'LIBRARY'
      const payload = {
        type: 'SONG_CHANGE',
        title: songTitle,
        artist: extra?.artist || '',
        queueType: qType,
        queueIndex: songIndex,
        setlistIndex: songIndex,
        songIndex,
        songTitle,
        transpose: transposeOffset,
        transposeOffset,
        offset: transposeOffset,
        scrollProgress: extra?.scrollProgress || 0,
        scroll: extra?.scrollProgress || 0,
        content: extra?.rawContent || '',
        rawContent: extra?.rawContent || '',
        key: extra?.key || '',
        capo: extra?.capo || '',
        songId: extra?.songId ? Number(extra.songId) : undefined,
        id: extra?.songId ? Number(extra.songId) : undefined,
      }
      this.broadcastMessage('SONG_SYNC', payload)
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify(payload))
        } catch {
          // ignore
        }
      }
    }
  }

  public broadcastScroll(scrollFraction: number, scrollTop: number) {
    if (this.role === 'HOST') {
      this.broadcastMessage('SCROLL_SYNC', { scrollFraction, scrollTop })
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(
            JSON.stringify({
              type: 'SCROLL',
              scroll: scrollFraction,
            })
          )
        } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
      }
    }
  }

  public broadcastTranspose(transposeOffset: number) {
    if (this.role === 'HOST') {
      this.broadcastMessage('SONG_SYNC', { transposeOffset })
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(
            JSON.stringify({
              type: 'TRANSPOSE',
              transposeOffset,
              offset: transposeOffset,
            })
          )
        } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
      }
    }
  }

  public broadcastAutoScroll(isAutoScrolling: boolean, scrollSpeed: number) {
    if (this.role === 'HOST') {
      this.broadcastMessage('AUTOSCROLL_SYNC', { isAutoScrolling, scrollSpeed })
    }
  }

  public broadcastSetlist(setlistName: string, songs: Array<Partial<ActiveSongState> & { content?: string }>) {
    // Members must purely be receivers/followers and never broadcast setlists to the Leader over WebSocket
    if (this.role !== 'HOST') {
      console.warn('BandSync: Followers/members cannot broadcast setlists to the Leader.')
      return
    }
    const formattedSongs = songs.map((s) => ({
      title: s.title || '',
      artist: s.artist || '',
      key: s.key || '',
      capo: s.capo || '',
      bpm: s.bpm || '',
      format: s.format || 'CHORD_PRO',
      rawContent: s.rawContent || s.content || '',
    }))
    const payload = {
      type: 'SETLIST_SYNC',
      setlistName: setlistName || 'Band Setlist',
      songs: formattedSongs,
    }
    this.broadcastMessage('SETLIST_SYNC', payload)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload))
      } catch (err) {
        console.error('Failed to send SETLIST_SYNC over WebSocket:', err)
      }
    }
  }

  private handleIncoming(input: unknown) {
    if (!input || typeof input !== 'object') return
    const data = input as BandSyncMessage
    if (!data.senderId) return
    if (data.senderId === this.peerId) return // Ignore self-messages

    const msg = data as BandSyncMessage
    this.knownPeers.set(msg.senderId, Date.now())

    if (msg.type === 'HEARTBEAT' && msg.payload?.disconnecting) {
      this.knownPeers.delete(msg.senderId)
    }

    this.notify()

    // Pass to listeners
    this.messageHandlers.forEach((handler) => {
      try {
        handler(msg)
      } catch (err) {
        console.error('BandSync handler error:', err)
      }
    })
  }
}

export const bandSync = new BandSyncEngine()
