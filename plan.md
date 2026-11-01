# GTAR + GTAR1 — Working Plan

STATUS: ACTIVE · OWNER: Joel (ozzzmond) · UPDATED: 2026-11-01
APPLIES TO: `ozzzmond/GTAR` and `ozzzmond/GTAR1` (same file in both repos; keep them identical).
SOURCE_OF_TRUTH: GitHub (branches, SHAs, tags, PRs). This file sets the process; it never overrides live repo state. All agent resources (AGENTS.md, skills, plans, glossary, ADRs) live in the repo.

---

## 1. Roles (both repos)

| Role | Who | Does | Does NOT |
|---|---|---|---|
| Validator / Foreman | Claude (chat) | Writes task prompts, reviews PR diffs, issues the verdict | Write product code for a PR it validates |
| Implementor (Tier 2) | Codex, Claude Code, AGY, OpenCode/DeepSeek (backup) | Implements one prompt on one branch, opens one PR to `dev` | Self-approve, merge, tag, deploy |
| Audit | ChatGPT | Audits on request (Friday review or before promotion) | Send findings straight to implementors |
| Tier 1 / Owner | Joel (pafs) | Runs local commands, pastes reports, S&M after verdict + green CI, DEV field QA, tags, PROD | — |

When Claude Code is the implementor, the ChatGPT audit is the independent check on that PR.

## 2. Task flow (one loop, then stop)

1. **Prompt** — Validator writes: goal, scope, acceptance criteria, tests to run, out-of-scope list. Setup and skills come from AGENTS.md.
2. **Implement** — one agent, one branch from `origin/dev`, one PR into `dev`.
3. **Report** — implementor reports PR URL, base SHA, head SHA, files, tests, gaps. Owner pastes it to the Validator.
4. **Review** — Validator reviews the PR diff only → `MERGE` / `FIX` / `HOLD`.
5. **Merge to `dev`** — only when BOTH gates pass: CI green **and** verdict `MERGE`. Owner does the Squash & Merge. Docs-only and Dependabot patch/minor PRs: CI green is enough.
6. **DEV QA** — owner checks the deployed DEV build (SHA in the DEV header) on phone and desktop.
7. **Owner-only** — tags, `dev`→`main`, PROD deploy, D1/PROD data changes.

## 3. Anti-spiral rules

- **Diff-scoped:** validate the PR diff against its base, never the whole repo.
- **One pass per commit set:** no re-validation unless new commits land.
- **Fixed gates only:** tests, build, lint where applicable, scope match, project rules (§4). New ideas go to the backlog, not into a FIX.
- **FIX = must-fix list, max one round of new findings.** The second round only checks the listed items.
- **Known baseline issues are not PR blockers** (record them in §5).
- **Audit findings are triaged by the Foreman** into must-fix / backlog / reject before any agent sees them.
- **No daily AI audits.** Local mechanical scripts may run any time (no tokens); AI audits only at the Friday review or on request.
- Any agent finding itself in a third review loop stops and reports.

## 4. Project rules

**Shared (both repos)**
- Protect user data: no last-write-wins, auto-merge, destructive cleanup, or blind restores.
- ChordPro six-field header rules; never guess `original_key`.
- Keep states separate: implemented ≠ tested ≠ merged ≠ tagged ≠ deployed ≠ field-verified.

**GTAR only — ACTIVE (live PROD, priority #1)**
- Holds the **online services** (Google credentials / sign-in, D1, Cloudflare); these should be separated cleanly from the offline core. Plan: `docs/plans/2026-11-01-core-separation.md`.
- Rename to `GTAR-webapp-Legacy`: on hold until GTAR is stabilized.
- Web/PWA only; Android frozen legacy unless explicitly requested.
- Versioning per GTAR_VERSIONING_V2 / DEV Workflow V2; PROD needs preflight + dry run + explicit approval.
- Never rerun D1 migrations or change PROD data without explicit approval.
- Gates run in `web/` (test, build, sync_lint).

**GTAR1 only — BACKUP / PARKED** (created as a fallback during the GTAR audit spiral; no new work until GTAR is stable and the owner reactivates it)
- Planned environments: DEV / STAGE / PROD. Personal Cloud Sync excluded.
- **No Google credentials at all** — no Google sign-in, Client ID, or Google auth, now or later.
- Local-first: 0 network calls on startup; no Google auth; no cloud sync in runtime.
- Storage namespace `gtar_revamp_local_v1` only; never touch legacy GTAR keys/DBs.
- Atomic IndexedDB writes; import/export keeps round-trip with GTAR1 and legacy GTAR JSON.

## 5. Current state (verified 2026-10-31, GitHub)

| | GTAR | GTAR1 |
|---|---|---|
| `main` | `4fe9504` | `6c716d9` |
| `dev` | `4fe9504` (same as main) | `da2bdee` (theme Batch 5 fixes, #67) |
| Latest tags | PROD `v1.1.141`, DEV `v1.0.139-dev.2` (both on `4fe9504`) | none |
| Extra branches | ~34 (incl. 8 Dependabot) | 11 |

**Flag:** GTAR code still says `1.0.139-dev.2` (`web/package.json`, `web/src/types/gtar.ts`). DEV must be reset to `1.0.141-dev.1` (untagged baseline).

**Known baseline issues:** _(none recorded yet)_

## 6. Next up — GTAR stabilization (in order)

1. **Version reset:** `web/package.json` + `web/src/types/gtar.ts` fallback → `1.0.141-dev.1` (tiny PR, no tag).
2. **Branch triage (read-only first):** classify ~34 branches as merged / open-with-issue / abandoned → owner decides; no automatic deletion. Batch the Dependabot PRs.
3. **Backlog triage:** every open issue → must-fix / backlog / close. Only must-fix items get briefs.
4. **Feature freeze** until steps 1–3 are done.
5. **Then:** separate GTAR online services (Google credentials, D1, Cloudflare) from the offline core as its own phase — see `docs/plans/2026-11-01-core-separation.md`.

GTAR1: parked. Record known baseline issues in §5 as they are measured.
