import { SETTINGS_KEYS } from '../utils/backupSettings'
import React, { useState, useEffect } from 'react'
import { X, Check, Palette, Sliders } from 'lucide-react'

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
  bgHex: '#121820',
  textHex: '#F1F5F9',
  chordHex: '#F59E0B',
  sectionHex: '#A78BFA',
}

export function applyCustomThemeStyles(colors: CustomThemeColors) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--custom-stage-bg', colors.bgHex)
  root.style.setProperty('--custom-stage-text', colors.textHex)
  root.style.setProperty('--custom-stage-chord', colors.chordHex)
  root.style.setProperty('--custom-stage-section', colors.sectionHex)

  // Calculate surface & border based on bg brightness
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
    return customColors ? { ...customColors } : { ...DEFAULT_CUSTOM_COLORS }
  })

  // Synchronize internal staged state whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setStagedTheme(currentTheme)
      setStagedCustomColors(customColors ? { ...customColors } : { ...DEFAULT_CUSTOM_COLORS })
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

  const updateColor = (key: keyof CustomThemeColors, value: string) => {
    setStagedCustomColors((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const COLOR_CONFIGS = [
    {
      key: 'bgHex' as const,
      label: 'Background Color',
      desc: 'Canvas & stage background',
      value: stagedCustomColors.bgHex,
      swatches: BG_SWATCHES,
    },
    {
      key: 'textHex' as const,
      label: 'Primary Lyric Text Color',
      desc: 'Song lyrics and body lines',
      value: stagedCustomColors.textHex,
      swatches: TEXT_SWATCHES,
    },
    {
      key: 'chordHex' as const,
      label: 'Chord Highlight Color',
      desc: 'Chord notations & root accents',
      value: stagedCustomColors.chordHex,
      swatches: CHORD_SWATCHES,
    },
    {
      key: 'sectionHex' as const,
      label: 'Section Header Color',
      desc: '[Verse], [Chorus], [Bridge] headers',
      value: stagedCustomColors.sectionHex,
      swatches: SECTION_SWATCHES,
    },
  ]

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
              <p className="text-[11px] text-[#93A1A1]">Live Performance & Teleprompter Palette</p>
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
                {/* Live Sample Preview Box */}
                <div
                  className="p-3 rounded-xl border border-white/10 shadow-inner transition-colors"
                  style={{ backgroundColor: stagedCustomColors.bgHex }}
                >
                  <div className="flex items-center justify-between text-[10px] font-mono opacity-60 mb-1.5 border-b border-white/10 pb-1" style={{ color: stagedCustomColors.textHex }}>
                    <span className="flex items-center gap-1 font-bold">
                      <Sliders className="w-3 h-3" /> LIVE PREVIEW
                    </span>
                    <span>Teleprompter Palette</span>
                  </div>
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

                {/* 4 Custom Color Rows */}
                <div className="space-y-2.5">
                  {COLOR_CONFIGS.map((item) => (
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
                            style={{ backgroundColor: item.value }}
                            title={`Choose ${item.label}`}
                          >
                            <input
                              type="color"
                              value={item.value}
                              onChange={(e) => updateColor(item.key, e.target.value)}
                              className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                            />
                          </label>

                          {/* Hex Input */}
                          <input
                            type="text"
                            value={item.value}
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
                          const isMatch = item.value.toLowerCase() === hex.toLowerCase()
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
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer (Clean: Sparkle tag removed, Cancel & Save/Apply action buttons) */}
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

