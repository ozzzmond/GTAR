import React, { useEffect, useRef, useState } from 'react'
import { Minus, Pause, Play, Plus } from 'lucide-react'
import { metronome, type MetronomeState } from '../utils/metronome'

const step = 'min-h-11 min-w-11 shrink-0 rounded-lg bg-app-base border border-app-border text-xs font-bold text-app-text hover:text-app-action flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action'

/** Metronome controls for the Stage toolbar panel: tempo, tap tempo, start and stop. */
export const MetronomePanel: React.FC = () => {
  const [metroState, setMetroState] = useState<MetronomeState>(() => metronome.getState())
  const tapTimesRef = useRef<number[]>([])

  useEffect(() => metronome.subscribe(setMetroState), [])

  const handleTapTempo = () => {
    const now = performance.now()
    const recent = [...tapTimesRef.current, now].filter((t) => now - t < 3000)
    tapTimesRef.current = recent
    if (recent.length >= 2) {
      const intervals = []
      for (let i = 1; i < recent.length; i++) {
        intervals.push(recent[i] - recent[i - 1])
      }
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length
      const calculatedBpm = Math.round(60000 / avgMs)
      if (calculatedBpm >= 30 && calculatedBpm <= 300) {
        metronome.setBpm(calculatedBpm)
      }
    }
  }

  return (
    <div className="space-y-3 text-center">
      <div>
        <div data-testid="metronome-bpm" className="text-5xl font-black font-mono text-app-heading tracking-tighter">
          {metroState.bpm}
        </div>
        <div className="text-xs font-bold uppercase tracking-widest text-app-action">BPM</div>
      </div>

      <input
        type="range"
        min="30"
        max="280"
        value={metroState.bpm}
        aria-label="Tempo"
        onChange={(e) => metronome.setBpm(parseInt(e.target.value, 10))}
        className="w-full min-h-11 accent-app-action cursor-pointer"
      />

      <div className="flex items-center justify-center gap-1.5">
        <button type="button" onClick={() => metronome.setBpm(metroState.bpm - 5)} aria-label="Slower by 5" className={step}>-5</button>
        <button type="button" onClick={() => metronome.setBpm(metroState.bpm - 1)} aria-label="Slower by 1" className={step}>
          <Minus className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={handleTapTempo}
          aria-label="Tap tempo"
          className="min-h-11 min-w-0 flex-1 px-2 rounded-xl bg-app-base border border-app-action text-xs font-extrabold text-app-action hover:bg-app-action/15 cursor-pointer uppercase tracking-wider whitespace-nowrap focus-visible:outline-2 focus-visible:outline-app-action"
        >
          Tap
        </button>
        <button type="button" onClick={() => metronome.setBpm(metroState.bpm + 1)} aria-label="Faster by 1" className={step}>
          <Plus className="w-4 h-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => metronome.setBpm(metroState.bpm + 5)} aria-label="Faster by 5" className={step}>+5</button>
      </div>

      <button
        type="button"
        onClick={() => metronome.toggle()}
        aria-pressed={metroState.isRunning}
        className={`w-full min-h-11 rounded-xl font-black text-sm flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-action ${
          metroState.isRunning
            ? 'bg-[#DC6E67] text-white hover:bg-[#E53935]'
            : 'bg-app-action text-app-on-action'
        }`}
      >
        {metroState.isRunning ? <Pause className="w-5 h-5" aria-hidden="true" /> : <Play className="w-5 h-5" aria-hidden="true" />}
        <span>{metroState.isRunning ? 'Stop' : 'Start'}</span>
      </button>
    </div>
  )
}
