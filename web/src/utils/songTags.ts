/** Canonical library labels; legacy comma-separated strings remain accepted. */
const canonicalTag = (tag: string) => tag.trim().replace(/^#+\s*/, '').trim().toLowerCase()
export function normalizeTags(value: unknown): string[] {
  const entries = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : []
  return [...new Set(entries.filter((entry): entry is string => typeof entry === 'string').map(canonicalTag).filter(Boolean))]
}
export function songHasTag(value: unknown, tag: string): boolean {
  return normalizeTags(value).includes(canonicalTag(tag))
}
export function renameTagInList(value: unknown, oldTag: string, newTag: string): string[] {
  return normalizeTags(normalizeTags(value).map(tag => tag === canonicalTag(oldTag) ? canonicalTag(newTag) : tag))
}
export function removeTagFromList(value: unknown, tag: string): string[] {
  return normalizeTags(value).filter(item => item !== canonicalTag(tag))
}
export function matchesSongTags(value: unknown, query: string): boolean {
  const q = canonicalTag(query)
  return normalizeTags(value).some(tag => tag.includes(q))
}


/** Optional library metadata. Strict validation prevents CSS injection and ambiguous keys. */
export type TagColors = Record<string, string>
export function validTagColors(value: unknown): value is TagColors {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([tag, color]) => tag.length > 0 && canonicalTag(tag) === tag &&
      typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color))
}
export function changeTagColorKey(colors: TagColors, tag: string, renamed?: string): TagColors {
  const next = { ...colors }, old = canonicalTag(tag), target = renamed === undefined ? undefined : canonicalTag(renamed)
  const color = Object.hasOwn(next, old) ? next[old] : undefined
  delete next[old]
  // Renaming into an existing tag retains that tag's explicit color.
  if (target && color && !Object.hasOwn(next, target)) Object.defineProperty(next, target, { value: color, enumerable: true, configurable: true, writable: true })
  return next
}
/** WCAG relative luminance: select the higher-contrast of black and white (at least 4.58:1). */
export function tagChipStyle(colors: TagColors | undefined, tag: string): { backgroundColor: string; color: string; borderColor: string } | undefined {
  const hex = colors && Object.hasOwn(colors, canonicalTag(tag)) ? colors[canonicalTag(tag)] : undefined
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined
  const channels = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  return { backgroundColor: hex, borderColor: hex, color: luminance > 0.179 ? '#000000' : '#ffffff' }
}
