import { SETTINGS_KEYS } from '../utils/backupSettings'
import React, { useState, useEffect } from 'react'
import {
  X,
  Check,
  Palette,
  Sliders,
  RotateCcw,
  Layout,
  Layers,
  SlidersHorizontal,
  PlaySquare,
} from 'lucide-react'

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
  // STAGE
  bgHex: '#121820',
  textHex: '#F1F5F9',
  chordHex: '#F59E0B',
  sectionHex: '#A78BFA',

  // APP_CHROME
  headerBg: '#1A222D',
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

export function normalizeCustomThemeColors(
  colors?: Partial<CustomThemeColors> | null
): CustomThemeColors {
  if (!colors) return { ...DEFAULT_CUSTOM_COLORS }
  return {
    ...DEFAULT_CUSTOM_COLORS,
    ...colors,
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

export type PaletteSectionGroup = 'stage' | 'chrome' | 'cards' | 'controls' | 'stageControls'

interface PaletteGroupDef {
  id: PaletteSectionGroup
  label: string
  icon: React.ComponentType<{ className?: string }>
  fields: {
    key: keyof CustomThemeColors
    label: string
    desc: string
    swatches: string[]
  }[]
}

export const PALETTE_GROUPS: PaletteGroupDef[] = [
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
  const [activeGroup, setActiveGroup] = useState<PaletteSectionGroup>('stage')

  // Synchronize internal staged state whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setStagedTheme(currentTheme)
      setStagedCustomColors(normalizeCustomThemeColors(customColors))
    }
  }, [isOpen, currentTheme, customColors])

  if (!isOpen) return null

  const handleSaveAndApply = () => {
    try {
      localStorage.setItem(SETTINGS_KEYS.themeMode, stagedTheme)
      if (stagedTheme === 'custom') {
        localStorage.setItem(SETTINGS_KEYS.customThemeColors, JSON.stringify(stagedCustomColors))
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

  const handleResetCustomPalette = () => {
    setStagedCustomColors({ ...DEFAULT_CUSTOM_COLORS })
  }

  const updateColor = (key: keyof CustomThemeColors, value: string) => {
    setStagedCustomColors((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const currentGroupDef = PALETTE_GROUPS.find((g) => g.id === activeGroup) || PALETTE_GROUPS[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in select-none">
      <div className="w-full max-w-lg rounded-2xl bg-[#073642] border border-[#1A4A55] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[#1A4A55] flex items-center justify-between bg-[#002B36]/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#B58900]/20 border border-[#B58900]/40 flex items-center justify-center text-[#B58900]">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#FDF6E3]">Stage Color Theme</h2>
              <p className="text-[11px] text-[#93A1A1]">Live Performance & Full-Theme Customization</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close without saving"
            className="p-1.5 rounded-lg text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#002B36] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1 custom-scrollbar">
          {/* Preset Theme Cards */}
          {THEME_OPTIONS.map((theme) => {
            const isSelected = stagedTheme === theme.id
            return (
              <div
                key={theme.id}
                onClick={() => setStagedTheme(theme.id)}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 group ${
                  isSelected
                    ? 'bg-[#002B36] border-[#2AA198] shadow-md ring-1 ring-[#2AA198]/40'
                    : 'bg-[#002B36]/50 border-[#1A4A55]/60 hover:border-[#2AA198]/50 hover:bg-[#002B36]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Swatch Preview Box */}
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 shadow-inner relative overflow-hidden"
                    style={{
                      backgroundColor: theme.bgHex,
                      borderColor: theme.accentHex,
                    }}
                  >
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: theme.accentHex }}
                    />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-bold leading-tight ${
                          isSelected ? 'text-[#FDF6E3]' : 'text-[#EEE8D5] group-hover:text-[#FDF6E3]'
                        }`}
                      >
                        {theme.name}
                      </span>
                      {theme.tag && (
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-[#073642] text-[#2AA198] border border-[#1A4A55]">
                          {theme.tag}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div
                  className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                    isSelected
                      ? 'border-[#2AA198] bg-[#2AA198] text-[#002B36]'
                      : 'border-[#1A4A55] bg-[#073642] group-hover:border-[#2AA198]'
                  }`}
                >
                  {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </div>
            )
          })}

          {/* Custom Theme Option Card */}
          <div
            onClick={() => setStagedTheme('custom')}
            className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col gap-3 group ${
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
                          ? 'text-[#FDF6E3]'
                          : 'text-[#EEE8D5] group-hover:text-[#FDF6E3]'
                      }`}
                    >
                      Custom Palette
                    </span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-[#073642] text-amber-400 border border-[#1A4A55]">
                      CUSTOM
                    </span>
                  </div>
                </div>
              </div>

              <div
                className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                  stagedTheme === 'custom'
                    ? 'border-[#2AA198] bg-[#2AA198] text-[#002B36]'
                    : 'border-[#1A4A55] bg-[#073642] group-hover:border-[#2AA198]'
                }`}
              >
                {stagedTheme === 'custom' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
              </div>
            </div>

            {/* Custom Theme Color Controls (Expanded when Custom is selected) */}
            {stagedTheme === 'custom' && (
              <div
                className="mt-2 pt-3 border-t border-[#1A4A55]/70 space-y-3"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Live Sample Preview Box (Contextual based on active section) */}
                <div
                  className="p-3 rounded-xl border border-white/10 shadow-inner transition-colors"
                  style={{
                    backgroundColor:
                      activeGroup === 'chrome'
                        ? stagedCustomColors.headerBg || DEFAULT_CUSTOM_COLORS.headerBg
                        : activeGroup === 'cards'
                        ? stagedCustomColors.songCardBg || DEFAULT_CUSTOM_COLORS.songCardBg
                        : activeGroup === 'stageControls'
                        ? stagedCustomColors.dockBg || DEFAULT_CUSTOM_COLORS.dockBg
                        : stagedCustomColors.bgHex,
                  }}
                >
                  <div
                    className="flex items-center justify-between text-[10px] font-mono opacity-70 mb-1.5 border-b border-white/10 pb-1"
                    style={{
                      color:
                        activeGroup === 'chrome'
                          ? stagedCustomColors.iconColor || DEFAULT_CUSTOM_COLORS.iconColor
                          : stagedCustomColors.textHex,
                    }}
                  >
                    <span className="flex items-center gap-1 font-bold">
                      <Sliders className="w-3 h-3" /> LIVE PREVIEW • {currentGroupDef.label.toUpperCase()}
                    </span>
                    <span>
                      {activeGroup === 'stage'
                        ? 'Teleprompter'
                        : activeGroup === 'chrome'
                        ? 'App Shell'
                        : activeGroup === 'cards'
                        ? 'Card Surfaces'
                        : activeGroup === 'controls'
                        ? 'Controls & Inputs'
                        : 'Stage Floating Dock'}
                    </span>
                  </div>

                  {activeGroup === 'stage' && (
                    <div>
                      <div
                        className="text-[11px] font-mono font-bold mb-1"
                        style={{ color: stagedCustomColors.sectionHex }}
                      >
                        [Chorus 1]
                      </div>
                      <div
                        className="font-mono font-bold text-xs mb-0.5 tracking-wider"
                        style={{ color: stagedCustomColors.chordHex }}
                      >
                        G            Em7           Cadd9        D
                      </div>
                      <div
                        className="font-mono text-xs"
                        style={{ color: stagedCustomColors.textHex }}
                      >
                        Amazing grace how sweet the sound that saved a wretch like me
                      </div>
                    </div>
                  )}

                  {activeGroup === 'chrome' && (
                    <div className="space-y-2">
                      <div
                        className="flex items-center justify-between p-1.5 rounded-lg border"
                        style={{
                          backgroundColor: stagedCustomColors.toolbarBg || DEFAULT_CUSTOM_COLORS.toolbarBg,
                          borderColor: stagedCustomColors.searchBorder || DEFAULT_CUSTOM_COLORS.searchBorder,
                        }}
                      >
                        <div
                          className="flex items-center gap-1 text-[11px] font-bold"
                          style={{ color: stagedCustomColors.iconColor || DEFAULT_CUSTOM_COLORS.iconColor }}
                        >
                          <Palette className="w-3.5 h-3.5" />
                          <span>GTAR-Dev</span>
                        </div>
                        <div
                          className="px-2 py-0.5 rounded text-[10px] font-mono border"
                          style={{
                            backgroundColor: stagedCustomColors.searchBg || DEFAULT_CUSTOM_COLORS.searchBg,
                            borderColor: stagedCustomColors.searchBorder || DEFAULT_CUSTOM_COLORS.searchBorder,
                            color: stagedCustomColors.textHex,
                          }}
                        >
                          Search songs...
                        </div>
                      </div>
                    </div>
                  )}

                  {activeGroup === 'cards' && (
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div
                        className="p-2 rounded-lg border font-mono font-bold"
                        style={{
                          backgroundColor: stagedCustomColors.setlistCardBg || DEFAULT_CUSTOM_COLORS.setlistCardBg,
                          borderColor: stagedCustomColors.cardBorder || DEFAULT_CUSTOM_COLORS.cardBorder,
                          color: stagedCustomColors.textHex,
                        }}
                      >
                        Setlist Card
                        <span className="block text-[9px] font-normal opacity-70">12 songs</span>
                      </div>
                      <div
                        className="p-2 rounded-lg border font-mono font-bold shadow-md"
                        style={{
                          backgroundColor: stagedCustomColors.selectedCardBg || DEFAULT_CUSTOM_COLORS.selectedCardBg,
                          borderColor: stagedCustomColors.selectedCardBorder || DEFAULT_CUSTOM_COLORS.selectedCardBorder,
                          color: stagedCustomColors.textHex,
                        }}
                      >
                        Selected Card
                        <span className="block text-[9px] font-normal" style={{ color: stagedCustomColors.chordHex }}>Active selection</span>
                      </div>
                    </div>
                  )}

                  {activeGroup === 'controls' && (
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-lg font-semibold text-[11px] shadow-sm"
                        style={{
                          backgroundColor: stagedCustomColors.buttonBg || DEFAULT_CUSTOM_COLORS.buttonBg,
                          color: stagedCustomColors.buttonText || DEFAULT_CUSTOM_COLORS.buttonText,
                          border: `1px solid ${stagedCustomColors.accentColor || DEFAULT_CUSTOM_COLORS.accentColor}`,
                        }}
                      >
                        Action Button
                      </button>
                      <input
                        type="text"
                        readOnly
                        value="Sample input..."
                        className="px-2 py-1 rounded-lg text-[11px] font-mono border flex-1"
                        style={{
                          backgroundColor: stagedCustomColors.inputBg || DEFAULT_CUSTOM_COLORS.inputBg,
                          color: stagedCustomColors.inputText || DEFAULT_CUSTOM_COLORS.inputText,
                          borderColor: stagedCustomColors.inputBorder || DEFAULT_CUSTOM_COLORS.inputBorder,
                        }}
                      />
                    </div>
                  )}

                  {activeGroup === 'stageControls' && (
                    <div className="flex items-center justify-center gap-2">
                      <div
                        className="p-1.5 rounded-full border flex items-center gap-2 shadow-lg"
                        style={{
                          backgroundColor: stagedCustomColors.dockBg || DEFAULT_CUSTOM_COLORS.dockBg,
                          borderColor: stagedCustomColors.dockBorder || DEFAULT_CUSTOM_COLORS.dockBorder,
                        }}
                      >
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center"
                          style={{
                            backgroundColor: stagedCustomColors.dockBtnBg || DEFAULT_CUSTOM_COLORS.dockBtnBg,
                            color: stagedCustomColors.dockBtnIcon || DEFAULT_CUSTOM_COLORS.dockBtnIcon,
                          }}
                        >
                          ▲
                        </div>
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-md"
                          style={{
                            backgroundColor: stagedCustomColors.dockPlayBg || DEFAULT_CUSTOM_COLORS.dockPlayBg,
                            color: stagedCustomColors.dockPlayIcon || DEFAULT_CUSTOM_COLORS.dockPlayIcon,
                          }}
                        >
                          ▶
                        </div>
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center"
                          style={{
                            backgroundColor: stagedCustomColors.dockBtnBg || DEFAULT_CUSTOM_COLORS.dockBtnBg,
                            color: stagedCustomColors.dockBtnIcon || DEFAULT_CUSTOM_COLORS.dockBtnIcon,
                          }}
                        >
                          ▼
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Section Group Switcher Tabs & Reset Button */}
                <div className="flex items-center justify-between gap-1 border-b border-[#1A4A55]/60 pb-2">
                  <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
                    {PALETTE_GROUPS.map((grp) => {
                      const isActive = activeGroup === grp.id
                      const IconComponent = grp.icon
                      return (
                        <button
                          key={grp.id}
                          type="button"
                          onClick={() => setActiveGroup(grp.id)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                            isActive
                              ? 'bg-[#2AA198] text-[#002B36] shadow-sm'
                              : 'bg-[#073642]/60 hover:bg-[#073642] text-[#EEE8D5] hover:text-[#FDF6E3] border border-[#1A4A55]/50'
                          }`}
                        >
                          <IconComponent className="w-3.5 h-3.5" />
                          <span>{grp.label}</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Reset Custom Palette Button */}
                  <button
                    type="button"
                    onClick={handleResetCustomPalette}
                    title="Reset custom palette to sensible defaults"
                    className="px-2 py-1 rounded-lg text-[11px] font-mono text-[#93A1A1] hover:text-[#FDF6E3] hover:bg-[#073642] border border-[#1A4A55]/50 flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span className="hidden sm:inline">Reset Defaults</span>
                  </button>
                </div>

                {/* Color Rows for Current Active Group */}
                <div className="space-y-2.5 max-h-[260px] overflow-y-auto pr-1 custom-scrollbar">
                  {currentGroupDef.fields.map((item) => {
                    const value = stagedCustomColors[item.key] || DEFAULT_CUSTOM_COLORS[item.key] || '#000000'
                    return (
                      <div
                        key={item.key}
                        className="p-2.5 rounded-xl bg-[#073642]/60 border border-[#1A4A55]/50 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-xs font-semibold text-[#EEE8D5] block leading-tight">
                              {item.label}
                            </span>
                            <span className="text-[10px] text-[#93A1A1] block mt-0.5">
                              {item.desc}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {/* Color Picker Swatch Button */}
                            <label
                              className="relative w-7 h-7 rounded-lg border border-white/20 shadow flex items-center justify-center cursor-pointer overflow-hidden hover:scale-105 transition-transform"
                              style={{ backgroundColor: value }}
                              title={`Choose ${item.label}`}
                            >
                              <input
                                type="color"
                                value={value}
                                onChange={(e) => updateColor(item.key, e.target.value)}
                                className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                              />
                            </label>

                            {/* Hex Input */}
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => {
                                let val = e.target.value.trim()
                                if (val.length > 0 && !val.startsWith('#')) {
                                  val = `#${val}`
                                }
                                updateColor(item.key, val)
                              }}
                              className="w-19 px-2 py-1 bg-[#002B36] border border-[#1A4A55] rounded-lg text-xs font-mono text-[#FDF6E3] focus:outline-none focus:border-amber-400"
                              maxLength={7}
                              placeholder="#000000"
                            />
                          </div>
                        </div>

                        {/* Quick Swatches Row */}
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <span className="text-[10px] font-mono text-[#93A1A1] mr-0.5">Quick:</span>
                          {item.swatches.map((hex) => {
                            const isMatch = value.toLowerCase() === hex.toLowerCase()
                            return (
                              <button
                                key={hex}
                                type="button"
                                onClick={() => updateColor(item.key, hex)}
                                className={`w-4 h-4 rounded-full border transition-all cursor-pointer ${
                                  isMatch
                                    ? 'scale-125 ring-2 ring-amber-400 border-white'
                                    : 'border-white/30 hover:scale-110 opacity-75 hover:opacity-100'
                                }`}
                                style={{ backgroundColor: hex }}
                                title={hex}
                              />
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-[#1A4A55] bg-[#002B36]/80 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-[#1A4A55] bg-[#073642]/60 hover:bg-[#073642] text-[#EEE8D5] hover:text-[#FDF6E3] font-medium text-xs sm:text-sm cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveAndApply}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs sm:text-sm cursor-pointer transition-all shadow-md active:scale-95 flex items-center gap-1.5"
          >
            Save & Apply
          </button>
        </div>
      </div>
    </div>
  )
}
