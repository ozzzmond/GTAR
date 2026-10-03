# GTAR GitHub preview contract

GitHub tags are the version source of truth. Canonical DEV tags are
`v1.0.<positive-base>-dev.<positive-iteration>[optional single lowercase letter]`.
Neither numeric component may contain leading zeroes. Numeric DEV tags are
promotable; lettered DEV tags are not. Production tags are rejected by preview validation.

Pushes of `v1.0.*-dev.*` tags trigger preview validation. Manual dispatch requires
an explicit canonical tag. The workflow checks out `refs/tags/<requested tag>`
with complete history, then runs the standalone Node helper before install,
tests, lint, and build:

```sh
node .github/release_metadata.cjs --tag "$REQUESTED_TAG"
```

The helper requires the exact tag to exist, its peeled commit to equal HEAD,
and `web/package.json` version to equal the tag without its leading `v`.
Only after all checks pass does it print and append to `GITHUB_ENV`:
`RELEASE_TAG`, `RELEASE_TITLE` (`GTAR <tag>`), `IS_PRERELEASE=true`, and
`IS_PROMOTABLE`. The artifact name is exactly `RELEASE_TAG`.

This flow creates build artifacts only. It does not tag, push branches, deploy,
or promote to production. No stage environment is included. The separate production planner below is fail-closed. Existing application versions and historical GitHub tags are unchanged.

PR validation runs the full Web/PWA test suite (including disposable-repository
metadata integration tests and repository boundary checks), sync lint, and build.
The optional read-only `audit_local.py` remains an audit tool, not release tooling.

## Agent handoff standard

TASK|MODE|SCOPE/PROJECT/REPO/BRANCH|GOAL|PROVE/ACCEPT|EXECUTION_POLICY|REPORT_POLICY|EFFICIENCY_POLICY|TOKEN_POLICY|INTERACTION_POLICY|CHAT_OUTPUT_POLICY|FINAL_OUTPUT_STANDARD.

INTERACTION_POLICY:NO_LIVE_REASONING|NO_INTERMEDIATE_ANALYSIS|NO_HYPOTHESIS_DUMP|NO_PARTIAL_FINDINGS|NO_SELF_TALK|NO_EXPLANATORY_STREAM|ASK_ONLY_IF_BLOCKED_OR_REQUIRED_FOR_CORRECTNESS|SILENT_EXECUTION_UNTIL_FINAL.
FINAL_OUTPUT_STANDARD:COLON_DELIMITED_DENSE+CAVEMAN_MICRO+PERSPECTIVE.
Canonical final fields: STATUS/TASK|CHANGE|PROOF|TESTS|FILES|READY|BLOCKERS|PERSPECTIVE|RECEIPT|NEXT. One compact receipt; PASS concise, FAIL/BLOCKED expands only for decision-critical diagnostics. Preserve this vendor-neutral standard across Manager, Codex, Claude, GPT, Gemini, OpenCode, and E14/local workers.

## PROD promotion v3 (safe implementation boundary)

`.github/workflows/release.yml` is dispatch-only: required exact `dev_tag`, required
full lowercase checkpoint SHA (40 characters), and `dry_run=true` by default. Dry run
reads tags, remote branch refs and committed checkpoint files, reports all gates,
and changes no branch, tag or runtime metadata. A blocked real run exits nonzero.
Workflow summary/output files are the only plan writes. Dry run performs planning
only; Web tests, lint and build are not claimed as run.

The controller checks out the exact dispatch `github.sha` and requires
`github.ref=refs/heads/main`; default-branch rollout is separate. The helper is
taken from that reviewed controller SHA, **not** executed
from the selected checkpoint. `release_metadata.cjs` remains the sole DEV parser:
`parseDevTag(tag)` returns base, iteration, suffix, promotability, PROD tag and
report-only next DEV tag with safe-integer arithmetic. `inspectCheckpoint(root,
tag)` reads exact tagged files with `git show`. The existing `--tag <tag>` CLI,
HEAD/package check and four preview exports are unchanged. Preview's pre-check is
now only Git ref syntax; canonical policy validation remains in the helper.

Checkpoint metadata consistency is supported by the current regression tests:
package version; lockfile root and root-package versions; `GTAR_DEV_VERSION`;
and the authCore source header. The header is a source stamp, not a server runtime
release mechanism. `GTAR_APP_VERSION` is inspected separately, never rewritten.
The release workflow contains no DEV regex or duplicate DEV policy. The planner
is inline in `release.yml`; the obsolete `release_plan.cjs` is removed. It checks
the latest canonical DEV version including lettered work, exact DEV tip, full
expected SHA, main ancestry and a new main-push trigger. Baseline checks read
both the PROD tag's own committed package and main metadata; legacy tags are ignored.
The reported next DEV tag and its existence remain advisory.

When production contracts are implemented in a reviewed follow-up, the architecture
is plan → one exact-SHA Web validation job → human approval → full plan recheck →
atomic non-force main/PROD-tag push → exact-SHA Cloudflare production verification.
Node 22, `web`, `npm ci`, `npm test`, `npm run lint:sync`, `npm run build` match
`validate.yml`. No deploy artifact, Cloudflare API, Wrangler deployment or GitHub
Pages deployment exists. Current jobs are `plan`, `validate`,
`production-boundary` and `report`. There is no write permission, push code,
approval environment reference or production verifier. Unconditional blockers
keep readiness false; the production boundary explicitly exits 1. The report
runs for dry and real attempts, and a real attempt always exits nonzero.
No repository variable can unlock production execution.
This is a useful read-only planner, **not an enabled production release system**.

### Audited GitHub state (2026-10-03 UTC)

- dev and `v1.0.108-dev.9`: `b207cac6462f57250e9bd8f0fb292e700526fa5d`.
- main: `247e016a6234204013857c70d1b4a34b1e6360fc`; common ancestor:
  `78f99a8deb9c09b5a8e9ea8de1b153e8d4fd5b63`. Main-only/dev-only: 18/106 commits.
  Main is not an ancestor of the checkpoint. A separate reviewed reconciliation
  must preserve/resolve those main-only changes and establish main as an ancestor
  of a future reviewed/tagged DEV checkpoint. This workflow performs none of it.
- Canonical PROD tag `v1.1.62` exists (tagged package is `1.1.62`). Highest canonical
  PROD patch is 62, but current main package is `1.1.108`. Historical `app-v*` and
  `web-v*` tags are ignored and untouched. This is a baseline/history discrepancy,
  **not** an absent canonical baseline. Review actual deployed production identity
  separately; do not invent a new baseline here. Missing-baseline behavior is tested.
- Math from selected tag: 108 + 9 = 117 → `v1.1.117`; report-only next DEV:
  `v1.0.117-dev.1`. Neither is created by this implementation task.
- Checkpoint GitHub check `Cloudflare Pages` succeeded; trusted app slug:
  `cloudflare-workers-and-pages`; details URL identifies project `gtar-web` and
  deployment `84c2cc7d-0766-4ead-b609-4337f992ab71`.
  Main SHA also has a successful Cloudflare Pages check (deployment
  `8f899f68-5bec-4b7a-b510-baa9236071a3`), showing main builds through the integration.
  Its summary still labels the URL “Preview URL” and supplies no production marker.
  This proves branch builds/check reporting, not the configured production branch
  or a uniquely identifiable production deployment. GitHub Deployments returned `[]`; environments returned zero.
- Runtime source: package/DEV stamp `1.0.108-dev.9`; `GTAR_APP_VERSION=1.1.108`.
  Header and StageSettings select DEV/PROD constants using environment; backup
  paths also consume APP_VERSION. Vite recognizes `CF_PAGES_BRANCH=dev` as debug.
  Exact promotion would retain PROD runtime `1.1.108`, not computed `1.1.117`.

### Remaining operator evidence and reviewed work

1. Cloudflare dashboard: production branch for `gtar-web`, confirmation that a
   main push triggers its production build (including the intended push credential),
   and a known production deployment's commit SHA/time plus GitHub check/deployment
   fields that distinguish production from preview. Implement verification of exact
   SHA, trusted app/project, production classification, and a signal created after
   the promotion. A check success for the same SHA on dev is insufficient. Do not
   guess an environment, production URL, regex or credentials.
2. Select a GitHub approval environment and configure required human reviewers,
   prevent-self-review, and appropriate protection. Verify protection through
   available evidence before replacing the explicit approval stop; dispatch alone
   is not production approval. No environment is automatically created here.
3. Decide release identity semantics. Cleanest direction supported by current
   code: keep package/GTAR_DEV_VERSION as source identity, provide the production
   release identity at build time, and make existing PROD display/backup consumers
   use it. There is no existing release-identity injection contract, so no mechanism
   is implemented. A reviewed DEV change and later clean checkpoint must establish
   it before promotion; never edit the already verified checkpoint in the workflow.
4. Resolve history and baseline discrepancy separately. Since workflows must be
   present on the default branch for manual dispatch, rollout of this controller
   also requires reviewed default-branch availability; this dev PR does not mutate
   main. After merging this PR into dev, the old checkpoint will also fail the
   exact-dev-tip gate. Validate and manually tag a later reviewed numeric checkpoint.

After a successfully verified future PROD release, open a reviewed metadata PR
on dev for the reported next baseline, update required version assertions, validate,
merge, then manually tag that new metadata commit. Never put the next DEV tag on
the PROD commit and never auto-mutate dev.
