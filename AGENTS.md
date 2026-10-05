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
