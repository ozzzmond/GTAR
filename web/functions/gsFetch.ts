import {
  isAllowedGuitarSongsDestination,
  MAX_GUITARSONGS_HTML_BYTES,
} from '../src/utils/guitarSongsCore.ts'

export const MAX_GS_REDIRECTS = 3

/**
 * Fetches public GuitarSongs.club HTML with strict host allowlist, manual redirect
 * validation, challenge detection, content-type check, timeout, and size cap.
 */
export async function fetchGuitarSongs(
  target: string,
  headers: HeadersInit,
  timeoutMs = 8000,
  maxBytes = MAX_GUITARSONGS_HTML_BYTES
): Promise<{ status: number; html: string }> {
  if (!isAllowedGuitarSongsDestination(target)) {
    throw new Error(`Untrusted GuitarSongs.club destination: ${target}`)
  }

  const controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      void reader?.cancel().catch(() => {})
      reject(new DOMException('Upstream deadline exceeded', 'TimeoutError'))
    }, timeoutMs)
  })

  let currentTarget = target
  let redirectCount = 0

  try {
    while (true) {
      const response = await Promise.race([
        fetch(currentTarget, { headers, signal: controller.signal, redirect: 'manual' }),
        deadline,
      ])

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        void response.body?.cancel().catch(() => {})
        redirectCount += 1
        if (redirectCount > MAX_GS_REDIRECTS) {
          throw new Error('Too many redirects from GuitarSongs.club')
        }
        const location = response.headers.get('location')
        if (!location) {
          throw new Error('Redirect response missing Location header')
        }
        const resolvedUrl = new URL(location, currentTarget).toString()
        if (!isAllowedGuitarSongsDestination(resolvedUrl)) {
          throw new Error(`Untrusted redirect destination: ${resolvedUrl}`)
        }
        currentTarget = resolvedUrl
        continue
      }

      if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') {
        void response.body?.cancel().catch(() => {})
        return { status: 403, html: '' }
      }

      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {})
        return { status: response.status, html: '' }
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase()
      if (!contentType.includes('text/html')) {
        void response.body?.cancel().catch(() => {})
        throw new Error('GuitarSongs.club did not return HTML')
      }

      const declared = response.headers.get('content-length')
      if (declared && Number(declared) > maxBytes) {
        void response.body?.cancel().catch(() => {})
        throw new Error('GuitarSongs.club response body exceeds size limit')
      }

      reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let size = 0
      let html = ''
      if (reader) {
        while (true) {
          const chunk = await Promise.race([reader.read(), deadline])
          if (controller.signal.aborted) {
            throw new DOMException('Upstream deadline exceeded', 'TimeoutError')
          }
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > maxBytes) {
            throw new Error('GuitarSongs.club response body exceeds size limit')
          }
          html += decoder.decode(chunk.value, { stream: true })
        }
      }
      return { status: response.status, html: html + decoder.decode() }
    }
  } finally {
    clearTimeout(timer)
    controller.abort()
    void reader?.cancel().catch(() => {})
  }
}
