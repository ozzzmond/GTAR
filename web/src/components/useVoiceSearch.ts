import { useCallback, useEffect, useRef, useState } from 'react'
import { tunerMic } from '../utils/tunerEngine'
import { tunerTone } from '../utils/tunerTone'
import { metronome } from '../utils/metronome'

interface Recognition {
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0?: { transcript: string } }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  abort(): void
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition
  webkitSpeechRecognition?: new () => Recognition
}
const audioBusy = () => ['starting', 'listening'].includes(tunerMic.getSnapshot().state)
  || tunerTone.getActive() !== null || metronome.getState().isRunning

/** One gesture, one bounded session, at most one query write. */
export function useVoiceSearch(onQuery: (query: string) => void, context: string) {
  const Constructor = typeof window === 'undefined' ? undefined
    : (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition
  const session = useRef<{ recognition: Recognition; token: object; timer: ReturnType<typeof setTimeout> } | null>(null)
  const [message, setMessage] = useState('')
  const [listening, setListening] = useState(false)
  const finish = useCallback((message = 'Voice search cancelled.') => {
    const current = session.current
    if (!current) return
    session.current = null
    clearTimeout(current.timer)
    current.recognition.onresult = null
    current.recognition.onerror = null
    current.recognition.onend = null
    try { current.recognition.abort() } catch { /* Already ended. */ }
    setListening(false)
    setMessage(message)
  }, [])

  useEffect(() => {
    const hide = () => { if (document.hidden) finish() }
    const cancel = () => finish()
    const conflict = () => { if (audioBusy()) finish('Stop the tuner, reference tone or metronome before voice search.') }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('pagehide', cancel)
    window.addEventListener('popstate', cancel)
    window.addEventListener('hashchange', cancel)
    const unsub = [tunerMic.subscribe(conflict), tunerTone.subscribe(conflict), metronome.subscribe(conflict)]
    return () => {
      finish()
      unsub.forEach(fn => fn())
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('pagehide', cancel)
      window.removeEventListener('popstate', cancel)
      window.removeEventListener('hashchange', cancel)
    }
  }, [finish, context])

  const toggle = () => {
    if (session.current) { finish(); return }
    if (!Constructor) return
    if (audioBusy()) { setMessage('Stop the tuner, reference tone or metronome before voice search.'); return }
    try {
      const recognition = new Constructor()
      const token = {}
      recognition.continuous = false
      recognition.interimResults = false
      session.current = { recognition, token, timer: setTimeout(() => { if (session.current?.token === token) finish('Voice search timed out. Try again.') }, 15000) }
      const current = () => session.current?.token === token
      recognition.onresult = event => {
        if (!current()) return
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (!result.isFinal) continue
          const query = (result[0]?.transcript || '').trim().slice(0, 200)
          finish(query ? 'Voice search complete.' : 'No speech heard. Try again.')
          if (query) onQuery(query)
          return
        }
      }
      recognition.onerror = event => {
        if (!current()) return
        const errors: Record<string, string> = {
          'not-allowed': 'Microphone permission denied. Check browser settings.',
          'service-not-allowed': 'Speech service unavailable or denied.',
          'no-speech': 'No speech heard. Try again.',
          network: 'Speech service network error. Try again.',
        }
        finish(errors[event.error] || 'Voice search failed. Try again.')
      }
      recognition.onend = () => { if (current()) finish('No speech heard. Try again.') }
      setMessage('Listening… Tap microphone to cancel.')
      setListening(true)
      recognition.start()
    } catch {
      finish('Voice search could not start. Try again.')
      setMessage('Voice search could not start. Try again.')
    }
  }
  return { supported: !!Constructor, listening, message, toggle, cancel: finish }
}
