import React, { useState, useRef, useEffect, useCallback } from 'react'
import { ArrowRight, Ban, Check, CircleAlert, Cloud } from 'lucide-react'
import { cloudBackupTime, type cloudBackupStatus } from '../utils/syncStatus'
import { recoveryDotClass } from '../utils/recoveryAttention'
import { DropdownPortal } from './DropdownPortal'

export function SyncStatusPill({ status, lastBackup, now, onClick, recoveryAttention = false }: {
  status: ReturnType<typeof cloudBackupStatus>
  lastBackup: string | null
  now?: number
  onClick: () => void
  recoveryAttention?: boolean
}): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchHandledRef = useRef(false)

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
  }, [])

  const startLeaveTimer = useCallback(() => {
    clearLeaveTimer()
    leaveTimerRef.current = setTimeout(() => {
      setIsHovered(false)
      setIsOpen(false)
    }, 180)
  }, [clearLeaveTimer])

  useEffect(() => {
    return () => {
      clearLeaveTimer()
    }
  }, [clearLeaveTimer])

  const handleClose = useCallback(() => {
    clearLeaveTimer()
    setIsOpen(false)
    setIsHovered(false)
  }, [clearLeaveTimer])

  const handleMouseEnter = () => {
    clearLeaveTimer()
    setIsHovered(true)
  }

  const handleMouseLeave = () => {
    startLeaveTimer()
  }

  const handleFocus = () => {
    clearLeaveTimer()
    setIsHovered(true)
  }

  const handleBlur = () => {
    startLeaveTimer()
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!popoverVisible) {
      e.preventDefault()
      e.stopPropagation()
      touchHandledRef.current = true
      setTimeout(() => {
        touchHandledRef.current = false
      }, 350)
      clearLeaveTimer()
      setIsOpen(true)
    }
  }

  const handleClick = () => {
    if (touchHandledRef.current) {
      touchHandledRef.current = false
      return
    }
    handleClose()
    onClick()
  }

  const popoverVisible = isOpen || isHovered

  const Badge = status.state === 'backed-up' ? Check : status.state === 'signed-out' ? Ban : CircleAlert
  const description = `Backup & Restore — ${status.label}. ${status.state === 'unknown' ? 'Open to verify cloud backup' : status.state === 'signed-out' ? 'Sign in to check cloud backup' : cloudBackupTime(lastBackup, now)}`

  return (
    <>
      <button
        ref={setAnchorEl}
        type="button"
        data-testid="header-cloud-sync-button"
        data-status={status.state}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseOver={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseOut={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onTouchEnd={handleTouchEnd}
        aria-label={description}
        aria-haspopup="dialog"
        aria-expanded={popoverVisible}
        aria-controls={popoverVisible ? 'cloud-backup-popover' : undefined}
        className="relative flex min-h-11 min-w-11 w-11 h-11 shrink-0 items-center justify-center rounded-xl border border-app-border bg-app-base text-app-action hover:border-app-action cursor-pointer"
      >
        <span className="relative inline-flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center shrink-0" aria-hidden="true">
          <Cloud className="h-5 w-5 text-app-action" />
          <Badge className={`absolute -right-1 bottom-0 h-3.5 w-3.5 rounded-full bg-app-base ${status.state === 'backed-up' ? 'text-app-action' : 'text-status-error'}`} />
        </span>
        {recoveryAttention && <span data-testid="cloud-recovery-dot" aria-hidden="true" className={recoveryDotClass} />}
      </button>

      <DropdownPortal
        anchorEl={popoverVisible ? anchorEl : null}
        open={popoverVisible}
        onClose={handleClose}
        align="right"
        gap={6}
        zIndex={40}
      >
        <div
          id="cloud-backup-popover"
          role="dialog"
          aria-label="Cloud Backup status"
          data-testid="cloud-backup-popover"
          onMouseEnter={clearLeaveTimer}
          onMouseOver={clearLeaveTimer}
          onMouseLeave={startLeaveTimer}
          onMouseOut={startLeaveTimer}
          onClick={(e) => e.stopPropagation()}
          className="w-64 bg-app-base border border-app-border rounded-xl shadow-xl py-2 px-3 font-mono text-xs animate-in fade-in zoom-in-95 duration-100 z-50 select-none"
        >
          <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-app-border/40 text-[10px] ui-secondary-text text-app-muted uppercase tracking-wider font-bold">
            <span className="flex items-center gap-1.5">
              <Cloud className="w-3.5 h-3.5 text-app-action shrink-0" aria-hidden="true" />
              <span>Cloud Backup</span>
            </span>
            <span
              data-testid="cloud-popover-status-badge"
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                status.state === 'backed-up'
                  ? 'bg-status-success/15 text-status-success'
                  : status.state === 'not-backed-up'
                  ? 'bg-status-warning/15 text-status-warning'
                  : status.state === 'signed-out'
                  ? 'bg-status-error/15 text-status-error'
                  : 'bg-app-surface text-app-muted'
              }`}
            >
              {status.label}
            </span>
          </div>

          <div className="space-y-1.5 text-app-text mb-2.5">
            <div className="text-[11px] flex items-center justify-between">
              <span className="text-app-muted">Status</span>
              <span className="font-semibold text-app-heading">{status.label}</span>
            </div>
            <div className="text-[11px] flex items-center justify-between">
              <span className="text-app-muted">Last Backup</span>
              <span className="font-semibold text-app-heading" data-testid="cloud-backup-time">
                {cloudBackupTime(lastBackup, now)}
              </span>
            </div>
            {status.state === 'signed-out' && (
              <div className="text-[10px] text-app-muted italic pt-0.5">
                Sign in to check cloud backup
              </div>
            )}
            {status.state === 'unknown' && (
              <div className="text-[10px] text-app-muted italic pt-0.5">
                Open to verify cloud backup
              </div>
            )}
          </div>

          <button
            type="button"
            data-testid="cloud-popover-open-center"
            onClick={(e) => {
              e.stopPropagation()
              handleClose()
              onClick()
            }}
            className="ui-link-text w-full min-h-9 text-left px-2 py-1.5 rounded-lg ui-primary-text text-app-text hover:bg-app-surface hover:text-app-action flex items-center justify-between gap-1.5 cursor-pointer transition-colors border border-app-border/60 hover:border-app-action/40"
          >
            <span className="truncate flex-1 font-sans text-xs font-medium">Backup & Restore</span>
            <ArrowRight className="ui-action-text w-3 h-3 text-app-action shrink-0" aria-hidden="true" />
          </button>
        </div>
      </DropdownPortal>
    </>
  )
}
