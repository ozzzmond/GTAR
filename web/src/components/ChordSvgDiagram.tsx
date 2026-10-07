import React from 'react'
import type { ChordVoicing } from '../utils/chordDictionary'

interface ChordSvgDiagramProps {
  voicing: ChordVoicing
  width?: number
  height?: number
  compact?: boolean
}

export const ChordSvgDiagram: React.FC<ChordSvgDiagramProps> = ({
  voicing,
  width = 170,
  height = 185,
  compact = false,
}) => {
  const numStrings = 6
  const numFrets = 5

  const startX = compact ? 28 : 34
  const endX = width - (compact ? 24 : 30)
  const startY = compact ? 36 : 42
  const endY = height - (compact ? 24 : 28)

  const stringSpacing = (endX - startX) / (numStrings - 1)
  const fretSpacing = (endY - startY) / numFrets
  const stringNames = ['E', 'A', 'D', 'G', 'B', 'e']

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="select-none overflow-visible">
      {/* Base Fret Indicator (if > 1) */}
      {voicing.baseFret > 1 && (
        <text
          x={startX - (compact ? 6 : 8)}
          y={startY + fretSpacing / 2 + 4}
          fill="var(--custom-stage-chord)"
          fontSize={compact ? '10' : '11'}
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
          strokeWidth={compact ? '3.5' : '4.5'}
          strokeLinecap="round"
        />
      ) : (
        <line
          x1={startX}
          y1={startY}
          x2={endX}
          y2={startY}
          stroke="var(--custom-card-border)"
          strokeWidth="1.5"
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
            strokeWidth="1"
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
            strokeWidth={i < 3 ? 1.2 : 0.8}
          />
        )
      })}

      {/* Top String Markers: Open (O) or Muted (X) */}
      {voicing.frets.map((fret, i) => {
        const x = startX + i * stringSpacing
        const y = startY - (compact ? 10 : 12)

        if (fret === -1) {
          return (
            <text
              key={`marker-${i}`}
              x={x}
              y={y + 3}
              fill="var(--custom-uiMutedText)"
              fontSize={compact ? '10' : '11'}
              fontWeight="bold"
              fontFamily="monospace"
              textAnchor="middle"
            >
              ✕
            </text>
          )
        }
        if (fret === 0) {
          return (
            <circle
              key={`marker-${i}`}
              cx={x}
              cy={y}
              r={compact ? '3.5' : '4'}
              fill="none"
              stroke="var(--custom-actionColor)"
              strokeWidth="1.5"
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
            strokeWidth={compact ? '10' : '12'}
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
        const dotRadius = compact ? 6.5 : 7.5

        return (
          <g key={`dot-${i}`}>
            <circle cx={x} cy={y} r={dotRadius} fill="var(--custom-stage-chord)" />
            {finger > 0 && (
              <text
                x={x}
                y={y + (compact ? 3.5 : 4)}
                fill="var(--custom-stage-bg)"
                fontSize={compact ? '9' : '10'}
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

      {/* Bottom String Labels */}
      {stringNames.map((name, i) => {
        const x = startX + i * stringSpacing
        return (
          <text
            key={`name-${i}`}
            x={x}
            y={endY + (compact ? 13 : 15)}
            fill="var(--custom-uiMutedText)"
            fontSize={compact ? '9' : '10'}
            fontWeight="bold"
            fontFamily="monospace"
            textAnchor="middle"
          >
            {name}
          </text>
        )
      })}
    </svg>
  )
}
