/** Legacy comma-separated strings are accepted at storage/import boundaries only.
 * Arrays preserve each tag verbatim apart from trimming; first spelling wins.
 * This pure adapter never writes or migrates the stored library.
 */
export function normalizeTags(value: unknown): string[] {
  const entries = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : []
  const seen = new Set<string>()
  return entries.flatMap(entry => {
    if (typeof entry !== 'string') return []
    const tag = entry.trim()
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) return []
    seen.add(key)
    return [tag]
  })
}

export function matchesSongTags(value: unknown, query: string): boolean {
  const q = query.trim().toLowerCase()
  return normalizeTags(value).some(tag => tag.toLowerCase().includes(q))
}
