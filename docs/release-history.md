# Release history

Historical context only. The live release contract is
[RELEASE_WORKFLOW_README.md](../RELEASE_WORKFLOW_README.md).

### Release simplification and repository contract (#466)

Numeric DEV parsing replaces letter suffixes and same-commit aliases. The 38
historical lettered tags remain untouched and inert. The pinned
`v1.0.130-dev.2` / committed `1.0.130-dev.2c` exception stays non-promotable.
Latest DEV means latest numeric tag. Before promotion hotfixes use the next
iteration; after promotion use advisory `nextDevTag` to avoid PROD identity reuse.

Approval snapshots cover main, dev, selected DEV, computed PROD and baseline PROD
refs only. PROD tags remain create-only; numeric `v1.1.*-dev.*` tags can move
before candidate selection, with promotion bound to `expected_sha`. The owner
changed the tag ruleset to exclude `v1.1.*-dev.*`; this PR changes no ruleset.
Repository authority lives in `.github/release_repository.cjs`; Actions checks
the numeric ID and Cloudflare independently checks the source owner/name.
The new contract participates in trusted helper equality and preview overlays.

Owner-only follow-ups: main controller installation, ancestry-preserving DEV
reconciliation, a newly accepted checkpoint tag, and any Cloudflare or ruleset
changes. No deployment or fresh production verification is claimed here.

### R2 VERIFIED_PROD and DEV metadata rebaseline (#441)

R2 PROD `v1.2.0` is VERIFIED_PROD: tag `v1.2.0` points to
`3cfe5b7a912e4982fc72ce96dd656ebcd787862b`, verified by
[promotion run 42812916456](https://github.com/ozzzmond/GTAR/actions/runs/42812916456).
The DEV metadata baseline is now `1.1.0-dev.1`. The owner creates tag
`v1.1.0-dev.1` manually after merge; this metadata change creates no tag.
The historical R2 checkpoint mapping below remains unchanged.

### Historical reviewed baseline after abandoned v1.1.122

GitHub discovery for this rebaseline found both dev and main at
`c254195e6dfc946138336551e4ce8a87520baf7f`, with identical root tree
`59ca0769cee12f5d73f03e067c5b54be9a848de0`. Canonical DEV
`v1.0.108-dev.14` and historical PROD `v1.1.122` point to that commit.
The DEV application is the source baseline; no application tree transplant or
legacy application deletion is necessary because main already has that tree.
Android is absent. Environment bindings and Cloudflare configuration remain unchanged.

The failed/unverified `v1.1.122` deployment is abandoned. Never rerun run 52,
recover that deployment, move its tag, or relabel it as verified production.
The controller accepts this exact immutable tag/SHA/tree and its committed DEV
metadata only as a historical ancestry anchor. It does not require deployment
proof for that anchor or equality with its obsolete build helper. Moved tags,
wrong trees/source metadata, missing ancestry, and old-identity reuse block.
The exception retires when a higher canonical PROD tag becomes the baseline.
Historical v1.1.62 reconciliation code remains for its existing tests; it cannot
activate while the highest canonical PROD tag is v1.1.122.

This historical reconciliation explains the pinned ancestry exception; it is not
an instruction to reuse the abandoned identity or repeat the old controller
rollout. Future candidates must preserve main ancestry, match exact dev tip and
committed metadata, carry the reviewed runtime contract, and calculate a new PROD
tag above the baseline. Human approval, fresh state checks, atomic non-force
promotion, and verification of the new exact-SHA deployment remain mandatory.

### Historical v1.0.123-dev.6a checkpoint

`v1.0.123-dev.6a` is immutable historical evidence: its tag points to the accepted
cleanup SHA, but its committed stamps remained `1.0.123-dev.6`, so tag-preview
metadata validation rejected it. Do not move or recreate that tag or weaken the
validator. The next hygiene checkpoint uses `1.0.123-dev.6b` consistently.

### Planned R2 version baseline (#439; not yet released)

Provisional T=v1.0.145-dev.3 maps only to PROD v1.2.0 and advisory next DEV
v1.1.0-dev.1. No accepted final SHA or deployment is asserted by this entry.
Historical tags and their mappings remain unchanged. The final SHA is bound by
the owner-approved exact-SHA run and canonical immutable DEV/PROD tags, not a
self-referential source constant. Keep the R2 mapping for future identity checks.

The required owner-only A/B/C bootstrap, ancestry-preserving final reconciliation,
stop conditions and no-rollback contract are defined in the
[live release contract](../RELEASE_WORKFLOW_README.md#r2-version-scheme-and-owner-only-controller-bootstrap-439).
The R2 mapping is distinct from the abandoned v1.1.122 ancestry exception; it
does not authorize old deployment recovery or waive any release gate.
