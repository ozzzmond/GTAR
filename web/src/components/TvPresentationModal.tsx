import React, { useState } from 'react'
import { Tv, Copy, Check, ExternalLink, X, Smartphone, Monitor } from 'lucide-react'
import { stageCast } from '../utils/stageCast'

export interface TvPresentationModalProps {
  isOpen: boolean
  onClose: () => void
  detectedLanIp?: string
}

export const TvPresentationModal: React.FC<TvPresentationModalProps> = ({
  isOpen,
  onClose,
  detectedLanIp,
}) => {
  const [copied, setCopied] = useState(false)

  if (!isOpen) return null

  const caps = stageCast.getPresentationCapabilities()
  const sessionId = stageCast.getPresentationSessionId()
  const pairingUrl = stageCast.getPresentationPairingUrl(detectedLanIp)

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(pairingUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      // Fallback if clipboard API fails
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tv-presentation-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#002B36] border border-[#1A4A55] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-[#EEE8D5]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#1A4A55] flex items-center justify-between bg-[#073642]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#2AA198]/20 text-[#2AA198]">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <h2 id="tv-presentation-title" className="text-lg font-bold text-[#FDF6E3]">
                Sync to TV / External Display
              </h2>
              <p className="text-xs text-[#93A1A1]">
                Live stage teleprompter for Smart TV or secondary displays
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#002B36] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-sm">
          {/* iOS / Mobile Single-Screen Platform Notice */}
          {caps.platform === 'ios' && (
            <div className="p-3.5 rounded-lg bg-[#B58900]/15 border border-[#B58900]/40 text-xs leading-relaxed text-[#EEE8D5] flex items-start gap-2.5">
              <Smartphone className="w-4 h-4 text-[#B58900] shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-[#B58900]">iOS WebKit Platform Guard: </span>
                Direct multi-window popups are restricted on iOS. Use TV Browser Pairing or AirPlay
                Mirroring below to keep stage controls on your iPhone while streaming to the TV.
              </div>
            </div>
          )}

          {/* Option 1: Secondary TV Browser Pairing */}
          <div className="space-y-3 p-4 rounded-lg bg-[#073642]/60 border border-[#1A4A55]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-[#2AA198]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#2AA198]">
                  Option 1 &bull; Secondary TV Browser Pairing
                </span>
              </div>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#002B36] border border-[#1A4A55] text-[#2AA198]">
                {sessionId}
              </span>
            </div>

            <p className="text-xs text-[#93A1A1]">
              Open the web browser on your Smart TV, Apple TV, Fire TV, or secondary laptop and load this URL:
            </p>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={pairingUrl}
                className="flex-1 px-3 py-2 text-xs font-mono bg-[#002B36] border border-[#1A4A55] rounded-lg text-[#FDF6E3] focus:outline-none select-all truncate"
                aria-label="TV Pairing URL"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-2 text-xs font-bold rounded-lg bg-[#2AA198] text-[#002B36] hover:bg-[#2AA198]/90 transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            <ol className="text-xs text-[#93A1A1] space-y-1 list-decimal list-inside pl-1 pt-1">
              <li>Open your Smart TV or Apple TV web browser.</li>
              <li>Navigate to the address above (or scan LAN address).</li>
              <li>The TV teleprompter mirrors chords, lyrics, and autoscroll live.</li>
            </ol>
          </div>

          {/* Option 2: AirPlay Screen Mirroring (Secondary Manual Fallback) */}
          <div className="space-y-3 p-4 rounded-lg bg-[#073642]/60 border border-[#1A4A55]">
            <div className="flex items-center gap-2">
              <ExternalLink className="w-4 h-4 text-[#268BD2]" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#268BD2]">
                Option 2 &bull; AirPlay Screen Mirroring (Instant Fallback)
              </span>
            </div>

            <p className="text-xs text-[#93A1A1]">
              Mirror your iPhone screen directly to Apple TV or any AirPlay-compatible Smart TV:
            </p>

            <ol className="text-xs text-[#93A1A1] space-y-1 list-decimal list-inside pl-1">
              <li>
                Swipe down from top-right corner of iPhone to open{' '}
                <span className="text-[#FDF6E3] font-semibold">Control Center</span>.
              </li>
              <li>
                Tap the <span className="text-[#FDF6E3] font-semibold">Screen Mirroring</span> icon (two overlapping rectangles).
              </li>
              <li>
                Select your <span className="text-[#FDF6E3] font-semibold">Apple TV</span> or Smart TV.
              </li>
              <li>
                Tap <span className="text-[#2AA198] font-semibold">Fullscreen</span> in Stage View for distraction-free performance view.
              </li>
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#1A4A55] bg-[#073642] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-[#93A1A1]">
            <span className="w-2 h-2 rounded-full bg-[#B58900]" />
            <span>Ready to Pair &bull; Route: /stage/present</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-[#002B36] border border-[#1A4A55] text-[#EEE8D5] hover:text-[#2AA198] hover:border-[#2AA198] transition-colors cursor-pointer"
          >
            Back to Stage Controls
          </button>
        </div>
      </div>
    </div>
  )
}
