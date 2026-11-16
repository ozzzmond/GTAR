# Band Sync P1a

**Not deployed.** Separate dormant worker; checked-in mode is `disabled`.
Only `reviewed-v1` enables requests. No UI, Pages Function, Pages binding, account
service, database binding, or deployment is included.

## Trust boundaries

The gateway requires an exact HTTPS origin from `BANDSYNC_ORIGIN`, rejects cookies
and query strings, and constructs fresh internal headers. Caller authorization,
cookies, internal headers and raw IP addresses never reach a room. Directory
admission and failed-attempt budgets use a SHA-256 IP digest. Room codes grant follower access; a separate
256-bit leader credential grants control. Only its SHA-256 hash is stored.
One-use 256-bit tickets expire after 15 seconds and travel in
`Sec-WebSocket-Protocol: bandsync, ticket.<64hex>`; only `bandsync` is selected.
The directory resolves a ticket hash to a room, then that room consumes the ticket.
Room identity is `idFromName(roomCode)`; admission uses `idFromName('directory')`.

Sockets use the Hibernation API, including persistent role/rate attachments and
ping/pong auto-response (client sends `ping` every 45 seconds). The room stores
one bounded record, including at most one projected chart and one pending STATE,
to restore an exact snapshot after hibernation. No chart survives room termination
or its expiry alarm. No chart is saved into a songbook. Alarms flush pending STATE
and enforce idle/absolute deadlines; heartbeat alone does not extend room life.
See the [Hibernation API](https://developers.cloudflare.com/durable-objects/api/state/).

## Wire messages

Every envelope has version=1, roomCode, positive safe sequence, timestamp, type,
direction and an exact allowlisted payload. Text is display text, never HTML.

| Message | Sender | Payload |
| --- | --- | --- |
| HELLO | leader/follower | role; requests current full snapshot |
| SNAPSHOT | server | complete state, content or null, leaderOnline |
| STATE | leader/server | atomic small state replacement |
| CONTENT | leader/server | contentHash + validated Cast2 ReceiverSnapshot |
| NEED_CONTENT | follower/server | contentHash; cache reply or request to leader |
| BYE | leader/follower | empty; leader ends room, follower leaves |
| SESSION_ENDED | server | LEADER_ENDED or EXPIRED (LOCKED remains a reserved wire value, never emitted) |
| ERROR | server | fixed protocol error code |

REQUEST_SONG, CHAT and VOICE_MEMO are unknown message types in P1.
STATE carries only `transposeOffset` and `effectiveKey` for key state; CONTENT
reuses the already-transposed Cast2 projection. No original/chart key metadata is
carried, derived or rewritten. P1b must restore a follower's saved PERFORMANCE_KEY
when removing the session overlay.

Server stream sequences advance only on room publications; targeted reconnect
snapshots use the current stream sequence. Incoming socket sequences are separate,
strictly increasing per socket. Initial/reconnect/gap requires SNAPSHOT. Ending is
terminal and clears content. A leader disconnect preserves the last chart and
publishes `leaderOnline=false`; valid leader reconnect replaces the prior leader.

## Limits

Eight symbols from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (40 bits); cryptographic
rejection sampling. Twelve followers, one leader. Failed joins, tickets and leader
credentials return 403 without changing the room, chart, expiry or live sockets;
they never lock or end a room. Directory admission reserves a client-local budget
before each hub call: 20 failures/minute, then 429 for that hashed IP only.
Concurrent in-flight attempts also count until settled; successful requests refund
their reservation once. Other clients retain independent budgets. Thirty messages/second/socket; STATE fan-out at most four
per second, latest pending state wins. STATE <=4 KiB encoded. CONTENT uses
CAST2_LIMITS: 256 KiB snapshot validation, 2048 lines, 8192 chars per line field;
the source projection's 128 Ki-char source cap remains a P1b publisher boundary.
Room idle deadline 30 minutes, absolute lifetime six hours. One room record is
bounded by the protocol frame cap (Cast2 bytes +4 KiB) plus small state/ticket
metadata; at most 32 outstanding tickets per room. No chart history is retained.
STATE numeric bounds: TRANSPOSE_OFFSET -11..11, lineIndex 0..2047,
scrollFraction 0..1, autoscroll speed 0..1000; setlist index is zero-based and
below count (empty setlist uses index=count=0).
Directory: 32 live-room reservations, at most two per hashed IP, five
creates/IP/minute, 512 create buckets and 512 failure buckets, 1024 short-lived
ticket routes. Internal `/release` removes the room reservation and its ticket
routes idempotently. The hub releases on leader end (HTTP or BYE) and on idle or
absolute expiry; the worker also releases after successful `/end`. Directory
six-hour leases independently reclaim reservations if a release call fails;
capacity fails closed until release or lease expiry. The live-room cap does not
reset with the per-minute create counter.

## P1b

Adds same-origin Pages transport/binding with owner approval, extension row and
flag, leader/follower UI, code/QR, reconnect/visibility handling, core read-only
events, transient follower overlay and device/network QA. No existing Band Sync
or Stage Cast 2 integration is changed here.


## Client (P1b)

Implemented, default OFF: Advanced Tools Band Sync row, memory-only room client,
song/transpose publication and read-only projected Stage overlay. The owner reports
the DEV worker is deployed; this PR does not deploy the client or change that worker.
While OFF there is no Band Sync subscription, channel, fetch or socket. The Stage
toolbar remains available as Stage Tools (Metronome and Guitar Tuner); turning ON
restores the Band Sync label/tab and enables the cloud panel in Advanced Tools.
The legacy LAN engine remains for P5, with setup/disposal gated by this extension.
Setlist push entry points are gated; cloud setlist/scroll/autoscroll, QR and reconnect
polish are P1c. Voice/chat/request-song remain later phases.

Leader credentials and tickets are memory-only, never logged or placed in URLs.
Every reconnect obtains a fresh one-use ticket; retries back off to 30 seconds.
Ping interval is 45 seconds. Gaps request HELLO/full SNAPSHOT; SESSION_ENDED is
terminal. Disable aborts fetches, closes sockets, cancels timers, clears the overlay
and drops credentials. The overlay renders an already-transposed chart once and
never writes library songs, saved PERFORMANCE_KEY, ORIGINAL_KEY or CHART_KEY.

The preview-only Pages service binding BANDSYNC_WORKER targets gtar-band-sync-dev.
**Owner approval:** this config change is proposed in the draft PR for approval by
merging. Production has no new binding. Without the binding, the Function returns
503 DISABLED. Only the /bandsync-api prefix changes; request headers/body and the
Upgrade response pass through the service binding.

**UNVERIFIED — needs live DEV check:** CF-Connecting-IP preservation, Origin
preservation, and the WebSocket upgrade through the Pages service binding.
Device/network reconnect and iOS background behavior also need live DEV checks.
Local fake-runtime/DOM checks are not evidence for these live transport properties.


## P1c

Implemented behind the same default-OFF extension: leader scroll/line anchor,
autoscroll and setlist position; follower scrolling/autoscroll and read-only
“Song N of M”; room-code-only QR links. This PR deploys nothing. A source gate
and client guard cap STATE at four per second. Line changes publish immediately
when a slot is free; during a burst the newest line/fraction uses the next slot
(within 250 ms). Position changes never resend CONTENT. The existing projection
hash changes only with chart/presentation content, not scroll or setlist position.

The follower normally uses scrollFraction; a line anchor corrects viewport/wrapping
divergence beyond one screen. Geometry is read once per STATE, not every animation
frame. Local autoscroll uses pixels/second clamped to 10–150, matching the effective
legacy Stage control handler. Offline, stop, leave and disable cancel animation.
Manual scrolling is allowed; the next leader STATE re-syncs without a prompt.
Only setlist id/index/count travels; names and song lists stay on the leader.

Ticket expiry belongs to the server, independent of phone clock. Failed socket
opens get a fresh ticket. HTTP 403/404 from join/ticket stops automatic retries
with “Room not found or ended”; Leave permits a new attempt. Network/5xx failures
keep bounded backoff. Error bodies are neither read nor displayed. Leader
credentials stay memory-only: reloading loses control and the room expires itself.
No credential recovery or sessionStorage is added.

A QR carries only {origin}/#bandsync=ROOMCODE. The parser requires same origin,
root path, no query/credentials and exactly one valid bandsync hash key. The host
scrubs that hash before activation; OFF discards it with no network activity and
ON joins once, including the React development setup/cleanup cycle. In-app camera
scan is skipped: TvQrScanner hardcodes the TV parser and TV/PIN prompts, so it
cannot be reused as-is without changing Cast2 behavior. Typed codes and opening
the QR link with a phone's native camera remain available.

Still NOT done: chat, voice memo, request-song, setlist content transfer, leader
credential recovery and legacy LAN removal (P5).

UNVERIFIED — needs live DEV check: scroll/autoscroll feel on real devices, QR scan
with a phone camera, iOS Safari WebSocket/background/reconnect behavior, and
CF-Connecting-IP/Origin plus WebSocket upgrade through the Pages service binding.
Local fake-clock/DOM checks do not mark these live properties PASS.


## P1d

The browser sends same-origin credentials so DEV Cloudflare Access can authorize
requests to /bandsync-api without redirecting a valid signed-in page to its login
site. The Pages Function then creates a transport-header allowlist: Cookie,
Authorization, Proxy-Authorization, every Cf-Access-* header and other unlisted
headers never reach the Band Sync worker. Cookie stripping is verified by tests
for HTTP and WebSocket Upgrade requests. The worker's Cookie rejection remains
unchanged as defense in depth.

Create/join/ticket failures show fixed plain Status text based only on HTTP status
or a network/redirect marker. Error bodies and headers are not read or logged;
network and Access redirect failures use the network-or-sign-in message. Existing
retry/terminal behavior remains; successful connection clears a previous error.
The extension remains default OFF. No deployment or configuration change is made.

UNVERIFIED — needs live DEV check: CF-Connecting-IP and Origin survival across the
service binding, WebSocket upgrade through it, and iOS Safari. Local sanitized
Request tests do not prove these live transport properties.

## Join input (P1e)

The room-code input ignores case, spaces and dashes (a pasted `abcd-efgh` becomes `ABCDEFGH`), asks mobile keyboards for capitals with autocorrect and spellcheck off, and Enter joins. "Join with code" is never greyed out: an invalid code shows "Enter the 8-character code" and makes no request.

## P1f: refresh keeps the room, follower full screen

- Session persistence: the room session (role, room code, savedAt, and the leader credential for the leader only) is kept in sessionStorage key `gtar_band_sync_session_v1`, per tab. Never localStorage, logs, URLs or QR. Max age 6 h (matches the room absolute limit).
- On load with Band Sync ON, `client.resume()` validates the saved session. The leader requests a new ticket with its credential; the follower rejoins by room code. Nothing is created. Invalid, malformed, old or credential-less data is dropped without any request.
- Cleared on end room, leave, 403/404 (room ended), SESSION_ENDED, dispose and when the extension is turned OFF. While OFF nothing is read or written.
- Closing the tab ends this tab's control; the room expires on its own.
- Follower view: Full screen toggle (fixed overlay plus Fullscreen API when available). View-only; Esc or the button exits. The same scroll viewport stays mounted so follow scroll keeps working.

## P1g: legacy LAN path removed, Stage Tools

- Removed the Android LAN (ws://...:8765) Band Sync path: `utils/bandSync.ts`, `bandSyncAddress.ts`, `bandSetlistImport.ts`, the HOST/CLIENT broadcast and receive code in StageView/App, setlist push, and the legacy "Band Sync" tab with its recent-leaders history.
- Stage preview toolbar button is always "Stage Tools" (Gauge icon, same as the Metronome tab). The modal is `StageToolsModal` with Metronome and Guitar Tuner only. Rooms are created and joined from Advanced Tools only.
- Not carried over (future work): setlist content transfer, chat, voice memo, request-song.


## Stage Tools split (#534, #535 shell)

- `StageToolsModal`, the "Stage Tools" toolbar button and the `onOpenBandSync` wiring are removed; the P1g notes above describe the earlier state. Band Sync never used that button: rooms are still created and joined from Advanced Tools only.
- Metronome and Tuner are separate Stage tools (`src/stageTools/registry.ts`), each with its own Advanced Tools switch (default OFF, saved on the device), toolbar button and compact panel.
