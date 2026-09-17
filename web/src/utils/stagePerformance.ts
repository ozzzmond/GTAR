type VendorDocument = Document & {
  webkitFullscreenEnabled?: boolean; mozFullScreenEnabled?: boolean; msFullscreenEnabled?: boolean
  webkitFullscreenElement?: Element; mozFullScreenElement?: Element; msFullscreenElement?: Element
  webkitExitFullscreen?: () => void; mozCancelFullScreen?: () => void; msExitFullscreen?: () => void
}
type VendorElement = HTMLElement & {
  webkitRequestFullscreen?: () => void; mozRequestFullScreen?: () => void; msRequestFullscreen?: () => void
}
/**
 * stagePerformance.ts
 *
 * Cross-platform utilities for GTAR Stage View gig performance:
 *   1. Fullscreen — safe feature-detection wrapper with iOS / iOS-PWA awareness.
 *   2. Screen Wake Lock — keeps the screen awake while on stage, with automatic
 *      re-acquisition after tab switches and clean release on unmount.
 *
 * Both factories return plain objects (no React dependency) so they can be
 * unit-tested independently and composed easily inside useEffect hooks.
 */

// ---------------------------------------------------------------------------
// Platform detection helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when running inside an iOS standalone PWA (Add to Home Screen)
 * or when the browser is iOS Safari where requestFullscreen is unsupported.
 *
 * iOS detection strategy (no user-agent string parsing):
 *   - `navigator.standalone` is `true` only in iOS standalone PWA.
 *   - `matchMedia('(display-mode: standalone)')` covers both iOS and Android PWAs,
 *     but we combine it with the touch check to target iOS specifically.
 *   - `navigator.maxTouchPoints > 1` + lack of `MSStream` (IE guard) reliably
 *     identifies iOS without sniffing the UA string.
 */
export function isIosDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false

  const ua = navigator.userAgent || ''
  const platform = (navigator as unknown as { platform?: string }).platform || ''

  // 1. Direct UA string match (standard iPhone / iPad / iPod)
  if (/iPhone|iPad|iPod/i.test(ua)) return true

  // 2. Direct navigator.platform match
  if (/iPhone|iPad|iPod/i.test(platform)) return true

  // 3. iPadOS 13+ or desktop-mode iPhone/iPad:
  // Apple masks UA as Macintosh/MacIntel, but device has touch capability
  const touchPoints = typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0
  const hasTouch =
    touchPoints > 0 ||
    (typeof window !== 'undefined' && 'ontouchstart' in window) ||
    (typeof document !== 'undefined' && 'ontouchend' in document)
  if (/Macintosh|MacIntel/i.test(platform) && hasTouch) return true
  if (/Macintosh/i.test(ua) && hasTouch) return true

  // 4. iOS Safari standalone API heuristic (WebKit on iOS)
  if ('standalone' in navigator) return true

  return false
}

/**
 * Returns true when the app is running as an installed iOS or Android PWA
 * in standalone display mode (i.e. no browser chrome / address bar).
 */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  // navigator.standalone is iOS-specific (true when launched from Home Screen)
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true
  // display-mode: standalone covers Android Chrome PWAs and iOS Safari PWAs
  try {
    return window.matchMedia('(display-mode: standalone)').matches
  } catch {
    return false
  }
}

/**
 * Returns true when the native Fullscreen API is available and usable.
 * iOS Safari does NOT support requestFullscreen on arbitrary elements.
 */
export function isFullscreenApiSupported(): boolean {
  if (typeof document === 'undefined') return false
  return Boolean(
    document.fullscreenEnabled ||
      (document as VendorDocument).webkitFullscreenEnabled ||
      (document as VendorDocument).mozFullScreenEnabled ||
      (document as VendorDocument).msFullscreenEnabled
  )
}

// ---------------------------------------------------------------------------
// 1. Fullscreen Controller
// ---------------------------------------------------------------------------

export interface FullscreenController {
  /**
   * Toggle between fullscreen and windowed mode.
   * On iOS where the API is unavailable, this is a no-op (use the `isSupported`
   * flag to show a platform-appropriate fallback instead).
   */
  toggle(): void
  /** True when the native Fullscreen API is available on this browser. */
  readonly isSupported: boolean
  /**
   * Register a callback that fires whenever the fullscreen state changes
   * (covers both programmatic toggling and the user pressing Escape).
   * Returns an unsubscribe function.
   */
  onChange(callback: (isFullscreen: boolean) => void): () => void
  /** Remove all event listeners added by this controller. */
  cleanup(): void
}

export function createFullscreenController(): FullscreenController {
  const supported = isFullscreenApiSupported()
  const listeners: Array<(isFullscreen: boolean) => void> = []

  function getCurrentState(): boolean {
    return Boolean(
      document.fullscreenElement ||
        (document as VendorDocument).webkitFullscreenElement ||
        (document as VendorDocument).mozFullScreenElement ||
        (document as VendorDocument).msFullscreenElement
    )
  }

  function dispatchChange() {
    const state = getCurrentState()
    listeners.forEach((cb) => cb(state))
  }

  // Vendor-prefixed event names
  const EVENTS = [
    'fullscreenchange',
    'webkitfullscreenchange',
    'mozfullscreenchange',
    'MSFullscreenChange',
  ]

  if (supported) {
    EVENTS.forEach((evt) => document.addEventListener(evt, dispatchChange))
  }

  const controller: FullscreenController = {
    get isSupported() {
      return supported
    },

    toggle() {
      if (!supported) return
      try {
        if (getCurrentState()) {
          // Exit fullscreen
          if (document.exitFullscreen) {
            document.exitFullscreen().catch(() => {})
          } else if ((document as VendorDocument).webkitExitFullscreen) {
            ;(document as VendorDocument).webkitExitFullscreen?.()
          } else if ((document as VendorDocument).mozCancelFullScreen) {
            ;(document as VendorDocument).mozCancelFullScreen?.()
          } else if ((document as VendorDocument).msExitFullscreen) {
            ;(document as VendorDocument).msExitFullscreen?.()
          }
        } else {
          // Enter fullscreen on the root element
          const el = document.documentElement
          if (el.requestFullscreen) {
            el.requestFullscreen().catch(() => {})
          } else if ((el as VendorElement).webkitRequestFullscreen) {
            ;(el as VendorElement).webkitRequestFullscreen?.()
          } else if ((el as VendorElement).mozRequestFullScreen) {
            ;(el as VendorElement).mozRequestFullScreen?.()
          } else if ((el as VendorElement).msRequestFullscreen) {
            ;(el as VendorElement).msRequestFullscreen?.()
          }
        }
      } catch {
        // Ignore any synchronous errors (e.g. NotAllowedError in some browsers
        // when called outside a user gesture — shouldn't happen but guard anyway)
      }
    },

    onChange(callback) {
      listeners.push(callback)
      return () => {
        const idx = listeners.indexOf(callback)
        if (idx !== -1) listeners.splice(idx, 1)
      }
    },

    cleanup() {
      if (supported) {
        EVENTS.forEach((evt) => document.removeEventListener(evt, dispatchChange))
      }
      listeners.length = 0
    },
  }

  return controller
}

// ---------------------------------------------------------------------------
// 2. Screen Wake Lock Controller
// ---------------------------------------------------------------------------

export interface WakeLockController {
  /**
   * Request a screen wake lock. Safe to call if already held or unsupported.
   * Returns a promise that resolves when the lock is acquired (or immediately
   * if unsupported, so callers can always await it).
   */
  acquire(): Promise<void>
  /** Release the current wake lock sentinel if held. */
  release(): Promise<void>
  /** Release the lock and remove all internal listeners. */
  cleanup(): Promise<void>
  /** Whether the Wake Lock API is available in this browser. */
  readonly isSupported: boolean
}

export function createWakeLockController(): WakeLockController {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator

  let sentinel: WakeLockSentinel | null = null
  let visibilityHandler: (() => void) | null = null
  let destroyed = false

  let pending: Promise<void> | null = null
  let releaseGeneration = 0
  function acquireInternal(): Promise<void> {
    if (!supported || destroyed || (sentinel && !sentinel.released)) return Promise.resolve()
    if (pending) return pending
    const generation = releaseGeneration
    pending = (async () => {
      try {
        const acquired = await navigator.wakeLock.request('screen')
        if (destroyed || generation !== releaseGeneration) await acquired.release()
        else sentinel = acquired
      } catch {
        // Hidden pages and denied requests are expected.
      } finally { pending = null }
    })()
    return pending
  }

  async function releaseInternal(): Promise<void> {
    releaseGeneration++
    if (sentinel && !sentinel.released) {
      try {
        await sentinel.release()
      } catch {
        // Ignore errors during release (e.g. already released by browser)
      }
    }
    sentinel = null
  }

  // Re-acquire when the tab becomes visible again (handles Alt+Tab / home button)
  function setupVisibilityListener() {
    if (!supported) return
    visibilityHandler = () => {
      if (document.visibilityState === 'visible' && !destroyed) {
        acquireInternal()
      }
    }
    document.addEventListener('visibilitychange', visibilityHandler)
  }

  function teardownVisibilityListener() {
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
  }

  // Set up the re-acquisition listener eagerly so it's ready before acquire()
  setupVisibilityListener()

  const controller: WakeLockController = {
    get isSupported() {
      return supported
    },

    async acquire() {
      await acquireInternal()
    },

    async release() {
      await releaseInternal()
    },

    async cleanup() {
      destroyed = true
      teardownVisibilityListener()
      await releaseInternal()
    },
  }

  return controller
}
