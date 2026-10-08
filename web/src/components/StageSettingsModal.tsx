import React, { useState, useEffect, useCallback } from 'react'
import {
  Settings,
  Eye,
  Type,
  Columns2,
  Square,
  X,
  Download,
  Check,
  PanelLeftClose,
} from 'lucide-react'
import { GTAR_APP_VERSION, GTAR_DEV_VERSION } from '../types/gtar'
import { isDevEnv } from '../utils/env'

import type { SongFontStyleOption } from '../utils/backupSettings'
export type { SongFontStyleOption } from '../utils/backupSettings'

interface StageSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  fontStyle: SongFontStyleOption
  onSelectFontStyle: (style: SongFontStyleOption) => void
  isTwoColumn: boolean
  onToggleTwoColumn: (enabled: boolean) => void
  edgeSwipePanel?: boolean
  onToggleEdgeSwipePanel?: (enabled: boolean) => void
  onOpenStageTools: () => void
  onToggleTheme: () => void
  onExportAllData?: () => void
  onOpenBackupRestoreModal?: () => void
  onInstallApp?: () => void
}

export const StageSettingsModal: React.FC<StageSettingsModalProps> = ({
  isOpen,
  onClose,
  fontStyle,
  onSelectFontStyle,
  isTwoColumn,
  onToggleTwoColumn,
  edgeSwipePanel = false,
  onToggleEdgeSwipePanel,
  onInstallApp,
}) => {
  const [keepScreenAwake, setKeepScreenAwake] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3000)
  }, [])

  useEffect(() => {
    if (!keepScreenAwake) return
    let active = true
    let acquired: WakeLockSentinel | null = null

    if ('wakeLock' in navigator) {
      navigator.wakeLock
        .request('screen')
        .then((sentinel: WakeLockSentinel) => {
          if (!active) {
            void sentinel.release().catch(() => {})
            return
          }
          acquired = sentinel
          showToast('Stage Wake Lock active: screen will remain awake')
        })
        .catch(() => {
          if (active) showToast('Wake Lock not supported on this browser')
        })
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser capability feedback is required even when no asynchronous request is possible.
      showToast('Wake Lock not supported on this browser')
    }

    return () => {
      active = false
      void acquired?.release().catch(() => {})
    }
  }, [keepScreenAwake, showToast])

  if (!isOpen) return null

  const fontOptions: Array<{
    id: SongFontStyleOption
    name: string
    subtitle: string
    recommended?: boolean
  }> = [
    {
      id: 'mono',
      name: 'Monospace',
      subtitle: 'Recommended for stage: chords align directly above lyrics',
      recommended: true,
    },
    {
      id: 'sans',
      name: 'Sans-Serif',
      subtitle: 'Clean / Modern system look',
    },
    {
      id: 'serif',
      name: 'Serif / Bold',
      subtitle: 'High contrast editorial serif style for stage use',
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl bg-app-surface border border-app-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-app-border flex items-center justify-between bg-app-base/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-app-action/20 border border-app-action/30 flex items-center justify-center text-app-action">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-app-heading">Stage Settings</h2>
              <p className="text-xs text-app-muted">Performance & Display Controls</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-app-muted hover:text-app-heading hover:bg-app-base transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {toastMessage && (
            <div className="px-3.5 py-2 rounded-xl bg-app-action/15 border border-app-action/40 text-app-action text-xs font-semibold flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* Section 1: Stage Display */}
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-app-accent">
              STAGE DISPLAY
            </div>

            {/* Keep Screen Awake Card */}
            <div className="p-4 rounded-xl bg-app-base border border-app-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    keepScreenAwake ? 'bg-app-action/20 text-app-action' : 'bg-app-surface text-app-muted'
                  }`}
                >
                  <Eye className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-app-heading">
                    Keep screen awake during performance
                  </div>
                  <div className="text-[11px] text-app-muted mt-0.5 leading-snug">
                    Prevents screen dimming or sleep while in Stage View / Gig Mode
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setKeepScreenAwake(!keepScreenAwake)}
                className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                  keepScreenAwake ? 'bg-app-action' : 'bg-app-surface border border-app-border'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full bg-app-base absolute top-1 transition-transform ${
                    keepScreenAwake ? 'left-6' : 'left-1 bg-app-muted'
                  }`}
                />
              </button>
            </div>

            {/* Two-Column Reflow Toggle */}
            <div className="p-4 rounded-xl bg-app-base border border-app-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    isTwoColumn ? 'bg-app-accent/20 text-app-accent' : 'bg-app-surface text-app-muted'
                  }`}
                >
                  {isTwoColumn ? <Columns2 className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-app-heading">
                    Two-Column Stage Reflow
                  </div>
                  <div className="text-[11px] text-app-muted mt-0.5 leading-snug">
                    Splits long chord charts into 2 balanced columns on wide screens
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onToggleTwoColumn(!isTwoColumn)}
                className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                  isTwoColumn ? 'bg-app-button' : 'bg-app-surface border border-app-border'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full bg-app-base absolute top-1 transition-transform ${
                    isTwoColumn ? 'left-6' : 'left-1 bg-app-muted'
                  }`}
                />
              </button>
            </div>

            {/* Edge Swipe Panel Toggle */}
            <div className="p-4 rounded-xl bg-app-base border border-app-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    edgeSwipePanel ? 'bg-app-action/20 text-app-action' : 'bg-app-surface text-app-muted'
                  }`}
                >
                  <PanelLeftClose className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-app-heading">
                    Edge Swipe Panel
                  </div>
                  <div className="text-[11px] text-app-muted mt-0.5 leading-snug">
                    Swipe from the screen edge to open the side panel.
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                data-testid="toggle-edge-swipe-panel"
                aria-checked={edgeSwipePanel}
                aria-label="Edge Swipe Panel"
                onClick={() => onToggleEdgeSwipePanel?.(!edgeSwipePanel)}
                className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                  edgeSwipePanel ? 'bg-app-action' : 'bg-app-surface border border-app-border'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full bg-app-base absolute top-1 transition-transform ${
                    edgeSwipePanel ? 'left-6' : 'left-1 bg-app-muted'
                  }`}
                />
              </button>
            </div>

            {/* Font Style for Chords & Lyrics */}
            <div className="p-4 rounded-xl bg-app-base border border-app-border space-y-3">
              <div className="flex items-center gap-2.5">
                <Type className="w-4 h-4 text-app-action" />
                <span className="text-xs font-bold text-app-heading">
                  Font Style (Chords & Lyrics)
                </span>
              </div>

              <div className="space-y-2">
                {fontOptions.map((opt) => {
                  const isSelected = fontStyle === opt.id
                  return (
                    <div
                      key={opt.id}
                      onClick={() => onSelectFontStyle(opt.id)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? 'bg-app-action/15 border-app-action'
                          : 'bg-app-surface border-app-border/60 hover:border-app-border'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-bold ${
                              isSelected ? 'text-app-action' : 'text-app-heading'
                            }`}
                          >
                            {opt.name}
                          </span>
                          {opt.recommended && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-app-action/20 text-app-action uppercase">
                              Recommended
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-app-muted mt-0.5">{opt.subtitle}</div>
                      </div>

                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          isSelected ? 'border-app-action' : 'border-app-muted'
                        }`}
                      >
                        {isSelected && <div className="w-2 h-2 rounded-full bg-app-action" />}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Section 2: PWA Offline Stage App & Information */}
          <div className="p-4 rounded-xl bg-app-base/60 border border-app-border/70 text-center space-y-2">
            <div className="text-xs font-extrabold text-app-heading">GTAR Live Stage Companion</div>
            <div className="text-[11px] font-mono font-bold text-app-action">
              {isDevEnv ? `Version ${GTAR_DEV_VERSION}` : `Version ${GTAR_APP_VERSION}`}
            </div>

            {onInstallApp && (
              <button
                type="button"
                onClick={() => {
                  onInstallApp()
                }}
                className="w-full py-2 rounded-lg bg-app-action/15 border border-app-action/40 text-app-action hover:bg-app-action hover:text-app-on-action text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 mt-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Install App as Standalone PWA</span>
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-app-border bg-app-base/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-app-action text-app-on-action font-extrabold text-xs hover:bg-app-action transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
