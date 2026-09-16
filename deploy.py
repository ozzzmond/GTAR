#!/usr/bin/env python3
"""Automated Production Deployment Tool for GTAR Web and Android.

Deploys Web to production on 'main' branch cleanly from production release tags,
and deploys Android by pushing production tags to trigger GitHub Actions release.yml.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import release_android
import release_web


def git(*args, check=True):
    result = subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True, check=False)
    if check and result.returncode != 0:
        err = result.stderr.strip() or result.stdout.strip() or "Git command failed"
        raise ValueError(f"git {' '.join(args)} failed: {err}")
    return result.stdout.strip()


def check_clean_working_tree(dry_run: bool = False):
    status = git("status", "--porcelain")
    if status.strip():
        if dry_run:
            print(f"[WARN] Working tree has uncommitted changes (enforced on actual run):\n{status}\n")
        else:
            raise ValueError(
                "Working tree has uncommitted changes. Aborting deployment for safety.\n"
                "Please commit or stash changes before deploying to production:\n"
                + status
            )


def find_latest_prod_tag(platform: str) -> str:
    """Find the latest production tag for platform using release metadata and git tags."""
    if platform == "web":
        try:
            prod_ver = release_web.inspect()[1]["prod"]
            tag_candidate = release_web.release_metadata(prod_ver)["tag"]
            if tag_candidate in git("tag", "-l", tag_candidate).split():
                return tag_candidate
        except Exception:
            pass

    pattern = rf"^{platform}-v1\.1\.(\d+)$"
    tags = git("tag", "-l", f"{platform}-v1.1.*").split()
    matched = []
    for t in tags:
        m = re.fullmatch(pattern, t)
        if m:
            matched.append((int(m.group(1)), t))
    if not matched:
        raise ValueError(f"No production release tags found matching '{platform}-v1.1.*'.")
    matched.sort(key=lambda x: x[0])
    return matched[-1][1]


def validate_prod_tag(tag: str, platform: str) -> str:
    """Strictly validate that tag matches target production format and exists locally."""
    expected_platform = "app" if platform in ("app", "android") else "web"
    pattern = rf"^{expected_platform}-v1\.1\.(\d+)$"
    if not re.fullmatch(pattern, tag):
        raise ValueError(
            f"Invalid production release tag '{tag}' for platform '{platform}'. "
            f"Must strictly match format '{expected_platform}-v1.1.<patch>' (dev tags and cross-platform tags are rejected)."
        )
    local_tags = git("tag", "-l", tag).split()
    if tag not in local_tags:
        raise ValueError(f"Production release tag '{tag}' does not exist locally.")
    validate_tag_metadata(tag, expected_platform)
    return tag


def validate_tag_metadata(tag: str, platform: str):
    """Read frozen metadata from the tag, never the current working tree."""
    ref = f"refs/tags/{tag}"
    version = tag.split("-v", 1)[1]
    if platform == "web":
        package = json.loads(git("show", f"{ref}:web/package.json"))
        lock = json.loads(git("show", f"{ref}:web/package-lock.json"))
        constants = git("show", f"{ref}:web/src/types/gtar.ts")
        if any(value != version for value in (package.get("version"), lock.get("version"), lock.get("packages", {}).get("", {}).get("version"), release_web.constant(constants, "GTAR_APP_VERSION"))):
            raise ValueError("Tagged web production metadata mismatch or dev-versioned source")
    else:
        gradle = git("show", f"{ref}:app/build.gradle.kts")
        name = release_android.field(gradle, release_android.NAME)
        suffix = release_android.field(gradle, release_android.SUFFIX)
        code = int(release_android.field(gradle, release_android.CODE))
        if name != f"app v{version}" or suffix or not 1 <= code <= 2100000000:
            raise ValueError("Tagged Android production metadata mismatch or dev-versioned source")


def verify_remote_tag_peeled_sha(tag: str, remote: str) -> bool:
    """If tag exists on remote, verify peeled commit SHA matches local commit SHA."""
    ls_out = git("ls-remote", "--tags", remote, f"refs/tags/{tag}", f"refs/tags/{tag}^{{}}")
    if not ls_out.strip():
        return False
    remote_shas = {}
    for line in ls_out.splitlines():
        parts = line.strip().split()
        if len(parts) >= 2:
            remote_shas[parts[1]] = parts[0]
    remote_commit_sha = remote_shas.get(f"refs/tags/{tag}^{{}}") or remote_shas.get(f"refs/tags/{tag}")
    if not remote_commit_sha:
        return False
    local_commit_sha = git("rev-parse", f"refs/tags/{tag}^{{commit}}")
    if local_commit_sha != remote_commit_sha:
        raise ValueError(
            f"Remote tag '{tag}' points to commit {remote_commit_sha}, but local tag points to {local_commit_sha}. "
            "Aborting deployment to avoid overwriting or divergent release history."
        )
    return True


def deploy_web(tag: str = None, remote: str = "origin", dry_run: bool = False):
    print("\n=======================================================")
    print("           GTAR Web Production Deployment              ")
    print("=======================================================")

    if not tag:
        tag = find_latest_prod_tag("web")
    tag = validate_prod_tag(tag, "web")

    initial_branch = git("branch", "--show-current")
    if not initial_branch:
        raise ValueError("Cannot determine current branch (detached HEAD).")

    print(f"[TARGET] Production release tag: {tag}")
    print(f"[TARGET] Deploy target branch:    main")
    print(f"[TARGET] Return working branch:   {initial_branch}")
    print(f"[TARGET] Remote repository:       {remote}")

    remote_tag_exists = verify_remote_tag_peeled_sha(tag, remote)
    print(f"[STATUS] Tag on remote {remote}:   {'YES (verified peeled SHA)' if remote_tag_exists else 'NO (will be pushed)'}")

    if dry_run:
        print("\n[DRY RUN] Web Production Deployment Plan:")
        print(f"  1. Verify working tree is clean.")
        print(f"  2. Record current branch: '{initial_branch}'")
        print(f"  3. Switch to 'main': git checkout main")
        print(f"  4. Sync latest from remote: git pull --ff-only {remote} main")
        print(f"  5. Synchronize complete tracked tree: git rm -rf --ignore-unmatch -- web/ && git checkout {tag} -- web/")
        print(f"  6. Stage changes: git add -A -- web/")
        print(f"  7. Create standardized commit: git commit -m 'chore(release): deploy {tag} to prod'")
        print(f"  8. Verify Git object tree equality: HEAD:web == {tag}:web")
        print(f"  9. Push 'main' to remote: git push {remote} main")
        if not remote_tag_exists:
            print(f"  10. Push production tag: git push {remote} refs/tags/{tag}:refs/tags/{tag}")
        else:
            print(f"  10. Production tag {tag} already on {remote}; push not needed.")
        print(f"  11. Restore initial branch: git checkout {initial_branch}")
        print("\n[DRY RUN] No changes were made to repository or remote.")
        return 0

    remote_main_exists = bool(git("ls-remote", "--heads", remote, "refs/heads/main").strip())
    print(f"\n[DEPLOY] 1/6 Switching to 'main' branch...")
    git("checkout", "main")

    try:
        print(f"[DEPLOY] 2/6 Pulling latest 'main' from {remote}...")
        if remote_main_exists:
            try:
                git("pull", "--ff-only", remote, "main")
            except Exception as pull_err:
                raise ValueError(f"Failed to fast-forward pull 'main' from {remote}: {pull_err}")
        else:
            print(f"[INFO] Remote branch 'main' does not exist yet on {remote}; pull skipped.")

        print(f"[DEPLOY] 3/6 Synchronizing complete tracked tree from snapshot '{tag}'...")
        git("rm", "-rf", "--ignore-unmatch", "--", "web/")
        git("checkout", tag, "--", "web/")
        git("add", "-A", "--", "web/")

        status = git("status", "--porcelain", "--", "web/")
        if status.strip():
            print(f"[DEPLOY] 4/6 Staging and committing release snapshot...")
            commit_msg = f"chore(release): deploy {tag} to prod"
            git("commit", "-m", commit_msg)
            print(f"[DEPLOY] Created commit: {commit_msg}")
        else:
            print(f"[INFO] 4/6 'main' is already synchronized with '{tag}'. No commit needed.")

        # Verify Git object tree equality
        head_tree = git("rev-parse", "HEAD:web")
        tag_tree = git("rev-parse", f"{tag}:web")
        if head_tree != tag_tree:
            raise ValueError(
                f"Tree equality check failed! main:web ({head_tree}) does not match {tag}:web ({tag_tree})."
            )
        print(f"[DEPLOY] Git object tree equality verified: main:web == {tag}:web ({tag_tree})")

        print(f"[DEPLOY] 5/6 Pushing 'main' to {remote}...")
        git("push", remote, "main")
        print(f"[DEPLOY] Pushed 'main' successfully to {remote}.")

        if not remote_tag_exists:
            print(f"[DEPLOY] 6/6 Pushing production tag '{tag}' to {remote}...")
            git("push", remote, f"refs/tags/{tag}:refs/tags/{tag}")
            print(f"[DEPLOY] Pushed tag '{tag}' to {remote}.")
        else:
            print(f"[INFO] 6/6 Production tag '{tag}' already present on {remote}.")

        print(f"\n[SUCCESS] Web production release '{tag}' deployed successfully to 'main'!")
    finally:
        print(f"[RESTORE] Returning to '{initial_branch}' branch...")
        git("checkout", initial_branch)
        print(f"[RESTORE] Safely back on '{initial_branch}'.")

    return 0


def deploy_app(tag: str = None, remote: str = "origin", dry_run: bool = False):
    print("\n=======================================================")
    print("         GTAR Android App Production Deployment        ")
    print("=======================================================")

    if not tag:
        tag = find_latest_prod_tag("app")
    tag = validate_prod_tag(tag, "app")

    print(f"[TARGET] Production release tag: {tag}")
    print(f"[TARGET] Remote repository:       {remote}")

    remote_tag_exists = verify_remote_tag_peeled_sha(tag, remote)
    print(f"[STATUS] Tag on remote {remote}:   {'YES (verified peeled SHA)' if remote_tag_exists else 'NO (will be pushed)'}")

    if dry_run:
        print("\n[DRY RUN] Android Production Deployment Plan:")
        print(f"  1. Verify working tree is clean.")
        print(f"  2. Target production tag: {tag}")
        if remote_tag_exists:
            print(f"  3. Tag {tag} is already on {remote}. GitHub Actions APK release workflow runs on tag creation.")
        else:
            print(f"  3. Push production tag: git push {remote} refs/tags/{tag}:refs/tags/{tag}")
            print(f"  4. GitHub Actions workflow (release.yml) will trigger on tag push to build & release APK.")
        print("\n[DRY RUN] No changes were made to repository or remote.")
        return 0

    if remote_tag_exists:
        print(f"[INFO] Production tag '{tag}' is already present on {remote}.")
        print(f"[INFO] GitHub Actions APK Build & Release workflow triggers upon tag creation.")
    else:
        print(f"[DEPLOY] Pushing production tag '{tag}' to {remote}...")
        git("push", remote, f"refs/tags/{tag}:refs/tags/{tag}")
        print(f"[DEPLOY] Pushed tag '{tag}' to {remote}.")
        print(f"[TRIGGER] GitHub Actions workflow 'release.yml' triggered to build and release APK.")

    print(f"\n[SUCCESS] Android production deployment for '{tag}' initiated successfully!")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Automated Production Deployment Tool for GTAR Web and Android.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  python deploy.py web --dry-run
  python deploy.py app --dry-run
  python deploy.py web
  python deploy.py app
  python deploy_web.py --dry-run
  python deploy_app.py --dry-run
""",
    )
    parser.add_argument(
        "target",
        nargs="?",
        choices=["web", "app", "android"],
        default=None,
        help="Target platform to deploy ('web' or 'app')",
    )
    parser.add_argument(
        "--platform",
        choices=["web", "app", "android"],
        dest="platform_flag",
        help="Explicit platform flag ('web' or 'app')",
    )
    parser.add_argument("--tag", help="Override with explicit production tag (e.g. web-v1.1.83 or app-v1.1.72)")
    parser.add_argument("--remote", default="origin", help="Git remote name (default: origin)")
    parser.add_argument("--dry-run", action="store_true", help="Inspect planned deployment actions without modifying Git refs or branches")

    args = parser.parse_args(argv)
    platform = args.target or args.platform_flag

    if not platform:
        parser.print_help()
        print("\n[ERROR] Please specify a platform target: 'web' or 'app'.", file=sys.stderr)
        return 1

    try:
        check_clean_working_tree(dry_run=args.dry_run)
    except ValueError as err:
        print(f"[ERROR] {err}", file=sys.stderr)
        return 1

    try:
        if platform == "web":
            return deploy_web(tag=args.tag, remote=args.remote, dry_run=args.dry_run)
        else:
            return deploy_app(tag=args.tag, remote=args.remote, dry_run=args.dry_run)
    except Exception as err:
        print(f"\n[ERROR] Deployment failed: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
