#!/usr/bin/env python3
"""Git Push & Release Sync Tool.

Handles pushing dev tags (web-v1.0.*-dev.*) and dev branches
atomically to remote origin, ensuring working tree safety and zero hardcoded versions.
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

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
                "Working tree has uncommitted changes. Please commit or stash changes before syncing releases:\n"
                + status
            )


def get_dev_release_info(platform: str = "web"):
    """Retrieve dev version and validated metadata tag using platform release module."""
    if platform != "web":
        raise ValueError(f"Unknown platform: {platform}. Supported platform: 'web'.")
    dev_version = release_web.inspect()[0]
    return release_web.release_metadata(dev_version)


def sync_platform_release(platform: str = "web", remote: str = "origin", dry_run: bool = False, custom_tag: str = None):
    if platform != "web":
        raise ValueError(f"Unknown platform: {platform}. Supported platform: 'web'.")
    print(f"\n[{platform.upper()}] Resolving release metadata...")
    if custom_tag:
        meta = release_web.release_metadata(custom_tag)
    else:
        meta = get_dev_release_info(platform)

    tag = meta["tag"]
    title = meta["title"]
    branch = git("branch", "--show-current")
    if not branch:
        raise ValueError("Cannot determine current git branch (detached HEAD).")

    print(f"[{platform.upper()}] Target dev version: {title}")
    print(f"[{platform.upper()}] Target release tag: {tag}")
    print(f"[{platform.upper()}] Current branch:    {branch}")

    # Verify local tag existence
    local_tags = git("tag", "-l", tag).split()
    tag_exists_locally = tag in local_tags

    # Verify remote tag existence
    remote_refs = git("ls-remote", "--tags", remote, f"refs/tags/{tag}").strip()
    tag_exists_remotely = bool(remote_refs)

    if dry_run:
        print(f"[DRY RUN] Status for {tag}:")
        print(f"  - Local tag exists:   {'YES' if tag_exists_locally else 'NO (will be created from HEAD)'}")
        print(f"  - Remote tag exists:  {'YES' if tag_exists_remotely else 'NO'}")
        if not tag_exists_locally:
            print(f"  - Plan command: git tag -a {tag} -m \"{title}\"")
        if tag_exists_remotely:
            print(f"  - Plan command: git push {remote} refs/heads/{branch}:refs/heads/{branch}")
            print(f"    (Note: Tag {tag} already exists on {remote}; pushing branch updates only)")
        else:
            print(f"  - Plan command: git push --atomic {remote} refs/heads/{branch}:refs/heads/{branch} refs/tags/{tag}:refs/tags/{tag}")
        return

    # Create local annotated tag if missing
    if not tag_exists_locally:
        print(f"[{platform.upper()}] Creating annotated local tag '{tag}'...")
        git("tag", "-a", tag, "-m", title)
        print(f"[{platform.upper()}] Created tag {tag}.")

    # Atomic push branch and tag
    if not tag_exists_remotely:
        print(f"[{platform.upper()}] Atomically pushing branch '{branch}' and tag '{tag}' to {remote}...")
        git("push", "--atomic", remote, f"refs/heads/{branch}:refs/heads/{branch}", f"refs/tags/{tag}:refs/tags/{tag}")
        print(f"[{platform.upper()}] Successfully pushed branch '{branch}' and tag '{tag}' to {remote}.")
    else:
        print(f"[{platform.upper()}] Tag '{tag}' is already present on {remote}. Pushing branch '{branch}'...")
        git("push", remote, f"refs/heads/{branch}:refs/heads/{branch}")
        print(f"[{platform.upper()}] Branch '{branch}' synchronized to {remote}.")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="QoL Tool: Git Push & Release Sync for GTAR Web.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  python push_release.py web --dry-run
  python push_release.py web
""",
    )
    parser.add_argument(
        "target",
        nargs="?",
        choices=["web"],
        default="web",
        help="Target platform to sync (default: 'web')",
    )
    parser.add_argument(
        "--platform",
        choices=["web"],
        dest="platform_flag",
        help="Explicit platform flag ('web')",
    )
    parser.add_argument("--tag", help="Override with explicit dev tag (e.g. web-v1.0.83-dev.1)")
    parser.add_argument("--remote", default="origin", help="Git remote name (default: origin)")
    parser.add_argument("--dry-run", action="store_true", help="Inspect planned actions without executing git push or creating tags")

    args = parser.parse_args(argv)
    platform = args.platform_flag or args.target or "web"

    try:
        check_clean_working_tree(dry_run=args.dry_run)
    except ValueError as err:
        print(f"[ERROR] {err}", file=sys.stderr)
        return 1

    try:
        sync_platform_release(platform, remote=args.remote, dry_run=args.dry_run, custom_tag=args.tag)
        print("\n[DONE] Release sync operation completed successfully.")
        return 0
    except Exception as err:
        print(f"\n[ERROR] Release sync failed: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
