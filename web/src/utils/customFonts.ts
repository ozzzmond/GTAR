export const FONT_TARGETS = ['ui', 'stage', 'heading'] as const
export type FontTarget = typeof FONT_TARGETS[number]
export type FontSource = 'system' | 'builtin' | 'google' | 'stylesheet' | 'webfont'
export interface FontChoice { source: FontSource; family?: string; url?: string }
export type FontSettings = Partial<Record<FontTarget, FontChoice>>
export const BUILTIN_FONTS = ['Inter', 'JetBrains Mono', 'Fira Code', 'Georgia'] as const
export const SYSTEM_STACK = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const familyPattern = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,79}$/u

export function safeFontUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || /[\s"'<>\\]/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.hash
  } catch { return false }
}

export function validateFontSettings(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['fonts: expected object']
  const errors: string[] = []
  for (const [target, raw] of Object.entries(value)) {
    if (!FONT_TARGETS.includes(target as FontTarget) || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push('fonts: unknown target or invalid choice'); continue
    }
    const choice = raw as Record<string, unknown>
    if (Object.keys(choice).some(key => !['source', 'family', 'url'].includes(key)) ||
      !['system', 'builtin', 'google', 'stylesheet', 'webfont'].includes(String(choice.source))) {
      errors.push('fonts: unsupported source or field'); continue
    }
    if (choice.source === 'system') {
      if ('family' in choice || 'url' in choice) errors.push('fonts: system takes no family or URL')
      continue
    }
    if (typeof choice.family !== 'string' || !familyPattern.test(choice.family)) errors.push('fonts: invalid family')
    if (choice.source === 'builtin' && !BUILTIN_FONTS.includes(choice.family as typeof BUILTIN_FONTS[number])) errors.push('fonts: unknown built-in family')
    if (choice.source === 'stylesheet' || choice.source === 'webfont') {
      if (!safeFontUrl(choice.url)) errors.push('fonts: HTTPS URL required')
    } else if ('url' in choice) errors.push('fonts: URL not accepted for this source')
  }
  return errors
}

export function normalizeFontSettings(raw: unknown): FontSettings {
  if (!raw || validateFontSettings(raw).length) return {}
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, { ...value as FontChoice }]))
}

export function fontStack(choice?: FontChoice, target: FontTarget = 'ui'): string {
  if (!choice || choice.source === 'system') return target === 'stage' ? 'var(--font-stage-mono)' : SYSTEM_STACK
  const fallback = choice.family === 'Georgia' ? 'Georgia, serif' : /Mono|Code/.test(choice.family || '') ? 'ui-monospace, monospace' : SYSTEM_STACK
  return `"${choice.family}", ${fallback}`
}

// A document owns one resource per source URL. Preview and applied settings share it.
const resources = new WeakMap<Document, Set<string>>()
export function loadFontResources(settings: FontSettings, doc: Document = document) {
  let loaded = resources.get(doc)
  if (!loaded) { loaded = new Set(); resources.set(doc, loaded) }
  for (const choice of Object.values(normalizeFontSettings(settings))) {
    if (!choice || !['google', 'stylesheet', 'webfont'].includes(choice.source)) continue
    const url = choice.source === 'google'
      ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(choice.family!).replace(/%20/g, '+')}&display=swap`
      : choice.url!
    const key = choice.source === 'webfont' ? `webfont:${choice.family}:${url}` : `stylesheet:${url}`
    if (loaded.has(key)) continue
    loaded.add(key)
    if (choice.source === 'webfont') {
      if (typeof FontFace === 'undefined' || !doc.fonts) continue
      try {
        const face = new FontFace(choice.family!, `url("${url}")`, { display: 'swap' })
        void face.load().then(font => doc.fonts.add(font)).catch(() => { /* deterministic fallback */ })
      } catch { /* unsupported browser font: keep fallback */ }
    } else {
      const link = doc.createElement('link')
      link.rel = 'stylesheet'; link.href = url; link.dataset.gtarFont = key
      link.referrerPolicy = 'no-referrer'
      doc.head.appendChild(link)
    }
  }
}

export function applyFontSettings(raw: unknown, root: HTMLElement) {
  const fonts = normalizeFontSettings(raw)
  loadFontResources(fonts, root.ownerDocument)
  root.style.setProperty('--custom-font-ui', fontStack(fonts.ui))
  root.style.setProperty('--custom-font-heading', fontStack(fonts.heading || fonts.ui, 'heading'))
  if (fonts.stage && fonts.stage.source !== 'system') root.style.setProperty('--custom-font-stage', fontStack(fonts.stage, 'stage'))
  else root.style.removeProperty('--custom-font-stage')
}
