import { isDevEnv } from './env'
import { applyLogRetention, debugLogBackend, entryBytes, LOG_MAX_BYTES as LOG_MAX_BYTES_REF, LOG_RETENTION_MS as LOG_RETENTION_MS_REF, type DebugLogBackend } from './debugLogStore'
/**
 * Web Logging Engine for GTAR
 * Intercepts console errors, warnings, unhandled window exceptions and promise rejections.
 * #204 S1: stores timestamped logs in IndexedDB (12 h, 10 MB; see debugLogStore), with the old
 * 30-entry localStorage copy only as a fallback when IndexedDB is unavailable.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  tag: string
  message: string
  stack?: string
  details?: string
}

export const STORAGE_KEY = 'gtar_web_debug_logs'
export const MAX_MEMORY_LOGS = 1000
export const MAX_LOGS = MAX_MEMORY_LOGS
export const MAX_PERSISTED_LOGS = 30
/**
 * Owner choice (2026-10-24): debug logging switch, OFF by default. Off = only warnings and
 * errors are recorded (quietly, so a problem that already happened can still be reviewed);
 * on = info and debug entries too. Per device, in localStorage.
 */
export const DEBUG_LOGS_ENABLED_KEY = 'gtar_debug_logs_enabled'
export function isDebugLoggingEnabled(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_LOGS_ENABLED_KEY) === '1' } catch { return false }
}
export function setDebugLoggingEnabled(enabled: boolean): void {
  try { localStorage.setItem(DEBUG_LOGS_ENABLED_KEY, enabled ? '1' : '0') } catch { /* storage unavailable */ }
}

/**
 * #204 S2: identifiers of the signed-in account (user id, Google subject) registered at sign-in,
 * so they are redacted wherever they appear. Emails are redacted by pattern.
 */
const redactedIdentifiers = new Set<string>()
export function registerRedactedIdentifiers(...values: Array<string | null | undefined>): void {
  for (const value of values) if (typeof value === 'string' && value.trim().length >= 6) redactedIdentifiers.add(value.trim())
}

/**
 * Redacts OAuth tokens, access tokens, client secrets, auth cookies, authorization headers,
 * email addresses and account identifiers (#204 S2).
 */
export function redactSensitiveData(text: string): string {
  if (!text || typeof text !== 'string') return text
  let out = text
  for (const id of redactedIdentifiers) out = out.split(id).join('[REDACTED_ID]')
  return out
    // Email addresses
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    // Account identifier fields in JSON or query strings (record and song ids are not account ids)
    .replace(/(\b["']?(?:userId|user_id|google_sub|sub|email)["']?\s*[:=]\s*["']?)([^"'&\s,}\\]+)(["']?)/g, '$1[REDACTED]$3')
    // Redact OAuth Bearer tokens
    .replace(/Bearer\s+[-A-Za-z0-9_.]+/gi, 'Bearer [REDACTED]')
    // Redact Google OAuth access tokens (typically start with ya29.)
    .replace(/ya29\.[-A-Za-z0-9_]+/gi, '[REDACTED_OAUTH_TOKEN]')
    // Redact access_token, id_token, refresh_token, client_secret in query strings or JSON
    .replace(/(["']?(?:access_token|id_token|refresh_token|client_secret)["']?\s*[:=]\s*["']?)([^"'&\s\\]+)(["']?)/gi, '$1[REDACTED]$3')
    // Redact Authorization headers
    .replace(/(?:Authorization)\s*:\s*[^\r\n]+/gi, 'Authorization: [REDACTED]')
    // Redact Cookies / Set-Cookie headers
    .replace(/(?:Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, 'Cookie: [REDACTED]')
    // Redact session / token cookies
    .replace(/((?:session|token|auth_token)=)[^;\s&"']+/gi, '$1[REDACTED]')
}

export function prunePersistedLogs(storage: Storage = localStorage, targetCount = 10): void {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > targetCount) {
      storage.setItem(STORAGE_KEY, JSON.stringify(parsed.slice(-targetCount)))
    }
  } catch {
    // If quota error occurs even when writing trimmed logs, remove key cleanly
    try {
      storage.removeItem(STORAGE_KEY)
    } catch { /* ignore */ }
  }
}

type LogListener = (logs: LogEntry[]) => void

class WebLoggerEngine {
  private logs: LogEntry[] = []
  private listeners: Set<LogListener> = new Set()
  private isInitialized = false
  private storageEnabled = false
  // #204 S1: IndexedDB store. Memory keeps the newest MAX_MEMORY_LOGS for the viewer; the store keeps all within retention.
  private store: DebugLogBackend | null = null
  private stored = new Map<string, { timestamp: string; bytes: number }>()
  private pending: LogEntry[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushing: Promise<void> = Promise.resolve()
  private originalConsole = {
    error: console.error,
    warn: console.warn,
    info: console.info,
    log: console.log,
  }

  constructor() {
    // In dev mode, auto-resume so pre-auth diagnostic logs are captured immediately
    if (import.meta.env?.DEV) {
      this.resume()
    }
  }

  public resume() {
    if (this.storageEnabled && this.isInitialized) return // already capturing; reloading would drop newer memory entries
    this.storageEnabled = true
    this.loadPersistedLogs()
    this.init()
    if (!this.store && typeof indexedDB !== 'undefined') void this.attachStore(debugLogBackend(indexedDB))
  }

  /**
   * #204 S1: switch persistence to IndexedDB. Existing localStorage entries and anything captured
   * so far are moved in, retention is applied, and the localStorage copy is removed.
   */
  public async attachStore(backend: DebugLogBackend, storage: Pick<Storage, 'getItem' | 'removeItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): Promise<boolean> {
    try {
      const existing = await backend.loadAll()
      let legacy: LogEntry[] = []
      try { const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]'); if (Array.isArray(parsed)) legacy = parsed } catch { /* unreadable: dropped */ }
      const byId = new Map<string, LogEntry>()
      for (const entry of [...existing, ...legacy, ...this.logs, ...this.pending]) if (entry?.id) byId.set(entry.id, entry)
      const { keep, drop } = applyLogRetention([...byId.values()])
      const known = new Set(existing.map(e => e.id))
      await backend.write(keep.filter(e => !known.has(e.id)), drop.filter(id => known.has(id)))
      this.store = backend
      this.pending = []
      this.stored = new Map(keep.map(e => [e.id, { timestamp: e.timestamp, bytes: entryBytes(e) }]))
      this.logs = keep.slice(-MAX_MEMORY_LOGS)
      try { storage?.removeItem(STORAGE_KEY) } catch { /* the next startup retries */ }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility)
      this.notifyListeners()
      return true
    } catch {
      return false // stays on the localStorage fallback
    }
  }

  private onVisibility = () => {
    if (document.visibilityState === 'hidden') void this.flush()
    else this.pruneMemory()
  }

  private pruneMemory() {
    const { keep } = applyLogRetention(this.logs)
    if (keep.length !== this.logs.length) { this.logs = keep; this.notifyListeners() }
    this.scheduleFlush()
  }

  private scheduleFlush() {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush() }, 500)
  }

  /** Writes queued entries and applies retention to everything stored, in one transaction. */
  public flush(): Promise<void> {
    const store = this.store
    if (!store) return Promise.resolve()
    this.flushing = this.flushing.then(async () => {
      const put = this.pending
      this.pending = []
      for (const entry of put) this.stored.set(entry.id, { timestamp: entry.timestamp, bytes: entryBytes(entry) })
      const now = Date.now()
      const ordered = [...this.stored].sort((a, b) => b[1].timestamp.localeCompare(a[1].timestamp))
      const drop: string[] = []
      let bytes = 0
      for (const [id, meta] of ordered) {
        const time = Date.parse(meta.timestamp)
        if (!Number.isFinite(time) || now - time > LOG_RETENTION_MS_REF || bytes + meta.bytes > LOG_MAX_BYTES_REF) drop.push(id)
        else bytes += meta.bytes
      }
      for (const id of drop) this.stored.delete(id)
      const dropped = new Set(drop)
      try { await store.write(put.filter(e => !dropped.has(e.id)), drop) } catch { /* best effort: memory copy remains */ }
    })
    return this.flushing
  }

  /** All stored entries within retention (the viewer shows only the newest MAX_MEMORY_LOGS). */
  public async getAllLogs(): Promise<LogEntry[]> {
    if (!this.store) return this.getLogs()
    await this.flush()
    try { return applyLogRetention(await this.store.loadAll()).keep } catch { return this.getLogs() }
  }

  public suspend() { this.storageEnabled = false }

  private loadPersistedLogs() {
    if (typeof localStorage === 'undefined') return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this.logs = parsed.slice(-MAX_MEMORY_LOGS)
        }
      }
    } catch {
      this.logs = []
    }
  }

  private persistLogs(entry?: LogEntry) {
    if (!this.storageEnabled) return
    if (this.store) {
      if (entry) this.pending.push(entry)
      this.scheduleFlush()
      return
    }
    if (typeof localStorage === 'undefined') return
    try {
      const persisted = this.logs.slice(-MAX_PERSISTED_LOGS)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch {
      // If quota exceeded, emergency prune or swallow to prevent error storm cascades
      try {
        prunePersistedLogs(localStorage, 10)
      } catch { /* swallow quota errors inside logger persistence */ }
    }
  }

  public init() {
    if (this.isInitialized || typeof window === 'undefined') return
    this.isInitialized = true

    // Intercept console.error
    console.error = (...args: unknown[]) => {
      this.originalConsole.error.apply(console, args)
      this.captureConsoleEntry('ERROR', args)
    }

    // Intercept console.warn
    console.warn = (...args: unknown[]) => {
      this.originalConsole.warn.apply(console, args)
      this.captureConsoleEntry('WARN', args)
    }

    // Intercept window uncaught errors
    window.addEventListener('error', (event: ErrorEvent) => {
      this.addEntry({
        level: 'ERROR',
        tag: 'WindowError',
        message: event.message || 'Uncaught window error',
        stack: event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`,
      })
    })

    // Intercept unhandled promise rejections
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const reason = event.reason
      let message: string
      let stack: string | undefined

      if (reason instanceof Error) {
        message = reason.message
        stack = reason.stack
      } else if (typeof reason === 'string') {
        message = reason
      } else {
        try {
          message = JSON.stringify(reason)
        } catch {
          message = String(reason)
        }
      }

      this.addEntry({
        level: 'ERROR',
        tag: 'UnhandledRejection',
        message,
        stack,
      })
    })

    this.info('WebLogger', `Logger initialized. Environment: ${isDevEnv ? 'development' : 'production'}`)
  }

  private captureConsoleEntry(level: LogLevel, args: unknown[]) {
    try {
      const messageParts: string[] = []
      let stack: string | undefined
      const details = undefined

      for (const arg of args) {
        if (arg instanceof Error) {
          messageParts.push(arg.message)
          if (!stack) stack = arg.stack
        } else if (typeof arg === 'object' && arg !== null) {
          try {
            messageParts.push(JSON.stringify(arg))
          } catch {
            messageParts.push(String(arg))
          }
        } else {
          messageParts.push(String(arg))
        }
      }

      this.addEntry({
        level,
        tag: 'Console',
        message: messageParts.join(' ') || `[Empty ${level}]`,
        stack,
        details,
      })
    } catch {
      // Safety guarantee to never throw inside console overrides
    }
  }

  public addEntry(entry: {
    level: LogLevel
    tag: string
    message: string
    stack?: string
    details?: string
  }) {
    if (!this.storageEnabled) return
    if ((entry.level === 'INFO' || entry.level === 'DEBUG') && !isDebugLoggingEnabled()) return
    const newLog: LogEntry = {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      level: entry.level,
      tag: entry.tag,
      message: redactSensitiveData(entry.message),
      ...(entry.stack ? { stack: redactSensitiveData(entry.stack) } : {}),
      ...(entry.details ? { details: redactSensitiveData(entry.details) } : {}),
    }

    this.logs.push(newLog)
    if (this.logs.length > MAX_LOGS) {
      this.logs = this.logs.slice(-MAX_LOGS)
    }

    this.persistLogs(newLog)
    this.notifyListeners()
  }

  public debug(tag: string, message: string, details?: string) {
    if (!import.meta.env.DEV) return
    this.addEntry({ level: 'DEBUG', tag, message, details })
  }

  public info(tag: string, message: string, details?: string) {
    this.addEntry({ level: 'INFO', tag, message, details })
  }

  public warn(tag: string, message: string, details?: string) {
    this.addEntry({ level: 'WARN', tag, message, details })
  }

  public error(tag: string, message: string, errorOrStack?: Error | string, details?: string) {
    let stack: string | undefined
    if (errorOrStack instanceof Error) {
      stack = errorOrStack.stack
    } else if (typeof errorOrStack === 'string') {
      stack = errorOrStack
    }

    this.addEntry({ level: 'ERROR', tag, message, stack, details })
  }

  public getLogs(): LogEntry[] {
    return [...this.logs]
  }

  public clearLogs() {
    this.logs = []
    if (this.store) {
      const ids = [...this.stored.keys(), ...this.pending.map(e => e.id)]
      this.stored.clear()
      this.pending = []
      void this.store.write([], ids).catch(() => { /* best effort */ })
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
    }
    this.notifyListeners()
  }

  public subscribe(listener: LogListener): () => void {
    this.listeners.add(listener)
    listener(this.getLogs())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners() {
    const current = this.getLogs()
    for (const listener of this.listeners) {
      try {
        listener(current)
      } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
    }
  }

  /** #204 S1: export everything stored (12 h, 10 MB), not just the viewer's newest entries. */
  public async exportAllLogsAsText(): Promise<string> {
    return this.formatLogs(await this.getAllLogs())
  }

  public exportLogsAsText(): string {
    return this.formatLogs(this.logs)
  }

  private formatLogs(logs: LogEntry[]): string {
    const header = [
      '=========================================================================',
      `GTAR WEB DEBUG LOG EXPORT - ${new Date().toISOString()}`,
      `Environment: ${isDevEnv ? 'development' : 'production'}`,
      `User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'}`,
      `Total Log Entries: ${logs.length}`,
      '=========================================================================',
      '',
    ].join('\r\n')

    const body = logs
      .map((log) => {
        const timeStr = log.timestamp.replace('T', ' ').replace('Z', '')
        let line = `[${timeStr}] [${log.level.padEnd(5)}] [${log.tag}] ${redactSensitiveData(log.message)}`
        if (log.details) {
          line += `\r\n  Details: ${redactSensitiveData(log.details)}`
        }
        if (log.stack) {
          line += `\r\n  Stack Trace:\r\n${redactSensitiveData(log.stack)
            .split('\n')
            .map((s) => `    ${s.trim()}`)
            .join('\r\n')}`
        }
        return line
      })
      .join('\r\n\r\n')

    return redactSensitiveData(header + body)
  }

  public async downloadLogFile() {
    if (typeof window === 'undefined') return
    const content = await this.exportAllLogsAsText()
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const hh = String(now.getHours()).padStart(2, '0')
    const min = String(now.getMinutes()).padStart(2, '0')
    const filename = `gtar-web-debug-${yyyy}-${mm}-${dd}-${hh}.${min}.log`

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
}

export const appLogger = new WebLoggerEngine()
