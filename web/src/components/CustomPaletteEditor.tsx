import { FONT_TARGETS, BUILTIN_FONTS, normalizeFontSettings, validateFontSettings, fontStack, loadFontResources, type FontChoice } from '../utils/customFonts'
import React, { useState, useEffect } from 'react'
import {
  X,
  Sliders,
  RotateCcw,
  Download,
  Upload,
  Copy,
  Check,
  Palette,
  AlertCircle,
} from 'lucide-react'
import { validateCustomThemeIdentity, CUSTOM_THEME_NAME_MAX_LENGTH, type CustomThemeColors } from '../utils/backupSettings'
import {
  DEFAULT_CUSTOM_COLORS,
  normalizeCustomThemeColors,
  PALETTE_GROUPS,
  type PaletteSectionGroup,
} from './ThemeModal'
import {
  exportCustomPaletteJson,
  importCustomPaletteJson,
} from '../utils/customPaletteJson'

export interface CustomPaletteEditorProps {
  isOpen: boolean
  onClose: () => void
  customColors?: CustomThemeColors
  onSaveAndApply: (colors: CustomThemeColors) => void
}

export const CustomPaletteEditor: React.FC<CustomPaletteEditorProps> = ({
  isOpen,
  onClose,
  customColors,
  onSaveAndApply,
}) => {
  const [stagedColors, setStagedColors] = useState<CustomThemeColors>(() =>
    normalizeCustomThemeColors(customColors)
  )
  const [activeGroup, setActiveGroup] = useState<PaletteSectionGroup>('stage')
  const [jsonModalMode, setJsonModalMode] = useState<'export' | 'import' | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [jsonStatus, setJsonStatus] = useState<{ message: string; isError: boolean } | null>(null)
  const [copiedNotification, setCopiedNotification] = useState(false)

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Opening the editor creates a fresh draft from the externally controlled palette.
      setStagedColors(normalizeCustomThemeColors(customColors))
      setActiveGroup('stage')
      setJsonModalMode(null)
      setJsonStatus(null)
      setCopiedNotification(false)
    }
  }, [isOpen, customColors])

  useEffect(() => {
    if (isOpen) loadFontResources(normalizeFontSettings(stagedColors.fonts))
  }, [isOpen, stagedColors.fonts])

  if (!isOpen) return null

  const handleSaveAndApply = () => {
    const errors = [...validateFontSettings(stagedColors.fonts || {}), ...(stagedColors.identity ? validateCustomThemeIdentity(stagedColors.identity) : [])]
    if (errors.length) { setJsonStatus({ message: errors.join('; '), isError: true }); return }
    onSaveAndApply(normalizeCustomThemeColors(stagedColors))
    onClose()
  }

  const handleResetDefaults = () => {
    setStagedColors({ ...DEFAULT_CUSTOM_COLORS, ...(stagedColors.identity ? { identity: { ...stagedColors.identity } } : {}) })
    setJsonStatus(null)
  }

  const updateColor = (key: Exclude<keyof CustomThemeColors, 'fonts' | 'identity'>, value: string) => {
    setStagedColors((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const handleOpenExport = () => {
    const payload = exportCustomPaletteJson(stagedColors)
    setJsonText(JSON.stringify(payload, null, 2))
    setJsonStatus(null)
    setJsonModalMode('export')
  }

  const handleOpenImport = () => {
    setJsonText('')
    setJsonStatus(null)
    setJsonModalMode('import')
  }

  const handleCopyJson = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(jsonText)
      }
      setCopiedNotification(true)
      setTimeout(() => setCopiedNotification(false), 2000)
    } catch {
      // Fallback
      setCopiedNotification(true)
      setTimeout(() => setCopiedNotification(false), 2000)
    }
  }

  const handleApplyImport = () => {
    const result = importCustomPaletteJson(jsonText)
    if (!result.success) {
      setJsonStatus({ message: result.error, isError: true })
      return
    }
    // Apply imported values to the editor preview only (stagedColors), not persistent yet
    setStagedColors({ ...result.colors, identity: stagedColors.identity ? { ...stagedColors.identity } : undefined })
    setJsonStatus({ message: 'Palette successfully imported into editor preview!', isError: false })
    setTimeout(() => {
      setJsonModalMode(null)
      setJsonStatus(null)
    }, 800)
  }

  const currentGroupDef = PALETTE_GROUPS.find((g) => g.id === activeGroup) || PALETTE_GROUPS[0]

  return (
    <div
      data-testid="custom-palette-editor-overlay"
      className="theme-studio fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/80 backdrop-blur-sm animate-fade-in select-none"
    >
      <div
        data-testid="custom-palette-editor-window"
        className="w-full max-w-5xl rounded-2xl bg-app-surface border border-app-border shadow-2xl overflow-hidden flex flex-col max-h-[94vh] sm:max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-app-border flex items-center justify-between bg-app-base/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-app-accent/20 border border-app-accent/40 flex items-center justify-center text-app-accent">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold ui-primary-text text-app-heading">Custom Palette Editor</h2>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-app-base text-app-accent border border-app-border">
                  V2
                </span>
              </div>
              <p className="text-[11px] ui-muted-text text-app-muted">Fine-grained performance colors & responsive dock tuning</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              data-testid="export-palette-btn"
              onClick={handleOpenExport}
              title="Export palette as JSON"
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium ui-primary-text text-app-text hover:text-app-heading bg-app-base/70 hover:bg-app-base border border-app-border flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-app-accent" />
              <span className="hidden sm:inline">Export JSON</span>
            </button>
            <button
              type="button"
              data-testid="import-palette-btn"
              onClick={handleOpenImport}
              title="Import palette from JSON"
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium ui-primary-text text-app-text hover:text-app-heading bg-app-base/70 hover:bg-app-base border border-app-border flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-app-action" />
              <span className="hidden sm:inline">Import JSON</span>
            </button>
            <button
              type="button"
              data-testid="close-palette-editor-btn"
              onClick={onClose}
              title="Close without saving"
              className="p-1.5 rounded-lg ui-muted-text text-app-muted hover:text-app-heading hover:bg-app-base transition-colors cursor-pointer ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Category Navigation Bar (Sticky/Obvious across all screens) */}
        <div className="px-4 sm:px-6 py-2 border-b border-app-border/70 bg-app-base/50 flex items-center justify-between gap-2 shrink-0">
          <div
            data-testid="palette-category-nav"
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5"
          >
            {PALETTE_GROUPS.map((grp) => {
              const isActive = activeGroup === grp.id
              const IconComponent = grp.icon
              return (
                <button
                  key={grp.id}
                  type="button"
                  data-testid={`category-tab-${grp.id}`}
                  onClick={() => setActiveGroup(grp.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-app-action text-app-on-action shadow-md ring-1 ring-app-action/60 font-bold'
                      : 'bg-app-surface/80 hover:bg-app-surface ui-primary-text text-app-text hover:text-app-heading border border-app-border/60'
                  }`}
                >
                  <IconComponent className="w-3.5 h-3.5" />
                  <span>{grp.label}</span>
                </button>
              )
            })}
          </div>

          <button
            type="button"
            data-testid="reset-palette-defaults-btn"
            onClick={handleResetDefaults}
            title="Reset palette to default values"
            className="px-2.5 py-1.5 rounded-xl text-[11px] font-mono ui-muted-text text-app-muted hover:text-app-heading hover:bg-app-base border border-app-border/60 flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset Defaults</span>
          </button>
        </div>

        {/* Responsive Content Area: Two-column on md+ (Desktop/Tablet), Single-column stacked on Mobile */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-0">
          {/* Controls Column (7 cols on Desktop/Tablet, full on Mobile) */}
          <div
            data-testid="palette-editor-controls-pane"
            className="md:col-span-7 p-4 sm:p-5 overflow-y-auto space-y-3 custom-scrollbar border-b md:border-b-0 md:border-r border-app-border/60"
          >
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs font-bold uppercase tracking-wider ui-muted-text text-app-muted">
                Category: {currentGroupDef.label} ({currentGroupDef.fields.length} controls)
              </span>
            </div>

            {stagedColors.identity && <label className="ui-primary-text block text-xs">Custom theme name
              <input aria-label="Custom theme name" maxLength={CUSTOM_THEME_NAME_MAX_LENGTH} className="block w-full p-2 border rounded-lg mt-1" value={stagedColors.identity.displayName} onChange={e => setStagedColors(prev => ({ ...prev, identity: { ...prev.identity!, displayName: e.target.value } }))} />
            </label>}
            {activeGroup === 'typography' && (
              <div data-testid="font-settings" className="space-y-3 text-xs ui-primary-text text-app-text">
                {FONT_TARGETS.map(target => {
                  const choice = stagedColors.fonts?.[target] || { source: 'system' as const }
                  const update = (next: FontChoice) => setStagedColors(prev => ({ ...prev, fonts: { ...prev.fonts, [target]: next } }))
                  return <fieldset key={target} className="p-3 border border-app-border rounded-xl space-y-2">
                    <legend>{target === 'ui' ? 'UI' : target === 'stage' ? 'Stage / lyrics' : 'Heading'} font</legend>
                    <label className="block">Source
                      <select aria-label={`${target} font source`} value={choice.source} className="block w-full bg-app-base p-2 rounded" onChange={e => {
                        const source = e.target.value as FontChoice['source']
                        update(source === 'system' ? { source } : { source, family: 'Inter', ...(['stylesheet', 'webfont'].includes(source) ? { url: '' } : {}) })
                      }}>
                        <option value="system">System / default</option><option value="builtin">GTAR built-in</option>
                        <option value="google">Google Fonts</option><option value="stylesheet">HTTPS stylesheet</option><option value="webfont">HTTPS web-font file</option>
                      </select>
                    </label>
                    {choice.source === 'builtin' ? <label className="block">Family<select aria-label={`${target} font family`} value={choice.family} className="block w-full bg-app-base p-2" onChange={e => update({ ...choice, family: e.target.value })}>{BUILTIN_FONTS.map(family => <option key={family}>{family}</option>)}</select></label>
                      : choice.source !== 'system' && <label className="block">Family<input aria-label={`${target} font family`} value={choice.family || ''} maxLength={80} className="block w-full bg-app-base p-2" onChange={e => update({ ...choice, family: e.target.value })} /></label>}
                    {['stylesheet', 'webfont'].includes(choice.source) && <label className="block">HTTPS URL<input aria-label={`${target} font URL`} type="url" value={choice.url || ''} className="block w-full bg-app-base p-2" onChange={e => update({ ...choice, url: e.target.value })} /></label>}
                  </fieldset>
                })}
                <p>External fonts load only for configured previews. Unavailable fonts use a local fallback. Stage default preserves Mono / Sans / Serif.</p>
              </div>
            )}
            {jsonStatus?.isError && <p role="alert" className="text-status-error text-xs">{jsonStatus.message}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-2.5">
              {currentGroupDef.fields.map((item) => {
                const value = stagedColors[item.key] || DEFAULT_CUSTOM_COLORS[item.key] || '#000000'
                return (
                  <div
                    key={item.key}
                    data-testid={`color-control-${item.key}`}
                    className="p-3 rounded-xl bg-app-base/60 border border-app-border/60 space-y-2 hover:border-app-action/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs font-bold ui-primary-text text-app-heading block leading-tight">
                          {item.label}
                        </span>
                        <span className="text-[10px] ui-muted-text text-app-muted block mt-0.5 truncate max-w-[200px] sm:max-w-xs">
                          {item.desc}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Native Color Picker Swatch Button */}
                        <label
                          className="relative w-8 h-8 rounded-xl border border-app-border/20 shadow-md flex items-center justify-center cursor-pointer overflow-hidden hover:scale-105 transition-transform"
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
                          className="w-20 px-2 py-1.5 bg-app-surface border border-app-border rounded-xl text-xs font-mono ui-primary-text text-app-heading focus:outline-none focus:border-app-accent"
                          maxLength={7}
                          placeholder="#000000"
                        />
                      </div>
                    </div>

                    {/* Quick Swatches Row */}
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <span className="text-[10px] font-mono ui-muted-text text-app-muted mr-0.5">Quick:</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {item.swatches.map((hex) => {
                          const isMatch = value.toLowerCase() === hex.toLowerCase()
                          return (
                            <button
                              key={hex}
                              type="button"
                              onClick={() => updateColor(item.key, hex)}
                              className={`w-4 h-4 rounded-full border transition-all cursor-pointer ${
                                isMatch
                                  ? 'scale-125 ring-2 ring-app-accent border-app-border'
                                  : 'border-app-border/30 hover:scale-110 opacity-75 hover:opacity-100'
                              }`}
                              style={{ backgroundColor: hex }}
                              title={hex}
                            />
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Live Preview Column (5 cols on Desktop/Tablet, bottom pane on Mobile) */}
          <div
            data-testid="palette-editor-preview-pane"
            className="md:col-span-5 p-4 sm:p-5 overflow-y-auto space-y-3.5 bg-app-base/30 custom-scrollbar flex flex-col justify-start"
          >
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs font-bold uppercase tracking-wider ui-muted-text text-app-muted flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-app-accent" />
                Live Preview
              </span>
              <span className="text-[10px] font-mono text-app-action bg-app-surface px-2 py-0.5 rounded-full border border-app-border">
                {currentGroupDef.label} Context
              </span>
            </div>

            {/* Contextual Live Preview Display Box */}
            <div
              data-testid="palette-live-preview-box"
              className="p-4 rounded-2xl border border-app-border/10 shadow-xl transition-all"
              style={{
                fontFamily: fontStack(normalizeFontSettings(stagedColors.fonts).ui),
                backgroundColor:
                  activeGroup === 'chrome'
                    ? stagedColors.headerBg || DEFAULT_CUSTOM_COLORS.headerBg
                    : activeGroup === 'cards'
                    ? stagedColors.songCardBg || DEFAULT_CUSTOM_COLORS.songCardBg
                    : activeGroup === 'stageControls'
                    ? stagedColors.dockBg || DEFAULT_CUSTOM_COLORS.dockBg
                    : stagedColors.bgHex,
              }}
            >
              {/* Context Preview Subheader */}
              <div
                className="flex items-center justify-between text-[11px] font-mono opacity-80 mb-3 border-b border-app-border/10 pb-1.5"
                style={{
                  color:
                    activeGroup === 'stage' ? stagedColors.textHex : activeGroup === 'chrome' ? stagedColors.headerSecondaryText : stagedColors.uiMutedText,
                }}
              >
                <span className="font-bold flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5" />
                  {currentGroupDef.label.toUpperCase()} PREVIEW
                </span>
                <span>
                  {activeGroup === 'stage'
                    ? 'Lyrics & Chords'
                    : activeGroup === 'chrome'
                    ? 'Header & Toolbar'
                    : activeGroup === 'cards'
                    ? 'Library & Setlist'
                    : activeGroup === 'controls'
                    ? 'Buttons & Forms'
                    : 'Stage Jump Dock'}
                </span>
              </div>

              {activeGroup === 'typography' && <div data-testid="typography-preview" className="space-y-2">
                <h3 style={{ color: stagedColors.uiSectionText, fontFamily: fontStack(normalizeFontSettings(stagedColors.fonts).heading || normalizeFontSettings(stagedColors.fonts).ui, 'heading') }}>Songbook &amp; Gig Library</h3>
                <p style={{ color: stagedColors.uiPrimaryText }}>Amazing Grace — Primary text</p>
                <p style={{ color: stagedColors.uiSecondaryText }}>Artist · 12 songs · Secondary text</p>
                <p style={{ color: stagedColors.uiMutedText }}>Helper / muted text</p>
                <button type="button" style={{ color: stagedColors.uiLinkText }}>Manage — Link / action text</button>
                <p style={{ color: stagedColors.uiPrimaryText, fontFamily: fontStack(normalizeFontSettings(stagedColors.fonts).stage, 'stage') }}>Stage / lyrics font preview</p>
              </div>}
              {/* STAGE PREVIEW */}
              {activeGroup === 'stage' && (
                <div className="space-y-2 p-2">
                  <div
                    className="text-xs font-mono font-bold"
                    style={{ color: stagedColors.sectionHex }}
                  >
                    [Chorus 1]
                  </div>
                  <div
                    className="font-mono font-bold text-sm tracking-wider"
                    style={{ color: stagedColors.chordHex }}
                  >
                    G            Em7           Cadd9        D
                  </div>
                  <div
                    className="font-mono text-xs sm:text-sm leading-relaxed"
                    style={{ color: stagedColors.uiPrimaryText, fontFamily: fontStack(normalizeFontSettings(stagedColors.fonts).stage, 'stage') }}
                  >
                    Amazing grace how sweet the sound that saved a wretch like me
                  </div>
                </div>
              )}

              {/* CHROME PREVIEW */}
              {activeGroup === 'chrome' && (
                <div className="space-y-3">
                  <div data-testid="header-preview" className="flex items-center gap-2 p-2 rounded-xl" style={{ backgroundColor: stagedColors.headerBg }}>
                    <Palette data-testid="header-icon-preview" className="w-4 h-4" style={{ color: stagedColors.headerIconColor }} />
                    <span data-testid="header-primary-preview" className="text-xs font-bold" style={{ color: stagedColors.headerPrimaryText }}>GTAR-Dev</span>
                    <span data-testid="header-secondary-preview" className="text-[10px]" style={{ color: stagedColors.headerSecondaryText }}>Version</span>
                  </div>
                  <div
                    className="flex items-center justify-between p-2 rounded-xl border"
                    style={{
                      backgroundColor: stagedColors.toolbarBg || DEFAULT_CUSTOM_COLORS.toolbarBg,
                      borderColor: stagedColors.searchBorder || DEFAULT_CUSTOM_COLORS.searchBorder,
                    }}
                  >
                    <div
                      className="flex items-center gap-1.5 text-xs font-bold"
                      style={{ color: stagedColors.iconColor || DEFAULT_CUSTOM_COLORS.iconColor }}
                    >
                      <Palette className="w-4 h-4" />
                      <span>Toolbar</span>
                    </div>
                    <div
                      className="px-3 py-1 rounded-lg text-[11px] font-mono border"
                      style={{
                        backgroundColor: stagedColors.searchBg || DEFAULT_CUSTOM_COLORS.searchBg,
                        borderColor: stagedColors.searchBorder || DEFAULT_CUSTOM_COLORS.searchBorder,
                        color: stagedColors.uiPrimaryText,
                      }}
                    >
                      Search songs...
                    </div>
                  </div>

                  <div
                    className="p-2 rounded-lg text-[11px] font-medium text-center border"
                    style={{
                      backgroundColor: stagedColors.filterBarBg || DEFAULT_CUSTOM_COLORS.filterBarBg,
                      borderColor: stagedColors.searchBorder || DEFAULT_CUSTOM_COLORS.searchBorder,
                      color: stagedColors.uiPrimaryText,
                    }}
                  >
                    Filter: All Songs (24) • Sort by Title
                  </div>
                  <div data-testid="header-body-preview" className="p-2 rounded-xl" style={{ backgroundColor: stagedColors.songCardBg }}>
                    <p style={{ color: stagedColors.uiPrimaryText }}>Amazing Grace · Sunday Setlist</p>
                    <p style={{ color: stagedColors.uiSecondaryText }}>Artist · 12 songs</p>
                  </div>
                </div>
              )}

              {/* CARDS PREVIEW */}
              {activeGroup === 'cards' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  <div
                    className="p-3 rounded-xl border font-mono font-bold"
                    style={{
                      backgroundColor: stagedColors.setlistCardBg || DEFAULT_CUSTOM_COLORS.setlistCardBg,
                      borderColor: stagedColors.cardBorder || DEFAULT_CUSTOM_COLORS.cardBorder,
                      color: stagedColors.uiPrimaryText,
                    }}
                  >
                    Setlist Card
                    <span className="block text-[10px] font-normal opacity-70 mt-1">12 songs</span>
                  </div>
                  <div
                    className="p-3 rounded-xl border font-mono font-bold shadow-md"
                    style={{
                      backgroundColor: stagedColors.selectedCardBg || DEFAULT_CUSTOM_COLORS.selectedCardBg,
                      borderColor: stagedColors.selectedCardBorder || DEFAULT_CUSTOM_COLORS.selectedCardBorder,
                      color: stagedColors.uiPrimaryText,
                    }}
                  >
                    Selected Card
                    <span
                      className="block text-[10px] font-semibold mt-1"
                      style={{ color: stagedColors.chordHex }}
                    >
                      Active selection
                    </span>
                  </div>
                </div>
              )}

              {/* CONTROLS PREVIEW */}
              {activeGroup === 'controls' && (
                <div className="space-y-3">
                  <div data-testid="semantic-accents-preview" className="p-3 rounded-xl space-y-2" style={{ backgroundColor: stagedColors.songCardBg, fontFamily: fontStack(normalizeFontSettings(stagedColors.fonts).ui) }}>
                    <p data-testid="section-icon-preview" style={{ color: stagedColors.sectionIconColor }}>♫ Songs Library · Setlists</p>
                    <p data-testid="action-color-preview" style={{ color: stagedColors.actionColor }}>▶ Play · Select · Hide · Import · Manage</p>
                    <p data-testid="selection-color-preview" style={{ color: stagedColors.selectionColor }}>✓ Selected song</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="px-3.5 py-1.5 rounded-xl font-bold text-xs shadow-md"
                      style={{
                        backgroundColor: stagedColors.buttonBg || DEFAULT_CUSTOM_COLORS.buttonBg,
                        color: stagedColors.buttonText || DEFAULT_CUSTOM_COLORS.buttonText,
                        border: `1px solid ${stagedColors.accentColor || DEFAULT_CUSTOM_COLORS.accentColor}`,
                      }}
                    >
                      Action Button
                    </button>
                    <input
                      type="text"
                      readOnly
                      value="Interactive input"
                      className="px-3 py-1.5 rounded-xl text-xs font-mono border flex-1"
                      style={{
                        backgroundColor: stagedColors.inputBg || DEFAULT_CUSTOM_COLORS.inputBg,
                        color: stagedColors.inputText || DEFAULT_CUSTOM_COLORS.inputText,
                        borderColor: stagedColors.inputBorder || DEFAULT_CUSTOM_COLORS.inputBorder,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono px-1">
                    <span style={{ color: stagedColors.inputText || DEFAULT_CUSTOM_COLORS.inputText }}>
                      Focus Accent:
                    </span>
                    <span
                      className="font-bold px-2 py-0.5 rounded border"
                      style={{
                        borderColor: stagedColors.accentColor || DEFAULT_CUSTOM_COLORS.accentColor,
                        color: stagedColors.accentColor || DEFAULT_CUSTOM_COLORS.accentColor,
                      }}
                    >
                      {stagedColors.accentColor || DEFAULT_CUSTOM_COLORS.accentColor}
                    </span>
                  </div>
                </div>
              )}

              {/* STAGE CONTROLS PREVIEW */}
              {activeGroup === 'stageControls' && (
                <div className="flex flex-col items-center justify-center p-3 gap-3">
                  <div
                    className="p-2 rounded-full border flex items-center gap-3 shadow-2xl"
                    style={{
                      backgroundColor: stagedColors.dockBg || DEFAULT_CUSTOM_COLORS.dockBg,
                      borderColor: stagedColors.dockBorder || DEFAULT_CUSTOM_COLORS.dockBorder,
                    }}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow"
                      style={{
                        backgroundColor: stagedColors.dockBtnBg || DEFAULT_CUSTOM_COLORS.dockBtnBg,
                        color: stagedColors.dockBtnIcon || DEFAULT_CUSTOM_COLORS.dockBtnIcon,
                      }}
                    >
                      ▲
                    </div>
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shadow-lg"
                      style={{
                        backgroundColor: stagedColors.dockPlayBg || DEFAULT_CUSTOM_COLORS.dockPlayBg,
                        color: stagedColors.dockPlayIcon || DEFAULT_CUSTOM_COLORS.dockPlayIcon,
                      }}
                    >
                      ▶
                    </div>
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow"
                      style={{
                        backgroundColor: stagedColors.dockBtnBg || DEFAULT_CUSTOM_COLORS.dockBtnBg,
                        color: stagedColors.dockBtnIcon || DEFAULT_CUSTOM_COLORS.dockBtnIcon,
                      }}
                    >
                      ▼
                    </div>
                  </div>
                  <span
                    className="text-[10px] font-mono opacity-70"
                    style={{ color: stagedColors.uiPrimaryText, fontFamily: fontStack(normalizeFontSettings(stagedColors.fonts).stage, 'stage') }}
                  >
                    Floating Autoscroll & Jump Dock
                  </span>
                </div>
              )}
            </div>

            {/* Stage Quick Teleprompter Preview Card when on other tabs */}
            {activeGroup !== 'stage' && (
              <div
                className="p-3 rounded-xl border border-app-border/10 opacity-75 transition-colors text-[11px]"
                style={{
                  backgroundColor: stagedColors.bgHex,
                  color: stagedColors.uiPrimaryText,
                }}
              >
                <div className="font-mono font-bold" style={{ color: stagedColors.sectionHex }}>
                  [Verse]
                </div>
                <div className="font-mono text-xs font-semibold" style={{ color: stagedColors.chordHex }}>
                  C       Am       F       G
                </div>
                <div className="font-mono truncate">Stage lyric line sample preview</div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-app-border bg-app-base/80 flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            data-testid="cancel-palette-editor-btn"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-app-border bg-app-surface/60 hover:bg-app-surface ui-primary-text text-app-text hover:text-app-heading font-medium text-xs sm:text-sm cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="save-apply-palette-btn"
            onClick={handleSaveAndApply}
            className="px-5 py-2 rounded-xl bg-app-button hover:bg-app-button text-app-button-text font-semibold text-xs sm:text-sm cursor-pointer transition-all shadow-md active:scale-95 flex items-center gap-1.5"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            Save & Apply
          </button>
        </div>
      </div>

      {/* JSON Import/Export Sub-Modal */}
      {jsonModalMode && (
        <div
          data-testid="palette-json-modal"
          className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in"
        >
          <div className="w-full max-w-lg rounded-2xl bg-app-base border border-app-action/60 shadow-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-app-border pb-2.5">
              <div className="flex items-center gap-2">
                {jsonModalMode === 'export' ? (
                  <Download className="w-4 h-4 text-app-accent" />
                ) : (
                  <Upload className="w-4 h-4 text-app-action" />
                )}
                <h3 className="text-sm font-bold ui-primary-text text-app-heading">
                  {jsonModalMode === 'export' ? 'Export Custom Palette JSON' : 'Import Custom Palette JSON'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setJsonModalMode(null)}
                className="p-1 rounded-lg ui-muted-text text-app-muted hover:text-app-heading cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] ui-muted-text text-app-muted">
              {jsonModalMode === 'export'
                ? 'Copy this JSON to backup or share your custom palette colors.'
                : 'Paste custom palette JSON. Imported colors will apply to preview until saved.'}
            </p>

            <textarea
              data-testid="palette-json-textarea"
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value)
                setJsonStatus(null)
              }}
              readOnly={jsonModalMode === 'export'}
              rows={10}
              placeholder='{\n  "format": "gtar-custom-palette",\n  "version": 2,\n  "colors": { ... }\n}'
              className="w-full p-3 rounded-xl bg-app-surface border border-app-border text-xs font-mono ui-primary-text text-app-heading focus:outline-none focus:border-app-action custom-scrollbar"
            />

            {jsonStatus && (
              <div
                className={`p-2 rounded-xl text-xs flex items-center gap-2 ${
                  jsonStatus.isError
                    ? 'bg-rose-950/60 text-status-error border border-rose-800'
                    : 'bg-emerald-950/60 text-status-success border border-emerald-800'
                }`}
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{jsonStatus.message}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1 border-t border-app-border/60">
              <button
                type="button"
                onClick={() => setJsonModalMode(null)}
                className="px-3 py-1.5 rounded-xl border border-app-border bg-app-surface text-xs font-medium ui-primary-text text-app-text hover:text-app-heading cursor-pointer"
              >
                Close
              </button>

              {jsonModalMode === 'export' ? (
                <button
                  type="button"
                  data-testid="copy-json-btn"
                  onClick={handleCopyJson}
                  className="px-4 py-1.5 rounded-xl bg-app-button hover:bg-app-button text-app-button-text font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                >
                  {copiedNotification ? (
                    <>
                      <Check className="w-3.5 h-3.5 stroke-[3]" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copy JSON
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="apply-import-json-btn"
                  onClick={handleApplyImport}
                  className="px-4 py-1.5 rounded-xl bg-app-action hover:bg-app-action/90 text-app-on-action font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                >
                  <Upload className="w-3.5 h-3.5 stroke-[3]" /> Import & Preview
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
