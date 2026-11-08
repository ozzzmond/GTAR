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
- Audit-trail, runtime-output and final-report rules for every flow are defined
  once in [gtar_standing_protocol_v1.md](gtar_standing_protocol_v1.md#github-native-audit-architecture--reporting-rule).

## Which protocol applies
Choose the flow from the active chat directive before acting. Common scope and
safety invariants in gtar_standing_protocol_v1.md apply to every flow; its
audit-fix Git restrictions and verification section apply only to audit-fix work.

- Audit-fix: investigation, audit or fixes explicitly limited to offline/disposable
  work, without live commits, pushes or deployment. Follow
  gtar_standing_protocol_v1.md; fixes require explicit authorization.
- Implementation PR: code or documentation delivered through a draft PR. Follow
  "Implementation PR flow" and "Task setup" below. Local commits, branch push,
  draft PR creation and updates to the named issue are authorized; audit-fix
  no-commit/no-push restrictions do not apply.
- Release: manual git updates outside a PR, release/version checkpoints, tagging
  or production deployment. Follow RELEASE_WORKFLOW_README.md and
  .github/workflows/release.yml. This flow is fail-closed: live git commit,
  push, tag or deploy requires explicit human authorization. Metadata edits in
  an authorized PR stay in the PR flow; they do not authorize a tag or deployment.
- If the directive does not clearly select a flow, ask before proceeding.

## Implementation PR flow
- Agents implement, validate locally, push the branch, and open the PR as
  DRAFT targeting dev. The PR stays draft so QA can happen and adjustments
  can still be pushed. Agents never mark ready for review, merge, squash,
  tag, or deploy; the owner does.
- Agents do not poll or monitor CI. The owner reports CI status.
- CI red X: investigate only when the owner reports it and asks. Check the
  actual failure on the current PR head SHA, fix the root cause within scope,
  push, and report the new head SHA. Never disable or weaken tests, remove
  required checks, or rerun blindly to get green.
- CI green: take no action until the owner says so. When the owner
  confirms green, update the issue for tracking only.
- QA: after the owner confirms QA passed, update the issue with final status.
  Close it only after QA confirmation and the owner's order.
- Issue updates are concise and evidence-based (status, change, tests, PR,
  head SHA, blockers, next). No progress chatter.

## Task setup
- Agent prompts come from chat; there is no Prompt Board.
- Always `git fetch origin dev` and branch from `origin/dev`.
- PRs target `dev` only.
- Report base SHA and head SHA.
- If the task names an issue, update that issue; never create duplicates.
  If it names none, ask. Create a new issue only when the task authorizes it.

## Agent handoff standard

TASK|MODE|SCOPE/PROJECT/REPO/BRANCH|GOAL|PROVE/ACCEPT|EXECUTION_POLICY|REPORT_POLICY|EFFICIENCY_POLICY|TOKEN_POLICY|INTERACTION_POLICY|CHAT_OUTPUT_POLICY|FINAL_OUTPUT_STANDARD.

INTERACTION_POLICY:NO_LIVE_REASONING|NO_INTERMEDIATE_ANALYSIS|NO_HYPOTHESIS_DUMP|NO_PARTIAL_FINDINGS|NO_SELF_TALK|NO_EXPLANATORY_STREAM|ASK_ONLY_IF_BLOCKED_OR_REQUIRED_FOR_CORRECTNESS|SILENT_EXECUTION_UNTIL_FINAL.
FINAL_OUTPUT_STANDARD:COLON_DELIMITED_DENSE+CAVEMAN_MICRO+PERSPECTIVE.

Preserve this vendor-neutral standard across Manager, Codex, Claude, GPT, Gemini, OpenCode, and E14/local workers.

Canonical final report fields and schema live in
[gtar_standing_protocol_v1.md](gtar_standing_protocol_v1.md#dense-reporting-schema-standard-for-final-chat-reports).

## Agent skills
See [.agents/skills/README.md](.agents/skills/README.md) for allowed skills, pinned sources, restrictions and verification.
Follow that policy; repository protocols override skill instructions.

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
- Optional online services use Google credentials; never move, log, or commit secrets.
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
- `web/tests/tiers.json` maps explicit files to one tier; unlisted files default
  to fast. All scripts validate the assignments and the complete test catalog.
  Use `-- --timing` for the 25 slowest files; each run reports file/total time.
- CI partitions fast across eight required shards (no tests omitted); local
  `npm test` runs all fast files. `GTAR_TEST_SHARD=0/8` selects one fast shard;
  this option is rejected by every other tier, including `test:all`. The
  manifest can reserve fast shards for slow files; those files stay fast.
- After adding/removing test files, run
  `node web/scripts/test-catalog.cjs --write` from the repo root.
