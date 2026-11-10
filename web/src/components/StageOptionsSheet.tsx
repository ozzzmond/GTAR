import React, { useEffect } from 'react'
import {
  X,
  Sliders,
  Columns2,
  Eye,
  EyeOff,
  Sun,
  Maximize,
  Minimize,
  ListMusic,
  Check,
  Tv,
} from 'lucide-react'
import type { StageChordScale, StageFontWeight, StageLineSpacing } from './SongLineRenderer'
import type { StageNotationMode } from '../utils/nashvilleNotation'
import type { ActiveSongState } from '../types/gtar'
import {
  STAGE_SIZE_PRESETS,
  CHORD_SCALE_PRESETS,
  FONT_WEIGHT_PRESETS,
  LINE_SPACING_PRESETS,
  FONT_FAMILY_PRESETS,
  type WakeLockStatus,
} from '../constants/stageOptionsPresets'
export type { WakeLockStatus }

export interface StageOptionsSheetProps {
  isOpen: boolean
  onClose: () => void

  // Typography
  fontSize: number
  onFontSizeChange: (size: number) => void
  chordScale: StageChordScale
  onChordScaleChange: (scale: StageChordScale) => void
  fontWeight: StageFontWeight
  onFontWeightChange: (weight: StageFontWeight) => void
  lineSpacing: StageLineSpacing
  onLineSpacingChange: (spacing: StageLineSpacing) => void
  fontFamily: 'mono' | 'sans' | 'serif'
  onFontFamilyChange: (family: 'mono' | 'sans' | 'serif') => void

  // Notation
  notation: StageNotationMode
  onNotationChange: (notation: StageNotationMode) => void

  // Layout & Dock
  isTwoColumn: boolean
  onToggleTwoColumn: (enabled: boolean) => void
  showDock: boolean
  onToggleShowDock: (enabled: boolean) => void

  // Autoscroll
  autoScrollSpeed: number
  onAutoScrollSpeedChange: (speed: number) => void

  // Controls Auto-Hide
  autoHideControls: boolean
  onToggleAutoHideControls: (enabled: boolean) => void

  // Wake lock & Fullscreen
  wakeLockActive: boolean
  wakeLockAcquired?: boolean
  wakeLockStatus?: WakeLockStatus
  onToggleWakeLock: () => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
  isFullscreenSupported: boolean

  // Setlist Quick Jump (optional)
  queueSongs?: ActiveSongState[]
  currentQueueIndex?: number
  onSelectQueueIndex?: (index: number) => void
  setlistName?: string

  // TV / Cast options
  onOpenTvPresentation?: () => void
  children?: React.ReactNode
}

export const StageOptionsSheet: React.FC<StageOptionsSheetProps> = ({
  isOpen,
  onClose,
  fontSize,
  onFontSizeChange,
  chordScale,
  onChordScaleChange,
  fontWeight,
  onFontWeightChange,
  lineSpacing,
  onLineSpacingChange,
  fontFamily,
  onFontFamilyChange,
  notation,
  onNotationChange,
  isTwoColumn,
  onToggleTwoColumn,
  showDock,
  onToggleShowDock,
  autoScrollSpeed,
  onAutoScrollSpeedChange,
  autoHideControls,
  onToggleAutoHideControls,
  wakeLockActive,
  wakeLockAcquired = false,
  wakeLockStatus,
  onToggleWakeLock,
  isFullscreen,
  onToggleFullscreen,
  isFullscreenSupported,
  queueSongs,
  currentQueueIndex,
  onSelectQueueIndex,
  setlistName,
  onOpenTvPresentation,
  children,
}) => {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const effectiveStatus: WakeLockStatus =
    wakeLockStatus ||
    (!wakeLockActive ? 'disabled' : wakeLockAcquired ? 'active' : 'inactive')

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Stage Options"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Sheet / Modal Container */}
      <div className="relative w-full sm:max-w-xl max-h-[88dvh] bg-app-surface border border-app-border sm:rounded-3xl rounded-t-3xl shadow-2xl z-10 flex flex-col overflow-hidden text-app-text">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-app-border bg-app-base sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-app-accent" />
            <h2 className="text-sm font-bold text-app-heading tracking-tight">Stage Options</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close options"
            className="min-w-11 min-h-11 sm:min-w-9 sm:min-h-9 p-1 flex items-center justify-center text-app-muted hover:text-app-heading hover:bg-app-surface rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4 text-xs text-app-text">
          {/* Autoscroll Speed */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-app-heading">Auto-Scroll Speed</span>
              <span className="font-mono font-bold text-app-accent text-sm">
                {Math.round(autoScrollSpeed)} px/s
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => onAutoScrollSpeedChange(Math.max(5, autoScrollSpeed - 5))}
                aria-label="Decrease auto-scroll speed by 5"
                className="ui-button min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-app-button hover:brightness-110 text-app-button-text font-bold border border-app-border"
              >
                -5
              </button>
              <input
                type="range"
                min="5"
                max="180"
                step="1"
                value={autoScrollSpeed}
                onChange={(e) => onAutoScrollSpeedChange(Number(e.target.value))}
                aria-label="Auto-scroll speed slider"
                className="flex-1 accent-app-accent cursor-pointer h-2 bg-app-base border border-app-border rounded-lg"
              />
              <button
                type="button"
                onClick={() => onAutoScrollSpeedChange(Math.min(180, autoScrollSpeed + 5))}
                aria-label="Increase auto-scroll speed by 5"
                className="ui-button min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-app-button hover:brightness-110 text-app-button-text font-bold border border-app-border"
              >
                +5
              </button>
            </div>
          </div>

          {/* Notation Mode: Chords vs Numbers */}
          <div className="space-y-2">
            <span className="font-semibold text-app-heading">Notation Mode</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onNotationChange('chords')}
                className={`min-h-[44px] py-2 px-3 rounded-xl font-bold transition-all border flex items-center justify-center ${
                  notation === 'chords'
                    ? 'bg-app-action border-app-action text-app-on-action shadow-md'
                    : 'ui-button bg-app-button border-app-border text-app-button-text hover:brightness-110'
                }`}
              >
                Chords (Letters)
              </button>
              <button
                type="button"
                onClick={() => onNotationChange('numbers')}
                className={`min-h-[44px] py-2 px-3 rounded-xl font-bold transition-all border flex items-center justify-center ${
                  notation === 'numbers'
                    ? 'bg-app-action border-app-action text-app-on-action shadow-md'
                    : 'ui-button bg-app-button border-app-border text-app-button-text hover:brightness-110'
                }`}
              >
                Numbers (NNS)
              </button>
            </div>
          </div>

          {/* Typography: Font Size */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-app-heading">Font Size</span>
              <span className="text-app-muted font-mono">{fontSize}px</span>
            </div>
            {/* Direct A- / A+ Stepper (Clean onClick without leaking intervals) */}
            <div className="flex items-center bg-app-base rounded-xl border border-app-border overflow-hidden">
              <button
                type="button"
                onClick={() => onFontSizeChange(Math.max(12, fontSize - 2))}
                aria-label="Decrease font size"
                className="min-h-[44px] min-w-[56px] px-4 py-2 text-sm font-extrabold text-app-text hover:text-app-action hover:bg-app-surface active:scale-95 transition-all flex items-center justify-center cursor-pointer"
              >
                A-
              </button>
              <span
                data-testid="stage-options-font-size-display"
                className="flex-1 text-center text-sm font-mono font-bold text-app-accent py-1"
              >
                {fontSize}px
              </span>
              <button
                type="button"
                onClick={() => onFontSizeChange(Math.min(38, fontSize + 2))}
                aria-label="Increase font size"
                className="min-h-[44px] min-w-[56px] px-4 py-2 text-sm font-extrabold text-app-text hover:text-app-action hover:bg-app-surface active:scale-95 transition-all flex items-center justify-center cursor-pointer"
              >
                A+
              </button>
            </div>
            {/* Size Presets */}
            <div className="grid grid-cols-4 gap-2">
              {STAGE_SIZE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => onFontSizeChange(p.value)}
                  className={`min-h-[44px] py-2 rounded-xl font-bold transition-all border ${
                    fontSize === p.value
                      ? 'bg-app-action border-app-action text-app-on-action shadow-sm'
                      : 'ui-button bg-app-button border-app-border text-app-button-text hover:brightness-110'
                  }`}
                >
                  {p.label} ({p.value})
                </button>
              ))}
            </div>
          </div>

          {/* Typography: Chord Scaling */}
          <div className="space-y-2">
            <span className="font-semibold text-app-heading">Chord Scale</span>
            <div className="grid grid-cols-4 gap-2">
              {CHORD_SCALE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => onChordScaleChange(p.value)}
                  className={`min-h-[44px] py-2 rounded-xl font-bold transition-all border ${
                    chordScale === p.value
                      ? 'bg-app-action border-app-action text-app-on-action shadow-sm'
                      : 'ui-button bg-app-button border-app-border text-app-button-text hover:brightness-110'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Typography: Font Weight & Line Spacing */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <span className="font-semibold text-app-heading">Font Weight</span>
              <div className="grid grid-cols-3 gap-1.5">
                {FONT_WEIGHT_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => onFontWeightChange(p.value)}
                    className={`min-h-[44px] py-1.5 rounded-lg font-medium text-[11px] transition-all border flex items-center justify-center ${
                      fontWeight === p.value
                        ? 'bg-app-action border-app-action text-app-on-action shadow-sm'
                        : 'ui-button bg-app-button border-app-border text-app-button-text hover:brightness-110'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="font-semibold text-app-heading">Line Spacing</span>
              <div className="grid grid-cols-3 gap-1.5">
                {LINE_SPACING_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => onLineSpacingChange(p.value)}
                    className={`min-h-[44px] py-1.5 rounded-lg font-medium text-[11px] transition-all border flex items-center justify-center ${
                      lineSpacing === p.value
                        ? 'bg-app-action border-app-action text-app-on-action shadow-sm'
                        : 'ui-button bg-app-button border-app-border text-app-button-text hover:brightness-110'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Font Family */}
          <div className="space-y-2">
            <span className="font-semibold text-app-heading">Font Style</span>
            <div className="grid grid-cols-3 gap-2">
              {FONT_FAMILY_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => onFontFamilyChange(p.value)}
                  className={`min-h-[44px] py-2 rounded-xl font-medium transition-all border flex items-center justify-center ${
                    fontFamily === p.value
                      ? 'bg-app-action border-app-action text-app-on-action shadow-sm'
                      : 'ui-button bg-app-button border-app-border text-app-button-text hover:brightness-110'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reading Layout & Behavior Toggles */}
          <div className="space-y-3 pt-2 border-t border-app-border">
            <span className="font-semibold text-app-heading">Reading & Performance Features</span>

            {/* Two-Column Mode */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-app-base border border-app-border">
              <div className="flex items-center gap-2.5">
                <Columns2 className="w-4 h-4 text-app-accent" />
                <div>
                  <div className="font-semibold text-app-heading">Two-Column Layout</div>
                  <div className="text-[11px] text-app-muted">
                    Split song across two reading columns on widescreen displays
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isTwoColumn}
                aria-label="Two-Column Layout"
                onClick={() => onToggleTwoColumn(!isTwoColumn)}
                className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center p-1 rounded-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
              >
                <div
                  className={`w-11 h-6 rounded-full transition-colors relative p-0.5 border ${
                    isTwoColumn ? 'bg-app-action border-app-action' : 'bg-app-button border-app-border'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      isTwoColumn ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </div>
              </button>
            </div>

            {/* Controls Auto-Hide */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-app-base border border-app-border">
              <div className="flex items-center gap-2.5">
                {autoHideControls ? (
                  <EyeOff className="w-4 h-4 text-status-success" />
                ) : (
                  <Eye className="w-4 h-4 text-app-muted" />
                )}
                <div>
                  <div className="font-semibold text-app-heading">Auto-Hide Controls</div>
                  <div className="text-[11px] text-app-muted">
                    Fade out bars during auto-scroll or inactivity for full canvas reading
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoHideControls}
                aria-label="Auto-Hide Controls"
                onClick={() => onToggleAutoHideControls(!autoHideControls)}
                className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center p-1 rounded-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
              >
                <div
                  className={`w-11 h-6 rounded-full transition-colors relative p-0.5 border ${
                    autoHideControls ? 'bg-app-action border-app-action' : 'bg-app-button border-app-border'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      autoHideControls ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </div>
              </button>
            </div>

            {/* Draggable Dock on Desktop/Tablet */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-app-base border border-app-border">
              <div className="flex items-center gap-2.5">
                <Sliders className="w-4 h-4 text-app-accent" />
                <div>
                  <div className="font-semibold text-app-heading">Floating Control Dock</div>
                  <div className="text-[11px] text-app-muted">
                    Use draggable side dock instead of fixed bottom bar (tablet / desktop)
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showDock}
                aria-label="Floating Control Dock"
                onClick={() => onToggleShowDock(!showDock)}
                className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center p-1 rounded-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
              >
                <div
                  className={`w-11 h-6 rounded-full transition-colors relative p-0.5 border ${
                    showDock ? 'bg-app-action border-app-action' : 'bg-app-button border-app-border'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      showDock ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </div>
              </button>
            </div>

            {/* Wake Lock Controller */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-app-base border border-app-border">
              <div className="flex items-center gap-2.5">
                <Sun
                  className={`w-4 h-4 ${
                    effectiveStatus === 'active'
                      ? 'text-app-accent'
                      : effectiveStatus === 'acquiring'
                      ? 'text-app-action animate-pulse'
                      : effectiveStatus === 'inactive'
                      ? 'text-app-muted'
                      : effectiveStatus === 'denied'
                      ? 'text-status-error'
                      : effectiveStatus === 'unsupported'
                      ? 'text-status-warning'
                      : 'text-app-muted'
                  }`}
                />
                <div>
                  <div className="font-semibold text-app-heading flex items-center gap-2">
                    <span>Keep Screen Awake</span>
                    {effectiveStatus === 'active' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-status-success/20 text-status-success border border-status-success/40 font-mono">
                        Active
                      </span>
                    )}
                    {effectiveStatus === 'disabled' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-app-surface text-app-muted border border-app-border font-mono">
                        Disabled
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-app-muted">
                    {effectiveStatus === 'active'
                      ? 'Screen Wake Lock active'
                      : effectiveStatus === 'disabled'
                      ? 'Screen Wake Lock disabled'
                      : 'Screen Wake Lock controller'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={wakeLockActive}
                aria-label="Keep Screen Awake"
                onClick={onToggleWakeLock}
                className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center p-1 rounded-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
              >
                <div
                  className={`w-11 h-6 rounded-full transition-colors relative p-0.5 border ${
                    wakeLockActive ? 'bg-app-accent border-app-accent' : 'bg-app-button border-app-border'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      wakeLockActive ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </div>
              </button>
            </div>

            {/* Fullscreen Mode */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-app-base border border-app-border">
              <div className="flex items-center gap-2.5">
                {isFullscreen ? (
                  <Minimize className="w-4 h-4 text-app-accent" />
                ) : (
                  <Maximize className="w-4 h-4 text-app-muted" />
                )}
                <div>
                  <div className="font-semibold text-app-heading">Fullscreen Mode</div>
                  <div className="text-[11px] text-app-muted">
                    {isFullscreenSupported
                      ? 'Toggle native fullscreen viewing'
                      : 'Distraction-free reading mode'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleFullscreen}
                aria-label={isFullscreen ? 'Exit Fullscreen Mode' : 'Enter Fullscreen Mode'}
                className={`min-h-[44px] min-w-[72px] px-4 py-2 rounded-xl font-bold transition-colors flex items-center justify-center border ${
                  isFullscreen
                    ? 'bg-app-action text-app-on-action border-app-action'
                    : 'ui-button bg-app-button hover:brightness-110 text-app-button-text border-app-border'
                }`}
              >
                {isFullscreen ? 'Exit' : 'Enter'}
              </button>
            </div>

            {/* TV Presentation Link (if handler provided) */}
            {onOpenTvPresentation && (
              <div className="flex items-center justify-between p-3 rounded-2xl bg-app-base border border-app-border">
                <div className="flex items-center gap-2.5">
                  <Tv className="w-4 h-4 text-app-accent" />
                  <div>
                    <div className="font-semibold text-app-heading">TV & Second Screen</div>
                    <div className="text-[11px] text-app-muted">
                      Open Stage Cast pairing or pop-out window
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onOpenTvPresentation()
                  }}
                  className="min-h-[44px] px-4 py-2 rounded-xl font-bold transition-colors flex items-center justify-center border ui-button bg-app-button hover:brightness-110 text-app-button-text border-app-border"
                >
                  Pair / Cast
                </button>
              </div>
            )}

            {/* TV Presentation & Receiver Sync Options */}
            {children}
          </div>

          {/* Setlist Quick-Jump (if in setlist queue) */}
          {queueSongs && queueSongs.length > 1 && (
            <div className="space-y-2 pt-2 border-t border-app-border">
              <div className="flex items-center gap-2 text-app-heading font-semibold">
                <ListMusic className="w-4 h-4 text-app-action" />
                <span>Setlist Quick-Jump ({setlistName || 'Active Setlist'})</span>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1 rounded-2xl bg-app-base p-2 border border-app-border">
                {queueSongs.map((item, idx) => (
                  <button
                    key={`${item.id}_${idx}`}
                    type="button"
                    onClick={() => {
                      onSelectQueueIndex?.(idx)
                      onClose()
                    }}
                    className={`w-full min-h-[44px] flex items-center justify-between p-2 rounded-xl text-left transition-colors ${
                      currentQueueIndex === idx
                        ? 'bg-app-action text-app-on-action font-bold'
                        : 'hover:bg-app-surface text-app-text'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-mono text-[11px] opacity-75">
                        {idx + 1}.
                      </span>
                      <span className="truncate">{item.title}</span>
                    </div>
                    {currentQueueIndex === idx && <Check className="w-4 h-4 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
