# Release history

Historical context only. The live release contract is
[RELEASE_WORKFLOW_README.md](../RELEASE_WORKFLOW_README.md).

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
