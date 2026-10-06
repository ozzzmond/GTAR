import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dev-dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // These exact public helper exports predate the lint audit. Retain their API
  // and normal Vite importer invalidation instead of reorganizing theme/stage code.
  // New mixed exports remain errors; this does not enable arbitrary exports.
  { files: ['src/components/AuthGate.tsx'], rules: { 'react-refresh/only-export-components': ['error', { allowConstantExport: true, allowExportNames: ['useGoogleAuth'] }] } },
  { files: ['src/components/DesktopEditor.tsx'], rules: { 'react-refresh/only-export-components': ['error', { allowConstantExport: true, allowExportNames: ['createBlankCanonicalSong'] }] } },
  { files: ['src/components/StageControlDock.tsx'], rules: { 'react-refresh/only-export-components': ['error', { allowConstantExport: true, allowExportNames: ['DOCK_SIZE', 'DOCK_DEFAULT_MARGINS', 'getDefaultDockPosition', 'clampDockPosition', 'readPersistedDockPosition', 'persistDockPosition'] }] } },
  { files: ['src/components/StageView.tsx'], rules: { 'react-refresh/only-export-components': ['error', { allowConstantExport: true, allowExportNames: ['STAGE_SIZE_PRESETS', 'CHORD_SCALE_OPTIONS', 'FONT_WEIGHT_OPTIONS', 'LINE_SPACING_OPTIONS'] }] } },
  { files: ['src/components/SwipeableActionCard.tsx'], rules: { 'react-refresh/only-export-components': ['error', { allowConstantExport: true, allowExportNames: ['evaluateSwipeIntent', 'computeSwipeOffset'] }] } },
  { files: ['src/components/ThemeModal.tsx'], rules: { 'react-refresh/only-export-components': ['error', { allowConstantExport: true, allowExportNames: ['presetToCustomPalette', 'DEFAULT_CUSTOM_COLORS', 'normalizeCustomThemeColors', 'applyCustomThemeStyles', 'THEME_OPTIONS', 'PALETTE_GROUPS', 'loadFactoryThemeOverrides', 'resolveThemePalette', 'applyThemeRuntime', 'hydrateThemeSettings'] }] } },
])
