import type { ActiveSongState, WebSetlist } from '../types/gtar'
import type { FollowSnapshot } from '../extensions/host/ExtensionHost'

export interface FollowEntry { readonly index: number; readonly entryId: string; readonly songId: string | number; readonly title: string; readonly artist: string; readonly eligible: boolean }
export interface FollowSetlist { readonly id: string | number; readonly entries: readonly FollowEntry[] }
export interface FollowSelection {
  readonly context: FollowSetlist
  readonly fromIndex: number
  readonly index: number
  readonly manualRevision: number
  readonly isCurrent: () => boolean
}
// Only already-resolved active entries cross this boundary, never a library/search API.
export function projectFollowSetlist(activeId: string | number | null, queue: string, list: WebSetlist | null, entries: readonly ActiveSongState[]): FollowSetlist | null {
  if (queue !== 'setlist' || !list || list.isDeleted || list.id !== activeId || !list.songs.length || list.songs.length !== entries.length) return null
  const ids = new Set<string>()
  const projection = list.songs.map((ref, index): FollowEntry => {
    const song = entries[index]
    const entryId = ref.entryId
    const unique = !!entryId && !ids.has(entryId)
    ids.add(entryId)
    return { index, entryId, songId: ref.id, title: song.title, artist: song.artist ?? '',
      eligible: unique && ref.id === song.id && !song.isMissing && !song.isDeleted }
  })
  if (ids.size !== projection.length || projection.some(entry => !entry.entryId)) return null
  return { id: list.id, entries: projection }
}
export function normalizePresentationTitle(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(/[\u2019\u2018\u02bc]/gu, "'").replace(/[\u2010-\u2014\u2212]/gu, '-').trim().replace(/\s+/gu, ' ')
}
export type FollowResolution = { kind: 'target'; index: number } | { kind: 'absent' | 'ambiguous'; choices: readonly FollowEntry[] }
export function resolveSetlistPresentation(context: FollowSetlist, currentIndex: number, title: string, linkedSong?: string | number): FollowResolution {
  const normalized = normalizePresentationTitle(title)
  const choices = context.entries.filter(entry => entry.eligible && (linkedSong !== undefined ? entry.songId === linkedSong : !!normalized && normalizePresentationTitle(entry.title) === normalized))
  if (!choices.length) return { kind: 'absent', choices }
  const identities = new Set(choices.map(entry => entry.songId))
  if (identities.size !== 1) return { kind: 'ambiguous', choices }
  if (choices.some(entry => entry.index === currentIndex)) return { kind: 'target', index: currentIndex }
  if (choices.length !== 1) return { kind: 'ambiguous', choices }
  return { kind: 'target', index: choices[0].index }
}
export interface AutoFollowInput {
  readonly dev: boolean
  readonly fullscreen: boolean
  readonly suspended: boolean
  readonly account: string
  readonly context: FollowSetlist | null
  readonly selectedIndex: number
  readonly manualRevision: number
  readonly snapshot: FollowSnapshot | null
  readonly readSnapshot: () => FollowSnapshot | null
  readonly select: (request: FollowSelection) => boolean
  readonly refresh: () => void
}
export interface AutoFollowState { readonly mode: 'assisted' | 'auto'; readonly paused: boolean; readonly status: string; readonly choices: readonly FollowEntry[] }
const SETTLE_MS = 300
// DEV Option B: latest observed identity; settling is mitigation, not atomic correlation.
export class SetlistAutoFollower {
  private input: AutoFollowInput | null = null
  private state: AutoFollowState = { mode: 'assisted', paused: false, status: 'Assisted - manual song selection', choices: [] }
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private expectedIndex: number | undefined
  private freshAfter = -1
  private links = new Map<string, string | number>()
  private scheduleTimer: typeof setTimeout
  private cancelTimer: typeof clearTimeout
  constructor(schedule: typeof setTimeout = setTimeout, cancel: typeof clearTimeout = clearTimeout) { this.scheduleTimer = schedule; this.cancelTimer = cancel }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  getSnapshot = () => this.state
  private publish(status: string, paused = this.state.paused, choices: readonly FollowEntry[] = []) {
    if (this.state.status === status && this.state.paused === paused && !choices.length && !this.state.choices.length) return
    this.state = { ...this.state, status, paused, choices }
    for (const listener of this.listeners) listener()
  }
  private cancel() { this.generation++; if (this.timer !== undefined) this.cancelTimer(this.timer); this.timer = undefined }
  private eligible(input = this.input): input is AutoFollowInput & { context: FollowSetlist; snapshot: FollowSnapshot } {
    return !!input?.dev && input.fullscreen && !input.suspended && !!input.context && !!input.context.entries[input.selectedIndex]?.eligible && !!input.snapshot?.live && !!input.snapshot.presentation
  }
  private current(input: AutoFollowInput, generation: number) {
    const actual = input.readSnapshot()
    return generation === this.generation && this.input?.context === input.context && this.input?.selectedIndex === input.selectedIndex &&
      this.input?.manualRevision === input.manualRevision && this.input?.account === input.account && this.eligible(this.input) && this.eligible(input) &&
      !!actual?.live && actual.connection === input.snapshot?.connection && actual.identityRevision === input.snapshot?.identityRevision &&
      actual.presentation?.uuid === input.snapshot?.presentation?.uuid && actual.presentation?.title === input.snapshot?.presentation?.title
  }
  update(input: AutoFollowInput) {
    const previous = this.input
    this.input = input
    const uiBoundary = !!previous && (previous.context !== input.context || previous.account !== input.account || previous.fullscreen !== input.fullscreen || previous.suspended !== input.suspended)
    const boundary = uiBoundary || !!previous && previous.snapshot?.connection !== input.snapshot?.connection
    const manual = !!previous && (previous.manualRevision !== input.manualRevision || previous.selectedIndex !== input.selectedIndex && input.selectedIndex !== this.expectedIndex)
    if (input.selectedIndex === this.expectedIndex) this.expectedIndex = undefined
    if (boundary || manual) {
      this.cancel()
      this.expectedIndex = undefined
      if (boundary) {
        if (uiBoundary || previous?.snapshot?.live) this.freshAfter = Math.max(this.freshAfter, previous?.snapshot?.identityRevision ?? -1)
        this.links.clear()
      }
      if (this.state.mode === 'auto') this.publish(manual ? 'Manual selection - Resume Auto Follow' : 'Auto Follow paused - fresh identity and Resume required', true)
    }
    if (this.state.mode !== 'auto' || this.state.paused) return
    if (!this.eligible(input)) { this.cancel(); this.freshAfter = Math.max(this.freshAfter, input.snapshot?.identityRevision ?? -1); this.publish('Auto Follow paused - check fullscreen, setlist and connection', true); return }
    const changed = !previous || boundary || previous.snapshot?.identityRevision !== input.snapshot.identityRevision || previous.snapshot?.presentation?.uuid !== input.snapshot.presentation?.uuid
    if (changed) this.schedule()
  }
  enable = () => {
    if (this.state.mode === 'auto') { this.resume(); return }
    if (!this.eligible()) return
    if (this.input!.snapshot!.identityRevision <= this.freshAfter) {
      this.publish('Refreshing identity - enable Auto Follow when connected', true)
      this.input!.refresh()
      return
    }
    this.state = { ...this.state, mode: 'auto' }
    this.publish('Auto Follow - settling latest identity', false)
    this.schedule()
  }
  assisted = () => {
    this.cancel(); this.links.clear(); this.expectedIndex = undefined
    this.state = { mode: 'assisted', paused: false, status: 'Assisted - manual song selection', choices: [] }
    for (const listener of this.listeners) listener()
  }
  resume = () => {
    if (this.state.mode !== 'auto') return
    if (!this.eligible()) { this.publish('Waiting for healthy fullscreen setlist state', true); return }
    if (this.input!.snapshot!.identityRevision <= this.freshAfter) {
      this.publish('Refreshing identity - press Resume when connected', true)
      this.input!.refresh()
      return
    }
    this.publish('Auto Follow - settling latest identity', false)
    this.schedule()
  }
  override = () => {
    if (this.state.mode !== 'auto') return
    this.cancel()
    this.publish('Manual selection - Resume Auto Follow', true)
  }
  associateCurrent = () => {
    if (!this.eligible()) return
    const input = this.input!
    const actual = input.readSnapshot()
    if (actual?.session !== input.snapshot?.session || !actual?.live || !actual.presentation) return
    this.links.set(actual.presentation.uuid, input.context!.entries[input.selectedIndex].songId)
  }
  choose = (index: number) => {
    if (this.state.mode !== 'auto' || !this.eligible() || !this.state.choices.some(entry => entry.index === index)) return
    const input = this.input!, generation = this.generation
    if (!this.current(input, generation)) return
    if (this.apply(input, index, generation)) {
      this.links.set(input.snapshot!.presentation!.uuid, input.context!.entries[index].songId)
      this.publish('Following explicitly selected setlist entry - lyrics require confirmation', false)
    }
  }
  private apply(input: AutoFollowInput, index: number, generation: number) {
    if (!this.current(input, generation) || !input.context?.entries[index]?.eligible) return false
    if (index === input.selectedIndex) return true
    this.expectedIndex = index
    if (!input.select({ context: input.context, fromIndex: input.selectedIndex, index, manualRevision: input.manualRevision, isCurrent: () => this.current(input, generation) })) { this.expectedIndex = undefined; return false }
    return true
  }
  private schedule() {
    this.cancel()
    const input = this.input
    if (this.state.mode !== 'auto' || !this.eligible(input) || this.state.paused) return
    const generation = this.generation
    this.publish('Auto Follow - settling latest identity')
    this.timer = this.scheduleTimer(() => {
      this.timer = undefined
      if (!this.current(input, generation)) return
      const resolution = resolveSetlistPresentation(input.context!, input.selectedIndex, input.snapshot!.presentation!.title, this.links.get(input.snapshot!.presentation!.uuid))
      if (resolution.kind === 'absent') this.publish('Not in current setlist')
      else if (resolution.kind === 'ambiguous') this.publish('Choose a setlist entry for this presentation', false, resolution.choices)
      else if (resolution.kind === 'target' && this.apply(input, resolution.index, generation)) this.publish('Following latest observed identity - lyrics require confirmation')
    }, SETTLE_MS)
  }
  dispose = () => { this.cancel(); this.links.clear(); this.input = null; this.expectedIndex = undefined }
}
