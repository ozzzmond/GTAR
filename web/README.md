# GTAR Web/PWA

GTAR's active implementation is the Web/PWA app. Historical native Android code belongs in [ozzzmond/GTAR-Android-Legacy](https://github.com/ozzzmond/GTAR-Android-Legacy).

## Local development

Run commands from `web`. Install dependencies with `npm install`.

On Windows, use `Run_Full_Stack_Dev.bat` as the normal local entry point. It applies/verifies local D1 migrations and starts the frontend at http://localhost:5173 and the local Cloudflare Pages Functions/API at http://localhost:8788. Port 5173 must be available; Vite enforces a strict port for the canonical local origin.

Use `Run_API_Dev.bat` for the backend only. It also applies/verifies local D1 migrations before starting the API.

`npm run dev` starts the Vite frontend; use the API helper when local backend access is needed.

## Environment and account prerequisites

Use the Node runtime selected by GitHub Actions (Node 22) and npm. A pristine
checkout contains `package-lock.json`; `npm ci` reproduces its dependency set.
The npm scripts use the repository's local Vite, TypeScript and Wrangler tools.

For Google sign-in, configure the frontend `VITE_GOOGLE_CLIENT_ID` in the ignored
`.env.local` using `.env.example`. Register `http://localhost:5173` and each exact
hosted origin with the Google Web application OAuth client. See
[Google sign-in and server sync](GOOGLE_SYNC.md).

Supply these server bindings to the local Pages Functions runtime, separately
from frontend Vite variables:

- `DB`: the D1 binding in `wrangler.jsonc`; apply the tracked `migrations/*.sql`
  locally before backend use. Both BAT launchers run the local migration command.
- `GOOGLE_CLIENT_ID`, or the supported `VITE_GOOGLE_CLIENT_ID` alias: the OAuth
  audience verified by the server; use the same client as the frontend.
- `AUTH_SECRET`: a private HS256 session-signing secret, required locally and in
  each Cloudflare Pages production and DEV preview environment. Missing, empty,
  whitespace-only, non-string and retired public-fallback keys fail closed:
  session signing fails, verification rejects tokens, and authentication handlers
  return a generic 503 before identity lookup or database writes. There is no
  automatic local or deployed key. Never use a `VITE_` variable for this secret.
- `BOOTSTRAP_ADMIN_GOOGLE_SUB` or `BOOTSTRAP_ADMIN_EMAIL`: explicitly identify the
  intended first administrator on the server. First-login-wins is not supported.
  Other registrations start pending and require administrator approval.

Wrangler supports a local `.dev.vars` file for bindings/secrets. `.dev.vars` and
`.dev.vars.*` are repository-ignored by `web/.gitignore`. Real secret values must
never be committed. Do not assume frontend `.env.local` configures the API.
`TEST_MOCK_AUTH` is a test facility and must remain disabled in hosted environments.
Disposable unit tests supply their own explicit signing key; mock identities do
not bypass the signing-key requirement. Local API development requires a private
`AUTH_SECRET` in ignored `.dev.vars`; Vite alone does not supply server bindings.

Before deployment, an operator must verify that Pages has the private server
`AUTH_SECRET` binding in **both production and preview**, alongside the appropriate
`DB` and Google OAuth audience bindings. `wrangler.jsonc` does not establish that
hosted secrets exist. Live production/preview secret configuration and historical
fallback exposure are **UNVERIFIED** by repository tests. This change does not
inspect secret values, alter Cloudflare settings or rotate keys. Keep the existing
private production key byte-for-byte unchanged to preserve existing HS256 sessions.
Sessions signed with the retired public key cannot safely be preserved.

Protected member/admin endpoints require an active authoritative D1 record and
matching session `uid`/`sub`; admin endpoints also require the current D1 admin
role. Session GET intentionally reports pending/denied approval status to the
authenticated owner for the existing approval screen; that response grants no
protected access. Session claims do not override D1 roles or approval status.

For an existing local test identity, `npm run admin:bootstrap:local -- <email>`
configures local D1 access only; its documented role/status and revert options
remain available. It does not configure hosted accounts or remote D1.

Start `Run_Full_Stack_Dev.bat` after dependency/environment setup. Keep ports 5173
(Vite/OAuth origin) and 8788 (Pages Functions) available. `Run_API_Dev.bat` is the
backend-only helper; `npm run dev` alone does not start the API. These launchers
apply local migrations; they do not apply remote DEV/PROD migrations or deploy.

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
