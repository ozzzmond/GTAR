// jsQR (~125 KB) is loaded only when a scan actually runs, keeping it out of the entry chunk (#85).
let decoder: Promise<typeof import('jsqr').default> | null = null
const loadDecoder = () => (decoder ??= import('jsqr').then(m => m.default))

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

export async function readTvQr(source: CanvasImageSource, width: number, height: number): Promise<string | null> {
  if (!width || !height) return null
  const jsQR = await loadDecoder()
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
