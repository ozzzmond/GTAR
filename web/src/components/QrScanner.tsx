import React, { useEffect, useRef, useState } from 'react'
import { readTvQr } from '../utils/stageCast2Qr'
import { SETLIST_QR_CLASSES, SETLIST_QR_COPY, type QrScannerClasses, type QrScannerCopy } from './qrScannerCopy'

void React

export interface QrScannerProps {
  /** Receives decoded QR text. Throw an Error to reject it (message is shown); return a string to show as status on success. */
  onText: (text: string) => string | void
  copy?: QrScannerCopy
  classes?: QrScannerClasses
}

export function QrScanner({ onText, copy = SETLIST_QR_COPY, classes = SETLIST_QR_CLASSES }: QrScannerProps) {
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
    const status = onText(value)
    stop(); setActive(false)
    setMessage(typeof status === 'string' ? status : '')
  }
  const camera = async () => {
    stop(); setActive(true); setMessage(copy.prompt)
    const current = generation.current
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error(copy.noCamera)
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
          setMessage(error instanceof Error ? error.message : copy.cameraFailed)
        }
      }
      void scan()
    } catch (error) {
      if (current !== generation.current) return
      stop(); setActive(false)
      setMessage(error instanceof DOMException && error.name === 'NotAllowedError'
        ? copy.denied
        : error instanceof Error ? error.message : copy.cameraFailed)
    }
  }
  const photo = (file?: File) => {
    if (!file) return
    stop(); setActive(false)
    const current = generation.current
    if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) {
      setMessage(copy.badImage); return
    }
    if (typeof URL.createObjectURL !== 'function' || typeof Image === 'undefined') {
      setMessage(copy.noPhotoSupport); return
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
        if (!result) throw Error(copy.noQrInPhoto)
        accept(result)
      } catch (error) { setMessage(error instanceof Error ? error.message : copy.photoFailed) }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      if (current === generation.current) setMessage(copy.unreadableImage)
    }
    img.src = url
  }
  const cls = (value: string) => value || undefined
  return <div className={cls(classes.container)}>
    <button type="button" className={cls(classes.scan)} onClick={() => void camera()}>{copy.scan}</button>
    <label className={cls(classes.photo)}>{copy.photo}
      <input type="file" accept="image/*" className={cls(classes.input)} onChange={event => {
        photo(event.target.files?.[0]); event.target.value = ''
      }} />
    </label>
    {active && <div className={cls(classes.videoWrap)}>
      <video className={cls(classes.video)} ref={video} autoPlay muted playsInline aria-label={copy.cameraLabel} />
      <button type="button" className={cls(classes.cancel)} onClick={() => { stop(); setActive(false); setMessage(copy.cancelled) }}>{copy.cancel}</button>
    </div>}
    <p className={cls(classes.status)} role="status" aria-live="polite">{message}</p>
  </div>
}
