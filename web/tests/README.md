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

## AUTH

Account access, sign-in, session lifecycle, and authentication UI.

- [accountAccessFoundation.test.cjs](accountAccessFoundation.test.cjs)
- [authBypassInteraction.test.cjs](authBypassInteraction.test.cjs)
- [authenticationSecurity.test.cjs](authenticationSecurity.test.cjs)
- [authGate.test.cjs](authGate.test.cjs)
- [authLifecycle.test.cjs](authLifecycle.test.cjs)
- [authSessionRuntime.test.cjs](authSessionRuntime.test.cjs)
- [durableAuthSession.test.cjs](durableAuthSession.test.cjs)
- [g5SessionRevocationSecurity.test.cjs](g5SessionRevocationSecurity.test.cjs)
- [googleOAuthSecurity.test.cjs](googleOAuthSecurity.test.cjs)
- [membershipBadgeInteraction108Dev8f.test.cjs](membershipBadgeInteraction108Dev8f.test.cjs)

## CLOUD_SYNC_AND_STORAGE

Cloud reconciliation, local persistence, backup, import recovery, and retirement.

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

## THEMES

Presets, palettes, typography, semantic tokens, theme lifecycle, and theme sync.

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

## STAGE

Performance controls, casting, navigation, continuity, and session persistence.

- [dev3QolNavigationStageControls.test.cjs](dev3QolNavigationStageControls.test.cjs)
- [fullscreenStageQol.test.cjs](fullscreenStageQol.test.cjs)
- [stageCastRouting.test.cjs](stageCastRouting.test.cjs)
- [stageContinuityInput.test.cjs](stageContinuityInput.test.cjs)
- [stageLifecycle.test.cjs](stageLifecycle.test.cjs)
- [stageSectionNavigationDock.test.cjs](stageSectionNavigationDock.test.cjs)
- [stageSessionPersistence.test.cjs](stageSessionPersistence.test.cjs)

## SONGBOOK_AND_EDITOR

Library/setlist UI, editing, chords, metadata, search, and sharing interactions.

- [chordProMetadataRevamp.test.cjs](chordProMetadataRevamp.test.cjs)
- [dev2aFieldHardening.test.cjs](dev2aFieldHardening.test.cjs)
- [dev2bFieldFixAndChordRendering.test.cjs](dev2bFieldFixAndChordRendering.test.cjs)
- [dev2bUiCleanlinessAndNavigation.test.cjs](dev2bUiCleanlinessAndNavigation.test.cjs)
- [dev2cUiPolishAndReceiptRetirement.test.cjs](dev2cUiPolishAndReceiptRetirement.test.cjs)
- [dev3aFieldFixes.test.cjs](dev3aFieldFixes.test.cjs)
- [dev3SearchUiCleanup.test.cjs](dev3SearchUiCleanup.test.cjs)
- [dev4aTrustedChordVoicingCoverage.test.cjs](dev4aTrustedChordVoicingCoverage.test.cjs)
- [dev4bExtendedChordCatalogAndQuickPreview.test.cjs](dev4bExtendedChordCatalogAndQuickPreview.test.cjs)
- [dev4ChordFoundation.test.cjs](dev4ChordFoundation.test.cjs)
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
- [librarySetlistBulkQol108Dev8f.test.cjs](librarySetlistBulkQol108Dev8f.test.cjs)
- [librarySetlistDensityQol.test.cjs](librarySetlistDensityQol.test.cjs)
- [mainSetlistCardActions.test.cjs](mainSetlistCardActions.test.cjs)
- [numbersNotation.test.cjs](numbersNotation.test.cjs)
- [onlineSearchProvider.test.cjs](onlineSearchProvider.test.cjs)
- [setlistImportRouting.test.cjs](setlistImportRouting.test.cjs)
- [setlistMembership.test.cjs](setlistMembership.test.cjs)
- [sharedCatalogOffline.test.cjs](sharedCatalogOffline.test.cjs)
- [sharedCatalogUi.test.cjs](sharedCatalogUi.test.cjs)
- [sidePanelConsolidatedHotfix.test.cjs](sidePanelConsolidatedHotfix.test.cjs)
- [slashChords.test.cjs](slashChords.test.cjs)
- [songbookDataFoundation.test.cjs](songbookDataFoundation.test.cjs)
- [songParser.test.cjs](songParser.test.cjs)
- [songsVsSetlistsSearchUx.test.cjs](songsVsSetlistsSearchUx.test.cjs)
- [swipeCardActions.test.cjs](swipeCardActions.test.cjs)
- [transposeKeyCorrectness.test.cjs](transposeKeyCorrectness.test.cjs)
- [uiCopyDensityCleanup108Dev8c.test.cjs](uiCopyDensityCleanup108Dev8c.test.cjs)

## SECURITY_AND_API

API trust boundaries, abuse protection, sharing authorization, and safe logging.

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
- [ugBodyLimits.test.cjs](ugBodyLimits.test.cjs)
- [ugScraperContract.test.cjs](ugScraperContract.test.cjs)

## INFRASTRUCTURE

Build/runtime configuration, release contracts, PWA lifecycle, and repository checks.

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
- [viteWatcherConfig.test.cjs](viteWatcherConfig.test.cjs)
- [webOnlyRepositoryBoundary.test.cjs](webOnlyRepositoryBoundary.test.cjs)
