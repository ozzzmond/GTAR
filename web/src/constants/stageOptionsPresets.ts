import type { StageChordScale, StageFontWeight, StageLineSpacing } from '../components/SongLineRenderer'

export type WakeLockStatus = 'active' | 'denied' | 'unsupported' | 'disabled' | 'acquiring' | 'inactive'

export const STAGE_SIZE_PRESETS = [
  { label: 'S', value: 16 },
  { label: 'M', value: 20 },
  { label: 'L', value: 24 },
  { label: 'XL', value: 30 },
]

export const CHORD_SCALE_PRESETS: Array<{ label: string; value: StageChordScale }> = [
  { label: '100%', value: 1.0 },
  { label: '110%', value: 1.1 },
  { label: '120%', value: 1.2 },
  { label: '130%', value: 1.3 },
]

export const FONT_WEIGHT_PRESETS: Array<{ label: string; value: StageFontWeight }> = [
  { label: 'Regular', value: 'regular' },
  { label: 'Medium', value: 'medium' },
  { label: 'Bold', value: 'bold' },
]

export const LINE_SPACING_PRESETS: Array<{ label: string; value: StageLineSpacing }> = [
  { label: 'Compact', value: 'compact' },
  { label: 'Normal', value: 'normal' },
  { label: 'Relaxed', value: 'relaxed' },
]

export const FONT_FAMILY_PRESETS: Array<{ label: string; value: 'mono' | 'sans' | 'serif' }> = [
  { label: 'Mono', value: 'mono' },
  { label: 'Sans', value: 'sans' },
  { label: 'Serif', value: 'serif' },
]
