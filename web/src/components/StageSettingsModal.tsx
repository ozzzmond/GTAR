import React, { useState, useEffect } from 'react'
import {
  Settings,
  Eye,
  Type,
  Columns2,
  Square,
  SlidersHorizontal,
  Palette,
  Check,
  X,
  Radio,
  Download,
  Upload,
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
  onOpenStageTools,
  onToggleTheme,
  onExportAllData,
  onOpenBackupRestoreModal,
  onInstallApp,
}) => {
  const [keepScreenAwake, setKeepScreenAwake] = useState(false)
  const [wakeLockSentinel, setWakeLockSentinel] = useState<WakeLockSentinel | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!keepScreenAwake) {
      if (wakeLockSentinel) {
        wakeLockSentinel.release().catch(() => {})
        setWakeLockSentinel(null)
      }
      return
    }

    if ('wakeLock' in navigator) {
      navigator.wakeLock
        .request('screen')
        .then((sentinel: WakeLockSentinel) => {
          setWakeLockSentinel(sentinel)
          showToast('Stage Wake Lock active: screen will remain awake')
        })
        .catch(() => {
          showToast('Wake Lock not supported on this browser')
        })
    } else {
      showToast('Wake Lock not supported on this browser')
    }

    return () => {
      if (wakeLockSentinel) {
        wakeLockSentinel.release().catch(() => {})
      }
    }
  }, [keepScreenAwake])

  if (!isOpen) return null

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3000)
  }

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
      <div className="w-full max-w-lg rounded-2xl bg-[#073642] border border-[#1A4A55] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1A4A55] flex items-center justify-between bg-[#002B36]/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#2AA198]/20 border border-[#2AA198]/30 flex items-center justify-center text-[#2AA198]">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#FDF6E3]">Stage Settings</h2>
              <p className="text-xs text-[#93A1A1]">Performance & Display Controls</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#002B36] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {toastMessage && (
            <div className="px-3.5 py-2 rounded-xl bg-[#2AA198]/15 border border-[#2AA198]/40 text-[#2AA198] text-xs font-semibold flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* Section 1: Stage Display */}
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#B58900]">
              STAGE DISPLAY
            </div>

            {/* Keep Screen Awake Card */}
            <div className="p-4 rounded-xl bg-[#002B36] border border-[#1A4A55] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    keepScreenAwake ? 'bg-[#2AA198]/20 text-[#2AA198]' : 'bg-[#073642] text-[#93A1A1]'
                  }`}
                >
                  <Eye className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[#FDF6E3]">
                    Keep screen awake during performance
                  </div>
                  <div className="text-[11px] text-[#93A1A1] mt-0.5 leading-snug">
                    Prevents screen dimming or sleep while in Stage View / Gig Mode
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setKeepScreenAwake(!keepScreenAwake)}
                className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                  keepScreenAwake ? 'bg-[#2AA198]' : 'bg-[#073642] border border-[#1A4A55]'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full bg-[#002B36] absolute top-1 transition-transform ${
                    keepScreenAwake ? 'left-6' : 'left-1 bg-[#93A1A1]'
                  }`}
                />
              </button>
            </div>

            {/* Two-Column Reflow Toggle */}
            <div className="p-4 rounded-xl bg-[#002B36] border border-[#1A4A55] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    isTwoColumn ? 'bg-[#B58900]/20 text-[#B58900]' : 'bg-[#073642] text-[#93A1A1]'
                  }`}
                >
                  {isTwoColumn ? <Columns2 className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[#FDF6E3]">
                    Two-Column Stage Reflow
                  </div>
                  <div className="text-[11px] text-[#93A1A1] mt-0.5 leading-snug">
                    Splits long chord charts into 2 balanced columns on wide screens
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onToggleTwoColumn(!isTwoColumn)}
                className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                  isTwoColumn ? 'bg-[#B58900]' : 'bg-[#073642] border border-[#1A4A55]'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full bg-[#002B36] absolute top-1 transition-transform ${
                    isTwoColumn ? 'left-6' : 'left-1 bg-[#93A1A1]'
                  }`}
                />
              </button>
            </div>

            {/* Font Style for Chords & Lyrics */}
            <div className="p-4 rounded-xl bg-[#002B36] border border-[#1A4A55] space-y-3">
              <div className="flex items-center gap-2.5">
                <Type className="w-4 h-4 text-[#2AA198]" />
                <span className="text-xs font-bold text-[#FDF6E3]">
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
                          ? 'bg-[#2AA198]/15 border-[#2AA198]'
                          : 'bg-[#073642] border-[#1A4A55]/60 hover:border-[#1A4A55]'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-bold ${
                              isSelected ? 'text-[#2AA198]' : 'text-[#FDF6E3]'
                            }`}
                          >
                            {opt.name}
                          </span>
                          {opt.recommended && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#2AA198]/20 text-[#2AA198] uppercase">
                              Recommended
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#93A1A1] mt-0.5">{opt.subtitle}</div>
                      </div>

                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          isSelected ? 'border-[#2AA198]' : 'border-[#93A1A1]'
                        }`}
                      >
                        {isSelected && <div className="w-2 h-2 rounded-full bg-[#2AA198]" />}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Section 2: Quick Shortcuts */}
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#B58900]">
              QUICK SHORTCUTS
            </div>

            {/* Stage Tools & Band Sync Shortcut */}
            <button
              type="button"
              onClick={() => {
                onClose()
                onOpenStageTools()
              }}
              className="w-full text-left p-3.5 rounded-xl bg-[#002B36] border border-[#1A4A55] hover:border-[#2AA198] transition-all flex items-center justify-between group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#073642] flex items-center justify-center text-[#2AA198]">
                  <SlidersHorizontal className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#FDF6E3] group-hover:text-[#2AA198] transition-colors">
                    Stage Tools & Band Sync
                  </div>
                  <div className="text-[11px] text-[#93A1A1]">
                    Metronome, Guitar Tuner, & Band Sync Leader/Member
                  </div>
                </div>
              </div>
              <Radio className="w-4 h-4 text-[#93A1A1] group-hover:text-[#2AA198]" />
            </button>

            {/* Stage Theme Toggle Shortcut */}
            <button
              type="button"
              onClick={onToggleTheme}
              className="w-full text-left p-3.5 rounded-xl bg-[#002B36] border border-[#1A4A55] hover:border-[#B58900] transition-all flex items-center justify-between group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#073642] flex items-center justify-center text-[#B58900]">
                  <Palette className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#FDF6E3] group-hover:text-[#B58900] transition-colors">
                    Stage Theme & Colors
                  </div>
                  <div className="text-[11px] text-[#93A1A1]">
                    Solarized Dark, Stage High Contrast, or Light Theme
                  </div>
                </div>
              </div>
              <Check className="w-4 h-4 text-[#93A1A1] group-hover:text-[#B58900]" />
            </button>
          </div>

          {/* Section 3: Local Setlist & Library Backup / Restore (JSON) */}
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#B58900]">
              LOCAL DATA BACKUP & RESTORE
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  if (onExportAllData) {
                    onExportAllData()
                  }
                  showToast('Exported full library backup JSON')
                }}
                className="p-3 rounded-xl bg-[#002B36] border border-[#1A4A55] hover:border-[#2AA198] transition-all flex items-center gap-2.5 cursor-pointer group"
                title="Export complete songbook, setlists, and stage customizations"
              >
                <div className="w-8 h-8 rounded-lg bg-[#073642] flex items-center justify-center text-[#2AA198]">
                  <Download className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-xs font-bold text-[#FDF6E3] group-hover:text-[#2AA198]">
                    Export All Data (JSON)
                  </div>
                  <div className="text-[10px] text-[#93A1A1]">Songs, setlists & themes</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenBackupRestoreModal?.()
                }}
                className="p-3 rounded-xl bg-[#002B36] border border-[#1A4A55] hover:border-[#B58900] transition-all flex items-center gap-2.5 cursor-pointer group"
                title="Import and restore from backup file"
              >
                <div className="w-8 h-8 rounded-lg bg-[#073642] flex items-center justify-center text-[#B58900]">
                  <Upload className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-xs font-bold text-[#FDF6E3] group-hover:text-[#B58900]">
                    Import Data (JSON)
                  </div>
                  <div className="text-[10px] text-[#93A1A1]">Merge or overwrite backup</div>
                </div>
              </button>
            </div>
          </div>

          {/* Section 4: PWA Offline Stage App & Information */}
          <div className="p-4 rounded-xl bg-[#002B36]/60 border border-[#1A4A55]/70 text-center space-y-2">
            <div className="text-xs font-extrabold text-[#FDF6E3]">GTAR Live Stage Companion</div>
            <div className="text-[11px] font-mono font-bold text-[#2AA198]">
              {isDevEnv ? `Version ${GTAR_DEV_VERSION}` : `Version ${GTAR_APP_VERSION}`}
            </div>
            <div className="text-[10px] text-[#93A1A1]">
              Offline-First Stage Teleprompter & Chord Companion for Live Musicians
            </div>

            {onInstallApp && (
              <button
                type="button"
                onClick={() => {
                  onInstallApp()
                }}
                className="w-full py-2 rounded-lg bg-[#10B981]/15 border border-[#10B981]/40 text-[#10B981] hover:bg-[#10B981] hover:text-[#002B36] text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 mt-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Install App as Standalone PWA</span>
              </button>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[#1A4A55] bg-[#002B36]/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-[#2AA198] text-[#002B36] font-extrabold text-xs hover:bg-[#35B8AD] transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
