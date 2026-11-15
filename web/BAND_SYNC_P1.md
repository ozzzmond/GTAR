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
