import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  Download,
  Copy,
  Trash2,
  Terminal,
  Check,
  Filter,
} from 'lucide-react'
import { appLogger, type LogEntry, type LogLevel } from '../utils/logger'

interface DebugLogsModalProps {
  isOpen: boolean
  onClose: () => void
}

export const DebugLogsModal: React.FC<DebugLogsModalProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [copied, setCopied] = useState(false)
  const [filterLevel, setFilterLevel] = useState<'ALL' | LogLevel>('ALL')
  const logsContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const unsubscribe = appLogger.subscribe((newLogs) => {
      setLogs(newLogs)
    })
    return unsubscribe
  }, [isOpen])

  // Scroll to bottom when new logs come in
  useEffect(() => {
    if (isOpen && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight
    }
  }, [logs, isOpen])

  if (!isOpen) return null

  const filteredLogs = filterLevel === 'ALL'
    ? logs
    : logs.filter((l) => l.level === filterLevel)

  const handleCopyAll = async () => {
    try {
      const text = appLogger.exportLogsAsText()
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy logs:', err)
    }
  }

  const handleClearLogs = () => {
    if (window.confirm('Are you sure you want to clear all recorded debug logs?')) {
      appLogger.clearLogs()
    }
  }

  const handleDownload = () => {
    appLogger.downloadLogFile()
  }

  const getLevelColor = (level: LogLevel) => {
    switch (level) {
      case 'ERROR':
        return 'text-status-error bg-[#DC6E67]/15 border-[#DC6E67]/40'
      case 'WARN':
        return 'text-app-accent bg-app-accent/15 border-app-accent/40'
      case 'INFO':
        return 'text-app-action bg-app-action/15 border-app-action/40'
      case 'DEBUG':
      default:
        return 'text-app-muted bg-app-muted/15 border-app-muted/40'
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fade-in select-none">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-app-surface border border-app-border rounded-2xl shadow-2xl flex flex-col overflow-hidden text-app-text">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-app-border bg-app-base">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-app-surface text-app-action border border-app-border">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-app-heading">Web Debug & Crash Logs</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-app-border text-app-action font-bold">
                  {logs.length} entries
                </span>
                {import.meta.env.VITE_APP_ENV === 'debug' && (
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-red-600 text-white shadow-sm animate-pulse">
                    DEV PORT 5174
                  </span>
                )}
              </div>
              <p className="text-xs text-app-muted">
                Real-time console errors, window events, and presentation state captures
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-app-surface text-app-muted hover:text-app-heading transition-colors cursor-pointer"
            title="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-2.5 bg-app-surface border-b border-app-border">
          {/* Level Filters */}
          <div className="flex items-center gap-1 text-xs">
            <Filter className="w-3.5 h-3.5 text-app-muted mr-1" />
            {(['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setFilterLevel(lvl)}
                className={`px-2 py-1 rounded-lg font-mono text-[11px] font-bold transition-all cursor-pointer ${
                  filterLevel === lvl
                    ? 'bg-app-action text-app-on-action'
                    : 'bg-app-base text-app-muted hover:text-app-heading border border-app-border'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyAll}
              className="px-3 py-1.5 rounded-xl bg-app-base hover:bg-app-border text-app-text hover:text-app-action border border-app-border text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
              title="Copy entire log output to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-status-success" />
                  <span className="text-status-success">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy All</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="px-3 py-1.5 rounded-xl bg-app-action hover:bg-app-action text-app-on-action text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
              title="Download clean .log file readable in Windows Notepad"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download .log</span>
            </button>

            <button
              type="button"
              onClick={handleClearLogs}
              className="px-3 py-1.5 rounded-xl bg-[#DC6E67]/20 hover:bg-[#DC6E67] text-status-error hover:text-white border border-[#DC6E67]/40 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
              title="Clear all recorded logs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {/* Monospace Log Viewer */}
        <div
          ref={logsContainerRef}
          className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed bg-app-base text-app-muted space-y-2 select-text"
          style={{ maxHeight: 'calc(90vh - 160px)' }}
        >
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-app-muted text-center space-y-2">
              <Terminal className="w-8 h-8 opacity-40 text-app-action" />
              <p className="font-sans text-sm font-semibold">No debug logs captured yet</p>
              <p className="font-sans text-xs text-app-muted max-w-sm">
                Console warnings, unhandled errors, and Stage Cast events will appear here automatically.
              </p>
            </div>
          ) : (
            filteredLogs.map((item) => {
              const timeFormatted = item.timestamp.split('T')[1]?.replace('Z', '') || item.timestamp
              return (
                <div
                  key={item.id}
                  className="p-2.5 rounded-xl bg-app-surface/60 border border-app-border/60 hover:border-app-border transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-[10px] text-app-muted">{timeFormatted}</span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded border uppercase font-mono ${getLevelColor(
                        item.level
                      )}`}
                    >
                      {item.level}
                    </span>
                    <span className="text-[11px] font-bold text-app-action">
                      [{item.tag}]
                    </span>
                  </div>

                  <p className="text-app-heading break-words whitespace-pre-wrap font-mono text-xs">
                    {item.message}
                  </p>

                  {item.details && (
                    <div className="mt-1 text-[11px] text-app-muted bg-app-base p-1.5 rounded-lg border border-app-border/40 whitespace-pre-wrap">
                      {item.details}
                    </div>
                  )}

                  {item.stack && (
                    <pre className="mt-1 text-[10px] text-status-error bg-app-base p-2 rounded-lg border border-[#DC6E67]/30 overflow-x-auto whitespace-pre leading-normal">
                      {item.stack}
                    </pre>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
