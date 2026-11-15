# GTAR Stage Suite (Guitar Tool App Republic)

GTAR is a functional Web/PWA songbook, chord chart editor, and stage teleprompter for musicians and worship teams. Prepare charts, organize a setlist, and read lyrics and chords during rehearsal or performance on a phone, tablet, or laptop.

This is the **original, legacy GTAR project**. Its maintained application is the Web/PWA in this repository. [GTAR1](#gtar1) is a separately evolving project and the focus of future public-launch efforts.

## Features

- **Songbook and chart editing:** Create and edit ChordPro charts with a live preview, organize songs, and transpose chords for performance.
- **Setlists:** Build ordered sets from your songbook and move between songs on stage.
- **Stage view:** Read charts in a dedicated performance view with adjustable text size, themes, section navigation, and autoscroll.
- **Keep screen awake:** Enable Screen Wake Lock on supported browsers to help prevent screen timeouts during performance.
- **External display:** Open a presentation window on supported desktop browsers for a second screen or HDMI display. TV presentation options depend on the browser and available connection mode.
- **Local-first PWA:** Keep songs and setlists in browser storage on the device, with no mandatory login for the local songbook. The built app caches its application files for offline use after an initial online load; online services still require a connection.
- **Backup and import:** Export device backups and restore or import supported files, including compatible legacy Android backups.

## Basic usage and installation

1. Open your existing GTAR installation in a supported browser.
2. Create or import songs into the songbook, then edit and preview their charts.
3. Arrange songs into a setlist and open Stage view for rehearsal or performance. Adjust text size and transpose as needed, then use section navigation or autoscroll.
4. Use **Backup & Restore** to save a copy of your library outside the browser. Device storage can be lost when browser data is cleared.

To install the PWA, open the hosted GTAR app over HTTPS and use the browser's **Install app** option, where available. On iPhone or iPad, open it in Safari and choose **Share → Add to Home Screen**. Installation options vary by browser and operating system. Load the app online first and check that your charts open offline before relying on it at a venue.

## Run locally

Use Node.js 22 and npm. From the repository root:

```bash
cd web
npm ci
npm run dev
```

Open `http://localhost:5173`. This starts the frontend only. On Windows, after setting up the prerequisites in the [Web/PWA development guide](web/README.md), run `Run_Full_Stack_Dev.bat` from `web` when local API access is needed.

To build the Web/PWA from the repository root:

```bash
npm run build --prefix web
```

The frontend uses React, TypeScript, Vite, and Tailwind CSS. Songs and setlists use device-local browser storage (IndexedDB); the retired account-based cloud songbook sync and LAN Band Sync are not current features.

## Documentation and repository boundary

- [Web/PWA development guide](web/README.md) — local setup and development checks.
- [Legacy import compatibility](web/LEGACY_IMPORT_COMPATIBILITY.md) — supported backup formats and explicit import behavior.
- [Web/PWA test catalog](web/tests/README.md) — regression coverage and test tiers.
- [Release and GitHub preview contract](RELEASE_WORKFLOW_README.md) — contributor reference for validation and release procedures.

This repository is Web/PWA-only. Native Android is frozen legacy; its archive is referenced in the [Web/PWA guide](web/README.md). Android browser support and compatible legacy backup import remain part of the PWA. Historical Git history is preserved here, along with the original GitHub issues and pull requests.

## GTAR1

[GTAR1](https://github.com/ozzzmond/GTAR1) evolves separately from legacy GTAR and is the focus of future public-launch efforts.

**[GTAR1 Interactive Demo](https://demo.gtar1.pages.dev/)** — the owner-provided demo for GTAR1. It is not a legacy GTAR demo. The projects have separate codebases and deployments; feature parity is not implied.

## Credits and license

GTAR is maintained in [ozzzmond/GTAR](https://github.com/ozzzmond/GTAR). Imported guitar chord voicings credit the MIT-licensed chords-db project and its chordbook fork; see the [source attribution](web/src/data/importedChords.ts).

This repository currently has no project-level license file. Third-party license notices apply to their respective components and do not establish a license for GTAR as a whole.
