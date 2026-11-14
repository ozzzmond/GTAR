import type { ExtensionContext, FollowObservation } from '../contract'

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
      if (!this.buffer && char !== '{') throw new UnexpectedResponse()
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
const unexpectedMessage = 'Unexpected response from ProPresenter'
class UnexpectedResponse extends Error {
  constructor() { super(unexpectedMessage) }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function slide(value: unknown): Slide {
  if (!record(value) || typeof value.text !== 'string' || typeof value.notes !== 'string' || typeof value.uuid !== 'string') throw new UnexpectedResponse()
  // Project only displayed fields. Notes and unknown fields are not retained.
  return { uuid: value.uuid, text: value.text }
}
function slides(value: unknown): Slides {
  if (!record(value)) throw new UnexpectedResponse()
  return { current: slide(value.current), next: slide(value.next) }
}
function presentationName(value: unknown): string {
  // Real 7.13 uses presentation_index; Swagger's presentation $ref points at the announcement schema.
  // Follow the owner-tested response only; do not accept the incorrect presentation alias.
  if (!record(value)) throw new UnexpectedResponse()
  if (value.presentation_index === null) return ''
  if (!record(value.presentation_index) || !record(value.presentation_index.presentation_id) || typeof value.presentation_index.presentation_id.name !== 'string') throw new UnexpectedResponse()
  return value.presentation_index.presentation_id.name
}
function presentationIdentity(value: unknown): FollowObservation['presentation'] {
  if (!record(value) || !record(value.presentation_index)) return null
  const data = value.presentation_index
  const id = data.presentation_id
  // Older/name-only responses still render in the panel, but cannot enable assisted following.
  if (!record(id) || typeof id.uuid !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id.uuid) ||
    typeof id.name !== 'string' || !id.name.trim() ||
    !Number.isSafeInteger(data.index) || Number(data.index) < 0 ||
    !Number.isSafeInteger(id.index) || Number(id.index) < 0) return null
  return { uuid: id.uuid, title: id.name, slideIndex: Number(data.index) }
}
export class SlideDedupe {
  private last?: string
  accept(state: Slides): boolean {
    const pair = JSON.stringify([state.current.uuid, state.current.text, state.next.uuid, state.next.text])
    if (this.last && this.last === pair) return false
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
  let identity: FollowObservation['presentation'] = null
  let observedCurrent: FollowObservation['current'] = null
  let status = 'Connecting'
  let testResult = ''
  let disposed = false
  let generation = 0
  let identityRevision = 0
  let testController: AbortController | undefined
  let testTimer: ReturnType<typeof setTimeout> | undefined
  const connections = new Set<AbortController>()
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const live = [false, false]
  const fresh = [false, false]
  const unexpected = [false, false]
  const publish = () => {
    ctx.publishFollowSnapshot?.({
      live: fresh.every(Boolean) && live.every(Boolean) && !unexpected.some(Boolean) && !!identity && !!observedCurrent,
      presentation: identity, current: observedCurrent, identityRevision,
    })
    ctx.setPanel({ fields: [
    { label: 'Status', value: status },
    { label: 'Data state', value: displayed ? live.every(Boolean) && !unexpected.some(Boolean) ? 'Current' : 'Stale' : '' },
    { label: 'Host', value: String(ctx.settings.read().host) },
    { label: 'Presentation', value: presentation },
    { label: 'Current slide', value: displayed?.current.text ?? '' },
    { label: 'Next slide', value: displayed?.next.text ?? '' },
    { label: 'Connection test', value: testResult },
  ], actions: [{ label: 'Test connection', disabled: !!testController || page.hidden, run: () => { void testConnection() } }] })
  }
  const request = (url: string, signal: AbortSignal) => fetch(url, { method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', signal })
  const cancel = (reader: ReadableStreamDefaultReader<Uint8Array>) => { void reader.cancel().catch(() => {}) }
  const current = (epoch: number) => !disposed && !page.hidden && generation === epoch
  const updateStatus = () => {
    const healthy = live.every(Boolean) && !unexpected.some(Boolean)
    status = unexpected.some(Boolean) ? unexpectedMessage : healthy ? 'Live' : 'Stale / Offline'
    ctx.reportStatus(healthy ? 'active' : 'offline', status)
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
        if (frames.length) {
          for (const frame of frames) slides(frame)
          unexpected[0] = false; testResult = 'Connected'; break
        }
      }
    } catch (error) {
      if (current(epoch)) {
        if (error instanceof UnexpectedResponse) { unexpected[0] = true; testResult = unexpectedMessage }
        else testResult = `Cannot reach ProPresenter. ${hint}`
      }
    }
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
              observedCurrent = state.current.uuid ? state.current : null
              if (dedupe.accept(state)) displayed = state
            } else {
              presentation = presentationName(frame)
              identity = presentationIdentity(frame)
              identityRevision++
            }
            failures = 0
            unexpected[index] = false
            live[index] = true
            fresh[index] = true
            updateStatus()
          }
        }
      } catch (error) {
        if (current(epoch)) {
          if (error instanceof UnexpectedResponse) unexpected[index] = true
          live[index] = false
          fresh.fill(false)
          identity = null
          observedCurrent = null
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
    fresh.fill(false)
    identity = null; observedCurrent = null
    publish()
  }
  function restart() {
    pause()
    if (disposed) return
    if (page.hidden) { updateStatus(); return }
    status = unexpected.some(Boolean) ? unexpectedMessage : 'Connecting'
    ctx.reportStatus(unexpected.some(Boolean) ? 'offline' : 'active', status)
    publish()
    feed(0, generation); feed(1, generation)
  }
  function settingsChanged() {
    displayed = undefined; presentation = ''; testResult = ''; dedupe = new SlideDedupe()
    unexpected.fill(false)
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
  ctx.setFollowRefresh?.(restart)
  page.addEventListener('visibilitychange', restart)
  ctx.signal.addEventListener('abort', dispose, { once: true })
  restart()
  return dispose
}
