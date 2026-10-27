// In-memory LockManager with Web Locks semantics for the calls GTAR makes: exclusive mode,
// ifAvailable (callback gets null when held), FIFO waiting otherwise, release when the callback's
// promise settles (resolve or reject). Several "tabs" share one instance to model one origin.
class FakeLockManager {
  constructor() { this.held = new Map(); this.waiting = new Map(); this.requests = []; this.failNext = null }
  async request(name, options, callback) {
    if (typeof options === 'function') { callback = options; options = {} }
    this.requests.push({ name, options })
    if (this.failNext) { const error = this.failNext; this.failNext = null; throw error }
    if (this.held.get(name)) {
      if (options.ifAvailable) return callback(null)
      await new Promise(resolve => { const q = this.waiting.get(name) ?? []; q.push(resolve); this.waiting.set(name, q) })
    }
    this.held.set(name, true)
    try { return await callback({ name, mode: options.mode ?? 'exclusive' }) }
    finally {
      this.held.set(name, false)
      const next = (this.waiting.get(name) ?? []).shift()
      if (next) next()
    }
  }
  /** Holds `name` until the returned release() is called (models another tab mid-operation). */
  hold(name) {
    let release
    const done = new Promise(resolve => { release = resolve })
    const acquired = new Promise(resolve => { this.request(name, { mode: 'exclusive' }, () => { resolve(); return done }) })
    return { acquired, release }
  }
}
/** Installs a shared FakeLockManager as navigator.locks for code that uses the global. */
function installNavigatorLocks(manager = new FakeLockManager()) {
  Object.defineProperty(globalThis.navigator, 'locks', { value: manager, configurable: true, writable: true })
  return manager
}
module.exports = { FakeLockManager, installNavigatorLocks }
