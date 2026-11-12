import type { ExtensionContext } from '../contract'

export const paths = ['/v1/status/slide', '/v1/presentation/slide_index'] as const
export function buildUrl(host: string, path: typeof paths[number]): string {
  if (!paths.includes(path) || host.length > 253 ||
    !host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part)) ||
    (/^[\d.]+$/.test(host) && (host.split('.').length !== 4 || !host.split('.').every(part => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)))) throw Error('Invalid host')
  const url = new URL(`http://${host}:1025${path}?chunked=true`)
  if (url.hostname !== host.toLowerCase()) throw Error('Invalid host')
  return url.href
}

// Network reads and JSON lines are not frames. One decoder/framer per connection.
export class ObjectFrames {
  private decoder = new TextDecoder('utf-8', { fatal: true })
  private buffer = ''
  private stack: string[] = []
  private quoted = false
  private escaped = false
  push(bytes: Uint8Array): unknown[] {
    const frames: unknown[] = []
    for (const char of this.decoder.decode(bytes, { stream: true })) {
      if (!this.buffer && /\s/.test(char)) continue
      if (!this.buffer && char !== '{') throw Error('Expected object')
      this.buffer += char
      if (this.buffer.length > 1024 * 1024) throw Error('Frame too large')
      if (this.quoted) {
        if (this.escaped) this.escaped = false
        else if (char === '\\') this.escaped = true
        else if (char === '"') this.quoted = false
      } else if (char === '"') this.quoted = true
      else if (char === '{' || char === '[') this.stack.push(char)
      else if (char === '}' || char === ']') {
        if (this.stack.pop() !== (char === '}' ? '{' : '[')) throw Error('Mismatched nesting')
        if (!this.stack.length) {
          frames.push(JSON.parse(this.buffer))
          this.buffer = ''
        }
      }
    }
    return frames
  }
  finish() {
    this.decoder.decode()
    if (this.buffer) throw Error('Incomplete frame')
  }
}
type Slide = { uuid: string; text: string }
export type Slides = { current: Slide; next: Slide }
function slides(value: unknown): Slides {
  const data = value as Slides
  if (!data || !data.current || !data.next || [data.current, data.next].some(slide => typeof slide.uuid !== 'string' || typeof slide.text !== 'string')) throw Error('Invalid slide state')
  return { current: { uuid: data.current.uuid, text: data.current.text }, next: { uuid: data.next.uuid, text: data.next.text } }
}
export class SlideDedupe {
  private last?: readonly [string, string]
  accept(state: Slides): boolean {
    const pair = [state.current.uuid, state.next.uuid] as const
    if (this.last && this.last[0] === pair[0] && this.last[1] === pair[1]) return false
    this.last = pair
    return true
  }
}
export const retryDelay = (failures: number, random = Math.random) => Math.min(30000, 1000 * 2 ** Math.min(failures, 5) * (0.8 + random() * 0.4))
const hint = 'Check the same Wi-Fi, enable the ProPresenter network setting, and allow local network access for this site.'

export function activate(ctx: ExtensionContext) {
  const page = document
  let dedupe = new SlideDedupe()
  let displayed: Slides | undefined
  let presentation = ''
  let status = 'Connecting'
  let testResult = ''
  let disposed = false
  let generation = 0
  let testController: AbortController | undefined
  let testTimer: ReturnType<typeof setTimeout> | undefined
  const connections = new Set<AbortController>()
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const live = [false, false]
  const publish = () => ctx.setPanel({ fields: [
    { label: 'Status', value: status },
    { label: 'Host', value: String(ctx.settings.read().host) },
    { label: 'Presentation', value: presentation },
    { label: 'Current slide', value: displayed?.current.text ?? '' },
    { label: 'Next slide', value: displayed?.next.text ?? '' },
    { label: 'Connection test', value: testResult },
  ], actions: [{ label: 'Test connection', disabled: !!testController || page.hidden, run: () => { void testConnection() } }] })
  const request = (url: string, signal: AbortSignal) => fetch(url, { method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', signal })
  const cancel = (reader: ReadableStreamDefaultReader<Uint8Array>) => { void reader.cancel().catch(() => {}) }
  const current = (epoch: number) => !disposed && !page.hidden && generation === epoch
  const updateStatus = () => {
    status = live.every(Boolean) ? 'Live' : 'Stale / Offline'
    ctx.reportStatus(live.every(Boolean) ? 'active' : 'offline', status)
    publish()
  }
  async function testConnection() {
    if (disposed || page.hidden || testController) return
    pause()
    const epoch = generation
    const controller = new AbortController()
    testController = controller
    testResult = ''
    publish()
    // Same allowlisted URL, cancel after initial snapshot: no persistent test stream.
    testTimer = setTimeout(() => controller.abort(), 10000)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const response = await request(buildUrl(String(ctx.settings.read().host), paths[0]), controller.signal)
      if (!response.ok || !response.body) throw Error('No response')
      if (!current(epoch)) return
      reader = response.body.getReader()
      readers.add(reader)
      const parser = new ObjectFrames()
      while (current(epoch)) {
        const part = await reader.read()
        if (!current(epoch)) return
        if (part.done) throw Error('EOF')
        const frames = parser.push(part.value)
        if (frames.length) { slides(frames[0]); testResult = 'Connected'; break }
      }
    } catch { if (current(epoch)) testResult = `Cannot reach ProPresenter. ${hint}` }
    finally {
      controller.abort()
      if (reader) { cancel(reader); readers.delete(reader) }
      if (testController === controller) {
        if (testTimer) clearTimeout(testTimer)
        testTimer = undefined; testController = undefined
        if (current(epoch)) restart()
      }
    }
  }
  function feed(index: number, epoch: number, failures = 0) {
    if (!current(epoch)) return
    const controller = new AbortController()
    connections.add(controller)
    void (async () => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      try {
        const response = await request(buildUrl(String(ctx.settings.read().host), paths[index]), controller.signal)
        if (!current(epoch)) return
        if (!response.ok || !response.body) throw Error('No stream')
        reader = response.body.getReader()
        readers.add(reader)
        const parser = new ObjectFrames()
        while (current(epoch)) {
          const part = await reader.read()
          if (!current(epoch)) return
          if (part.done) { parser.finish(); throw Error('EOF') }
          for (const frame of parser.push(part.value)) {
            if (index === 0) {
              const state = slides(frame)
              if (dedupe.accept(state)) displayed = state
            } else {
              const data = frame as { presentation: null | { presentation_id: { name: string } } }
              if (!data || !('presentation' in data) || (data.presentation !== null && typeof data.presentation?.presentation_id?.name !== 'string')) throw Error('Invalid presentation')
              presentation = data.presentation?.presentation_id.name ?? ''
            }
            failures = 0
            live[index] = true
            updateStatus()
          }
        }
      } catch {
        if (current(epoch)) {
          live[index] = false
          updateStatus()
        }
      } finally {
        controller.abort()
        connections.delete(controller)
        if (reader) { cancel(reader); readers.delete(reader) }
        if (current(epoch)) {
          const timer = setTimeout(() => { timers.delete(timer); feed(index, epoch, failures + 1) }, retryDelay(failures))
          timers.add(timer)
        }
      }
    })()
  }
  function pause() {
    generation++
    for (const controller of connections) controller.abort()
    connections.clear()
    for (const reader of readers) cancel(reader)
    readers.clear()
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    testController?.abort(); testController = undefined
    if (testTimer) clearTimeout(testTimer)
    testTimer = undefined
    live.fill(false)
  }
  function restart() {
    pause()
    if (disposed) return
    if (page.hidden) { updateStatus(); return }
    status = 'Connecting'
    ctx.reportStatus('active', status)
    publish()
    feed(0, generation); feed(1, generation)
  }
  function settingsChanged() {
    displayed = undefined; presentation = ''; testResult = ''; dedupe = new SlideDedupe()
    restart()
  }
  const unsubscribe = ctx.settings.subscribe(settingsChanged)
  const dispose = () => {
    if (disposed) return
    disposed = true
    pause()
    displayed = undefined; presentation = ''
    unsubscribe()
    page.removeEventListener('visibilitychange', restart)
    ctx.signal.removeEventListener('abort', dispose)
  }
  page.addEventListener('visibilitychange', restart)
  ctx.signal.addEventListener('abort', dispose, { once: true })
  restart()
  return dispose
}
