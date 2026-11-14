export type { FollowSnapshot } from '../contract'
import { CONTRACT_VERSION } from '../contract'
import type { ExtensionContext, FollowObservation, FollowSnapshot, ExtensionPanel, ExtensionSettings, ExtensionState, HostEnv, RegistryEntry } from '../contract'
import { extensionStorageKey, normalizeSettings, readExtension, validSetting } from './settings'
import type { ExtensionStorage } from './settings'

export interface ExtensionSnapshot { state: ExtensionState; message?: string; settings: ExtensionSettings; panel?: ExtensionPanel }
interface Runtime {
  entry: RegistryEntry
  snapshot: ExtensionSnapshot
  generation: number
  controller?: AbortController
  dispose?: () => void
  listeners: Set<() => void>
}
export class ExtensionHost {
  private runtimes = new Map<string, Runtime>()
  private listeners = new Set<() => void>()
  private followListeners = new Set<() => void>()
  private followSnapshot: FollowSnapshot | null = null
  private followSession = 0
  private followConnection = 0
  private identityRevision = 0
  private sourceIdentityRevision: number | undefined
  private currentSlideRead: ((signal: AbortSignal) => Promise<void>) | undefined
  requestCurrentSlideRead = (signal: AbortSignal) => this.currentSlideRead?.(signal) ?? Promise.resolve()
  private followRefresh: (() => void) | undefined
  requestFollowRefresh = () => { this.followRefresh?.() }
  getFollowSnapshot = () => this.followSnapshot
  subscribeFollow = (listener: () => void) => {
    this.followListeners.add(listener)
    return () => { this.followListeners.delete(listener) }
  }
  private publishFollow(value: FollowObservation | null) {
    const previous = this.followSnapshot
    if (!value?.live || !previous?.live) this.followConnection++
    if (value?.identityRevision !== this.sourceIdentityRevision || value?.presentation?.uuid !== previous?.presentation?.uuid || value?.presentation?.title !== previous?.presentation?.title) this.identityRevision++
    this.sourceIdentityRevision = value?.identityRevision
    if (!value?.live || !previous?.live || value.presentation?.uuid !== previous.presentation?.uuid) this.followSession++
    this.followSnapshot = value ? Object.freeze({
      ...(typeof value.currentReadSequence === 'number' && Number.isSafeInteger(value.currentReadSequence) && value.currentReadSequence > 0 ? { currentReadSequence: value.currentReadSequence } : {}),
      ...(typeof value.currentReadIdentityRevision === 'number' && value.currentReadIdentityRevision === value.identityRevision ? { currentReadIdentityRevision: this.identityRevision } : {}),
      session: this.followSession, connection: this.followConnection, identityRevision: this.identityRevision, live: value.live,
      presentation: value.presentation ? Object.freeze({ uuid: value.presentation.uuid, title: value.presentation.title, slideIndex: value.presentation.slideIndex }) : null,
      current: value.current ? Object.freeze({ uuid: value.current.uuid, text: value.current.text }) : null,
    }) : null
    for (const listener of this.followListeners) listener()
  }
  readonly entries: readonly RegistryEntry[]
  private storage: ExtensionStorage
  private env: HostEnv
  private logSink: (message: string) => void
  constructor(entries: readonly RegistryEntry[], storage: ExtensionStorage,
    env: HostEnv = { capabilities: [] }, logSink: (message: string) => void = () => {}) {
    this.entries = entries
    this.storage = storage
    this.env = env
    this.logSink = logSink
    for (const entry of entries) {
      this.runtimes.set(entry.manifest.id, { entry, generation: 0, listeners: new Set(),
        snapshot: { state: 'disabled', settings: normalizeSettings(entry.manifest, null) } })
    }
  }
  getSnapshot(id: string): ExtensionSnapshot {
    return this.runtimes.get(id)?.snapshot ?? { state: 'absent', settings: Object.freeze({}) }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(runtime: Runtime, state: ExtensionState, message?: string) {
    runtime.snapshot = { ...runtime.snapshot, state, message }
    for (const listener of this.listeners) listener()
  }
  // Explicit boot seam; construction and disabled boot never write or load a module.
  async start() {
    await Promise.all(this.entries.map(async entry => {
      const runtime = this.runtimes.get(entry.manifest.id)!
      const saved = readExtension(entry.manifest, this.storage)
      runtime.snapshot = { ...runtime.snapshot, settings: saved.settings }
      if (saved.enabled) await this.enable(entry.manifest.id)
      else this.update(runtime, 'disabled')
    }))
  }
  private persist(runtime: Runtime, enabled: boolean): boolean {
    try {
      this.storage.setItem(extensionStorageKey(runtime.entry.manifest.id), JSON.stringify({ enabled, settings: runtime.snapshot.settings }))
      return true
    } catch { return false }
  }
  private stop(runtime: Runtime) {
    runtime.generation++
    if (runtime.entry.manifest.id === 'propresenter-follower') { this.followRefresh = undefined; this.currentSlideRead = undefined; this.publishFollow(null) }
    runtime.controller?.abort()
    runtime.controller = undefined
    const dispose = runtime.dispose
    runtime.dispose = undefined
    try { dispose?.() } catch { /* Isolation: disposal cannot escape into core. */ }
    runtime.listeners.clear()
    runtime.snapshot = { ...runtime.snapshot, panel: undefined }
  }
  disable(id: string) {
    const runtime = this.runtimes.get(id)
    if (!runtime) return
    this.stop(runtime)
    this.persist(runtime, false)
    this.update(runtime, 'disabled')
  }
  async enable(id: string) {
    const runtime = this.runtimes.get(id)
    if (!runtime || ['starting', 'active', 'offline'].includes(runtime.snapshot.state)) return
    const { entry } = runtime
    const saved = readExtension(entry.manifest, this.storage)
    runtime.snapshot = { ...runtime.snapshot, settings: saved.settings }
    let generation = runtime.generation
    try {
      if (!saved.writable) { this.update(runtime, 'disabled', 'Device storage is unavailable'); return }
      if (!entry.load) { this.update(runtime, 'unavailable', 'Not yet available'); return }
      if (entry.manifest.contractVersion !== CONTRACT_VERSION || entry.manifest.capabilities.some(cap => cap.startsWith('events:') || !this.env.capabilities.includes(cap))) {
        this.update(runtime, 'unavailable', 'Not available on this device/browser'); return
      }
      const availability = entry.checkAvailability(this.env)
      if (!availability.available) { this.update(runtime, 'unavailable', availability.reason); return }
      // Probe persistence before any implementation code can run.
      if (!this.persist(runtime, true)) { this.update(runtime, 'disabled', 'Device storage is unavailable'); return }
      generation = ++runtime.generation
      const controller = new AbortController()
      runtime.controller = controller
      this.update(runtime, 'starting')
      const module = await entry.load()
      if (generation !== runtime.generation) return
      if (JSON.stringify(module.manifest) !== JSON.stringify(entry.manifest)) throw new Error('Manifest mismatch')
      const check = module.checkAvailability(this.env)
      if (!check.available) {
        this.stop(runtime); this.persist(runtime, false); this.update(runtime, 'unavailable', check.reason); return
      }
      const current = () => generation === runtime.generation && !controller.signal.aborted
      const ctx: ExtensionContext = {
        signal: controller.signal,
        settings: {
          read: () => runtime.snapshot.settings,
          subscribe: listener => {
            if (!current()) return () => {}
            runtime.listeners.add(listener)
            return () => { runtime.listeners.delete(listener) }
          },
        },
        reportStatus: (state, message) => {
          if (!current()) return
          if (state === 'error') { this.stop(runtime); this.persist(runtime, false) }
          this.update(runtime, state, this.redact(runtime, message))
        },
        log: message => { if (current()) this.logSink(this.redact(runtime, message) ?? '') },
        ...(entry.manifest.id === 'propresenter-follower' ? {
          setCurrentSlideRead: (read: (signal: AbortSignal) => Promise<void>) => { if (current()) this.currentSlideRead = signal => current() && !signal.aborted ? read(signal) : Promise.resolve() },
          setFollowRefresh: (refresh: () => void) => { if (current()) this.followRefresh = () => { if (current()) refresh() } },
          publishFollowSnapshot: (snapshot: FollowObservation) => {
            if (current()) this.publishFollow(snapshot)
          },
        } : {}),
        setPanel: panel => {
          if (!current() || !entry.manifest.capabilities.includes('ui:panel')) return
          runtime.snapshot = { ...runtime.snapshot, panel }
          for (const listener of this.listeners) listener()
        },
      }
      const dispose = module.activate(ctx)
      if (!current()) { if (typeof dispose === 'function') dispose(); return }
      if (typeof dispose !== 'function') throw new Error('Extension must return a disposer')
      runtime.dispose = dispose
      if (runtime.snapshot.state === 'starting') this.update(runtime, 'active')
    } catch {
      if (generation !== runtime.generation) return
      this.stop(runtime)
      this.persist(runtime, false)
      this.update(runtime, 'error', 'Extension stopped; retry or disable')
    }
  }
  private redact(runtime: Runtime, message?: string) {
    if (!message) return message
    let result = message
    for (const field of runtime.entry.manifest.settings) {
      const value = runtime.snapshot.settings[field.key]
      if (field.type === 'secret' && typeof value === 'string' && value) result = result.replaceAll(value, '[REDACTED]')
    }
    return result
  }
  saveSettings(id: string, values: ExtensionSettings): boolean {
    const runtime = this.runtimes.get(id)
    if (!runtime || runtime.entry.manifest.settings.some(field => !validSetting(field, values[field.key]))) return false
    const previous = runtime.snapshot
    runtime.snapshot = { ...previous, settings: normalizeSettings(runtime.entry.manifest, values) }
    if (!this.persist(runtime, ['starting', 'active', 'offline'].includes(previous.state))) { runtime.snapshot = previous; return false }
    if (id === 'propresenter-follower') this.publishFollow(null)
    for (const listener of runtime.listeners) {
      try { listener() } catch { this.stop(runtime); this.persist(runtime, false); this.update(runtime, 'error', 'Extension settings listener failed'); break }
    }
    for (const listener of this.listeners) listener()
    return true
  }
  dispose() {
    for (const runtime of this.runtimes.values()) { this.stop(runtime); this.update(runtime, 'disabled') }
    this.listeners.clear()
    this.followListeners.clear()
  }
}
