import jsQR from 'jsqr'

/** The QR identifies a TV only; PIN and all authorization credentials stay out of URLs. */
export function parseTvQr(value: string, origin: string): string | null {
  try {
    const url = new URL(value)
    const hash = new URLSearchParams(url.hash.slice(1))
    const ref = hash.get('cast2')
    return url.origin === origin && url.pathname === '/' && !url.search && !url.username && !url.password &&
      [...hash.keys()].length === 1 && ref !== null && /^[a-f0-9]{64}$/.test(ref) ? ref : null
  } catch { return null }
}

export function readTvQr(source: CanvasImageSource, width: number, height: number): string | null {
  if (!width || !height) return null
  const scale = Math.min(1, 1600 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw Error('Image scanning unavailable. Enter the TV reference and PIN manually.')
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(pixels.data, pixels.width, pixels.height)?.data ?? null
}
