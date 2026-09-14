# GTAR Local Offline Audit Report

- **Timestamp:** 2026-09-14 10:29:45 UTC
- **Execution Mode:** 100% Offline (Local Filesystem Only)
- **Total Duration:** 25.51s
- **Overall Verdict:** `[WARN]`

## Executive Summary

| Audit Category | Status | Summary |
| --- | :---: | --- |
| Offline Asset Hygiene | **`[PASS]`** | All HTML, styles, and scripts are 100% bundled locally with offline font fallbacks. |
| PWA / Service Worker Health | **`[PASS]`** | PWA configuration, manifest icons, and Workbox caching strategies are healthy. |
| Local Storage & Sync Guards | **`[PASS]`** | Robust storage quota guards, bounded snapshots, and auto-pruning verified. |
| Git Workspace Status | **`[WARN]`** | Working tree on 'dev' contains uncommitted changes or stashes. |
| Test & Build Readiness | **`[PASS]`** | All local lint, test, and build verifications succeeded. |

---

## Detailed Category Breakdown

### [PASS] Offline Asset Hygiene

**Status:** `PASS`  
**Summary:** All HTML, styles, and scripts are 100% bundled locally with offline font fallbacks.

#### Metrics & Settings Verified:
- **External Cdn Scripts:** `0`
- **External Stylesheets:** `0`
- **Blocking Remote Assets:** `0`
- **Font System Fallbacks:** `Configured (Inter/system-ui & JetBrains/ui-monospace)`
- **Google Gsi Script:** `Isolated & lazily loaded for Drive Sync only`

---

### [PASS] PWA / Service Worker Health

**Status:** `PASS`  
**Summary:** PWA configuration, manifest icons, and Workbox caching strategies are healthy.

#### Metrics & Settings Verified:
- **Manifest Name:** `GTAR Live Stage Companion`
- **Manifest Display:** `standalone`
- **Manifest Start Url:** `/`
- **Valid Manifest Icons:** `5`
- **Maskable Icon Supported:** `True`
- **Vite Pwa Registered:** `True`
- **Service Worker Update Mode:** `autoUpdate`
- **Workbox Glob Patterns:** `'**/*.{js,css,html,ico,png,jpg,jpeg,svg,gif,webp,json,woff,woff2,ttf,eot,otf,mp3,wav,webmanifest}',`
- **Navigate Fallback:** `/index.html (SPA offline routing active)`
- **Dist Sw Generated:** `Yes (2359 bytes)`

---

### [PASS] Local Storage & Sync Guards

**Status:** `PASS`  
**Summary:** Robust storage quota guards, bounded snapshots, and auto-pruning verified.

#### Metrics & Settings Verified:
- **Max Recovery Snapshots:** `2`
- **Has Is Quota Error:** `True`
- **Quota Error Detection:** `Comprehensive (DOMException 22, 1014, regex)`
- **Has Prune Recovery Snapshots:** `False`
- **Has Prune All Recovery Snapshots:** `True`
- **Persist Library Quota Fallback:** `Active (emergency purge & retry)`
- **Verified Sync Guard Tests:** `4/4`

---

### [WARN] Git Workspace Status

**Status:** `WARN`  
**Summary:** Working tree on 'dev' contains uncommitted changes or stashes.

#### Metrics & Settings Verified:
- **Current Branch:** `dev`
- **Uncommitted Files Count:** `4`
- **Pending Stashes Count:** `0`
- **Upstream Tracking:** `origin/dev`
- **Ahead Behind Upstream:** `+0 / -0`
- **Latest Commit:** `beb9edb - docs: update audit_report.md for DEV.17 [PASS] (28 minutes ago)`

#### Detailed Findings / Warnings:
- 4 uncommitted file(s) in working tree:
-   M web/src/components/AuthGate.tsx
-    M web/src/utils/googleAuth.ts
-    M web/tests/authLifecycle.test.cjs
-   ?? web/tests/durableAuthSession.test.cjs

---

### [PASS] Test & Build Readiness

**Status:** `PASS`  
**Summary:** All local lint, test, and build verifications succeeded.

#### Metrics & Settings Verified:
- **Lint Sync Duration:** `1.60s`
- **Lint Status:** `PASSED (0 warnings on critical sync/auth/backup files)`
- **Test Duration:** `17.76s`
- **Test Status:** `PASSED (101 passed, 0 failed)`
- **Build Duration:** `5.77s`
- **Build Status:** `PASSED (TypeScript check & Vite production bundle created)`

---

## Local Action Guidance

Review warning items in the breakdown above (e.g. uncommitted workspace changes or pending stashes). No blocking failures detected.
