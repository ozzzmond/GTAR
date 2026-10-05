export interface CanonicalMetadata {
  title?: string;
  artist?: string;
  key?: string;
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
