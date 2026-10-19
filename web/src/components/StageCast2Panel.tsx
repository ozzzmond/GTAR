import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Cast2Client } from '../utils/stageCast2Client'
import { cast2LocalEnabled } from '../utils/stageCast2Local'
import { useOptionalGoogleAuth } from '../utils/authContext'
import { hasServerApproval, validSession } from '../utils/googleAuth'
import type { GoogleSession } from '../utils/googleAuth'
import { stageCast } from '../utils/stageCast'
import { projectCast2Presentation } from '../utils/stageCast2Projection'
import { SongLineRenderer } from './SongLineRenderer'
import { splitSongLinesForColumns } from '../utils/songParser'
import './StageCast2Panel.css'

class ControllerCredentials {
  private session: GoogleSession | null = null
  set(session: GoogleSession | null) { this.session = session }
  get() { return this.session }
}

/** Auth goes only to same-origin P1 HTTP. Socket receives a single-use ticket, never OAuth. */
export function StageCast2Panel({ receiver = false }: { receiver?: boolean }) {
  const auth = useOptionalGoogleAuth()
  const [credentials] = useState(() => new ControllerCredentials())
  useEffect(() => { credentials.set(auth?.session ?? null) }, [auth, credentials])
  const [, refresh] = useState(0)
  const [ref, setRef] = useState(() => {
    const params = new URLSearchParams(window.location.hash.slice(1))
    return params.get('cast2') || ''
  })
  useEffect(() => {
    if (new URLSearchParams(window.location.hash.slice(1)).has('cast2')) history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])
  const [pin, setPin] = useState('')
  const [chords, setChords] = useState(false)
  const [qr, setQr] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const viewport = useRef<HTMLDivElement>(null)
  const [client] = useState(() => new Cast2Client(receiver ? 'receiver' : 'controller', {
    now: () => Date.now(),
    post: async (path, data, controller) => {
      if (!cast2LocalEnabled) throw Error('DISABLED')
      const session = credentials.get()
      if (controller && (!validSession(session) || !hasServerApproval(session) || !session.sessionToken)) throw Error('AUTH_REQUIRED')
      const response = await fetch('/cast2-api' + path, { method: 'POST', cache: 'no-store', credentials: 'omit',
        redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json', ...(controller ? { Authorization: `Bearer ${session!.sessionToken}` } : {}) }, body: JSON.stringify(data) })
      const result = await response.json()
      if (!response.ok) throw Error(['DENIED', 'AUTH_REQUIRED', 'DISABLED'].includes(result.error) ? result.error : 'UNAVAILABLE')
      return result
    },
    socket: ticket => {
      const url = new URL('/cast2-api/socket', window.location.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      return new WebSocket(url, ['cast2', 'ticket.' + ticket])
    },
  }, () => refresh(n => n + 1)))
  const v = client.view
  useEffect(() => {
    if (!cast2LocalEnabled) return
    const timer = setInterval(() => { void client.tick() }, 5000)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(timer); clearInterval(clock); void client.end() }
  }, [client])
  useEffect(() => {
    if (!receiver && client.view.ref && !auth?.session) void client.end()
  }, [auth?.session, client, receiver])
  useEffect(() => {
    if (receiver || !cast2LocalEnabled) return
    let pending: ReturnType<typeof setTimeout> | undefined
    let latestState: Parameters<Parameters<typeof stageCast.subscribeProjection>[0]>[0] = null
    let latestScroll: Parameters<Parameters<typeof stageCast.subscribeProjection>[0]>[1] = null
    const unsubscribe = stageCast.subscribeProjection((state, scroll) => {
      latestState = state; latestScroll = scroll
      if (pending) return
      pending = setTimeout(() => {
        pending = undefined
        if (!latestState) return
        const projected = projectCast2Presentation(latestState, { lineIndex: 0, scrollTop: latestScroll?.scrollTop ?? 0,
          scrollFraction: latestScroll?.scrollFraction ?? 0, chordsVisible: chords })
        if (projected.ok) client.publish(projected.value)
      }, 150)
    })
    return () => { clearTimeout(pending); unsubscribe() }
  }, [client, receiver, chords, v.ref])
  const pairingUrl = v.ref ? new URL('/#cast2=' + v.ref, window.location.origin).href : ''
  useEffect(() => {
    let cancelled = false
    if (receiver && pairingUrl && v.pin) {
      QRCode.toDataURL(pairingUrl, { width: 280, margin: 4, errorCorrectionLevel: 'M' }).then(value => { if (!cancelled) setQr(value) }).catch(() => { if (!cancelled) setQr('') })
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
  if (!cast2LocalEnabled) return receiver ? <p role="status">Stage Cast 2.0 is disabled.</p> : null
  const terminal = ['IDLE', 'ENDED', 'ERROR', 'REVOKED', 'EXPIRED'].includes(v.state) || (v.state === 'DISCONNECTED' && !!v.error.includes('exhausted'))
  const remaining = Math.max(0, Math.ceil(((v.pin ? v.pairingExpiresAt : v.expiresAt) - now) / 1000))
  const columns = v.snapshot?.mode.columns === 2 ? splitSongLinesForColumns(v.snapshot.lines) : [v.snapshot?.lines || []]
  const content = <>
    <h2>Stage Cast 2.0{import.meta.env.DEV ? ' · Local review' : ' · DEV Field QA'}</h2>
    <p role="status" aria-live="polite">{v.state.replaceAll('_', ' ')}{v.expiresAt > now && !terminal ? ` · ${remaining}s remaining` : ''}</p>
    {v.error && <p role="alert">{v.error}</p>}
    {terminal && (receiver ? <button onClick={() => { client.dispose(); void client.start() }}>Create TV pairing</button> :
      <form onSubmit={event => { event.preventDefault(); client.dispose(); void client.start(ref, pin); setPin('') }}>
        <label>TV reference<input autoComplete="off" value={ref} onChange={e => setRef(e.target.value)} required pattern="[a-f0-9]{64}" /></label>
        <label>Six-digit TV PIN<input inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} required pattern="[0-9]{6}" maxLength={6} /></label>
        <button type="submit">Request TV approval</button>
      </form>)}
    {!receiver && <>
      <label className="cast2-check"><input type="checkbox" checked={chords} onChange={e => setChords(e.target.checked)} />Show chords on TV</label>
      <p>On the TV, open <a href="/tv/cast2" target="_blank" rel="noreferrer">TV pairing</a>. Scan its QR code or enter its reference and PIN here. Approve only your request on the TV.</p>
    </>}
    {receiver && v.pin && now < v.pairingExpiresAt && <div className="cast2-pairing">
      {qr && <img src={qr} alt="Scan to open the authenticated GTAR controller" width="280" height="280" />}
      <p>Six-digit PIN: <strong className="cast2-pin">{v.pin}</strong></p>
      <label>TV reference<input readOnly value={v.ref} /></label>
      <p>Scan QR, sign in on your phone, then enter this PIN. QR contains only the TV reference.</p>
    </div>}
    {receiver && v.state === 'AWAITING_TV_APPROVAL' && <div>
      <p>A signed-in controller entered this TV’s PIN. Approve only if you just requested this connection.</p>
      <button autoFocus onClick={() => void client.decide(false)}>Reject controller</button>
      <button onClick={() => void client.decide(true)}>Approve controller</button>
    </div>}
    {!terminal && <button onClick={() => void client.end()}>End session</button>}
    {receiver && v.state === 'CONNECTED' && !v.snapshot && <p>Waiting for the controller’s active song…</p>}
    {receiver && v.snapshot && v.state === 'CONNECTED' && <>
      <h1>{v.snapshot.displayTitle}</h1><p>Key {v.snapshot.transpose.effectiveKey} · Transpose {v.snapshot.transpose.offset}</p>
      <div ref={viewport} className="cast2-lyrics" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
        {columns.map((lines, index) => <div key={index}><SongLineRenderer lines={lines} fontSizePx={32} notation={v.snapshot!.mode.notation} referenceKey={v.snapshot!.transpose.effectiveKey} /></div>)}
      </div>
    </>}
  </>
  return receiver ? <main className="cast2 cast2-tv">{content}</main> : <details className="cast2 cast2-controller" open={!!ref}><summary>Stage Cast 2.0</summary>{content}</details>
}
