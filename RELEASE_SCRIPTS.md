# GTAR release scripts (091126)

The **OFFICIAL STANDARD** uses strictly positive whole-integer dev iterations, incremented by exactly 1. All previous letter-suffixed versions, including `dev.8a` and `dev.8b`, are **DEPRECATED / LEGACY** and must not be emitted as new releases.

| Platform | Dev display name | Production display name |
| --- | --- | --- |
| Web | `web v1.0.<base>-dev.<integer>` | `web v1.1.<base>` |

*(Note: Legacy native Android `app v*` line was sunset and archived).*

Example: `web v1.0.62-dev.9`. The 1:1 lifecycle scheme directly mirrors the active patch: `1.0.<X>-dev.*` promotes to production `1.1.<X>`. The next dev cycle baseline increments the patch by 1 and resets iteration to 1: `1.0.<X+1>-dev.1`. Historical tags are retained unchanged as legacy records.

The release tooling is a standalone Python 3.9+ program (`release_web.py`) using only the standard library. Git must be installed for tag validation and version mutations. Run from any directory; paths resolve relative to the script.

Default invocation is read-only dev inspection:

```text
python release_web.py
```

Preview or apply a dev bump (no commit, tag, remote push or deployment):

```text
python release_web.py --bump-dev --dry-run
python release_web.py --bump-dev
```

For a checkout still using the **DEPRECATED / LEGACY** version `1.0.62-DEV.8b`. The specification does not define alphabetic iterations. Supply `--legacy-iteration N` with the intended total numeric iteration when converting it. For example, **only if the intended iteration is 10**:

```text
python release_web.py --bump-dev --legacy-iteration 10 --dry-run
```

That preview produces `web v1.0.62-dev.11`. No default value for N is assumed.

Promotion requires the `dev` branch, a completely clean working tree/index, a configured Git identity, and an unused target tag:

```text
python release_web.py --promote-to-prod --dry-run
python release_web.py --promote-to-prod
```

Promotion uses a direct 1:1 mapping (`prod = 1.1.<base>`), commits production version files, creates an annotated `web-v1.1.<base>` tag, then commits the next dev configuration `1.0.<base+1>-dev.1`. The current branch remains `dev`; the production tag references the preceding production commit. Production promotion does not push, deploy, dispatch CI or build artifacts. Tests/builds should be verified before committing the source to promote. Existing repository hooks still run normally.

Web package and lockfile versions remain valid numeric semver without a display prefix. UI labels gain `web v`, while dev/prod constants remain numeric.

If Git fails partway through promotion, the tool stops and retains completed commits/tags for inspection. It never force-resets history or removes release tags automatically. Review `git status` and `git log` before recovering; rerunning against an existing production tag is rejected.

Git tags always use `web-v<version>` with zero whitespace; human-readable titles use `web v<version>`. Generated tags are validated with `git check-ref-format`. The CI metadata helper validates the checked-out version and rejects mismatched triggering tags before building. Preview workflows run on `web-v1.0.*-dev.*` dev tags. Manual dispatch remains supported. Production publication remains a separate, explicitly controlled operation.

Regression tests (disposable local repositories only):

```text
python -m unittest discover -s tests -p test_release_scripts.py -v
```

Publish a dev bump with an annotated version tag:

```text
python release_web.py --bump-dev --push --dry-run
python release_web.py --bump-dev --push
```

`--push` requires `--bump-dev`, a clean `dev` branch, Git identity, an origin remote,
and an unused local/remote tag. It commits with `chore(web): bump dev version (web v1.0.62-dev.8)`,
annotates the official tag, and atomically pushes only `dev` and that tag to origin.
Unrelated tags are never pushed. An atomic push rejection leaves the local commit and tag intact;
retry the exact command printed by the script after resolving the remote issue, instead of bumping again.
Without `--push`, existing local-only behavior is unchanged. Dry runs never contact origin or modify refs.
Production promotion remains local-only.

---

## Dedicated QoL Release & Deployment Tools

### 1. Git Push & Release Sync Tool (`push_release.py`)

Atomically pushes dev release tags and the `dev` branch to `origin` without hardcoding versions:

```text
# Preview push commands without mutating Git or contacting remote
python push_release.py web --dry-run

# Execute atomic release push to origin
python push_release.py web
```

- Dynamically resolves dev versions and tags from `release_web.py`.
- Validates that the working tree and index are clean before pushing.
- Creates annotated local tags (`web-v1.0.*-dev.*`) if not already present.
- Executes `git push --atomic origin refs/heads/dev:refs/heads/dev refs/tags/<tag>:refs/tags/<tag>`.

### 2. Automated Production Deployment Tool (`deploy.py`, `deploy_web.py`)

Handles safe, conflict-free production deployments:

```text
# Web Production Deployment
python deploy.py web --dry-run     # or: python deploy_web.py --dry-run
python deploy.py web               # or: python deploy_web.py
```

**Web Deployment Workflow:**
1. Detects the latest production release tag (e.g. `web-v1.1.83`).
2. Validates working tree safety (aborts on dirty files).
3. Safely switches to `main`.
4. Pulls latest `origin main`.
5. Checks out the tracked `web/` directory from the production tag snapshot (`git checkout <tag> -- web/`) to eliminate merge conflicts.
6. Commits: `chore(release): deploy <tag> to prod`.
7. Pushes `main` and the production tag to `origin`.
8. Automatically returns the developer to their initial branch (`dev`).

