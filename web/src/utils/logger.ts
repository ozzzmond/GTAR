/**
 * Web Logging Engine for GTAR
 * Intercepts console errors, warnings, unhandled window exceptions and promise rejections.
 * Stores timestamped logs in localStorage and provides human-readable export for Notepad.
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
 * Redacts OAuth tokens, access tokens, client secrets, auth cookies, and authorization headers.
 */
export function redactSensitiveData(text: string): string {
  if (!text || typeof text !== 'string') return text
  return text
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
    this.storageEnabled = true
    this.loadPersistedLogs()
    this.init()
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

  private persistLogs() {
    if (!this.storageEnabled) return
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
    console.error = (...args: any[]) => {
      this.originalConsole.error.apply(console, args)
      this.captureConsoleEntry('ERROR', args)
    }

    // Intercept console.warn
    console.warn = (...args: any[]) => {
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
      let message = 'Unhandled Promise Rejection'
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

    this.info('WebLogger', `Logger initialized. Environment: ${import.meta.env.DEV ? 'development' : 'production'}`)
  }

  private captureConsoleEntry(level: LogLevel, args: any[]) {
    try {
      const messageParts: string[] = []
      let stack: string | undefined
      let details: string | undefined

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

    this.persistLogs()
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
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch { }
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
      } catch { }
    }
  }

  public exportLogsAsText(): string {
    const header = [
      '=========================================================================',
      `GTAR WEB DEBUG LOG EXPORT - ${new Date().toISOString()}`,
      `Environment: ${import.meta.env.DEV ? 'development' : 'production'}`,
      `User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'}`,
      `Total Log Entries: ${this.logs.length}`,
      '=========================================================================',
      '',
    ].join('\r\n')

    const body = this.logs
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

  public downloadLogFile() {
    if (typeof window === 'undefined') return
    const content = this.exportLogsAsText()
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
