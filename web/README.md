# GTAR Web/PWA

GTAR's active implementation is the Web/PWA app. Historical native Android code belongs in [ozzzmond/GTAR-Android-Legacy](https://github.com/ozzzmond/GTAR-Android-Legacy).

## Local development

Run commands from `web`. Install dependencies with `npm install`.

On Windows, use `Run_Full_Stack_Dev.bat` as the normal local entry point. It applies/verifies local D1 migrations and starts the frontend at http://localhost:5173 and the local Cloudflare Pages Functions/API at http://localhost:8788. Port 5173 must be available; Vite enforces a strict port for the canonical local origin.

Use `Run_API_Dev.bat` for the backend only. It also applies/verifies local D1 migrations before starting the API.

`npm run dev` starts the Vite frontend; use the API helper when local backend access is needed.

## Development checks

- `npm test` — Web/PWA regression tests.
- `npm run lint` — whole-tree ESLint checks.
- `npm run lint:sync` — focused sync and storage utility lint checks.
- `npm run build` — TypeScript checks and production Web/PWA build.

## Legacy Drive state retirement (2026-09-15)

Startup validates canonical song IDs, record fields and setlist references before retiring legacy storage. Acknowledged pending uploads (full libraries or baseline-relative deltas) reconcile against their pre-upload library. Independent additions can be recovered; conflicting edits, uncertain uploads, malformed records and unknown snapshot formats require manual recovery.

Recovery snapshots and divergent legacy stores are reconciled only when their contents can be preserved unambiguously. The migrated canonical library is written and read back before the retirement marker or any source deletion. An existing retirement marker does not bypass inspection of remaining sources. Retries are idempotent, including interrupted cleanup.

Quota recovery trims debug logs only. It never deletes journals, recovery snapshots or legacy song/setlist stores to make room. If reconciliation or persistence fails, original sources remain. Startup displays **Export recovery data**; its JSON contains the raw canonical, legacy and Drive recovery storage values. Save that file before clearing storage. It is a recovery archive for manual reconciliation, not a normal songbook backup. A malformed canonical library blocks library editing to prevent accidental overwrite; valid canonical data remains usable when legacy reconciliation is unresolved.

Regression coverage: `tests/storageRetirement.test.cjs`, `tests/syncJournal.test.cjs`, and `tests/adversarialDev13.test.cjs`. Run `npm test`, `npm run lint:sync`, and `npm run build` from `web`.
