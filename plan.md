# GTAR — Working Plan

OWNER: Joel (ozzzmond)
SOURCE_OF_TRUTH: GitHub (branches, SHAs, tags, PRs, issues, CI). This file sets the process only and holds no live state. Re-verify GitHub before acting.

## Goal
Keep GTAR a sustainable digital songbook: a local-first, offline-capable Web/PWA core for songbooks, setlists and stage use, with optional integrations added around it without coupling the core to any outside service.

## Who does what
- Owner (Tier 1): decides scope, runs QA, marks PRs ready, merges, tags, promotes to PROD, orders issue creation/closure. Works with a guide.
- Guide: Claude or ChatGPT in chat. Plans, writes agent prompts, reviews PR diffs (MERGE / FIX / HOLD), reads CI or issues only when asked. Does not write the code for a PR it reviews.
- Implementors (Tier 2): Codex, AGY, Claude Code, DeepSeek or a local LLM on the E14. One brief, one branch, one draft PR into `dev`. Never merge, tag or deploy.
- Rule of thumb: logic/data/storage to the strongest agent; UI/layout to AGY or Claude Code; small fixes, tests, docs, CI to a lighter or local model.

## Flow
1. Issue describes the work (created when the owner asks).
2. Guide writes the prompt in chat: repo, goal, scope, acceptance, tests, out-of-scope.
3. Implementor opens one draft PR into `dev`, reports compactly.
4. Owner reports CI; nobody polls. On a red X, check the cause; never weaken checks.
5. Guide reviews the diff only, once per commit set.
6. Owner QA on `dev.gtar-web.pages.dev`.
7. Owner squash-merges after green CI and a MERGE verdict (docs-only and Dependabot patch/minor: green CI).
8. Issue closed only on the owner's order.
9. Owner only: tags, `dev` to `main`, PROD deploy, D1/PROD data changes.

## Project rules
- Protect user data; no last-write-wins, auto-merge, destructive cleanup or blind restore.
- ChordPro header rules; never guess `original_key`.
- implemented, tested, merged, tagged, deployed and field-verified are separate states.
- Never paste secrets or tokens into GitHub. Web/PWA only; Android is frozen legacy.
- DEV is a playground; PROD must keep working. Lean tests.
- Optional services stay behind clear boundaries so the core works without them.
- Never rerun D1 migrations or change PROD data without explicit approval.
- Gates from `web/`: `npm test`, `npm run lint`, `lint:sync`, `build`, `node web/scripts/test-catalog.cjs --check`.
- Bump version metadata on `dev` before creating the matching tag.

## Known baseline issues
- Windows only: 7 `deviceSignInFallback` tests fail.
