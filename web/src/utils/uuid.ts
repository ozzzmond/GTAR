/** Library IDs also work on LAN HTTP, where randomUUID is unavailable. */
export function generateUUID(): string {
  const source = globalThis.crypto
  if (typeof source?.randomUUID === 'function') {
    try { return source.randomUUID() } catch { /* Fall through to random bytes. */ }
  }

  const bytes = new Uint8Array(16)
  try {
    if (typeof source?.getRandomValues !== 'function') throw new Error('Random bytes unavailable')
    source.getRandomValues(bytes)
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  // RFC 4122 version 4 and variant 1 bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidUUID(id: unknown): id is string {
  return typeof id === 'string' && UUID_REGEX.test(id.trim())
}

