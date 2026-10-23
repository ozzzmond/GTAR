# Web/PWA test catalog

## Running tests

From `web`, after `npm ci` with the CI runtime (Node 22):

```sh
npm test
node --test tests/authGate.test.cjs
```

From the repository root, run the complete Web suite with `npm test --prefix web`.
The root `tests/*.test.cjs` controller suite is separate; CI runs both suites.

## Directory and naming contract

Keep every Web regression file directly in `web/tests/` with the `.test.cjs`
suffix. The npm runner uses the flat `tests/*.test.cjs` glob, and CI invokes
that runner. Tests also rely on relative paths, `__dirname`, and named sibling
files (including references in `sourceTextPortability.test.cjs`). Moving files
into subdirectories would require coordinated changes outside this catalog.

For new tests, use a descriptive lowerCamelCase subsystem/behavior name, such as
`authSessionRuntime.test.cjs`, rather than a release number alone. Add a relative
link under one primary category below, keeping filenames alphabetized within
each category. Use the existing category names; they are documentation groups,
not runner filters. Historical release-prefixed filenames remain stable because
they often cover multiple subsystems and may be referenced elsewhere. Their
placement indicates the main area to start searching, not exclusive coverage.
Use test titles inside a file to locate specific cases.

## Maintaining the catalog

From the repository root (no dependency install required):

```sh
node web/scripts/test-catalog.cjs --write
node web/scripts/test-catalog.cjs --check
node --test web/tests/testCatalog.test.cjs
```

Only lists between `test-catalog` markers are generated. Keep headings,
descriptions, and other human guidance outside those markers. Existing links
supply the primary category; no filename heuristics or separate mapping is used.
New/renamed files go to `UNCLASSIFIED` in code-unit filename order; deleted files
are removed. A rename needs human reclassification if its old group should be
retained. To classify a test, move its link between marked lists, then run
`--write`. Duplicate links are detected by `--check`; `--write` keeps the first
category in document order. Malformed regions fail without writing. `--check`
is read-only and fails on missing, stale, duplicate, or unsorted entries. CI
checks drift and generator regressions without installing dependencies or
running the full suite in the catalog job. The existing suite job is unchanged.

## AUTH

Account access, sign-in, session lifecycle, and authentication UI.

<!-- test-catalog:AUTH:start -->
- [accountAccessFoundation.test.cjs](accountAccessFoundation.test.cjs)
- [authBypassInteraction.test.cjs](authBypassInteraction.test.cjs)
- [authGate.test.cjs](authGate.test.cjs)
- [authLifecycle.test.cjs](authLifecycle.test.cjs)
- [authSessionRuntime.test.cjs](authSessionRuntime.test.cjs)
- [authenticationSecurity.test.cjs](authenticationSecurity.test.cjs)
- [durableAuthSession.test.cjs](durableAuthSession.test.cjs)
- [g5SessionRevocationSecurity.test.cjs](g5SessionRevocationSecurity.test.cjs)
- [googleOAuthSecurity.test.cjs](googleOAuthSecurity.test.cjs)
- [googleSigninReliability.test.cjs](googleSigninReliability.test.cjs)
- [membershipBadgeInteraction108Dev8f.test.cjs](membershipBadgeInteraction108Dev8f.test.cjs)
<!-- test-catalog:AUTH:end -->

## CLOUD_SYNC_AND_STORAGE

Cloud reconciliation, local persistence, backup, import recovery, and retirement.

<!-- test-catalog:CLOUD_SYNC_AND_STORAGE:start -->
- [adversarialDev13.test.cjs](adversarialDev13.test.cjs)
- [backupResiduals.test.cjs](backupResiduals.test.cjs)
- [backupRestoreHardening.test.cjs](backupRestoreHardening.test.cjs)
- [backupRoundTrip.test.cjs](backupRoundTrip.test.cjs)
- [cloudSetlistSync.test.cjs](cloudSetlistSync.test.cjs)
- [cloudSongbookSync.test.cjs](cloudSongbookSync.test.cjs)
- [cloudSyncConcurrency.test.cjs](cloudSyncConcurrency.test.cjs)
- [crossTabDataIntegrity.test.cjs](crossTabDataIntegrity.test.cjs)
- [deleteLifecycleRecovery.test.cjs](deleteLifecycleRecovery.test.cjs)
- [dev8bLocalCloudSync.test.cjs](dev8bLocalCloudSync.test.cjs)
- [g3CloudSyncIntegrity.test.cjs](g3CloudSyncIntegrity.test.cjs)
- [jsonBackup.test.cjs](jsonBackup.test.cjs)
- [legacyImportCompatibility.test.cjs](legacyImportCompatibility.test.cjs)
- [localStorageHardening.test.cjs](localStorageHardening.test.cjs)
- [mergeDuplicationFix.test.cjs](mergeDuplicationFix.test.cjs)
- [persistenceDataIntegrity.test.cjs](persistenceDataIntegrity.test.cjs)
- [recoveryBannerEnvGuard.test.cjs](recoveryBannerEnvGuard.test.cjs)
- [semanticRepairDryRun.test.cjs](semanticRepairDryRun.test.cjs)
- [storageRecoveryUi.test.cjs](storageRecoveryUi.test.cjs)
- [storageRetirement.test.cjs](storageRetirement.test.cjs)
- [syncDedup.test.cjs](syncDedup.test.cjs)
- [syncJournal.test.cjs](syncJournal.test.cjs)
<!-- test-catalog:CLOUD_SYNC_AND_STORAGE:end -->

## THEMES

Presets, palettes, typography, semantic tokens, theme lifecycle, and theme sync.

<!-- test-catalog:THEMES:start -->
- [dev3bThemePresetRefresh.test.cjs](dev3bThemePresetRefresh.test.cjs)
- [dev3cCustomPaletteV2.test.cjs](dev3cCustomPaletteV2.test.cjs)
- [dev3dCustomPaletteEditorAndPresets.test.cjs](dev3dCustomPaletteEditorAndPresets.test.cjs)
- [dev3eTypographyFonts.test.cjs](dev3eTypographyFonts.test.cjs)
- [dev3fHeaderSemanticTokens.test.cjs](dev3fHeaderSemanticTokens.test.cjs)
- [dev3gThemeStudioLifecycle.test.cjs](dev3gThemeStudioLifecycle.test.cjs)
- [dev3hThemeStudioHardening.test.cjs](dev3hThemeStudioHardening.test.cjs)
- [dev3iCanonicalThemeRuntime.test.cjs](dev3iCanonicalThemeRuntime.test.cjs)
- [dev3kFactoryThemeLifecycle.test.cjs](dev3kFactoryThemeLifecycle.test.cjs)
- [dev3lSemanticColorCoverage.test.cjs](dev3lSemanticColorCoverage.test.cjs)
- [g6CloudThemeSync.test.cjs](g6CloudThemeSync.test.cjs)
- [themeSyncUiPolish108Dev8d.test.cjs](themeSyncUiPolish108Dev8d.test.cjs)
<!-- test-catalog:THEMES:end -->

## STAGE

Performance controls, casting, navigation, continuity, and session persistence.

<!-- test-catalog:STAGE:start -->
- [dev3QolNavigationStageControls.test.cjs](dev3QolNavigationStageControls.test.cjs)
- [fullscreenStageQol.test.cjs](fullscreenStageQol.test.cjs)
- [stageCastRouting.test.cjs](stageCastRouting.test.cjs)
- [stageContinuityInput.test.cjs](stageContinuityInput.test.cjs)
- [stageLifecycle.test.cjs](stageLifecycle.test.cjs)
- [stageSectionNavigationDock.test.cjs](stageSectionNavigationDock.test.cjs)
- [stageSessionPersistence.test.cjs](stageSessionPersistence.test.cjs)
<!-- test-catalog:STAGE:end -->

## SONGBOOK_AND_EDITOR

Library/setlist UI, editing, chords, metadata, search, and sharing interactions.

<!-- test-catalog:SONGBOOK_AND_EDITOR:start -->
- [chordProMetadataRevamp.test.cjs](chordProMetadataRevamp.test.cjs)
- [dev2aFieldHardening.test.cjs](dev2aFieldHardening.test.cjs)
- [dev2bFieldFixAndChordRendering.test.cjs](dev2bFieldFixAndChordRendering.test.cjs)
- [dev2bUiCleanlinessAndNavigation.test.cjs](dev2bUiCleanlinessAndNavigation.test.cjs)
- [dev2cUiPolishAndReceiptRetirement.test.cjs](dev2cUiPolishAndReceiptRetirement.test.cjs)
- [dev3SearchUiCleanup.test.cjs](dev3SearchUiCleanup.test.cjs)
- [dev3aFieldFixes.test.cjs](dev3aFieldFixes.test.cjs)
- [dev4ChordFoundation.test.cjs](dev4ChordFoundation.test.cjs)
- [dev4aTrustedChordVoicingCoverage.test.cjs](dev4aTrustedChordVoicingCoverage.test.cjs)
- [dev4bExtendedChordCatalogAndQuickPreview.test.cjs](dev4bExtendedChordCatalogAndQuickPreview.test.cjs)
- [dev5AiMetadataAndOriginalKeyAlignment.test.cjs](dev5AiMetadataAndOriginalKeyAlignment.test.cjs)
- [dev5aMetadataLookupEditorUx.test.cjs](dev5aMetadataLookupEditorUx.test.cjs)
- [dev5aWorkersAiModelHeaderNav.test.cjs](dev5aWorkersAiModelHeaderNav.test.cjs)
- [dev5bQrSetlistSharingAndDuplicateSaveFix.test.cjs](dev5bQrSetlistSharingAndDuplicateSaveFix.test.cjs)
- [dev5cFieldQaUiCorrections.test.cjs](dev5cFieldQaUiCorrections.test.cjs)
- [dev5cMetadataSemanticsCorrection.test.cjs](dev5cMetadataSemanticsCorrection.test.cjs)
- [dev5cQolAndFieldFix.test.cjs](dev5cQolAndFieldFix.test.cjs)
- [dev5dEdgeSwipePanel.test.cjs](dev5dEdgeSwipePanel.test.cjs)
- [dev5dMetadataStatusJustifier.test.cjs](dev5dMetadataStatusJustifier.test.cjs)
- [dropdownPortal.test.cjs](dropdownPortal.test.cjs)
- [editorLibraryQol108Dev8e.test.cjs](editorLibraryQol108Dev8e.test.cjs)
- [g2SetlistImportSafety.test.cjs](g2SetlistImportSafety.test.cjs)
- [g7SongbookSetlistUiPolish.test.cjs](g7SongbookSetlistUiPolish.test.cjs)
- [issue107ToolbarBrowser.test.cjs](issue107ToolbarBrowser.test.cjs)
- [issue109KeySemantics.test.cjs](issue109KeySemantics.test.cjs)
- [issue130SongbookLayoutParity.test.cjs](issue130SongbookLayoutParity.test.cjs)
- [librarySetlistBulkQol108Dev8f.test.cjs](librarySetlistBulkQol108Dev8f.test.cjs)
- [librarySetlistDensityQol.test.cjs](librarySetlistDensityQol.test.cjs)
- [mainSetlistCardActions.test.cjs](mainSetlistCardActions.test.cjs)
- [numbersNotation.test.cjs](numbersNotation.test.cjs)
- [onlineSearchProvider.test.cjs](onlineSearchProvider.test.cjs)
- [setlistCountConsistency.test.cjs](setlistCountConsistency.test.cjs)
- [setlistImportRouting.test.cjs](setlistImportRouting.test.cjs)
- [setlistMembership.test.cjs](setlistMembership.test.cjs)
- [sharedCatalogOffline.test.cjs](sharedCatalogOffline.test.cjs)
- [sharedCatalogUi.test.cjs](sharedCatalogUi.test.cjs)
- [sharedSetlistImport.test.cjs](sharedSetlistImport.test.cjs)
- [sharedSetlistPublishing.test.cjs](sharedSetlistPublishing.test.cjs)
- [sidePanelConsolidatedHotfix.test.cjs](sidePanelConsolidatedHotfix.test.cjs)
- [slashChords.test.cjs](slashChords.test.cjs)
- [songParser.test.cjs](songParser.test.cjs)
- [songbookDataFoundation.test.cjs](songbookDataFoundation.test.cjs)
- [songsVsSetlistsSearchUx.test.cjs](songsVsSetlistsSearchUx.test.cjs)
- [swipeCardActions.test.cjs](swipeCardActions.test.cjs)
- [transposeKeyCorrectness.test.cjs](transposeKeyCorrectness.test.cjs)
- [uiCopyDensityCleanup108Dev8c.test.cjs](uiCopyDensityCleanup108Dev8c.test.cjs)
<!-- test-catalog:SONGBOOK_AND_EDITOR:end -->

## SECURITY_AND_API

API trust boundaries, abuse protection, sharing authorization, and safe logging.

<!-- test-catalog:SECURITY_AND_API:start -->
- [dev2ApiSecurityHardening.test.cjs](dev2ApiSecurityHardening.test.cjs)
- [dev2QrSharingAuthGuard.test.cjs](dev2QrSharingAuthGuard.test.cjs)
- [dev2SecurityRemediation.test.cjs](dev2SecurityRemediation.test.cjs)
- [g1ApiSecurityHardening.test.cjs](g1ApiSecurityHardening.test.cjs)
- [g2DistributedAbuseProtection.test.cjs](g2DistributedAbuseProtection.test.cjs)
- [g3QrSharingRevocation.test.cjs](g3QrSharingRevocation.test.cjs)
- [g4BrowserSecurityHeadersCsp.test.cjs](g4BrowserSecurityHeadersCsp.test.cjs)
- [preAuthDebugLogs.test.cjs](preAuthDebugLogs.test.cjs)
- [sharedCatalogApi.test.cjs](sharedCatalogApi.test.cjs)
- [sharedCatalogSchema.test.cjs](sharedCatalogSchema.test.cjs)
- [sharedSetlistCatalog.test.cjs](sharedSetlistCatalog.test.cjs)
- [ugBodyLimits.test.cjs](ugBodyLimits.test.cjs)
- [ugScraperContract.test.cjs](ugScraperContract.test.cjs)
<!-- test-catalog:SECURITY_AND_API:end -->

## INFRASTRUCTURE

Build/runtime configuration, release contracts, PWA lifecycle, and repository checks.

<!-- test-catalog:INFRASTRUCTURE:start -->
- [dev3mLintBehavior.test.cjs](dev3mLintBehavior.test.cjs)
- [devVersionAndReleaseIdentity.test.cjs](devVersionAndReleaseIdentity.test.cjs)
- [fieldCorrections108Dev8b.test.cjs](fieldCorrections108Dev8b.test.cjs)
- [githubTagMetadata.test.cjs](githubTagMetadata.test.cjs)
- [prodCleanRebaseline.test.cjs](prodCleanRebaseline.test.cjs)
- [prodPromotionWorkflow.test.cjs](prodPromotionWorkflow.test.cjs)
- [prodReadinessDev8.test.cjs](prodReadinessDev8.test.cjs)
- [pwaUpdateLifecycle.test.cjs](pwaUpdateLifecycle.test.cjs)
- [saveStatusAndPwaHardening.test.cjs](saveStatusAndPwaHardening.test.cjs)
- [sourceTextPortability.test.cjs](sourceTextPortability.test.cjs)
- [testCatalog.test.cjs](testCatalog.test.cjs)
- [viteWatcherConfig.test.cjs](viteWatcherConfig.test.cjs)
- [webOnlyRepositoryBoundary.test.cjs](webOnlyRepositoryBoundary.test.cjs)
<!-- test-catalog:INFRASTRUCTURE:end -->

## UNCLASSIFIED

New or renamed tests await a human choice of primary category.

<!-- test-catalog:UNCLASSIFIED:start -->
- [bundleSplitBoundaries.test.cjs](bundleSplitBoundaries.test.cjs)
- [cloudSyncAndBackdropUx.test.cjs](cloudSyncAndBackdropUx.test.cjs)
- [importedSetlistSharing.test.cjs](importedSetlistSharing.test.cjs)
- [recoveryResolution.test.cjs](recoveryResolution.test.cjs)
- [scaleBaseline.test.cjs](scaleBaseline.test.cjs)
- [sharedCatalogRecoveryUx.test.cjs](sharedCatalogRecoveryUx.test.cjs)
- [sharedSetlistMemberPublishing.test.cjs](sharedSetlistMemberPublishing.test.cjs)
- [stageCast2.test.cjs](stageCast2.test.cjs)
- [stageCast2AuthLeaseAdmission.test.cjs](stageCast2AuthLeaseAdmission.test.cjs)
- [stageCast2Backend.test.cjs](stageCast2Backend.test.cjs)
- [stageCast2DevEnablement.test.cjs](stageCast2DevEnablement.test.cjs)
- [stageCast2Integration.test.cjs](stageCast2Integration.test.cjs)
- [stageCast2Qr.test.cjs](stageCast2Qr.test.cjs)
- [stageCast2Resilience.test.cjs](stageCast2Resilience.test.cjs)
- [stageCast2Runtime.test.cjs](stageCast2Runtime.test.cjs)
- [stageCast2Ui.test.cjs](stageCast2Ui.test.cjs)
- [tvPresentationPolish.test.cjs](tvPresentationPolish.test.cjs)
- [userManagementRootProtection.test.cjs](userManagementRootProtection.test.cjs)
<!-- test-catalog:UNCLASSIFIED:end -->
