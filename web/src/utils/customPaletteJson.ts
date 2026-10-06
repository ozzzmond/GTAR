import { validateFontSettings, normalizeFontSettings, type FontSettings } from './customFonts'
import type { CustomThemeColors } from './backupSettings'
import { DEFAULT_CUSTOM_COLORS, normalizeCustomThemeColors } from '../components/ThemeModal'

export const CUSTOM_PALETTE_JSON_FORMAT = 'gtar-custom-palette' as const
export const CUSTOM_PALETTE_JSON_VERSION = 2 as const

export interface CustomPaletteJsonPayload {
  format: typeof CUSTOM_PALETTE_JSON_FORMAT
  version: typeof CUSTOM_PALETTE_JSON_VERSION
  fonts?: FontSettings
  colors: Record<string, string>
}

export const CANONICAL_CUSTOM_PALETTE_FIELDS = [
  'uiPrimaryText', 'uiSecondaryText', 'uiSectionText', 'uiMutedText', 'uiLinkText',
  // STAGE (4)
  'bgHex',
  'textHex',
  'chordHex',
  'sectionHex',
  // APP_CHROME (9)
  'headerBg',
  'headerPrimaryText', 'headerSecondaryText', 'headerIconColor',
  'toolbarBg',
  'searchBg',
  'searchBorder',
  'filterBarBg',
  'iconColor',
  // CARDS_AND_BOXES (5)
  'setlistCardBg',
  'songCardBg',
  'cardBorder',
  'selectedCardBg',
  'selectedCardBorder',
  // CONTROLS (6)
  'buttonBg',
  'buttonText',
  'inputBg',
  'inputText',
  'inputBorder',
  'accentColor',
  // STAGE_FLOATING_CONTROLS (6)
  'dockBg',
  'dockBorder',
  'dockBtnBg',
  'dockBtnIcon',
  'dockPlayBg',
  'dockPlayIcon',
] as const

export type CanonicalPaletteField = typeof CANONICAL_CUSTOM_PALETTE_FIELDS[number]

export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/

/**
 * Exports a canonical Custom Theme Palette to a JSON-compatible object.
 */
export function exportCustomPaletteJson(rawColors: CustomThemeColors): CustomPaletteJsonPayload {
  const normalized = normalizeCustomThemeColors(rawColors)
  const colors: Record<string, string> = {}

  for (const field of CANONICAL_CUSTOM_PALETTE_FIELDS) {
    colors[field] = normalized[field] || DEFAULT_CUSTOM_COLORS[field] || '#000000'
  }

  return {
    format: CUSTOM_PALETTE_JSON_FORMAT,
    version: CUSTOM_PALETTE_JSON_VERSION,
    colors,
    fonts: normalizeFontSettings(normalized.fonts),
  }
}

/**
 * Validates and imports a JSON-compatible Custom Theme Palette.
 * Returns { success: true, colors: CustomThemeColors } or { success: false, error: string }
 */
export function importCustomPaletteJson(input: unknown): {
  success: true
  colors: CustomThemeColors
} | {
  success: false
  error: string
} {
  let parsed: unknown = input
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input)
    } catch {
      return { success: false, error: 'Invalid JSON syntax' }
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { success: false, error: 'Palette data must be a JSON object' }
  }

  const obj = parsed as Record<string, unknown>

  if (obj.format !== CUSTOM_PALETTE_JSON_FORMAT) {
    return { success: false, error: `Invalid palette format. Expected "${CUSTOM_PALETTE_JSON_FORMAT}"` }
  }

  if (obj.version !== CUSTOM_PALETTE_JSON_VERSION) {
    return { success: false, error: `Unsupported palette version ${String(obj.version)}. Expected ${CUSTOM_PALETTE_JSON_VERSION}` }
  }

  if (!obj.colors || typeof obj.colors !== 'object' || Array.isArray(obj.colors)) {
    return { success: false, error: 'Palette colors must be an object' }
  }

  const rawColors = obj.colors as Record<string, unknown>
  const allowedSet = new Set<string>(CANONICAL_CUSTOM_PALETTE_FIELDS)

  if (Object.keys(obj).some(key => !['format', 'version', 'colors', 'fonts'].includes(key))) {
    return { success: false, error: 'Unsupported palette field' }
  }
  if ('fonts' in obj && validateFontSettings(obj.fonts).length) {
    return { success: false, error: validateFontSettings(obj.fonts).join('; ') }
  }
  // Validate fields
  for (const [key, value] of Object.entries(rawColors)) {
    if (!allowedSet.has(key)) {
      return { success: false, error: `Unsupported color field "${key}"` }
    }
    if (typeof value !== 'string' || !HEX_COLOR_REGEX.test(value)) {
      return { success: false, error: `Invalid color value for "${key}": must be #RRGGBB hex` }
    }
  }

  // Build normalized palette: any missing canonical fields fall back to normalized defaults
  const normalized = normalizeCustomThemeColors({ ...rawColors as Partial<CustomThemeColors>, fonts: normalizeFontSettings(obj.fonts) })

  return {
    success: true,
    colors: normalized,
  }
}

/**
 * Deterministically maps a built-in preset's core colors into a coherent Custom Palette V2 object.
 * Does not mutate the original preset object.
 */
export function presetToCustomPalette(preset: {
  id: string
  name: string
  bgHex: string
  surfaceHex: string
  accentHex: string
  textHex: string
}): CustomThemeColors {
  const bg = preset.bgHex
  const surface = preset.surfaceHex
  const accent = preset.accentHex
  const text = preset.textHex

  // Calculate brightness for contrast derivation
  const hex = bg.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16) || 0
  const g = parseInt(hex.substring(2, 4), 16) || 0
  const b = parseInt(hex.substring(4, 6), 16) || 0
  const isLight = (r * 299 + g * 587 + b * 114) / 1000 > 150

  const border = isLight
    ? `#${Math.max(0, r - 35).toString(16).padStart(2, '0')}${Math.max(0, g - 35).toString(16).padStart(2, '0')}${Math.max(0, b - 35).toString(16).padStart(2, '0')}`
    : `#${Math.min(255, r + 35).toString(16).padStart(2, '0')}${Math.min(255, g + 35).toString(16).padStart(2, '0')}${Math.min(255, b + 35).toString(16).padStart(2, '0')}`

  const mutedText = isLight ? '#64748b' : '#94a3b8'

  // Chords and section headers default to accent / secondary complementary colors
  let chordHex = accent
  let sectionHex = isLight ? '#0f766e' : '#a78bfa'

  if (preset.id === 'solarized-dark') {
    chordHex = '#b58900'
    sectionHex = '#268bd2'
  } else if (preset.id === 'amber-stage') {
    chordHex = '#f59e0b'
    sectionHex = '#d97706'
  } else if (preset.id === 'oled-black') {
    chordHex = '#38bdf8'
    sectionHex = '#0ea5e9'
  } else if (preset.id === 'paper-light') {
    chordHex = '#b45309'
    sectionHex = '#0f766e'
  } else if (preset.id === 'crimson-stage') {
    chordHex = '#e11d48'
    sectionHex = '#fb7185'
  } else if (preset.id === 'azure-stage') {
    chordHex = '#06b6d4'
    sectionHex = '#38bdf8'
  } else if (preset.id === 'e-ink-paper') {
    chordHex = '#404040'
    sectionHex = '#262626'
  }

  // Determine play icon contrast against accent (FAB button)
  const aHex = accent.replace('#', '')
  const ar = parseInt(aHex.substring(0, 2), 16) || 0
  const ag = parseInt(aHex.substring(2, 4), 16) || 0
  const ab = parseInt(aHex.substring(4, 6), 16) || 0
  const isAccentLight = (ar * 299 + ag * 587 + ab * 114) / 1000 > 150
  const dockPlayIcon = isAccentLight ? '#000000' : '#ffffff'

  const customPalette: CustomThemeColors = {
    uiPrimaryText: text, uiSecondaryText: isLight ? '#374151' : '#CBD5E1',
    uiSectionText: text, uiMutedText: isLight ? '#4B5563' : mutedText,
    uiLinkText: isLight ? '#1D4ED8' : '#38BDF8',
    // STAGE
    bgHex: bg,
    textHex: text,
    chordHex: chordHex,
    sectionHex: sectionHex,

    // APP_CHROME
    headerBg: surface,
    toolbarBg: bg,
    searchBg: isLight ? surface : bg,
    searchBorder: border,
    filterBarBg: surface,
    iconColor: mutedText,

    // CARDS_AND_BOXES
    setlistCardBg: surface,
    songCardBg: surface,
    cardBorder: border,
    selectedCardBg: isLight ? '#eef7f6' : surface,
    selectedCardBorder: accent,

    // CONTROLS
    buttonBg: surface,
    buttonText: text,
    inputBg: isLight ? '#ffffff' : bg,
    inputText: text,
    inputBorder: border,
    accentColor: accent,

    // STAGE_FLOATING_CONTROLS
    dockBg: surface,
    dockBorder: border,
    dockBtnBg: bg,
    dockBtnIcon: text,
    dockPlayBg: accent,
    dockPlayIcon: dockPlayIcon,
  }

  return normalizeCustomThemeColors(customPalette)
}

