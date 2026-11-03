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
