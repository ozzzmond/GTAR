# GTAR Stage Suite (Guitar Tool App Republic)

A high-performance Progressive Web App (PWA) stage teleprompter and chord chart manager designed for live gigging musicians and worship teams.

---

## Features

* **Realtime Band Sync:** Synchronize song selection, setlist navigation, and page state across multiple band devices over local Wi-Fi or WebRTC/WebSocket.
* **Stage Display Engine:** High-contrast Solarized Dark UI tailored for low-light stage visibility with section-based autoscroll.
* **Keep Screen Awake:** Web Screen Wake Lock API prevents screen timeouts during live performances.
* **Smart Setlist Manager:** Organize repertoires, reorder sets on the fly, and switch charts instantly.
* **Offline-First PWA:** Installable on tablets, laptops, and phones via browser with robust local storage caching and Google Drive sync recovery.

---

## Tech Stack

* **Platform:** Web / Progressive Web App (PWA)
* **Frontend:** React, TypeScript, Vite, Tailwind CSS
* **Storage:** LocalStorage with atomic sync journal and Google Drive AppData sync
* **CI/CD:** GitHub Actions (PR Validation & Preview Artifacts)

---

## Getting Started

To run the web app locally:

```bash
cd web
npm install
npm run dev
```

For production builds:

```bash
npm run build --prefix web
```

## Repository boundary

Active development continues in [ozzzmond/GTAR](https://github.com/ozzzmond/GTAR) for the Web/PWA app and its GitHub validation tooling. Native Android is frozen legacy; its source, history, and historical releases are preserved in [ozzzmond/GTAR-Android-Legacy](https://github.com/ozzzmond/GTAR-Android-Legacy). Historical Git history is intentionally preserved here; original GitHub PR and issue metadata remains with ozzzmond/GTAR. Android browser support and legacy backup import remain part of the PWA. Do not add native Android/Gradle projects or local Python release/deploy scripts.

See [GitHub preview contract](RELEASE_WORKFLOW_README.md) for canonical DEV tag validation.
