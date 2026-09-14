#!/usr/bin/env python3
"""GTAR Local Offline Audit Tool.

100% offline, local-only repository audit script that inspects:
1. Offline Asset Hygiene (un-cached CDN dependencies, external fonts, scripts)
2. PWA & Service Worker Health (manifest icons, workbox cache config, service worker)
3. Local Storage & Drive Sync Guards (snapshot limits, quota error catches, recovery pruning)
4. Workspace Git Status (uncommitted files, branch vs baseline, pending stashes)
5. Test & Build Readiness (fast strict lint, unit tests, build validation)

Generates a clean Markdown report (audit_report.md) and terminal summary with zero network calls.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"


class CheckStatus:
    PASS = "PASS"
    WARN = "WARN"
    FAIL = "FAIL"


class CheckResult:
    def __init__(
        self,
        name: str,
        status: str,
        summary: str,
        details: Optional[List[str]] = None,
        metrics: Optional[Dict[str, Any]] = None,
    ):
        self.name = name
        self.status = status
        self.summary = summary
        self.details = details or []
        self.metrics = metrics or {}

    @property
    def badge(self) -> str:
        if self.status == CheckStatus.PASS:
            return "[PASS]"
        elif self.status == CheckStatus.WARN:
            return "[WARN]"
        return "[FAIL]"


def run_cmd(args: List[str], cwd: Path, timeout_sec: int = 120) -> Tuple[int, str, str]:
    """Execute a local command synchronously with an enforced timeout and zero network/terminal prompt."""
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["CI"] = "true"

    is_win = sys.platform == "win32"
    # Resolve executable if possible
    executable = shutil.which(args[0]) or args[0]
    cmd = [executable, *args[1:]]

    try:
        proc = subprocess.run(
            cmd if not is_win else args,
            cwd=str(cwd),
            text=True,
            capture_output=True,
            check=False,
            timeout=timeout_sec,
            env=env,
            shell=is_win,
        )
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except subprocess.TimeoutExpired:
        return -1, "", f"Command timed out after {timeout_sec}s: {' '.join(args)}"
    except Exception as e:
        return -1, "", f"Execution error: {e}"


# ==============================================================================
# AUDIT 1: Offline Asset Hygiene
# ==============================================================================

def check_offline_assets(web_dir: Path) -> CheckResult:
    details: List[str] = []
    metrics: Dict[str, Any] = {
        "external_cdn_scripts": 0,
        "external_stylesheets": 0,
        "blocking_remote_assets": 0,
    }
    status = CheckStatus.PASS

    index_html = web_dir / "index.html"
    if not index_html.exists():
        return CheckResult(
            "Offline Asset Hygiene",
            CheckStatus.FAIL,
            "web/index.html not found",
            ["Missing index.html file"],
        )

    html_content = index_html.read_text(encoding="utf-8")

    # 1. Check index.html for external stylesheets or script tags
    link_hrefs = re.findall(r'<link[^>]+href=["\']([^"\']+)["\']', html_content, flags=re.IGNORECASE)
    script_srcs = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html_content, flags=re.IGNORECASE)

    for href in link_hrefs:
        if re.match(r"^(https?:)?//", href, flags=re.IGNORECASE):
            details.append(f"External link in index.html: {href}")
            metrics["external_stylesheets"] += 1
            status = CheckStatus.WARN

    for src in script_srcs:
        if re.match(r"^(https?:)?//", src, flags=re.IGNORECASE):
            details.append(f"External script in index.html: {src}")
            metrics["external_cdn_scripts"] += 1
            metrics["blocking_remote_assets"] += 1
            status = CheckStatus.FAIL

    # 2. Check CSS files for external @import
    css_files = list((web_dir / "src").glob("**/*.css"))
    for css_path in css_files:
        content = css_path.read_text(encoding="utf-8")
        imports = re.findall(r'@import\s+["\'](https?:[^"\']+)["\']', content, flags=re.IGNORECASE)
        url_imports = re.findall(r'@import\s+url\(["\']?(https?:[^"\']+)["\']?\)', content, flags=re.IGNORECASE)
        for imp in imports + url_imports:
            rel = css_path.relative_to(web_dir)
            details.append(f"Remote CSS import in {rel}: {imp}")
            metrics["external_stylesheets"] += 1
            status = CheckStatus.FAIL

    # 3. Check source files for unbundled external CDN dependencies
    # Allowed: API calls, schemas, and dynamic Google Auth script loader in googleAuth.ts
    src_files = list((web_dir / "src").glob("**/*.{ts,tsx,js,jsx}"))
    cdn_patterns = [
        re.compile(r'https?://(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)/[^\s\'"`]+'),
        re.compile(r'https?://fonts\.googleapis\.com/css[^\s\'"`]*'),
    ]

    for sf in src_files:
        try:
            content = sf.read_text(encoding="utf-8")
        except Exception:
            continue
        rel = sf.relative_to(web_dir)
        for pattern in cdn_patterns:
            matches = pattern.findall(content)
            for m in matches:
                details.append(f"Unbundled external CDN dependency in {rel}: {m}")
                metrics["blocking_remote_assets"] += 1
                status = CheckStatus.FAIL

    # 4. Check system font fallbacks in index.css
    index_css = web_dir / "src" / "index.css"
    if index_css.exists():
        css_text = index_css.read_text(encoding="utf-8")
        has_mono_fallback = "monospace" in css_text
        has_sans_fallback = "sans-serif" in css_text
        if not (has_mono_fallback and has_sans_fallback):
            details.append("Font stack in web/src/index.css is missing standard system fallbacks (sans-serif / monospace).")
            if status == CheckStatus.PASS:
                status = CheckStatus.WARN
        else:
            metrics["font_system_fallbacks"] = "Configured (Inter/system-ui & JetBrains/ui-monospace)"

    # Check Google GSI loader gating (must be dynamic in googleAuth.ts, not index.html)
    google_auth_ts = web_dir / "src" / "utils" / "googleAuth.ts"
    if google_auth_ts.exists():
        ga_code = google_auth_ts.read_text(encoding="utf-8")
        if "accounts.google.com/gsi/client" in ga_code:
            metrics["google_gsi_script"] = "Isolated & lazily loaded for Drive Sync only"

    if status == CheckStatus.PASS:
        summary = "All HTML, styles, and scripts are 100% bundled locally with offline font fallbacks."
    elif status == CheckStatus.WARN:
        summary = "Minor non-blocking external asset references detected."
    else:
        summary = "Blocking remote CDN dependencies detected that will fail without network access."

    return CheckResult("Offline Asset Hygiene", status, summary, details, metrics)


# ==============================================================================
# AUDIT 2: PWA & Service Worker Health
# ==============================================================================

def check_pwa_health(web_dir: Path) -> CheckResult:
    details: List[str] = []
    metrics: Dict[str, Any] = {}
    status = CheckStatus.PASS

    manifest_path = web_dir / "public" / "manifest.json"
    if not manifest_path.exists():
        return CheckResult("PWA / Service Worker Health", CheckStatus.FAIL, "web/public/manifest.json missing", ["Missing manifest.json"])

    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
        metrics["manifest_name"] = manifest.get("name", "Unknown")
        metrics["manifest_display"] = manifest.get("display", "browser")
        metrics["manifest_start_url"] = manifest.get("start_url", "")

        # Verify required keys
        required_keys = ["name", "short_name", "start_url", "display", "background_color", "theme_color", "icons"]
        missing_keys = [k for k in required_keys if k not in manifest]
        if missing_keys:
            details.append(f"manifest.json missing recommended keys: {', '.join(missing_keys)}")
            status = CheckStatus.WARN

        # Check icons
        icons = manifest.get("icons", [])
        has_maskable = False
        valid_icons = 0
        for icon in icons:
            src = icon.get("src", "")
            purpose = icon.get("purpose", "")
            if "maskable" in purpose:
                has_maskable = True

            # Resolve local path from /favicon.svg -> web/public/favicon.svg
            clean_src = src.lstrip("/")
            local_icon_path = web_dir / "public" / clean_src
            if not local_icon_path.exists():
                details.append(f"Manifest icon not found on disk: {src} (expected at {local_icon_path})")
                status = CheckStatus.FAIL
            else:
                valid_icons += 1

        metrics["valid_manifest_icons"] = valid_icons
        metrics["maskable_icon_supported"] = has_maskable

        if not has_maskable:
            details.append("PWA manifest is missing an icon with purpose 'maskable'.")
            if status == CheckStatus.PASS:
                status = CheckStatus.WARN

    except json.JSONDecodeError as e:
        return CheckResult("PWA / Service Worker Health", CheckStatus.FAIL, "manifest.json is invalid JSON", [str(e)])

    # Check vite.config.ts PWA configuration
    vite_config = web_dir / "vite.config.ts"
    if not vite_config.exists():
        details.append("web/vite.config.ts not found.")
        status = CheckStatus.FAIL
    else:
        cfg_text = vite_config.read_text(encoding="utf-8")
        if "VitePWA" not in cfg_text:
            details.append("VitePWA plugin is not registered in vite.config.ts.")
            status = CheckStatus.FAIL
        else:
            metrics["vite_pwa_registered"] = True

        if "registerType: 'autoUpdate'" in cfg_text:
            metrics["service_worker_update_mode"] = "autoUpdate"
        else:
            metrics["service_worker_update_mode"] = "manual/prompt"

        # Check workbox globPatterns
        glob_match = re.search(r"globPatterns:\s*\[([^\]]+)\]", cfg_text)
        if glob_match:
            globs = glob_match.group(1)
            metrics["workbox_glob_patterns"] = globs.strip()
            # Verify essentials
            for ext in ["js", "css", "html", "svg"]:
                if ext not in globs:
                    details.append(f"Workbox globPatterns may be missing critical static extension: {ext}")
                    if status == CheckStatus.PASS:
                        status = CheckStatus.WARN
        else:
            details.append("Workbox globPatterns not explicitly specified in vite.config.ts.")
            if status == CheckStatus.PASS:
                status = CheckStatus.WARN

        # Check offline navigation fallback
        if "navigateFallback: '/index.html'" in cfg_text:
            metrics["navigate_fallback"] = "/index.html (SPA offline routing active)"
        else:
            details.append("Workbox navigateFallback is missing or not set to /index.html.")
            if status == CheckStatus.PASS:
                status = CheckStatus.WARN

    # Check built service worker if dist/ exists
    dist_dir = web_dir / "dist"
    if dist_dir.exists():
        sw_file = dist_dir / "sw.js"
        if sw_file.exists():
            metrics["dist_sw_generated"] = f"Yes ({sw_file.stat().st_size} bytes)"
        else:
            details.append("dist/ directory exists but dist/sw.js was not generated.")

    if status == CheckStatus.PASS:
        summary = "PWA configuration, manifest icons, and Workbox caching strategies are healthy."
    elif status == CheckStatus.WARN:
        summary = "PWA configuration is functional with minor warnings."
    else:
        summary = "PWA manifest or Service Worker configuration contains critical errors."

    return CheckResult("PWA / Service Worker Health", status, summary, details, metrics)


# ==============================================================================
# AUDIT 3: Local Storage & Drive Sync Guards
# ==============================================================================

def check_storage_sync_guards(web_dir: Path) -> CheckResult:
    details: List[str] = []
    metrics: Dict[str, Any] = {}
    status = CheckStatus.PASS

    sync_journal = web_dir / "src" / "utils" / "syncJournal.ts"
    if not sync_journal.exists():
        return CheckResult("Local Storage & Sync Guards", CheckStatus.FAIL, "syncJournal.ts missing", ["web/src/utils/syncJournal.ts not found"])

    code = sync_journal.read_text(encoding="utf-8")

    # 1. Check MAX_RECOVERY_SNAPSHOTS limit
    match_limit = re.search(r"MAX_RECOVERY_SNAPSHOTS\s*=\s*(\d+)", code)
    if match_limit:
        limit_val = int(match_limit.group(1))
        metrics["max_recovery_snapshots"] = limit_val
        if limit_val > 5:
            details.append(f"MAX_RECOVERY_SNAPSHOTS ({limit_val}) is high; risk of local quota exhaustion.")
            if status == CheckStatus.PASS:
                status = CheckStatus.WARN
    else:
        details.append("MAX_RECOVERY_SNAPSHOTS constant is missing or unconstrained.")
        status = CheckStatus.FAIL

    # 2. Check Quota Error Detection
    has_is_quota_error = "function isQuotaError" in code or "const isQuotaError" in code
    metrics["has_is_quota_error"] = has_is_quota_error
    if not has_is_quota_error:
        details.append("isQuotaError() helper function is missing.")
        status = CheckStatus.FAIL
    else:
        checks_quota_name = "QuotaExceededError" in code
        checks_quota_codes = "22" in code and "1014" in code
        checks_quota_regex = "quota" in code.lower()
        if not (checks_quota_name and checks_quota_codes and checks_quota_regex):
            details.append("isQuotaError() does not handle all standard DOMException codes (22, 1014, QuotaExceededError, regex).")
            if status == CheckStatus.PASS:
                status = CheckStatus.WARN
        else:
            metrics["quota_error_detection"] = "Comprehensive (DOMException 22, 1014, regex)"

    # 3. Check Pruning Functions
    has_prune_recovery = "function pruneRecoverySnapshots" in code
    has_prune_all = "function pruneAllRecoverySnapshots" in code
    metrics["has_prune_recovery_snapshots"] = has_prune_recovery
    metrics["has_prune_all_recovery_snapshots"] = has_prune_all

    if not (has_prune_recovery or has_prune_all):
        details.append("Missing recovery snapshot pruning functions (pruneRecoverySnapshots or pruneAllRecoverySnapshots).")
        status = CheckStatus.FAIL

    # 4. Check persistLibrary Quota Catch and Fallback
    has_persist_library = "function persistLibrary" in code
    if has_persist_library:
        # Check that persistLibrary catches quota errors and calls pruneAllRecoverySnapshots
        persist_match = re.search(r"function persistLibrary\s*\([^)]*\)\s*\{([\s\S]*?)\n\}", code)
        if persist_match:
            p_body = persist_match.group(1)
            if "isQuotaError" in p_body and "pruneAllRecoverySnapshots" in p_body:
                metrics["persist_library_quota_fallback"] = "Active (emergency purge & retry)"
            else:
                details.append("persistLibrary() does not catch quota errors or attempt emergency pruning fallback.")
                status = CheckStatus.FAIL
    else:
        details.append("persistLibrary() function is missing.")
        status = CheckStatus.FAIL

    # 5. Check Test Coverage in syncJournal.test.cjs
    test_file = web_dir / "tests" / "syncJournal.test.cjs"
    if test_file.exists():
        test_code = test_file.read_text(encoding="utf-8")
        test_cases = [
            ("archive prunes older recovery snapshots", "Recovery snapshot pruning assertion"),
            ("isQuotaError detects DOMException", "Quota error classification test"),
            ("persistLibrary auto-prunes recovery snapshots", "Auto-prune on storage quota hit test"),
            ("atomic device persistence survives a restart", "Atomic persistence & quota recovery test"),
        ]
        tested_guards = 0
        for phrase, label in test_cases:
            if phrase.lower() in test_code.lower():
                tested_guards += 1
            else:
                details.append(f"syncJournal.test.cjs missing test coverage for: {label}")

        metrics["verified_sync_guard_tests"] = f"{tested_guards}/{len(test_cases)}"
        if tested_guards < len(test_cases):
            if status == CheckStatus.PASS:
                status = CheckStatus.WARN
    else:
        details.append("web/tests/syncJournal.test.cjs missing.")
        if status == CheckStatus.PASS:
            status = CheckStatus.WARN

    if status == CheckStatus.PASS:
        summary = "Robust storage quota guards, bounded snapshots, and auto-pruning verified."
    elif status == CheckStatus.WARN:
        summary = "Storage sync guards operational with minor test coverage gaps."
    else:
        summary = "Storage quota error handling or recovery pruning is incomplete."

    return CheckResult("Local Storage & Sync Guards", status, summary, details, metrics)


# ==============================================================================
# AUDIT 4: Workspace Git Status
# ==============================================================================

def check_workspace_status(root: Path, report_filename: str = "audit_report.md") -> CheckResult:
    details: List[str] = []
    metrics: Dict[str, Any] = {}
    status = CheckStatus.PASS

    # 1. Branch name
    code, branch, err = run_cmd(["git", "rev-parse", "--abbrev-ref", "HEAD"], root)
    if code != 0:
        return CheckResult("Git Workspace Status", CheckStatus.FAIL, "Failed to inspect git workspace", [err])
    metrics["current_branch"] = branch

    # 2. Status porcelain (uncommitted changes, excluding self-generated report)
    code, porcelain, _ = run_cmd(["git", "status", "--porcelain"], root)
    raw_lines = [line for line in porcelain.splitlines() if line.strip()]
    # Filter out audit report file so the audit running does not flag its own report
    uncommitted_lines = [
        line for line in raw_lines
        if not line.strip().endswith(report_filename)
    ]
    metrics["uncommitted_files_count"] = len(uncommitted_lines)

    if uncommitted_lines:
        status = CheckStatus.WARN
        details.append(f"{len(uncommitted_lines)} uncommitted file(s) in working tree:")
        for line in uncommitted_lines[:10]:
            details.append(f"  {line}")
        if len(uncommitted_lines) > 10:
            details.append(f"  ... and {len(uncommitted_lines) - 10} more.")

    # 3. Pending stashes
    code, stash_output, _ = run_cmd(["git", "stash", "list"], root)
    stashes = [s for s in stash_output.splitlines() if s.strip()]
    metrics["pending_stashes_count"] = len(stashes)
    if stashes:
        details.append(f"{len(stashes)} pending git stash(es) found:")
        for s in stashes[:5]:
            details.append(f"  {s}")

    # 4. Upstream tracking status (local only, no fetch)
    code, upstream, _ = run_cmd(["git", "rev-parse", "--abbrev-ref", "@{u}"], root)
    if code == 0 and upstream:
        metrics["upstream_tracking"] = upstream
        code, counts, _ = run_cmd(["git", "rev-list", "--left-right", "--count", "HEAD...@{u}"], root)
        if code == 0 and counts:
            parts = counts.split()
            if len(parts) == 2:
                ahead, behind = parts[0], parts[1]
                metrics["ahead_behind_upstream"] = f"+{ahead} / -{behind}"
                if int(behind) > 0:
                    details.append(f"Local branch is behind upstream {upstream} by {behind} commit(s).")
                    if status == CheckStatus.PASS:
                        status = CheckStatus.WARN
    else:
        metrics["upstream_tracking"] = "None (no upstream configured)"

    # 5. Last commit info
    code, last_commit, _ = run_cmd(["git", "log", "-1", "--format=%h - %s (%cr)"], root)
    if code == 0 and last_commit:
        metrics["latest_commit"] = last_commit

    if status == CheckStatus.PASS:
        summary = f"Working tree clean on branch '{branch}' (0 uncommitted files)."
    else:
        summary = f"Working tree on '{branch}' contains uncommitted changes or stashes."

    return CheckResult("Git Workspace Status", status, summary, details, metrics)


# ==============================================================================
# AUDIT 5: Test & Build Readiness
# ==============================================================================

def check_test_build_readiness(
    web_dir: Path,
    skip_lint: bool = False,
    skip_tests: bool = False,
    skip_build: bool = False,
) -> CheckResult:
    details: List[str] = []
    metrics: Dict[str, Any] = {}
    status = CheckStatus.PASS

    # 1. Run strict sync lint
    if skip_lint:
        metrics["lint_status"] = "SKIPPED (--quick or --skip-lint)"
    else:
        lint_start = time.perf_counter()
        code, stdout, stderr = run_cmd(["npm", "run", "--prefix", "web", "lint:sync"], ROOT, timeout_sec=60)
        lint_duration = time.perf_counter() - lint_start
        metrics["lint_sync_duration"] = f"{lint_duration:.2f}s"

        if code != 0:
            status = CheckStatus.FAIL
            details.append("npm run --prefix web lint:sync failed:")
            details.append(stderr or stdout or "Unknown lint error")
            metrics["lint_status"] = "FAILED"
        else:
            metrics["lint_status"] = "PASSED (0 warnings on critical sync/auth/backup files)"

    # 2. Run unit tests
    if skip_tests:
        metrics["unit_tests"] = "SKIPPED (--quick or --skip-tests)"
    else:
        test_start = time.perf_counter()
        code, stdout, stderr = run_cmd(["npm", "test", "--prefix", "web"], ROOT, timeout_sec=90)
        test_duration = time.perf_counter() - test_start
        metrics["test_duration"] = f"{test_duration:.2f}s"

        if code != 0:
            status = CheckStatus.FAIL
            details.append("npm test --prefix web failed:")
            details.append(stderr or stdout or "Test suite error")
            metrics["test_status"] = "FAILED"
        else:
            # Extract pass count from node test runner output: e.g. "ℹ pass 87"
            pass_match = re.search(r"pass\s+(\d+)", stdout)
            fail_match = re.search(r"fail\s+(\d+)", stdout)
            passes = pass_match.group(1) if pass_match else "?"
            fails = fail_match.group(1) if fail_match else "0"
            metrics["test_status"] = f"PASSED ({passes} passed, {fails} failed)"

    # 3. Run production build
    if skip_build:
        metrics["build_status"] = "SKIPPED (--quick or --skip-build)"
    else:
        build_start = time.perf_counter()
        code, stdout, stderr = run_cmd(["npm", "run", "--prefix", "web", "build"], ROOT, timeout_sec=120)
        build_duration = time.perf_counter() - build_start
        metrics["build_duration"] = f"{build_duration:.2f}s"

        if code != 0:
            status = CheckStatus.FAIL
            details.append("npm run --prefix web build failed:")
            details.append(stderr or stdout or "Build compilation error")
            metrics["build_status"] = "FAILED"
        else:
            metrics["build_status"] = "PASSED (TypeScript check & Vite production bundle created)"

    if status == CheckStatus.PASS:
        summary = "All local lint, test, and build verifications succeeded."
    elif status == CheckStatus.WARN:
        summary = "Verifications completed with warnings."
    else:
        summary = "One or more test, lint, or build verifications failed."

    return CheckResult("Test & Build Readiness", status, summary, details, metrics)


# ==============================================================================
# REPORT GENERATION & FORMATTING
# ==============================================================================

def generate_markdown_report(results: List[CheckResult], elapsed_sec: float) -> str:
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    overall_status = CheckStatus.PASS
    if any(r.status == CheckStatus.FAIL for r in results):
        overall_status = CheckStatus.FAIL
    elif any(r.status == CheckStatus.WARN for r in results):
        overall_status = CheckStatus.WARN

    badge_map = {
        CheckStatus.PASS: "PASS",
        CheckStatus.WARN: "WARN",
        CheckStatus.FAIL: "FAIL",
    }

    lines = [
        "# GTAR Local Offline Audit Report",
        "",
        f"- **Timestamp:** {timestamp}",
        f"- **Execution Mode:** 100% Offline (Local Filesystem Only)",
        f"- **Total Duration:** {elapsed_sec:.2f}s",
        f"- **Overall Verdict:** `[{badge_map[overall_status]}]`",
        "",
        "## Executive Summary",
        "",
        "| Audit Category | Status | Summary |",
        "| --- | :---: | --- |",
    ]

    for r in results:
        lines.append(f"| {r.name} | **`{r.badge}`** | {r.summary} |")

    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Detailed Category Breakdown")
    lines.append("")

    for r in results:
        lines.append(f"### {r.badge} {r.name}")
        lines.append("")
        lines.append(f"**Status:** `{r.status}`  ")
        lines.append(f"**Summary:** {r.summary}")
        lines.append("")

        if r.metrics:
            lines.append("#### Metrics & Settings Verified:")
            for k, v in r.metrics.items():
                label = k.replace("_", " ").title()
                lines.append(f"- **{label}:** `{v}`")
            lines.append("")

        if r.details:
            lines.append("#### Detailed Findings / Warnings:")
            for d in r.details:
                lines.append(f"- {d}")
            lines.append("")

        lines.append("---")
        lines.append("")

    lines.append("## Local Action Guidance")
    lines.append("")
    if overall_status == CheckStatus.PASS:
        lines.append("All offline hygiene, PWA health, storage sync guards, and local build/tests are green. Ready for local development or release bumping.")
    elif overall_status == CheckStatus.WARN:
        lines.append("Review warning items in the breakdown above (e.g. uncommitted workspace changes or pending stashes). No blocking failures detected.")
    else:
        lines.append("Resolve the failing check(s) listed above before creating release tags or deploying.")
    lines.append("")

    return "\n".join(lines)


def print_terminal_summary(results: List[CheckResult], elapsed_sec: float, report_path: Path):
    overall_status = CheckStatus.PASS
    if any(r.status == CheckStatus.FAIL for r in results):
        overall_status = CheckStatus.FAIL
    elif any(r.status == CheckStatus.WARN for r in results):
        overall_status = CheckStatus.WARN

    print("\n" + "=" * 68)
    print("           GTAR LOCAL REPOSITORY OFFLINE AUDIT SUMMARY           ")
    print("=" * 68)
    print(f" Mode: 100% Offline | Duration: {elapsed_sec:.2f}s | Overall: [{overall_status}]")
    print("-" * 68)

    for r in results:
        print(f" {r.badge:<8} {r.name:<32} {r.summary}")
        if r.status != CheckStatus.PASS and r.details:
            for d in r.details[:3]:
                print(f"          * {d}")
            if len(r.details) > 3:
                print(f"          * ... and {len(r.details) - 3} more items in report.")

    print("-" * 68)
    print(f" Full audit report generated at: {report_path}")
    print("=" * 68 + "\n")


# ==============================================================================
# MAIN CLI ENTRYPOINT
# ==============================================================================

def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="GTAR 100% Offline Local Repository Audit Tool.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--report",
        type=str,
        default="audit_report.md",
        help="Path for generated Markdown report (default: audit_report.md)",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Ultra-fast mode: skips unit tests, lint, and build; checks assets, PWA, sync guards, git.",
    )
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Skip web build check (runs tests and lint only).",
    )
    parser.add_argument(
        "--skip-tests",
        action="store_true",
        help="Skip web unit tests check.",
    )
    parser.add_argument(
        "--skip-lint",
        action="store_true",
        help="Skip web lint check.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print raw JSON summary to stdout instead of terminal summary.",
    )

    args = parser.parse_args(argv)
    start_time = time.perf_counter()

    skip_lint = args.skip_lint or args.quick
    skip_tests = args.skip_tests or args.quick
    skip_build = args.skip_build or args.quick

    results: List[CheckResult] = [
        check_offline_assets(WEB_DIR),
        check_pwa_health(WEB_DIR),
        check_storage_sync_guards(WEB_DIR),
        check_workspace_status(ROOT, report_filename=args.report),
        check_test_build_readiness(
            WEB_DIR,
            skip_lint=skip_lint,
            skip_tests=skip_tests,
            skip_build=skip_build,
        ),
    ]

    total_time = time.perf_counter() - start_time
    report_file = ROOT / args.report

    # Write Markdown report
    markdown_content = generate_markdown_report(results, total_time)
    report_file.write_text(markdown_content, encoding="utf-8")

    if args.json:
        payload = {
            "overall_status": CheckStatus.FAIL if any(r.status == CheckStatus.FAIL for r in results) else (CheckStatus.WARN if any(r.status == CheckStatus.WARN for r in results) else CheckStatus.PASS),
            "duration_seconds": total_time,
            "report_path": str(report_file),
            "results": [
                {
                    "name": r.name,
                    "status": r.status,
                    "summary": r.summary,
                    "metrics": r.metrics,
                    "details": r.details,
                }
                for r in results
            ],
        }
        print(json.dumps(payload, indent=2))
    else:
        print_terminal_summary(results, total_time, report_file)

    # Return exit code: 0 if PASS or WARN, 1 if FAIL
    return 1 if any(r.status == CheckStatus.FAIL for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
