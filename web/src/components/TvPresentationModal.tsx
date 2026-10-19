import React, { useState } from 'react'
import { Tv, Copy, Check, Monitor, X } from 'lucide-react'
import { stageCast } from '../utils/stageCast'
import { StageCast2Panel } from './StageCast2Panel'

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

  const pageUrl = stageCast.getPresentationPageUrl(detectedLanIp)

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(pageUrl)
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
                TV / External Display
              </h2>
              <p className="text-xs text-app-muted">
                Open the stage presentation page on a secondary display
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
          {/* TV Browser Presentation Page Section */}
          <div className="space-y-4 p-4 rounded-lg bg-app-surface/60 border border-app-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-app-action" />
                <span className="text-xs font-bold uppercase tracking-wider text-app-action">
                  TV Browser Presentation Page
                </span>
              </div>
            </div>

            <p className="text-xs text-app-muted leading-relaxed">
              Open this bookmarkable URL on your TV or secondary display browser:
            </p>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={pageUrl}
                className="flex-1 px-3 py-2 text-xs font-mono bg-app-base border border-app-border rounded-lg text-app-heading focus:outline-none select-all truncate"
                aria-label="TV Page URL"
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

            {/* Integrated Stage Cast 2.0 P2 Controller */}
            <div className="pt-2 border-t border-app-border/40">
              <StageCast2Panel />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-app-border bg-app-surface flex items-center justify-end">
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
