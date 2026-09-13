import React from 'react'
import type { SongLine } from '../types/gtar'
import { CHORD_TOKEN_REGEX, convertChordProToTwoLine } from '../utils/songParser'

export interface SongLineRendererProps {
  lines: SongLine[]
  fontSizePx: number
  fontFamily?: 'mono' | 'sans' | 'serif'
  onChordClick?: (chord: string) => void
}

/**
 * Splits a chord line text (preserving whitespace) so chord tokens are individually clickable,
 * matching Android detectTapGestures + extractChordAtOffset.
 */
function renderInteractiveChordLine(
  text: string,
  onChordClick?: (chord: string) => void
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
 * - EmptyLine: 20px spacer
 * - SectionHeader: muted-accent block with explicit line height and non-collapsing 14px/8px padding
 * - ChordLine: Bold in #B58900, letterSpacing 0.8px, paddingTop 4px, paddingBottom 1px
 * - LyricLine: Normal in #EEE8D5, letterSpacing 0.8px, paddingTop 1px, paddingBottom 5px
 * - TabLine: Monospace in #35B8AD, letterSpacing 0.8px, paddingVertical 1.5px
 * - Standalone Progression: Clean floating chord labels with comfortable spacing (no boxes/borders)
 */
export const SongLineRenderer: React.FC<SongLineRendererProps> = ({
  lines,
  fontSizePx,
  fontFamily = 'mono',
  onChordClick,
}) => {
  const fontClass =
    fontFamily === 'serif'
      ? 'stage-serif'
      : fontFamily === 'sans'
      ? 'stage-sans'
      : 'stage-mono'

  return (
    <div
      style={{ fontSize: `${fontSizePx}px` }}
      className="select-text"
    >
      {lines.map((line, idx) => {
        switch (line.type) {
          case 'EMPTY':
            // Spacer(modifier = Modifier.height(20.dp))
            return <div key={idx} style={{ height: '20px' }} />

          case 'SECTION_HEADER':
            return (
              <div key={idx} role="heading" aria-level={3}
                className={`${fontClass} stage-section-header select-none`}
                style={{
                  fontSize: `${fontSizePx}px`, lineHeight: `${fontSizePx * 1.35}px`,
                  paddingTop: '14px', paddingBottom: '8px', margin: 0,
                  color: '#A78BFA', fontWeight: 600, letterSpacing: '0.04em',
                  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', breakAfter: 'avoid',
                  overflowAnchor: 'none',
                }}>
                [{line.title}]
              </div>
            )

          case 'CHORD_ROW':
            // If 2-line chord row over lyrics: exact monospace character-column alignment matching Compose
            return (
              <div
                key={idx}
                style={{
                  paddingTop: '4px',
                  paddingBottom: '1px',
                  fontSize: `${fontSizePx}px`,
                  lineHeight: `${fontSizePx * 1.35}px`,
                  letterSpacing: '0.8px',
                  color: '#B58900',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  wordBreak: 'break-word',
                }}
                className={`stage-mono stage-chord-text font-bold whitespace-pre-wrap select-text`}
              >
                {renderInteractiveChordLine(line.raw, onChordClick)}
              </div>
            )

          case 'LYRIC': {
            // Defensive check: If lyric line contains bracketed chords (e.g. "When the [A]night" or "<C>"),
            // automatically split to stacked chord-over-lyric layout matching Android 1:1
            if (/\[[A-G][b#]?[^\]]*\]|<[A-G][b#]?[^>]*>/.test(line.lyrics)) {
              const [chordLine, lyricLine] = convertChordProToTwoLine(line.lyrics)
              return (
                <div key={idx} className="select-text">
                  {chordLine.trim() && (
                    <div
                      style={{
                        paddingTop: '4px',
                        paddingBottom: '1px',
                        fontSize: `${fontSizePx}px`,
                        lineHeight: `${fontSizePx * 1.35}px`,
                        letterSpacing: '0.8px',
                        color: '#B58900',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'break-word',
                        wordBreak: 'break-word',
                      }}
                      className={`stage-mono stage-chord-text font-bold whitespace-pre-wrap`}
                    >
                      {renderInteractiveChordLine(chordLine, onChordClick)}
                    </div>
                  )}
                  {lyricLine && (
                    <div
                      style={{
                        paddingTop: '1px',
                        paddingBottom: '5px',
                        fontSize: `${fontSizePx}px`,
                        lineHeight: `${fontSizePx * 1.35}px`,
                        letterSpacing: '0.8px',
                        color: '#EEE8D5',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'break-word',
                        wordBreak: 'break-word',
                      }}
                      className={`stage-mono stage-lyric-text font-normal whitespace-pre-wrap`}
                    >
                      {lyricLine}
                    </div>
                  )}
                </div>
              )
            }

            // Jetpack Compose LyricLine:
            // text = line.lyrics, textPrimary (#EEE8D5), letterSpacing = 0.8.sp, padding(top = 1.dp, bottom = 5.dp)
            return (
              <div
                key={idx}
                style={{
                  paddingTop: '1px',
                  paddingBottom: '5px',
                  fontSize: `${fontSizePx}px`,
                  lineHeight: `${fontSizePx * 1.35}px`,
                  letterSpacing: '0.8px',
                  color: '#EEE8D5',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  wordBreak: 'break-word',
                }}
                className={`stage-mono stage-lyric-text font-normal whitespace-pre-wrap select-text`}
              >
                {line.lyrics}
              </div>
            )
          }

          case 'TAB':
            // Jetpack Compose TabLine:
            // tabFontSize = (fontSizeSp - 1f).coerceAtLeast(11f), tabLineColor (#35B8AD), letterSpacing = 0.8.sp, padding(vertical = 1.5.dp)
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

          case 'CHORD_PRO': {
            return (
              <div key={idx} className={`${fontClass} select-text`} style={{ fontSize: fontSizePx, padding: '4px 0 5px' }}>
                {line.segments.map((segment, index) => (
                  <span key={index} className="inline-flex flex-col align-bottom" style={{ whiteSpace: 'pre-wrap', maxWidth: '100%', paddingRight: segment.chord && line.segments[index + 1]?.chord ? '1ch' : undefined }}>
                    <span className="text-amber-400 font-bold font-mono text-[0.85em] leading-none mb-1 select-none">
                      {segment.chord ? renderInteractiveChordLine(segment.chord, onChordClick) : '\u00a0'}
                    </span>
                    <span className="leading-normal stage-lyric-text">{segment.text || '\u00a0'}</span>
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
