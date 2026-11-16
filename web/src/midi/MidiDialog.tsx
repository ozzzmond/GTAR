import React, { useEffect, useRef, useState } from 'react'
import { Music, RotateCcw } from 'lucide-react'
import { AppModal, AppModalSection } from '../components/AppModal'
import { MIDI_ACTIONS, midiActionLabel, type MidiActionId } from './actions'
import { MidiHelp } from './MidiHelp'
import { MidiPill } from './MidiRow'
import { learnMidiInput, retryMidi, setMidiEnabled, useMidiSnapshot, type MidiSnapshot, type MidiState } from './loader'
import { assignMidiMapping, clearMidiMapping, midiInputLabel, resetMidiMappings, type MidiInput, type MidiMappings } from './mapping'
import { readMidiSettings, subscribeMidiSettings, writeMidiSettings } from './settings'

/** Learn gives up after this long without an input that counts. A starting value, to be tuned in QA. */
export const MIDI_LEARN_TIMEOUT_MS = 10_000

const SAVE_FAILED = 'Could not save on this device.'

function statusText({ state, devices }: MidiSnapshot): string {
  switch (state) {
    case 'off': return 'MIDI is off. Turn it on to use a pedal or controller.'
    case 'starting': return 'Looking for MIDI devices…'
    case 'allow': return 'Your browser needs your OK to use MIDI.'
    case 'blocked': return 'MIDI is blocked for this site. Allow it in your browser\'s site settings, then try again.'
    case 'no-device': return 'No MIDI device found. Plug in or pair your controller.'
    case 'connected': return devices.length === 1 ? `Connected: ${devices[0]}` : `Connected: ${devices.length} devices`
    case 'error': return 'MIDI could not start. Turn it off and on again.'
    case 'unavailable': return 'Not available on this device/browser'
  }
}

/** The one context button under the status line. States without an entry have no button. */
const ACTIONS: Partial<Record<MidiState, { label: string; run: () => void }>> = {
  off: { label: 'Turn on', run: () => setMidiEnabled(true) },
  allow: { label: 'Allow MIDI', run: retryMidi },
  blocked: { label: 'Try again', run: retryMidi },
  'no-device': { label: 'Check again', run: retryMidi },
}

/** Learn is never stored: it lives in the open dialog only. */
type LearnPhase =
  | { kind: 'idle' }
  | { kind: 'learning'; action: MidiActionId }
  | { kind: 'conflict'; action: MidiActionId; input: MidiInput; other: MidiActionId }

const IDLE: LearnPhase = { kind: 'idle' }

/** The saved mappings, re-read after every change in this tab or another one. */
function useMidiMappings(): MidiMappings {
  const [mappings, setMappings] = useState(() => readMidiSettings().mappings)
  useEffect(() => subscribeMidiSettings(() => setMappings(readMidiSettings().mappings)), [])
  return mappings
}

/** Stores the mappings next to the other saved choices. False when this device could not save. */
const saveMappings = (mappings: MidiMappings): boolean => writeMidiSettings({ ...readMidiSettings(), mappings })

const button = 'min-h-11 min-w-11 px-3 rounded-xl border border-app-border bg-app-base text-app-heading text-xs font-semibold flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action'
const liveButton = `${button} hover:bg-app-surface disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-app-base`
const quietButton = 'min-h-11 min-w-11 px-3 rounded-xl text-xs text-app-muted hover:text-app-heading flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action'

interface MidiDialogProps {
  onClose: () => void
  returnFocusRef?: React.RefObject<HTMLElement | null>
}

/** MIDI as an application-level dialog; mounted only while open. Connection, the nine actions with Learn and Clear, and Reset. */
export const MidiDialog: React.FC<MidiDialogProps> = ({ onClose, returnFocusRef }) => {
  const snapshot = useMidiSnapshot()
  const mappings = useMidiMappings()
  const action = ACTIONS[snapshot.state]
  const connected = snapshot.state === 'connected'

  const [phase, setPhase] = useState<LearnPhase>(IDLE)
  /** The last Learn, Clear or Reset result. `action` says which row shows it; 'all' is the footer. */
  const [note, setNote] = useState<{ action: MidiActionId | 'all'; text: string } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const learnButtons = useRef<Partial<Record<MidiActionId, HTMLButtonElement | null>>>({})
  const resetButton = useRef<HTMLButtonElement>(null)
  /** Where focus goes once a button that held it has left the screen. */
  const focusNext = useRef<MidiActionId | 'reset' | null>(null)

  // Learn ends when MIDI is switched off or the device goes away; the status line says why.
  if (!connected && phase.kind === 'learning') setPhase(IDLE)

  const finish = (target: MidiActionId, input: MidiInput, replace: boolean) => {
    const result = assignMidiMapping(readMidiSettings().mappings, target, input, { replace })
    if (!result.ok) {
      // An input that is already used is never moved without the player's Replace.
      setPhase(result.reason === 'conflict' ? { kind: 'conflict', action: target, input, other: result.conflict } : IDLE)
      return
    }
    setPhase(IDLE)
    setNote({ action: target, text: saveMappings(result.mappings) ? `${midiActionLabel(target)} set to ${midiInputLabel(input)}.` : SAVE_FAILED })
  }

  // One action learns at a time. Capture, Cancel, the timeout, MIDI off and closing the dialog
  // all end here: the cleanup stops the engine's Learn and the timer.
  const learningAction = phase.kind === 'learning' ? phase.action : null
  useEffect(() => {
    if (!learningAction) return
    const cancel = learnMidiInput(input => finish(learningAction, input, false))
    const timer = setTimeout(() => {
      setPhase(IDLE)
      setNote({ action: learningAction, text: 'Nothing received. Try again.' })
    }, MIDI_LEARN_TIMEOUT_MS)
    return () => { cancel(); clearTimeout(timer) }
  }, [learningAction])

  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    ;(target === 'reset' ? resetButton.current : learnButtons.current[target])?.focus({ preventScroll: true })
  })

  const startLearn = (target: MidiActionId) => { setNote(null); setConfirmReset(false); setPhase({ kind: 'learning', action: target }) }
  const cancelLearn = () => { focusNext.current = phase.kind === 'conflict' ? phase.action : null; setPhase(IDLE) }
  const replace = () => {
    if (phase.kind !== 'conflict') return
    focusNext.current = phase.action
    finish(phase.action, phase.input, true)
  }
  const clear = (target: MidiActionId) => {
    focusNext.current = target
    setPhase(IDLE)
    setConfirmReset(false)
    setNote(saveMappings(clearMidiMapping(readMidiSettings().mappings, target)) ? null : { action: target, text: SAVE_FAILED })
  }
  const askReset = () => { setPhase(IDLE); setNote(null); setConfirmReset(true) }
  const closeReset = (text: string | null) => {
    focusNext.current = 'reset'
    setConfirmReset(false)
    setNote(text ? { action: 'all', text } : null)
  }
  const reset = () => closeReset(saveMappings(resetMidiMappings()) ? 'Mappings cleared.' : SAVE_FAILED)

  /** Esc cancels a waiting Learn or its Replace question first; the next Esc closes the dialog. */
  const onEscape = () => {
    if (phase.kind === 'idle') return false
    setPhase(IDLE)
    return true
  }

  const footer = (
    <>
      <p role="status" aria-live="polite" data-testid="midi-reset-status" className="w-full text-xs text-app-heading empty:-mb-2">
        {note?.action === 'all' ? note.text : null}
      </p>
      {confirmReset ? (
        <div className="mr-auto flex flex-wrap items-center gap-1.5" role="group" aria-label="Confirm reset" data-testid="midi-reset-confirm">
          <span className="text-xs text-app-heading">Clear all MIDI mappings?</span>
          <button type="button" data-testid="midi-reset-yes" onClick={reset} className={`${button} hover:bg-app-surface`}>Reset</button>
          <button type="button" data-testid="midi-reset-no" autoFocus onClick={() => closeReset(null)} className={quietButton}>Cancel</button>
        </div>
      ) : (
        <button ref={resetButton} type="button" data-testid="midi-reset" onClick={askReset} className={`${button} hover:bg-app-surface gap-1.5 mr-auto`}>
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          <span>Reset</span>
        </button>
      )}
    </>
  )

  return (
    <AppModal
      onClose={onClose}
      onEscape={onEscape}
      title="MIDI"
      titleId="midi-modal-title"
      icon={<Music className="w-4 h-4" aria-hidden="true" />}
      panelId="midi-panel"
      testId="midi-panel"
      backdropTestId="midi-modal-backdrop"
      returnFocusRef={returnFocusRef}
      footerActions={footer}
      headerActions={
        <>
          <MidiPill state={snapshot.state} className="rounded-full px-2" />
          <MidiHelp />
        </>
      }
    >
      <AppModalSection title="Connection">
        {/* The device name is rendered as a text node: plain text, never HTML. */}
        <p role="status" aria-live="polite" data-testid="midi-status" className="text-sm text-app-heading break-words">{statusText(snapshot)}</p>
        {action && (
          <button
            type="button"
            data-testid="midi-status-action"
            onClick={action.run}
            className={`${button} hover:bg-app-surface px-4`}
          >
            {action.label}
          </button>
        )}
      </AppModalSection>

      <AppModalSection title="Actions">
        <ul data-testid="midi-actions" className="divide-y divide-app-border/60">
          {MIDI_ACTIONS.map(({ id, label }) => {
            const mapped = Object.hasOwn(mappings, id) ? mappings[id] : undefined
            const learning = phase.kind === 'learning' && phase.action === id
            const conflict = phase.kind === 'conflict' && phase.action === id ? phase : null
            const busy = learning || conflict !== null
            const message = learning ? 'Press a pedal or button…'
              : conflict ? `${midiInputLabel(conflict.input)} is used by ${midiActionLabel(conflict.other)}.`
              : note?.action === id ? note.text
              : null
            return (
              <li key={id} data-testid={`midi-action-${id}`} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-1.5">
                <span className="col-start-1 row-start-1 text-sm text-app-heading">{label}</span>
                <span data-testid={`midi-mapping-${id}`} className="col-span-2 col-start-1 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 text-xs text-app-muted">
                  {mapped ? midiInputLabel(mapped) : 'Not set'}
                </span>
                <span className="col-start-2 row-start-1 sm:col-start-3 flex items-center justify-end gap-1.5">
                  {conflict && (
                    <button key="replace" type="button" data-testid={`midi-replace-${id}`} onClick={replace} className={`${button} hover:bg-app-surface`}>Replace</button>
                  )}
                  {/* One button for Learn and its Cancel, so keyboard focus stays put when Learn starts and ends. */}
                  <button
                    key="learn"
                    ref={element => { learnButtons.current[id] = element }}
                    type="button"
                    data-testid={`midi-learn-${id}`}
                    aria-label={busy ? `Cancel Learn for ${label}` : `Learn ${label}`}
                    disabled={!busy && (!connected || phase.kind !== 'idle')}
                    onClick={busy ? cancelLearn : () => startLearn(id)}
                    className={busy ? quietButton : liveButton}
                  >
                    {busy ? 'Cancel' : 'Learn'}
                  </button>
                  {mapped && !busy && (
                    <button key="clear" type="button" data-testid={`midi-clear-${id}`} aria-label={`Clear ${label}`} onClick={() => clear(id)} className={`${button} hover:bg-app-surface`}>Clear</button>
                  )}
                </span>
                <p role="status" aria-live="polite" data-testid={`midi-learn-status-${id}`} className="col-span-full text-xs text-app-heading">{message}</p>
              </li>
            )
          })}
        </ul>
      </AppModalSection>
    </AppModal>
  )
}
