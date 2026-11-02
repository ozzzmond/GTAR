# Agent Rules — GTAR Project

## Response Style
- Be concise. Skip narration like "I will now...", "Let me...", "Now I'll...",
  or "Let's...". Just do the work and report results.
- No decorative separators (====, ----, ****, ~~~~) in any output.
- No step headers like "Step 1: Implement..." or "Step 2: Test...". Do the
  work; report what was done, not a numbered plan of what you're about to do.
- Do not restate the directive/prompt back before acting on it.
- Do not repeat the same instruction or constraint more than once in a
  single response.
- Report findings, changes made, and test results directly — file paths,
  what changed, pass/fail status. Skip preamble and skip summarizing what
  you're about to summarize.
- If nothing needs to change for a given item, say so in one line — do not
  pad with reasoning about why nothing changed.
- Never paste raw logs, full test output, full diffs, or other long
  evidence directly into your chat response.
- Runtime evidence (stdout, stderr, test runner output, build/lint logs)
  is transient by default: evaluate in-memory.
- GitHub is the canonical audit trail: commits and pull requests record change
  history, tags and releases record checkpoints, and GitHub Actions runs, logs,
  and step summaries record execution diagnostics.
- Local receipt files are non-canonical and not required; do not write receipts
  or runtime logs to E:\Logs\ or repository outputs/.
- Completed directives produce compact final chat reports adhering to the
  Caveman_Micro+Perspective dense key-value schema (proven facts only, zero
  narration/decorative fluff). On pass, compact aggressively; on fail/error,
  retain decision-critical diagnostics in the chat report.

## Project Structure
- See gtar_standing_protocol_v1.md for target invariants, verification
  commands, and reporting rules that apply to every GTAR directive — do not
  restate those in your responses either; follow them silently and confirm
  completion only.

## Which protocol applies
- Audit-fix directives (findings/bugs to fix, offline/disposable only,
  zero live commits/pushes/deploys) → gtar_standing_protocol_v1.md.
- Manual git updates, version bumps, tagging, and production deployment →
  governed by RELEASE_WORKFLOW_README.md and .github/workflows/release.yml.
  This path is fail-closed; live git commit/push/tag/deploy is permitted
  only with explicit human authorization before any push, tag, or deploy.
- If a task doesn't clearly say which one it is, ask before proceeding —
  do not default to release/deployment permissions.

## Task setup
- Always `git fetch origin dev` and branch from `origin/dev`.
- PRs target `dev` only.
- Report base SHA and head SHA.
- Create a GitHub issue first only when the task authorizes it.

## Agent Skills (mattpocock/skills)
- Source: github.com/mattpocock/skills, vendored byte-for-byte at upstream
  commit `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`. Do not edit or
  auto-update; updates go through a normal PR to dev.
- Location: skills live in the repo at `.agents/skills/<name>/SKILL.md`
  (see `.agents/skills/README.md`).
- If a named skill is missing in your environment, do not block: follow its
  one-line description below and say so in your report.
- Precedence: this file, gtar_standing_protocol_v1.md, and
  RELEASE_WORKFLOW_README.md override any skill. If a skill step says to
  commit, merge, tag, push, open a tracker issue, or spawn subagents, skip
  that step and report it instead.
- Installed and allowed:
  - grill-with-docs / grilling — before any non-trivial change. Grilling is
    the one exception to the no-questions style: ask one question at a time,
    each with a recommended answer, only when the user invokes it.
  - domain-modeling — keeps GLOSSARY.md (repo root) and docs/adr/ current.
  - tdd — features and bug fixes, red-green-refactor, one vertical slice at a
    time. Use the standing-protocol verification commands (web/ prefix).
  - diagnosing-bugs — regressions, especially chord/key and transpose.
  - handoff — end of session, compact; no receipt files.
  - pr — PR body shape for PRs targeting dev.
- Not allowed (not installed; do not fetch or emulate): implement,
  implement-spec, wayfinder, triage, to-tickets, code-review,
  improve-codebase-architecture, or any parallel subagent fan-out.

## UI Review Skill (pbakaus/impeccable)
- Role: UI reviewer and slop detector only, not a redesigner. Web/PWA (web/)
  only. DEV trial, adopted alongside GTAR1; issues found in either repo are
  fixed in both.
- Source: github.com/pbakaus/impeccable (Apache-2.0), vendored by manual copy
  into `.agents/skills/impeccable/`, pinned to upstream commit `77ac20b968ee` (skill 4.8.0, engine 0.1.18).
  Do not edit or auto-update; updates go through a normal PR to dev.
- Install: manual copy only. No `npx impeccable install`, no design hook, no
  submodule, no editor plugin. Do not add impeccable to web/package.json.
- Telemetry off: `.impeccable/config.json` contains `"telemetry": false`.
  Commit only that file; the rest of `.impeccable/` is gitignored. Findings go
  in the chat report, not in committed critique/review files.
- PRODUCT.md / DESIGN.md (repo root) are written once by `init` / `document`
  with owner approval. Reference only: this file, gtar_standing_protocol_v1.md,
  and RELEASE_WORKFLOW_README.md override them and the skill. Same skip rule as
  above for commit/merge/tag/push/issue/subagent steps.
- Allowed, read-only:
  - `npx impeccable@4.8.0 detect --json web/src` — deterministic,
    no LLM. Exit 0 clean, 2 findings, 1 scan failed: report the code, do not
    retry-loop.
  - `npx impeccable@4.8.0 detect --json http://localhost:5173` —
    local dev server only.
  - `critique <one component>`, `audit <one surface>` — findings P0–P3, no
    code changes.
- Allowed only after the owner picks findings: harden, adapt, clarify,
  typeset, layout, polish, optimize. One target, one fix round, then report and
  stop. Never chain critique → fix → critique without owner approval.
- Not allowed unless the owner names the command: live, generate, bolder,
  quieter, distill, overdrive, delight, colorize, animate, onboard, shape,
  extract, craft, pin.
- Never: scan or open the PROD URL; touch Android; touch Cloudflare, D1,
  auth/session, Google-credential or online-service code, sync/storage/
  IndexedDB, backup/restore, chord/key/transpose, or the ChordPro parser;
  change data shape or saved user content as part of a design fix; add web
  fonts, CDN, or any new network request; hardcode colors outside existing
  theme tokens; run whole-app passes.
- Verification: standing-protocol checks, plus a detector re-run on the target
  (targeted findings resolved, no new P0/P1). Pre-existing lint errors outside
  the target are out of scope.
- Audit-script use: pass only rule counts, exit code, and top P0/P1 items to
  any model, never the full JSON.

## Domain Terms
Use these exact terms in code, tests, PRs, and reports:
- ORIGINAL_KEY — verified source/original song key.
- CHART_KEY — key the stored chart is written in; may differ from ORIGINAL_KEY.
- PERFORMANCE_KEY — CHART_KEY plus applied transpose state.
- TRANSPOSE_OFFSET — semitone offset; TRANSPOSE_ZERO means ORIGINAL_KEY.
- Never guess ORIGINAL_KEY; never silently change a saved PERFORMANCE_KEY.
- ChordPro `{key}` equals ORIGINAL_KEY at rest. Only transposition changes the
  key in use (PERFORMANCE_KEY); transposing never rewrites `{original_key}`.

## Repo Guards
- Target is Web/PWA (web/). Android is frozen legacy: do not touch unless
  explicitly instructed.
- Online services use Google credentials; never move, log, or commit secrets.
- No PROD, D1 migration, Cloudflare, or tag operations without explicit
  owner approval.

## Test tiers

- From `web/`, agents run `npm test` for PRs (fast; CI target under 60 s).
- Run `npm run test:scale` for 5k/10k-song and large-migration coverage;
  153/1,500-song variants stay fast.
- Run `npm run test:release` for release/version tooling and git-history checks;
  fetch full history and tags first (`git fetch --tags`; unshallow if needed).
- Run `npm run test:workerd` for Miniflare/workerd runtime coverage.
- Agents run `npm run test:all` only when asked. CI runs it on pushes to dev,
  weekly (Monday 00:00 UTC), and in release validation before tagging.
- `web/tests/tiers.json` maps non-fast files to one tier; unlisted files default
  to fast. All scripts validate the assignments and the complete test catalog.
  Use `-- --timing` for the 25 slowest files; each run reports file/total time.
- After adding/removing test files, run
  `node web/scripts/test-catalog.cjs --write` from the repo root.
