import React, { useSyncExternalStore } from 'react'
import { stageCast2Controller } from '../utils/stageCast2Controller'
import { cast2LocalEnabled } from '../utils/stageCast2Local'

void React

const subscribe = (listener: () => void) => stageCast2Controller.subscribe(listener)
const getChords = () => stageCast2Controller.getChords()
const getTvFontSize = () => stageCast2Controller.getTvFontSize()

const TV_SIZE_PRESETS = {
  S: 24,
  M: 32,
  L: 40,
  XL: 48,
} as const

const DEFAULT_TV_FONT_SIZE = 32
const MIN_TV_FONT_SIZE = 20
const MAX_TV_FONT_SIZE = 56

/** Receiver preferences stay separate from controller notation, sizing and layout. */
export function TvPresentationOptions() {
  const chords = useSyncExternalStore(subscribe, getChords, getChords)
  const tvFontSize = useSyncExternalStore(subscribe, getTvFontSize, () => DEFAULT_TV_FONT_SIZE)

  if (!cast2LocalEnabled) return null

  const handleStepSize = (delta: number) => {
    stageCast2Controller.setTvFontSize(tvFontSize + delta)
  }

  const handleResetSize = () => {
    stageCast2Controller.setTvFontSize(DEFAULT_TV_FONT_SIZE)
  }

  return (
    <section aria-labelledby="tv-presentation-options" className="border-t border-app-border pt-4 mb-5 space-y-3">
      <h3 id="tv-presentation-options" className="text-xs font-bold uppercase tracking-wider text-app-action">
        TV Presentation / TV Sync
      </h3>
      <p className="text-xs text-app-muted">
        Applies to the TV only.
      </p>

      {/* TV Chords Row */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-app-muted w-20 shrink-0">TV chords</span>
        <div className="grid grid-cols-2 gap-1.5 flex-1">
          {[false, true].map((visible) => (
            <button
              key={String(visible)}
              type="button"
              aria-pressed={chords === visible}
              onClick={() => stageCast2Controller.setChords(visible)}
              className={`min-h-11 py-1.5 rounded-xl border text-xs font-mono font-bold transition-all cursor-pointer ${
                chords === visible
                  ? 'bg-app-action text-app-on-action border-app-action shadow-sm'
                  : 'bg-app-base text-app-text border-app-border hover:border-app-action'
              }`}
            >
              {visible ? 'Show chords' : 'Lyrics only'}
            </button>
          ))}
        </div>
      </div>

      {/* TV Font Zoom Stepper */}
      <div className="flex flex-col gap-2 pt-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-app-muted w-20 shrink-0">TV Zoom</span>
          <div className="flex items-center bg-app-base rounded-xl border border-app-border flex-1">
            <button
              type="button"
              onClick={() => handleStepSize(-2)}
              disabled={tvFontSize <= MIN_TV_FONT_SIZE}
              className="px-4 py-2 text-sm font-extrabold text-app-text hover:text-app-action disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none active:scale-95 transition-transform"
              aria-label="Decrease TV font size"
            >
              A-
            </button>
            <button
              type="button"
              onClick={handleResetSize}
              className="flex-1 text-center text-sm font-mono font-bold text-app-accent hover:underline cursor-pointer select-none py-1"
              aria-label={`TV font size: ${tvFontSize}px. Click to reset to default 32px`}
            >
              {tvFontSize}px
            </button>
            <button
              type="button"
              onClick={() => handleStepSize(2)}
              disabled={tvFontSize >= MAX_TV_FONT_SIZE}
              className="px-4 py-2 text-sm font-extrabold text-app-text hover:text-app-action disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none active:scale-95 transition-transform"
              aria-label="Increase TV font size"
            >
              A+
            </button>
          </div>
        </div>

        {/* TV Quick Size Presets [ S | M | L | XL ] */}
        <div className="flex items-center gap-1.5 pl-[88px]">
          {(['S', 'M', 'L', 'XL'] as const).map((key) => {
            const size = TV_SIZE_PRESETS[key]
            const isSelected = tvFontSize === size
            return (
              <button
                key={key}
                type="button"
                onClick={() => stageCast2Controller.setTvFontSize(size)}
                className={`flex-1 py-1 rounded-lg border text-xs font-mono font-bold transition-all cursor-pointer text-center ${
                  isSelected
                    ? 'bg-app-action text-app-on-action border-app-action shadow-sm'
                    : 'bg-app-base text-app-text border-app-border hover:border-app-action'
                }`}
                aria-pressed={isSelected}
              >
                {key}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
