# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

## Legacy Drive state retirement (2026-09-15)

Startup validates canonical song IDs, record fields and setlist references before retiring legacy storage. Acknowledged pending uploads (full libraries or baseline-relative deltas) reconcile against their pre-upload library. Independent additions can be recovered; conflicting edits, uncertain uploads, malformed records and unknown snapshot formats require manual recovery.

Recovery snapshots and divergent legacy stores are reconciled only when their contents can be preserved unambiguously. The migrated canonical library is written and read back before the retirement marker or any source deletion. An existing retirement marker does not bypass inspection of remaining sources. Retries are idempotent, including interrupted cleanup.

Quota recovery trims debug logs only. It never deletes journals, recovery snapshots or legacy song/setlist stores to make room. If reconciliation or persistence fails, original sources remain. Startup displays **Export recovery data**; its JSON contains the raw canonical, legacy and Drive recovery storage values. Save that file before clearing storage. It is a recovery archive for manual reconciliation, not a normal songbook backup. A malformed canonical library blocks library editing to prevent accidental overwrite; valid canonical data remains usable when legacy reconciliation is unresolved.

Regression coverage: `tests/storageRetirement.test.cjs`, `tests/syncJournal.test.cjs`, and `tests/adversarialDev13.test.cjs`. Run `npm test`, `npm run lint:sync`, and `npm run build` from `web`.
