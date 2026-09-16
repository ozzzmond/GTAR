#!/usr/bin/env python3
"""GTAR 091126 release tool. Standard library only; publishing requires explicit --push."""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PLATFORM = 'web'


def git(*args):
    result = subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True, check=False)
    if result.returncode:
        raise ValueError(result.stderr.strip() or result.stdout.strip() or "Git command failed")
    return result.stdout.strip()


def release_metadata(value):
    """Separate display titles from validated refs; shared with CI, no mutation."""
    numeric = re.sub(r"^" + PLATFORM + r"[ -]", "", value.strip()).removeprefix("v")
    if not re.fullmatch(r"(?:1\.0\.(?:0|[1-9][0-9]*)-dev\.[1-9][0-9]*|1\.1\.(?:0|[1-9][0-9]*))", numeric):
        raise ValueError(f"Invalid {PLATFORM} release version: {value!r}")
    tag = f"{PLATFORM}-v{numeric}"
    git("check-ref-format", f"refs/tags/{tag}")
    return {"tag": tag, "title": f"{PLATFORM} v{numeric}", "prerelease": "-dev." in numeric}


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def replace_one(text, pattern, replacement):
    result, count = re.subn(pattern, replacement, text, flags=re.MULTILINE)
    if count != 1:
        raise ValueError(f"Expected exactly one version field: {pattern} (found {count})")
    return result


def parse_dev(value, legacy_iteration):
    # Prefixes belong to display names/tags; npm stores the numeric semver only.
    value = re.sub(r"^" + PLATFORM + r"\s+", "", value).removeprefix("v")
    official = re.fullmatch(r"1\.0\.(0|[1-9][0-9]*)-dev\.([1-9][0-9]*)", value)
    if official:
        if legacy_iteration is not None:
            raise ValueError("--legacy-iteration is only permitted for deprecated legacy versions")
        return int(official[1]), int(official[2])
    legacy = re.fullmatch(r"1\.0\.(0|[1-9][0-9]*)-dev\.([1-9][0-9]*)([a-z]*)", value, re.I)
    if not legacy:
        raise ValueError(f"Invalid dev version: {value}; expected 1.0.<base>-dev.<positive integer>")
    if legacy_iteration is None:
        raise ValueError(f"DEPRECATED / LEGACY: {value}. Use --legacy-iteration N for an explicit whole-integer conversion; letters never count as fixes")
    if legacy_iteration < 1:
        raise ValueError("Legacy conversion must specify a positive whole integer")
    print(f"[DEPRECATED / LEGACY] {value}; explicitly converting to integer iteration {legacy_iteration}. Letter suffixes are not counted.")
    return int(legacy[1]), legacy_iteration


def write_files(files):
    # All paths and content have been computed/validated before any writes.
    originals = {path: (ROOT / path).read_bytes() for path in files}
    try:
        for path, content in files.items():
            (ROOT / path).write_text(content, encoding="utf-8")
    except OSError:
        for path, content in originals.items():
            (ROOT / path).write_bytes(content)
        raise


def commit_files(files, message):
    write_files(files)
    git("add", "--", *files)
    git("commit", "-m", message, "--", *files)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--bump-dev", action="store_true", help="Write the next dev version only; no commit or deployment")
    action.add_argument("--promote-to-prod", action="store_true", help="On clean dev: commit/tag prod locally, then commit next dev reset")
    parser.add_argument("-m", "--message", help="Commit message to use when committing bumped dev changes")
    parser.add_argument("--push", action="store_true", help="With --bump-dev: commit, annotate tag, and atomically push dev and that tag to origin")
    parser.add_argument("--dry-run", action="store_true", help="Print the complete plan without changing files or Git")
    parser.add_argument("--legacy-iteration", type=int, help="Migration only: explicit whole integer for DEPRECATED / LEGACY versions such as DEV.8b")
    args = parser.parse_args(argv)
    if args.legacy_iteration is not None and args.legacy_iteration < 1:
        parser.error("--legacy-iteration must be positive")
    inspection = not (args.bump_dev or args.promote_to_prod)
    try:
        if args.push and not args.bump_dev:
            raise ValueError("--push requires --bump-dev; production promotion remains local only")
        current, metadata = inspect()
        print(f"[{PLATFORM}] Current dev: {current}")
        print("[POLICY] " + ("Commit, tag and push dev release to origin; tag workflows will run." if args.push else "Local only. No push, publish, workflow dispatch, or deployment."))
        try:
            base, iteration = parse_dev(current, args.legacy_iteration)
        except ValueError as error:
            if inspection:
                print(f"[INSPECT] {error}")
                return 0
            raise
        if PLATFORM == "web":
            metadata["dev"] = f"1.0.{base}-dev.{iteration}"
        prod_patch = base + iteration
        prod = f"1.1.{prod_patch}"
        reset = f"1.0.{prod_patch}-dev.1"
        bump = f"1.0.{base}-dev.{iteration + 1}"
        prod_info = release_metadata(prod)
        bump_info = release_metadata(bump)
        print(f"[PLAN] Dev bump: {bump_info['title']}; tag {bump_info['tag']}")
        print(f"[PLAN] Promotion: additive -> {PLATFORM} v{prod}; tag {prod_info['tag']}")
        print(f"[PLAN] Next dev: {PLATFORM} v{reset}")
        if metadata.get("code") is not None:
            code = metadata["code"]
            print(f"[PLAN] versionCode: bump/prod {code} -> {code + 1}; next dev reset -> {code + 2}")
        if inspection:
            print("[INSPECT] No changes. Select --bump-dev or --promote-to-prod explicitly.")
            return 0
        if args.bump_dev:
            files = versions(metadata, bump, None, 1)
        else:
            files = versions(metadata, None, prod, 1)
            next_files = versions(metadata, reset, prod, 2)
        print("[FILES] " + ", ".join(files))
        if args.push:
            print(f"[PLAN] Commit chore({PLATFORM}): bump dev version ({bump_info['title']}); annotate {bump_info['tag']}; atomic push dev and this tag to origin")
        if args.dry_run:
            print("[DRY RUN] No files, commits, branches or tags changed.")
            return 0
        if git("branch", "--show-current") != "dev":
            raise ValueError("Version mutations require the dev branch")
        if args.bump_dev and args.push:
            tag = bump_info["tag"]
            if git("status", "--porcelain"):
                raise ValueError("Push release requires a completely clean working tree and index")
            if git("tag", "--list", tag):
                raise ValueError(f"Tag already exists: {tag}")
            git("var", "GIT_AUTHOR_IDENT")
            git("var", "GIT_COMMITTER_IDENT")
            git("remote", "get-url", "--push", "origin")
            if git("ls-remote", "--tags", "origin", f"refs/tags/{tag}"):
                raise ValueError(f"Remote tag already exists: {tag}")
            commit_files(files, f"chore({PLATFORM}): bump dev version ({bump_info['title']})")
            git("tag", "-a", tag, "-m", bump_info["title"])
            print(f"[TAGGED] {tag}. If push fails, retain this commit/tag and retry: git push --atomic origin refs/heads/dev:refs/heads/dev refs/tags/{tag}:refs/tags/{tag}")
            git("push", "--atomic", "origin", "refs/heads/dev:refs/heads/dev", f"refs/tags/{tag}:refs/tags/{tag}")
            print(f"[DONE] Pushed dev and {tag} to origin.")
            return 0
        if args.bump_dev:
            # Permit unrelated work, but never overwrite staged version changes.
            if git("diff", "--cached", "--name-only", "--", *files):
                raise ValueError("Version files are staged; commit or unstage them before bumping")
            if args.message:
                if git("diff", "--name-only", "--", *files):
                    raise ValueError("Version-bump files have unstaged changes; commit or stash them first")
                originals = {path: (ROOT / path).read_bytes() for path in files}
                write_files(files)
                try:
                    # --only commits these paths without staging unrelated index entries.
                    git("commit", "--only", "-m", args.message, "--", *files)
                except (ValueError, OSError):
                    for path, content in originals.items():
                        (ROOT / path).write_bytes(content)
                    raise
                print(f"[DONE] {PLATFORM} v{bump}; files updated and committed: {args.message}")
            else:
                write_files(files)
                print(f"[DONE] {PLATFORM} v{bump}; files updated, no commit or tag created.")
            return 0
        if git("status", "--porcelain"):
            raise ValueError("Promotion requires a completely clean working tree and index; commit your tested changes first")
        tag = prod_info["tag"]
        if git("tag", "--list", tag):
            raise ValueError(f"Tag already exists: {tag}")
        git("var", "GIT_AUTHOR_IDENT")
        git("var", "GIT_COMMITTER_IDENT")
        start = git("rev-parse", "HEAD")
        print(f"[PROMOTE] Starting from {start}. Release history is retained if a later step fails.")
        commit_files(files, f"release({PLATFORM}): {PLATFORM} v{prod}")
        git("tag", "-a", tag, "-m", f"{PLATFORM} v{prod}")
        print(f"[TAGGED] {tag}; production content is frozen at this tag.")
        commit_files(next_files, f"chore({PLATFORM}): start {PLATFORM} v{reset}")
        print(f"[DONE] dev now at {PLATFORM} v{reset}; {tag} is local only. Nothing deployed.")
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"[ERROR] {error}", file=sys.stderr)
        return 1


PKG = "web/package.json"
LOCK = "web/package-lock.json"
CONSTANTS = "web/src/types/gtar.ts"


def constant(text, name):
    values = re.findall(r"export const " + name + r"\s*=\s*['\"]([^'\"]+)['\"]", text)
    if len(values) != 1:
        raise ValueError(f"Missing or ambiguous UI constant {name}")
    return values[0]


def inspect():
    package = json.loads(read(PKG))
    lock = json.loads(read(LOCK))
    constants = read(CONSTANTS)
    dev = constant(constants, "GTAR_DEV_VERSION")
    prod = constant(constants, "GTAR_APP_VERSION")
    if package["version"] != dev:
        raise ValueError("package.json and GTAR_DEV_VERSION disagree")
    if lock["version"] != dev or lock["packages"][""]["version"] != dev:
        raise ValueError("package-lock.json version fields disagree with package.json")
    if not re.fullmatch(r"1\.1\.\d+", prod):
        raise ValueError("Invalid GTAR_APP_VERSION")
    return dev, {"package": package, "lock": lock, "constants": constants, "dev": dev, "prod": prod}


def versions(metadata, dev, prod, code_delta):
    version = dev or prod
    package = json.loads(json.dumps(metadata["package"]))
    lock = json.loads(json.dumps(metadata["lock"]))
    package["version"] = lock["version"] = lock["packages"][""]["version"] = version
    constants = metadata["constants"]
    for name, value in [("GTAR_DEV_VERSION", dev or metadata["dev"]), ("GTAR_APP_VERSION", prod or metadata["prod"])]:
        constants = replace_one(constants, r"(export const " + name + r"\s*=\s*['\"])[^'\"]+(['\"])", lambda m: m[1] + value + m[2])
    files = {PKG: json.dumps(package, indent=2) + "\n", LOCK: json.dumps(lock, indent=2) + "\n", CONSTANTS: constants}
    for path in ["web/src/components/Header.tsx", "web/src/App.tsx"]:
        text = read(path)
        # Keep constants valid semver; the human-readable UI carries the platform prefix.
        text = re.sub(r"(?<!web )v\$\{(GTAR_(?:DEV|APP)_VERSION)\}", r"web v${\1}", text)
        if text != read(path):
            files[path] = text
    return files


if __name__ == "__main__":
    sys.exit(main())
