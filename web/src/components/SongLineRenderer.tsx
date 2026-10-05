import React from 'react'
import type { SongLine, ChordSegment } from '../types/gtar'
import { CHORD_TOKEN_REGEX, parseChordProLine } from '../utils/songParser'
import { chordLyricWords, twoLineSegments } from '../utils/chordLyricLayout'
import {
  chordTokenToNashville,
  isValidMusicalKey,
  type StageNotationMode,
} from '../utils/nashvilleNotation'

export type StageChordScale = 1.0 | 1.1 | 1.2 | 1.3
export type StageFontWeight = 'regular' | 'medium' | 'bold'
export type StageLineSpacing = 'compact' | 'normal' | 'relaxed'

export interface SongLineRendererProps {
  lines: SongLine[]
  fontSizePx: number
  fontFamily?: 'mono' | 'sans' | 'serif'
  onChordClick?: (chord: string) => void
  chordScale?: number
  fontWeight?: StageFontWeight
  lineSpacing?: StageLineSpacing
  notation?: StageNotationMode
  referenceKey?: string | null
}

interface LineSpacingConfig {
  lineHeightMultiplier: number
  chordRowPt: string
  chordRowPb: string
  lyricRowPt: string
  lyricRowPb: string
  emptySpacerHeight: string
  sectionHeaderPt: string
  sectionHeaderPb: string
  chordProPadding: string
  chordProMb: string
}

const SPACING_CONFIGS: Record<StageLineSpacing, LineSpacingConfig> = {
  compact: {
    lineHeightMultiplier: 1.2,
    chordRowPt: '2px',
    chordRowPb: '0px',
    lyricRowPt: '0px',
    lyricRowPb: '3px',
    emptySpacerHeight: '14px',
    sectionHeaderPt: '10px',
    sectionHeaderPb: '4px',
    chordProPadding: '2px 0 3px',
    chordProMb: 'mb-0.5',
  },
  normal: {
    lineHeightMultiplier: 1.35,
    chordRowPt: '4px',
    chordRowPb: '1px',
    lyricRowPt: '1px',
    lyricRowPb: '5px',
    emptySpacerHeight: '20px',
    sectionHeaderPt: '14px',
    sectionHeaderPb: '8px',
    chordProPadding: '4px 0 5px',
    chordProMb: 'mb-1',
  },
  relaxed: {
    lineHeightMultiplier: 1.6,
    chordRowPt: '7px',
    chordRowPb: '3px',
    lyricRowPt: '3px',
    lyricRowPb: '9px',
    emptySpacerHeight: '28px',
    sectionHeaderPt: '20px',
    sectionHeaderPb: '12px',
    chordProPadding: '8px 0 10px',
    chordProMb: 'mb-1.5',
  },
}

const FONT_WEIGHT_CONFIGS: Record<StageFontWeight, { lyricClass: string; chordClass: string }> = {
  regular: {
    lyricClass: 'font-normal',
    chordClass: 'font-bold',
  },
  medium: {
    lyricClass: 'font-medium',
    chordClass: 'font-bold',
  },
  bold: {
    lyricClass: 'font-semibold',
    chordClass: 'font-black',
  },
}

/**
 * Splits a chord line text (preserving whitespace) so chord tokens are individually clickable,
 * matching Android detectTapGestures + extractChordAtOffset.
 * When notation === 'numbers', tokens are converted to relative scale degrees (Nashville Number System)
 * and interactions (clicks, chord diagrams) are suppressed.
 */
function renderInteractiveChordLine(
  text: string,
  onChordClick?: (chord: string) => void,
  chordScale: number = 1.0,
  isHighContrast: boolean = false,
  notation: StageNotationMode = 'chords',
  referenceKey?: string | null
): React.ReactNode[] {
  const elements: React.ReactNode[] = []
  let i = 0
  let pendingSpacingCompensation = 0
  const isNumbersMode = notation === 'numbers' && isValidMusicalKey(referenceKey)

  while (i < text.length) {
    if (text[i] === ' ' || text[i] === '\t') {
      let spaceStr = ''
      while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
        spaceStr += text[i]
        i++
      }

      if (pendingSpacingCompensation > 0) {
        spaceStr += ' '.repeat(pendingSpacingCompensation)
        pendingSpacingCompensation = 0
      } else if (pendingSpacingCompensation < 0) {
        const canAbsorb = Math.min(-pendingSpacingCompensation, Math.max(0, spaceStr.length - 1))
        spaceStr = spaceStr.slice(canAbsorb)
        pendingSpacingCompensation += canAbsorb
      }

      elements.push(<span key={`sp-${i}`}>{spaceStr}</span>)
    } else {
      const start = i
      while (i < text.length && text[i] !== ' ' && text[i] !== '\t') {
        i++
      }
      const rawToken = text.substring(start, i)

      // Handle hyphenated compound chords like "<C#m>-<B>" or "C#m-B"
      if (rawToken.includes('-') || rawToken.includes('–') || rawToken.includes('—')) {
        const subParts = rawToken.split(/([–—-]|--)/)
        for (let sIdx = 0; sIdx < subParts.length; sIdx++) {
          const sub = subParts[sIdx]
          if (sub === '-' || sub === '–' || sub === '—' || sub === '--') {
            elements.push(<span key={`sep-${start}-${sIdx}`}>{sub}</span>)
            continue
          }
          const cleanSub = sub.replace(/^[[<({|,--:;~]+|[\]>)}|,--:;~]+$/g, '').trim()
          if (cleanSub && CHORD_TOKEN_REGEX.test(cleanSub)) {
            const displayToken = isNumbersMode ? chordTokenToNashville(cleanSub, referenceKey!) : cleanSub
            if (isNumbersMode) {
              pendingSpacingCompensation += (cleanSub.length - displayToken.length)
            }
            elements.push(
              <span
                key={`chord-${start}-${sIdx}`}
                onClick={isNumbersMode ? undefined : () => onChordClick?.(cleanSub)}
                className={`stage-chord-token ${isNumbersMode ? 'stage-number-token cursor-default' : 'cursor-pointer'} select-none`}
                style={{
                  ...(chordScale !== 1.0
                    ? {
                        display: 'inline-block',
                        transform: `scale(${chordScale})`,
                        transformOrigin: 'left bottom',
                        verticalAlign: 'baseline',
                      }
                    : undefined),
                  ...(isHighContrast ? { textShadow: '0 1px 2px rgba(0,0,0,0.8)' } : undefined),
                }}
                title={isNumbersMode ? undefined : `View ${cleanSub} fretboard diagram`}
              >
                {displayToken}
              </span>
            )
          } else {
            elements.push(<span key={`tok-${start}-${sIdx}`}>{sub}</span>)
          }
        }
      } else {
        const cleanToken = rawToken.replace(/^[[<({|,--:;~]+|[\]>)}|,--:;~]+$/g, '').trim()
        if (cleanToken && CHORD_TOKEN_REGEX.test(cleanToken)) {
          const displayToken = isNumbersMode ? chordTokenToNashville(cleanToken, referenceKey!) : cleanToken
          if (isNumbersMode) {
            pendingSpacingCompensation += (cleanToken.length - displayToken.length)
          }
          elements.push(
            <span
              key={`chord-${start}`}
              onClick={isNumbersMode ? undefined : () => onChordClick?.(cleanToken)}
              className={`stage-chord-token ${isNumbersMode ? 'stage-number-token cursor-default' : 'cursor-pointer'} select-none`}
              style={{
                ...(chordScale !== 1.0
                  ? {
                      display: 'inline-block',
                      transform: `scale(${chordScale})`,
                      transformOrigin: 'left bottom',
                      verticalAlign: 'baseline',
                    }
                  : undefined),
                ...(isHighContrast ? { textShadow: '0 1px 2px rgba(0,0,0,0.8)' } : undefined),
              }}
              title={isNumbersMode ? undefined : `View ${cleanToken} fretboard diagram`}
            >
              {displayToken}
            </span>
          )
        } else {
          elements.push(<span key={`tok-${start}`}>{rawToken}</span>)
        }
      }
    }
  }

  if (pendingSpacingCompensation > 0) {
    elements.push(<span key={`sp-end`}>{' '.repeat(pendingSpacingCompensation)}</span>)
  }

  return elements
}

/**
 * 1:1 Jetpack Compose RenderSongLine translation from Android SongViewerScreen.kt:
 * - EmptyLine: customizable spacer height
 * - SectionHeader: muted-accent block with explicit line height and padding
 * - ChordLine: Bold in #B58900, with independent scaling & weights
 * - LyricLine: In #EEE8D5, with selectable font weight
 * - TabLine: Monospace in #35B8AD
 * - Standalone Progression: Clean floating chord labels with comfortable spacing
 */
export const SongLineRenderer: React.FC<SongLineRendererProps> = ({
  lines,
  fontSizePx,
  fontFamily = 'mono',
  onChordClick,
  chordScale = 1.0,
  fontWeight = 'regular',
  lineSpacing = 'normal',
  notation = 'chords',
  referenceKey,
}) => {
  const fontClass =
    fontFamily === 'serif'
      ? 'stage-serif'
      : fontFamily === 'sans'
      ? 'stage-sans'
      : 'stage-mono'

  const spacing = SPACING_CONFIGS[lineSpacing] || SPACING_CONFIGS.normal
  const weightConfig = FONT_WEIGHT_CONFIGS[fontWeight] || FONT_WEIGHT_CONFIGS.regular
  const isHighContrast = chordScale >= 1.2 && fontWeight === 'bold'

  const renderAnchored = (segments: ChordSegment[], key: number) => (
    <div key={key} className={`${fontClass} stage-anchored-line select-text`}
      style={{ fontSize: fontSizePx, padding: spacing.chordProPadding, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {chordLyricWords(segments).map((word, wordIndex) => (
        <span key={wordIndex} className="stage-anchored-word" style={{ display: 'inline-flex', maxWidth: '100%', minWidth: 0 }}>
          {word.map((segment, segmentIndex) => (
            <span key={segmentIndex} className="stage-anchor" data-chord={segment.chord}
              style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 0, maxWidth: '100%' }}>
              <span className={`stage-chord-text stage-mono ${weightConfig.chordClass} select-none`}
                style={{ fontSize: `${chordScale * 0.9}em`, lineHeight: 1.2, minHeight: '1.2em', whiteSpace: 'pre',
                  paddingRight: segment.chord ? '0.35em' : undefined, color: '#B58900' }}>
                {segment.chord ? renderInteractiveChordLine(segment.chord, onChordClick, 1, isHighContrast, notation, referenceKey) : '\u00a0'}
              </span>
              <span className={`stage-lyric-text ${weightConfig.lyricClass}`}
                style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: spacing.lineHeightMultiplier, color: '#EEE8D5' }}>
                {segment.text || '\u00a0'}
              </span>
            </span>
          ))}
        </span>
      ))}
    </div>
  )

  return (
    <div
      style={{ fontSize: `${fontSizePx}px` }}
      className="select-text"
    >
      {lines.map((line, idx) => {
        const previous = lines[idx - 1]
        if (line.type === 'LYRIC' && previous?.type === 'CHORD_ROW' && previous.isOverLyric) return null
        switch (line.type) {
          case 'EMPTY':
            return <div key={idx} style={{ height: spacing.emptySpacerHeight }} />

          case 'SECTION_HEADER':
            return (
              <div key={idx} role="heading" aria-level={3}
                data-stage-section="true"
                data-section-title={line.title}
                data-section-index={idx}
                className={`${fontClass} stage-section-header select-none`}
                style={{
                  fontSize: `${fontSizePx}px`, lineHeight: `${fontSizePx * spacing.lineHeightMultiplier}px`,
                  paddingTop: spacing.sectionHeaderPt, paddingBottom: spacing.sectionHeaderPb, margin: 0,
                  color: '#A78BFA', fontWeight: 600, letterSpacing: '0.04em',
                  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', breakAfter: 'avoid',
                  overflowAnchor: 'none',
                }}>
                [{line.title}]
              </div>
            )

          case 'CHORD_ROW':
            if (line.isOverLyric && lines[idx + 1]?.type === 'LYRIC') {
              return renderAnchored(twoLineSegments(line.raw, (lines[idx + 1] as { lyrics: string }).lyrics), idx)
            }
            return (
              <div
                key={idx}
                style={{
                  paddingTop: spacing.chordRowPt,
                  paddingBottom: spacing.chordRowPb,
                  fontSize: `${fontSizePx}px`,
                  lineHeight: `${fontSizePx * spacing.lineHeightMultiplier}px`,
                  letterSpacing: '0.8px',
                  color: '#B58900',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  wordBreak: 'break-word',
                }}
                className={`stage-mono stage-chord-text ${weightConfig.chordClass} whitespace-pre-wrap select-text`}
              >
                {renderInteractiveChordLine(line.raw, onChordClick, chordScale, isHighContrast, notation, referenceKey)}
              </div>
            )

          case 'LYRIC': {
            if (/\[[A-G][b#]?[^\]]*\]|<[A-G][b#]?[^>]*>/.test(line.lyrics)) {
              return renderAnchored(parseChordProLine(line.lyrics), idx)
            }

            return (
              <div
                key={idx}
                style={{
                  paddingTop: spacing.lyricRowPt,
                  paddingBottom: spacing.lyricRowPb,
                  fontSize: `${fontSizePx}px`,
                  lineHeight: `${fontSizePx * spacing.lineHeightMultiplier}px`,
                  letterSpacing: '0.8px',
                  color: '#EEE8D5',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  wordBreak: 'break-word',
                }}
                className={`${fontClass} stage-lyric-text ${weightConfig.lyricClass} whitespace-pre-wrap select-text`}
              >
                {line.lyrics}
              </div>
            )
          }

          case 'TAB':
            {
              const tabFontSize = Math.max(11, fontSizePx - 1)
              return (
                <div
                  key={idx}
                  style={{
                    paddingTop: '1.5px',
                    paddingBottom: '1.5px',
                    fontSize: `${tabFontSize}px`,
                    lineHeight: `${tabFontSize * 1.25}px`,
                    letterSpacing: '0.8px',
                    color: '#35B8AD',
                  }}
                  className="stage-mono stage-tab-text font-normal whitespace-pre overflow-x-auto select-text"
                >
                  {line.content}
                </div>
              )
            }

          case 'CHORD_PRO':
            return renderAnchored(line.segments, idx)

          default:
            return null
        }
      })}
    </div>
  )
}
