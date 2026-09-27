# GTAR Manual Release Workflow

Step-by-step for running the audit, deciding if it's safe to proceed, and
pushing/deploying - no AI involved in any of these steps.

## 1. Run the local audit

```
python audit_local.py
```

Generates `audit_report.md` in the project root. Checks offline assets, PWA
health, storage/sync guards, git status, and test/build readiness. Takes
about 25 seconds.

## 2. Check if it's safe to proceed

Review `audit_report.md` and `git status` to verify release readiness:
- **"NOT safe to push/deploy yet"** - check for any blockers (e.g.
  uncommitted files, failing tests). Fix them, then go back to step 1.
- **"Safe to proceed"** - once tests, build, and lint checks pass cleanly,
  proceed to step 3 in order of increasing risk.

## 3. Bump the dev version (if you're starting a new release)

```
python release_web.py --bump-dev --dry-run   # preview first
python release_web.py --bump-dev --push      # commits, tags, pushes dev to origin
```

If a push gets interrupted partway, don't re-run `--bump-dev` again - use:

```
python push_release.py web --dry-run
python push_release.py web
```

## 4. Promote to production (local only - no push yet)

```
python release_web.py --promote-to-prod --dry-run   # preview first
python release_web.py --promote-to-prod              # commits + tags prod locally
```

This does NOT push or deploy anything. It just prepares the production
commit and tag on your local `dev` branch.

## 5. Deploy to production (this is the real push)

```
python deploy.py web --dry-run   # ALWAYS preview first
python deploy.py web             # switches to main, pushes main + the prod tag
```

## Rules of thumb

- Every script here refuses to run on a dirty working tree - commit or
  stash first if `git status` flags uncommitted files.
- Always run the `--dry-run` version of a command before the real one,
  even if audit checks reported safe.
- `--bump-dev` / `--promote-to-prod` without `--push` never touch the
  remote. Only `--push`, `push_release.py`, and `deploy.py` actually push
  or deploy.
- If something fails partway through, the scripts are designed to leave
  your repo in a recoverable state - check `git status` and `git log`
  before trying again, don't force anything.
