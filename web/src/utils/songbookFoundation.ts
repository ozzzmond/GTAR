import { generateUUID, isValidUUID } from './uuid'
import type { ActiveSongState, SongEntity, WebSetlist } from '../types/gtar'
import { resolveSetlistSong, bindLegacySetlists } from './setlistSongs'
import { transposeKey, CHORD_TOKEN_REGEX } from './chordTransposer'
import { extractChordTokensFromLine, isChordLine, isSectionHeader, isTabChartLine } from './songParser'
import { getTrustworthySongKey, isValidMusicalKey } from './nashvilleNotation'

const CHROMATIC_NOTE_MAP: Record<string, number> = {
  'B#': 0, 'C': 0,
  'C#': 1, 'Db': 1,
  'D': 2,
  'D#': 3, 'Eb': 3,
  'E': 4, 'Fb': 4,
  'E#': 5, 'F': 5,
  'F#': 6, 'Gb': 6,
  'G': 7,
  'G#': 8, 'Ab': 8,
  'A': 9,
  'A#': 10, 'Bb': 10,
  'B': 11, 'Cb': 11,
}

// ---------------------------------------------------------------------------
// 1. DETERMINISTIC LEGACY LOCAL ID MIGRATION
// ---------------------------------------------------------------------------

export interface NormalizationResult {
  songs: ActiveSongState[]
  setlists: WebSetlist[]
  migrated: boolean
  remappedCount: number
  idMap: Map<string, string>
}

/**
 * Normalizes an offline library's song IDs to immutable string UUIDs (RFC4122 v4).
 * Rebinds all setlist references to the new canonical song IDs.
 *
 * Invariants:
 * - If a song already has a valid string UUID, its ID is preserved without modification.
 * - If a song has a numeric ID, Date.now() style ID, undefined, null, or non-UUID string,
 *   it receives a new canonical string UUID.
 * - Setlists preserve existing valid stable IDs. If a setlist lacks an ID, a UUID is assigned.
 * - Rebinds every setlist reference to the canonical song UUID.
 * - Preserves song content, title, artist, key, transposeOffset, and all metadata.
 * - Preserves setlist membership, order, and position.
 * - Idempotent: repeated calls on already normalized data produce identical output with migrated=false.
 * - Never duplicates library items and never drops data.
 */
export function normalizeSongbookIds(
  songs: ActiveSongState[],
  setlists: WebSetlist[] = []
): NormalizationResult {
  const idMap = new Map<string, string>()
  let migrated = false
  let remappedCount = 0

  // Phase 1: Normalize song IDs
  const normalizedSongs: ActiveSongState[] = songs.map((song) => {
    if (isValidUUID(song.id)) {
      return { ...song }
    }

    const newId = generateUUID()
    if (song.id !== undefined && song.id !== null) {
      idMap.set(String(song.id), newId)
    }
    migrated = true
    remappedCount++
    return { ...song, id: newId }
  })

  // Phase 2: Normalize setlist IDs and rebind song references
  const normalizedSetlists: WebSetlist[] = setlists.map((setlist) => {
    let setlistId = setlist.id
    if (typeof setlistId === 'string' && setlistId.trim().length > 0) {
      // Preserve valid existing UUID or non-empty string ID
      setlistId = setlistId.trim()
    } else {
      setlistId = generateUUID()
      migrated = true
    }

    const updatedRefs = setlist.songs.map((ref) => {
      // Direct ID remap
      if (ref.id !== undefined && idMap.has(String(ref.id))) {
        const newRefId = idMap.get(String(ref.id))!
        migrated = true
        return { ...ref, id: newRefId }
      }

      // If ref already points to a valid UUID among normalized songs, keep it
      if (ref.id !== undefined && isValidUUID(ref.id)) {
        const target = normalizedSongs.find((s) => s.id === ref.id)
        if (target) {
          return { ...ref, id: target.id, title: target.title, artist: target.artist }
        }
      }

      // Fallback: match by title and artist if ref.id was undefined or unmatched
      const resolved = resolveSetlistSong(ref, normalizedSongs)
      if (resolved && resolved.id) {
        if (ref.id !== resolved.id) {
          migrated = true
        }
        return { ...ref, id: resolved.id, title: resolved.title, artist: resolved.artist }
      }

      return { ...ref }
    })

    return {
      ...setlist,
      id: setlistId,
      songs: updatedRefs,
      ...(setlist.isDeleted !== undefined ? { isDeleted: Boolean(setlist.isDeleted) } : {}),
    }
  })

  // Phase 3: Final pass with bindLegacySetlists to ensure title/artist synchronization
  const finalSetlists = bindLegacySetlists(normalizedSetlists, normalizedSongs)

  return {
    songs: normalizedSongs,
    setlists: finalSetlists,
    migrated,
    remappedCount,
    idMap,
  }
}

// ---------------------------------------------------------------------------
// 2. REFERENTIAL INTEGRITY VALIDATION
// ---------------------------------------------------------------------------

export interface DanglingReferenceIssue {
  setlistId: string | number
  setlistName: string
  songRef: { id?: string | number; title: string; artist?: string }
  reason: 'missing_song' | 'unresolved_reference'
}

export interface ReferentialIntegrityReport {
  isValid: boolean
  errors: string[]
  danglingReferences: DanglingReferenceIssue[]
  duplicateSongIds: string[]
  duplicateSetlistIds: string[]
  nonStringSongIds: Array<{ id: unknown; title: string }>
  invalidSongUuids: Array<{ id: unknown; title: string }>
}

/**
 * Validates song and setlist relationships without mutating user data.
 * Pure and read-only.
 */
export function validateSongbookIntegrity(
  songs: (SongEntity | ActiveSongState)[],
  setlists: WebSetlist[] = []
): ReferentialIntegrityReport {
  const errors: string[] = []
  const duplicateSongIds: string[] = []
  const duplicateSetlistIds: string[] = []
  const nonStringSongIds: Array<{ id: unknown; title: string }> = []
  const invalidSongUuids: Array<{ id: unknown; title: string }> = []
  const danglingReferences: DanglingReferenceIssue[] = []

  // Check Song IDs
  const seenSongIds = new Set<string>()
  for (const song of songs) {
    if (song.id === undefined || song.id === null) {
      errors.push(`Song "${song.title}" is missing an ID`)
      invalidSongUuids.push({ id: song.id, title: song.title })
      continue
    }

    if (typeof song.id !== 'string') {
      nonStringSongIds.push({ id: song.id, title: song.title })
      errors.push(`Song "${song.title}" has non-string ID: ${String(song.id)}`)
    }

    if (!isValidUUID(song.id)) {
      invalidSongUuids.push({ id: song.id, title: song.title })
      errors.push(`Song "${song.title}" has invalid UUID: ${String(song.id)}`)
    }

    const idKey = String(song.id)
    if (seenSongIds.has(idKey)) {
      duplicateSongIds.push(idKey)
      errors.push(`Duplicate canonical song ID found: ${idKey}`)
    }
    seenSongIds.add(idKey)
  }

  // Check Setlist IDs
  const seenSetlistIds = new Set<string>()
  for (const sl of setlists) {
    if (sl.id === undefined || sl.id === null || String(sl.id).trim() === '') {
      errors.push(`Setlist "${sl.name}" is missing an ID`)
      continue
    }
    const slKey = String(sl.id)
    if (seenSetlistIds.has(slKey)) {
      duplicateSetlistIds.push(slKey)
      errors.push(`Duplicate setlist ID found: ${slKey}`)
    }
    seenSetlistIds.add(slKey)

    // Check Setlist References
    for (const ref of sl.songs) {
      let resolved = false
      if (ref.id !== undefined && ref.id !== null) {
        const refIdStr = String(ref.id)
        if (seenSongIds.has(refIdStr)) {
          resolved = true
        }
      }

      if (!resolved) {
        // Fallback check by title + artist
        const matched = songs.find(
          (s) =>
            s.title.trim().toLowerCase() === ref.title.trim().toLowerCase() &&
            (!ref.artist?.trim() || (s.artist || '').trim().toLowerCase() === ref.artist.trim().toLowerCase())
        )
        if (matched) {
          resolved = true
        }
      }

      if (!resolved) {
        danglingReferences.push({
          setlistId: sl.id,
          setlistName: sl.name,
          songRef: ref,
          reason: 'missing_song',
        })
        errors.push(
          `Dangling reference in setlist "${sl.name}": song "${ref.title}" (id: ${ref.id ?? 'none'}) does not exist in library`
        )
      }
    }
  }

  const isValid =
    errors.length === 0 &&
    duplicateSongIds.length === 0 &&
    duplicateSetlistIds.length === 0 &&
    nonStringSongIds.length === 0 &&
    invalidSongUuids.length === 0 &&
    danglingReferences.length === 0

  return {
    isValid,
    errors,
    danglingReferences,
    duplicateSongIds,
    duplicateSetlistIds,
    nonStringSongIds,
    invalidSongUuids,
  }
}

// ---------------------------------------------------------------------------
// 3. READ-ONLY TRANSPOSE COPY INSPECTION
// ---------------------------------------------------------------------------

export interface TransposeDuplicateCandidate {
  originalSongId: string | number
  candidateSongId: string | number
  originalTitle: string
  candidateTitle: string
  semitoneDelta: number
  chordCount: number
  evidence: string
  confidence: 'high' | 'probable'
}

export interface TransposeInspectionReport {
  candidates: TransposeDuplicateCandidate[]
  inspectedSongCount: number
}

/**
 * Normalizes title for transpose-copy matching by stripping key annotations,
 * parenthesized keys, capo annotations, and trailing copy numbers.
 */
export function normalizeTitleForTransposeComparison(title: string): string {
  let cleaned = title.trim().toLowerCase()
  // Remove suffixes like (Key of G), (Key G), (in G), (G), [G], - Key of G, - G
  cleaned = cleaned.replace(/\s*[([]\s*(?:key\s+(?:of\s+)?)?[a-g][#b]?(?:m|maj|min)?\s*[)\]]/gi, '')
  cleaned = cleaned.replace(/\s*-\s*(?:key\s+(?:of\s+)?)?[a-g][#b]?(?:m|maj|min)?\s*$/gi, '')
  // Remove capo annotations: (Capo 2), - Capo 2
  cleaned = cleaned.replace(/\s*[([]\s*capo\s+[0-9]+\s*[)\]]/gi, '')
  cleaned = cleaned.replace(/\s*-\s*capo\s+[0-9]+\s*$/gi, '')
  // Remove trailing copy numbers: - 2, (2)
  cleaned = cleaned.replace(/\s*[([]\s*[0-9]+\s*[)\]]/g, '')
  cleaned = cleaned.replace(/\s*-\s*[0-9]+\s*$/g, '')
  // Collapse whitespace and punctuation
  return cleaned.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Extracts lyrics only from chord sheet content, stripping chords, directives,
 * and section markers.
 */
export function extractNormalizedLyrics(rawContent: string): string {
  if (!rawContent) return ''
  const lines = rawContent.split(/\r?\n/)
  const lyricLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Skip directives {title:...}, {key:...}
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) continue
    // Skip section headers [Verse 1], Chorus:
    if (isSectionHeader(trimmed)) continue
    // Skip tabs
    if (isTabChartLine(trimmed)) continue
    // Skip pure chord lines
    if (isChordLine(trimmed)) continue

    // Strip bracketed chords [G], [F#m], <C>
    const withoutChords = trimmed
      .replace(/\[[A-Ga-g][#b]?[^\]]*\]/g, '')
      .replace(/<[A-Ga-g][#b]?[^>]*>/g, '')
      .trim()

    if (withoutChords) {
      lyricLines.push(withoutChords.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim())
    }
  }

  return lyricLines.filter(Boolean).join(' ')
}

/**
 * Extracts all chord tokens sequentially from a chord sheet.
 */
export function extractSequentialChordTokens(rawContent: string): string[] {
  if (!rawContent) return []
  const lines = rawContent.split(/\r?\n/)
  const allChords: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || (trimmed.startsWith('{') && trimmed.endsWith('}')) || isTabChartLine(trimmed)) {
      continue
    }

    // Bracketed chords in ChordPro
    const bracketRegex = /\[([A-G][b#]?[^\]]*)\]|<([A-G][b#]?[^>]*)>/g
    let match: RegExpExecArray | null
    let foundBracket = false

    while ((match = bracketRegex.exec(line)) !== null) {
      const candidate = (match[1] || match[2] || '').trim()
      if (CHORD_TOKEN_REGEX.test(candidate)) {
        allChords.push(candidate)
        foundBracket = true
      }
    }

    if (foundBracket) continue

    // Unbracketed chord lines in 2-line sheets
    if (isChordLine(line)) {
      const tokens = extractChordTokensFromLine(line)
      for (const t of tokens) {
        if (CHORD_TOKEN_REGEX.test(t)) {
          allChords.push(t)
        }
      }
    }
  }

  return allChords
}

/**
 * Parses a chord token into root pitch class (0..11) and quality string.
 */
function parseChordTokenRootAndQuality(chord: string): { rootPitch: number; quality: string; bassPitch?: number } | null {
  if (!chord || !CHORD_TOKEN_REGEX.test(chord)) return null
  const rootMatch = /^([A-Ga-g][#b]?)(.*)$/.exec(chord)
  if (!rootMatch) return null

  const root = rootMatch[1][0].toUpperCase() + rootMatch[1].slice(1)
  if (!(root in CHROMATIC_NOTE_MAP)) return null
  const rootPitch = CHROMATIC_NOTE_MAP[root]

  const remainder = rootMatch[2]
  const slashMatch = /\/([A-Ga-g][#b]?)(min|m)?$/.exec(remainder)
  let bassPitch: number | undefined
  let quality = remainder

  if (slashMatch) {
    quality = remainder.slice(0, slashMatch.index)
    const bass = slashMatch[1][0].toUpperCase() + slashMatch[1].slice(1)
    if (bass in CHROMATIC_NOTE_MAP) {
      bassPitch = CHROMATIC_NOTE_MAP[bass]
    }
  }

  return { rootPitch, quality, bassPitch }
}

/**
 * Read-only inspection utility identifying likely historical transpose-only song copies.
 *
 * Invariants:
 * - Conservative classification: only flags when normalized titles match, lyrics are identical,
 *   and EVERY chord token has an identical, uniform semitone transposition delta.
 * - Genuine alternate arrangements (differing lyrics, reharmonization, different verses)
 *   are NEVER classified as confirmed transpose copies.
 * - Read-only: does NOT mutate, merge, delete, or rewrite any song record.
 */
export function inspectTransposeDuplicates(
  songs: (SongEntity | ActiveSongState)[]
): TransposeInspectionReport {
  const candidates: TransposeDuplicateCandidate[] = []

  // Compare every pair of songs (i < j)
  for (let i = 0; i < songs.length; i++) {
    const songA = songs[i]
    const titleA = normalizeTitleForTransposeComparison(songA.title)
    if (!titleA) continue

    const lyricsA = extractNormalizedLyrics(songA.rawContent)
    const chordsA = extractSequentialChordTokens(songA.rawContent)

    for (let j = i + 1; j < songs.length; j++) {
      const songB = songs[j]
      const titleB = normalizeTitleForTransposeComparison(songB.title)
      if (!titleB) continue

      // Require normalized base titles to match
      if (titleA !== titleB) continue

      // Require same artist if both have artists specified
      const artistA = (songA.artist || '').trim().toLowerCase()
      const artistB = (songB.artist || '').trim().toLowerCase()
      if (artistA && artistB && artistA !== artistB) continue

      // Check lyrics: if either has lyrics, lyrics must match
      const lyricsB = extractNormalizedLyrics(songB.rawContent)
      if (lyricsA && lyricsB && lyricsA !== lyricsB) {
        // Differing lyrics indicate an alternate arrangement, cut verse, or different song!
        continue
      }

      // Check chords: must have at least 2 chords to verify uniform transposition
      const chordsB = extractSequentialChordTokens(songB.rawContent)
      if (chordsA.length < 2 || chordsB.length < 2) continue
      if (chordsA.length !== chordsB.length) continue

      // Verify uniform semitone delta across all chord tokens
      let uniformDelta: number | null = null
      let isUniform = true

      for (let k = 0; k < chordsA.length; k++) {
        const parsedA = parseChordTokenRootAndQuality(chordsA[k])
        const parsedB = parseChordTokenRootAndQuality(chordsB[k])

        if (!parsedA || !parsedB) {
          isUniform = false
          break
        }

        // Quality must match (e.g. minor, 7, maj7)
        if (parsedA.quality !== parsedB.quality) {
          isUniform = false
          break
        }

        const delta = ((parsedB.rootPitch - parsedA.rootPitch) % 12 + 12) % 12

        // If slash bass exists, bass delta must also match
        if (parsedA.bassPitch !== undefined || parsedB.bassPitch !== undefined) {
          if (parsedA.bassPitch === undefined || parsedB.bassPitch === undefined) {
            isUniform = false
            break
          }
          const bassDelta = ((parsedB.bassPitch - parsedA.bassPitch) % 12 + 12) % 12
          if (bassDelta !== delta) {
            isUniform = false
            break
          }
        }

        if (uniformDelta === null) {
          uniformDelta = delta
        } else if (uniformDelta !== delta) {
          isUniform = false
          break
        }
      }

      // If chords are identical (delta === 0), it's a clone rather than a transpose copy.
      // If uniform delta is 1..11, it's a confirmed transpose copy!
      if (isUniform && uniformDelta !== null && uniformDelta !== 0) {
        const semitoneShift = uniformDelta > 6 ? uniformDelta - 12 : uniformDelta
        const shiftSign = semitoneShift > 0 ? `+${semitoneShift}` : `${semitoneShift}`
        candidates.push({
          originalSongId: songA.id ?? i,
          candidateSongId: songB.id ?? j,
          originalTitle: songA.title,
          candidateTitle: songB.title,
          semitoneDelta: semitoneShift,
          chordCount: chordsA.length,
          evidence: `Matching base title "${titleA}", identical lyrics, and uniform ${shiftSign} semitone transposition across all ${chordsA.length} chords.`,
          confidence: 'high',
        })
      }
    }
  }

  return {
    candidates,
    inspectedSongCount: songs.length,
  }
}

// ---------------------------------------------------------------------------
// 4. CANONICAL REFERENCE KEY CONTRACT
// ---------------------------------------------------------------------------

/**
 * Returns the canonical reference key for a song.
 * Uses explicit or reliably parsed song key metadata/directives.
 * NEVER guesses reference key from chord progression.
 */
export function getCanonicalReferenceKey(song: { key?: string | null; rawContent?: string | null }): string {
  const trustworthy = getTrustworthySongKey(song.key, song.rawContent)
  if (trustworthy) return trustworthy
  if (song.key && isValidMusicalKey(song.key)) return song.key.trim()
  return 'C'
}

/**
 * Dynamically computes the runtime playback/display key.
 * Transpose offset remains runtime display state only and does NOT mutate canonical chords.
 */
export function computePlaybackKey(canonicalReferenceKey: string, transposeOffset: number): string {
  if (!transposeOffset || transposeOffset === 0) {
    return canonicalReferenceKey
  }
  return transposeKey(canonicalReferenceKey, transposeOffset)
}
