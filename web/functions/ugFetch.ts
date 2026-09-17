/** One deadline covers headers and decoded body bytes, including stalled streams. */
export async function fetchUg(target: string, headers: HeadersInit, timeoutMs = 8000, maxBytes = 2 * 1024 * 1024): Promise<{ status: number; html: string }> {
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
  try {
    const response = await Promise.race([fetch(target, { headers, signal: controller.signal }), deadline])
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {})
      return { status: response.status, html: '' }
    }
    const declared = response.headers.get('content-length')
    if (declared && Number(declared) > maxBytes) {
      void response.body?.cancel().catch(() => {})
      throw new Error('Ultimate Guitar response body exceeds size limit')
    }
    reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let size = 0, html = ''
    if (reader) while (true) {
      const chunk = await Promise.race([reader.read(), deadline])
      if (controller.signal.aborted) throw new DOMException('Upstream deadline exceeded', 'TimeoutError')
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maxBytes) throw new Error('Ultimate Guitar response body exceeds size limit')
      html += decoder.decode(chunk.value, { stream: true })
    }
    return { status: response.status, html: html + decoder.decode() }
  } finally {
    clearTimeout(timer)
    controller.abort()
    void reader?.cancel().catch(() => {})
  }
}
