import React, { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { TvQrScanner } from './TvQrScanner'
import { Cast2Client } from '../utils/stageCast2Client'
import { cast2LocalEnabled } from '../utils/stageCast2Local'
import { useOptionalGoogleAuth } from '../utils/authContext'
import { stageCast2Controller } from '../utils/stageCast2Controller'
import { SongLineRenderer } from './SongLineRenderer'
import { splitSongLinesForColumns } from '../utils/songParser'
import { createWakeLockController } from '../utils/stagePerformance'

void React

/** Auth goes only to same-origin P1 HTTP. Socket receives a single-use ticket, never OAuth. */
export function StageCast2Panel({ receiver = false }: { receiver?: boolean }) {
  const auth = useOptionalGoogleAuth()
  const [, refresh] = useState(0)

  // Controller state from shared manager
  useEffect(() => {
    if (!receiver) {
      stageCast2Controller.setSession(auth?.session ?? null)
    }
  }, [auth?.session, receiver])

  const [ref, setRef] = useState(() => {
    if (typeof window === 'undefined') return ''
    const params = new URLSearchParams((window.location.hash || '').slice(1))
    return params.get('cast2') || (!receiver ? stageCast2Controller.getView().ref : '') || ''
  })

  // URL normalization and alias redirect
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (new URLSearchParams((window.location.hash || '').slice(1)).has('cast2')) {
        history.replaceState(null, '', window.location.pathname + window.location.search)
      }
      if (receiver && (window.location.pathname === '/tv/cast2' || window.location.pathname === '/tv/cast2/')) {
        history.replaceState(null, '', '/tv' + window.location.search + window.location.hash)
      }
    }
  }, [receiver])

  const [pin, setPin] = useState('')
  const [recovery, setRecovery] = useState(false)
  useEffect(() => {
    if (!receiver) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setRecovery(value => !value) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [receiver])
  const [qr, setQr] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const viewport = useRef<HTMLDivElement>(null)

  // Receiver-specific typography zoom state
  const [fallbackFontSize, setFallbackFontSize] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('gtar_tv_font_size')
        if (saved) {
          const parsed = parseInt(saved, 10)
          if (Number.isFinite(parsed) && parsed >= 20 && parsed <= 56) return parsed
        }
      } catch { /* best effort */ }
    }
    return 32
  })
  const [prevRemoteSize, setPrevRemoteSize] = useState<number | undefined>(undefined)

  // Receiver-specific client instance with resilient options
  const [receiverClient] = useState(() => {
    if (!receiver) return null
    return new Cast2Client('receiver', {
      now: () => Date.now(),
      post: async (path, data) => {
        if (!cast2LocalEnabled) throw Error('DISABLED')
        const response = await fetch('/cast2-api' + path, {
          method: 'POST', cache: 'no-store', credentials: 'omit',
          redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8000),
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
        })
        const result = await response.json()
        if (!response.ok) throw Error(['DENIED', 'AUTH_REQUIRED', 'DISABLED', 'RATE_LIMITED'].includes(result.error) ? result.error : 'UNAVAILABLE')
        return result
      },
      socket: ticket => {
        const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
        const url = new URL('/cast2-api/socket', origin)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        return new WebSocket(url, ['cast2', 'ticket.' + ticket])
      },
    }, () => refresh(n => n + 1), { maxFailures: 30, backoff: true })
  })

  // Restore receiver session on mount if previously active in tab
  useEffect(() => {
    if (receiver && receiverClient) {
      receiverClient.restore()
    }
  }, [receiver, receiverClient])

  // Subscribe to controller state changes when in controller mode
  useEffect(() => {
    if (receiver) return
    return stageCast2Controller.subscribe(() => refresh(n => n + 1))
  }, [receiver])

  const v = receiver ? receiverClient!.view : stageCast2Controller.getView()
  const projectionError = !receiver ? stageCast2Controller.getProjectionError() : ''

  const remoteSize = v.snapshot?.mode.fontSize
  if (typeof remoteSize === 'number' && remoteSize >= 20 && remoteSize <= 56 && remoteSize !== prevRemoteSize) {
    setPrevRemoteSize(remoteSize)
    setFallbackFontSize(remoteSize)
  }
  const tvFontSize = typeof remoteSize === 'number' && remoteSize >= 20 && remoteSize <= 56
    ? remoteSize
    : fallbackFontSize

  // Synchronize remote font size updates while paired without write storm
  useEffect(() => {
    const remoteSize = v.snapshot?.mode.fontSize
    if (typeof remoteSize === 'number' && remoteSize >= 20 && remoteSize <= 56) {
      try {
        if (typeof window !== 'undefined') {
          const current = localStorage.getItem('gtar_tv_font_size')
          if (current !== String(remoteSize)) {
            localStorage.setItem('gtar_tv_font_size', String(remoteSize))
          }
        }
      } catch { /* best effort */ }
    }
  }, [v.snapshot?.mode.fontSize])

  // Receiver timers and document title
  useEffect(() => {
    if (!receiver || !cast2LocalEnabled || !receiverClient) return
    if (typeof document !== 'undefined') {
      document.title = 'TV Presentation \u00b7 GTAR'
    }
    const timer = setInterval(() => { void receiverClient.tick() }, 5000)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(timer); clearInterval(clock); receiverClient.disconnect() }
  }, [receiver, receiverClient])

  // Screen Wake Lock during active receiver presentation
  useEffect(() => {
    if (!receiver || !cast2LocalEnabled) return
    const activePresentation = Boolean(v.snapshot && (v.state === 'CONNECTED' || v.state === 'DISCONNECTED'))
    if (!activePresentation) return
    const wakeLock = createWakeLockController()
    void wakeLock.acquire()
    return () => {
      wakeLock.cleanup()
    }
  }, [receiver, v.snapshot, v.state])

  // Controller timer for local clock update
  useEffect(() => {
    if (receiver) return
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(clock)
  }, [receiver])

  const pairingUrl = v.ref ? new URL('/#cast2=' + v.ref, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173').href : ''

  // QR rendering with lightweight SVG fallback
  useEffect(() => {
    let cancelled = false
    if (receiver && pairingUrl && v.pin) {
      QRCode.toDataURL(pairingUrl, { width: 280, margin: 4, errorCorrectionLevel: 'M' })
        .then(value => { if (!cancelled) setQr(value) })
        .catch(() => {
          // Fallback to SVG string data URI if canvas is unsupported
          QRCode.toString(pairingUrl, { type: 'svg', width: 280, margin: 4, errorCorrectionLevel: 'M' })
            .then(svg => {
              if (!cancelled) setQr('data:image/svg+xml;utf8,' + encodeURIComponent(svg))
            })
            .catch(() => {
              if (!cancelled) setQr('')
            })
        })
    }
    return () => { cancelled = true }
  }, [pairingUrl, receiver, v.pin])

  // TV Title presentation visibility and auto-hide
  const currentSongKey = `${v.snapshot?.songId ?? ''}:${v.snapshot?.displayTitle ?? ''}`
  const [prevSongKey, setPrevSongKey] = useState(currentSongKey)
  const [titleVisible, setTitleVisible] = useState(true)

  if (currentSongKey !== prevSongKey) {
    setPrevSongKey(currentSongKey)
    setTitleVisible(true)
  }

  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    titleTimerRef.current = setTimeout(() => {
      const el = viewport.current
      if (el && el.scrollTop > 30) {
        setTitleVisible(false)
      }
    }, 4000)
    return () => {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    }
  }, [v.snapshot?.songId, v.snapshot?.displayTitle])

  const handleReceiverScroll = () => {
    const el = viewport.current
    if (!el) return
    const currentTop = el.scrollTop
    if (currentTop <= 20) {
      setTitleVisible(true)
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    } else if (currentTop > 30) {
      setTitleVisible(false)
    }
  }

  const handleReceiverInteraction = () => {
    setTitleVisible(true)
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    titleTimerRef.current = setTimeout(() => {
      const el = viewport.current
      if (el && el.scrollTop > 30) {
        setTitleVisible(false)
      }
    }, 4000)
  }

  // Section-aware scroll synchronization
  useEffect(() => {
    const el = viewport.current
    if (!el || !v.snapshot) return

    const applyScroll = () => {
      if (v.snapshot!.scroll.fraction === 0 && v.snapshot!.position.lineIndex === 0) {
        el.scrollTop = 0
        return
      }

      const targetIndex = v.snapshot!.position.lineIndex
      if (targetIndex > 0) {
        const targetEl = el.querySelector<HTMLElement>(
          `[data-section-index="${targetIndex}"], [data-line-index="${targetIndex}"]`
        )
        if (targetEl) {
          const elRect = el.getBoundingClientRect()
          const targetRect = targetEl.getBoundingClientRect()
          const elementOffsetInContainer = targetRect.top - elRect.top + el.scrollTop
          const clearance = 72
          const targetScrollTop = Math.max(0, Math.round(elementOffsetInContainer - clearance))
          const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
          el.scrollTop = Math.min(maxScroll, targetScrollTop)
          return
        }
      }

      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
      el.scrollTop = Math.round(v.snapshot!.scroll.fraction * maxScroll)
    }

    applyScroll()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(applyScroll)
    observer?.observe(el)
    window.addEventListener('resize', applyScroll)
    return () => { observer?.disconnect(); window.removeEventListener('resize', applyScroll) }
  }, [v.snapshot, tvFontSize])

  if (!cast2LocalEnabled) return receiver ? <p role="status">TV Presentation is disabled.</p> : null

  const terminal = ['IDLE', 'ENDED', 'ERROR', 'REVOKED', 'EXPIRED', 'REPLACED'].includes(v.state) || (v.state === 'DISCONNECTED' && !!v.error.includes('exhausted'))
  const errorText: Record<string, string> = {
    AUTH_REQUIRED: 'Sign in with an approved GTAR account, then try pairing again.',
    DENIED: 'Pairing denied or expired. Create a new pairing on the TV and check its PIN.',
    DISABLED: 'TV pairing is unavailable on this site.',
    RATE_LIMITED: 'Too many attempts. Wait one minute, then create a new TV pairing.',
    UNAVAILABLE: 'Connection unavailable. Check the network and try again.',
    REPLACED: 'This TV display was replaced by another receiver session.',
  }
  const remaining = Math.max(0, Math.ceil(((v.pin ? v.pairingExpiresAt : v.expiresAt) - now) / 1000))
  const columns = v.snapshot?.mode.columns === 2 ? splitSongLinesForColumns(v.snapshot.lines) : [v.snapshot?.lines || []]

  if (receiver) {
    const showPresentation = Boolean(v.snapshot && (v.state === 'CONNECTED' || v.state === 'DISCONNECTED'))
    const showHeader = !showPresentation || recovery || terminal

    return (
      <main className="cast2 cast2-tv">
        {showHeader && <>
          <h1>TV Browser Presentation Page</h1>
          <p role="status" aria-live="polite">
            {v.state === 'REPLACED' ? 'Session replaced by another receiver' : v.state.replaceAll('_', ' ')}
          </p>
          {recovery && showPresentation && <button onClick={() => setRecovery(false)}>Return to presentation</button>}
        </>}
        {v.error && <p role="alert">{errorText[v.error] || v.error}</p>}
        {terminal && (
          <button onClick={() => { receiverClient!.dispose(); void receiverClient!.start() }}>
            Create TV pairing
          </button>
        )}
        {v.pin && now < v.pairingExpiresAt && (
          <div className="cast2-pairing">
            {qr ? (
              <img src={qr} alt="Scan to open the authenticated GTAR controller" width="280" height="280" />
            ) : (
              <div className="cast2-qr-fallback" role="note">
                <p className="text-sm font-bold text-app-accent mb-2">QR Display Unavailable</p>
                <p className="text-xs text-app-muted">Navigate to {pairingUrl || '/#cast2=' + v.ref}</p>
              </div>
            )}
            <p>Six-digit PIN: <strong className="cast2-pin">{v.pin}</strong></p>
            <p>In Cast Options on your phone, scan this QR and enter the PIN. A signed-in controller with this PIN can connect.</p>
            <p>Pairing expires in {remaining}s. Press Escape during presentation for session controls, or reload this page to pair again.</p>
            <details><summary>Manual pairing reference</summary>
              <label>TV reference<input readOnly value={v.ref} /></label>
            </details>
          </div>
        )}
        {!terminal && (showHeader || recovery) && <button onClick={() => void receiverClient!.end()}>End session</button>}
        {v.state === 'CONNECTED' && !v.snapshot && <p>Waiting for the controller's active song...</p>}
        {showPresentation && (
          <div
            className="cast2-tv-presentation-container"
            onClick={handleReceiverInteraction}
            onMouseMove={handleReceiverInteraction}
          >
            <h1 className="sr-only">{v.snapshot!.displayTitle}</h1>
            <div
              className={`cast2-tv-title-container ${titleVisible ? 'cast2-tv-title-visible' : 'cast2-tv-title-hidden'}`}
              aria-label={`Song: ${v.snapshot!.displayTitle}`}
            >
              <div className="cast2-tv-title-pill">
                <span className="cast2-tv-title-text">
                  {v.snapshot!.displayTitle}
                </span>
              </div>
            </div>
            {v.state === 'DISCONNECTED' && (
              <div className="cast2-tv-status-badge" role="status" aria-live="polite">
                <span>Connection paused &bull; Reconnecting...</span>
              </div>
            )}
            <div
              ref={viewport}
              onScroll={handleReceiverScroll}
              className="cast2-lyrics"
              style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
            >
              {columns.map((lines, index) => (
                <div key={index}>
                  <SongLineRenderer
                    lines={lines}
                    fontSizePx={tvFontSize}
                    notation={v.snapshot!.mode.notation}
                    referenceKey={v.snapshot!.transpose.effectiveKey}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    )
  }

  // Controller mode (integrated directly in TvPresentationModal or rendered standalone)
  return (
    <div className="cast2 cast2-controller">
      <p role="status" aria-live="polite">
        {v.state === 'CONNECTED' ? 'Connected to TV' : v.state === 'DISCONNECTED' ? 'Reconnecting to TV' : v.state === 'PAIRED' ? 'Connecting to TV' : v.state === 'EXPIRED' ? 'Session expired. Pair again.' : v.state === 'REPLACED' ? 'Session ended: controlled from another tab or device' : terminal ? 'Ready to pair' : v.state.replaceAll('_', ' ')}
      </p>
      {v.error && <p role="alert" className="text-xs text-status-error font-medium">{errorText[v.error] || v.error}</p>}
      {projectionError && (
        <p role="alert" className="text-xs text-status-warning font-medium mt-1">{projectionError}</p>
      )}
      {terminal ? (
        <form onSubmit={event => {
          event.preventDefault()
          void stageCast2Controller.start(ref.trim(), pin)
          setPin('')
        }}>
          <TvQrScanner onReference={setRef} />
          <label>
            TV reference
            <input autoComplete="off" value={ref} onChange={e => setRef(e.target.value)} required pattern="[a-f0-9]{64}" />
          </label>
          <label>
            Six-digit TV PIN
            <input inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} required pattern="[0-9]{6}" maxLength={6} />
          </label>
          <button type="submit">Connect to TV</button>
        </form>
      ) : (
        <div className="space-y-3 mt-2">
          <button type="button" onClick={() => void stageCast2Controller.end()}>
            Disconnect
          </button>
        </div>
      )}
      {/* #224: pairing steps on demand instead of a standing paragraph. */}
      {terminal && (
        <details data-testid="cast2-how-to-pair" className="mt-2 text-xs text-app-muted">
          <summary className="cursor-pointer text-app-action font-semibold">How to pair</summary>
          <ol className="list-decimal pl-5 mt-1 space-y-0.5">
            <li>On the TV, open the page above.</li>
            <li>Scan its QR here, or type the reference.</li>
            <li>Enter the six-digit PIN shown on the TV.</li>
          </ol>
        </details>
      )}
    </div>
  )
}
