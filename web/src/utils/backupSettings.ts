import { normalizeFontSettings, applyFontSettings, validateFontSettings, type FontSettings } from './customFonts'
import { cyrb53, stableStringify } from './contentHash'
export const SETTINGS_KEYS = {
  themeMode: 'gtar_theme_store',
  factoryThemeOverrides: 'gtar_factory_theme_overrides',
  customThemeColors: 'gtar_custom_theme_colors',
  fontStyle: 'gtar_font_style_store',
  isTwoColumn: 'gtar_twocolumn_store',
  fontSizePx: 'gtar_stage_font_size',
  scrollSpeed: 'gtar_stage_scroll_speed',
} as const

export const SETTINGS_CHANGED = 'gtar-settings-restored'
export const STANDALONE_PALETTE_KEY = 'gtar_standalone_custom_theme_colors'
export const CLOUD_THEME_SETTINGS_VERSION = 1 as const
export const MAX_CLOUD_THEME_SETTINGS_BYTES = 64 * 1024
export const THEME_MODES = [
  'solarized-dark',
  'amber-stage',
  'oled-black',
  'paper-light',
  'crimson-stage',
  'azure-stage',
  'e-ink-paper',
  'custom',
] as const
export const FONT_STYLES = ['mono', 'sans', 'serif'] as const
export type ThemeMode = typeof THEME_MODES[number]
export type SongFontStyleOption = typeof FONT_STYLES[number]
export interface CustomThemeIdentity { factoryId: Exclude<ThemeMode, 'custom'>; displayName: string }
export const CUSTOM_THEME_NAME_MAX_LENGTH = 80
export function validateCustomThemeIdentity(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Theme identity must be an object']
  const identity = value as Record<string, unknown>
  if (Object.keys(identity).some(key => !['factoryId', 'displayName'].includes(key))) return ['Unsupported theme identity field']
  if (identity.factoryId === 'custom' || !THEME_MODES.includes(identity.factoryId as ThemeMode)) return ['Unsupported factory theme']
  if (typeof identity.displayName !== 'string' || !identity.displayName.trim() || identity.displayName.trim().length > CUSTOM_THEME_NAME_MAX_LENGTH) return ['Custom name must contain 1–80 characters']
  return []
}
export type FactoryThemeOverrides = Partial<Record<Exclude<ThemeMode, 'custom'>, CustomThemeColors>>
export interface CustomThemeColors {
  identity?: CustomThemeIdentity
  actionColor?: string
  selectionColor?: string
  sectionIconColor?: string
  fonts?: FontSettings
  uiPrimaryText?: string
  uiSecondaryText?: string
  uiSectionText?: string
  uiMutedText?: string
  uiLinkText?: string
  // STAGE
  bgHex: string
  textHex: string
  chordHex: string
  sectionHex: string

  // APP_CHROME
  headerBg?: string
  headerPrimaryText?: string
  headerSecondaryText?: string
  headerIconColor?: string
  toolbarBg?: string
  searchBg?: string
  searchBorder?: string
  filterBarBg?: string
  iconColor?: string

  // CARDS_AND_BOXES
  setlistCardBg?: string
  songCardBg?: string
  cardBorder?: string
  selectedCardBg?: string
  selectedCardBorder?: string

  // CONTROLS
  buttonBg?: string
  buttonText?: string
  inputBg?: string
  inputText?: string
  inputBorder?: string
  accentColor?: string

  // STAGE_FLOATING_CONTROLS
  dockBg?: string
  dockBorder?: string
  dockBtnBg?: string
  dockBtnIcon?: string
  dockPlayBg?: string
  dockPlayIcon?: string
}
export interface BackupSettings {
  factoryThemeOverrides?: FactoryThemeOverrides
  themeMode?: ThemeMode
  customThemeColors?: CustomThemeColors
  stageSettings?: { fontStyle?: SongFontStyleOption; fontSizePx?: number; isTwoColumn?: boolean; scrollSpeed?: number }
}

export interface CloudThemeSettings {
  version: typeof CLOUD_THEME_SETTINGS_VERSION
  themeMode?: ThemeMode
  customThemeColors?: CustomThemeColors
  factoryThemeOverrides?: FactoryThemeOverrides
}

export const DEFAULT_CUSTOM_COLORS: CustomThemeColors = {
  actionColor: '#2AA198',
  selectionColor: '#2AA198',
  sectionIconColor: '#2AA198',
  uiPrimaryText: '#F1F5F9',
  uiSecondaryText: '#CBD5E1',
  uiSectionText: '#F1F5F9',
  uiMutedText: '#94A3B8',
  uiLinkText: '#38BDF8',
  bgHex: '#121820',
  textHex: '#F1F5F9',
  chordHex: '#F59E0B',
  sectionHex: '#A78BFA',
  headerBg: '#1A222D',
  headerPrimaryText: '#F1F5F9',
  headerSecondaryText: '#CBD5E1',
  headerIconColor: '#94A3B8',
  toolbarBg: '#121820',
  searchBg: '#121820',
  searchBorder: '#2A3644',
  filterBarBg: '#1A222D',
  iconColor: '#94A3B8',
  setlistCardBg: '#1A222D',
  songCardBg: '#1A222D',
  cardBorder: '#2A3644',
  selectedCardBg: '#22313F',
  selectedCardBorder: '#38BDF8',
  buttonBg: '#24303E',
  buttonText: '#F1F5F9',
  inputBg: '#121820',
  inputText: '#F1F5F9',
  inputBorder: '#2A3644',
  accentColor: '#F59E0B',
  dockBg: '#1A222D',
  dockBorder: '#2A3644',
  dockBtnBg: '#121820',
  dockBtnIcon: '#F1F5F9',
  dockPlayBg: '#F59E0B',
  dockPlayIcon: '#000000',
}

function typographyDefaults(colors: Partial<CustomThemeColors>) {
  const light = parseInt((colors.bgHex || '#121820').slice(1, 3), 16) * .299 +
    parseInt((colors.bgHex || '#121820').slice(3, 5), 16) * .587 +
    parseInt((colors.bgHex || '#121820').slice(5, 7), 16) * .114 > 150
  return {
    uiPrimaryText: colors.uiPrimaryText || (light ? '#111827' : '#F1F5F9'),
    uiSecondaryText: colors.uiSecondaryText || (light ? '#374151' : '#CBD5E1'),
    uiSectionText: colors.uiSectionText || (light ? '#111827' : '#F1F5F9'),
    uiMutedText: colors.uiMutedText || (light ? '#4B5563' : '#94A3B8'),
    uiLinkText: colors.uiLinkText || (light ? '#1D4ED8' : '#38BDF8'),
  }
}

function headerDefaults(colors: Partial<CustomThemeColors>) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(offset => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
    })
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
  }
  const background = luminance(colors.headerBg || DEFAULT_CUSTOM_COLORS.headerBg!)
  const contrast = (hex: string) => {
    const foreground = luminance(hex)
    return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05)
  }
  const safeColor = (candidate: string | undefined, light: string, dark: string) => {
    if (candidate && contrast(candidate) >= 4.5) return candidate
    if (contrast(light) >= 4.5) return light
    if (contrast(dark) >= 4.5) return dark
    return contrast('#FFFFFF') >= contrast('#000000') ? '#FFFFFF' : '#000000'
  }
  return {
    headerPrimaryText: colors.headerPrimaryText || safeColor(colors.uiPrimaryText, '#F1F5F9', '#111827'),
    headerSecondaryText: colors.headerSecondaryText || safeColor(colors.uiSecondaryText, '#CBD5E1', '#374151'),
    headerIconColor: colors.headerIconColor || safeColor(colors.iconColor, '#94A3B8', '#4B5563'),
  }
}

export function normalizeCustomThemeColors(
  colors?: Partial<CustomThemeColors> | null
): CustomThemeColors {
  if (!colors) return { ...DEFAULT_CUSTOM_COLORS, fonts: normalizeFontSettings(undefined) }
  return {
    ...DEFAULT_CUSTOM_COLORS,
    ...colors,
    ...typographyDefaults(colors),
    ...headerDefaults(colors),
    actionColor: colors.actionColor || colors.uiLinkText || '#2AA198',
    selectionColor: colors.selectionColor || colors.selectedCardBorder || '#2AA198',
    sectionIconColor: colors.sectionIconColor || colors.iconColor || '#2AA198',
    ...(colors.identity ? { identity: { factoryId: colors.identity.factoryId, displayName: colors.identity.displayName.trim() } } : {}),
    fonts: normalizeFontSettings(colors.fonts),
    bgHex: colors.bgHex || DEFAULT_CUSTOM_COLORS.bgHex,
    textHex: colors.textHex || DEFAULT_CUSTOM_COLORS.textHex,
    chordHex: colors.chordHex || DEFAULT_CUSTOM_COLORS.chordHex,
    sectionHex: colors.sectionHex || DEFAULT_CUSTOM_COLORS.sectionHex,
  }
}

const CANONICAL_PALETTE_KEY_ORDER: Array<keyof CustomThemeColors> = [
  'identity',
  'actionColor',
  'selectionColor',
  'sectionIconColor',
  'uiPrimaryText',
  'uiSecondaryText',
  'uiSectionText',
  'uiMutedText',
  'uiLinkText',
  'bgHex',
  'textHex',
  'chordHex',
  'sectionHex',
  'headerBg',
  'headerPrimaryText',
  'headerSecondaryText',
  'headerIconColor',
  'toolbarBg',
  'searchBg',
  'searchBorder',
  'filterBarBg',
  'iconColor',
  'setlistCardBg',
  'songCardBg',
  'cardBorder',
  'selectedCardBg',
  'selectedCardBorder',
  'buttonBg',
  'buttonText',
  'inputBg',
  'inputText',
  'inputBorder',
  'accentColor',
  'dockBg',
  'dockBorder',
  'dockBtnBg',
  'dockBtnIcon',
  'dockPlayBg',
  'dockPlayIcon',
  'fonts',
]

function canonicalizeThemePalette(raw: Partial<CustomThemeColors> | undefined, stripIdentity: boolean): CustomThemeColors {
  const normalized = normalizeCustomThemeColors(raw)
  const ordered: Record<string, unknown> = {}
  for (const key of CANONICAL_PALETTE_KEY_ORDER) {
    if (key === 'identity') {
      if (!stripIdentity && normalized.identity) {
        ordered.identity = {
          factoryId: normalized.identity.factoryId,
          displayName: normalized.identity.displayName.trim(),
        }
      }
    } else if (key === 'fonts') {
      ordered.fonts = normalizeFontSettings(normalized.fonts)
    } else if (normalized[key] !== undefined) {
      ordered[key] = normalized[key]
    }
  }
  return ordered as unknown as CustomThemeColors
}

export function validateBackupSettings(data: Record<string, unknown>): string[] {
  const errors: string[] = []
  if ('factoryThemeOverrides' in data) {
    const overrides = data.factoryThemeOverrides
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) errors.push('factoryThemeOverrides: must be an object')
    else for (const [id, palette] of Object.entries(overrides)) {
      const identity = (palette as CustomThemeColors | null)?.identity
      if (id === 'custom' || !THEME_MODES.includes(id as ThemeMode) || identity?.factoryId !== id) errors.push('factoryThemeOverrides: invalid factory slot')
      errors.push(...validateBackupSettings({ customThemeColors: palette }))
    }
  }
  if ('themeMode' in data && !THEME_MODES.includes(data.themeMode as ThemeMode)) errors.push('themeMode: unsupported theme')
  if ('customThemeColors' in data) {
    const colors = data.customThemeColors
    if (!colors || typeof colors !== 'object' || Array.isArray(colors)) errors.push('customThemeColors: must be a color object')
    else {
      const requiredFields = ['bgHex', 'textHex', 'chordHex', 'sectionHex']
      const optionalFields = [
        'headerPrimaryText', 'headerSecondaryText', 'headerIconColor',
        'headerBg', 'toolbarBg', 'searchBg', 'searchBorder', 'filterBarBg', 'iconColor',
        'setlistCardBg', 'songCardBg', 'cardBorder', 'selectedCardBg', 'selectedCardBorder',
        'buttonBg', 'buttonText', 'inputBg', 'inputText', 'inputBorder', 'accentColor',
        'dockBg', 'dockBorder', 'dockBtnBg', 'dockBtnIcon', 'dockPlayBg', 'dockPlayIcon',
        'actionColor', 'selectionColor', 'sectionIconColor',
        'uiPrimaryText', 'uiSecondaryText', 'uiSectionText', 'uiMutedText', 'uiLinkText',
      ]
      const allowedFields = new Set([...requiredFields, ...optionalFields])
      for (const field of requiredFields) {
        const color = (colors as Record<string, unknown>)[field]
        if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) errors.push(`customThemeColors.${field}: expected #RRGGBB`)
      }
      for (const [field, color] of Object.entries(colors)) {
        if (field === 'identity') {
          errors.push(...validateCustomThemeIdentity(color))
        } else if (field === 'fonts') {
          errors.push(...validateFontSettings(color))
        } else if (!allowedFields.has(field)) {
          errors.push(`customThemeColors.${field}: unknown color setting`)
        } else if (optionalFields.includes(field) && (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) {
          errors.push(`customThemeColors.${field}: expected #RRGGBB`)
        }
      }
    }
  }
  if ('stageSettings' in data) {
    const settings = data.stageSettings
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) errors.push('stageSettings: must be an object')
    else for (const [key, value] of Object.entries(settings)) {
      if (key === 'fontStyle') {
        if (!FONT_STYLES.includes(value)) errors.push('stageSettings.fontStyle: expected mono, sans or serif')
      } else if (key === 'isTwoColumn') {
        if (typeof value !== 'boolean') errors.push('stageSettings.isTwoColumn: must be a boolean')
      } else if (key === 'fontSizePx' || key === 'scrollSpeed') {
        const [min, max] = key === 'fontSizePx' ? [12, 38] : [5, 180]
        if (!Number.isSafeInteger(value) || value < min || value > max) errors.push(`stageSettings.${key}: must be an integer from ${min} to ${max}`)
      } else errors.push(`stageSettings.${key}: unknown setting`)
    }
  }
  return errors
}

export function validateCloudThemeSettings(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['themeSettings: must be an object']
  }
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return ['themeSettings: must be JSON serializable']
  }
  if (!serialized || serialized.length > MAX_CLOUD_THEME_SETTINGS_BYTES) {
    return [`themeSettings: exceeds maximum size of ${MAX_CLOUD_THEME_SETTINGS_BYTES} bytes`]
  }
  const obj = value as Record<string, unknown>
  const errors: string[] = []
  const allowedKeys = new Set(['version', 'themeMode', 'customThemeColors', 'factoryThemeOverrides'])
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      errors.push(`themeSettings.${key}: unsupported field`)
    }
  }
  if ('version' in obj && obj.version !== undefined && obj.version !== CLOUD_THEME_SETTINGS_VERSION) {
    errors.push('themeSettings.version: unsupported schema version')
  }
  const backupCandidate: Record<string, unknown> = {}
  if ('themeMode' in obj && obj.themeMode !== undefined) {
    backupCandidate.themeMode = obj.themeMode
  }
  if ('customThemeColors' in obj && obj.customThemeColors !== undefined) {
    backupCandidate.customThemeColors = obj.customThemeColors
  }
  if ('factoryThemeOverrides' in obj && obj.factoryThemeOverrides !== undefined) {
    backupCandidate.factoryThemeOverrides = obj.factoryThemeOverrides
  }
  errors.push(...validateBackupSettings(backupCandidate))
  return errors
}

export function normalizeCloudThemeSettings(raw: CloudThemeSettings | Partial<CloudThemeSettings>): CloudThemeSettings {
  const errors = validateCloudThemeSettings(raw)
  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }
  let mode: ThemeMode = raw.themeMode && THEME_MODES.includes(raw.themeMode) ? raw.themeMode : 'solarized-dark'
  const rawOverrides = raw.factoryThemeOverrides ?? {}
  const overridesMap = new Map<Exclude<ThemeMode, 'custom'>, CustomThemeColors>()
  for (const slotId of THEME_MODES) {
    if (slotId === 'custom') continue
    const palette = rawOverrides[slotId]
    if (palette) {
      overridesMap.set(slotId, canonicalizeThemePalette(palette, false))
    }
  }

  let standaloneSource: Partial<CustomThemeColors> | undefined = raw.customThemeColors
  if (raw.customThemeColors?.identity) {
    const slotId = raw.customThemeColors.identity.factoryId
    if (!overridesMap.has(slotId)) {
      overridesMap.set(slotId, canonicalizeThemePalette(raw.customThemeColors, false))
    }
    if (mode === 'custom') {
      mode = slotId
    }
    standaloneSource = DEFAULT_CUSTOM_COLORS
  }

  const sortedOverrides: FactoryThemeOverrides = {}
  for (const slotId of THEME_MODES) {
    if (slotId === 'custom') continue
    const palette = overridesMap.get(slotId)
    if (palette) {
      sortedOverrides[slotId] = palette
    }
  }

  return {
    version: CLOUD_THEME_SETTINGS_VERSION,
    themeMode: mode,
    customThemeColors: canonicalizeThemePalette(standaloneSource, true),
    factoryThemeOverrides: sortedOverrides,
  }
}

export function cloudThemeSettingsEquals(
  a?: CloudThemeSettings | null,
  b?: CloudThemeSettings | null
): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  try {
    return JSON.stringify(normalizeCloudThemeSettings(a)) === JSON.stringify(normalizeCloudThemeSettings(b))
  } catch {
    return false
  }
}

const DEFAULT_NORMALIZED_CLOUD_THEME_JSON = JSON.stringify(
  normalizeCloudThemeSettings({
    version: CLOUD_THEME_SETTINGS_VERSION,
    themeMode: 'solarized-dark',
    customThemeColors: DEFAULT_CUSTOM_COLORS,
    factoryThemeOverrides: {},
  })
)

export function isCustomizedThemeSettings(settings?: CloudThemeSettings | null): boolean {
  if (!settings) return false
  try {
    return JSON.stringify(normalizeCloudThemeSettings(settings)) !== DEFAULT_NORMALIZED_CLOUD_THEME_JSON
  } catch {
    return false
  }
}

export function readCloudThemeSettings(storage: Pick<Storage, 'getItem'> = localStorage): CloudThemeSettings | undefined {
  const rawMode = storage.getItem(SETTINGS_KEYS.themeMode)
  const rawColors = storage.getItem(SETTINGS_KEYS.customThemeColors)
  const rawOverrides = storage.getItem(SETTINGS_KEYS.factoryThemeOverrides)
  const rawStandalone = storage.getItem(STANDALONE_PALETTE_KEY)

  if (rawMode === null && rawColors === null && rawOverrides === null && rawStandalone === null) {
    return undefined
  }

  let parsedColors: CustomThemeColors | undefined
  if (rawColors !== null) {
    try {
      parsedColors = JSON.parse(rawColors) as CustomThemeColors
    } catch {
      throw new Error('customThemeColors: malformed JSON in local storage')
    }
  }

  let parsedOverrides: FactoryThemeOverrides | undefined
  if (rawOverrides !== null) {
    try {
      parsedOverrides = JSON.parse(rawOverrides) as FactoryThemeOverrides
    } catch {
      throw new Error('factoryThemeOverrides: malformed JSON in local storage')
    }
  }

  let parsedStandalone: CustomThemeColors | undefined
  if (rawStandalone !== null) {
    try {
      parsedStandalone = JSON.parse(rawStandalone) as CustomThemeColors
    } catch {
      throw new Error('standaloneCustomThemeColors: malformed JSON in local storage')
    }
    const standaloneErrors = validateBackupSettings({ customThemeColors: parsedStandalone })
    if (standaloneErrors.length > 0 || parsedStandalone?.identity) {
      throw new Error(standaloneErrors[0] || 'standaloneCustomThemeColors: must not carry factory identity')
    }
  }

  const candidate: Partial<CloudThemeSettings> = {
    version: CLOUD_THEME_SETTINGS_VERSION,
    ...(rawMode !== null ? { themeMode: rawMode as ThemeMode } : {}),
    ...(parsedColors !== undefined ? { customThemeColors: parsedColors } : parsedStandalone !== undefined ? { customThemeColors: parsedStandalone } : {}),
    ...(parsedOverrides !== undefined ? { factoryThemeOverrides: parsedOverrides } : {}),
  }

  const normalized = normalizeCloudThemeSettings(candidate)
  if (parsedColors?.identity && parsedStandalone !== undefined) {
    return {
      ...normalized,
      customThemeColors: canonicalizeThemePalette(parsedStandalone, true),
    }
  }
  return normalized
}

export function tryReadCloudThemeSettings(storage: Pick<Storage, 'getItem'> = localStorage): CloudThemeSettings | undefined {
  try {
    return readCloudThemeSettings(storage)
  } catch {
    return undefined
  }
}

function applyCloudThemePaletteToDocument(mode: ThemeMode, colors: CustomThemeColors): void {
  if (typeof document === 'undefined') return
  if (document.body) {
    document.body.classList.remove(...THEME_MODES.map(theme => `theme-${theme}`))
    document.body.classList.add('theme-custom')
    document.body.dataset.theme = mode
  }
  const root = document.documentElement
  if (!root || !root.style) return
  applyFontSettings(colors.fonts, root)
  for (const [key, value] of Object.entries({
    ...typographyDefaults(colors),
    ...headerDefaults(colors),
    actionColor: colors.actionColor!,
    selectionColor: colors.selectionColor!,
    sectionIconColor: colors.sectionIconColor!,
  })) {
    root.style.setProperty('--custom-' + key, value)
  }
  root.style.setProperty('--custom-stage-bg', colors.bgHex)
  root.style.setProperty('--custom-stage-text', colors.textHex)
  root.style.setProperty('--custom-stage-chord', colors.chordHex)
  root.style.setProperty('--custom-stage-section', colors.sectionHex)
  root.style.setProperty('--custom-chrome-header-bg', colors.headerBg || DEFAULT_CUSTOM_COLORS.headerBg!)
  root.style.setProperty('--custom-chrome-toolbar-bg', colors.toolbarBg || DEFAULT_CUSTOM_COLORS.toolbarBg!)
  root.style.setProperty('--custom-chrome-search-bg', colors.searchBg || DEFAULT_CUSTOM_COLORS.searchBg!)
  root.style.setProperty('--custom-chrome-search-border', colors.searchBorder || DEFAULT_CUSTOM_COLORS.searchBorder!)
  root.style.setProperty('--custom-chrome-filter-bg', colors.filterBarBg || DEFAULT_CUSTOM_COLORS.filterBarBg!)
  root.style.setProperty('--custom-chrome-icon', colors.iconColor || DEFAULT_CUSTOM_COLORS.iconColor!)
  root.style.setProperty('--custom-card-setlist-bg', colors.setlistCardBg || DEFAULT_CUSTOM_COLORS.setlistCardBg!)
  root.style.setProperty('--custom-card-song-bg', colors.songCardBg || DEFAULT_CUSTOM_COLORS.songCardBg!)
  root.style.setProperty('--custom-card-border', colors.cardBorder || DEFAULT_CUSTOM_COLORS.cardBorder!)
  root.style.setProperty('--custom-card-selected-bg', colors.selectedCardBg || DEFAULT_CUSTOM_COLORS.selectedCardBg!)
  root.style.setProperty('--custom-card-selected-border', colors.selectedCardBorder || DEFAULT_CUSTOM_COLORS.selectedCardBorder!)
  root.style.setProperty('--custom-control-button-bg', colors.buttonBg || DEFAULT_CUSTOM_COLORS.buttonBg!)
  root.style.setProperty('--custom-control-button-text', colors.buttonText || DEFAULT_CUSTOM_COLORS.buttonText!)
  root.style.setProperty('--custom-control-input-bg', colors.inputBg || DEFAULT_CUSTOM_COLORS.inputBg!)
  root.style.setProperty('--custom-control-input-text', colors.inputText || DEFAULT_CUSTOM_COLORS.inputText!)
  root.style.setProperty('--custom-control-input-border', colors.inputBorder || DEFAULT_CUSTOM_COLORS.inputBorder!)
  root.style.setProperty('--custom-control-accent', colors.accentColor || DEFAULT_CUSTOM_COLORS.accentColor!)
  root.style.setProperty('--custom-dock-bg', colors.dockBg || DEFAULT_CUSTOM_COLORS.dockBg!)
  root.style.setProperty('--custom-dock-border', colors.dockBorder || DEFAULT_CUSTOM_COLORS.dockBorder!)
  root.style.setProperty('--custom-dock-btn-bg', colors.dockBtnBg || DEFAULT_CUSTOM_COLORS.dockBtnBg!)
  root.style.setProperty('--custom-dock-btn-icon', colors.dockBtnIcon || DEFAULT_CUSTOM_COLORS.dockBtnIcon!)
  root.style.setProperty('--custom-dock-play-bg', colors.dockPlayBg || DEFAULT_CUSTOM_COLORS.dockPlayBg!)
  root.style.setProperty('--custom-dock-play-icon', colors.dockPlayIcon || DEFAULT_CUSTOM_COLORS.dockPlayIcon!)
}

export function persistCloudThemeSettings(
  settings: CloudThemeSettings,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage
): CloudThemeSettings {
  const normalized = normalizeCloudThemeSettings(settings)
  const prevOverrides = storage.getItem(SETTINGS_KEYS.factoryThemeOverrides)
  const prevColors = storage.getItem(SETTINGS_KEYS.customThemeColors)
  const prevMode = storage.getItem(SETTINGS_KEYS.themeMode)
  const prevStandalone = storage.getItem(STANDALONE_PALETTE_KEY)

  const nextOverridesRaw = JSON.stringify(normalized.factoryThemeOverrides ?? {})
  const nextColorsRaw = JSON.stringify(normalized.customThemeColors ?? canonicalizeThemePalette(DEFAULT_CUSTOM_COLORS, true))
  const nextModeRaw = normalized.themeMode ?? 'solarized-dark'

  const restoreKey = (key: string, prev: string | null) => {
    try {
      if (prev === null) {
        if (typeof storage.removeItem === 'function') storage.removeItem(key)
      } else {
        storage.setItem(key, prev)
      }
    } catch { /* Best-effort rollback */ }
  }

  try {
    storage.setItem(SETTINGS_KEYS.factoryThemeOverrides, nextOverridesRaw)
    storage.setItem(SETTINGS_KEYS.customThemeColors, nextColorsRaw)
    storage.setItem(SETTINGS_KEYS.themeMode, nextModeRaw)
    if (prevStandalone !== null && typeof storage.removeItem === 'function') {
      storage.removeItem(STANDALONE_PALETTE_KEY)
    }
    if (
      storage.getItem(SETTINGS_KEYS.factoryThemeOverrides) !== nextOverridesRaw ||
      storage.getItem(SETTINGS_KEYS.customThemeColors) !== nextColorsRaw ||
      storage.getItem(SETTINGS_KEYS.themeMode) !== nextModeRaw
    ) {
      throw new Error('Theme settings save could not be verified in localStorage')
    }
  } catch (err) {
    restoreKey(SETTINGS_KEYS.factoryThemeOverrides, prevOverrides)
    restoreKey(SETTINGS_KEYS.customThemeColors, prevColors)
    restoreKey(SETTINGS_KEYS.themeMode, prevMode)
    restoreKey(STANDALONE_PALETTE_KEY, prevStandalone)
    throw err
  }

  const activePalette =
    nextModeRaw === 'custom'
      ? normalized.customThemeColors!
      : normalized.factoryThemeOverrides?.[nextModeRaw as Exclude<ThemeMode, 'custom'>] ?? normalized.customThemeColors!
  applyCloudThemePaletteToDocument(nextModeRaw, activePalette)

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    const Evt = typeof window.Event === 'function' ? window.Event : Event
    window.dispatchEvent(new Evt(SETTINGS_CHANGED))
  }

  return normalized
}

export function readBackupSettings(storage: Pick<Storage, 'getItem'> = localStorage): BackupSettings {
  const data: Record<string, unknown> = {}
  const theme = storage.getItem(SETTINGS_KEYS.themeMode)
  const colors = storage.getItem(SETTINGS_KEYS.customThemeColors)
  if (theme !== null) data.themeMode = theme
  if (colors !== null) data.customThemeColors = JSON.parse(colors)
  const overrides = storage.getItem(SETTINGS_KEYS.factoryThemeOverrides)
  if (overrides !== null) data.factoryThemeOverrides = JSON.parse(overrides)
  const stage: Record<string, unknown> = {}
  for (const key of ['fontStyle', 'fontSizePx', 'scrollSpeed', 'isTwoColumn'] as const) {
    const value = storage.getItem(SETTINGS_KEYS[key])
    if (value !== null) stage[key] = key === 'fontStyle' ? value : JSON.parse(value)
  }
  if (Object.keys(stage).length) data.stageSettings = stage
  const errors = validateBackupSettings(data)
  if (errors.length) throw new Error(errors.join('\n'))
  return data as BackupSettings
}

export function restoreBackupSettings(settings: BackupSettings, storage: Pick<Storage, 'setItem'> = localStorage) {
  // Validate the whole object first; never write a valid prefix of malformed settings.
  const errors = validateBackupSettings(settings as Record<string, unknown>)
  if (errors.length) throw new Error(errors.join('\n'))
  if (settings.factoryThemeOverrides !== undefined) storage.setItem(SETTINGS_KEYS.factoryThemeOverrides, JSON.stringify(settings.factoryThemeOverrides))
  if (settings.themeMode !== undefined) storage.setItem(SETTINGS_KEYS.themeMode, settings.themeMode)
  if (settings.customThemeColors !== undefined) storage.setItem(SETTINGS_KEYS.customThemeColors, JSON.stringify(settings.customThemeColors))
  for (const [key, value] of Object.entries(settings.stageSettings ?? {})) {
    storage.setItem(SETTINGS_KEYS[key as keyof typeof settings.stageSettings], String(value))
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    const Evt = typeof window.Event === 'function' ? window.Event : Event
    window.dispatchEvent(new Evt(SETTINGS_CHANGED))
  }
}

/*
 * #251 Cloud V2 P0: backup schema v2 settings. Every field maps to exactly one existing runtime
 * storage key with the same encoding the app already uses, so a restore is read back by the
 * running code unchanged. `appearance` is a superset of the v1 settings (theme, palettes, stage
 * text and scroll speed); `preferences` are songbook/UI behaviour. Device and session state
 * (auth, band-sync addresses, cast, dock position, recovery, sync journals, debug logs, backup
 * status) is never part of a backup.
 */
export const BACKUP_SETTINGS_GROUPS = ['appearance', 'preferences'] as const
export type BackupSettingsGroup = typeof BACKUP_SETTINGS_GROUPS[number]

interface ExtraSettingSpec {
  key: string
  /** Stored string → value, or undefined when the stored value is not one the app would use. */
  read(raw: string): unknown
  write(value: unknown): string
  validate(value: unknown): boolean
}
const enumSetting = (key: string, values: readonly string[]): ExtraSettingSpec => ({
  key, read: raw => values.includes(raw) ? raw : undefined, write: String,
  validate: value => typeof value === 'string' && values.includes(value),
})
const textBoolSetting = (key: string): ExtraSettingSpec => ({
  key, read: raw => raw === 'true' ? true : raw === 'false' ? false : undefined, write: String,
  validate: value => typeof value === 'boolean',
})
const STAGE_CHORD_SCALES = [1, 1.1, 1.2, 1.3]
const isPalette = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value) &&
  !('identity' in value) && validateBackupSettings({ customThemeColors: value }).length === 0
const parseJson = (raw: string): unknown => { try { return JSON.parse(raw) } catch { return undefined } }

/** v2-only appearance fields (the v1 fields are handled by validateBackupSettings/SETTINGS_KEYS). */
export const APPEARANCE_EXTRA_SETTINGS = {
  standaloneCustomThemeColors: { key: STANDALONE_PALETTE_KEY, read: raw => { const v = parseJson(raw); return isPalette(v) ? v : undefined },
    write: value => JSON.stringify(value), validate: isPalette },
  chordScale: { key: 'gtar_stage_chord_scale', read: raw => { const v = parseFloat(raw); return STAGE_CHORD_SCALES.includes(v) ? v : undefined },
    write: String, validate: value => typeof value === 'number' && STAGE_CHORD_SCALES.includes(value) },
  fontWeight: enumSetting('gtar_stage_font_weight', ['regular', 'medium', 'bold']),
  lineSpacing: enumSetting('gtar_stage_line_spacing', ['compact', 'normal', 'relaxed']),
  notation: enumSetting('gtar_stage_notation', ['chords', 'numbers']),
  tvFontSize: { key: 'gtar_tv_font_size', read: raw => { const v = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN; return v >= 20 && v <= 56 ? v : undefined },
    write: String, validate: value => Number.isSafeInteger(value) && (value as number) >= 20 && (value as number) <= 56 },
} satisfies Record<string, ExtraSettingSpec>

export const PREFERENCE_SETTINGS = {
  edgeSwipePanel: { key: 'gtar_edge_swipe_panel', read: raw => { const v = parseJson(raw); return typeof v === 'boolean' ? v : undefined },
    write: value => JSON.stringify(value), validate: value => typeof value === 'boolean' },
  songbookSort: enumSetting('gtar_songbook_sort', ['title', 'artist', 'date']),
  songbookFilterMetadata: enumSetting('gtar_songbook_filter_metadata', ['ALL', 'METADATA_OK', 'NEEDS_METADATA']),
  songbookFilterSetlist: { key: 'gtar_songbook_filter_setlist', read: raw => raw.trim() && raw.length <= 200 ? raw : undefined,
    write: String, validate: value => typeof value === 'string' && !!value.trim() && value.length <= 200 },
  songbookSetlistsCollapsed: textBoolSetting('gtar_songbook_setlists_collapsed'),
  songbookSongsCollapsed: textBoolSetting('gtar_songbook_songs_collapsed'),
} satisfies Record<string, ExtraSettingSpec>

export type AppearanceExtraField = keyof typeof APPEARANCE_EXTRA_SETTINGS
export type PreferenceField = keyof typeof PREFERENCE_SETTINGS
export interface AppearanceSettings extends BackupSettings {
  standaloneCustomThemeColors?: CustomThemeColors
  chordScale?: number
  fontWeight?: 'regular' | 'medium' | 'bold'
  lineSpacing?: 'compact' | 'normal' | 'relaxed'
  notation?: 'chords' | 'numbers'
  tvFontSize?: number
}
export interface PreferenceSettings {
  edgeSwipePanel?: boolean
  songbookSort?: 'title' | 'artist' | 'date'
  songbookFilterMetadata?: 'ALL' | 'METADATA_OK' | 'NEEDS_METADATA'
  songbookFilterSetlist?: string
  songbookSetlistsCollapsed?: boolean
  songbookSongsCollapsed?: boolean
}
export interface BackupSettingsV2 { appearance: AppearanceSettings; preferences: PreferenceSettings }
export interface SettingsRestoreChoice { appearance: boolean; preferences: boolean }
/** Recommended defaults (#251; not owner-approved): restore appearance, keep this device's preferences. */
export const DEFAULT_SETTINGS_RESTORE_CHOICE: SettingsRestoreChoice = { appearance: true, preferences: false }

const LEGACY_SETTING_FIELDS = ['themeMode', 'customThemeColors', 'factoryThemeOverrides', 'stageSettings'] as const
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Every storage key a v2 settings restore may write (and nothing else). */
export function backupSettingsStorageKeys(): string[] {
  return [...Object.values(SETTINGS_KEYS), ...Object.values(APPEARANCE_EXTRA_SETTINGS).map(s => s.key), ...Object.values(PREFERENCE_SETTINGS).map(s => s.key)]
}

/** Validates a v2 `settings` object; unknown groups or fields are errors (never silently dropped). */
export function validateBackupSettingsV2(value: unknown): string[] {
  if (!isObject(value)) return ['settings: must be an object']
  const errors: string[] = []
  for (const group of Object.keys(value)) if (!BACKUP_SETTINGS_GROUPS.includes(group as BackupSettingsGroup)) errors.push(`settings.${group}: unknown settings group`)
  const appearance = value.appearance
  if (appearance !== undefined) {
    if (!isObject(appearance)) errors.push('settings.appearance: must be an object')
    else {
      const legacy: Record<string, unknown> = {}
      for (const [field, item] of Object.entries(appearance)) {
        if ((LEGACY_SETTING_FIELDS as readonly string[]).includes(field)) legacy[field] = item
        else if (field in APPEARANCE_EXTRA_SETTINGS) {
          if (!APPEARANCE_EXTRA_SETTINGS[field as AppearanceExtraField].validate(item)) errors.push(`settings.appearance.${field}: invalid value`)
        } else errors.push(`settings.appearance.${field}: unknown setting`)
      }
      errors.push(...validateBackupSettings(legacy).map(error => `settings.appearance.${error}`))
    }
  }
  const preferences = value.preferences
  if (preferences !== undefined) {
    if (!isObject(preferences)) errors.push('settings.preferences: must be an object')
    else for (const [field, item] of Object.entries(preferences)) {
      if (!(field in PREFERENCE_SETTINGS)) errors.push(`settings.preferences.${field}: unknown setting`)
      else if (!PREFERENCE_SETTINGS[field as PreferenceField].validate(item)) errors.push(`settings.preferences.${field}: invalid value`)
    }
  }
  return errors
}

/** v1 settings (top-level fields) are all appearance in v2. */
export function settingsFromLegacy(settings: BackupSettings): BackupSettingsV2 {
  const appearance: AppearanceSettings = {}
  for (const field of LEGACY_SETTING_FIELDS) if (settings[field] !== undefined) Object.assign(appearance, { [field]: settings[field] })
  return { appearance, preferences: {} }
}

/** Reads every backed-up setting. v1 fields throw on malformed storage (as before); v2-only fields the app would ignore are skipped. */
export function readBackupSettingsV2(storage: Pick<Storage, 'getItem'> = localStorage): BackupSettingsV2 {
  const appearance: AppearanceSettings = { ...readBackupSettings(storage) }
  for (const [field, spec] of Object.entries(APPEARANCE_EXTRA_SETTINGS)) {
    const raw = storage.getItem(spec.key)
    const value = raw === null ? undefined : spec.read(raw)
    if (value !== undefined) Object.assign(appearance, { [field]: value })
  }
  const preferences: PreferenceSettings = {}
  for (const [field, spec] of Object.entries(PREFERENCE_SETTINGS)) {
    const raw = storage.getItem(spec.key)
    const value = raw === null ? undefined : spec.read(raw)
    if (value !== undefined) Object.assign(preferences, { [field]: value })
  }
  return { appearance, preferences }
}

/** Stage typography fields for live reload after a restore. */
export function readStageAppearanceExtras(storage: Pick<Storage, 'getItem'> = localStorage): Pick<AppearanceSettings, 'chordScale' | 'fontWeight' | 'lineSpacing' | 'notation'> {
  const out: Record<string, unknown> = {}
  for (const field of ['chordScale', 'fontWeight', 'lineSpacing', 'notation'] as const) {
    try {
      const raw = storage.getItem(APPEARANCE_EXTRA_SETTINGS[field].key)
      const value = raw === null ? undefined : APPEARANCE_EXTRA_SETTINGS[field].read(raw)
      if (value !== undefined) out[field] = value
    } catch { /* storage unavailable */ }
  }
  return out
}

export interface SettingsRestoreResult { written: string[]; groups: BackupSettingsGroup[] }

/**
 * #251 F2 / #257: previous values of exactly the keys a settings restore is about to write.
 *
 * Lifecycle (all mutations run under the cross-tab Web Lock SETTINGS_RESTORE_LOCK):
 * - `pending`: written and verified before the first settings write. Still present after a crash,
 *   a closed tab or a failed put-back → the restore did not finish; "Put back previous settings".
 * - `committed`: every settings write was verified but removing the copy failed, so the copy is
 *   re-marked as belonging to a finished restore. Putting it back would undo that restore.
 * - removed: after a verified success, a verified rollback, or a verified put-back of every key.
 * While any copy exists, no new settings restore may start (it would replace the only copy).
 * Each copy carries a random `owner`; removals compare the exact stored bytes, so a stale
 * operation can never delete or replace another operation's copy.
 */
export const SETTINGS_RESTORE_SNAPSHOT_KEY = 'gtar_settings_restore_snapshot_v1'
export const SETTINGS_RESTORE_LOCK = 'gtar-settings-restore'
export interface SettingsRestoreSnapshot {
  v: 2
  at: string
  /** Random id of the restore that wrote this copy. */
  owner: string
  /** Exact key inventory, sorted; `values` has exactly these keys (null = the key was absent). */
  keys: string[]
  values: Record<string, string | null>
  /** Set when every write of that restore was verified (cleanup of this copy failed). */
  committedAt?: string
  /** c53 over { keys, values, owner, committedAt }: a truncated, emptied or edited copy does not match. */
  fingerprint: string
}
export type SettingsRecoveryState =
  | { state: 'none' }
  | { state: 'pending'; snapshot: SettingsRestoreSnapshot; raw: string }
  | { state: 'committed'; snapshot: SettingsRestoreSnapshot; raw: string }
  | { state: 'invalid'; raw: string; reason: string }

const snapshotFingerprint = (s: Pick<SettingsRestoreSnapshot, 'keys' | 'values' | 'owner' | 'committedAt'>) =>
  `c53:${cyrb53(stableStringify({ keys: s.keys, values: s.values, owner: s.owner, committedAt: s.committedAt ?? null }))}`

const randomOwner = () => {
  try { if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID() } catch { /* fallback */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

export function makeSettingsRestoreSnapshot(values: Record<string, string | null>, now = new Date(), owner = randomOwner()): SettingsRestoreSnapshot {
  const keys = Object.keys(values).sort()
  const ordered = Object.fromEntries(keys.map(key => [key, values[key]]))
  return { v: 2, at: now.toISOString(), owner, keys, values: ordered, fingerprint: snapshotFingerprint({ keys, values: ordered, owner }) }
}
function committedCopy(snapshot: SettingsRestoreSnapshot, now = new Date()): SettingsRestoreSnapshot {
  const next = { ...snapshot, committedAt: now.toISOString() }
  return { ...next, fingerprint: snapshotFingerprint(next) }
}

/** Why a stored snapshot cannot be trusted, or null when it is complete and consistent. */
function snapshotProblem(value: unknown): string | null {
  if (!isObject(value)) return 'not an object'
  if (value.v !== 2) return `unsupported version ${String(value.v)}`
  if (typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at))) return 'missing or invalid time'
  if (typeof value.owner !== 'string' || !value.owner) return 'missing owner'
  if (value.committedAt !== undefined && (typeof value.committedAt !== 'string' || !Number.isFinite(Date.parse(value.committedAt)))) return 'invalid commit time'
  if (!Array.isArray(value.keys) || !value.keys.length) return 'missing or empty key inventory'
  if (!isObject(value.values)) return 'missing values'
  const keys = value.keys as unknown[]
  const allowed = new Set(backupSettingsStorageKeys())
  if (keys.some(key => typeof key !== 'string' || !allowed.has(key))) return 'key inventory contains a key that is not a backup setting'
  if (new Set(keys).size !== keys.length || [...keys].sort().join('\n') !== keys.join('\n')) return 'key inventory is not a sorted set'
  const valueKeys = Object.keys(value.values).sort()
  if (valueKeys.join('\n') !== (keys as string[]).join('\n')) return 'values do not match the key inventory'
  if (Object.values(value.values).some(v => v !== null && typeof v !== 'string')) return 'a value is neither text nor absent'
  if (typeof value.fingerprint !== 'string' || value.fingerprint !== snapshotFingerprint(value as unknown as SettingsRestoreSnapshot)) return 'fingerprint does not match (truncated or edited)'
  return null
}

/** Inspects the previous-settings copy without changing anything. */
export function inspectSettingsRecovery(storage: Pick<Storage, 'getItem'> = localStorage): SettingsRecoveryState {
  let raw: string | null
  try { raw = storage.getItem(SETTINGS_RESTORE_SNAPSHOT_KEY) } catch (error) { return { state: 'invalid', raw: '', reason: `could not be read (${errorText(error)})` } }
  if (raw === null) return { state: 'none' }
  let value: unknown
  try { value = JSON.parse(raw) } catch { return { state: 'invalid', raw, reason: 'not valid JSON (truncated or damaged)' } }
  const problem = snapshotProblem(value)
  if (problem) return { state: 'invalid', raw, reason: problem }
  const snapshot = value as SettingsRestoreSnapshot
  return snapshot.committedAt ? { state: 'committed', snapshot, raw } : { state: 'pending', snapshot, raw }
}

/** A complete, verified copy (pending or committed), or null (absent or untrustworthy). */
export function readSettingsRestoreSnapshot(storage: Pick<Storage, 'getItem'> = localStorage): SettingsRestoreSnapshot | null {
  const recovery = inspectSettingsRecovery(storage)
  return recovery.state === 'pending' || recovery.state === 'committed' ? recovery.snapshot : null
}

export type SettingsRestoreFailure = 'unavailable' | 'busy' | 'stale' | 'snapshot' | 'blocked' | 'rolled-back' | 'partial'
/**
 * `unavailable`: exclusive cross-tab access (Web Locks) cannot be guaranteed; nothing was written.
 * `busy`: another tab holds the settings lock; nothing was written.
 * `stale`: the copy on the device is not the one the user was shown (replaced or changed); nothing was written.
 * `snapshot`: the copy of current settings could not be saved and verified; nothing was written.
 * `blocked`: an earlier copy (unfinished, finished-but-kept, or damaged) exists; nothing was written.
 * `rolled-back`: a write failed and every key was put back and read back as before.
 * `partial`: a write failed and putting the old values back also failed; the verified copy
 * (SETTINGS_RESTORE_SNAPSHOT_KEY) still holds them for restorePreviousSettings().
 */
export class SettingsRestoreError extends Error {
  readonly state: SettingsRestoreFailure
  readonly failedKey?: string
  readonly unresolvedKeys: string[]
  constructor(state: SettingsRestoreFailure, message: string, options: { cause?: unknown; failedKey?: string; unresolvedKeys?: string[] } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'SettingsRestoreError'
    this.state = state
    this.failedKey = options.failedKey
    this.unresolvedKeys = options.unresolvedKeys ?? []
  }
}
export const isSettingsRestoreError = (error: unknown): error is SettingsRestoreError => error instanceof SettingsRestoreError

type SettingsStorage = Pick<Storage, 'setItem' | 'getItem' | 'removeItem'>
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

/** The subset of the Web Locks API used here (navigator.locks, or an injected equivalent). */
export interface SettingsLockManager {
  request<T>(name: string, options: { mode: 'exclusive'; ifAvailable: true }, callback: (lock: unknown) => T | Promise<T>): Promise<T>
}
export interface SettingsLockOptions {
  /** Defaults to navigator.locks. null = no lock manager (settings are then never changed). */
  locks?: SettingsLockManager | null
}
function defaultLocks(): SettingsLockManager | null {
  try {
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: SettingsLockManager }).locks : undefined
    return locks && typeof locks.request === 'function' ? locks : null
  } catch { return null }
}

/**
 * Runs `fn` while holding the exclusive cross-tab settings lock (ifAvailable: never waits behind
 * another tab). A tab that closes or crashes releases its Web Lock; a copy it left behind stays
 * and is reported as unfinished. Without Web Locks nothing runs: settings are left unchanged.
 */
async function withSettingsLock<T>(options: SettingsLockOptions | undefined, fn: () => T): Promise<T> {
  const locks = options?.locks === undefined ? defaultLocks() : options.locks
  if (!locks) throw new SettingsRestoreError('unavailable', 'this browser cannot make sure only one GTAR tab changes settings at a time (Web Locks unavailable); no setting was changed')
  let ran = false
  try {
    return await locks.request(SETTINGS_RESTORE_LOCK, { mode: 'exclusive', ifAvailable: true }, lock => {
      if (!lock) throw new SettingsRestoreError('busy', 'another GTAR tab is changing settings right now; try again when it has finished. No setting was changed')
      ran = true
      return fn()
    })
  } catch (error) {
    if (ran || error instanceof SettingsRestoreError) throw error
    throw new SettingsRestoreError('unavailable', `the settings lock could not be taken (${errorText(error)}); no setting was changed`, { cause: error })
  }
}

/** Puts one key back to its previous value (absent → removed) and reads it back. */
function putBack(storage: SettingsStorage, key: string, previous: string | null): boolean {
  try {
    if (previous === null) storage.removeItem(key)
    else storage.setItem(key, previous)
    return storage.getItem(key) === previous
  } catch { return false }
}

/** Removes the copy only when it is still exactly the bytes this operation verified. */
function clearSnapshot(storage: SettingsStorage, expectedRaw: string): boolean {
  try {
    if (storage.getItem(SETTINGS_RESTORE_SNAPSHOT_KEY) !== expectedRaw) return false
    storage.removeItem(SETTINGS_RESTORE_SNAPSHOT_KEY)
    return storage.getItem(SETTINGS_RESTORE_SNAPSHOT_KEY) === null
  } catch { return false }
}

function settingsChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    const Evt = typeof window.Event === 'function' ? window.Event : Event
    window.dispatchEvent(new Evt(SETTINGS_CHANGED))
  }
}

export interface PreviousSettingsResult { unresolved: string[]; cleared: boolean }
/**
 * Puts back every key of a valid copy (pending, or committed = undo the finished restore) and
 * reads each one back, under the settings lock. The copy is removed only when every key is
 * verified; otherwise it is left exactly as it was. A missing, truncated, emptied or edited copy
 * is refused before anything is written.
 */
export function restorePreviousSettings(storage: SettingsStorage, options: SettingsLockOptions & {
  /** Exact bytes of the copy the user was shown and agreed to put back (#257: consent is for that copy only). */
  expectedRaw: string
}): Promise<PreviousSettingsResult> {
  return withSettingsLock(options, () => {
    const recovery = inspectSettingsRecovery(storage)
    if (recovery.state === 'none') throw new Error('No previous-settings copy on this device')
    // Checked under the lock, before any write: a copy replaced or changed since it was shown is never applied.
    if (recovery.raw !== options.expectedRaw) {
      throw new SettingsRestoreError('stale', 'the saved settings copy changed since it was shown (another tab or restore replaced it); nothing was changed. Review the current copy and choose again')
    }
    if (recovery.state === 'invalid') throw new Error(`Previous-settings copy is not usable: ${recovery.reason}. Nothing was changed.`)
    const { snapshot, raw } = recovery
    const unresolved = snapshot.keys.filter(key => !putBack(storage, key, snapshot.values[key]))
    const cleared = unresolved.length === 0 && clearSnapshot(storage, raw)
    settingsChanged()
    return { unresolved, cleared }
  })
}

/** Explicit user choice only: removes the copy whose exact bytes the user was shown. No setting changes. */
export function discardSettingsRecovery(expectedRaw: string, storage: SettingsStorage = localStorage, options?: SettingsLockOptions): Promise<boolean> {
  return withSettingsLock(options, () => clearSnapshot(storage, expectedRaw))
}

export type RecoveryCopyOutcome = 'removed' | 'kept-committed' | 'stale'
export interface SettingsRestoreResult {
  written: string[]
  groups: BackupSettingsGroup[]
  /**
   * After a verified success: the pre-restore copy was removed; or its removal failed and it was
   * re-marked as belonging to this finished restore (`kept-committed`); or neither could be done
   * (`stale`: it will show as unfinished, and putting it back would undo this restore).
   */
  recoveryCopy?: RecoveryCopyOutcome
}

function blockedMessage(existing: Exclude<SettingsRecoveryState, { state: 'none' }>): string {
  if (existing.state === 'pending') return 'an earlier settings restore did not finish; put back the previous settings first. No setting was changed'
  if (existing.state === 'committed') return 'a copy of the settings from before the last restore is still kept; keep the current settings or undo that restore first. No setting was changed'
  return `previous-settings recovery data is damaged (${existing.reason}); review it first. No setting was changed`
}

/**
 * Restores only the chosen groups and only fields present in the backup; every other key on the
 * device is left as it is. Runs under the exclusive cross-tab settings lock. Validates everything
 * first, saves and verifies an owned copy of the previous values of exactly the keys it will
 * write, writes each key and reads it back. If a write fails, every key is put back and read back
 * (`rolled-back`); if that also fails, the copy stays for restorePreviousSettings() (`partial`).
 */
export async function restoreBackupSettingsV2(settings: BackupSettingsV2, choice: SettingsRestoreChoice,
  storage: SettingsStorage = localStorage, options?: SettingsLockOptions): Promise<SettingsRestoreResult> {
  const errors = validateBackupSettingsV2(settings)
  if (errors.length) throw new Error(errors.join('\n'))
  const writes: Array<[string, string]> = []
  const groups: BackupSettingsGroup[] = []
  if (choice.appearance) {
    const a = settings.appearance ?? {}
    // v1 order kept: overrides, mode, active palette, stage.
    if (a.factoryThemeOverrides !== undefined) writes.push([SETTINGS_KEYS.factoryThemeOverrides, JSON.stringify(a.factoryThemeOverrides)])
    if (a.themeMode !== undefined) writes.push([SETTINGS_KEYS.themeMode, a.themeMode])
    if (a.customThemeColors !== undefined) writes.push([SETTINGS_KEYS.customThemeColors, JSON.stringify(a.customThemeColors)])
    for (const [key, value] of Object.entries(a.stageSettings ?? {})) writes.push([SETTINGS_KEYS[key as keyof NonNullable<BackupSettings['stageSettings']>], String(value)])
    for (const [field, spec] of Object.entries(APPEARANCE_EXTRA_SETTINGS)) {
      const value = (a as Record<string, unknown>)[field]
      if (value !== undefined) writes.push([spec.key, spec.write(value)])
    }
    groups.push('appearance')
  }
  if (choice.preferences) {
    const p = settings.preferences ?? {}
    for (const [field, spec] of Object.entries(PREFERENCE_SETTINGS)) {
      const value = (p as Record<string, unknown>)[field]
      if (value !== undefined) writes.push([spec.key, spec.write(value)])
    }
    groups.push('preferences')
  }
  if (!writes.length) return { written: [], groups }

  return withSettingsLock(options, () => {
    // Under the lock: no other tab can create, replace or remove a copy between this check and the write.
    const existing = inspectSettingsRecovery(storage)
    if (existing.state !== 'none') throw new SettingsRestoreError('blocked', blockedMessage(existing))
    const previous: Record<string, string | null> = {}
    let snapshot: SettingsRestoreSnapshot
    let snapshotRaw = ''
    try {
      for (const [key] of writes) previous[key] = storage.getItem(key)
      snapshot = makeSettingsRestoreSnapshot(previous)
      snapshotRaw = JSON.stringify(snapshot)
      storage.setItem(SETTINGS_RESTORE_SNAPSHOT_KEY, snapshotRaw)
      const check = inspectSettingsRecovery(storage)
      if (check.state !== 'pending' || check.raw !== snapshotRaw) throw new Error('copy does not verify after saving')
    } catch (error) {
      // Only a copy that is not a valid one of ours or anyone's is removed; a valid foreign copy is kept.
      try {
        const stored = storage.getItem(SETTINGS_RESTORE_SNAPSHOT_KEY)
        if (stored !== null && (stored === snapshotRaw || inspectSettingsRecovery(storage).state === 'invalid')) storage.removeItem(SETTINGS_RESTORE_SNAPSHOT_KEY)
      } catch { /* left for review */ }
      throw new SettingsRestoreError('snapshot', `could not save a copy of the current settings first (${errorText(error)}); no setting was changed`, { cause: error })
    }

    const attempted: string[] = []
    for (const [key, value] of writes) {
      attempted.push(key)
      try {
        storage.setItem(key, value)
        if (storage.getItem(key) !== value) throw new Error(`${key} could not be verified after saving`)
      } catch (error) {
        const unresolvedKeys = attempted.filter(k => !putBack(storage, k, previous[k]))
        if (!unresolvedKeys.length) {
          // Verified rollback: the copy is no longer needed (kept as pending if its removal fails: put-back is then a no-op).
          clearSnapshot(storage, snapshotRaw)
          throw new SettingsRestoreError('rolled-back', `saving ${key} failed (${errorText(error)}); every setting was put back and verified`, { cause: error, failedKey: key })
        }
        throw new SettingsRestoreError('partial', `saving ${key} failed (${errorText(error)}) and ${unresolvedKeys.length} setting(s) could not be put back (${unresolvedKeys.join(', ')})`,
          { cause: error, failedKey: key, unresolvedKeys })
      }
    }
    // Every write verified: retire the copy, or mark it as belonging to this finished restore.
    let recoveryCopy: RecoveryCopyOutcome = 'removed'
    if (!clearSnapshot(storage, snapshotRaw)) {
      recoveryCopy = 'stale'
      try {
        if (storage.getItem(SETTINGS_RESTORE_SNAPSHOT_KEY) === snapshotRaw) {
          const committed = JSON.stringify(committedCopy(snapshot))
          storage.setItem(SETTINGS_RESTORE_SNAPSHOT_KEY, committed)
          if (inspectSettingsRecovery(storage).state === 'committed' && storage.getItem(SETTINGS_RESTORE_SNAPSHOT_KEY) === committed) recoveryCopy = 'kept-committed'
        }
      } catch { /* stays as written: reported as stale */ }
    }
    settingsChanged()
    return { written: writes.map(([key]) => key), groups, recoveryCopy }
  })
}

/**
 * Raw values of every backed-up setting, for cheap same-tab change detection (no parsing of the
 * values). JSON of the ordered value list: absent (null), empty and any stored text, including
 * control characters, map to distinct signatures. Unreadable storage → null.
 */
export function settingsSignature(storage: Pick<Storage, 'getItem'> = localStorage): string | null {
  try { return JSON.stringify(backupSettingsStorageKeys().map(key => storage.getItem(key))) } catch { return null }
}
