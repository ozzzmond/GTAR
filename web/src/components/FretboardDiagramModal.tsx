import React from 'react'
import { X } from 'lucide-react'
import type { ChordVoicing } from '../utils/chordDictionary'

interface FretboardDiagramModalProps {
  voicing: ChordVoicing | null
  onClose: () => void
}

export const FretboardDiagramModal: React.FC<FretboardDiagramModalProps> = ({
  voicing,
  onClose,
}) => {
  if (!voicing) return null

  const fretsSummary = voicing.frets.map((f) => (f === -1 ? 'x' : f.toString())).join(' ')

  // SVG Fretboard dimensions
  const width = 240
  const height = 260
  const numStrings = 6
  const numFrets = 5
  const startX = 40
  const endX = 200
  const startY = 50
  const endY = 230

  const stringSpacing = (endX - startX) / (numStrings - 1)
  const fretSpacing = (endY - startY) / numFrets

  const stringNames = ['E', 'A', 'D', 'G', 'B', 'e']

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-[20px] bg-app-surface border border-app-border p-6 shadow-2xl text-app-text select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: Chord Name, Frets & Close */}
        <div className="flex items-center justify-between pb-3 border-b border-app-border">
          <div>
            <h2 className="text-2xl font-black text-app-accent tracking-tight">{voicing.chord}</h2>
            <p className="text-xs font-mono text-app-muted mt-0.5">Frets: {fretsSummary}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-app-muted hover:text-app-heading hover:bg-app-base transition-colors cursor-pointer"
            title="Close Diagram"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Fretboard SVG Canvas */}
        <div className="mt-4 p-2 rounded-xl bg-app-base flex flex-col items-center justify-center border border-app-border">
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
            {/* Base Fret Indicator (if > 1) */}
            {voicing.baseFret > 1 && (
              <text
                x={startX - 12}
                y={startY + fretSpacing / 2 + 5}
                fill="var(--custom-stage-chord)"
                fontSize="12"
                fontWeight="bold"
                fontFamily="monospace"
                textAnchor="end"
              >
                {voicing.baseFret}fr
              </text>
            )}

            {/* Top Nut Bar (if baseFret == 1) */}
            {voicing.baseFret === 1 ? (
              <line
                x1={startX}
                y1={startY}
                x2={endX}
                y2={startY}
                stroke="var(--custom-uiPrimaryText)"
                strokeWidth="5"
                strokeLinecap="round"
              />
            ) : (
              <line
                x1={startX}
                y1={startY}
                x2={endX}
                y2={startY}
                stroke="var(--custom-card-border)"
                strokeWidth="2"
              />
            )}

            {/* Horizontal Frets */}
            {Array.from({ length: numFrets + 1 }).map((_, i) => {
              if (i === 0 && voicing.baseFret === 1) return null
              const y = startY + i * fretSpacing
              return (
                <line
                  key={`fret-${i}`}
                  x1={startX}
                  y1={y}
                  x2={endX}
                  y2={y}
                  stroke="var(--custom-card-border)"
                  strokeWidth="1.5"
                />
              )
            })}

            {/* Vertical Strings */}
            {Array.from({ length: numStrings }).map((_, i) => {
              const x = startX + i * stringSpacing
              return (
                <line
                  key={`string-${i}`}
                  x1={x}
                  y1={startY}
                  x2={x}
                  y2={endY}
                  stroke="var(--custom-uiMutedText)"
                  strokeWidth={i < 3 ? 1.5 : 1}
                />
              )
            })}

            {/* Top String Markers: Open (O) or Muted (X) */}
            {voicing.frets.map((fret, i) => {
              const x = startX + i * stringSpacing
              const y = startY - 14

              if (fret === -1) {
                // Muted X
                return (
                  <text
                    key={`marker-${i}`}
                    x={x}
                    y={y + 4}
                    fill="var(--custom-uiMutedText)"
                    fontSize="13"
                    fontWeight="bold"
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    ✕
                  </text>
                )
              }
              if (fret === 0) {
                // Open O
                return (
                  <circle
                    key={`marker-${i}`}
                    cx={x}
                    cy={y}
                    r="4.5"
                    fill="none"
                    stroke="var(--custom-actionColor)"
                    strokeWidth="1.8"
                  />
                )
              }
              return null
            })}

            {/* Barre Lines (if any) */}
            {voicing.barres?.map((barreFret, idx) => {
              const relativeFret = barreFret - voicing.baseFret + 1
              if (relativeFret < 1 || relativeFret > numFrets) return null
              const y = startY + (relativeFret - 0.5) * fretSpacing

              // Find first and last string with this barre fret
              const indices = voicing.frets
                .map((f, i) => (f >= barreFret ? i : -1))
                .filter((i) => i !== -1)
              if (indices.length < 2) return null

              const x1 = startX + indices[0] * stringSpacing
              const x2 = startX + indices[indices.length - 1] * stringSpacing

              return (
                <line
                  key={`barre-${idx}`}
                  x1={x1}
                  y1={y}
                  x2={x2}
                  y2={y}
                  stroke="var(--custom-stage-chord)"
                  strokeWidth="14"
                  strokeLinecap="round"
                  opacity="0.8"
                />
              )
            })}

            {/* Fretted Dots & Finger Numbers */}
            {voicing.frets.map((fret, i) => {
              if (fret <= 0) return null
              const relativeFret = fret - voicing.baseFret + 1
              if (relativeFret < 1 || relativeFret > numFrets) return null

              const x = startX + i * stringSpacing
              const y = startY + (relativeFret - 0.5) * fretSpacing
              const finger = voicing.fingers?.[i] || 0

              return (
                <g key={`dot-${i}`}>
                  <circle cx={x} cy={y} r="8.5" fill="var(--custom-stage-chord)" />
                  {finger > 0 && (
                    <text
                      x={x}
                      y={y + 4}
                      fill="var(--custom-stage-bg)"
                      fontSize="11"
                      fontWeight="bold"
                      fontFamily="sans-serif"
                      textAnchor="middle"
                    >
                      {finger}
                    </text>
                  )}
                </g>
              )
            })}

            {/* Bottom String Labels: E A D G B e */}
            {stringNames.map((name, i) => {
              const x = startX + i * stringSpacing
              return (
                <text
                  key={`name-${i}`}
                  x={x}
                  y={endY + 18}
                  fill="var(--custom-uiMutedText)"
                  fontSize="11"
                  fontWeight="bold"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {name}
                </text>
              )
            })}
          </svg>
        </div>

        {/* Footer info */}
        <p className="text-[11px] text-center text-app-muted mt-3">
          Click outside or press <span className="font-mono text-app-action">ESC</span> to dismiss
        </p>
      </div>
    </div>
  )
}
