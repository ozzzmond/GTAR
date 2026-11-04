# GTAR + GTAR1 — Working Plan

OWNER: Joel (ozzzmond)
APPLIES TO: `ozzzmond/GTAR` and `ozzzmond/GTAR1` (same file in both repos; keep them identical).
SOURCE_OF_TRUTH: GitHub (branches, SHAs, tags, PRs, issues). This file sets the process only; it holds no live state and never overrides the repo. Always re-verify GitHub before acting.

---

## 1. Roles (both repos)

| Role | Who | Does | Does NOT |
|---|---|---|---|
| Foreman / Validator | Claude | Writes task briefs and prompts, reviews PR diffs, reads CI, issues the verdict | Write product code for a PR it validates |
| Implementor (Tier 2) | Codex, Claude Code, AGY, OpenCode, DeepSeek | Implements one brief on one branch, opens one draft PR | Self-approve, merge, tag, deploy |
| Audit | ChatGPT | Audits on request (Friday review or before promotion) | Send findings straight to implementors |
| Tier 1 / Approver | Joel (+ Claude in chat) | Runs local commands, does QA, presses Ready for review, squash-merges, creates tags, approves issue closure | — |

- When Claude Code is the implementor, the ChatGPT audit is the independent check on that PR.
- Agent fit: Codex = data, logic, storage, bugs, tests. AGY = layout, design, UI first (Claude Code is the layout backup). Small bug / test / CI / lint fixes go to a lighter model. Heavy review goes to the strongest available model. Docs, comments and daily verdicts use a light model.

## 2. Task flow (one loop, then stop)

1. **Issue** — GitHub issue describes the work.
2. **Brief** — Foreman writes: repo, goal, files in scope, acceptance criteria, tests to run, out-of-scope list.
3. **Implement** — one agent, one branch (`feature/…` or `fix/…`), one draft PR into `dev`.
4. **Evidence** — PR includes test/build results, files changed, known gaps.
5. **Validate** — Foreman reviews the PR diff only → `MERGE` / `FIX` / `HOLD`.
6. **Owner QA** — Joel tests on Cloudflare dev (`dev.gtar-web.pages.dev`); preview hash URLs are not DEV mode.
7. **Merge to `dev`** — Joel squash-merges only when BOTH gates pass: CI green **and** Foreman verdict `MERGE`. Docs-only and Dependabot patch/minor PRs: CI green is enough. Then verify `dev` CI is green.
8. **Close** — close the issue with a comment, only with owner approval.
9. **Owner-only** — tags, `dev`→`main`, PROD deploy, D1/PROD data changes.

## 3. Anti-spiral rules

- **Diff-scoped:** validate the PR diff against its base, never the whole repo.
- **One pass per commit set:** no re-validation unless new commits land.
- **Fixed gates only:** tests, build, lint where applicable, scope match, project rules (§4). New ideas go to the backlog, not into a FIX.
- **FIX = must-fix list, max one round of new findings.** The second round only checks the listed items.
- **Known baseline issues are not PR blockers** (record them in §5).
- **Audit findings are triaged by the Foreman** into must-fix / backlog / reject before any agent sees them.
- **No daily AI audits.** Local mechanical scripts may run any time (no tokens); AI audits only at the Friday review or on request.
- Any agent finding itself in a third review loop stops and reports.
- Feature freeze applies whenever stabilization or a release is in progress; new work waits.

## 4. Project rules

**Shared (both repos)**
- Protect user data: no last-write-wins, auto-merge, destructive cleanup, or blind restores.
- ChordPro six-field header rules; never guess `original_key`.
- Keep states separate: implemented ≠ tested ≠ merged ≠ tagged ≠ deployed ≠ field-verified.
- Never paste secrets or tokens into GitHub.
- DEV is a playground; PROD must keep working. Few real users, each keeps their own backup. Lean tests, no enterprise-scale suites.

**GTAR — ACTIVE (live PROD, priority #1)**
- Holds the online services (Google sign-in, D1, Cloudflare); keep these cleanly separated from the offline core.
- Web/PWA only; Android is frozen legacy unless explicitly requested.
- Versioning per GTAR_VERSIONING_V2 / DEV Workflow V2; PROD needs preflight + dry run + explicit approval.
- Never rerun D1 migrations or change PROD data without explicit approval.
- Gates run from `web/`: `npm test`, `npm run lint`, `lint:sync`, `build`, `node web/scripts/test-catalog.cjs --check`.
- Layout/design work goes to AGY first.

**GTAR1 — BACKUP / PARKED** (fallback repo; no new work until the owner reactivates it)
- Planned environments: DEV / STAGE / PROD. Personal Cloud Sync excluded.
- **No Google credentials at all** — no Google sign-in, Client ID, or Google auth, now or later.
- Local-first: 0 network calls on startup; no cloud sync in runtime.
- Storage namespace `gtar_revamp_local_v1` only; never touch legacy GTAR keys/DBs.
- Atomic IndexedDB writes; import/export keeps round-trip with GTAR1 and legacy GTAR JSON.

## 5. Known baseline issues (not PR blockers)

- Windows only: 7 `deviceSignInFallback` tests fail.
- Add new entries here as they are measured.

## 6. Where live state lives

Live state (branches, SHAs, tags, open PRs/issues, release scope) is read from GitHub, not stored here. Session handoffs go in `claude/GTAR_context_<date>.md`; standing rules in `claude/GTAR_rules.md`.
