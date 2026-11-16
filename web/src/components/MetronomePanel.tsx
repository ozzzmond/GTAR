import React, { useEffect, useState } from 'react'
import { Minus, Pause, Play, Plus } from 'lucide-react'
import { metronome, type MetronomeState } from '../utils/metronome'
import {
  METERS,
  MAX_BPM,
  MIN_BPM,
  NOTE_VALUES,
  SOUND_IDS,
  TIME_SIGNATURES,
  type Accent,
  type EarSettings,
  type NoteValue,
  type SoundId,
} from '../utils/metronomeModel'
import { createTapTempo } from '../utils/metronomeTap'

const step = 'min-h-11 min-w-11 shrink-0 rounded-lg bg-app-base border border-app-border text-xs font-bold text-app-text hover:text-app-action flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action'
const chip = 'min-h-11 px-2 rounded-lg border text-xs font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action'
const field = 'min-h-11 rounded-lg bg-app-base border border-app-border text-app-text text-xs px-2 focus-visible:outline-2 focus-visible:outline-app-action'

const NOTE_LABEL: Record<NoteValue, string> = { quarter: 'Quarter', eighth: 'Eighth', sixteenth: 'Sixteenth' }
const SOUND_LABEL: Record<SoundId, string> = { beep: 'Beep', wood: 'Wood', tick: 'Tick', snap: 'Snap' }
const ACCENT_LABEL: Record<Accent, string> = { accent: 'accent', normal: 'normal', silent: 'silent' }

const lightClass = (accent: Accent, lit: boolean): string => {
  const shape = 'min-h-11 min-w-11 rounded-full border-2 text-xs font-black flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-action motion-safe:transition-transform motion-safe:duration-75'
  const tone = accent === 'accent'
    ? 'bg-app-action border-app-action text-app-on-action'
    : accent === 'normal'
      ? 'bg-app-base border-app-border text-app-text'
      : 'bg-transparent border-dashed border-app-border text-app-muted opacity-60'
  return `${shape} ${tone} ${lit ? 'ring-2 ring-app-accent motion-safe:scale-110' : ''}`
}

interface EarControlsProps {
  label: string
  ear: EarSettings
  onChange: (patch: Partial<EarSettings>) => void
}

const EarControls: React.FC<EarControlsProps> = ({ label, ear, onChange }) => (
  <div className="rounded-lg border border-app-border p-2 space-y-2 text-left">
    <div className="text-[11px] font-bold uppercase tracking-wider text-app-heading">{label}</div>
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-[11px] text-app-muted">
        <span>Note</span>
        <select aria-label={`${label} note`} value={ear.note} onChange={e => onChange({ note: e.target.value as NoteValue })} className={field}>
          {NOTE_VALUES.map(note => <option key={note} value={note}>{NOTE_LABEL[note]}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-app-muted">
        <span>Sound</span>
        <select aria-label={`${label} sound`} value={ear.sound} onChange={e => onChange({ sound: e.target.value as SoundId })} className={field}>
          {SOUND_IDS.map(sound => <option key={sound} value={sound}>{SOUND_LABEL[sound]}</option>)}
        </select>
      </label>
    </div>
    <div className="flex items-center gap-2">
      <label className="flex-1 flex items-center gap-2 text-[11px] text-app-muted">
        <span>Volume</span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          aria-label={`${label} volume`}
          value={Math.round(ear.volume * 100)}
          onChange={e => onChange({ volume: Number(e.target.value) / 100 })}
          className="flex-1 min-h-11 accent-app-action cursor-pointer"
        />
      </label>
      <button
        type="button"
        aria-label={`${label} mute`}
        aria-pressed={ear.muted}
        onClick={() => onChange({ muted: !ear.muted })}
        className={`${chip} ${ear.muted ? 'bg-app-action text-app-on-action border-app-action' : 'bg-app-base text-app-text border-app-border'}`}
      >
        Mute
      </button>
    </div>
  </div>
)

/** Metronome controls for the Stage toolbar panel: tempo, tap, count-in, beat lights, sound and split ears. */
export const MetronomePanel: React.FC = () => {
  const [metroState, setMetroState] = useState<MetronomeState>(() => metronome.getState())
  const [tapper] = useState(() => createTapTempo())
  const [draft, setDraft] = useState<string | null>(null)

  useEffect(() => metronome.subscribe(setMetroState), [])

  const handleTapTempo = () => {
    const bpm = tapper.tap(performance.now())
    if (bpm !== null) metronome.setBpm(bpm)
  }

  const commitDraft = () => {
    if (draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft))) metronome.setBpm(Number(draft))
    setDraft(null)
  }

  const s = metroState
  const meter = METERS[s.timeSignature]
  const rows: number[][] = []
  let cursor = 0
  for (const size of meter.groups) {
    rows.push(Array.from({ length: size }, (_, offset) => cursor + offset))
    cursor += size
  }

  return (
    <div className="space-y-3 text-center" onPointerDown={() => metronome.unlock()}>
      <div>
        <div data-testid="metronome-bpm" className="text-5xl font-black font-mono text-app-heading tracking-tighter">
          {s.bpm}
        </div>
        <div className="text-xs font-bold uppercase tracking-widest text-app-action">BPM</div>
      </div>

      <input
        type="range"
        min={MIN_BPM}
        max={MAX_BPM}
        value={s.bpm}
        aria-label="Tempo"
        onChange={(e) => metronome.setBpm(parseInt(e.target.value, 10))}
        className="w-full min-h-11 accent-app-action cursor-pointer"
      />

      <div className="flex items-center justify-center gap-1.5">
        <button type="button" onClick={() => metronome.setBpm(s.bpm - 5)} aria-label="Slower by 5" className={step}>-5</button>
        <button type="button" onClick={() => metronome.setBpm(s.bpm - 1)} aria-label="Slower by 1" className={step}>
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
        <button type="button" onClick={() => metronome.setBpm(s.bpm + 1)} aria-label="Faster by 1" className={step}>
          <Plus className="w-4 h-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => metronome.setBpm(s.bpm + 5)} aria-label="Faster by 5" className={step}>+5</button>
      </div>

      <label className="flex items-center justify-center gap-2 text-xs text-app-muted">
        <span>Type BPM</span>
        <input
          type="number"
          inputMode="numeric"
          min={MIN_BPM}
          max={MAX_BPM}
          step={1}
          value={draft ?? s.bpm}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={e => { if (e.key === 'Enter') commitDraft() }}
          className={`${field} w-20 text-center font-mono font-bold`}
        />
      </label>

      <div role="group" aria-label="Time signature" className="grid grid-cols-4 gap-1.5">
        {TIME_SIGNATURES.map(ts => (
          <button
            key={ts}
            type="button"
            aria-pressed={ts === s.timeSignature}
            onClick={() => metronome.setTimeSignature(ts)}
            className={`${chip} ${ts === s.timeSignature ? 'bg-app-action text-app-on-action border-app-action' : 'bg-app-base text-app-text border-app-border hover:text-app-action'}`}
          >
            {ts}
          </button>
        ))}
      </div>

      <div role="group" aria-label="Beats" className="flex flex-wrap justify-center gap-x-2 gap-y-1">
        {rows.map((row, groupIndex) => (
          <div key={groupIndex} className="flex gap-1">
            {row.map(index => {
              const accent = s.accents[s.timeSignature][index]
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => metronome.cycleAccent(index)}
                  aria-label={`Beat ${index + 1}, ${ACCENT_LABEL[accent]}. Tap to change.`}
                  className={lightClass(accent, s.isRunning && s.currentBeat === index + 1)}
                >
                  {index + 1}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      {s.isRunning && s.countingIn && <div className="text-[11px] font-bold uppercase tracking-wider text-app-action">Count-in</div>}

      <button
        type="button"
        onClick={() => metronome.toggle()}
        aria-pressed={s.isRunning}
        className={`w-full min-h-11 rounded-xl font-black text-sm flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-action ${
          s.isRunning
            ? 'bg-[#DC6E67] text-white hover:bg-[#E53935]'
            : 'bg-app-action text-app-on-action'
        }`}
      >
        {s.isRunning ? <Pause className="w-5 h-5" aria-hidden="true" /> : <Play className="w-5 h-5" aria-hidden="true" />}
        <span>{s.isRunning ? 'Stop' : 'Start'}</span>
      </button>

      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          aria-pressed={s.countIn}
          onClick={() => metronome.setCountIn(!s.countIn)}
          className={`${chip} ${s.countIn ? 'bg-app-action text-app-on-action border-app-action' : 'bg-app-base text-app-text border-app-border'}`}
        >
          Count-in
        </button>
        <button
          type="button"
          aria-pressed={s.isMuted}
          onClick={() => metronome.toggleMute()}
          className={`${chip} ${s.isMuted ? 'bg-app-action text-app-on-action border-app-action' : 'bg-app-base text-app-text border-app-border'}`}
        >
          {s.isMuted ? 'Lights only' : 'Sound on'}
        </button>
      </div>

      <details className="rounded-xl border border-app-border bg-app-base text-left">
        <summary className="min-h-11 px-3 flex items-center cursor-pointer text-xs font-bold text-app-heading">Sound and split ears</summary>
        <div className="px-3 pb-3 space-y-3">
          {!s.split && (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-app-muted">
                <span>Sound</span>
                <select aria-label="Sound" value={s.sound} onChange={e => metronome.setSound(e.target.value as SoundId)} className={field}>
                  {SOUND_IDS.map(sound => <option key={sound} value={sound}>{SOUND_LABEL[sound]}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-app-muted">
                <span>Volume</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  aria-label="Volume"
                  value={Math.round(s.volume * 100)}
                  onChange={e => metronome.setVolume(Number(e.target.value) / 100)}
                  className="min-h-11 accent-app-action cursor-pointer"
                />
              </label>
            </div>
          )}
          <div className="space-y-1">
            <button
              type="button"
              aria-pressed={s.split}
              onClick={() => metronome.setSplit(!s.split)}
              className={`${chip} w-full ${s.split ? 'bg-app-action text-app-on-action border-app-action' : 'bg-app-base text-app-text border-app-border'}`}
            >
              Split ears
            </button>
            <p className="text-[11px] text-app-muted">Use earphones for split ears.</p>
          </div>
          {s.split && (
            <>
              <EarControls label="Left ear" ear={s.ears.left} onChange={patch => metronome.setEar('left', patch)} />
              <EarControls label="Right ear" ear={s.ears.right} onChange={patch => metronome.setEar('right', patch)} />
            </>
          )}
        </div>
      </details>
    </div>
  )
}
