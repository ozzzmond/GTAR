import React from 'react'
import type { SongLine } from '../types/gtar'
import { CHORD_TOKEN_REGEX, convertChordProToTwoLine } from '../utils/songParser'

export type StageChordScale = 1.0 | 1.1 | 1.2 | 1.3
export type StageFontWeight = 'regular' | 'medium' | 'bold'
export type StageLineSpacing = 'compact' | 'normal' | 'relaxed'

/**
 * Safe upper bounds for stage font size based on viewport width.
 * Prevents extreme wrapping thrashing and layout oscillation on mobile screens.
 */
export function getMaxStageFontSize(viewportWidth?: number): number {
  const width =
    typeof viewportWidth === 'number'
      ? viewportWidth
      : typeof window !== 'undefined'
      ? window.innerWidth
      : 1024

  if (width < 640) {
    // Mobile viewport: clamp to 26px to prevent extreme wrapping thrashing
    return 26
  }
  if (width < 768) {
    // Small tablet / large phone landscape: clamp to 28px
    return 28
  }
  // Desktop & large tablet: up to 34px
  return 34
}

export interface SongLineRendererProps {
  lines: SongLine[]
  fontSizePx: number
  fontFamily?: 'mono' | 'sans' | 'serif'
  onChordClick?: (chord: string) => void
  chordScale?: number
  fontWeight?: StageFontWeight
  lineSpacing?: StageLineSpacing
  lineIndexOffset?: number
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
 */
function renderInteractiveChordLine(
  text: string,
  onChordClick?: (chord: string) => void,
  chordScale: number = 1.0,
  isHighContrast: boolean = false
): React.ReactNode[] {
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < text.length) {
    if (text[i] === ' ' || text[i] === '\t') {
      let spaceStr = ''
      while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
        spaceStr += text[i]
        i++
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
        const subParts = rawToken.split(/([-–—])/)
        for (let sIdx = 0; sIdx < subParts.length; sIdx++) {
          const sub = subParts[sIdx]
          if (sub === '-' || sub === '–' || sub === '—') {
            elements.push(<span key={`sep-${start}-${sIdx}`}>{sub}</span>)
            continue
          }
          const cleanSub = sub.replace(/^[[<({|,–—:;~]+|[\]>)}|,–—:;~]+$/g, '').trim()
          if (cleanSub && CHORD_TOKEN_REGEX.test(cleanSub)) {
            elements.push(
              <span
                key={`chord-${start}-${sIdx}`}
                onClick={() => onChordClick?.(cleanSub)}
                className="stage-chord-token cursor-pointer select-none"
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
                title={`View ${cleanSub} fretboard diagram`}
              >
                {cleanSub}
              </span>
            )
          } else {
            elements.push(<span key={`tok-${start}-${sIdx}`}>{sub}</span>)
          }
        }
      } else {
        const cleanToken = rawToken.replace(/^[[<({|,–—:;~]+|[\]>)}|,–—:;~]+$/g, '').trim()
        if (cleanToken && CHORD_TOKEN_REGEX.test(cleanToken)) {
          elements.push(
            <span
              key={`chord-${start}`}
              onClick={() => onChordClick?.(cleanToken)}
              className="stage-chord-token cursor-pointer select-none"
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
              title={`View ${cleanToken} fretboard diagram`}
            >
              {cleanToken}
            </span>
          )
        } else {
          elements.push(<span key={`tok-${start}`}>{rawToken}</span>)
        }
      }
    }
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
  lineIndexOffset = 0,
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

  return (
    <div
      style={{
        fontSize: `${fontSizePx}px`,
        contain: 'layout style',
        overflowAnchor: 'none',
      }}
      className="select-text"
    >
      {lines.map((line, idx) => {
        const lineIndex = lineIndexOffset + idx
        switch (line.type) {
          case 'EMPTY':
            return (
              <div
                key={idx}
                data-song-line={lineIndex}
                style={{ height: spacing.emptySpacerHeight, overflowAnchor: 'none' }}
              />
            )

          case 'SECTION_HEADER':
            return (
              <div
                key={idx}
                role="heading"
                aria-level={3}
                data-song-line={lineIndex}
                data-section={line.title}
                className={`${fontClass} stage-section-header select-none`}
                style={{
                  fontSize: `${fontSizePx}px`,
                  lineHeight: `${fontSizePx * spacing.lineHeightMultiplier}px`,
                  paddingTop: spacing.sectionHeaderPt,
                  paddingBottom: spacing.sectionHeaderPb,
                  margin: 0,
                  color: '#A78BFA',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  breakAfter: 'avoid',
                  overflowAnchor: 'none',
                }}
              >
                [{line.title}]
              </div>
            )

          case 'CHORD_ROW':
            return (
              <div
                key={idx}
                data-song-line={lineIndex}
                style={{
                  paddingTop: spacing.chordRowPt,
                  paddingBottom: spacing.chordRowPb,
                  fontSize: `${fontSizePx}px`,
                  lineHeight: `${fontSizePx * spacing.lineHeightMultiplier}px`,
                  letterSpacing: '0.8px',
                  color: '#B58900',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  overflowAnchor: 'none',
                }}
                className={`stage-mono stage-chord-text ${weightConfig.chordClass} whitespace-pre-wrap select-text`}
              >
                {renderInteractiveChordLine(line.raw, onChordClick, chordScale, isHighContrast)}
              </div>
            )

          case 'LYRIC': {
            if (/\[[A-G][b#]?[^\]]*\]|<[A-G][b#]?[^>]*>/.test(line.lyrics)) {
              const [chordLine, lyricLine] = convertChordProToTwoLine(line.lyrics)
              return (
                <div
                  key={idx}
                  data-song-line={lineIndex}
                  className="select-text"
                  style={{ overflowAnchor: 'none' }}
                >
                  {chordLine.trim() && (
                    <div
                      style={{
                        paddingTop: spacing.chordRowPt,
                        paddingBottom: spacing.chordRowPb,
                        fontSize: `${fontSizePx}px`,
                        lineHeight: `${fontSizePx * spacing.lineHeightMultiplier}px`,
                        letterSpacing: '0.8px',
                        color: '#B58900',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'break-word',
                        overflowAnchor: 'none',
                      }}
                      className={`stage-mono stage-chord-text ${weightConfig.chordClass} whitespace-pre-wrap`}
                    >
                      {renderInteractiveChordLine(chordLine, onChordClick, chordScale, isHighContrast)}
                    </div>
                  )}
                  {lyricLine && (
                    <div
                      style={{
                        paddingTop: spacing.lyricRowPt,
                        paddingBottom: spacing.lyricRowPb,
                        fontSize: `${fontSizePx}px`,
                        lineHeight: `${fontSizePx * spacing.lineHeightMultiplier}px`,
                        letterSpacing: '0.8px',
                        color: '#EEE8D5',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'break-word',
                        overflowAnchor: 'none',
                      }}
                      className={`${fontClass} stage-lyric-text ${weightConfig.lyricClass} whitespace-pre-wrap`}
                    >
                      {lyricLine}
                    </div>
                  )}
                </div>
              )
            }

            return (
              <div
                key={idx}
                data-song-line={lineIndex}
                style={{
                  paddingTop: spacing.lyricRowPt,
                  paddingBottom: spacing.lyricRowPb,
                  fontSize: `${fontSizePx}px`,
                  lineHeight: `${fontSizePx * spacing.lineHeightMultiplier}px`,
                  letterSpacing: '0.8px',
                  color: '#EEE8D5',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  overflowAnchor: 'none',
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
                  data-song-line={lineIndex}
                  style={{
                    paddingTop: '1.5px',
                    paddingBottom: '1.5px',
                    fontSize: `${tabFontSize}px`,
                    lineHeight: `${tabFontSize * 1.25}px`,
                    letterSpacing: '0.8px',
                    color: '#35B8AD',
                    overflowAnchor: 'none',
                  }}
                  className="stage-mono stage-tab-text font-normal whitespace-pre overflow-x-auto select-text"
                >
                  {line.content}
                </div>
              )
            }

          case 'CHORD_PRO': {
            return (
              <div
                key={idx}
                data-song-line={lineIndex}
                className={`${fontClass} select-text`}
                style={{
                  fontSize: fontSizePx,
                  padding: spacing.chordProPadding,
                  overflowAnchor: 'none',
                }}
              >
                {line.segments.map((segment, index) => (
                  <span
                    key={index}
                    className="inline-flex flex-col align-bottom"
                    style={{
                      whiteSpace: 'pre-wrap',
                      maxWidth: '100%',
                      overflowAnchor: 'none',
                      paddingRight: segment.chord && line.segments[index + 1]?.chord ? '1ch' : undefined,
                    }}
                  >
                    <span
                      className={`text-amber-400 ${weightConfig.chordClass} font-mono leading-none select-none ${spacing.chordProMb}`}
                      style={{
                        fontSize: `${chordScale * 0.9}em`,
                        lineHeight: 1.15,
                        minHeight: '1.15em',
                        display: 'inline-block',
                        overflowAnchor: 'none',
                        ...(isHighContrast ? { textShadow: '0 1px 2px rgba(0,0,0,0.8)' } : undefined),
                      }}
                    >
                      {segment.chord ? renderInteractiveChordLine(segment.chord, onChordClick, 1.0, isHighContrast) : '\u00a0'}
                    </span>
                    <span
                      className={`stage-lyric-text ${weightConfig.lyricClass}`}
                      style={{
                        lineHeight: spacing.lineHeightMultiplier,
                        overflowAnchor: 'none',
                      }}
                    >
                      {segment.text || '\u00a0'}
                    </span>
                  </span>
                ))}
              </div>
            )
          }

          default:
            return null
        }
      })}
    </div>
  )
}

