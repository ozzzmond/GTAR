import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  Gauge,
  Sliders,
  Volume2,
  Play,
  Pause,
  Plus,
  Minus,
} from 'lucide-react'
import { metronome, type MetronomeState } from '../utils/metronome'

interface StageToolsModalProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: 'metronome' | 'tuner'
}

const GUITAR_STRINGS = [
  { name: 'E2 (6th)', freq: 82.41 },
  { name: 'A2 (5th)', freq: 110.0 },
  { name: 'D3 (4th)', freq: 146.83 },
  { name: 'G3 (3rd)', freq: 196.0 },
  { name: 'B3 (2nd)', freq: 246.94 },
  { name: 'E4 (1st)', freq: 329.63 },
]

export const StageToolsModal: React.FC<StageToolsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'metronome',
}) => {
  const [activeTab, setActiveTab] = useState<'metronome' | 'tuner'>(initialTab)
  const [metroState, setMetroState] = useState<MetronomeState>(() => metronome.getState())
  const [activeTuningString, setActiveTuningString] = useState<string | null>(null)
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null)
  const [activeOsc, setActiveOsc] = useState<OscillatorNode | null>(null)
  const tapTimesRef = useRef<number[]>([])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Modal-open reset preserves the requested tab on every reopen.
    setActiveTab(initialTab)
  }, [initialTab, isOpen])

  // Metronome subscription
  useEffect(() => {
    const unsub = metronome.subscribe((st) => setMetroState(st))
    return unsub
  }, [])

  // Stop tuning oscillator when modal closes
  useEffect(() => {
    return () => {
      if (activeOsc) {
        try {
          activeOsc.stop()
          activeOsc.disconnect()
        } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
      }
    }
  }, [activeOsc])

  if (!isOpen) return null

  // Tap tempo handler
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

  // Play reference guitar tuning tone
  const playTuningTone = (stringName: string, freq: number) => {
    if (activeTuningString === stringName) {
      if (activeOsc) {
        try {
          activeOsc.stop()
          activeOsc.disconnect()
        } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
      }
      setActiveOsc(null)
      setActiveTuningString(null)
      return
    }

    if (activeOsc) {
      try {
        activeOsc.stop()
        activeOsc.disconnect()
      } catch { /* Best-effort operation: failure must not interrupt the workflow. */ }
    }

    type AudioContextConstructor = typeof AudioContext
    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
    if (!AudioContextClass) return
    const ctx = audioCtx || new AudioContextClass()
    if (!audioCtx) setAudioCtx(ctx)

    if (ctx.state === 'suspended') {
      ctx.resume()
    }

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(freq, ctx.currentTime)

    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start()
    setActiveOsc(osc)
    setActiveTuningString(stringName)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl bg-app-surface border border-app-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-app-border flex items-center justify-between bg-app-base/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-app-action/20 border border-app-action/30 flex items-center justify-center text-app-action">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-app-heading">STAGE TOOLS</h2>
              <p className="text-xs text-app-muted">Metronome & Guitar Tuner</p>
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

        {/* Tab Switcher */}
        <div className="p-3 border-b border-app-border bg-app-base/30">
          <div className={`grid grid-cols-2 gap-1 bg-app-base p-1 rounded-xl border border-app-border`}>
            <button
              type="button"
              onClick={() => setActiveTab('metronome')}
              className={`py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'metronome'
                  ? 'bg-app-action text-app-on-action shadow-sm'
                  : 'text-app-muted hover:text-app-heading'
              }`}
            >
              <Gauge className="w-3.5 h-3.5" />
              <span>Metronome</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('tuner')}
              className={`py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'tuner'
                  ? 'bg-app-action text-app-on-action shadow-sm'
                  : 'text-app-muted hover:text-app-heading'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Guitar Tuner</span>
            </button>
          </div>
        </div>

        {/* Tab Content Panel */}
        <div className="p-6 overflow-y-auto flex-1">
          {/* 1. METRONOME PANEL */}
          {activeTab === 'metronome' && (
            <div className="space-y-6 text-center">
              {/* Large BPM Display */}
              <div className="py-2">
                <div className="text-6xl font-black font-mono text-app-heading tracking-tighter">
                  {metroState.bpm}
                </div>
                <div className="text-xs font-bold uppercase tracking-widest text-app-action mt-1">
                  BPM (Beats Per Minute)
                </div>
              </div>

              {/* Slider & Steppers */}
              <div className="space-y-3">
                <input
                  type="range"
                  min="30"
                  max="280"
                  value={metroState.bpm}
                  onChange={(e) => metronome.setBpm(parseInt(e.target.value, 10))}
                  className="w-full accent-app-action cursor-pointer"
                />

                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => metronome.setBpm(metroState.bpm - 5)}
                    className="px-2.5 py-1 rounded-lg bg-app-base border border-app-border text-xs font-bold text-app-text hover:text-app-action cursor-pointer"
                  >
                    -5
                  </button>
                  <button
                    type="button"
                    onClick={() => metronome.setBpm(metroState.bpm - 1)}
                    className="p-1.5 rounded-lg bg-app-base border border-app-border text-app-text hover:text-app-action cursor-pointer"
                  >
                    <Minus className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={handleTapTempo}
                    className="px-5 py-2 rounded-xl bg-app-base border border-app-action text-xs font-extrabold text-app-action hover:bg-app-action/15 cursor-pointer uppercase tracking-wider active:scale-95 transition-transform"
                  >
                    Tap Tempo
                  </button>

                  <button
                    type="button"
                    onClick={() => metronome.setBpm(metroState.bpm + 1)}
                    className="p-1.5 rounded-lg bg-app-base border border-app-border text-app-text hover:text-app-action cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => metronome.setBpm(metroState.bpm + 5)}
                    className="px-2.5 py-1 rounded-lg bg-app-base border border-app-border text-xs font-bold text-app-text hover:text-app-action cursor-pointer"
                  >
                    +5
                  </button>
                </div>
              </div>

              {/* Play / Stop Button */}
              <button
                type="button"
                onClick={() => metronome.toggle()}
                className={`w-full py-3.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 cursor-pointer transition-all shadow-lg ${
                  metroState.isRunning
                    ? 'bg-[#DC6E67] text-white hover:bg-[#E53935]'
                    : 'bg-app-action text-app-on-action hover:bg-app-action'
                }`}
              >
                {metroState.isRunning ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                <span>{metroState.isRunning ? 'STOP METRONOME' : 'START METRONOME'}</span>
              </button>
            </div>
          )}

          {/* 2. GUITAR TUNER PANEL */}
          {activeTab === 'tuner' && (
            <div className="space-y-4">
              <p className="text-xs text-app-muted text-center">
                Tap a string to hear its pitch.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {GUITAR_STRINGS.map((str) => {
                  const isPlaying = activeTuningString === str.name
                  return (
                    <button
                      key={str.name}
                      type="button"
                      onClick={() => playTuningTone(str.name, str.freq)}
                      className={`p-3.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1 ${
                        isPlaying
                          ? 'bg-app-action/20 border-app-action text-app-action shadow-md'
                          : 'bg-app-base border-app-border text-app-text hover:border-app-action'
                      }`}
                    >
                      <Volume2
                        className={`w-4 h-4 ${isPlaying ? 'text-app-action animate-pulse' : 'text-app-muted'}`}
                      />
                      <span className="text-xs font-extrabold">{str.name}</span>
                      <span className="text-[10px] font-mono text-app-muted">
                        {str.freq.toFixed(1)} Hz
                      </span>
                    </button>
                  )
                })}
              </div>

              {activeTuningString && (
                <div className="p-3 rounded-xl bg-app-action/10 border border-app-action/30 text-center text-xs text-app-action font-bold">
                  Now playing reference tone for {activeTuningString}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-app-border bg-app-base/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-app-base border border-app-border text-xs font-bold text-app-muted hover:text-app-heading transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
