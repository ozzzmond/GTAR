import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  Users,
  Gauge,
  Sliders,
  Volume2,
  Play,
  Pause,
  Plus,
  Minus,
  Loader2,
  Radio,
  Wifi,
  Clock,
  Trash2,
} from 'lucide-react'
import {
  bandSync,
  type BandSyncState,
  getRecentLeaders,
  clearRecentLeaders,
  formatLeaderAddress,
} from '../utils/bandSync'
import { metronome, type MetronomeState } from '../utils/metronome'

interface BandSyncModalProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: 'metronome' | 'tuner' | 'sync'
  onPushSetlist?: () => { success: boolean; message: string }
  activeSetlistName?: string
  activeSetlistSongCount?: number
}

const GUITAR_STRINGS = [
  { name: 'E2 (6th)', freq: 82.41 },
  { name: 'A2 (5th)', freq: 110.0 },
  { name: 'D3 (4th)', freq: 146.83 },
  { name: 'G3 (3rd)', freq: 196.0 },
  { name: 'B3 (2nd)', freq: 246.94 },
  { name: 'E4 (1st)', freq: 329.63 },
]

export const BandSyncModal: React.FC<BandSyncModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'sync',
  onPushSetlist: _onPushSetlist,
  activeSetlistName: _activeSetlistName,
  activeSetlistSongCount: _activeSetlistSongCount = 0,
}) => {
  const [activeTab, setActiveTab] = useState<'metronome' | 'tuner' | 'sync'>(initialTab)
  const [syncState, setSyncState] = useState<BandSyncState>(() => bandSync.getState())
  const [metroState, setMetroState] = useState<MetronomeState>(() => metronome.getState())
  const [activeTuningString, setActiveTuningString] = useState<string | null>(null)
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null)
  const [activeOsc, setActiveOsc] = useState<OscillatorNode | null>(null)
  const tapTimesRef = useRef<number[]>([])

  // Band Sync local UI state
  const [inputIp, setInputIp] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return (
        localStorage.getItem('gtar_band_sync_leader_ip') ||
        'ws://192.168.100.173:8765'
      )
    }
    return 'ws://192.168.100.173:8765'
  })

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab, isOpen])

  // Sync state subscription
  useEffect(() => {
    const unsub = bandSync.subscribe((st) => setSyncState(st))
    return unsub
  }, [])

  // Keep input in sync with external role changes
  useEffect(() => {
    if (syncState.wsLeaderIp && !inputIp) {
      setInputIp(syncState.wsLeaderIp)
    }
  }, [syncState.wsLeaderIp, inputIp])

  // Recent Leaders state
  const [recentLeaders, setRecentLeaders] = useState<string[]>(() => getRecentLeaders())

  // Refresh recent leaders when modal opens or when connection status changes
  useEffect(() => {
    if (isOpen || syncState.wsConnected) {
      setRecentLeaders(getRecentLeaders())
    }
  }, [isOpen, syncState.wsConnected])

  const handleConnect = (rawAddress: string) => {
    const clean = rawAddress.trim()
    if (!clean) return
    const formatted = formatLeaderAddress(clean)
    setInputIp(formatted)
    bandSync.connectWebSocket(formatted)
  }

  const handleClearHistory = () => {
    clearRecentLeaders()
    setRecentLeaders([])
  }

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
        } catch {}
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
        } catch {}
      }
      setActiveOsc(null)
      setActiveTuningString(null)
      return
    }

    if (activeOsc) {
      try {
        activeOsc.stop()
        activeOsc.disconnect()
      } catch {}
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
      <div className="w-full max-w-lg rounded-2xl bg-[#073642] border border-[#1A4A55] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1A4A55] flex items-center justify-between bg-[#002B36]/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#2AA198]/20 border border-[#2AA198]/30 flex items-center justify-center text-[#2AA198]">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#FDF6E3]">STAGE TOOLS & SYNC</h2>
              <p className="text-xs text-[#93A1A1]">Metronome, Guitar Tuner & Band Sync</p>
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

        {/* 3-Tab Segmented Switcher */}
        <div className="p-3 border-b border-[#1A4A55] bg-[#002B36]/30">
          <div className="grid grid-cols-3 gap-1 bg-[#002B36] p-1 rounded-xl border border-[#1A4A55]">
            <button
              type="button"
              onClick={() => setActiveTab('metronome')}
              className={`py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'metronome'
                  ? 'bg-[#2AA198] text-[#002B36] shadow-sm'
                  : 'text-[#93A1A1] hover:text-[#FDF6E3]'
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
                  ? 'bg-[#2AA198] text-[#002B36] shadow-sm'
                  : 'text-[#93A1A1] hover:text-[#FDF6E3]'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Guitar Tuner</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('sync')}
              className={`py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'sync'
                  ? 'bg-[#B58900] text-[#002B36] shadow-sm'
                  : 'text-[#93A1A1] hover:text-[#FDF6E3]'
              }`}
            >
              <Wifi className="w-3.5 h-3.5" />
              <span>Band Sync</span>
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
                <div className="text-6xl font-black font-mono text-[#FDF6E3] tracking-tighter">
                  {metroState.bpm}
                </div>
                <div className="text-xs font-bold uppercase tracking-widest text-[#2AA198] mt-1">
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
                  className="w-full accent-[#2AA198] cursor-pointer"
                />

                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => metronome.setBpm(metroState.bpm - 5)}
                    className="px-2.5 py-1 rounded-lg bg-[#002B36] border border-[#1A4A55] text-xs font-bold text-[#EEE8D5] hover:text-[#2AA198] cursor-pointer"
                  >
                    -5
                  </button>
                  <button
                    type="button"
                    onClick={() => metronome.setBpm(metroState.bpm - 1)}
                    className="p-1.5 rounded-lg bg-[#002B36] border border-[#1A4A55] text-[#EEE8D5] hover:text-[#2AA198] cursor-pointer"
                  >
                    <Minus className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={handleTapTempo}
                    className="px-5 py-2 rounded-xl bg-[#002B36] border border-[#2AA198] text-xs font-extrabold text-[#2AA198] hover:bg-[#2AA198]/15 cursor-pointer uppercase tracking-wider active:scale-95 transition-transform"
                  >
                    Tap Tempo
                  </button>

                  <button
                    type="button"
                    onClick={() => metronome.setBpm(metroState.bpm + 1)}
                    className="p-1.5 rounded-lg bg-[#002B36] border border-[#1A4A55] text-[#EEE8D5] hover:text-[#2AA198] cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => metronome.setBpm(metroState.bpm + 5)}
                    className="px-2.5 py-1 rounded-lg bg-[#002B36] border border-[#1A4A55] text-xs font-bold text-[#EEE8D5] hover:text-[#2AA198] cursor-pointer"
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
                    : 'bg-[#2AA198] text-[#002B36] hover:bg-[#35B8AD]'
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
              <p className="text-xs text-[#93A1A1] text-center">
                Click any string to play standard guitar reference frequency:
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
                          ? 'bg-[#2AA198]/20 border-[#2AA198] text-[#2AA198] shadow-md'
                          : 'bg-[#002B36] border-[#1A4A55] text-[#EEE8D5] hover:border-[#2AA198]'
                      }`}
                    >
                      <Volume2
                        className={`w-4 h-4 ${isPlaying ? 'text-[#2AA198] animate-pulse' : 'text-[#93A1A1]'}`}
                      />
                      <span className="text-xs font-extrabold">{str.name}</span>
                      <span className="text-[10px] font-mono text-[#93A1A1]">
                        {str.freq.toFixed(1)} Hz
                      </span>
                    </button>
                  )
                })}
              </div>

              {activeTuningString && (
                <div className="p-3 rounded-xl bg-[#2AA198]/10 border border-[#2AA198]/30 text-center text-xs text-[#2AA198] font-bold">
                  Now playing reference tone for {activeTuningString}
                </div>
              )}
            </div>
          )}

          {/* 3. BAND SYNC PANEL (MEMBER-ONLY CLIENT FOR WEB) */}
          {activeTab === 'sync' && (
            <div className="space-y-4">
              {/* Mode Selector Pills: Sync Off | Band Member */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-[#002B36] rounded-xl border border-[#1A4A55]">
                <button
                  type="button"
                  onClick={() => {
                    bandSync.disconnectWebSocket()
                    bandSync.setRole('OFF')
                  }}
                  className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    syncState.role === 'OFF'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 font-extrabold shadow-sm'
                      : 'text-[#93A1A1] hover:text-[#FDF6E3]'
                  }`}
                >
                  <span>Sync Off</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (syncState.role !== 'CLIENT') {
                      bandSync.setRole('CLIENT')
                    }
                  }}
                  className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    syncState.role === 'CLIENT'
                      ? 'bg-amber-500 text-black font-extrabold shadow-sm'
                      : 'text-[#93A1A1] hover:text-amber-400'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Band Member</span>
                </button>
              </div>

              {/* 1. STATE: OFF */}
              {syncState.role === 'OFF' && (
                <div className="p-6 rounded-2xl bg-[#002B36] border border-[#1A4A55] text-center space-y-4 shadow-lg animate-fade-in">
                  <div className="w-14 h-14 rounded-2xl bg-[#073642] border border-[#1A4A55] flex items-center justify-center mx-auto text-amber-400">
                    <Users className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#FDF6E3]">
                      Band Member Client (Sync Off)
                    </h3>
                    <p className="text-xs text-[#93A1A1] mt-1.5 max-w-sm mx-auto leading-relaxed">
                      Connect directly to an Android Stage Leader tablet on your local Wi-Fi or hotspot to automatically mirror songs, key changes, and autoscrolling.
                    </p>
                  </div>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        bandSync.setRole('CLIENT')
                      }}
                      className="py-2.5 px-6 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs transition-colors cursor-pointer shadow-md inline-flex items-center gap-2"
                    >
                      <Users className="w-4 h-4" />
                      <span>Connect as Band Member</span>
                    </button>
                  </div>
                </div>
              )}

              {/* 2. STATE: BAND MEMBER (CLIENT) */}
              {syncState.role === 'CLIENT' && (
                <div className="p-5 rounded-2xl bg-[#002B36] border border-[#2AA198] space-y-4 shadow-lg animate-fade-in">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-3 h-3 rounded-full ${
                          syncState.wsConnected
                            ? 'bg-emerald-500 animate-pulse'
                            : syncState.wsConnecting
                            ? 'bg-amber-400 animate-ping'
                            : 'bg-zinc-500'
                        }`}
                      />
                      <span
                        className={`text-xs font-black tracking-wide ${
                          syncState.wsConnected
                            ? 'text-emerald-400'
                            : syncState.wsConnecting
                            ? 'text-amber-400'
                            : 'text-[#93A1A1]'
                        }`}
                      >
                        {syncState.wsConnected
                          ? 'CONNECTED TO LEADER'
                          : syncState.wsConnecting
                          ? 'SEARCHING FOR LEADER'
                          : 'BAND MEMBER'}
                      </span>
                    </div>

                    <div
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 ${
                        syncState.wsConnected
                          ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
                          : syncState.wsConnecting
                          ? 'bg-amber-400/20 border border-amber-400/40 text-amber-400'
                          : 'bg-[#073642] border border-[#1A4A55] text-[#93A1A1]'
                      }`}
                    >
                      {syncState.wsConnecting && (
                        <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                      )}
                      <span>{syncState.wsStatus}</span>
                    </div>
                  </div>

                  {syncState.wsConnected ? (
                    <div className="space-y-4">
                      <p className="text-xs text-[#FDF6E3] leading-relaxed">
                        Synced with Band Leader ({syncState.wsLeaderIp || 'Leader'}). Your screen will automatically follow song changes and scrolling.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          bandSync.disconnectWebSocket()
                          bandSync.setRole('OFF')
                        }}
                        className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-xs transition-colors cursor-pointer shadow-md"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-bold text-[#93A1A1] block mb-1">
                          Leader WebSocket Address
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={inputIp}
                            onChange={(e) => setInputIp(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && inputIp.trim()) {
                                handleConnect(inputIp)
                              }
                            }}
                            placeholder="ws://192.168.x.x:8765"
                            className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#073642] border border-[#1A4A55] text-xs font-mono text-[#FDF6E3] focus:border-amber-400 outline-none"
                          />
                          <button
                            type="button"
                            disabled={!inputIp.trim()}
                            onClick={() => handleConnect(inputIp)}
                            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs disabled:opacity-50 transition-colors cursor-pointer shadow-md shrink-0"
                          >
                            {syncState.wsConnecting ? 'Connecting...' : 'Connect'}
                          </button>
                        </div>
                        <p className="text-[11px] text-[#93A1A1] mt-1.5 font-mono">
                          Enter Android Leader IP or address (e.g. <span className="text-amber-400">ws://192.168.100.173:8765</span> or <span className="text-amber-400">192.168.43.1</span>)
                        </p>
                      </div>

                      {/* Recent Leaders UI */}
                      {recentLeaders.length > 0 && (
                        <div className="pt-1 space-y-1.5 animate-fade-in">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-[#93A1A1] uppercase tracking-wider flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-amber-400" />
                              <span>Recent Leaders</span>
                            </span>
                            <button
                              type="button"
                              onClick={handleClearHistory}
                              className="text-[10px] text-[#93A1A1] hover:text-red-400 transition-colors cursor-pointer flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-red-500/10"
                              title="Clear recent leader connection history"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Clear History</span>
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {recentLeaders.map((address) => (
                              <button
                                key={address}
                                type="button"
                                onClick={() => handleConnect(address)}
                                className="px-2.5 py-1 rounded-lg bg-[#073642] hover:bg-amber-500/20 border border-[#1A4A55] hover:border-amber-500/50 text-[#FDF6E3] hover:text-amber-400 text-[11px] font-mono font-medium transition-all cursor-pointer flex items-center gap-1.5 group shadow-xs active:scale-95"
                                title={`Connect to ${address}`}
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 group-hover:bg-amber-400 transition-colors" />
                                <span>{address}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {syncState.wsConnecting && (
                        <button
                          type="button"
                          onClick={() => {
                            bandSync.disconnectWebSocket()
                            bandSync.setRole('OFF')
                          }}
                          className="w-full py-2.5 rounded-xl bg-[#073642] border border-[#1A4A55] text-[#93A1A1] hover:text-red-400 font-bold text-xs transition-colors cursor-pointer mt-2"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[#1A4A55] bg-[#002B36]/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[#002B36] border border-[#1A4A55] text-xs font-bold text-[#93A1A1] hover:text-[#FDF6E3] transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
