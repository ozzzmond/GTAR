# GTAR core separation plan — 2026-11-01 (APPROVED D1–D7)
Baseline when written: `dev` @ 7a362fe. PROD v1.1.141 @ 4fe9504. GitHub stays source of truth.
Roles: Claude = validator (prompts + PR review). Tier 1 = owner (pafs). Tier 2 = Codex, Claude Code, AGY, OpenCode/DeepSeek (backup).

## Status
- PR-X Music Explorer layout: DONE — #286 merged to dev as cf59f2f; owner DEV QA on iPhone PASS (structure matches GTAR1).
- PR-A: next (Codex), after the repo source-of-truth docs PR (#287).

## Goal (owner, 2026-11-01)
1. No login gate: app opens and works fully without Google sign-in (same as GTAR1).
2. No automatic cloud sync. Cloud for personal data = manual Backup to cloud / Restore from cloud only.
3. Only the Shared Catalog (published songs + setlists) stays a cloud service, and it requires Google sign-in, reached through its own sign-in option.
4. Music Explorer layout must match GTAR1.
5. PR #281 review.

## Decisions (owner, 2026-11-01)
- D1 YES: library is device-owned, like GTAR1. Ownership records no longer gate local read/write (kept, not deleted).
- D2 YES: cloud backup reuses existing `/api/songbook` + `user_songbooks` (no D1 migration).
- D3 YES: all personal cloud sync removed (classic auto, per-record, leader tab). Records route disabled, 0009 tables left inert, no D1 drop.
- D4 YES: Shared Catalog (browse included) needs Google sign-in, through a separate sign-in option.
- D5 YES: in DEV, tests of removed features are deleted with the feature.
- D6 YES: one seamless, coordinated PROD release after DEV field QA.
- D7 Explorer row height: keep 36px minimum touch targets (slightly taller rows than GTAR1's ~28px).

## Verified facts (read-only review, dev @ 7a362fe)
- `main.tsx` wraps the whole app in `<AuthGate>`; auth state via `utils/authContext.ts`.
- PROD already ships the ownership gate: `libraryOwner.ts` (#247) and the #258 startup gate (`isLibraryClosedForSignIn`, `isLegacyLibraryBlocked` in `syncJournal.ts`). Signed out = owner-bound library hidden. B2 storage keeps one partition per account (`b2Identity().scope`).
- Sync stack: `cloudSongbookSync.ts` (2,007 lines), `recordsSync.ts` (843), `syncJournal.ts` (1,321), `libraryB2.ts` (1,368), `useRecordsAutoSync.ts`, `AuthGate.tsx` (852), `CloudSyncModal.tsx` (731).
- 86 of 185 test files reference auth/sync/ownership/B2/journal code.
- Old branch `feat/remove-startup-login-disable-auto-sync` (b35318c, base #262, never merged): reference only.

## PR sequence (one prompt, one branch, one PR into `dev` each)
1. PR-X Music Explorer layout = GTAR1 — done (#286).
2. PR-A Device-owned library + boot without login.
3. PR-B Manual cloud Backup / Restore; all auto-sync off.
4. PR-C Shared Catalog sign-in option + gate.
5. PR-D Remove dead sync/ownership code and its tests.
6. PR-E Test tiering for what remains (fast PR gate / scale / release).
7. #281 rebased and split.

## PR-A — Device-owned library, boot without login
Goal: the app opens straight to the songbook with no sign-in, on a fresh device and on a device that already has an owner record from PROD.

Scope:
- `main.tsx`: remove `<AuthGate>` as a gate. Keep an auth provider so `authContext` still works (signed-out = null user). Sign-in UI is not on startup.
- Ownership: `isLibraryClosedForSignIn`, `isLegacyLibraryBlocked`, `legacyAccessBlocked` and the #258 startup paths no longer hide or block the local library. Owner keys (`gtar_library_owner_v1`, `gtar_sync_library_owner`) are left in storage untouched.
- B2 partitions: one partition → open it as the device library. More than one → do NOT merge or delete: open the most recently used one and keep the others readable as recovery copies (export available).
- Sign-in moves to an explicit entry (⋯ menu / Sync Center), used only by cloud features. Signing in or out never changes the local library.
- Auto-sync must not start just because the app opened signed out (full removal is PR-B).

Out of scope: removing sync code (PR-D), backup/restore UI (PR-B), Shared Catalog gate (PR-C), any server or D1 change.

Acceptance (each is a test):
1. Fresh device, no sign-in: app renders songbook, can add/edit/save a song, reload keeps it.
2. Device with owner record for account A, signed out: full library visible; storage bytes of library and owner keys unchanged after load.
3. Same device, sign in as B then sign out: library still visible and unchanged; no upload happened.
4. B2 on with one partition: opens it without sign-in. B2 with two partitions: nothing merged or deleted; the other stays exportable.
5. No network request on startup when signed out (auth/session endpoints included).

## PR #281 review (head a60d496) — verdict FIX/HOLD
- Based on #278, reverted by #282; current Explorer is the drawer (#283/#284/#286). Conflicts: SongbookHomeView.tsx; ExplorerNavigation.tsx and musicExplorer.test.cjs deleted in dev.
- Adds `WebSetlist.folderId`, `updatedAt`, per-entry `transposeOffset` with no folder UI; "Unfiled Setlists" = all setlists. Entry transpose must round-trip through backup, cloud backup, Band Sync and shared snapshot; PR tests do not prove that.
- In DEV the SetlistExplorer replaces the Setlists panel, hiding sort/Manage/QR/Import/Publish.
- Good: MultiSongSetlistPicker (dialog, focus trap, dedupe) and bulk add saving with the stale-write guard and returning success.
- Ask: rebase; split into (1) picker + bulk add, (2) entry transpose as its own data-model PR; drop folderId/unfiled until folders exist; keep Setlists controls.
