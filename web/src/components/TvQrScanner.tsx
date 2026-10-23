import React, { useEffect, useRef, useState } from 'react'
import { parseTvQr, readTvQr } from '../utils/stageCast2Qr'

void React

export function TvQrScanner({ onReference }: { onReference: (ref: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generation = useRef(0)
  const photoUrl = useRef('')
  const [active, setActive] = useState(false)
  const [message, setMessage] = useState('')

  const stop = () => {
    generation.current++
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current)
    photoUrl.current = ''
    if (timer.current) clearTimeout(timer.current)
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }
  useEffect(() => stop, [])

  const accept = (value: string) => {
    const ref = parseTvQr(value, window.location.origin)
    if (!ref) throw Error('This is not a TV QR from this GTAR site. Try again or enter the TV reference manually.')
    onReference(ref)
    stop(); setActive(false)
    setMessage('TV reference scanned. Enter the six-digit PIN shown on the TV to connect.')
  }
  const camera = async () => {
    stop(); setActive(true); setMessage('Allow camera access, then point at the TV QR.')
    const current = generation.current
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error('Camera unavailable. Choose a QR photo or enter the TV reference and PIN manually.')
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      if (current !== generation.current) { media.getTracks().forEach(track => track.stop()); return }
      stream.current = media
      const el = video.current
      if (!el) { stop(); return }
      el.srcObject = media
      await el.play()
      const scan = async () => {
        if (current !== generation.current) return
        try {
          const result = await readTvQr(el, el.videoWidth, el.videoHeight)
          if (current !== generation.current) return
          if (result) { accept(result); return }
          timer.current = setTimeout(scan, 300)
        } catch (error) {
          stop(); setActive(false)
          setMessage(error instanceof Error ? error.message : 'Camera scan failed. Choose a photo or use manual entry.')
        }
      }
      void scan()
    } catch (error) {
      if (current !== generation.current) return
      stop(); setActive(false)
      setMessage(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Camera permission denied. Choose a QR photo or enter the TV reference and PIN manually.'
        : error instanceof Error ? error.message : 'Camera unavailable. Use a QR photo or manual entry.')
    }
  }
  const photo = (file?: File) => {
    if (!file) return
    stop(); setActive(false)
    const current = generation.current
    if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) {
      setMessage('Choose an image smaller than 20 MB, or enter the TV reference manually.'); return
    }
    if (typeof URL.createObjectURL !== 'function' || typeof Image === 'undefined') {
      setMessage('Photo scanning unavailable. Enter the TV reference and PIN manually.'); return
    }
    const url = URL.createObjectURL(file)
    photoUrl.current = url
    const img = new Image()
    img.onload = async () => {
      URL.revokeObjectURL(url)
      if (current !== generation.current) return
      try {
        const result = await readTvQr(img, img.naturalWidth, img.naturalHeight)
        if (current !== generation.current) return
        if (!result) throw Error('No readable QR found. Choose a clearer photo or enter the TV reference manually.')
        accept(result)
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Photo scan failed. Use manual entry.') }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      if (current === generation.current) setMessage('Image could not be read. Choose another photo or use manual entry.')
    }
    img.src = url
  }
  return <div className="cast2-scanner">
    <button type="button" onClick={() => void camera()}>Scan TV QR</button>
    <label className="cast2-photo">Choose QR photo
      <input type="file" accept="image/*" onChange={event => {
        photo(event.target.files?.[0]); event.target.value = ''
      }} />
    </label>
    {active && <div>
      <video ref={video} autoPlay muted playsInline aria-label="TV QR camera preview" />
      <button type="button" onClick={() => { stop(); setActive(false); setMessage('Scan cancelled. Manual entry is available.') }}>Cancel scan</button>
    </div>}
    <p role="status" aria-live="polite">{message}</p>
  </div>
}
