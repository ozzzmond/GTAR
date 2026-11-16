# GH#536 — MIDI controller support: design

Baseline: `origin/dev` at `01f106d69c7b48614769a9bece3b83c172e15201`, 2026-11-16.
Tracking: [#536](https://github.com/ozzzmond/GTAR/issues/536). Related: [#438 extension contract](438-extension-contract-rnd.md), [#520 Band Sync](520-band-sync-revamp-rnd.md). **Documentation only. No code, no config, no deploy. Each slice in section 7 needs its own owner GO.**

## Evidence labels

- **CODE_OBSERVED**: read in the repository at the baseline above. Not executed, not device tested.
- **DOC_WEB**: read on the cited web page on 2026-11-16 (sources at the end of section 3).
- **PROPOSED**: design for owner review; not shipped behavior.
- **UNVERIFIED**: needs owner device QA or an owner answer. Listed in 3.3; nothing here is guessed.
- **OWNER**: owner decision given with this task.

OWNER decisions: MIDI is built-in for now, in its own isolated module, with no extension API. It lives under Advanced Tools as a launcher row like ProPresenter: a switch (default OFF) plus a dialog. Unsupported browsers show an N/A row with no switch. OFF means no listener, no permission request, no function. USB and Bluetooth as far as Web MIDI exposes them. Actions in v1: next/previous song, next/previous section, autoscroll on/off, scroll up/down, transpose up/down. Nothing else.

## 1. Layout

### 1.1 Advanced Tools row

One row named **MIDI**, placed after the Stage tools (Metronome, Tuner) and before ProPresenter. Tapping the row opens the dialog. The switch only turns MIDI on or off.

```
Off          [♪] MIDI                        ›  ( ○  )
Starting     [♪] MIDI  [Starting]            ›  (  ● )
Allow        [♪] MIDI  [Allow]               ›  (  ● )
Blocked      [♪] MIDI  [Blocked]             ›  (  ● )
No device    [♪] MIDI  [No device]           ›  (  ● )
Connected    [♪] MIDI  [Ready]               ›  (  ● )
Error        [♪] MIDI  [Error]               ›  (  ● )

N/A          [♪] MIDI                             [N/A]
                 Pedal or controller for Stage
```

| State | When | Pill | Switch |
|---|---|---|---|
| Off | default, or switched off | none | off |
| Starting | just switched on, browser has not answered yet | Starting (amber) | on |
| Allow | on, but the browser has not been given permission | Allow (amber) | on |
| Blocked | permission denied | Blocked (red) | on |
| No device | permission OK, no MIDI input found | No device (grey) | on |
| Connected | at least one input is being listened to | Ready (green) | on |
| Error | MIDI failed to start | Error (red) | on |
| N/A | iPhone, iPad, Firefox on Android, or no Web MIDI | N/A (red) | no switch, no button |

The pill follows the ProPresenter rule: it only says what the switch cannot. "On" does not tell a player whether the pedal is seen, so Connected gets a pill too. Pills always carry text; colour is never the only signal (matters for the e-ink theme).

### 1.2 Dialog

Opens from the row. Same modal as ProPresenter: dimmed backdrop, centred card, header, scrolling body, footer with Close.

```
┌───────────────────────────────────────────────┐
│ [♪] MIDI                     [Ready] [?] [X]  │
├───────────────────────────────────────────────┤
│ CONNECTION                                    │
│ Connected: FS-1-WL                            │
│ Listen to   [ All devices              v ]    │
│                                               │
│ ACTIONS                                       │
│ Next song                    [Learn] [Clear]  │
│   CC 64 · Ch 1                                │
│ Previous song                [Learn]          │
│   Not set                                     │
│ Next section                 [Learn]          │
│ Previous section             [Learn]          │
│ Autoscroll on/off            [Learn]          │
│ Scroll up                    [Learn]          │
│ Scroll down                  [Learn]          │
│ Transpose up                 [Learn]          │
│ Transpose down               [Learn]          │
│                                               │
│ ▸ ADVANCED                                    │
├───────────────────────────────────────────────┤
│ [Reset]                              [Close]  │
└───────────────────────────────────────────────┘

Advanced, opened:
│ ▾ ADVANCED                                    │
│ Channel     [ All channels             v ]    │
│ Input monitor                                 │
│   CC 64 · value 127 · Ch 1 · FS-1-WL          │
│   Note 60 (C4) · Ch 1 · FS-1-WL               │
│   Shows the last 5 inputs. Nothing is saved.  │
```

- **Connection**: one status line, the device name (or "2 devices"), and the device choice. Default is **All devices**.
- **Actions**: the nine allowed actions, always in this order. Each has **Learn**. **Clear** shows only when the action has a mapping. One **Reset** in the footer.
- **Advanced**: collapsed by default every time the dialog opens. Holds the channel filter and the input monitor. The monitor runs only while Advanced is open, lives in memory, and is cleared on close.
- The dialog has no second on/off switch. It has one context button under the status line (table in 1.3).

### 1.3 On-screen text for every state

| State | Status line in the dialog | Button |
|---|---|---|
| Off | MIDI is off. Turn it on to use a pedal or controller. | Turn on |
| Starting | Looking for MIDI devices… | none |
| Allow | Your browser needs your OK to use MIDI. | Allow MIDI |
| Blocked | MIDI is blocked for this site. Allow it in your browser's site settings, then try again. | Try again |
| No device | No MIDI device found. Plug in or pair your controller. | Check again |
| No device (one device chosen) | Waiting for *name*. | Use all devices |
| Connected | Connected: *name* / Connected: *n* devices | none |
| Error | MIDI could not start. Turn it off and on again. | none |
| N/A (row only) | Not available on this device/browser | none |

Learn and mapping text:

| Moment | Text |
|---|---|
| Not mapped | Not set |
| Mapped | Note 60 (C4) · Ch 1 / CC 64 · Ch 1 / Program 5 · Ch 1 |
| Learn pressed | Press a pedal or button… **Cancel** |
| Learn timed out (10 s) | Nothing received. Try again. |
| Learn saved | *Action* set to *input*. |
| Input already used | *input* is used by *other action*. **Replace** **Cancel** |
| Learn while not connected | Learn is disabled; the status line already says why |
| Reset pressed | Clear all MIDI mappings? **Reset** **Cancel** |
| Reset done | Mappings cleared. |
| Storage failed | Could not save on this device. |

Numbers are shown as the controller sends them (0–127). Note names use C4 = 60, the same as `web/src/utils/tunerMath.ts`.

### 1.4 Sizes, themes, access

- **Phone**: the Advanced Tools menu is `min(320px, 100vw − 24px)` wide (today's width). The pill wraps under the name when the row is tight, as the ProPresenter row does. In the dialog each action takes two lines (name + buttons, then the mapping).
- **Tablet and desktop**: same dialog, max width `max-w-lg`, max height 90% of the screen, body scrolls. Action name, mapping and buttons fit on one line.
- **Touch targets**: every button, the switch and both selects are at least 44 × 44 px. (Some existing dialog buttons are 40 px; MIDI uses 44.)
- **Light and dark**: only the existing `app-*` theme tokens and the existing pill colours. No new colours. Check in Paper Light, Solarized Dark, OLED Black and E-ink Paper.
- **Keyboard**: Tab order follows the screen. Enter/Space works on every control. Esc closes the dialog (and cancels Learn). Focus returns to the wrench button on close. A computer keyboard never counts as MIDI input.
- **Screen reader**: the switch is `role="switch"` named "MIDI". The row button announces it opens a dialog. The N/A pill reads the full reason. The status line and Learn results are polite live regions. The input monitor is not a live region (it would talk over the player). Advanced uses `aria-expanded`.
- **Reduced motion**: the switch uses `motion-reduce:transition-none`. Learn shows plain text, no pulsing. Monitor lines appear without animation.
- **Help**: one "?" in the dialog header (same pattern as ProPresenter) and one line in the Advanced Tools help. No "?" on each control.

## 2. Code findings

### 2.1 How the ProPresenter row and dialog are built (CODE_OBSERVED)

| Part | Where | Finding |
|---|---|---|
| Row | `ExtensionRow` in `web/src/extensions/host/ExtensionRows.tsx` | Launcher button (icon, name, pill, chevron) plus a switch. Pill only for Starting, Offline, Error |
| N/A row | same file | Plain info row: name, one summary line, `N/A` pill with the reason for screen readers. No button, no switch |
| Row styles | `web/src/components/advancedToolsRow.ts` | `launcherRow`, `launcherButton`, `launcherIcon`, `launcherSwitch`, `flatRow`. 44 px targets |
| Menu | `advancedToolsPopover` in `web/src/components/Header.tsx` | Order: Online Song Sources, Stage tools, extension rows. Width `ADVANCED_TOOLS_WIDTH = 320` |
| Dialog | `ExtensionSettingsDialog` in `ExtensionRows.tsx`, built on `AppModal` / `AppModalSection` (`web/src/components/AppModal.tsx`) | Focus trap, Esc, focus return, portal to `document.body` |
| Dialog owner | `advancedToolsDialog` state in `Header.tsx` | Opening closes the menu; the dialog outlives it; focus returns to the wrench |
| Stage shortcut block | `headerOverlayOpen` in `Header.tsx` → `isHeaderOverlayOpen` in `web/src/App.tsx` → `isAnyModalOpen` → `isAnyOverlayActive` in `web/src/components/StageView.tsx` | While an Advanced Tools dialog is open, Stage keyboard shortcuts do nothing |
| Settings storage | `web/src/extensions/host/settings.ts` | `localStorage` key `gtar_ext_<id>_v1`, JSON `{ enabled, settings }`. Every field is validated on read; a bad value falls back to its default; unreadable JSON means disabled |
| Availability | `proPresenterAvailability()` in `web/src/extensions/registry.ts` | Not iOS, Chromium, secure context, `fetch` and `ReadableStream` present. Returns `{ available }` or `{ available: false, reason }` |
| On/off lifecycle | `ExtensionHost.enable` / `disable` in `web/src/extensions/host/ExtensionHost.ts` | Code is loaded with `import()` only when enabled; an `AbortController` and a generation counter stop late async results |
| Built-in row with a dialog | `OnlineSourcesRow` / `OnlineSourcesDialog` in `web/src/components/OnlineSourcesRow.tsx`; switch stored by `web/src/utils/onlineSources.ts` | Not an extension. Same row styles, same `AppModal`. Reset uses an inline confirm (`confirmRestore`) |
| Stop on OFF | `setStageToolEnabled` in `web/src/stageTools/settings.ts` | Switching a Stage tool off calls its `stop()` so nothing keeps running |
| Help | `AdvancedToolsHelp` in `web/src/components/menuHelp.tsx`, `web/src/components/ProPresenterHelp.tsx` | Both on `ContextualHelp` |
| MIDI today | `web/src/extensions/contract/index.ts` | `device:midi` is a named capability only. No MIDI code exists |
| Backup / cloud | `SETTINGS_KEYS` in `web/src/utils/backupSettings.ts` | An explicit list of keys. A key not on the list is not backed up or synced |
| Headers | `web/public/_headers` | `Permissions-Policy` has no `midi` entry. CSP is unaffected: Web MIDI makes no network request |

### 2.2 What MIDI reuses (PROPOSED)

- Row look: the classes in `advancedToolsRow.ts` and the pill and N/A markup of `ExtensionRow`. The row itself is a new built-in component, like `OnlineSourcesRow`, because MIDI is not in the extension registry.
- Dialog: `AppModal`, `AppModalSection`, the inline Reset confirm from `OnlineSourcesDialog`, `ContextualHelp` for the one "?".
- Dialog opening: a new `'midi'` value for `advancedToolsDialog` in `Header.tsx`. This also gives MIDI the Stage shortcut block for free.
- Storage style: one versioned JSON key, validated on every read, `useSyncExternalStore` with a change event, as in `settings.ts` and `onlineSources.ts`.
- Availability shape: the same `{ available }` / `{ available: false, reason }` result and the reason text "Not available on this device/browser". The iOS test from `proPresenterAvailability()` is reused (moved to a shared helper); the rest is feature detection (`isSecureContext` and `navigator.requestMIDIAccess`), not browser sniffing.
- Lifecycle style: lazy `import()` of the engine, generation counter, stop on OFF.
- Not reused: `ExtensionHost`, the registry and the contract. No extension API is added.

### 2.3 Command path for each action (CODE_OBSERVED)

All paths are inside `web/src/components/StageView.tsx`.

| Action | Existing path | What it already protects | Clean today? |
|---|---|---|---|
| Next song | `handleNextSong` → `triggerSongSlide('next')` | Animation lock, 250 ms repeat guard, end-of-list check, stops autoscroll, tells ProPresenter auto-follow the player took over | Yes |
| Previous song | `handlePrevSong` → `triggerSongSlide('prev')` | Same | Yes |
| Next section | `handleNextSection` (also the dock's `onNextSection`) | Stops autoscroll, clamps to the chart, updates Stage Cast | Yes |
| Previous section | `handlePrevSection` (also the dock's `onPrevSection`) | Same | Yes |
| Autoscroll on/off | `handleToggleAutoScroll` | One toggle; pauses live-lyric scroll | Yes |
| Scroll up / down | Inline in the `keydown` effect: `scrollContainerRef.current.scrollBy({ top: ∓80, behavior: 'smooth' })` | Nothing of its own; scroll bookkeeping runs in `handleContainerScroll` | **No**: no named function |
| Transpose up / down | Inline `onClick` in four places: `onTransposeChange(keyContext.toStoredOffset(keyContext.displayOffset ± 1))` → `handleTransposeChange` in `web/src/App.tsx` | App rejects values outside −11…11 and ignores a Band Sync follower | **No**: no named function |

Two more facts:

- None of these functions can be called from outside `StageView`. The only outside input today is the `window` `keydown` listener in the same file.
- That listener has guards written inline: skip while typing in a field, skip while `isAnyOverlayActive` (dialogs, drawers, Band Sync follower), skip held-key repeats for song and section keys. MIDI must pass the same guards.

Transpose by pedal changes the song's saved TRANSPOSE_OFFSET, exactly as the on-screen buttons do. It never touches ORIGINAL_KEY or CHART_KEY.

### 2.4 Small seams needed (PROPOSED)

1. `handleNudgeScroll(direction)` in `StageView.tsx`: the two inline `scrollBy` calls become one function. The arrow keys call it. No behavior change.
2. `handleTransposeStep(±1)` in `StageView.tsx`: the four inline `onClick` bodies become one function. The buttons call it. No behavior change.
3. `runStageCommand(command)` in `StageView.tsx`: the overlay guard plus a switch over the nine commands, each calling the existing handler. The `keydown` listener calls it for the keys it already handles.
4. `web/src/utils/stageCommands.ts`: a tiny core registry. `StageView` registers `runStageCommand` on mount and removes it on unmount. `run(command)` returns `false` when Stage is not open. It accepts only the nine command names.

MIDI calls `stageCommands.run()` and nothing else in core. Nothing is bypassed: every MIDI press ends in the same function a tap or key press reaches today. When Stage is not on screen (songbook, editor, trash), MIDI does nothing.

### 2.5 Module layout (PROPOSED)

```
web/src/midi/
  actions.ts      the nine action ids and labels (the allowlist)
  message.ts      bytes → { type, channel, number, value } or null
  mapping.ts      schema v1, validate, lookup, conflicts
  settings.ts     localStorage key gtar_midi_v1, change events
  limits.ts       press detection, debounce, burst cap
  engine.ts       access, ports, listeners, states (loaded only when ON)
  MidiRow.tsx     Advanced Tools row
  MidiDialog.tsx  dialog
  MidiHelp.tsx    the one "?"
web/src/utils/stageCommands.ts   core seam
```

Core touches: `Header.tsx` (one row, one dialog value), `menuHelp.tsx` (one help line), `StageView.tsx` (seams 1–3), app start (load the engine if MIDI was left ON). `midi/` reaches core only through `stageCommands` and shared UI parts, so the folder can move to an extension later.

## 3. Platform facts

### 3.1 From sources (DOC_WEB)

| Topic | Fact | Source |
|---|---|---|
| Secure context | `requestMIDIAccess()` works only in a secure context (HTTPS) | S1, S3 |
| Permission | The user must grant access, or have granted it before. Chrome asks for all Web MIDI use, rolling out from Chrome 124; before that only SysEx asked | S3, S5 |
| Denied | The promise rejects with `NotAllowedError` (user said no, said no earlier, or a policy blocks it) | S3, S4 |
| Permissions-Policy | Feature name `midi`, default allowlist `self`. GTAR's header does not list `midi`, so the default applies and the top page may use it. If a policy blocks it, the user cannot grant it | S1, S4 |
| Permission state | `navigator.permissions.query({ name: 'midi' })` reports granted / prompt / denied | S2 |
| User gesture | Neither the spec nor Chrome's post says a tap is required. GTAR asks only from a tap anyway (the switch or a dialog button), or silently at start when the state is already "granted" | S1, S5 |
| SysEx | Off unless asked for (`sysex: false`). Without it the browser hides SysEx messages. GTAR never asks | S1, S3 |
| One message per event | Each `midimessage` event carries one complete MIDI message; real-time messages (clock) can arrive in between | S1 |
| Hot-plug | `statechange` fires when a port appears or changes. A port has `state` (connected / disconnected) and `connection` (open / closed / pending). The spec warns some systems give no connection events | S1 |
| Listening opens the port | Setting `onmidimessage` opens the port implicitly | S1 |
| Port id | Unique per port; the browser *should* keep it between visits, but "some systems may not support completely unique persistent identifiers" | S1 |
| USB vs Bluetooth | The Web MIDI spec has no Bluetooth rules. The page sees whatever MIDI ports the operating system exposes. Android itself supports USB and Bluetooth LE MIDI since Android 6.0 | S1, S7 |
| Spec status | W3C Working Draft, not a finished standard | S1 |

### 3.2 Support matrix (DOC_WEB, from S6; not device tested)

| Browser | Web MIDI | GTAR row |
|---|---|---|
| Chrome desktop | Yes, 43+ | Switch |
| Edge desktop | Yes, 79+ | Switch |
| Chrome on Android | Yes | Switch |
| Samsung Internet | Listed as yes | Switch by feature detection; not a QA target |
| Firefox desktop | Listed as yes, 108+ | See open question 4 |
| Firefox on Android | No | N/A |
| Safari on macOS | No | N/A |
| Any iPhone / iPad browser | Safari on iOS: no, in every listed version | N/A (OWNER: all iPhone/iPad) |

### 3.3 Unverified — owner device QA

Nothing below is assumed. Each item is answered by the QA matrix in section 6.

| # | Question |
|---|---|
| U1 | Android Chrome + Bluetooth: does a Bluetooth MIDI pedal show up in Web MIDI at all? Is Android pairing enough, or is a helper app needed? (Third-party guides mention helper apps; no first-party source found.) |
| U2 | Desktop Chrome and Edge + Bluetooth (Windows, macOS): does a paired Bluetooth MIDI device show up? Is a page reload needed after pairing? |
| U3 | Android Chrome + USB (OTG cable): is the device listed, and does unplug/replug raise `statechange`? |
| U4 | Does `statechange` fire on every target for plug, unplug, Bluetooth sleep and wake? |
| U5 | Is the port id the same after reload, replug and reboot on each target? |
| U6 | Does Chrome show the prompt when asked from a tap on the switch, on Android and desktop? Does it ever need more than a tap? |
| U7 | Is the grant remembered across reloads and in the installed PWA on Android? |
| U8 | Is `permissions.query({ name: 'midi' })` available on every target? (Fallback if not: never ask at start, wait for a tap.) |
| U9 | Do MIDI presses still arrive with the screen dimmed, the tab in the background, or Stage in fullscreen? |
| U10 | Is Edge identical to Chrome here? (Expected, both Chromium; not proven.) |
| U11 | Firefox desktop: how its permission step behaves. Not a v1 target. |
| U12 | Does `usb=()` in GTAR's `Permissions-Policy` affect USB MIDI? (Expected no: that entry is for WebUSB. Proven only when U3 passes.) |

### Sources (read 2026-11-16)

- S1: W3C, Web MIDI API (Working Draft) — https://www.w3.org/TR/webmidi/
- S2: MDN, Web MIDI API — https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API
- S3: MDN, `Navigator.requestMIDIAccess()` — https://developer.mozilla.org/en-US/docs/Web/API/Navigator/requestMIDIAccess
- S4: MDN, `Permissions-Policy: midi` — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/midi
- S5: Chrome for Developers, Web MIDI permission prompt post — https://developer.chrome.com/blog/web-midi-permission-prompt
- S6: Can I use, Web MIDI API — https://caniuse.com/midi
- S7: Android Open Source Project, MIDI — https://source.android.com/docs/core/audio/midi

## 4. Learn and event policy (PROPOSED)

All numbers are starting values to tune in QA.

**Which messages count**

| Message | Learn | Play |
|---|---|---|
| Note On, velocity 1–127 | Captured | Fires the action once |
| Note Off, and Note On with velocity 0 | Ignored | Ignored |
| Control Change 0–119, value 64–127 | Captured | Fires once when the value rises to 64 or more |
| Control Change 0–119, value 0–63 | Ignored | Re-arms that control; fires nothing |
| Control Change 120–127 (channel mode, e.g. All Notes Off) | Ignored | Ignored |
| Program Change | Captured | Fires once per message |
| Everything else (clock, active sensing, pitch bend, aftertouch, SysEx, malformed) | Ignored | Ignored |

**Momentary vs toggle**

- Every action is a button press: one press, one step. Releasing the pedal does nothing.
- Autoscroll is the only toggle: each press flips it, like the on-screen button.
- Holding a pedal never repeats. There is no hold-to-scroll in v1, so nothing can get stuck.
- An expression pedal or knob works as a button: it fires once on the way up past 64 and again only after coming back below 64.

**Debounce, repeat and burst limits**

- Same input: ignored for 150 ms after it fires (switch bounce, double sends).
- Song changes also keep the existing 250 ms guard and animation lock in `triggerSongSlide`.
- All inputs together: at most 8 actions per second. Extra presses are dropped, never queued.
- Settle time: input from a port is ignored for 500 ms after it connects (many controllers send a burst at power-up).
- Dialog open: no action fires (existing overlay guard). Learn and the monitor still see input.

**Learn**

- One action learns at a time. The first message that counts is saved at once. Learn ends on capture, Cancel, 10 s timeout, dialog close, or MIDI off.
- A mapping stores type, channel and number. Value and velocity are not stored.

**Conflicts**

- One input maps to one action. One action has one input.
- Learning an input that is already used asks: Replace or Cancel. Replace moves it; the other action becomes "Not set". Nothing is replaced silently.

**Channel filter**

- Default: all channels. Choosing 1–16 drops every other channel before Learn, play and the monitor.
- A mapping always matches its own learned channel.

**Devices**

- Default: listen to all MIDI inputs. Mappings are for any device, so a spare pedal of the same kind works without relearning.
- Choosing one device listens to that device only. It is remembered by id, with name and maker as a fallback, because ids are not guaranteed to last (S1). If it is missing, GTAR waits and says so; it does not switch to another device by itself.
- Not in v1: a separate mapping set per device.

**Storage**

One `localStorage` key, `gtar_midi_v1`. Local to this browser profile. Not in backups, not in cloud sync (the key is not added to `SETTINGS_KEYS`).

```ts
interface MidiSettingsV1 {
  version: 1
  enabled: boolean                       // default false
  device: 'all' | { id: string; name: string; manufacturer: string }
  channel: 'all' | number                // 1–16
  mappings: Partial<Record<MidiActionId, {
    type: 'note' | 'cc' | 'pc'
    channel: number                      // 1–16
    number: number                       // 0–127 (cc: 0–119)
  }>>
}
```

- Checked field by field on every read. A bad mapping is dropped; the rest stays. Unreadable JSON or an unknown `version` means MIDI off with no mappings, and the stored value is left alone until the user changes something.
- The input monitor and Learn state are never stored.

**Listener lifecycle**

One engine, one `MIDIAccess`, one `statechange` handler, one map of listened ports. A port is listened to by setting `port.onmidimessage` (a property, so one port can never hold two GTAR listeners).

| Event | What happens |
|---|---|
| Switch ON | Load the engine, ask for access (`sysex` not requested), listen to matching ports |
| App start with MIDI left ON | If permission is already granted: connect quietly. If not: state Allow, no prompt |
| Switch OFF | Clear every `onmidimessage`, close the ports, remove the `statechange` handler, drop the access object, cancel Learn, clear press and debounce state. A late answer from the browser is ignored (generation counter) |
| Dialog close | Learn and the monitor stop. Listening for Stage continues |
| Device choice changed | Detach all, attach the new choice, clear press state |
| Channel changed | Clear press state |
| Port disconnects | Remove it from the map, clear its press state. State becomes No device if none are left |
| Port reconnects | Attach once if it matches the choice; 500 ms settle time |
| Page is closed or put away (`pagehide`) | Detach as for OFF; reattach on return if MIDI is ON |

Because actions are single presses and nothing repeats, there is no "held" command to release when a device drops out.

## 5. Safety (PROPOSED)

- **Default OFF.** With MIDI off the engine file is not loaded, no access is requested, no listener exists.
- **Allowlist only.** The nine actions in `actions.ts` are the only things MIDI can do. The id is checked at Learn, on load and at dispatch. `stageCommands` accepts only those nine names.
- **Input is checked.** A message must be 2 or 3 bytes with a valid status byte and data bytes under 128, or it is dropped. Stored settings are validated on every read. Device names are shown as plain text, cut to 128 characters, never as HTML.
- **Nothing destructive or privileged.** No delete, restore, import, export, sign-in, settings, backup, sync, cast or fullscreen action can be mapped. Transpose is the only action that changes saved data, and it changes exactly what the on-screen button changes.
- **No SysEx, no output.** Access is requested without `sysex`. GTAR never sends MIDI.
- **Nothing leaves the device.** No telemetry and no upload of MIDI messages, device names or ids. None of it goes to Debug Logs, backups or cloud sync.
- **Isolated from Stage.** MIDI renders nothing inside Stage View. Every engine callback is wrapped; an error sets state Error and detaches. If the engine fails to load, Stage, keyboard shortcuts and touch work as before. A Band Sync follower and any open dialog block MIDI the same way they block the keyboard.

## 6. Test plan

### 6.1 Unit tests (flat in `web/tests/`, fast tier, fake `MIDIAccess`; no real device)

| File | Covers |
|---|---|
| `midiMessageParse.test.cjs` | Note on/off, velocity 0, CC, PC, channel 1–16; clock, SysEx, short, long and bad bytes are dropped |
| `midiMapping.test.cjs` | Lookup by type/channel/number; one input one action; Replace moves a mapping; Clear and Reset |
| `midiActionAllowlist.test.cjs` | Only the nine ids are accepted at Learn, load and dispatch; `stageCommands` rejects anything else and returns false with no Stage |
| `midiSettingsPersistence.test.cjs` | Round trip; bad JSON, unknown version and bad fields fall back safely; default OFF; key is not in `SETTINGS_KEYS` |
| `midiLimits.test.cjs` | CC fires once per press and re-arms below 64; note-off ignored; 150 ms debounce; 8 per second cap; 500 ms settle; no repeat on hold |
| `midiEngineLifecycle.test.cjs` | Listener count is 0 when OFF, 1 per port when ON; OFF, device switch, reconnect and reopening the dialog never add a second listener; late access result after OFF is ignored; denied and no-device states |
| `midiAdvancedToolsRow.test.cjs` | Every row state and pill; N/A row has no switch or button; switch default off |
| `midiDialog.test.cjs` | Status text per state; Learn, timeout, conflict prompt, Clear, Reset confirm; Advanced closed by default; monitor not stored |
| `stageCommandSeam.test.cjs` | Keyboard keys behave as before through `runStageCommand`; overlay guard blocks; nudge and transpose step call the same paths |

After adding files: `node web/scripts/test-catalog.cjs --write`. Existing suites that must stay green: `advancedToolsDialogs528`, `onlineSourcesRow516`, `proPresenterUiUxPolish`, `stageSectionNavigationDock`, `stageContinuityInput`, `g4BrowserSecurityHeadersCsp`, `bundleSplitBoundaries`.

### 6.2 Owner device QA matrix

| # | Device and browser | Connection | Answers |
|---|---|---|---|
| Q1 | Android phone or tablet, Chrome | USB (OTG) | U3–U9 |
| Q2 | Android phone or tablet, Chrome | Bluetooth | U1, U4–U9 |
| Q3 | Desktop Chrome | USB | U4–U9 |
| Q4 | Desktop Chrome | Bluetooth | U2, U4, U5 |
| Q5 | Desktop Edge | USB | U10 |
| Q6 | Desktop Edge | Bluetooth | U2, U10 |
| Q7 | iPhone and iPad, Safari and Chrome | none | Row shows N/A, no switch, nothing asks for permission |
| Q8 | Android, Firefox | none | Row shows N/A |

Checks for Q1–Q6, on the Cloudflare DEV preview:

1. Switch on: the browser asks once; the row goes to Ready and shows the device name in the dialog.
2. Learn works for a note, a CC and a program change.
3. Each of the nine actions fires once per press. Holding does nothing more. Releasing does nothing.
4. Unplug or power off: No device. Reconnect: Ready without a reload, still one action per press.
5. Switch off: the pedal does nothing. Reload with MIDI on: it reconnects without asking again.
6. Deny permission: Blocked, with the fix-it text.
7. Stage fullscreen works. With the MIDI dialog open the pedal does not move Stage.
8. As a Band Sync follower the pedal does nothing.
9. Light and dark theme, phone and tablet sizes, installed PWA.
10. Songbook, setlists, Stage, Band Sync and ProPresenter behave as before with MIDI off and on.

## 7. Phased plan

Each slice is its own later draft PR into `dev`, in this order.

| Slice | Content | Risk |
|---|---|---|
| P1 | Pure logic, no UI, no browser API: `actions`, `message`, `mapping`, `settings`, `limits` and their unit tests | Low. Nothing is wired in |
| P2 | Stage seam, no MIDI: `handleNudgeScroll`, `handleTransposeStep`, `runStageCommand`, `stageCommands.ts`; keyboard goes through the same path | Medium. Touches `StageView.tsx`; keyboard and pedal-keyboard behavior must stay identical |
| P3 | Engine plus row plus status-only dialog: switch, permission, states, device names, N/A row, help line. No mappings yet, so MIDI cannot move Stage | Medium-high. First real browser API and lifecycle. First device QA (connection only: U1–U8). Optional explicit `midi=(self)` in `web/public/_headers`, owner approval needed |
| P4 | Learn, Clear, Reset, conflicts, and dispatch to `stageCommands` | Medium-high. First time a pedal moves Stage. Full QA matrix |
| P5 | Advanced: device choice, channel filter, input monitor | Low-medium |
| P6 | Tuning from QA (limits, text, Bluetooth notes in help) | Low |

## 8. Deferred (no issues created)

- MIDI output: GTAR sends nothing to any device.
- Clock sync: MIDI clock messages are ignored.
- Metronome tempo sync: no link to the Metronome (#535).
- ProPresenter or DAW integration: no MIDI bridge to either.
- SysEx: never requested, never read.
- Network MIDI: no RTP-MIDI, WebSocket or other network transport.

## 9. Open questions for the owner

All five were answered by the owner on 2026-11-16 (**OWNER** lines below). None remain open.

1. **Latching footswitches.** Some pedals send "on" for one press and "off" for the next. With press-only detection they act on every second press. Add an "every press" option per mapping in v1, or ask players to set the pedal to momentary? Recommended: momentary only in v1; decide after Q1–Q3. **OWNER: momentary only in v1; no per-mapping option.**
2. **Scroll step.** Scroll up/down by pedal moves 80 px, the same as the arrow keys. Keep that, or use a bigger step for feet (for example half a screen)? Recommended: keep 80 px in v1 so nothing new is invented; revisit after QA. **OWNER: 80 px, the same as the arrow keys.**
3. **Transpose by pedal.** It changes the song's saved TRANSPOSE_OFFSET like the on-screen buttons. OK as is? Recommended: yes; it is never mapped by default. **OWNER: allowed; never mapped by default.**
4. **Firefox desktop.** Listed as supported but with its own permission step, untested. Show the switch (best effort) or N/A until tested? Recommended: N/A until tested. **OWNER: N/A until tested.**
5. **Stage indicator.** Show a small "MIDI" mark on the Stage toolbar while connected, or keep Stage unchanged? Recommended: unchanged in v1. **OWNER: no MIDI indicator on the Stage toolbar in v1.**

## 10. Status

As of 2026-11-16, `origin/dev` at `9ac312c4e3ae0389c0e76a7f7e477fc69559a87a`. The sections above are the design as approved and are left as written; this section records what shipped.

**Merged into `dev`**

| Slice | Content | PR |
|---|---|---|
| Design | This document | #544 |
| P2 | Stage command seam | #547 |
| P1 | Core logic, not wired | #548 |
| P3 | Engine, Advanced Tools row, status dialog | #549 |
| P4 | Learn, mappings, Stage dispatch | #550 |
| P5 | Device choice, channel filter, input monitor | #551 |
| P6 | Close-out: help notes and this section. No behavior change | this PR |

**Owner device QA.** The owner reported QA passed on the Cloudflare previews for P3, P4 and P5, with no defects. The numbers in section 4 (150 ms debounce, 8 actions per second, 500 ms settle) and the nine actions are therefore unchanged.

**Deviations from this document, accepted by the owner**

- `web/src/midi/loader.ts` was added (not in 2.5). It holds the switch, the status store and the only `import()` of the engine.
- P3: the dialog header pill shows "Off" while MIDI is off. The Advanced Tools row shows no pill when off, as in 1.1.
- `AppModal` gained an optional `onEscape`, so Esc cancels a waiting Learn or its Replace question before it closes the dialog.
- Learn skips input from a port that is still inside its 500 ms settle time.
- The input monitor shows only inputs Learn would capture (after the channel filter), not every message.
- A chosen device whose id changed is found by name and maker only when exactly one connected input matches; otherwise GTAR waits for it.

**Owner answers.** The five answers in section 9 stand unchanged. Firefox (desktop and Android) shows N/A.

**Still UNVERIFIED on real hardware**

- iPhone and iPad N/A rows (Q7).
- Firefox N/A rows (Q8) and Firefox MIDI behavior (U11).
- Edge (Q5, Q6, U10).
- Installed PWA (U7, check 9).
- E-ink Paper theme (1.4).
- Screen readers (1.4).
