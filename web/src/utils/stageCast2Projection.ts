import type { StageCastState } from './stageCast'
import { parseGtarSong } from './songParser'
import { CAST2_LIMITS, cast2Failure, validateReceiverSnapshot } from './stageCast2Protocol'
import type { ReceiverSnapshot, Result } from './stageCast2Protocol'

export interface ProjectionPosition {
  lineIndex: number
  scrollTop: number
  scrollFraction: number
  chordsVisible: boolean
}

/** Explicit allowlist from the active stage only. No persistence, theme, draft or library copying. */
export function projectCast2Presentation(state: StageCastState, position: ProjectionPosition): Result<ReceiverSnapshot> {
  if (!state || !state.song || typeof state.song.rawContent !== 'string' ||
    !Number.isSafeInteger(state.transposeOffset) || Math.abs(state.transposeOffset) > 11 ||
    typeof state.song.title !== 'string' || typeof state.effectiveKey !== 'string' ||
    typeof state.isTwoColumn !== 'boolean' || (state.notation !== undefined && state.notation !== 'chords' && state.notation !== 'numbers') ||
    !position || typeof position.chordsVisible !== 'boolean') return cast2Failure('INVALID_PRESENTATION_STATE')
  if (state.song.rawContent.length > CAST2_LIMITS.rawContent) return cast2Failure('OVERSIZED_PAYLOAD')
  const parsed = parseGtarSong(state.song.rawContent, state.transposeOffset)
  const lines = parsed.lines.map(line => {
    if (position.chordsVisible) return line
    switch (line.type) {
      case 'CHORD_PRO': return { type: 'LYRIC' as const, lyrics: line.segments.map(s => s.text).join('') }
      case 'CHORD_ROW': case 'TAB': return { type: 'EMPTY' as const }
      default: return line
    }
  })
  return validateReceiverSnapshot({
    songId: state.song.id ?? null,
    displayTitle: state.song.title || 'Untitled Song',
    lines,
    chordsVisible: position.chordsVisible,
    transpose: { offset: state.transposeOffset, effectiveKey: state.effectiveKey },
    position: { lineIndex: position.lineIndex },
    scroll: { top: position.scrollTop, fraction: position.scrollFraction },
    mode: { columns: state.isTwoColumn ? 2 : 1, notation: state.notation ?? 'chords' },
  })
}
