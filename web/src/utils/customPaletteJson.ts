import { validateFontSettings, normalizeFontSettings, type FontSettings } from './customFonts'
import { validateCustomThemeIdentity, type CustomThemeIdentity, type CustomThemeColors } from './backupSettings'
import { DEFAULT_CUSTOM_COLORS, normalizeCustomThemeColors } from '../components/ThemeModal'

export const CUSTOM_PALETTE_JSON_FORMAT = 'gtar-custom-palette' as const
export const CUSTOM_PALETTE_JSON_VERSION = 2 as const

export interface CustomPaletteJsonPayload {
  format: typeof CUSTOM_PALETTE_JSON_FORMAT
  version: typeof CUSTOM_PALETTE_JSON_VERSION
  identity?: CustomThemeIdentity
  fonts?: FontSettings
  colors: Record<string, string>
}

export const CANONICAL_CUSTOM_PALETTE_FIELDS = [
  'actionColor', 'selectionColor', 'sectionIconColor',
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
    ...(normalized.identity ? { identity: { ...normalized.identity, displayName: normalized.identity.displayName.trim() } } : {}),
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

  if (Object.keys(obj).some(key => !['format', 'version', 'colors', 'fonts', 'identity'].includes(key))) {
    return { success: false, error: 'Unsupported palette field' }
  }
  if ('identity' in obj && validateCustomThemeIdentity(obj.identity).length) return { success: false, error: validateCustomThemeIdentity(obj.identity).join('; ') }
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
  const normalized = normalizeCustomThemeColors({ ...rawColors as Partial<CustomThemeColors>, fonts: normalizeFontSettings(obj.fonts), ...(obj.identity ? { identity: obj.identity as CustomThemeIdentity } : {}) })

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
  switch (preset.id) {
    case 'solarized-dark':
      return normalizeCustomThemeColors({
        uiPrimaryText: '#EEE8D5',
        uiSecondaryText: '#93A1A1',
        uiSectionText: '#EEE8D5',
        uiMutedText: '#657b83',
        uiLinkText: '#268bd2',
        bgHex: '#002B36',
        textHex: '#EEE8D5',
        chordHex: '#b58900',
        sectionHex: '#268bd2',
        headerBg: '#073642',
        headerPrimaryText: '#EEE8D5',
        headerSecondaryText: '#93A1A1',
        headerIconColor: '#93A1A1',
        toolbarBg: '#002B36',
        searchBg: '#002B36',
        searchBorder: '#1A4A55',
        filterBarBg: '#073642',
        iconColor: '#93A1A1',
        setlistCardBg: '#073642',
        songCardBg: '#073642',
        cardBorder: '#1A4A55',
        selectedCardBg: '#002B36',
        selectedCardBorder: '#2AA198',
        buttonBg: '#073642',
        buttonText: '#EEE8D5',
        inputBg: '#002B36',
        inputText: '#EEE8D5',
        inputBorder: '#1A4A55',
        accentColor: '#2AA198',
        actionColor: '#2AA198',
        selectionColor: '#2AA198',
        sectionIconColor: '#268bd2',
        dockBg: '#073642',
        dockBorder: '#1A4A55',
        dockBtnBg: '#002B36',
        dockBtnIcon: '#EEE8D5',
        dockPlayBg: '#2AA198',
        dockPlayIcon: '#002B36',
      })

    case 'amber-stage':
      return normalizeCustomThemeColors({
        uiPrimaryText: '#FFF8E7',
        uiSecondaryText: '#D1A153',
        uiSectionText: '#FFF8E7',
        uiMutedText: '#A88240',
        uiLinkText: '#F59E0B',
        bgHex: '#181206',
        textHex: '#FFF8E7',
        chordHex: '#F59E0B',
        sectionHex: '#D97706',
        headerBg: '#241c0c',
        headerPrimaryText: '#FFF8E7',
        headerSecondaryText: '#D1A153',
        headerIconColor: '#D1A153',
        toolbarBg: '#181206',
        searchBg: '#181206',
        searchBorder: '#3d2f16',
        filterBarBg: '#241c0c',
        iconColor: '#D1A153',
        setlistCardBg: '#241c0c',
        songCardBg: '#241c0c',
        cardBorder: '#3d2f16',
        selectedCardBg: '#2f2410',
        selectedCardBorder: '#F59E0B',
        buttonBg: '#2f2410',
        buttonText: '#FFF8E7',
        inputBg: '#181206',
        inputText: '#FFF8E7',
        inputBorder: '#3d2f16',
        accentColor: '#F59E0B',
        actionColor: '#F59E0B',
        selectionColor: '#F59E0B',
        sectionIconColor: '#D97706',
        dockBg: '#241c0c',
        dockBorder: '#3d2f16',
        dockBtnBg: '#181206',
        dockBtnIcon: '#FFF8E7',
        dockPlayBg: '#F59E0B',
        dockPlayIcon: '#181206',
      })

    case 'oled-black':
      return normalizeCustomThemeColors({
        uiPrimaryText: '#FFFFFF',
        uiSecondaryText: '#94A3B8',
        uiSectionText: '#FFFFFF',
        uiMutedText: '#64748B',
        uiLinkText: '#38BDF8',
        bgHex: '#000000',
        textHex: '#FFFFFF',
        chordHex: '#38BDF8',
        sectionHex: '#0EA5E9',
        headerBg: '#111111',
        headerPrimaryText: '#FFFFFF',
        headerSecondaryText: '#94A3B8',
        headerIconColor: '#94A3B8',
        toolbarBg: '#000000',
        searchBg: '#000000',
        searchBorder: '#262626',
        filterBarBg: '#111111',
        iconColor: '#94A3B8',
        setlistCardBg: '#111111',
        songCardBg: '#111111',
        cardBorder: '#262626',
        selectedCardBg: '#1A1A1A',
        selectedCardBorder: '#38BDF8',
        buttonBg: '#1A1A1A',
        buttonText: '#FFFFFF',
        inputBg: '#000000',
        inputText: '#FFFFFF',
        inputBorder: '#262626',
        accentColor: '#38BDF8',
        actionColor: '#38BDF8',
        selectionColor: '#38BDF8',
        sectionIconColor: '#0EA5E9',
        dockBg: '#111111',
        dockBorder: '#262626',
        dockBtnBg: '#000000',
        dockBtnIcon: '#FFFFFF',
        dockPlayBg: '#38BDF8',
        dockPlayIcon: '#000000',
      })

    case 'paper-light':
      return normalizeCustomThemeColors({
        uiPrimaryText: '#172033',
        uiSecondaryText: '#64748B',
        uiSectionText: '#172033',
        uiMutedText: '#64748B',
        uiLinkText: '#0f766e',
        bgHex: '#f4ecd8',
        textHex: '#172033',
        chordHex: '#b45309',
        sectionHex: '#0f766e',
        headerBg: '#FFFDF7',
        headerPrimaryText: '#172033',
        headerSecondaryText: '#64748B',
        headerIconColor: '#64748B',
        toolbarBg: '#f4ecd8',
        searchBg: '#FFFDF7',
        searchBorder: '#ded3ba',
        filterBarBg: '#FFFDF7',
        iconColor: '#64748B',
        setlistCardBg: '#FFFDF7',
        songCardBg: '#FFFDF7',
        cardBorder: '#ded3ba',
        selectedCardBg: '#eef7f6',
        selectedCardBorder: '#2AA198',
        buttonBg: '#ede4cf',
        buttonText: '#172033',
        inputBg: '#FFFDF7',
        inputText: '#172033',
        inputBorder: '#ded3ba',
        accentColor: '#b45309',
        actionColor: '#0f766e',
        selectionColor: '#2AA198',
        sectionIconColor: '#0f766e',
        dockBg: '#FFFDF7',
        dockBorder: '#ded3ba',
        dockBtnBg: '#f4ecd8',
        dockBtnIcon: '#172033',
        dockPlayBg: '#2AA198',
        dockPlayIcon: '#ffffff',
      })

    case 'crimson-stage':
      return normalizeCustomThemeColors({
        uiPrimaryText: '#FEE2E2',
        uiSecondaryText: '#FCA5A5',
        uiSectionText: '#FEE2E2',
        uiMutedText: '#E07A8A',
        uiLinkText: '#FB7185',
        bgHex: '#120d0f',
        textHex: '#FEE2E2',
        chordHex: '#E11D48',
        sectionHex: '#FB7185',
        headerBg: '#1f1418',
        headerPrimaryText: '#FEE2E2',
        headerSecondaryText: '#FCA5A5',
        headerIconColor: '#FB7185',
        toolbarBg: '#120d0f',
        searchBg: '#120d0f',
        searchBorder: '#3b1d26',
        filterBarBg: '#1f1418',
        iconColor: '#FB7185',
        setlistCardBg: '#1f1418',
        songCardBg: '#1f1418',
        cardBorder: '#3b1d26',
        selectedCardBg: '#2d1620',
        selectedCardBorder: '#E11D48',
        buttonBg: '#2d1620',
        buttonText: '#FEE2E2',
        inputBg: '#120d0f',
        inputText: '#FEE2E2',
        inputBorder: '#3b1d26',
        accentColor: '#E11D48',
        actionColor: '#E11D48',
        selectionColor: '#E11D48',
        sectionIconColor: '#FB7185',
        dockBg: '#1f1418',
        dockBorder: '#3b1d26',
        dockBtnBg: '#120d0f',
        dockBtnIcon: '#FEE2E2',
        dockPlayBg: '#E11D48',
        dockPlayIcon: '#FFFFFF',
      })

    case 'azure-stage':
      return normalizeCustomThemeColors({
        uiPrimaryText: '#E0F2FE',
        uiSecondaryText: '#BAE6FD',
        uiSectionText: '#E0F2FE',
        uiMutedText: '#7DD3FC',
        uiLinkText: '#38BDF8',
        bgHex: '#0a1324',
        textHex: '#E0F2FE',
        chordHex: '#06B6D4',
        sectionHex: '#38BDF8',
        headerBg: '#11203b',
        headerPrimaryText: '#E0F2FE',
        headerSecondaryText: '#BAE6FD',
        headerIconColor: '#38BDF8',
        toolbarBg: '#0a1324',
        searchBg: '#0a1324',
        searchBorder: '#1e3a5f',
        filterBarBg: '#11203b',
        iconColor: '#38BDF8',
        setlistCardBg: '#11203b',
        songCardBg: '#11203b',
        cardBorder: '#1e3a5f',
        selectedCardBg: '#162c52',
        selectedCardBorder: '#06B6D4',
        buttonBg: '#162c52',
        buttonText: '#E0F2FE',
        inputBg: '#0a1324',
        inputText: '#E0F2FE',
        inputBorder: '#1e3a5f',
        accentColor: '#06B6D4',
        actionColor: '#06B6D4',
        selectionColor: '#06B6D4',
        sectionIconColor: '#38BDF8',
        dockBg: '#11203b',
        dockBorder: '#1e3a5f',
        dockBtnBg: '#0a1324',
        dockBtnIcon: '#E0F2FE',
        dockPlayBg: '#06B6D4',
        dockPlayIcon: '#0a1324',
      })

    case 'e-ink-paper':
      return normalizeCustomThemeColors({
        uiPrimaryText: '#111111',
        uiSecondaryText: '#404040',
        uiSectionText: '#111111',
        uiMutedText: '#666666',
        uiLinkText: '#111111',
        bgHex: '#ededed',
        textHex: '#111111',
        chordHex: '#404040',
        sectionHex: '#262626',
        headerBg: '#f8f8f8',
        headerPrimaryText: '#111111',
        headerSecondaryText: '#404040',
        headerIconColor: '#525252',
        toolbarBg: '#ededed',
        searchBg: '#f8f8f8',
        searchBorder: '#cccccc',
        filterBarBg: '#f8f8f8',
        iconColor: '#525252',
        setlistCardBg: '#f8f8f8',
        songCardBg: '#f8f8f8',
        cardBorder: '#cccccc',
        selectedCardBg: '#e5e5e5',
        selectedCardBorder: '#404040',
        buttonBg: '#e5e5e5',
        buttonText: '#111111',
        inputBg: '#ffffff',
        inputText: '#111111',
        inputBorder: '#cccccc',
        accentColor: '#404040',
        actionColor: '#111111',
        selectionColor: '#404040',
        sectionIconColor: '#262626',
        dockBg: '#f8f8f8',
        dockBorder: '#cccccc',
        dockBtnBg: '#ededed',
        dockBtnIcon: '#111111',
        dockPlayBg: '#404040',
        dockPlayIcon: '#ffffff',
      })

    default: {
      const bg = preset.bgHex
      const surface = preset.surfaceHex
      const accent = preset.accentHex
      const text = preset.textHex
      const hex = bg.replace('#', '')
      const r = parseInt(hex.substring(0, 2), 16) || 0
      const g = parseInt(hex.substring(2, 4), 16) || 0
      const b = parseInt(hex.substring(4, 6), 16) || 0
      const isLight = (r * 299 + g * 587 + b * 114) / 1000 > 150
      const border = isLight
        ? `#${Math.max(0, r - 35).toString(16).padStart(2, '0')}${Math.max(0, g - 35).toString(16).padStart(2, '0')}${Math.max(0, b - 35).toString(16).padStart(2, '0')}`
        : `#${Math.min(255, r + 35).toString(16).padStart(2, '0')}${Math.min(255, g + 35).toString(16).padStart(2, '0')}${Math.min(255, b + 35).toString(16).padStart(2, '0')}`
      const mutedText = isLight ? '#64748b' : '#94a3b8'
      const aHex = accent.replace('#', '')
      const ar = parseInt(aHex.substring(0, 2), 16) || 0
      const ag = parseInt(aHex.substring(2, 4), 16) || 0
      const ab = parseInt(aHex.substring(4, 6), 16) || 0
      const isAccentLight = (ar * 299 + ag * 587 + ab * 114) / 1000 > 150
      const dockPlayIcon = isAccentLight ? '#000000' : '#ffffff'

      return normalizeCustomThemeColors({
        uiPrimaryText: text,
        uiSecondaryText: isLight ? '#374151' : '#CBD5E1',
        uiSectionText: text,
        uiMutedText: isLight ? '#4B5563' : mutedText,
        uiLinkText: isLight ? '#1D4ED8' : '#38BDF8',
        bgHex: bg,
        textHex: text,
        chordHex: accent,
        sectionHex: isLight ? '#0f766e' : '#a78bfa',
        headerBg: surface,
        toolbarBg: bg,
        searchBg: isLight ? surface : bg,
        searchBorder: border,
        filterBarBg: surface,
        iconColor: mutedText,
        setlistCardBg: surface,
        songCardBg: surface,
        cardBorder: border,
        selectedCardBg: isLight ? '#eef7f6' : surface,
        selectedCardBorder: accent,
        buttonBg: surface,
        buttonText: text,
        inputBg: isLight ? '#ffffff' : bg,
        inputText: text,
        inputBorder: border,
        accentColor: accent,
        actionColor: accent,
        selectionColor: accent,
        sectionIconColor: isLight ? '#0f766e' : '#a78bfa',
        dockBg: surface,
        dockBorder: border,
        dockBtnBg: bg,
        dockBtnIcon: text,
        dockPlayBg: accent,
        dockPlayIcon: dockPlayIcon,
      })
    }
  }
}

