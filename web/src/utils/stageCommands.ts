/**
 * Core seam for driving Stage from outside StageView (#536). Stage registers its command runner
 * while mounted; a caller reaches Stage only through run(), with one of the nine command names.
 * Every guard (typing, overlays, Band Sync follower, held-key and song-slide locks) lives in the
 * runner and the handlers it calls, so nothing here can bypass them.
 */
export const STAGE_COMMANDS = [
  'nextSong',
  'prevSong',
  'nextSection',
  'prevSection',
  'toggleAutoScroll',
  'scrollUp',
  'scrollDown',
  'transposeUp',
  'transposeDown',
] as const

export type StageCommand = (typeof STAGE_COMMANDS)[number]
/** Returns true when the command reached its Stage handler, false when a guard blocked it. */
export type StageCommandRunner = (command: StageCommand) => boolean

export function isStageCommand(value: unknown): value is StageCommand {
  return typeof value === 'string' && (STAGE_COMMANDS as readonly string[]).includes(value)
}

let runner: StageCommandRunner | null = null

/** Stage calls this on mount and calls the returned function on unmount. */
export function registerStageCommandRunner(next: StageCommandRunner): () => void {
  runner = next
  // A stale cleanup must not remove a runner registered after it.
  return () => { if (runner === next) runner = null }
}

/** False for anything but the nine command names, and whenever Stage is not mounted. */
function run(command: unknown): boolean {
  if (!isStageCommand(command) || !runner) return false
  return runner(command) === true
}

export const stageCommands = { run }
