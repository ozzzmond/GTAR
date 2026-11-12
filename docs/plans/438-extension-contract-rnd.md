# issue#438 — Optional-extension contract proposal (RnD, 2026-11-12)

Baseline: `dev` @ 709ab99. **Proposal only. No framework code, no connector code, no Core change.**
Platform evidence: [415-propresenter-feasibility.md](415-propresenter-feasibility.md).
Owner decision is required before any code (see "Owner decisions").

## Invariants (from issue#438, non-negotiable)

- I1 Core works with zero extensions installed or enabled.
- I2 A disabled extension has zero side effects: no code loaded, no listener, no timer, no network, no storage write.
- I3 Songbook editor stays core.
- I4 No secrets in client bundles.
- I5 Same repo for now; contract stays portable.
- I6 Read-only hooks first; write/control hooks are out of the MVP.
- I7 Every extension defaults OFF.

## Terms

- **Extension** — optional module bundled with GTAR that the user can enable.
- **Extension host** — the only core-side code that knows extensions exist.
- **Contract** — the types and rules below; versioned on its own (`contractVersion`).
- **Capability** — a named thing an extension needs from the device, browser or core.

## 1. Manifest

Static data, no logic, safe to bundle eagerly (a few hundred bytes per extension).

```ts
interface ExtensionManifest {
  id: string                 // stable, lowercase kebab, e.g. 'propresenter-follower'; storage and test ids derive from it
  name: string               // shown in Advanced Tools
  version: string            // semver of the extension
  contractVersion: 1         // major of the contract it was written against
  summary: string            // one line under the name
  capabilities: Capability[] // declared up front; host refuses anything undeclared
  settings: SettingField[]   // section 2; [] if none
}
```

Capability vocabulary v1 (closed list; adding one is a contract change):

| Capability | Meaning |
|------------|---------|
| `events:song` `events:section` `events:setlist` `events:transpose` | May subscribe to that read-only core event |
| `net:lan` | Talks to a user-entered LAN host (HTTP or WebSocket) |
| `net:https` | Talks to a fixed public HTTPS host declared in the manifest review |
| `device:midi` `device:bluetooth` `device:audio-in` `device:audio-out` | Uses that browser API |
| `ui:panel` | Renders its own panel in a host-provided slot |

Reserved, **not in v1**: `control:*` (navigate song, change transpose, edit setlist), `library:read`, `library:write`.

`defaultEnabled` is deliberately absent: there is no way to declare an extension ON by default (I7).

## 2. Settings schema

```ts
type SettingField =
  | { key: string; type: 'boolean'; label: string; default: boolean }
  | { key: string; type: 'text' | 'host'; label: string; default: string; placeholder?: string }
  | { key: string; type: 'port' | 'number'; label: string; default: number; min?: number; max?: number }
  | { key: string; type: 'select'; label: string; default: string; options: { value: string; label: string }[] }
  | { key: string; type: 'secret'; label: string }   // user-entered, never has a default
```

- The host renders the form from the schema and validates before saving; extensions do not build settings UI.
- Storage: one key per extension, `gtar_ext_<id>_v1`, JSON `{ enabled, settings }`, device-local
  (same pattern as `gtar_online_sources`). Storage unavailable → treated as disabled.
- `secret` fields: entered by the user on the device, masked, never in the bundle, never written to
  Debug Logs, never included in backup export. Anything needing a server-held secret is not a client
  extension concern and needs its own backend decision.
- Extension settings are **not** part of songbook backup/restore in v1 (owner decision D5).
- Unknown or invalid stored values fall back to defaults; they never throw into core.

## 3. Lifecycle

```ts
interface ExtensionModule {
  manifest: ExtensionManifest
  checkAvailability(env: HostEnv): { available: true } | { available: false; reason: string }
  activate(ctx: ExtensionContext): void | (() => void)   // return value = dispose
}
```

States:

| State | Meaning | Code loaded | Side effects |
|-------|---------|-------------|--------------|
| `absent` | Not in the build | no | none |
| `disabled` | Bundled, OFF (default) | manifest only | none |
| `unavailable` | Capability check failed on this device/browser | manifest + check | none |
| `starting` | User enabled it; module loading | yes | none until `activate` |
| `active` | Running | yes | only what its capabilities declare |
| `offline` | Running, its external service unreachable; retrying | yes | bounded retry only |
| `error` | Threw or misbehaved; host stopped it | yes, disposed | none |

Transitions:

```text
disabled --enable--> unavailable            (check fails; row shows the reason; toggle stays off)
disabled --enable--> starting --> active
active  <--> offline                        (extension reports; host shows status; no core impact)
active/offline --throw / N consecutive faults--> error   (host disposes; user can retry or disable)
any --disable--> disabled                   (host calls dispose, aborts ctx.signal, drops subscriptions)
```

Rules:
- "Install" in v1 means "present in the build". There is no store, download or runtime install.
- `checkAvailability` is synchronous, pure feature detection: no network, no permission prompt, no
  storage write. Example reasons: "Web MIDI is not available in this browser",
  "This browser blocks connections to local network devices from a secure page".
  It can run before the lazy chunk loads if it lives next to the manifest.
- Permission prompts (local network, MIDI, microphone) only happen after an explicit user action
  inside the extension's own UI, never on app start.
- `ExtensionContext` gives: `settings` (read + subscribe), `events.on(...)`, `signal` (AbortSignal
  aborted on disable), `reportStatus('active' | 'offline' | 'error', message?)`, `log(...)` into the
  existing Debug Logs FIFO with secrets redacted. Nothing else from core is reachable.
- Dispose is mandatory and idempotent. After disable the host verifies no subscriptions remain.
- App offline (no internet) is not an extension state; `offline` is about the extension's own service.

## 4. Core events (read-only, v1)

| Event | Payload | Fires when |
|-------|---------|-----------|
| `song.changed` | `{ songId, title, chartKey, performanceKey, transposeOffset }` | The displayed song changes |
| `section.changed` | `{ songId, sectionIndex, sectionLabel }` | The current section/slide changes |
| `setlist.changed` | `{ setlistId, entryIndex, entryCount }` | Active setlist or position changes |
| `transpose.changed` | `{ songId, chartKey, performanceKey, transposeOffset }` | TRANSPOSE_OFFSET changes |

- Payloads are frozen plain data snapshots using the glossary terms. No library objects, no setters,
  no ChordPro body in v1. ORIGINAL_KEY is not exposed in v1 because extensions must never be a path
  to guess or rewrite it.
- Delivery is asynchronous (microtask), each listener in its own try/catch. A slow or throwing
  extension cannot block or break core. With zero subscribers the emit is a no-op.
- The host subscribes to existing core state at one seam; extensions never import core modules.
- **Unverified:** active setlist state exists in `App.tsx` (`activeSetlistId`,
  `activeSetlistSongIndex`). Whether core tracks a "current section" today was not verified;
  `section.changed` may need a small core seam and should be wired only when a consumer needs it.

Write/control hooks: **none in v1** (I6). Known future demand: MIDI controller input (page turn,
transpose), cloud-drive shared folder (library write). Each needs its own design and owner approval.

## 5. Repo layout and bundling

Proposed: inside the existing web workspace, not a root `extensions/` and not npm workspaces.

```text
web/src/extensions/
  contract/        types + CONTRACT_VERSION; imports nothing from core   (portable unit)
  host/            registry, lifecycle, settings store, event bridge     (only part core imports)
  registry.ts      static list: { manifest, checkAvailability, load: () => import('./<id>') }
  <extension-id>/  manifest.ts, availability.ts, index.ts (lazy), panel.tsx, *.test via web/tests
```

Why: `tsconfig.app.json` includes only `src`; one Vite build, one ESLint config, one test runner
with `tiers.json`. Root-level workspaces would touch `package-lock.json`, CI and release tooling for
no present benefit (I5).

Import rules (to enforce with ESLint `no-restricted-imports` when code lands):
- extension → `contract/` only;
- core → `host/` only;
- `contract/` → nothing.

Bundling for the offline PWA:
- Manifests and availability checks: eager, tiny.
- Implementation: `import()` chunk per extension, fetched only on enable (I2).
- Workbox `globPatterns` already precaches every built `js` file, so the lazy chunk is available
  offline with no service-worker change. Cost: precache size grows by each extension chunk for all users.
- Runtime loading of remote code: **rejected.** `script-src 'self'` forbids it, it breaks offline,
  and no concrete need exists.

## 6. UI home

- Advanced Tools lists one row per registry entry: name, summary, state chip
  (Off / On / Offline / Error / "Not available on this device/browser" + reason).
- Tapping a row opens a host-rendered panel: enable toggle, schema-generated settings, status,
  and the extension's `ui:panel` slot if declared.
- Rows are generated from the registry: nothing registered → nothing rendered. No placeholders.
- Finding: `Header.tsx` currently renders a hard-coded, non-interactive "ProPresenter — Modular" row
  (`settings-propresenter-stub`), asserted by `web/tests/backupRestoreCenterMenu.test.cjs`. That is a
  dead control under issue#438's own rule. Not touched in this PR; it should be replaced by a
  registry row or removed when the host lands (owner decision D6).
- Web Sources stays where it is in v1.

## 7. Portability to a separate repo later

Kept cheap by: `contract/` importing nothing, extensions importing only `contract/`, static registry.

What would change:
- Versioning: publish `contract/` as a package; semver; `contractVersion` major gates loading; host
  supports current major only and reports older extensions as `unavailable` with a reason.
- Consumption: extensions become build-time npm dependencies of `web/`; still bundled, still no runtime loading.
- CI: extensions repo runs a contract conformance kit (manifest valid, default OFF, dispose leaves no
  subscriptions, no undeclared capability use). GTAR CI keeps one test that boots with an empty registry (I1).
- Release: extension versions pinned in `web/package.json`; a bump is a normal PR into `dev`. GTAR's
  release flow (`RELEASE_WORKFLOW_README.md`) is unchanged; no extension ships outside a GTAR release.
- Trigger to move: more than one working extension and no contract change for a release cycle (per issue#438).

## 8. Candidates (brainstorm, not committed)

| Candidate | Capabilities | Fits read-only v1 | Platform note |
|-----------|--------------|-------------------|---------------|
| ProPresenter follower (issue#415) | `net:lan`, `ui:panel` | Yes | **Blocked as deployed**; see feasibility doc |
| MIDI controller | `device:midi`, events | Output only (send on song/section change). Input needs `control:*` | No Web MIDI on any iPhone; Chrome Android per documentation |
| External metronome | `device:bluetooth` or `net:lan`, `events:song` | Likely | Transport undefined; Web Bluetooth not verified on any device |
| Web source repositories | `net:https` | Needs design | Today's Web Sources is core, opt-in, default off; `connect-src` limits direct hosts |
| Cloud-drive shared folder | `net:https`, `library:write` | No | Needs write hooks and Google credentials; cloud/login out of scope now |
| Backup to cloud drive | `net:https`, `library:read` | No | Manual cloud backup is core today |
| Band Sync (owner 2026-11-12) | `net:lan`, events, later `control:*` | No design or schedule | Keeps current core behavior; `ws://` LAN falls under the same browser local-network rule (feasibility doc) |
| Guitar tuner (owner 2026-11-12) | `device:audio-in`, `ui:panel` | Yes, self-contained | No design or schedule; microphone permission |
| Metronome revamp (owner 2026-11-12) | `device:audio-out`, `events:song` | Yes | No design or schedule; `metronome.ts` is core today |

## 9. Validation against issue#415

| issue#415 MVP need | Contract answer | Gap found |
|--------------------|-----------------|-----------|
| Host/port | `host` + `port` settings fields | none |
| Enable/disable, default OFF | Lifecycle + I7 | none |
| Connection test/status | `reportStatus` + panel | none |
| Current/next lyrics | `ui:panel` slot | Needs a placement decision: panel only, or also inside Stage view (Stage is core; a Stage slot is a new seam) |
| Song-change detection (ProPresenter side) | Internal to the extension | none |
| 500 ms polling, reconnect | `signal` + `offline` state | Host should pause timers when the page is hidden |
| Safe disabled/offline fallback | I2 + `error` isolation | none |
| Read-only | No `control:*` in v1 | none |
| "Not available on this device/browser" | `checkAvailability` | Cannot be decided by feature detection alone: the local-network block is only observable by trying. Needs a second, user-triggered "connection test" result distinct from `unavailable` |
| Reach `http://<LAN>:1025` | `net:lan` | **Platform block, outside the contract:** CSP, CORS unknown, iOS |

Takeaways:
- The first consumer needs almost none of the four core events. It is an inbound follower. The event
  bus should not be built ahead of a consumer.
- `net:lan` is not a private matter of one extension: it needs a `connect-src` decision that affects
  every user, including those with all extensions off. That makes it an owner-level decision, not
  an extension setting.

## 10. Recommended first slice

Not started; needs owner go.

**Slice 1 — extension host shell, no connector:** `contract/` types, static registry, enable/disable
persistence, `checkAvailability`, lazy load, dispose guarantee, Advanced Tools rows from the registry,
and the tests for I1/I2/I7 (empty registry boots; disabled loads no chunk and makes no request).
No event bus yet.

**Slice 2 depends on the feasibility outcome:**
- If the owner's E14 check shows ProPresenter sends CORS headers **and** the owner accepts a
  `connect-src` change: ProPresenter follower for Chromium, connection test first, "not available"
  on iOS. This is issue#415 Phase 3.
- Otherwise: prove the contract with a consumer that has no network dependency (guitar tuner or
  metronome revamp fit; both are owner-named), and keep issue#415 parked on its options list.

Reason for splitting: slice 1 is small, has no platform risk and is needed whichever consumer goes
first; it avoids designing the host around a connector that may not be reachable from a browser.

## Owner decisions

| ID | Decision | Recommendation |
|----|----------|----------------|
| D1 | Accept contract v1 as drafted (manifest, settings, lifecycle, capability list) | Accept as draft; freeze only after slice 2 |
| D2 | Layout `web/src/extensions/` with build-time lazy chunks | Yes |
| D3 | Events: wire none until a consumer needs one | Yes |
| D4 | issue#415 path: run the E14 CORS check, then pick an option from the feasibility doc | Run the check first; it costs minutes |
| D5 | Extension settings excluded from backup/restore in v1 | Yes |
| D6 | Replace or remove the hard-coded ProPresenter stub row when the host lands | Replace by registry row |
| D7 | Go / no-go for slice 1 | Go, after D1–D3 |
