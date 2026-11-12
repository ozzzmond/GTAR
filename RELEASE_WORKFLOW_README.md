# GTAR GitHub preview contract

GitHub tags are the version source of truth. Canonical DEV tags are
`v1.0.<nonnegative-base>-dev.<positive-iteration>`
(historical scheme) and `v1.1.<nonnegative-base>-dev.<positive-iteration>`
(R2 scheme; base zero is valid).
Neither numeric component may contain leading zeroes. Only numeric DEV tags are accepted. Production tags are rejected by preview validation.

Pushes of `v1.0.*-dev.*` and `v1.1.*-dev.*` tags trigger preview validation. Manual dispatch requires
an explicit canonical tag. The workflow checks out `refs/tags/<requested tag>`
with complete history, then runs the standalone Node helper before install,
tests, lint, and build:

```sh
node .github/release_metadata.cjs --tag "$REQUESTED_TAG"
```

The helper requires the exact tag to exist, its peeled commit to equal HEAD,
and `web/package.json` version to equal the tag without its leading `v`. Only after all checks pass does it print and append to `GITHUB_ENV`:
`RELEASE_TAG`, `RELEASE_TITLE` (`GTAR <tag>`), `IS_PRERELEASE=true`, and
`IS_PROMOTABLE` (`false` only for the pinned legacy metadata exception). The artifact name is exactly `RELEASE_TAG`.

This flow creates build artifacts only. It does not tag, push branches, deploy,
or promote to production. No stage environment is included. The separate production planner below is fail-closed. Existing application versions and historical GitHub tags are unchanged.

PR validation runs the full Web/PWA test suite (including disposable-repository
metadata integration tests and repository boundary checks), sync lint, and build.

Agent flow and handoff standard: [AGENTS.md](AGENTS.md#agent-handoff-standard)

## Executable Web/PWA production controller

The dispatch-only `release.yml` retains the reviewed order: plan → exact-SHA Web
validation → protected human approval → fresh full recheck → atomic non-force
main/PROD-tag transaction → existing Cloudflare Pages Git build → production
verification → terminal report. Dry run defaults to true, performs gates only,
and claims no tests/build. There is no stage, APK, Gradle, signing, GitHub Release,
Wrangler deployment, API deployment, source rewrite, automatic rollback or DEV
baseline mutation. The active repository is Web/PWA only. Android stays frozen in its separate repository.

`release_metadata.cjs` remains the sole DEV parser and committed metadata reader;
its preview CLI/exports remain compatible. `prod_controller.cjs` is trusted code
from the exact dispatch SHA on reviewed `main`, never from the checkpoint. The
validation job checks out only the selected SHA and receives no release secrets.
All gate failures exit nonzero before production mutation.

### Exact source and approval gates

Required inputs are the exact DEV tag and full lowercase SHA. Gates require a
clean numeric tag, latest numeric DEV, exact dev tip,
consistent package/lock/DEV/auth source stamps, computed PROD above the canonical
baseline, absent PROD tag, baseline ancestry, main ancestry, and unchanged
controller/main since dispatch. Legacy app-v/web-v tags do not establish baseline.
Baseline identity accepts a legacy tagged PROD package or the new exact-source
DEV/tag-derived identity contract. The only legacy discrepancy exception is the
exact pinned one-time reconciliation in [release history](docs/release-history.md#historical-reviewed-baseline-after-abandoned-v11122); all other discrepancies still block.
The checkpoint must contain the reviewed release identity helper/parser bytes and
Vite/runtime integration. Next DEV is an advisory output only.

Configure GitHub **Settings → Environments → gtar-production** before execution:
required human reviewer **ozzzmond** (GitHub User ID `17817198`), **Prevent
self-review** unchecked (`false`), administrator bypass **disabled**
(`can_admins_bypass=false`), and deployment branch policies allowing only branch
**main** (no tag policy). Keep required reviewers enabled; an empty reviewer list,
team-only/bot reviewer, missing maintainer, or enabled self-review prevention
blocks. `plan` reads and verifies that existing environment before the job can
reference it. Missing, inaccessible, incomplete or unprotected configuration
blocks. The environment job enforces the actual approval; dispatch is not approval.
Protection is checked again after approval and fingerprinted against the plan.
Do not remove protection or rotate its policy during an approved run.

The single maintainer can dispatch and then approve the same run, as two distinct
human actions. After exact-SHA validation passes, GitHub pauses the `promote` job
at `gtar-production`; its job name shows the candidate PROD tag and full source
SHA. Review the plan summary and completed validation, then use **Review
deployments → gtar-production → Approve and deploy** on that run. Include a comment
identifying the exact DEV tag/full SHA and computed PROD tag for the audit trail.
Dispatch, a checkbox/input, elapsed time, and a successful test run are not
approval. Reject/cancel leaves the protected job unstarted and production refs
untouched. GitHub records the reviewer and deployment approval in the run; the
protected environment releases `PROD_PUSH_TOKEN` only after approval. No automatic
approval API, alternate environment, or new credential is introduced. Immediately
inside the approved job, the controller still reruns and fingerprints all gates
before its one atomic transaction. This deliberately permits human self-approval,
not administrator bypass or removal of the required-reviewer boundary.

Native GitHub behavior: [environment protection rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
and [reviewing deployments](https://docs.github.com/en/actions/how-tos/managing-workflow-runs-and-deployments/managing-deployments/reviewing-deployments).
These settings are operator prerequisites; this PR does not change the live environment.

Repository secrets:

- `APPROVAL_READ_TOKEN`: read-only GitHub credential able to GET environment and
  environment branch policies (appropriate Actions/
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

### Automatic PROD D1 migration readiness

Plan (including dry run) and the fresh post-approval recheck inspect PROD D1
before any main/tag transaction. The trusted controller reads regular canonical
`web/migrations/*.sql` blobs from the exact selected checkpoint SHA, never the
working tree. It requires the checkpoint's PROD binding to match the reviewed
controller configuration and the Pages project's production `DB` binding.
Unsupported configuration/layout, missing inventory or inconsistent PROD/DEV
bindings fail closed; no checkpoint scripts or migration SQL are executed.

Applied migration names come from Wrangler's authoritative `d1_migrations`
ledger. The controller sends only a fixed `SELECT id, name ... ORDER BY id` to
the [D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/).
It does not use Wrangler's migration-list initialization, which can create the
ledger table. See the [D1 migration contract](https://developers.cloudflare.com/d1/reference/migrations/).
The existing `CF_PAGES_READ_TOKEN` must already permit **D1 Read** in the configured
account as well as Pages Read. Pages Read alone cannot establish readiness.
No new credential, permission change or rotation is performed by the controller.
If existing credentials cannot safely read this state, readiness remains HOLD;
an operator must separately resolve the access prerequisite before rerunning.

Missing migrations report their canonical filenames. Failed/denied lookup,
missing ledger, malformed results, duplicate/unknown applied names or IDs,
unverifiable no-write metadata, and binding mismatch block promotion. Lookup
failure reports required filenames as unverified, not as proven pending.
Raw API errors, credentials and database/account identifiers are never emitted.
Fully current PROD D1 allows all existing independent release gates to continue.

This is detection only: no automatic PROD migration, ledger creation, SQL repair,
schema/data mutation, or remediation. Humans review the pending filenames,
perform any separately authorized remediation, and rerun the complete readiness
check. The ledger records names, not SQL checksums; applied-file content/schema
equivalence is not claimed. D1 state can change after the final read; concurrency
does not lock external database writers.
Canonical tags are created manually after checkpoint acceptance.

### Race and transaction contract

The DEV branch ruleset `gtar-release-freeze-dev` and DEV tag ruleset
`gtar-release-freeze-dev-tags` are intentionally retired and are not required.
The controller does not read, require, recreate, emulate or manage them. No
replacement permanent DEV branch/tag freeze or bypass actor is introduced.
Normal solo-maintainer DEV merges and manual canonical DEV tagging remain available.

Concurrency serializes this controller, but cannot serialize other GitHub writers.
Fresh revalidation and immediate remote-ref reads reject observed DEV/tag drift.
The atomic transaction compares and updates main and the new PROD tag only;
it does not lock DEV or compare-and-swap unchanged DEV refs. DEV/tag changes after
the final read can therefore occur; promotion remains bound to the exact validated
checkpoint SHA. Keep the protected approval environment unchanged during a run.

The post-approval job fetches branches and canonical release tags. Inert and
unrelated tags are ignored during fetch. Only numeric new-scheme
DEV tags may be refreshed after movement; PROD, baseline and other tags fetch
non-forced. It recomputes every gate and compares only `refs/heads/main`,
`refs/heads/dev`, the selected DEV tag, computed PROD tag and baseline PROD tag
against the validated plan, plus the protection/project fingerprint. It rereads
these scoped refs immediately before push. Drift in any scoped ref blocks;
`refs/pull/*` and unrelated tags are outside the snapshot.
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
outputs first. PROD tags are create-only. New-scheme DEV tags `v1.1.*-dev.*` may move before
candidate selection; promotion stays bound to `expected_sha`. The owner changed
the tag ruleset to exclude `v1.1.*-dev.*`. Historical tags remain untouched.

### Runtime identity without source rewrite

Package version and GTAR_DEV_VERSION remain tested DEV source stamps. Pages main
requires its full CF_PAGES_COMMIT_SHA to equal HEAD, one exact clean DEV tag,
consistent committed metadata, and its computed PROD tag at the same commit.
The helper fetches tags from the authority URL in
[`.github/release_repository.cjs`](.github/release_repository.cjs) and
checks selected tag objects against canonical remote refs. Checkout origin may
be a Cloudflare mirror; it is neither consulted nor changed. Fetch can refresh only numeric R2 DEV tags; PROD and other tags remain
non-forced. Missing authority/network/history, mismatched or local-only
tags, wrong SHA, debug production builds, and abandoned identity reuse fail closed.
No provider URL allowlist or fallback to guessed/package PROD version exists.

GitHub release validation sets GTAR_VALIDATE_SHA to the planned exact source SHA
and checks canonical DEV identity before PROD tag creation. It emits no PROD
release.json or PROD version override. Ordinary PR validation and Pages DEV or
feature previews use the application source stamps and never claim PROD identity.
Production rejects validation-mode overrides. Vite passes build mode explicitly
so --mode debug cannot evade the production guard.

Only the production path injects the tag-derived PROD version and emits
release.json with version/sourceTag/full SHA. Pages must permit read access to
canonical GitHub tags. Future post-approval verification proves this new identity
on the new deployment; historical deployment recovery is unnecessary.

### Production verification and external integration prerequisites

A historical GitHub check observed on DEV.10 was emitted by app
`cloudflare-workers-and-pages`, project `gtar-web`, deployment
`214ccb9b-aa78-456c-b3ab-4af9f70b4312`, full SHA
`bad302b79a91e422bcb485a3f2b5f4020ec21417`. Its summary labels preview URLs and has
**no explicit production marker**. Generic check success is never PROD proof.

The stronger implemented signal is the authenticated Cloudflare Pages read API.
Preflight and post-approval require project `gtar-web`, GitHub source matching
the owner/name in `.github/release_repository.cjs`, production branch `main`, and production Git builds enabled.
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

Environment protection, read/push secret provisioning, Pages production-branch
settings and API payload availability require separate operator verification.
Repository tests do not prove live configuration. Configure the above settings
and run the reviewed controller's dry run; a failed gate is not permission to
bypass it. Cloudflare remains the deployment producer; this read API verifier
adds no second deployment mechanism.

Promotion followed by insufficient/failed verification reports
`PROD_PROMOTED_BUT_UNVERIFIED` and fails the workflow. Preserve actual refs and
investigate deployment/identity evidence. Never auto-rollback main or tags.

### Repository identity and owner-only controller installation (#466)

`.github/release_repository.cjs` defines GitHub owner, repository name, numeric
repository ID and tag-authority URL once. The identity helper and Cloudflare
project/deployment checks consume this contract. Cloudflare still compares
owner/name independently because that is its Git source payload. Actions must
provide `GITHUB_REPOSITORY_ID` equal to the contract ID; missing or different IDs
fail closed. Environment variables cannot override canonical tag authority.
The runtime contract includes the repository file alongside both helper files.
Manual preview dispatch overlays all three files and Vite from the dispatch SHA.

This DEV PR does not install a controller on main. The owner must separately
approve main controller installation, verify its fail-closed bootstrap build,
reconcile the exact installation into dev while preserving ancestry, validate
the final checkpoint and authorize its numeric tag. Install all three helpers,
the controller and preview overlay together. Preserve main's application tree,
release.yml, database bindings and migrations during installation. Any ruleset
or Cloudflare change remains owner-only and requires separate authorization.
Do not touch GTAR1. See the A/B/C procedure below for ancestry and stop gates.

### Current checkpoint and promotion procedure

Prepare changes through a dedicated PR against `dev`. Before merge, keep
`web/package.json`, both root package-lock version fields, `GTAR_DEV_VERSION`,
and the authCore release stamp equal to the intended DEV tag without `v`.
Run the repository checks before a human creates the tag at the accepted merge
SHA. Preview validation retains exact tag/HEAD and package-version checks.
Bump version metadata on `dev`, merge, then tag that merge SHA; the tag must match `web/package.json`.

Historical checkpoint notes: [release history](docs/release-history.md).

Historical lettered tags are inert: parser, planner and identity filters reject
or ignore them. They do not affect latest numeric DEV selection.

Production requires a later clean numeric DEV checkpoint satisfying all controller
gates, including latest DEV, exact dev tip, main ancestry, checkpoint metadata,
production baseline and D1 readiness. Verify the current GitHub refs and configured
protection/secrets/Pages settings through the reviewed controller on `main`; old
rollout snapshots are not deployment instructions. A dry run performs gates only.
Real promotion requires separate explicit human authorization, exact-SHA validation,
native environment approval, fresh checks and verified Pages deployment.

Hotfix rule: before promotion use the next numeric DEV iteration. After
promotion use the advisory `nextDevTag` in a separately reviewed metadata PR.
For example, `v1.1.0-dev.2` and `v1.1.1-dev.1` both map to `v1.2.2`; latest
numeric DEV and create-only PROD collision gates reject identity reuse.

After `VERIFIED_PROD`, separately review a dev metadata PR for advisory next DEV,
validate/merge it, then manually create its tag under the existing policy.

## R2 version scheme and owner-only controller bootstrap (#439)

The provisional final old-scheme checkpoint is **v1.0.145-dev.3** (T).
No final checkpoint SHA has been selected and no tag is created by this change.
Only this exact clean tag maps to PROD **v1.2.0**, with advisory next DEV
**v1.1.0-dev.1**. It requires direct committed T metadata. A different accepted checkpoint name requires a reviewed tooling change
and matching trusted-controller installation before tagging. PROD tags remain create-only.

Historical v1.0 DEV mappings remain v1.1.(base + iteration), except T. New
v1.1.B-dev.N maps to v1.2.(B + N), next DEV v1.1.(B + N)-dev.1. B may be zero;
N must be positive. For example v1.1.0-dev.1 gives v1.2.1 and next
v1.1.1-dev.1. Arithmetic must be safe integers without leading zeroes.
DEV ordering compares scheme minor, base and iteration; PROD ordering compares minor then patch. Thus v1.2.0
exceeds historical v1.1.145 despite its smaller patch. The R2 mapping remains
permanent for runtime identity and baseline reconciliation, not a reusable
permission to promote another old-scheme checkpoint.

The mapping constant in release_metadata.cjs fixes T/PROD/next DEV; it cannot
contain its own final source commit SHA. The owner records the final accepted C
SHA and binds it through expected_sha, the validated plan, and native approval
in GitHub execution history. The atomic transaction persists v1.2.0 -> C alongside
T -> C. The create-only PROD tag and the approved run are the SHA authority;
there is no package-derived or guessed SHA fallback. PROD tags are create-only. New-scheme DEV tags may move before candidate
selection, while promotion remains bound to `expected_sha`. This does not claim
to defeat a privileged coordinated rewrite of PROD tags and audit history.

Required sequence (each live action needs its existing separate authorization):

1. Complete #436 item 01 before release acceptance. Review/validate the #439 DEV
   implementation draft PR; owner confirms CI and QA and merges it, producing A.
2. Separately prepare a reviewed controller-install commit B parented by current
   main. Install the approved .github/release_metadata.cjs, release_identity.cjs,
   release_repository.cjs, prod_controller.cjs and web-preview.yml bytes from A. release.yml is unchanged.
   Preserve the entire main web/ tree, migrations, bindings and existing tags.
   This is an explicit owner-authorized non-force main update, not this DEV PR's
   permission to touch main. Verify exact diff/SHA and baseline reconciliation.
3. Before B is pushed, verify Pages runs the existing fail-closed production
   identity guard. The push may schedule a build: B has no clean DEV checkpoint
   and no matching PROD tag, so it must fail before deployment. Do not disable
   protection, set an identity override, rely on skip-ci, change Pages settings,
   or create a tag for B. If this no-deployment property cannot be established,
   stop before installation. A failed bootstrap build is not release proof.
4. Merge that exact B into DEV through an ancestry-preserving reconciliation
   draft PR targeting dev. Owner must preserve B ancestry (no squash/rebase that
   removes B). The accepted result C must include A and B, differ from B, equal
   the DEV tip, and contain the exact trusted parser/identity/repository bytes on main B.
   This reconciliation is the final merge before checkpoint acceptance,
   superseding the earlier statement that A itself must be the final merge.
5. Run required checks on final C, record its full SHA, and reconfirm absent T and
   v1.2.0. Owner accepts C and explicitly authorizes/creates T at C. Any later
   code merge invalidates that acceptance; stop and select a new reviewed
   checkpoint without moving/reusing T.
6. Dispatch the trusted main B workflow with T, expected_sha=C and dry_run=true.
   Require prod_tag=v1.2.0 and next_dev_tag=v1.1.0-dev.1. Dry run performs readiness
   gates only. A real run requires separate owner authorization, exact-C Web
   validation, native environment approval and all fresh post-approval checks.
7. Existing atomic non-force promotion advances main B -> C and creates v1.2.0
   at C together. Require new exact-SHA Pages production proof and release.json.
   Only after VERIFIED_PROD review a separate metadata PR for 1.1.0-dev.1 and
   separately authorize its manual checkpoint tag. Never pre-stamp this version.

Stop on unexpected branch/tag drift, wrong/moved checkpoint, collision, helper
byte mismatch, missing B ancestry, main already at C, unverified bootstrap build
behavior, failed baseline reconciliation, failed tests or unavailable approval,
Pages or D1 readiness. No main-only application update or gate exception is
allowed. Pending D1 migrations require separately authorized human remediation.
After ambiguous push results inspect refs without retrying mutation. A promoted
but unverified release retains its refs as PROD_PROMOTED_BUT_UNVERIFIED; never
automatically roll back main, move/delete tags or redeploy a historical identity.
