export const SETTINGS_KEYS = {
  themeMode: 'gtar_theme_store',
  customThemeColors: 'gtar_custom_theme_colors',
  fontStyle: 'gtar_font_style_store',
  isTwoColumn: 'gtar_twocolumn_store',
  fontSizePx: 'gtar_stage_font_size',
  scrollSpeed: 'gtar_stage_scroll_speed',
} as const

export const SETTINGS_CHANGED = 'gtar-settings-restored'
export const THEME_MODES = ['solarized-dark', 'amber-stage', 'oled-black', 'paper-light', 'custom'] as const
export const FONT_STYLES = ['mono', 'sans', 'serif'] as const
export type ThemeMode = typeof THEME_MODES[number]
export type SongFontStyleOption = typeof FONT_STYLES[number]
export interface CustomThemeColors { bgHex: string; textHex: string; chordHex: string; sectionHex: string }
export interface BackupSettings {
  themeMode?: ThemeMode
  customThemeColors?: CustomThemeColors
  stageSettings?: { fontStyle?: SongFontStyleOption; fontSizePx?: number; isTwoColumn?: boolean; scrollSpeed?: number }
}

export function validateBackupSettings(data: Record<string, unknown>): string[] {
  const errors: string[] = []
  if ('themeMode' in data && !THEME_MODES.includes(data.themeMode as ThemeMode)) errors.push('themeMode: unsupported theme')
  if ('customThemeColors' in data) {
    const colors = data.customThemeColors
    if (!colors || typeof colors !== 'object' || Array.isArray(colors)) errors.push('customThemeColors: must be a color object')
    else {
      const fields = ['bgHex', 'textHex', 'chordHex', 'sectionHex']
      for (const field of fields) {
        const color = (colors as Record<string, unknown>)[field]
        if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) errors.push(`customThemeColors.${field}: expected #RRGGBB`)
      }
      for (const field of Object.keys(colors)) if (!fields.includes(field)) errors.push(`customThemeColors.${field}: unknown color setting`)
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

export function readBackupSettings(storage: Pick<Storage, 'getItem'> = localStorage): BackupSettings {
  const data: Record<string, unknown> = {}
  const theme = storage.getItem(SETTINGS_KEYS.themeMode)
  const colors = storage.getItem(SETTINGS_KEYS.customThemeColors)
  if (theme !== null) data.themeMode = theme
  if (colors !== null) data.customThemeColors = JSON.parse(colors)
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
