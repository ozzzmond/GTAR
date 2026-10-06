import { normalizeFontSettings, applyFontSettings } from '../utils/customFonts'
import { SETTINGS_KEYS, validateBackupSettings, THEME_MODES, type FactoryThemeOverrides } from '../utils/backupSettings'
import React, { useState, useEffect } from 'react'
import {
  X,
  Check,
  Palette,
  Sliders,
  Layout,
  Layers,
  SlidersHorizontal,
  PlaySquare,
} from 'lucide-react'
import { CustomPaletteEditor } from './CustomPaletteEditor'
import { presetToCustomPalette } from '../utils/customPaletteJson'
export { CustomPaletteEditor }
export { presetToCustomPalette }

import type { ThemeMode, CustomThemeColors } from '../utils/backupSettings'
export type { ThemeMode, CustomThemeColors } from '../utils/backupSettings'

export interface ThemeOption {
  id: ThemeMode
  name: string
  subtitle?: string
  bgHex: string
  surfaceHex: string
  accentHex: string
  textHex: string
  tag?: string
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
  // STAGE
  bgHex: '#121820',
  textHex: '#F1F5F9',
  chordHex: '#F59E0B',
  sectionHex: '#A78BFA',

  // APP_CHROME
  headerBg: '#1A222D',
  headerPrimaryText: '#F1F5F9',
  headerSecondaryText: '#CBD5E1',
  headerIconColor: '#94A3B8',
  toolbarBg: '#121820',
  searchBg: '#121820',
  searchBorder: '#2A3644',
  filterBarBg: '#1A222D',
  iconColor: '#94A3B8',

  // CARDS_AND_BOXES
  setlistCardBg: '#1A222D',
  songCardBg: '#1A222D',
  cardBorder: '#2A3644',
  selectedCardBg: '#22313F',
  selectedCardBorder: '#38BDF8',

  // CONTROLS
  buttonBg: '#24303E',
  buttonText: '#F1F5F9',
  inputBg: '#121820',
  inputText: '#F1F5F9',
  inputBorder: '#2A3644',
  accentColor: '#F59E0B',

  // STAGE_FLOATING_CONTROLS
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

// Derive legacy header colors against the header surface, independently of the body.
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
  if (!colors) return { ...DEFAULT_CUSTOM_COLORS }
  return {
    ...DEFAULT_CUSTOM_COLORS,
    ...colors,
    ...typographyDefaults(colors),
    ...headerDefaults(colors),
    actionColor: colors.actionColor || colors.uiLinkText || '#2AA198',
    selectionColor: colors.selectionColor || colors.selectedCardBorder || '#2AA198',
    sectionIconColor: colors.sectionIconColor || colors.iconColor || '#2AA198',
    ...(colors.identity ? { identity: { ...colors.identity, displayName: colors.identity.displayName.trim() } } : {}),
    fonts: normalizeFontSettings(colors.fonts),
    bgHex: colors.bgHex || DEFAULT_CUSTOM_COLORS.bgHex,
    textHex: colors.textHex || DEFAULT_CUSTOM_COLORS.textHex,
    chordHex: colors.chordHex || DEFAULT_CUSTOM_COLORS.chordHex,
    sectionHex: colors.sectionHex || DEFAULT_CUSTOM_COLORS.sectionHex,
  }
}

export function applyCustomThemeStyles(rawColors: CustomThemeColors) {
  if (typeof document === 'undefined') return
  const colors = normalizeCustomThemeColors(rawColors)
  const root = document.documentElement

  applyFontSettings(colors.fonts, root)
  for (const [key, value] of Object.entries({ ...typographyDefaults(colors), ...headerDefaults(colors), actionColor: colors.actionColor!, selectionColor: colors.selectionColor!, sectionIconColor: colors.sectionIconColor! })) {
    root.style.setProperty('--custom-' + key, value)
  }

  const selection = colors.selectionColor!
  const channels = [1, 3, 5].map(offset => parseInt(selection.slice(offset, offset + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
  root.style.setProperty('--custom-selection-foreground', luminance > .179 ? '#000000' : '#FFFFFF')

  // STAGE
  root.style.setProperty('--custom-stage-bg', colors.bgHex)
  root.style.setProperty('--custom-stage-text', colors.textHex)
  root.style.setProperty('--custom-stage-chord', colors.chordHex)
  root.style.setProperty('--custom-stage-section', colors.sectionHex)

  // Surface & border calculations based on bg brightness (backward compatibility)
  const hex = colors.bgHex.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16) || 0
  const g = parseInt(hex.substring(2, 4), 16) || 0
  const b = parseInt(hex.substring(4, 6), 16) || 0
  const isLight = (r * 299 + g * 587 + b * 114) / 1000 > 150

  if (isLight) {
    root.style.setProperty(
      '--custom-stage-surface',
      `rgb(${Math.max(0, r - 15)}, ${Math.max(0, g - 15)}, ${Math.max(0, b - 15)})`
    )
    root.style.setProperty(
      '--custom-stage-border',
      `rgb(${Math.max(0, r - 45)}, ${Math.max(0, g - 45)}, ${Math.max(0, b - 45)})`
    )
  } else {
    root.style.setProperty(
      '--custom-stage-surface',
      `rgb(${Math.min(255, r + 16)}, ${Math.min(255, g + 16)}, ${Math.min(255, b + 16)})`
    )
    root.style.setProperty(
      '--custom-stage-border',
      `rgb(${Math.min(255, r + 38)}, ${Math.min(255, g + 38)}, ${Math.min(255, b + 38)})`
    )
  }

  // APP_CHROME
  root.style.setProperty('--custom-chrome-header-bg', colors.headerBg || DEFAULT_CUSTOM_COLORS.headerBg!)
  root.style.setProperty('--custom-chrome-toolbar-bg', colors.toolbarBg || DEFAULT_CUSTOM_COLORS.toolbarBg!)
  root.style.setProperty('--custom-chrome-search-bg', colors.searchBg || DEFAULT_CUSTOM_COLORS.searchBg!)
  root.style.setProperty('--custom-chrome-search-border', colors.searchBorder || DEFAULT_CUSTOM_COLORS.searchBorder!)
  root.style.setProperty('--custom-chrome-filter-bg', colors.filterBarBg || DEFAULT_CUSTOM_COLORS.filterBarBg!)
  root.style.setProperty('--custom-chrome-icon', colors.iconColor || DEFAULT_CUSTOM_COLORS.iconColor!)

  // CARDS_AND_BOXES
  root.style.setProperty('--custom-card-setlist-bg', colors.setlistCardBg || DEFAULT_CUSTOM_COLORS.setlistCardBg!)
  root.style.setProperty('--custom-card-song-bg', colors.songCardBg || DEFAULT_CUSTOM_COLORS.songCardBg!)
  root.style.setProperty('--custom-card-border', colors.cardBorder || DEFAULT_CUSTOM_COLORS.cardBorder!)
  root.style.setProperty('--custom-card-selected-bg', colors.selectedCardBg || DEFAULT_CUSTOM_COLORS.selectedCardBg!)
  root.style.setProperty('--custom-card-selected-border', colors.selectedCardBorder || DEFAULT_CUSTOM_COLORS.selectedCardBorder!)

  // CONTROLS
  root.style.setProperty('--custom-control-button-bg', colors.buttonBg || DEFAULT_CUSTOM_COLORS.buttonBg!)
  root.style.setProperty('--custom-control-button-text', colors.buttonText || DEFAULT_CUSTOM_COLORS.buttonText!)
  root.style.setProperty('--custom-control-input-bg', colors.inputBg || DEFAULT_CUSTOM_COLORS.inputBg!)
  root.style.setProperty('--custom-control-input-text', colors.inputText || DEFAULT_CUSTOM_COLORS.inputText!)
  root.style.setProperty('--custom-control-input-border', colors.inputBorder || DEFAULT_CUSTOM_COLORS.inputBorder!)
  root.style.setProperty('--custom-control-accent', colors.accentColor || DEFAULT_CUSTOM_COLORS.accentColor!)

  // STAGE_FLOATING_CONTROLS
  root.style.setProperty('--custom-dock-bg', colors.dockBg || DEFAULT_CUSTOM_COLORS.dockBg!)
  root.style.setProperty('--custom-dock-border', colors.dockBorder || DEFAULT_CUSTOM_COLORS.dockBorder!)
  root.style.setProperty('--custom-dock-btn-bg', colors.dockBtnBg || DEFAULT_CUSTOM_COLORS.dockBtnBg!)
  root.style.setProperty('--custom-dock-btn-icon', colors.dockBtnIcon || DEFAULT_CUSTOM_COLORS.dockBtnIcon!)
  root.style.setProperty('--custom-dock-play-bg', colors.dockPlayBg || DEFAULT_CUSTOM_COLORS.dockPlayBg!)
  root.style.setProperty('--custom-dock-play-icon', colors.dockPlayIcon || DEFAULT_CUSTOM_COLORS.dockPlayIcon!)
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    bgHex: '#002B36',
    surfaceHex: '#073642',
    accentHex: '#2AA198',
    textHex: '#EEE8D5',
    tag: 'DEFAULT',
  },
  {
    id: 'amber-stage',
    name: 'Amber Stage',
    bgHex: '#181206',
    surfaceHex: '#241c0c',
    accentHex: '#F59E0B',
    textHex: '#FFF8E7',
  },
  {
    id: 'oled-black',
    name: 'OLED Pure Black',
    bgHex: '#000000',
    surfaceHex: '#111111',
    accentHex: '#38BDF8',
    textHex: '#FFFFFF',
  },
  {
    id: 'paper-light',
    name: 'Paper Cream Light',
    bgHex: '#f4ecd8',
    surfaceHex: '#FFFDF7',
    accentHex: '#b45309',
    textHex: '#172033',
  },
  {
    id: 'crimson-stage',
    name: 'Crimson Stage',
    bgHex: '#120d0f',
    surfaceHex: '#1f1418',
    accentHex: '#E11D48',
    textHex: '#FEE2E2',
  },
  {
    id: 'azure-stage',
    name: 'Azure Stage',
    bgHex: '#0a1324',
    surfaceHex: '#11203b',
    accentHex: '#06B6D4',
    textHex: '#E0F2FE',
  },
  {
    id: 'e-ink-paper',
    name: 'E-Ink Paper',
    bgHex: '#ededed',
    surfaceHex: '#f8f8f8',
    accentHex: '#404040',
    textHex: '#111111',
  },
]

interface ThemeModalProps {
  isOpen: boolean
  onClose: () => void
  currentTheme: ThemeMode
  customColors?: CustomThemeColors
  onApplyTheme?: (theme: ThemeMode, customColors?: CustomThemeColors) => void
  onSelectTheme?: (theme: ThemeMode) => void
}

const BG_SWATCHES = ['#000000', '#0D131A', '#002B36', '#121820', '#181825', '#F4ECD8']
const TEXT_SWATCHES = ['#FFFFFF', '#EEE8D5', '#FDF6E3', '#F1F5F9', '#CBD5E1', '#111827']
const CHORD_SWATCHES = ['#B58900', '#F59E0B', '#2AA198', '#10B981', '#38BDF8', '#F43F5E']
const SECTION_SWATCHES = ['#8B5CF6', '#A78BFA', '#60A5FA', '#268BD2', '#35B8AD', '#EC4899']

const CHROME_BG_SWATCHES = ['#073642', '#1A222D', '#121820', '#0F172A', '#18181B', '#EDE4CE']
const BORDER_SWATCHES = ['#1A4A55', '#2A3644', '#334155', '#3F3F46', '#2AA198', '#DED3BA']
const ICON_SWATCHES = ['#93A1A1', '#94A3B8', '#2AA198', '#F59E0B', '#38BDF8', '#FFFFFF']
const ACCENT_SWATCHES = ['#2AA198', '#F59E0B', '#38BDF8', '#10B981', '#EC4899', '#8B5CF6']

export type PaletteSectionGroup = 'stage' | 'chrome' | 'cards' | 'controls' | 'stageControls' | 'typography'

interface PaletteGroupDef {
  id: PaletteSectionGroup
  label: string
  icon: React.ComponentType<{ className?: string }>
  fields: {
    key: Exclude<keyof CustomThemeColors, 'fonts' | 'identity'>
    label: string
    desc: string
    swatches: string[]
  }[]
}

export const PALETTE_GROUPS: PaletteGroupDef[] = [
  {
    id: 'typography', label: 'Typography', icon: Sliders,
    fields: [
      { key: 'uiPrimaryText', label: 'Primary UI Text', desc: 'Titles and major labels', swatches: TEXT_SWATCHES },
      { key: 'uiSecondaryText', label: 'Secondary UI Text', desc: 'Artists, counts and metadata', swatches: TEXT_SWATCHES },
      { key: 'uiSectionText', label: 'Section Text', desc: 'Library section headings', swatches: TEXT_SWATCHES },
      { key: 'uiMutedText', label: 'Muted Text', desc: 'Helpers and informational text', swatches: TEXT_SWATCHES },
      { key: 'uiLinkText', label: 'Link Text', desc: 'Lightweight actions and links', swatches: TEXT_SWATCHES },
    ],
  },
  {
    id: 'stage',
    label: 'Stage',
    icon: Sliders,
    fields: [
      {
        key: 'bgHex',
        label: 'Background',
        desc: 'Stage canvas & background color',
        swatches: BG_SWATCHES,
      },
      {
        key: 'textHex',
        label: 'Primary Text',
        desc: 'Song lyrics & teleprompter body',
        swatches: TEXT_SWATCHES,
      },
      {
        key: 'chordHex',
        label: 'Chord Highlight',
        desc: 'Chord notations & root accents',
        swatches: CHORD_SWATCHES,
      },
      {
        key: 'sectionHex',
        label: 'Section Header',
        desc: '[Verse], [Chorus], [Bridge] headers',
        swatches: SECTION_SWATCHES,
      },
    ],
  },
  {
    id: 'chrome',
    label: 'Chrome',
    icon: Layout,
    fields: [
      {
        key: 'headerBg',
        label: 'Header',
        desc: 'Top header shell & branding bar',
        swatches: CHROME_BG_SWATCHES,
      },
      {
        key: 'headerPrimaryText', label: 'Header Primary Text', desc: 'GTAR title in the top header', swatches: TEXT_SWATCHES,
      },
      {
        key: 'headerSecondaryText', label: 'Header Secondary Text', desc: 'Version in the top header', swatches: TEXT_SWATCHES,
      },
      {
        key: 'headerIconColor', label: 'Header Icon Color', desc: 'Neutral top-header icons; status colors stay semantic', swatches: ICON_SWATCHES,
      },
      {
        key: 'toolbarBg',
        label: 'Main Toolbar',
        desc: 'Secondary action bar & icon strip',
        swatches: BG_SWATCHES,
      },
      {
        key: 'searchBg',
        label: 'Search Bar',
        desc: 'Pill search bar background',
        swatches: BG_SWATCHES,
      },
      {
        key: 'searchBorder',
        label: 'Search Border',
        desc: 'Search bar perimeter outline',
        swatches: BORDER_SWATCHES,
      },
      {
        key: 'filterBarBg',
        label: 'Filter/Sort Bar',
        desc: 'Sort & filter toolbar container',
        swatches: CHROME_BG_SWATCHES,
      },
      {
        key: 'iconColor',
        label: 'Icon Color',
        desc: 'General navigation & toolbar icons',
        swatches: ICON_SWATCHES,
      },
    ],
  },
  {
    id: 'cards',
    label: 'Cards',
    icon: Layers,
    fields: [
      {
        key: 'setlistCardBg',
        label: 'Setlist Card',
        desc: 'Gig setlist card surface',
        swatches: CHROME_BG_SWATCHES,
      },
      {
        key: 'songCardBg',
        label: 'Song Card',
        desc: 'Song library card surface',
        swatches: CHROME_BG_SWATCHES,
      },
      {
        key: 'cardBorder',
        label: 'Card Border',
        desc: 'Default card border & dividers',
        swatches: BORDER_SWATCHES,
      },
      {
        key: 'selectedCardBg',
        label: 'Selected Card',
        desc: 'Active card background color',
        swatches: ['#22313F', '#0E3B43', '#1E293B', '#27272A', '#EEF7F6', '#002B36'],
      },
      {
        key: 'selectedCardBorder',
        label: 'Selected Border',
        desc: 'Active card border & focus ring',
        swatches: ACCENT_SWATCHES,
      },
    ],
  },
  {
    id: 'controls',
    label: 'Controls',
    icon: SlidersHorizontal,
    fields: [
      { key: 'actionColor', label: 'Action Color', desc: 'Play icons and Select, Hide, Import, Manage actions', swatches: ACCENT_SWATCHES },
      { key: 'selectionColor', label: 'Selection Color', desc: 'Songbook checkmarks and selection indicators', swatches: ACCENT_SWATCHES },
      { key: 'sectionIconColor', label: 'Section Icon Color', desc: 'Songbook, setlist and Songs Library icons', swatches: ICON_SWATCHES },
      {
        key: 'buttonBg',
        label: 'Button Background',
        desc: 'Action buttons & view toggles',
        swatches: ['#24303E', '#2AA198', '#F59E0B', '#334155', '#3F3F46', '#073642'],
      },
      {
        key: 'buttonText',
        label: 'Button Text',
        desc: 'Button labels & text color',
        swatches: TEXT_SWATCHES,
      },
      {
        key: 'inputBg',
        label: 'Input Background',
        desc: 'Text input & select dropdowns',
        swatches: BG_SWATCHES,
      },
      {
        key: 'inputText',
        label: 'Input Text',
        desc: 'Input value & dropdown text color',
        swatches: TEXT_SWATCHES,
      },
      {
        key: 'inputBorder',
        label: 'Input Border',
        desc: 'Border outline for inputs & selects',
        swatches: BORDER_SWATCHES,
      },
      {
        key: 'accentColor',
        label: 'Accent/Focus',
        desc: 'Active focus outlines & highlights',
        swatches: ACCENT_SWATCHES,
      },
    ],
  },
  {
    id: 'stageControls',
    label: 'Stage Controls',
    icon: PlaySquare,
    fields: [
      {
        key: 'dockBg',
        label: 'Dock Background',
        desc: 'Floating stage scroll dock shell',
        swatches: CHROME_BG_SWATCHES,
      },
      {
        key: 'dockBorder',
        label: 'Dock Border',
        desc: 'Dock perimeter border outline',
        swatches: BORDER_SWATCHES,
      },
      {
        key: 'dockBtnBg',
        label: 'Arrow Button Background',
        desc: 'Previous / Next jump buttons',
        swatches: BG_SWATCHES,
      },
      {
        key: 'dockBtnIcon',
        label: 'Arrow Icon',
        desc: 'Previous / Next chevron arrows',
        swatches: TEXT_SWATCHES,
      },
      {
        key: 'dockPlayBg',
        label: 'Play/Pause Background',
        desc: 'Center autoscroll FAB button',
        swatches: ACCENT_SWATCHES,
      },
      {
        key: 'dockPlayIcon',
        label: 'Play/Pause Icon',
        desc: 'Autoscroll play/pause icon color',
        swatches: ['#000000', '#FFFFFF', '#111827', '#F1F5F9', '#2AA198', '#F59E0B'],
      },
    ],
  },
]

export const ThemeModal: React.FC<ThemeModalProps> = ({
  isOpen,
  onClose,
  currentTheme,
  customColors,
  onApplyTheme,
  onSelectTheme,
}) => {
  // Staged theme selection and custom colors (reverted on Cancel)
  const [stagedTheme, setStagedTheme] = useState<ThemeMode>(currentTheme)
  const [stagedCustomColors, setStagedCustomColors] = useState<CustomThemeColors>(() => {
    return normalizeCustomThemeColors(customColors)
  })
  const [overrides, setOverrides] = useState<FactoryThemeOverrides>({})
  const [pendingRestore, setPendingRestore] = useState<ThemeMode | null>(null)
  const loadOverrides = (): FactoryThemeOverrides => {
    try {
      const value = JSON.parse(localStorage.getItem(SETTINGS_KEYS.factoryThemeOverrides) || '{}')
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
      const valid: FactoryThemeOverrides = {}
      for (const [id, palette] of Object.entries(value)) {
        if (
          id !== 'custom' &&
          THEME_MODES.includes(id as ThemeMode) &&
          palette &&
          typeof palette === 'object' &&
          !validateBackupSettings({ factoryThemeOverrides: { [id]: palette } }).length
        ) {
          valid[id as Exclude<ThemeMode, 'custom'>] = normalizeCustomThemeColors(palette as CustomThemeColors)
        }
      }
      return valid
    } catch { return {} }
  }
  const [isCustomPaletteEditorOpen, setIsCustomPaletteEditorOpen] = useState(false)

  // Synchronize internal staged state whenever modal opens
  useEffect(() => {
    if (isOpen) {
      const saved = loadOverrides()
      // Adopt active custom theme with factory identity into overrides on modal open
      if (currentTheme === 'custom' && customColors?.identity) {
        saved[customColors.identity.factoryId] = normalizeCustomThemeColors(customColors)
      }
      setOverrides(saved)
      setPendingRestore(null)
      setStagedTheme(currentTheme)
      setStagedCustomColors(normalizeCustomThemeColors(customColors))
      setIsCustomPaletteEditorOpen(false)
    }
  }, [isOpen, currentTheme, customColors])

  if (!isOpen) return null

  const handleSaveAndApply = () => {
    try {
      const nextOverrides = { ...overrides }
      if (stagedTheme === 'custom' && stagedCustomColors.identity) {
        nextOverrides[stagedCustomColors.identity.factoryId] = stagedCustomColors
      }
      setOverrides(nextOverrides)
      localStorage.setItem(SETTINGS_KEYS.factoryThemeOverrides, JSON.stringify(nextOverrides))
      localStorage.setItem(SETTINGS_KEYS.themeMode, stagedTheme)
      localStorage.setItem(SETTINGS_KEYS.customThemeColors, JSON.stringify(stagedCustomColors))
      if (stagedTheme === 'custom') {
        applyCustomThemeStyles(stagedCustomColors)
      }
    } catch (e) {
      console.error('Failed to commit theme to localStorage', e)
    }

    if (onApplyTheme) {
      onApplyTheme(stagedTheme, stagedCustomColors)
    } else if (onSelectTheme) {
      onSelectTheme(stagedTheme)
    }
    onClose()
  }

  const handleCustomPaletteSaveAndApply = (colors: CustomThemeColors) => {
    const nextOverrides = { ...overrides }
    if (colors.identity) nextOverrides[colors.identity.factoryId] = colors
    setOverrides(nextOverrides)
    setStagedCustomColors(colors)
    setStagedTheme('custom')
    try {
      localStorage.setItem(SETTINGS_KEYS.factoryThemeOverrides, JSON.stringify(nextOverrides))
      localStorage.setItem(SETTINGS_KEYS.themeMode, 'custom')
      localStorage.setItem(SETTINGS_KEYS.customThemeColors, JSON.stringify(colors))
      applyCustomThemeStyles(colors)
    } catch (e) {
      console.error('Failed to commit custom theme to localStorage', e)
    }

    if (onApplyTheme) {
      onApplyTheme('custom', colors)
    } else if (onSelectTheme) {
      onSelectTheme('custom')
    }
    setIsCustomPaletteEditorOpen(false)
    onClose()
  }

  return (
    <>
      <div data-testid="theme-selector" className="theme-studio fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in select-none">
        <div className="w-full max-w-lg rounded-2xl bg-[#073642] border border-[#1A4A55] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
          {/* Modal Header */}
          <div className="px-5 py-4 border-b border-[#1A4A55] flex items-center justify-between bg-[#002B36]/70">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#B58900]/20 border border-[#B58900]/40 flex items-center justify-center text-[#B58900]">
                <Palette className="w-5 h-5" />
              </div>
              <div>
                <h2 className="ui-section-text text-sm sm:text-base font-bold ui-primary-text text-[#FDF6E3]">Stage Color Theme</h2>
                <p className="text-[11px] ui-muted-text text-[#93A1A1]">Live Performance & Full-Theme Customization</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              title="Close without saving"
              className="p-1.5 rounded-lg ui-muted-text text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#002B36] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-5 overflow-y-auto space-y-3 flex-1 custom-scrollbar">
            {/* Preset Theme Cards */}
            {THEME_OPTIONS.map((theme) => {
              const override = overrides[theme.id as Exclude<ThemeMode, 'custom'>]
              const isSelected = override ? stagedTheme === 'custom' && stagedCustomColors.identity?.factoryId === theme.id : stagedTheme === theme.id
              const preview = override ? { bgHex: override.bgHex, accentHex: override.accentColor || override.chordHex || theme.accentHex } : theme
              return (
                <div
                  key={theme.id}
                  data-testid={`theme-slot-${theme.id}`}
                  onClick={() => {
                    setStagedTheme(override ? 'custom' : theme.id)
                    if (override) setStagedCustomColors(override)
                  }}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2 group ${
                    isSelected
                      ? 'bg-[#002B36] border-[#2AA198] shadow-md ring-1 ring-[#2AA198]/40'
                      : 'bg-[#002B36]/50 border-[#1A4A55]/60 hover:border-[#2AA198]/50 hover:bg-[#002B36]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Swatch Preview Box */}
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 shadow-inner relative overflow-hidden"
                        style={{
                          backgroundColor: preview.bgHex,
                          borderColor: preview.accentHex,
                        }}
                      >
                        <div
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: preview.accentHex }}
                        />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-bold leading-tight ${
                              isSelected ? 'ui-primary-text text-[#FDF6E3]' : 'ui-primary-text text-[#EEE8D5] group-hover:text-[#FDF6E3]'
                            }`}
                          >
                            {override?.identity?.displayName || theme.name}
                          </span>
                          {theme.tag && (
                            <span className="ui-muted-text text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-[#073642] text-[#2AA198] border border-[#1A4A55]">
                              {theme.tag}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? 'ui-selection-indicator border-[#2AA198] bg-[#2AA198] text-[#002B36]'
                            : 'border-[#1A4A55] bg-[#073642] group-hover:border-[#2AA198]'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                    </div>
                  </div>

                  {override && <button type="button" data-testid={`restore-factory-${theme.id}`} className="ui-action-text text-xs underline text-[#2AA198]" onClick={e => { e.stopPropagation(); setPendingRestore(theme.id) }}>Restore Factory Theme</button>}
                  {/* Built-in Preset Customization Action */}
                  <div className="pt-2 border-t border-[#1A4A55]/40 flex items-center justify-between gap-2">
                    <span className="text-[10px] ui-muted-text text-[#93A1A1]">
                      {override ? 'Customized factory theme' : 'Factory preset • Safe starting point'}
                    </span>
                    <button
                      type="button"
                      data-testid={`customize-preset-${theme.id}-btn`}
                      onClick={(e) => {
                        e.stopPropagation()
                        const clonedCustom = override || { ...presetToCustomPalette(theme), identity: { factoryId: theme.id as Exclude<ThemeMode, 'custom'>, displayName: `${theme.name} Custom` } }
                        setStagedCustomColors(clonedCustom)
                        setStagedTheme('custom')
                        setIsCustomPaletteEditorOpen(true)
                      }}
                      className="ui-button px-2.5 py-1 rounded-lg bg-[#073642] hover:bg-[#002B36] ui-primary-text text-[#EEE8D5] hover:text-[#FDF6E3] border border-[#1A4A55] text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all active:scale-95 shrink-0"
                      title={`Customize a copy of ${override?.identity?.displayName || theme.name} without altering factory preset`}
                    >
                      <Sliders className="ui-action-text w-3 h-3 text-amber-400" />
                      <span>Customize This Theme</span>
                    </button>
                  </div>
                </div>
              )
            })}

            {pendingRestore && <div role="alertdialog" aria-label="Restore factory theme" className="p-3 border border-[#1A4A55] rounded-xl bg-[#002B36]">
              <p className="ui-primary-text text-xs">Delete this customization and restore the original factory theme? Save &amp; Apply commits the restoration.</p>
              <button type="button" data-testid="confirm-factory-restore" className="ui-action-text text-xs p-2" onClick={() => {
                const next = { ...overrides }; delete next[pendingRestore as Exclude<ThemeMode, 'custom'>]; setOverrides(next)
                if (stagedCustomColors.identity?.factoryId === pendingRestore) {
                  setStagedCustomColors(normalizeCustomThemeColors())
                  if (stagedTheme === 'custom') setStagedTheme(pendingRestore)
                }
                setPendingRestore(null)
              }}>Restore Factory Theme</button>
              <button type="button" className="ui-secondary-text text-xs p-2" onClick={() => setPendingRestore(null)}>Cancel</button>
            </div>}
            {/* Custom Theme Option Card */}
            {!stagedCustomColors.identity && <div
              data-testid="custom-theme-option-card"
              onClick={() => {
                setStagedTheme('custom')
              }}
              className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2 group ${
                stagedTheme === 'custom'
                  ? 'bg-[#002B36] border-[#2AA198] shadow-md ring-1 ring-[#2AA198]/40'
                  : 'bg-[#002B36]/50 border-[#1A4A55]/60 hover:border-[#2AA198]/50 hover:bg-[#002B36]'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Dynamic Swatch Preview Box */}
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 shadow-inner relative overflow-hidden"
                    style={{
                      backgroundColor: stagedCustomColors.bgHex,
                      borderColor: stagedCustomColors.chordHex,
                    }}
                  >
                    <div
                      className="w-4 h-4 rounded-full shadow"
                      style={{ backgroundColor: stagedCustomColors.chordHex }}
                    />
                    <div
                      className="absolute bottom-0 right-0 w-3 h-3 rounded-tl"
                      style={{ backgroundColor: stagedCustomColors.sectionHex }}
                    />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-bold leading-tight ${
                          stagedTheme === 'custom'
                            ? 'ui-primary-text text-[#FDF6E3]'
                            : 'ui-primary-text text-[#EEE8D5] group-hover:text-[#FDF6E3]'
                        }`}
                      >
                        Custom Palette
                      </span>
                      <span className="ui-muted-text text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-[#073642] text-amber-400 border border-[#1A4A55]">
                        CUSTOM
                      </span>
                    </div>
                    <span className="text-[10px] ui-muted-text text-[#93A1A1] block mt-0.5">
                      Tailor stage, chrome, cards, inputs & floating controls
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                      stagedTheme === 'custom'
                        ? 'ui-selection-indicator border-[#2AA198] bg-[#2AA198] text-[#002B36]'
                        : 'border-[#1A4A55] bg-[#073642] group-hover:border-[#2AA198]'
                    }`}
                  >
                    {stagedTheme === 'custom' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                </div>
              </div>

              {/* Dedicated Editor Launch Action Button */}
              <div className="pt-2 border-t border-[#1A4A55]/60 flex items-center justify-between gap-2">
                <span className="text-[11px] ui-muted-text text-[#93A1A1]">
                  Semantic colors across 6 categories + fonts
                </span>
                <button
                  type="button"
                  data-testid="open-custom-palette-editor-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    setStagedTheme('custom')
                    setIsCustomPaletteEditorOpen(true)
                  }}
                  className="ui-button px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-black text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all active:scale-95 shrink-0"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Edit Palette</span>
                </button>
              </div>
            </div>}
          </div>

          {/* Modal Footer */}
          <div className="px-5 py-3.5 border-t border-[#1A4A55] bg-[#002B36]/80 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="ui-button px-4 py-2 rounded-xl border border-[#1A4A55] bg-[#073642]/60 hover:bg-[#073642] ui-primary-text text-[#EEE8D5] hover:text-[#FDF6E3] font-medium text-xs sm:text-sm cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="theme-save-apply-btn"
              onClick={handleSaveAndApply}
              className="ui-button px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs sm:text-sm cursor-pointer transition-all shadow-md active:scale-95 flex items-center gap-1.5"
            >
              Save & Apply
            </button>
          </div>
        </div>
      </div>

      {/* Dedicated Floating Custom Palette Editor */}
      <CustomPaletteEditor
        isOpen={isCustomPaletteEditorOpen}
        onClose={() => setIsCustomPaletteEditorOpen(false)}
        customColors={stagedCustomColors}
        onSaveAndApply={handleCustomPaletteSaveAndApply}
      />
    </>
  )
}
