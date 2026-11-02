/** #319: Music Explorer sidebar width clamp (px). GTAR1's fixed aside is 256px (md) / 288px (lg). */
export const EXPLORER_MIN_WIDTH = 220
export const EXPLORER_MAX_WIDTH = 440

export const clampExplorerWidth = (value: number): number =>
  Math.round(Math.min(EXPLORER_MAX_WIDTH, Math.max(EXPLORER_MIN_WIDTH, value)))
