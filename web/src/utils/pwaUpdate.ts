// #562: manual update check for the About dialog, and the Stage guard shared with
// the service worker registration in main.tsx.
// This module only asks the worker to update and reloads the page. It never
// clears caches, unregisters the worker or touches stored data.
import { GTAR_APP_VERSION } from '../types/gtar'

const UNVERSIONED = '0.0.0-unversioned'
const WORKER_ACTIVATION_TIMEOUT_MS = 30_000

/** True while the user is on Stage; nothing may reload the page then. */
export function isStageActive(): boolean {
  return (
    window.location.pathname.includes('/stage') ||
    window.location.search.includes('view=present') ||
    window.location.hash.includes('present') ||
    Boolean((window as unknown as { __GTAR_STAGE_ACTIVE__?: boolean }).__GTAR_STAGE_ACTIVE__)
  )
}

export type UpdateCheckStatus =
  | 'up-to-date' // release.json matches the running version and the worker found nothing new
  | 'no-new-build' // build without release.json (DEV, preview): the worker found nothing new
  | 'reloading' // update ready, Stage not active: the page reloads
  | 'next-launch' // update ready or still downloading; applies on next launch
  | 'blocked' // redirect, non-JSON reply or refused worker script: sign-in needed
  | 'offline'
  | 'failed'
  | 'unavailable' // nothing to check against (no worker, no release.json)

export interface UpdateCheckResult {
  status: UpdateCheckStatus
  latestVersion?: string
}

type ReleaseCheck =
  | { state: 'same' | 'different'; version: string }
  | { state: 'blocked' | 'unreachable' | 'none' }

type WorkerCheck = 'none' | 'current' | 'updated' | 'pending' | 'failed'

export interface UpdateCheckDeps {
  runningVersion?: string
  fetchImpl?: typeof fetch
  serviceWorker?: Pick<ServiceWorkerContainer, 'getRegistration'> | null
  online?: boolean
  stageActive?: () => boolean
  reload?: () => void
  now?: () => number
  activationTimeoutMs?: number
}

async function checkRelease(runningVersion: string, fetchImpl: typeof fetch, now: () => number): Promise<ReleaseCheck> {
  if (runningVersion === UNVERSIONED) return { state: 'none' }
  let response: Response
  try {
    // Older workers precache /release.json; the query and no-store keep the reply
    // off every cache. A redirect (sign-in) is reported, never followed.
    response = await fetchImpl(`/release.json?check=${now()}`, { cache: 'no-store', redirect: 'manual' })
  } catch {
    return { state: 'unreachable' }
  }
  if (response.type === 'opaqueredirect' || response.redirected || !response.ok) return { state: 'blocked' }
  let version: unknown
  try {
    version = (JSON.parse(await response.text()) as { version?: unknown } | null)?.version
  } catch {
    return { state: 'blocked' }
  }
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) return { state: 'blocked' }
  return { state: version === runningVersion ? 'same' : 'different', version }
}

function waitForActivation(worker: ServiceWorker, timeoutMs: number): Promise<WorkerCheck> {
  if (worker.state === 'activated') return Promise.resolve('updated')
  if (worker.state === 'redundant') return Promise.resolve('failed')
  return new Promise(resolve => {
    const finish = (result: WorkerCheck) => {
      clearTimeout(timer)
      worker.removeEventListener('statechange', onChange)
      resolve(result)
    }
    const onChange = () => {
      if (worker.state === 'activated') finish('updated')
      else if (worker.state === 'redundant') finish('failed')
    }
    const timer = setTimeout(() => finish('pending'), timeoutMs)
    worker.addEventListener('statechange', onChange)
  })
}

async function checkWorker(serviceWorker: UpdateCheckDeps['serviceWorker'], timeoutMs: number): Promise<WorkerCheck> {
  if (!serviceWorker) return 'none'
  try {
    const registration = await serviceWorker.getRegistration()
    if (!registration) return 'none'
    await registration.update()
    const incoming = registration.installing ?? registration.waiting
    return incoming ? await waitForActivation(incoming, timeoutMs) : 'current'
  } catch {
    // The worker script could not be fetched: offline, or a redirect the browser refuses for worker scripts.
    return 'failed'
  }
}

export async function checkForUpdates(deps: UpdateCheckDeps = {}): Promise<UpdateCheckResult> {
  const online = deps.online ?? (typeof navigator === 'undefined' || navigator.onLine !== false)
  if (!online) return { status: 'offline' }
  const serviceWorker = deps.serviceWorker !== undefined
    ? deps.serviceWorker
    : (typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null)
  const [worker, release] = await Promise.all([
    checkWorker(serviceWorker, deps.activationTimeoutMs ?? WORKER_ACTIVATION_TIMEOUT_MS),
    checkRelease(deps.runningVersion ?? GTAR_APP_VERSION, deps.fetchImpl ?? ((input, init) => fetch(input, init)), deps.now ?? Date.now),
  ])
  const result = (status: UpdateCheckStatus): UpdateCheckResult =>
    'version' in release ? { status, latestVersion: release.version } : { status }

  if (release.state === 'blocked') return result('blocked')
  if (release.state === 'unreachable') return result(worker === 'failed' ? 'offline' : 'failed')
  if (worker === 'failed') return result(release.state === 'none' ? 'failed' : 'blocked')
  if (worker === 'pending') return result('next-launch')
  if (worker === 'updated' || release.state === 'different') {
    if ((deps.stageActive ?? isStageActive)()) return result('next-launch')
    ;(deps.reload ?? (() => window.location.reload()))()
    return result('reloading')
  }
  if (release.state === 'same') return result('up-to-date')
  return result(worker === 'current' ? 'no-new-build' : 'unavailable')
}

export function describeUpdateCheck(result: UpdateCheckResult): string {
  const version = result.latestVersion ? ` v${result.latestVersion}` : ''
  switch (result.status) {
    case 'up-to-date': return 'Up to date.'
    case 'no-new-build': return 'No new build found.'
    case 'reloading': return `Updating${version ? ` to${version}` : ''}…`
    case 'next-launch': return `Update${version} applies on next launch.`
    case 'blocked': return 'Update check blocked. Sign-in needed.'
    case 'offline': return 'Offline. Try again when connected.'
    case 'failed': return 'Update check failed. Try again.'
    case 'unavailable': return 'Update check is not available here.'
  }
}
