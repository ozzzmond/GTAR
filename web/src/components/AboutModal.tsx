import React, { useEffect, useRef } from 'react'
import { X, Info, ExternalLink, ShieldCheck, HardDrive } from 'lucide-react'
import {
  GTAR_APP_VERSION,
  GTAR_PREVIEW_IDENTITY,
  GTAR_DEV_VERSION,
  GTAR_DEV_PROVENANCE,
} from '../types/gtar'
import {
  formatDevDiagLine1,
  formatDevDiagLine2,
  formatHeaderVersion,
  formatPreviewIdentity,
} from '../utils/headerFormatters'
import { isDevEnv } from '../utils/env'
import devMascot from '../assets/bebegirl1-transparent.png'
import prodMascot from '../assets/bebeboy-transparent.png'

interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    closeButtonRef.current?.focus({ preventScroll: true })
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const isProductionRelease = GTAR_APP_VERSION !== '0.0.0-unversioned' && !GTAR_PREVIEW_IDENTITY && !isDevEnv
  const mascotSrc = isProductionRelease ? prodMascot : devMascot
  const displayVersion = formatHeaderVersion(isDevEnv, GTAR_DEV_VERSION, GTAR_APP_VERSION)

  return (
    <div
      data-testid="about-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fade-in"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
        data-testid="about-modal-card"
        className="w-full max-w-md rounded-2xl border border-app-border bg-app-surface text-app-heading shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div data-testid="about-modal-header" className="px-5 py-3 border-b border-app-border/80 flex items-center justify-between bg-app-base/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-app-action/20 border border-app-action/40 flex items-center justify-center text-app-action">
              <Info className="w-4 h-4" aria-hidden="true" />
            </div>
            <h2 id="about-modal-title" className="font-extrabold text-sm sm:text-base tracking-wide">
              About GTAR
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 -mr-2 rounded-xl hover:bg-app-base flex items-center justify-center text-app-muted hover:text-app-heading transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div data-testid="about-modal-body" className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* App Branding */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-app-base border border-app-border">
            <div className="w-12 h-12 rounded-xl border border-app-border bg-app-surface overflow-hidden flex items-center justify-center shrink-0">
              <img src={mascotSrc} alt="GTAR Logo" className="w-full h-full object-contain select-none scale-110" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-extrabold text-sm text-app-heading tracking-tight flex items-center gap-2">
                <span>GTAR Live Stage Companion</span>
                {isDevEnv && (
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-app-accent/25 text-app-accent border border-app-accent/40">DEV</span>
                )}
              </div>
              <p className="text-app-muted text-[11px] mt-0.5 leading-snug">
                Offline-First Stage Teleprompter &amp; Chord Companion for Live Musicians
              </p>
            </div>
          </div>

          {/* Version & Build Metadata */}
          <div className="p-3 rounded-xl bg-app-base border border-app-border space-y-2">
            <div className="text-[11px] font-bold text-app-heading border-b border-app-border/60 pb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-app-accent" />
              <span>Version &amp; Build Metadata</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div>
                <span className="text-app-muted block">Release Version</span>
                <span data-testid="about-version-string" className="font-semibold text-app-heading block">{displayVersion}</span>
              </div>
              <div>
                <span className="text-app-muted block">Environment</span>
                <span className="font-semibold text-app-heading block">{isDevEnv ? 'Development' : 'Production'}</span>
              </div>
              {isDevEnv && (
                <div className="col-span-2 pt-1 border-t border-app-border/40 space-y-0.5">
                  <span className="text-app-muted block text-[10px]">Dev Provenance</span>
                  <span data-testid="about-dev-diag1" className="text-app-heading block text-[10px] truncate">{formatDevDiagLine1(GTAR_DEV_PROVENANCE, GTAR_DEV_VERSION)}</span>
                  <span data-testid="about-dev-diag2" className="text-app-heading block text-[10px] truncate">{formatDevDiagLine2(GTAR_DEV_PROVENANCE)}</span>
                </div>
              )}
              {GTAR_PREVIEW_IDENTITY && (
                <div className="col-span-2 pt-1 border-t border-app-border/40">
                  <span className="text-app-muted block text-[10px]">Preview Identity</span>
                  <span className="text-app-heading block text-[10px] truncate">{formatPreviewIdentity(GTAR_PREVIEW_IDENTITY)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Storage & Architecture */}
          <div className="p-3 rounded-xl bg-app-base border border-app-border space-y-1.5">
            <div className="text-[11px] font-bold text-app-heading flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-app-action" />
              <span>Local-First Storage</span>
            </div>
            <p className="text-[11px] text-app-text leading-relaxed">
              GTAR runs 100% offline. All songbooks, setlists, custom themes, and preferences are stored directly on this device via browser storage. No mandatory login is required.
            </p>
          </div>

          {/* Documentation & Links */}
          <div className="p-3 rounded-xl bg-app-base border border-app-border space-y-2">
            <div className="text-[11px] font-bold text-app-heading border-b border-app-border/60 pb-1">
              Project &amp; License
            </div>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-app-muted">License</span>
                <span className="font-semibold text-app-heading">MIT License</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-app-muted">Source Code</span>
                <a
                  href="https://github.com/ozzzmond/GTAR"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-app-action hover:underline flex items-center gap-1"
                >
                  <span>GitHub Repository</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div data-testid="about-modal-footer" className="px-5 py-3 border-t border-app-border/80 bg-app-base/60 flex items-center justify-end">
          <button
            type="button"
            data-testid="about-modal-close"
            onClick={onClose}
            className="min-h-11 px-4 py-1.5 rounded-lg bg-app-border/50 hover:bg-app-border text-app-heading font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
