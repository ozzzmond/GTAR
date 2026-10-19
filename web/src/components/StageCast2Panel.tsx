import React, { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Cast2Client } from '../utils/stageCast2Client'
import { cast2LocalEnabled } from '../utils/stageCast2Local'
import { useOptionalGoogleAuth } from '../utils/authContext'
import { stageCast2Controller } from '../utils/stageCast2Controller'
import { SongLineRenderer } from './SongLineRenderer'
import { splitSongLinesForColumns } from '../utils/songParser'

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

  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams((window.location.hash || '').slice(1)).has('cast2')) {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [])

  const [pin, setPin] = useState('')
  const [qr, setQr] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const viewport = useRef<HTMLDivElement>(null)

  // Receiver-specific client instance
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
        if (!response.ok) throw Error(['DENIED', 'AUTH_REQUIRED', 'DISABLED'].includes(result.error) ? result.error : 'UNAVAILABLE')
        return result
      },
      socket: ticket => {
        const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
        const url = new URL('/cast2-api/socket', origin)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        return new WebSocket(url, ['cast2', 'ticket.' + ticket])
      },
    }, () => refresh(n => n + 1))
  })

  // Subscribe to controller state changes when in controller mode
  useEffect(() => {
    if (receiver) return
    return stageCast2Controller.subscribe(() => refresh(n => n + 1))
  }, [receiver])

  const client = receiver ? receiverClient! : stageCast2Controller.getClient()
  const v = receiver ? receiverClient!.view : stageCast2Controller.getView()
  const chords = !receiver && stageCast2Controller.getChords()

  // Receiver timers and document title
  useEffect(() => {
    if (!receiver || !cast2LocalEnabled || !receiverClient) return
    if (typeof document !== 'undefined') {
      document.title = 'TV Presentation · GTAR'
    }
    const timer = setInterval(() => { void receiverClient.tick() }, 5000)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(timer); clearInterval(clock); void receiverClient.end() }
  }, [receiver, receiverClient])

  // Controller timer for local clock update
  useEffect(() => {
    if (receiver) return
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(clock)
  }, [receiver])

  const pairingUrl = v.ref ? new URL('/#cast2=' + v.ref, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173').href : ''

  useEffect(() => {
    let cancelled = false
    if (receiver && pairingUrl && v.pin) {
      QRCode.toDataURL(pairingUrl, { width: 280, margin: 4, errorCorrectionLevel: 'M' })
        .then(value => { if (!cancelled) setQr(value) })
        .catch(() => { if (!cancelled) setQr('') })
    }
    return () => { cancelled = true }
  }, [pairingUrl, receiver, v.pin])

  useEffect(() => {
    const el = viewport.current
    if (!el || !v.snapshot) return
    const apply = () => { el.scrollTop = v.snapshot!.scroll.fraction * Math.max(0, el.scrollHeight - el.clientHeight) }
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply)
    observer?.observe(el)
    window.addEventListener('resize', apply)
    return () => { observer?.disconnect(); window.removeEventListener('resize', apply) }
  }, [v.snapshot])

  if (!cast2LocalEnabled) return receiver ? <p role="status">TV Presentation is disabled.</p> : null

  const terminal = ['IDLE', 'ENDED', 'ERROR', 'REVOKED', 'EXPIRED'].includes(v.state) || (v.state === 'DISCONNECTED' && !!v.error.includes('exhausted'))
  const remaining = Math.max(0, Math.ceil(((v.pin ? v.pairingExpiresAt : v.expiresAt) - now) / 1000))
  const columns = v.snapshot?.mode.columns === 2 ? splitSongLinesForColumns(v.snapshot.lines) : [v.snapshot?.lines || []]

  if (receiver) {
    return (
      <main className="cast2 cast2-tv">
        <h1>TV Presentation</h1>
        <p role="status" aria-live="polite">{v.state.replaceAll('_', ' ')}{v.expiresAt > now && !terminal ? ` · ${remaining}s remaining` : ''}</p>
        {v.error && <p role="alert">{v.error}</p>}
        {terminal && (
          <button onClick={() => { receiverClient!.dispose(); void receiverClient!.start() }}>
            Create TV pairing
          </button>
        )}
        {v.pin && now < v.pairingExpiresAt && (
          <div className="cast2-pairing">
            {qr && <img src={qr} alt="Scan to open the authenticated GTAR controller" width="280" height="280" />}
            <p>Six-digit PIN: <strong className="cast2-pin">{v.pin}</strong></p>
            <label>TV reference<input readOnly value={v.ref} /></label>
            <p>Scan QR, sign in on your phone, then enter this PIN. QR contains only the TV reference.</p>
          </div>
        )}
        {v.state === 'AWAITING_TV_APPROVAL' && (
          <div>
            <p>A signed-in controller entered this TV's PIN. Approve only if you just requested this connection.</p>
            <button autoFocus onClick={() => void receiverClient!.decide(false)}>Reject controller</button>
            <button onClick={() => void receiverClient!.decide(true)}>Approve controller</button>
          </div>
        )}
        {!terminal && <button onClick={() => void receiverClient!.end()}>End session</button>}
        {v.state === 'CONNECTED' && !v.snapshot && <p>Waiting for the controller's active song...</p>}
        {v.snapshot && v.state === 'CONNECTED' && (
          <>
            <h1>{v.snapshot.displayTitle}</h1>
            <p>Key {v.snapshot.transpose.effectiveKey} · Transpose {v.snapshot.transpose.offset}</p>
            <div ref={viewport} className="cast2-lyrics" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
              {columns.map((lines, index) => (
                <div key={index}>
                  <SongLineRenderer lines={lines} fontSizePx={32} notation={v.snapshot!.mode.notation} referenceKey={v.snapshot!.transpose.effectiveKey} />
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    )
  }

  // Controller mode (integrated directly in TvPresentationModal or rendered standalone)
  return (
    <div className="cast2 cast2-controller">
      <p role="status" aria-live="polite">
        {v.state === 'CONNECTED' ? 'Connected to TV' : v.state === 'AWAITING_TV_APPROVAL' ? 'Awaiting TV approval' : v.state.replaceAll('_', ' ')}
        {v.expiresAt > now && !terminal ? ` · ${remaining}s remaining` : ''}
      </p>
      {v.error && <p role="alert" className="text-xs text-status-error font-medium">{v.error}</p>}
      {terminal ? (
        <form onSubmit={event => {
          event.preventDefault()
          if (!receiver) {
            void stageCast2Controller.start(ref, pin)
          } else {
            client.dispose()
            void client.start(ref, pin)
          }
          setPin('')
        }}>
          <label>
            TV reference
            <input autoComplete="off" value={ref} onChange={e => setRef(e.target.value)} required pattern="[a-f0-9]{64}" />
          </label>
          <label>
            Six-digit TV PIN
            <input inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} required pattern="[0-9]{6}" maxLength={6} />
          </label>
          <button type="submit">Request TV approval</button>
        </form>
      ) : (
        <div className="space-y-3 mt-2">
          {v.state === 'AWAITING_TV_APPROVAL' && (
            <p className="text-xs text-app-muted">
              A connection request was sent to the TV. Select "Approve controller" on the TV screen.
            </p>
          )}
          {v.state === 'CONNECTED' && (
            <label className="cast2-check">
              <input type="checkbox" checked={chords} onChange={e => stageCast2Controller.setChords(e.target.checked)} />
              Show chords on TV
            </label>
          )}
          <button type="button" onClick={() => void stageCast2Controller.end()}>
            Disconnect
          </button>
        </div>
      )}
      {terminal && (
        <p className="text-xs text-app-muted mt-2">
          On the TV, open the TV Presentation page. Scan its QR code or enter its reference and PIN here. Approve the request on the TV.
        </p>
      )}
    </div>
  )
}
