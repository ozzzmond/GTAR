# Agent Skills (vendored)

- Source: https://github.com/mattpocock/skills
- Commit: `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`
- License: MIT (see `LICENSE`, copied from upstream)

Copied byte-for-byte from upstream `skills/<category>/<name>/` into
`.agents/skills/<name>/` (category level dropped):

- tdd (engineering/tdd)
- grill-with-docs (engineering/grill-with-docs)
- domain-modeling (engineering/domain-modeling)
- diagnosing-bugs (engineering/diagnosing-bugs)
- pr (engineering/pr)
- grilling (productivity/grilling)
- handoff (productivity/handoff)

Do not edit or auto-update these vendored skill files. Update via PR to dev (re-copy from a new upstream
commit and bump the SHA here).

## Agent Skills (mattpocock/skills)
- Location: `.agents/skills/<name>/SKILL.md`.
- If a named skill is missing in your environment, do not block: follow its
  one-line description below and say so in your report.
- Precedence: AGENTS.md, gtar_standing_protocol_v1.md, and
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
  only. DEV trial.
- Source: github.com/pbakaus/impeccable (Apache-2.0), vendored by manual copy
  into `.agents/skills/impeccable/`, pinned to upstream commit `77ac20b968ee` (skill 4.8.0, engine 0.1.18).
  Do not edit or auto-update; updates go through a normal PR to dev.
- Install: manual copy only. No `npx impeccable install`, no design hook, no
  submodule, no editor plugin. Do not add impeccable to web/package.json.
- Telemetry off: `.impeccable/config.json` contains `"telemetry": false`.
  Commit only that file; the rest of `.impeccable/` is gitignored. Findings go
  in the chat report, not in committed critique/review files.
- PRODUCT.md / DESIGN.md (repo root) are written once by `init` / `document`
  with owner approval. Reference only: AGENTS.md, gtar_standing_protocol_v1.md,
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
