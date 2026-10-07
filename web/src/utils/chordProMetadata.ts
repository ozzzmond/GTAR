import { normalizeMusicalKey } from './musicalKey';

export interface CanonicalMetadata {
  title?: string;
  artist?: string;
  key?: string;
  originalKey?: string;
  tempo?: string | number;
  bpm?: string | number;
  time?: string;
  year?: string | number;
}

export interface DirectiveMatch {
  name: string;
  value: string;
  raw: string;
  lineIndex: number;
}

const CANONICAL_DIRECTIVES = ['title', 'artist', 'key', 'tempo', 'time', 'year'] as const;
type CanonicalDirectiveName = (typeof CANONICAL_DIRECTIVES)[number];

const DIRECTIVE_REGEX = /^\{([a-zA-Z_]+)(?::\s*(.*?))?\}$/;

export function parseChordProDirectives(content: string): {
  metadata: CanonicalMetadata;
  directives: DirectiveMatch[];
  legacyDirectives: Record<string, string>;
} {
  const lines = content.split(/\r?\n/);
  const metadata: CanonicalMetadata = {};
  const directives: DirectiveMatch[] = [];
  const legacyDirectives: Record<string, string> = {};

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const match = trimmed.match(DIRECTIVE_REGEX);
    if (!match) continue;

    const name = match[1].toLowerCase();
    const value = match[2] !== undefined ? match[2].trim() : '';

    directives.push({
      name,
      value,
      raw: lines[i],
      lineIndex: i,
    });

    if (name === 'title' || name === 't') {
      if (!metadata.title) metadata.title = value;
    } else if (name === 'artist') {
      metadata.artist = value;
    } else if (name === 'a' || name === 'subtitle' || name === 'st') {
      if (metadata.artist === undefined) metadata.artist = value;
    } else if (name === 'key') {
      if (!metadata.key) metadata.key = value;
    } else if (name === 'tempo' || name === 'bpm') {
      if (!metadata.tempo) {
        metadata.tempo = value;
        metadata.bpm = value;
      }
    } else if (name === 'time') {
      if (!metadata.time) metadata.time = value;
    } else if (name === 'year') {
      if (!metadata.year) metadata.year = value;
    } else if (name === 'original_key' || name === 'originalkey' || name === 'capo') {
      if (!legacyDirectives[name]) legacyDirectives[name] = value;
      if ((name === 'original_key' || name === 'originalkey') && !metadata.originalKey) {
        metadata.originalKey = value;
      }
    }
  }

  return { metadata, directives, legacyDirectives };
}

export function formatCanonicalTempo(tempo: string | number | undefined | null): string | undefined {
  if (tempo === undefined || tempo === null) return undefined;
  const str = String(tempo).trim();
  if (!str) return undefined;
  const num = parseInt(str, 10);
  if (isNaN(num) || num <= 0) return str;
  return `${num} BPM`;
}

export function syncCanonicalDirectives(
  currentContent: string,
  updates: CanonicalMetadata
): string {
  const isCrlf = currentContent.includes('\r\n');
  const lineEnding = isCrlf ? '\r\n' : '\n';
  const lines = currentContent.split(/\r?\n/);

  const updatedLines = [...lines];
  const pendingInsertions: { directive: CanonicalDirectiveName; formatted: string }[] = [];

  const rawTempo = updates.tempo !== undefined ? updates.tempo : updates.bpm;
  const canonicalFieldMap: Record<CanonicalDirectiveName, string | undefined> = {
    title: updates.title !== undefined ? updates.title.trim() : undefined,
    artist: updates.artist !== undefined ? updates.artist.trim() : undefined,
    key: updates.key !== undefined ? updates.key.trim() : undefined,
    tempo: rawTempo !== undefined && rawTempo !== null && String(rawTempo).trim() !== ''
      ? formatCanonicalTempo(rawTempo)
      : (rawTempo === '' ? '' : undefined),
    time: updates.time !== undefined ? updates.time.trim() : undefined,
    year: updates.year !== undefined && updates.year !== null ? String(updates.year).trim() : undefined,
  };

  const directiveAliases: Record<CanonicalDirectiveName, string[]> = {
    title: ['title', 't'],
    artist: ['artist', 'a', 'subtitle', 'st'],
    key: ['key'],
    tempo: ['tempo', 'bpm'],
    time: ['time'],
    year: ['year'],
  };

  for (const dirName of CANONICAL_DIRECTIVES) {
    const val = canonicalFieldMap[dirName];
    if (val === undefined) continue;

    const existing = lines.flatMap((line, index) => {
      const match = line.trim().match(DIRECTIVE_REGEX);
      return match && directiveAliases[dirName].includes(match[1].toLowerCase()) ? [index] : [];
    });
    if (existing.length) {
      // Update every existing occurrence so no stale alias can override the canonical value.
      for (const index of existing) {
        updatedLines[index] = val === '' ? '' : `{${dirName}: ${val}}`;
      }
    } else if (val !== '') {
      pendingInsertions.push({ directive: dirName, formatted: `{${dirName}: ${val}}` });
    }
  }

  // Synchronize original_key only if explicitly specified in updates
  if (updates.originalKey !== undefined) {
    const rawVal = updates.originalKey.trim();
    const existingOriginalKeyIndices = lines.flatMap((line, index) => {
      const match = line.trim().match(DIRECTIVE_REGEX);
      return match && (match[1].toLowerCase() === 'original_key' || match[1].toLowerCase() === 'originalkey') ? [index] : [];
    });

    if (existingOriginalKeyIndices.length > 0) {
      for (const index of existingOriginalKeyIndices) {
        updatedLines[index] = rawVal === '' ? '' : `{original_key: ${rawVal}}`;
      }
    } else if (rawVal !== '') {
      pendingInsertions.push({ directive: 'key', formatted: `{original_key: ${rawVal}}` });
    }
  }

  const filteredLines = updatedLines.filter((line, idx) => {
    if (line === '') {
      const orig = lines[idx]?.trim();
      const match = orig?.match(DIRECTIVE_REGEX);
      if (match) {
        const name = match[1].toLowerCase();
        for (const dirName of CANONICAL_DIRECTIVES) {
          if (canonicalFieldMap[dirName] === '' && directiveAliases[dirName].includes(name)) {
            return false;
          }
        }
      }
    }
    return true;
  });

  if (pendingInsertions.length > 0) {
    let insertIndex = 0;
    for (let i = 0; i < filteredLines.length; i++) {
      const trimmed = filteredLines[i].trim();
      if (!trimmed) continue;
      const match = trimmed.match(DIRECTIVE_REGEX);
      if (match) {
        const name = match[1].toLowerCase();
        if (['title', 't', 'artist', 'a', 'subtitle', 'st', 'key', 'tempo', 'bpm', 'time', 'year', 'c', 'comment'].includes(name)) {
          insertIndex = i + 1;
          continue;
        }
      }
      break;
    }

    filteredLines.splice(insertIndex, 0, ...pendingInsertions.map((p) => p.formatted));
  }

  return filteredLines.join(lineEnding);
}

export type SongMetadataStatus = 'METADATA_OK' | 'NEEDS_METADATA';

export interface SongMetadataDetail {
  status: SongMetadataStatus;
  isComplete: boolean;
  missingFields: Array<'title' | 'artist' | 'key' | 'tempo' | 'time' | 'year' | 'originalKey'>;
  resolved: {
    title?: string;
    artist?: string;
    key?: string;
    tempo?: number;
    timeSignature?: string;
    year?: number | string;
    originalKey?: string;
  };
  details: {
    title?: string;
    artist?: string;
    key?: string;
    tempo?: number;
    time?: string;
    year?: string;
    originalKey?: string;
  };
}

export interface SongLikeMetadata {
  title?: string | null;
  artist?: string | null;
  key?: string | null;
  originalKey?: string | null;
  bpm?: string | number | null;
  tempo?: string | number | null;
  time?: string | null;
  year?: string | number | null;
  rawContent?: string | null;
}

/**
 * Deterministically checks the library metadata completeness of a song.
 *
 * METADATA_OK requires:
 * 1. Meaningful explicit title (non-empty string).
 * 2. Meaningful artist not equal to case-insensitive "Unknown Artist" (and non-empty).
 * 3. Nonempty valid normalized current key.
 * 4. Valid explicit tempo in canonical supported form/range 30-300 BPM (e.g. 120, "120", "120 BPM").
 * 5. Valid explicit time signature using supported grammar (^\d{1,2}\/\d{1,2}$).
 * 6. Valid 4-digit year (^\d{4}$).
 *
 * OPTIONAL: originalKey. If present, it must be valid. If absent, it does not fail status.
 */
export function getSongMetadataStatus(song: SongLikeMetadata): SongMetadataDetail {
  const missingFields: Array<'title' | 'artist' | 'key' | 'tempo' | 'time' | 'year' | 'originalKey'> = [];
  const parsedDirectives = song.rawContent ? parseChordProDirectives(song.rawContent).metadata : null;

  // 1. Title
  const rawTitle = (song.title ?? parsedDirectives?.title ?? '').trim();
  let validTitle: string | undefined;
  if (!rawTitle) {
    missingFields.push('title');
  } else {
    validTitle = rawTitle;
  }

  // 2. Artist
  const rawArtist = (song.artist ?? parsedDirectives?.artist ?? '').trim();
  let validArtist: string | undefined;
  if (!rawArtist || rawArtist.toLowerCase() === 'unknown artist') {
    missingFields.push('artist');
  } else {
    validArtist = rawArtist;
  }

  // 3. Current Key (must be valid normalized key)
  const rawKey = (song.key ?? parsedDirectives?.key ?? '').trim();
  const normalizedKey = rawKey ? normalizeMusicalKey(rawKey) : null;
  let validKey: string | undefined;
  if (!normalizedKey) {
    missingFields.push('key');
  } else {
    validKey = normalizedKey;
  }

  // 4. Tempo (must be in 30-300 range)
  const rawTempoValue = song.tempo ?? song.bpm ?? parsedDirectives?.tempo ?? parsedDirectives?.bpm ?? null;
  let validTempo: number | undefined;
  if (rawTempoValue === null || rawTempoValue === undefined || String(rawTempoValue).trim() === '') {
    missingFields.push('tempo');
  } else {
    let parsedNum: number | null = null;
    if (typeof rawTempoValue === 'number' && Number.isFinite(rawTempoValue)) {
      parsedNum = Math.round(rawTempoValue);
    } else if (typeof rawTempoValue === 'string') {
      const match = rawTempoValue.trim().match(/^(\d{1,3})(?:\s*bpm)?$/i);
      if (match) {
        parsedNum = parseInt(match[1], 10);
      }
    }
    if (parsedNum !== null && parsedNum >= 30 && parsedNum <= 300) {
      validTempo = parsedNum;
    } else {
      missingFields.push('tempo');
    }
  }

  // 5. Time Signature (^\d{1,2}\/\d{1,2}$)
  const rawTime = (song.time ?? parsedDirectives?.time ?? '').trim();
  let validTime: string | undefined;
  if (!rawTime || !/^\d{1,2}\/\d{1,2}$/.test(rawTime)) {
    missingFields.push('time');
  } else {
    validTime = rawTime;
  }

  // 6. Year (^\d{4}$)
  const rawYear = (song.year !== undefined && song.year !== null ? String(song.year) : (parsedDirectives?.year !== undefined && parsedDirectives?.year !== null ? String(parsedDirectives.year) : '')).trim();
  let validYear: string | undefined;
  if (!rawYear || !/^\d{4}$/.test(rawYear)) {
    missingFields.push('year');
  } else {
    validYear = rawYear;
  }

  // 7. Optional Original Key: if present, must be valid
  const rawOrigKey = (song.originalKey ?? parsedDirectives?.originalKey ?? '').trim();
  let validOrigKey: string | undefined;
  if (rawOrigKey) {
    const normOrig = normalizeMusicalKey(rawOrigKey);
    if (!normOrig) {
      missingFields.push('originalKey');
    } else {
      validOrigKey = normOrig;
    }
  }

  const isComplete = missingFields.length === 0;

  const resolved = {
    ...(validTitle ? { title: validTitle } : {}),
    ...(validArtist ? { artist: validArtist } : {}),
    ...(validKey ? { key: validKey } : {}),
    ...(validTempo !== undefined ? { tempo: validTempo } : {}),
    ...(validTime ? { timeSignature: validTime, time: validTime } : {}),
    ...(validYear ? { year: Number(validYear) || validYear } : {}),
    ...(validOrigKey ? { originalKey: validOrigKey } : {}),
  };

  return {
    status: isComplete ? 'METADATA_OK' : 'NEEDS_METADATA',
    isComplete,
    missingFields,
    resolved,
    details: {
      ...(validTitle ? { title: validTitle } : {}),
      ...(validArtist ? { artist: validArtist } : {}),
      ...(validKey ? { key: validKey } : {}),
      ...(validTempo !== undefined ? { tempo: validTempo } : {}),
      ...(validTime ? { time: validTime } : {}),
      ...(validYear ? { year: validYear } : {}),
      ...(validOrigKey ? { originalKey: validOrigKey } : {}),
    },
  };
}
