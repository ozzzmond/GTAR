import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { Mic, MicOff, Volume2 } from 'lucide-react'
import { tunerMic, type TunerMicSnapshot } from '../utils/tunerEngine'
import { tunerTone } from '../utils/tunerTone'
import {
  A4_MAX_HZ,
  A4_MIN_HZ,
  describeTuning,
  frequencyOf,
  readSavedA4,
  roundHz,
  saveA4,
  type TuningMode,
} from '../utils/tunerMath'
import {
  DEFAULT_PRESET_ID,
  findPreset,
  INSTRUMENT_LABELS,
  stringLabel,
  TUNER_PRESETS,
  type TunerInstrument,
} from '../utils/tunerPresets'

const IDLE_MIC: TunerMicSnapshot = { state: 'off', message: null, frequency: null }
const control = 'min-h-11 min-w-0 rounded-xl border px-3 text-xs font-extrabold cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action motion-reduce:transition-none'
const choice = (on: boolean) => (on
  ? 'bg-app-action/20 border-app-action text-app-action'
  : 'bg-app-base border-app-border text-app-text hover:border-app-action')
const INSTRUMENTS = Object.keys(INSTRUMENT_LABELS) as TunerInstrument[]

/** Tuner for the Stage toolbar panel: listens on a Start tap, shows the note or the nearest string, and plays reference tones. */
export const TunerPanel: React.FC = () => {
  const mic = useSyncExternalStore(tunerMic.subscribe, tunerMic.getSnapshot, () => IDLE_MIC)
  const tone = useSyncExternalStore(tunerTone.subscribe, tunerTone.getActive, () => null)
  const [mode, setMode] = useState<TuningMode>('auto')
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID)
  const [a4, setA4] = useState<number>(() => readSavedA4())
  const [a4Text, setA4Text] = useState(() => String(readSavedA4()))

  // The microphone and the tone belong to the open panel: closing it stops both.
  useEffect(() => () => {
    tunerMic.stop()
    tunerTone.stop()
  }, [])

  const preset = findPreset(presetId)
  const labels = preset.strings.map((_, index) => stringLabel(preset.strings, index))
  const listening = mic.state === 'listening'
  const reading = describeTuning(listening ? mic.frequency : null, mode, preset.strings, labels, a4)
  const statusText = mic.state === 'starting' ? 'Starting' : listening ? reading.status : 'Tap Start to listen'
  const needle = listening && reading.cents !== null ? Math.max(-50, Math.min(50, reading.cents)) : 0
  const showNeedle = listening && reading.cents !== null

  const handleStart = () => {
    tunerTone.stop()
    void tunerMic.start()
  }

  const handleA4Change = (text: string) => {
    setA4Text(text)
    const value = Number(text)
    if (text.trim() !== '' && Number.isInteger(value) && value >= A4_MIN_HZ && value <= A4_MAX_HZ) {
      setA4(value)
      saveA4(value)
    }
  }

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Tuning mode" className="grid grid-cols-2 gap-2">
        <button type="button" aria-pressed={mode === 'auto'} onClick={() => setMode('auto')} className={`${control} ${choice(mode === 'auto')}`}>
          Auto
        </button>
        <button type="button" aria-pressed={mode === 'preset'} onClick={() => setMode('preset')} className={`${control} ${choice(mode === 'preset')}`}>
          Preset
        </button>
      </div>

      <label className="flex items-center gap-2 text-xs font-bold text-app-muted">
        <span className="shrink-0">Tuning</span>
        <select
          value={presetId}
          onChange={(event) => setPresetId(event.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-app-border bg-app-base px-2 text-sm font-bold text-app-text focus-visible:outline-2 focus-visible:outline-app-action"
        >
          {INSTRUMENTS.map((instrument) => (
            <optgroup key={instrument} label={INSTRUMENT_LABELS[instrument]}>
              {TUNER_PRESETS.filter((item) => item.instrument === instrument).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="rounded-xl border border-app-border bg-app-base p-3 text-center space-y-2">
        <p className="min-h-10 text-4xl font-black font-mono text-app-heading">{(listening && reading.headline) || '--'}</p>
        <p className={`text-xs font-extrabold uppercase tracking-widest ${listening && reading.inTune ? 'text-app-action' : 'text-app-muted'}`}>
          {statusText}
        </p>
        <div className="relative mx-auto h-8 w-full max-w-xs" aria-hidden="true">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-app-border" />
          <div className="absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-app-muted" />
          <div
            className={`absolute top-1/2 h-7 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-150 ease-out motion-reduce:transition-none ${
              showNeedle ? (reading.inTune ? 'bg-app-action' : 'bg-app-heading') : 'bg-app-border'
            }`}
            style={{ left: `${50 + needle}%` }}
          />
        </div>
        <p className="min-h-4 text-xs font-mono text-app-muted">
          {listening && mic.frequency !== null ? `${mic.frequency.toFixed(1)} Hz` : ' '}
        </p>
      </div>

      <div className="space-y-1.5">
        {listening || mic.state === 'starting' ? (
          <button type="button" onClick={() => tunerMic.stop()} className={`${control} w-full bg-app-base border-app-border text-app-text hover:border-app-action flex items-center justify-center gap-2`}>
            <MicOff className="w-4 h-4" aria-hidden="true" />
            Stop listening
          </button>
        ) : (
          <button type="button" onClick={handleStart} className={`${control} w-full bg-app-base border-app-action text-app-action hover:bg-app-action/15 flex items-center justify-center gap-2`}>
            <Mic className="w-4 h-4" aria-hidden="true" />
            Start listening
          </button>
        )}
        {mic.message && <p className="text-center text-xs font-bold text-app-muted">{mic.message}</p>}
      </div>

      <div className="space-y-2">
        <p className="text-xs text-app-muted text-center">Tap a string to hear its pitch.</p>
        <div className="grid grid-cols-3 gap-2">
          {preset.strings.map((spec, index) => {
            const label = labels[index]
            const hz = roundHz(frequencyOf(spec, a4))
            const playing = tone === label
            return (
              <button
                key={label}
                type="button"
                aria-pressed={playing}
                onClick={() => tunerTone.toggle(label, hz)}
                className={`min-h-11 p-2.5 rounded-xl border text-center cursor-pointer flex flex-col items-center gap-1 focus-visible:outline-2 focus-visible:outline-app-action ${
                  playing ? 'bg-app-action/20 border-app-action text-app-action shadow-md' : 'bg-app-base border-app-border text-app-text hover:border-app-action'
                }`}
              >
                <Volume2 className={`w-4 h-4 ${playing ? 'text-app-action' : 'text-app-muted'}`} aria-hidden="true" />
                <span className="text-xs font-extrabold">{label}</span>
                <span className="text-[10px] font-mono text-app-muted">{hz.toFixed(2)} Hz</span>
              </button>
            )
          })}
        </div>
        <p role="status" className="min-h-4 text-center text-xs font-bold text-app-action">
          {tone ? `Playing ${tone}` : ''}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs font-bold text-app-muted">
        <label htmlFor="tuner-a4">A4 (Hz)</label>
        <input
          id="tuner-a4"
          type="number"
          inputMode="numeric"
          min={A4_MIN_HZ}
          max={A4_MAX_HZ}
          step={1}
          value={a4Text}
          onChange={(event) => handleA4Change(event.target.value)}
          onBlur={() => setA4Text(String(a4))}
          className="min-h-11 w-24 rounded-lg border border-app-border bg-app-base px-2 text-sm font-mono text-app-text focus-visible:outline-2 focus-visible:outline-app-action"
        />
      </div>

      <p aria-live="polite" className="sr-only">{listening ? reading.announce : ''}</p>
    </div>
  )
}
