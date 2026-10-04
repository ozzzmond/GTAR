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

## Executable Web/PWA production controller

The dispatch-only `release.yml` retains the reviewed order: plan → exact-SHA Web
validation → protected human approval → fresh full recheck → atomic non-force
main/PROD-tag transaction → existing Cloudflare Pages Git build → production
verification → terminal report. Dry run defaults to true, performs gates only,
and claims no tests/build. There is no stage, APK, Gradle, signing, GitHub Release,
Wrangler deployment, API deployment, source rewrite, automatic rollback or DEV
baseline mutation. The legacy main APK controller must be **replaced**, not kept
alongside this controller, during the separately authorized rollout.

`release_metadata.cjs` remains the sole DEV parser and committed metadata reader;
its preview CLI/exports remain compatible. `prod_controller.cjs` is trusted code
from the exact dispatch SHA on reviewed `main`, never from the checkpoint. The
validation job checks out only the selected SHA and receives no release secrets.
All gate failures exit nonzero before production mutation.

### Exact source and approval gates

Required inputs are the exact DEV tag and full lowercase SHA. Gates require a
clean numeric tag, latest canonical DEV including lettered work, exact dev tip,
consistent package/lock/DEV/auth source stamps, computed PROD above the canonical
baseline, absent PROD tag, baseline ancestry, main ancestry, and unchanged
controller/main since dispatch. Legacy app-v/web-v tags do not establish baseline.
Baseline identity accepts a legacy tagged PROD package or the new exact-source
DEV/tag-derived identity contract; existing legacy discrepancies are not waived.
The checkpoint must contain the reviewed release identity helper/parser bytes and
Vite/runtime integration. Next DEV is an advisory output only.

Configure GitHub **Settings → Environments → gtar-production** before execution:
required human reviewer(s), **Prevent self-review** enabled, administrator bypass
**disabled**, and deployment branch policies allowing only branch **main** (no
tag policy). `plan` reads and verifies that existing environment before the job
can reference it. Missing, inaccessible, incomplete or unprotected configuration
blocks. The environment job enforces the actual approval; dispatch is not approval.
Protection is checked again after approval and fingerprinted against the plan.
Do not remove protection or rotate its policy during an approved run.

Repository secrets:

- `APPROVAL_READ_TOKEN`: read-only GitHub credential able to GET environment,
  environment branch policies and repository ruleset details (appropriate Actions/
  Administration read permissions for the chosen credential type).
- `CF_PAGES_READ_TOKEN`: Cloudflare token scoped to the account with **Cloudflare
  Pages Read** only. It performs authenticated GETs, never a deployment request.
- Repository variable `CF_ACCOUNT_ID`: actual 32-character account ID containing
  project `gtar-web`.
- **Environment secret** `PROD_PUSH_TOKEN`: dedicated GitHub credential restricted
  to this repository with Contents write and workflow-file update permission as
  required to push the tested checkpoint containing workflows. Configure main
  protections to permit this authorized fast-forward without bypassing human
  approval; rejected pushes fail closed. Do not place it in repository secrets.
  Use a credential whose push is received by the existing Pages Git integration.

### Race and transaction contract

Concurrency serializes this controller, but cannot serialize other GitHub writers.
Before planning, the operator must activate two server-enforced repository rulesets
with **no bypass actors**, no excluded refs, and these exact names/targets:

| Ruleset | Target/include | Required rules |
| --- | --- | --- |
| gtar-release-freeze-dev | Branch / refs/heads/dev | Restrict updates; restrict deletions |
| gtar-release-freeze-dev-tags | Tag / refs/tags/v1.0.* | Restrict creations; restrict updates; restrict deletions |

Keep these active through verification. They close the dev/new-DEV-tag race that
an ordinary no-op push cannot compare-and-swap. The controller verifies these
rulesets before and after approval; it never creates them or grants bypass.
Re-enable normal development only after a terminal outcome is reviewed. Changes
by repository administrators to protection while a run is executing invalidate
this operator contract; do not change it mid-run.

The post-approval job fetches branches and complete tags without forcing/replacing
or deleting tags. A moved/deleted/stale inventory blocks. It recomputes every gate
and compares the full remote-ref snapshot, main/SHA/PROD and protection/project
fingerprint to the validated plan, then rereads refs immediately before push.
A pre-push hook verifies the server-advertised expected old main SHA and absent
PROD tag; **both** updates must be present (a no-op main update cannot silently
allow tag-only mutation). Receive-pack compares old refs atomically. The single
`git push --atomic` fast-forwards main to the tested SHA and creates the lightweight
computed PROD tag on that same SHA. Unsupported atomic push or non-fast-forward
history is a blocker. No force flags, source commit, merge or rebase occurs.

Every push outcome is followed by read-only ref inspection, even after transport
failure. Both refs exactly at checkpoint means `PROD_PROMOTED_BUT_UNVERIFIED` and
continues to verification; unchanged main plus absent tag means `NOT_PROMOTED`;
partial, conflicting or unreadable refs mean `AMBIGUOUS_REFS_MANUAL_REVIEW`.
No blind retry occurs. An unknown state is recorded before push for interrupted
runners. Never rerun a mutation to recover an ambiguous result: inspect refs/run
outputs first. Existing tags are never overwritten, moved or deleted.

### Runtime identity without source rewrite

Package version and `GTAR_DEV_VERSION` stay the tested source identity.
`release_identity.cjs` is invoked by Vite. On Pages `main`, it requires the full
`CF_PAGES_COMMIT_SHA` equal build HEAD, canonical GitHub origin, one exact clean
DEV tag at HEAD, committed metadata consistency, and the computed PROD tag at
that same commit. It fetches canonical tags without force. Missing tag/history,
noncanonical origin or debug main builds fail. This is build-time identity
derivation, not an environment variable supplied by the release controller.
Pages must allow canonical origin tag reads in its build checkout.

Vite injects the derived PROD version into `GTAR_APP_VERSION` consumers, including
existing display/backup consumers, and emits immutable deployment `release.json`
with version/sourceTag/full SHA. Local/preview builds retain the legacy fallback;
DEV constants and authCore header remain source stamps. Production source is
never rewritten to bump a version during promotion. CI validates the exact source;
Pages rebuilds it via Git integration using the atomic tag identity.

### Production verification and external integration gap

The existing GitHub check observed on DEV.10 was emitted by app
`cloudflare-workers-and-pages`, project `gtar-web`, deployment
`214ccb9b-aa78-456c-b3ab-4af9f70b4312`, full SHA
`bad302b79a91e422bcb485a3f2b5f4020ec21417`. Its summary labels preview URLs and has
**no explicit production marker**. Generic check success is never PROD proof.

The stronger implemented signal is the authenticated Cloudflare Pages read API.
Preflight and post-approval require project `gtar-web`, GitHub source
`ozzzmond/GTAR`, production branch `main`, and production Git builds enabled.
Verification polls the current canonical deployment (up to 40 reads, 15 seconds
apart), then reads that deployment by ID. Required fields: matching project ID
and name; explicit `environment=production`; GitHub source; `github:push` trigger;
branch main; exact full SHA; clean commit; deployment not skipped; successful
final deploy stage; and creation time strictly after the recorded push-start
boundary. The deployment must still be canonical. This also binds new production
proof to a new main push, because preflight forbids main already at the checkpoint.
It checks immutable Pages deployment `release.json` against the computed version,
source tag and full SHA and rechecks main/PROD refs. Only then is `VERIFIED_PROD`
emitted. Any missing API field/credential, stale/preview/manual deployment,
untrusted project/source, failed build, or runtime mismatch fails closed.

The connector used for this implementation rejects environment endpoints and has
no connected Cloudflare account read API. Therefore actual environment protection,
freeze rulesets, read/push secrets, Pages production-branch settings and API payload
availability were **not verified or configured in this task**. Configure the above
settings and run the reviewed controller's dry run; a failed gate is not permission
to bypass it. Cloudflare remains the deployment producer; this read API verifier
adds no second deployment mechanism.

Promotion followed by insufficient/failed verification reports
`PROD_PROMOTED_BUT_UNVERIFIED` and fails the workflow. Preserve actual refs and
investigate deployment/identity evidence. Never auto-rollback main or tags.

### Separate reviewed controller rollout (no production work in this PR)

Current audited refs: dev/DEV.10 `bad302b79a91e422bcb485a3f2b5f4020ec21417`;
main `247e016a6234204013857c70d1b4a34b1e6360fc`. Main has 18 commits outside DEV;
DEV has 111 outside main. Main is not an ancestor. Highest canonical PROD tag is
`v1.1.62`, with its own package `1.1.62`; main package is `1.1.108`. These history
and baseline/deployed identity discrepancies remain real release blockers.

1. Review and merge **this PR to dev only**. This task changes no main/DEV/PROD tag,
   creates no environment/ruleset, and triggers no PROD deployment.
2. Separately authorize a narrow PR based on current main that installs only the
   reviewed controller files: `release.yml`, `prod_controller.cjs`,
   `release_metadata.cjs`, `release_identity.cjs`, and this operator README. Replace
   main's legacy APK release workflow entirely. Do not merge dev into main just to
   install it. Main is GitHub's default branch, required for manual dispatch.
   Before that rollout merge, separately authorize temporarily disabling Pages
   production auto-builds so the controller-only main push cannot deploy legacy
   source; verify the setting. Restore builds only under the later release plan.
3. Separately review all main-only history and actual deployed baseline identity;
   reconcile them into dev with explicit conflict decisions. Do not invent a
   baseline tag or silently discard history. Include the installed main controller
   as an ancestor of a future DEV checkpoint. Metadata/identity must satisfy the
   implemented baseline gates; document any separately reviewed contract change.
4. After acceptance, establish and validate a **new development iteration and new
   clean numeric DEV checkpoint** under the existing policy. DEV.10 cannot be
   promoted once dev changes; source stamps in this implementation stay unchanged
   until that separately reviewed stabilization. No tags are created by this PR.
5. Configure protection/secrets/Pages settings, enable Git builds, activate the
   release freeze, and dry-run from reviewed main with the new exact tag/SHA. After
   all gates succeed, a separate explicitly authorized real dispatch runs tests,
   waits for required human approval, rechecks, and performs the transaction.

After `VERIFIED_PROD`, separately review a dev metadata PR for advisory next DEV,
validate/merge it, then manually create its tag under the existing policy.
