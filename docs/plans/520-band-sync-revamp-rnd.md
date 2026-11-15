# GH#520 — Band Sync revamp: design / RnD

Baseline: `origin/dev` at `ea24756c8594ac7f6244f14df80df4664e1468f0`, 2026-11-15.
Tracking: [#520](https://github.com/ozzzmond/GTAR/issues/520). Extension contract: [#438](438-extension-contract-rnd.md). **Documentation only. No code, no Cloudflare change, no deploy. Implementation needs an owner GO per phase.**

## Evidence labels

- **CODE_OBSERVED**: read in the repository at the baseline above. Not executed, not device tested.
- **DOC_CF**: Cloudflare documentation or pricing pages found by web search on 2026-11-15. Re-check the account dashboard before relying on a number.
- **PROPOSED**: design for owner review; not shipped behavior.
- **UNVERIFIED**: needs a test or an owner answer before P1 code.
- **OWNER**: owner decision recorded in #520.

OWNER constraints: optional extension (#438), free, no login, leader pushes and followers are read-only, request-song wanted but not required, chat and voice memo to evaluate, Android 8765 leader protocol is dropped, Stage Cast 2 behavior must not change.

## 1. What exists today

| Area | Finding | Label |
|---|---|---|
| Band Sync client | `bandSync.ts` (731 lines): `ws://<ip>:8765` client to an Android leader, plus `BroadcastChannel` for tabs of one browser. Message types SONG_SYNC, SCROLL_SYNC, AUTOSCROLL_SYNC, SETLIST_SYNC, HEARTBEAT. Android is frozen, so no leader exists | CODE_OBSERVED |
| Core coupling | `App.tsx` subscribes to `bandSync.onMessage` and calls `bandSync.broadcastSetlist` directly; Band Sync is core code, not an extension | CODE_OBSERVED |
| Extension host | `web/src/extensions/{contract,host,registry}` exists with one consumer (`propresenter-follower`). Event capabilities (`events:song`, `events:setlist`, `events:transpose`) are declared in the type but refused: "no events API until a consumer is approved" | CODE_OBSERVED |
| Cast2 hub shape | `StageCast2Hub` pairs exactly one controller with one receiver (it looks up a single receiver socket; the last connection per role replaces the older one). It cannot fan out to several followers | CODE_OBSERVED |
| Cast2 hub scope | One global Durable Object (`idFromName('stage-cast2-v1')`) for every session; 32 live sessions; every request is serialized through one queue and the whole DB is written to storage after each operation | CODE_OBSERVED |
| Cast2 pairing | Six-digit PIN, 120 s pairing window, 5 guesses then revoke, one-time 15 s socket ticket, 10 min idle and 90 min max session life, per-IP and global request buckets, anonymous allowed (sign-in optional since #453 N1) | CODE_OBSERVED |
| Cast2 controller lease | A controller socket stays authorized only while authenticated HTTP keeps renewing a 30 s lease, so the leader must keep calling HTTP besides the socket | CODE_OBSERVED |
| Cast2 snapshots | Memory only. After eviction the hub marks PAIRED sessions DISCONNECTED and asks the controller for a fresh snapshot (`RESYNC_REQUIRED`). Every update carries a full projected chart (limit 256 KiB per message) | CODE_OBSERVED |
| Cast2 sockets | Standard `server.accept()`, not the Hibernation API | CODE_OBSERVED |
| Cast2 deploy | Separate worker `gtar-stage-cast2-dev` (SQLite DO class `StageCast2Hub`, D1 `gtar-db-dev` for optional sign-in), gated by `CAST2_MODE=reviewed-v1`, origin `https://dev.gtar-web.pages.dev`. Pages preview env has a DO binding to it. Only a Vite dev proxy for `/cast2-api` is visible in the repo | CODE_OBSERVED |
| Cast2 routing | Same origin. The browser calls `/cast2-api/*` and opens `wss://<same origin>/cast2-api/socket`. A Pages Function (`web/functions/cast2-api/[[path]].ts`) runs the Cast2 router and reaches the Durable Object through a binding `CAST2_HUB` (`script_name: gtar-stage-cast2-dev`) declared in the Pages preview env in `web/wrangler.jsonc`. The DO class itself lives in the separate worker, which must be deployed first | CODE_OBSERVED |
| CSP | `connect-src` already contains `'self'`, `ws:` and `wss:` (`web/public/_headers`), so a same-origin or a `wss:` connection needs no new CSP entry | CODE_OBSERVED |
| Free plan | Workers Free can create SQLite-backed Durable Objects. Free limits: 100,000 requests/day and 13,000 GB-s/day, reset 00:00 UTC; past a limit the operation fails. Incoming WebSocket messages count 1 request per 20; outgoing messages are free. A standard `accept()` socket is billed for duration the whole time it is connected; the Hibernation API avoids that while idle | DOC_CF |

## 2. Protocol (transport-agnostic)

Messages (all JSON, versioned, validated with the same allowlist style as `stageCast2Protocol.ts`; strings are display text, never HTML):

| Message | Direction | Content |
|---|---|---|
| STATE | leader to followers | small and frequent: `songId`, `contentHash`, `displayTitle`, `transposeOffset`, `effectiveKey`, `chordsVisible`, `setlist {id, index, count}`, `lineIndex`, `scrollFraction`, `autoscroll {on, speed}`, `notation` |
| CONTENT | leader to followers | the projected chart for one song, sent on song change or when a follower asks (`NEED_CONTENT(contentHash)`); same limits as Cast2 (128 Ki chars source, 2048 lines) |
| REQUEST_SONG | follower to leader (P2) | `{title, artist?, songId?}`; a suggestion, the leader accepts or ignores |
| CHAT | any to all (P2) | short text, capped |
| VOICE_MEMO | any to all (P3) | chunked audio, hard cap about 30 s |
| HELLO / SNAPSHOT / BYE | both | join, full state on every (re)connect, leader ended room |

Rules (PROPOSED, reused from Cast2): positive safe-integer `sequence` per room stream; `STATE` replaces state atomically; gap or reconnect requires a full snapshot; revocation clears content; no wraparound.

Key semantics (follows AGENTS Domain Terms): the protocol carries `transposeOffset` and `effectiveKey`; it never carries or rewrites ORIGINAL_KEY or `{original_key}`. A follower applies the leader's TRANSPOSE_OFFSET as a **session overlay** and restores its own saved PERFORMANCE_KEY when it leaves the room. Followers never write the leader's key into their saved songs.

Why STATE and CONTENT are separate: Cast2 sends the whole projected chart on every update. Band Sync sends a few hundred bytes for scroll and key changes, and a chart only when the song changes and the follower lacks that `contentHash`. A follower that has the same chart in its library uses it; otherwise it shows the leader's chart read-only and transient (not saved unless the owner approves "Save to my songbook", decision B3).

## 3. Pairing

PROPOSED: no login. The leader creates a room and gets a short join code plus QR (`stageCast2Qr.ts` can be reused). The code is single-room, short-lived, and rate limited (per IP, plus a per-room lock after 5 bad join attempts). Followers get a one-time socket ticket like Cast2. The leader holds a separate leader credential, so a follower can never become leader. UNVERIFIED: exact code length. Eight characters from a 32-letter alphabet (40 bits) with the limits above is the starting point.

## 4. Transports

**A. Cloudflare room (default).** One Durable Object per room (`idFromName(roomId)`), not one global object. State is in memory plus a small stored room record; it expires. No R2, no D1, no login service.

**B. LAN WebRTC (best effort, P4).** QR or copy-paste signaling, small mesh for three to eight devices. Must degrade to A when it fails. Needs a per-device test first (mDNS candidates, hotspot isolation).

**Same device tabs.** Keep `BroadcastChannel`; zero configuration.

## 5. RnD answers

**Q1. Reuse the Cast2 hub, or a separate hub?**
Recommendation: a new `BandSyncHub` class in its **own worker** (`gtar-band-sync-dev`, own wrangler file), copying only the pure helpers that Cast2 already exports (`digest`, `securePin`, `Denial`, `reply`, `body`) and the reducer idea.

| Option | For | Against |
|---|---|---|
| A. Extend `StageCast2Hub` to many receivers | Least new code | Changes Cast2 behavior and its 1:1 invariants; global single object; violates the owner constraint |
| B. New class in the same worker | One deploy | Shares the entry router, `CAST2_MODE` gate and deploy blast radius with Cast2 |
| C. New class in a separate worker (recommended) | Cast2 untouched; no D1 binding needed because there is no sign-in; separate kill switch | One more wrangler config and one more owner deploy step |

**Q2. Room lifecycle and limits (PROPOSED, to tune in DEV).**
Idle expiry 30 min, absolute life 6 h (rehearsal plus service). Leader socket gone: followers keep the last state and show "Leader offline"; the leader rejoins with its credential and pushes a snapshot. Followers per room: 12 (the stated user base is 5 Android and 3 iPhone/iPad). Per-socket cap 30 messages/s; the leader coalesces scroll to at most 4 STATE/s. Heartbeat 45 s. Hard cap on live rooms to stay inside the free plan. If a free limit is hit, sync fails closed and GTAR keeps working locally.

Budget estimate (arithmetic on DOC_CF numbers, not measured): a 3 h room is 10,800 s. With a standard socket at 128 MB that is about 1,350 GB-s against 13,000 GB-s/day. A leader sending 4 STATE/s is 43,200 incoming messages, about 2,160 billed requests against 100,000/day. One service fits easily; many parallel rooms should still use the Hibernation API (decision B4), which Cast2 does not use.

**Q3. Mapping to what Stage already projects.**
`projectCast2Presentation` (`stageCast2Projection.ts`) already builds an allowlisted, already-transposed chart from `StageCastState`. Reuse it unchanged for the CONTENT message so there is one chart serialization. STATE is new and tiny. No second chart format.

**Q4. Device matrix test plan (all UNTESTED).**
Devices: 3 iPhone/iPad (Safari), 5 Android (Chrome). Networks: church Wi-Fi and mobile data. Cases: join by QR and by code; leader changes song, key, setlist position, scroll, autoscroll; follower background for 60 s and screen lock, then return; Wi-Fi to mobile switch; leader reload; room expiry; 8 devices at once; follower missing the chart; offline follower. Record per case: pass or fail, device, browser version, network, and time from leader action to follower display (p50 and p95). Proposed pass line: p95 under 500 ms on the same network, and a returning follower shows the latest state within 5 s. iOS Safari suspends background sockets, so reconnect plus snapshot on `visibilitychange` is a requirement, not a nice-to-have.

**Q5. Chat and voice: same channel?**
Same room socket for text chat (small). Voice memo uses the same room but its own message class, size cap and rate limit, and STATE is never queued behind it. Microphone permission is requested only after an explicit tap. Whether voice ships inside `band-sync` or as its own extension is decided at P3 against #438 (`device:audio-in`).

## 6. Extension contract fit (#438)

Band Sync would be the **first consumer of core events**. It needs song, transpose, setlist and scroll state from Stage, and needs `net:https` for the room connection. Following the Cast2 pattern (same-origin `/bandsync-api/*` through a Pages Function), no new CSP host is needed. Options: (a) approve a minimal read-only events seam now, for this consumer, or (b) keep a thin core state publisher for P1 and move behind the events API later. Recommendation: (a), kept to the four read-only events already named in #438, no control hooks. Followers are read-only but they do change the local view, so "apply remote state" is a core call through the host, not an extension writing core state.

### Placement and visibility (OWNER 2026-11-15)

Band Sync is an optional extension and lives in Advanced Tools as a registry row (default OFF, I7). When it is OFF, every Band Sync entry point disappears, not only the row's contents. CODE_OBSERVED entry points today: the "Band Sync" button in the Stage toolbar (`StageView.tsx`, `onOpenBandSync`, which opens `StageToolsModal` through `App.tsx`) and the setlist push to Band Sync (`onPushSetlistToBandSync` in `Header.tsx`). With the extension OFF the Stage preview shows no Band Sync icon, no listener runs and no connection opens. Check before P1b: the modal opened by that button is named "Stage Tools & Band Sync"; confirm what else it holds so hiding the button does not hide unrelated Stage tools. Existing users who relied on the always-visible button must turn the extension ON once; the row says so.

## 7. P1 recommendation

Split P1 into two DRAFT PRs, both DEV only, both dormant until a flag is set:
1. `bandSyncProtocol` (types, validators, reducer, tests) and `BandSyncHub` worker with a fake-runtime test like Cast2's, no UI.
2. Client controller and extension row in Advanced Tools (leader/follower, QR and code, status, overlay key handling), replacing the 8765 path only behind the flag. Legacy code stays until P5. All Band Sync entry points (Stage toolbar button, setlist push) are shown only while the extension is ON and available.

Acceptance for P1: with the extension OFF there is no Band Sync icon in the Stage preview and no Band Sync listener or socket (test for I2); leader to follower sync of song, key/transpose, setlist position, scroll and autoscroll; reconnect snapshot; room expiry; follower cannot control; disabled extension has no side effects (I2); Cast2 tests unchanged.

## 8. Removal (P5, not before)

Android 8765 client, `detectLanIp`, recent-leaders list, the hardcoded sample IP in `BandSyncModal.tsx`, and their tests. Removal happens in the phase that replaces them.

## 9. Owner decisions

Owner answered 2026-11-15 in chat: B1 to B7 accepted as recommended. B8 clarified (see below, no change needed). B9 checked and answered from code. The worker-side deploy and the Pages binding still need explicit owner approval at implementation time.

| ID | Question | Recommendation |
|---|---|---|
| B1 | Separate worker (C) or same worker (B) | C |
| B2 | Approve the read-only events seam for Band Sync | Yes, four events only |
| B3 | Follower without the chart: transient read-only view, or also allow save | Transient first; save later |
| B4 | Use the Hibernation API | Yes |
| B5 | Anonymous rooms only (code and QR), no login | Yes |
| B6 | Starting limits in section 5 Q2 | Accept, tune in DEV |
| B7 | P1 as two DRAFT PRs | Yes |
| B8 | CSP `connect-src` change for the worker host | Not needed: `ws:`/`wss:` and `'self'` are already allowed, and B9 keeps the connection same-origin |
| B9 | How the browser reaches the worker | Same origin, like Cast2: a Pages Function `/bandsync-api/[[path]]` plus a `BANDSYNC_HUB` DO binding in the Pages preview env. No direct worker URL |

## 10. Still unverified before P1 code

Whether WebSocket upgrades through the Pages Function behave on the church network and on iOS Safari (Cast2 uses the same path, but no field result is recorded here); the join code length; iOS Safari background behavior; current free-plan numbers on the account dashboard; whether the church network blocks WebSockets.
