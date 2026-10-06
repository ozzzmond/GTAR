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
        className="w-full max-w-lg bg-app-base border border-app-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-app-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-app-border flex items-center justify-between bg-app-surface">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-app-action/20 text-app-action">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <h2 id="tv-presentation-title" className="text-lg font-bold text-app-heading">
                Sync to TV / External Display
              </h2>
              <p className="text-xs text-app-muted">
                Live stage teleprompter for Smart TV or secondary displays
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-app-muted hover:text-app-heading hover:bg-app-base transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-sm">
          {/* iOS / Mobile Single-Screen Platform Notice */}
          {caps.platform === 'ios' && (
            <div className="p-3.5 rounded-lg bg-app-accent/15 border border-app-accent/40 text-xs leading-relaxed text-app-text flex items-start gap-2.5">
              <Smartphone className="w-4 h-4 text-app-accent shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-app-accent">iOS WebKit Platform Guard: </span>
                Direct multi-window popups are restricted on iOS. Use TV Browser Pairing or AirPlay
                Mirroring below to keep stage controls on your iPhone while streaming to the TV.
              </div>
            </div>
          )}

          {/* Option 1: Secondary TV Browser Pairing */}
          <div className="space-y-3 p-4 rounded-lg bg-app-surface/60 border border-app-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-app-action" />
                <span className="text-xs font-bold uppercase tracking-wider text-app-action">
                  Option 1 &bull; Secondary TV Browser Pairing
                </span>
              </div>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-app-base border border-app-border text-app-action">
                {sessionId}
              </span>
            </div>

            <p className="text-xs text-app-muted">
              Open the web browser on your Smart TV, Apple TV, Fire TV, or secondary laptop and load this URL:
            </p>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={pairingUrl}
                className="flex-1 px-3 py-2 text-xs font-mono bg-app-base border border-app-border rounded-lg text-app-heading focus:outline-none select-all truncate"
                aria-label="TV Pairing URL"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-2 text-xs font-bold rounded-lg bg-app-action text-app-on-action hover:bg-app-action/90 transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
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

            <ol className="text-xs text-app-muted space-y-1 list-decimal list-inside pl-1 pt-1">
              <li>Open your Smart TV or Apple TV web browser.</li>
              <li>Navigate to the address above (or scan LAN address).</li>
              <li>The TV teleprompter mirrors chords, lyrics, and autoscroll live.</li>
            </ol>
          </div>

          {/* Option 2: AirPlay Screen Mirroring (Secondary Manual Fallback) */}
          <div className="space-y-3 p-4 rounded-lg bg-app-surface/60 border border-app-border">
            <div className="flex items-center gap-2">
              <ExternalLink className="w-4 h-4 text-app-link" />
              <span className="text-xs font-bold uppercase tracking-wider text-app-link">
                Option 2 &bull; AirPlay Screen Mirroring (Instant Fallback)
              </span>
            </div>

            <p className="text-xs text-app-muted">
              Mirror your iPhone screen directly to Apple TV or any AirPlay-compatible Smart TV:
            </p>

            <ol className="text-xs text-app-muted space-y-1 list-decimal list-inside pl-1">
              <li>
                Swipe down from top-right corner of iPhone to open{' '}
                <span className="text-app-heading font-semibold">Control Center</span>.
              </li>
              <li>
                Tap the <span className="text-app-heading font-semibold">Screen Mirroring</span> icon (two overlapping rectangles).
              </li>
              <li>
                Select your <span className="text-app-heading font-semibold">Apple TV</span> or Smart TV.
              </li>
              <li>
                Tap <span className="text-app-action font-semibold">Fullscreen</span> in Stage View for distraction-free performance view.
              </li>
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-app-border bg-app-surface flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-app-muted">
            <span className="w-2 h-2 rounded-full bg-app-button" />
            <span>Ready to Pair &bull; Route: /stage/present</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-app-base border border-app-border text-app-text hover:text-app-action hover:border-app-action transition-colors cursor-pointer"
          >
            Back to Stage Controls
          </button>
        </div>
      </div>
    </div>
  )
}
