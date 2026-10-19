# Stage Cast 2.0 P1 backend foundation

Status: isolated, feature disabled, local only. Production HOLD. No Pages route,
application import, AuthGate change, Wrangler binding, infrastructure migration,
D1 migration, dependency change or deployment is included. P0 remains unchanged.

## Trust boundaries

`workers/stageCast2Worker.ts` is a proposed separate Worker entrypoint. Every
controller claim and controller HTTP action uses the existing
`authenticateUserRequest`: verified GTAR session/Google identity, authoritative
D1 session revocation and active-account checks. Authentication errors fail
closed. Authentication is never accepted from JSON, URL, or internal headers
supplied by a caller. The Worker constructs new internal headers and never
forwards GTAR bearer tokens, cookies or Google tokens to the hub/TV.

The external Worker alone can reach the private `StageCast2Hub` DO through a
binding. The hub trusts only that binding's injected owner and client digest;
it must never have a public route or be exposed via an unauthenticated proxy.
All session mutation, quotas, ticket consumption and sequence assignment run in
one serialized queue. Metadata commits finish before responses and frame delivery.
Storage failure closes sockets and poisons the instance until recreation.

All requests require an exact configured HTTPS Origin (same-origin routing is
proposed), no query string, and Cloudflare-supplied CF-Connecting-IP. Origin is a
browser boundary, not user identity. External non-browser callers can forge an
Origin, but still need identity/scoped credentials. The IP header is trusted only
when injected by Cloudflare; a future proxy must preserve this boundary. No CORS
wildcard, public anonymous **control** endpoint, listing, or reference lookup
endpoint exists. Anonymous `/create` issues only a receiver's pairing challenge.
Knowledge of a reference or PIN never permits presentation/control.

The receiver credential is 256 random bits, scoped to one session/role, expiring
at its fixed session deadline. The controller credential is independently random
and additionally requires the same authenticated owner for HTTP actions. Only
credential hashes are durable. Open controller WebSockets have a bounded
authorization lease until the 10-minute session deadline; upstream account
revocation is rechecked on controller HTTP actions and reconnect ticket issuance,
not on every frame. Immediate upstream logout propagation is outside P1.
Either scoped party can revoke its own session; the receiver can never publish.

## Pairing lifecycle and API

Every HTTP operation except `/socket` is POST with an exact JSON field allowlist
and a 2048-byte streaming body limit. Responses are no-store with fixed error
codes, never input echoes. No secrets are emitted to logs. The public wrapper
rejects query strings. Receiver credentials, PINs and controller credentials
travel only in HTTPS request/response bodies, not URLs.

1. TV POST `/create` `{}` returns `ref`, `pin`, `receiverCredential`,
   `pairingExpiresAt`, `expiresAt`. The TV must keep its credential private.
   QR payload is **only the opaque `ref`**, consumed by a future controller
   scanner; no URL, PIN, credentials, OAuth tokens or owner data go into QR.
   This phase supplies the reference contract, not a QR renderer or pairing UI.
2. Authenticated controller POST `/claim` `{ref,pin}`. A correct six-digit PIN
   and reference reserve the single controller slot, returning `sessionId`,
   `requestId`, `controllerCredential`, `expiresAt`. Cryptographic random PIN
   generation uses rejection sampling and preserves leading zeros. Reference
   and PIN expire after 120 seconds; claiming immediately consumes them.
3. Scoped POST `/status` `{ref,role,credential}` returns state/requestId and
   cursors. Controller requests additionally carry normal GTAR Authorization.
4. TV alone POST `/decide` `{ref,role:"receiver",credential,requestId,approve}`.
   Only the current request can be approved, once, before pairing expiry.
   Decline permanently revokes this session; approval enables transport.
5. Scoped POST `/ticket` `{ref,role,credential}` returns a random 15-second,
   one-use connection ticket. Issuing a ticket invalidates the previous unused
   ticket for that role. Controller identity is reverified before issuance.
6. Browser `new WebSocket(sameOriginSocketUrl, ["cast2", "ticket." + ticket])`.
   `/socket` is a GET upgrade without query parameters. Only `cast2` is echoed
   as the selected protocol; the ticket never appears in a URL. Future gateway
   logging must redact Authorization, request/response bodies and
   Sec-WebSocket-Protocol. TLS and secure browser storage are prerequisites.
7. Scoped POST `/revoke` `{ref,role,credential}` closes both sockets and removes
   credential hashes, outstanding tickets and memory-only presentation.

Legal transitions (every other pair rejects deterministically):

| From | To |
| --- | --- |
| CREATED | WAITING_FOR_CONTROLLER |
| WAITING_FOR_CONTROLLER | AWAITING_TV_APPROVAL, EXPIRED, REVOKED |
| AWAITING_TV_APPROVAL | PAIRED, EXPIRED, REVOKED |
| PAIRED | DISCONNECTED, EXPIRED, REVOKED |
| DISCONNECTED | PAIRED, EXPIRED, REVOKED |
| EXPIRED, REVOKED | none |

CREATED is transient during atomic creation. DISCONNECTED returns to PAIRED
when both roles reconnect. Session expiry is absolute, 10 minutes from creation;
there is no extension or reusable pairing. Terminal tombstones remain until the
session deadline, then absence denies identically. Missing/wrong/replayed claim
proofs and unknown references use the same generic denial. Five attempted PIN
checks are allowed; a further attempt revokes even with the correct PIN. Guess
counts and tickets survive eviction. PIN guessing can at most reserve/deny a
challenge; only the original receiver credential can approve it.

## Protocol and transport

P0 `validateCast2Message`, snapshot schema and receiver reducer remain the sole
presentation contract. Pairing HTTP operations supplement P0: its offline
PAIRING_APPROVAL direction describes controller approval and **cannot** stand
in for the required TV approval here. Pairing P0 frames are therefore rejected
on sockets rather than reinterpreted. No second presentation protocol is added.

The socket determines role/session; client envelope labels confer no authority.
Only controller PRESENTATION_SNAPSHOT/UPDATE and receiver SYNC_ACK/SYNC_ERROR
are accepted. Receiver errors are restricted to RESYNC_REQUIRED; future ACKs
reject. Both inbound/outbound envelopes enforce P0 version, direction, fields,
UTF-8 size, snapshot and sequence limits. Binary/malformed/oversized frames,
cross-session attempts and replay close only the offending socket.

Inbound counters are strictly increasing per role and durable across reconnect;
timestamps never authorize or order messages. `/status` exposes `inboundSequence`
and the last server receiver-stream `sequence`. A controller uses a sequence
greater than both cursors; UPDATE baseSequence must equal the current server
cursor. It may always send a full snapshot instead. The server assigns its own
monotonic receiver sequence and UPDATE base, never copies the client counter.
For receiver reconnect/resync, it emits one fresh full snapshot with a newer
sequence. There is no replay queue. Receiver SYNC_ACK references an emitted
server sequence; it cannot drive content or sequence assignment.

Only one socket per role is retained; a new valid ticket replaces the old socket.
Reconnect preserves inbound cursors and ownership. DO eviction loses presentation
memory, retains sequences and transitions PAIRED to DISCONNECTED. The controller
receives P0 RESYNC_REQUIRED and must publish a fresh snapshot. Standard WebSocket
accept/listeners are used (no hibernation assumptions). Clients send text `ping`
at least every 30 seconds and receive JSON string `"pong"`; idle sockets close
at 45 seconds, checked on events and 15-second alarms. Session expiry is checked
before every operation/frame and by alarms, even without traffic. Revocation
uses the shared P0 receiver sequence and clears the P0 reducer display.

Presentation snapshots exist only in DO memory, one bounded snapshot per session;
complete songbooks and presentation content are never written to D1 or DO storage.
Durable hub metadata contains owner IDs, reference IDs, credential/ticket/PIN
hashes, deadlines, state, cursors, and bounded request counters. No raw IP is stored.

## Capacity and proposed infrastructure (approval required)

The smallest foundation uses one private hub (`stage-cast2-v1`), at most 32 live
or uncollected terminal sessions, 64 sockets, 64 tickets and 512 quota buckets.
Admission is globally 120 requests/minute, per client 40/minute, TV creation
5/minute/client, controller claims 10/minute/owner, plus the five-attempt PIN
budget. Quotas persist through eviction. Socket traffic is bounded to 30 frames
per second/socket, including heartbeat/resync. One frame can contain at most
256 KiB; snapshots are bounded by P0. Capacity exhaustion fails closed. These
conservative global caps can cause intentional denial of service under load;
sharding and upstream account/IP abuse control need review before rollout.

Proposed, **not configured or executed**: separate Worker exporting StageCast2Hub,
private CAST2_HUB namespace binding with a reviewed new SQLite DO class migration,
compatibility date and nodejs_compat for existing authCore, existing auth DB/secret
bindings for identity verification only, exact CAST2_ORIGIN, same-origin route
design, and CAST2_MODE=reviewed-v1 after human infrastructure approval. Missing
mode/binding/origin returns DISABLED. No D1 schema migration is needed. Never
enable remote resources to run tests. Production remains HOLD independently of
local readiness. UI/scanner integration, storage policy, operational logging,
capacity and upstream revocation latency must be reviewed before activation.

Cloudflare API references: [WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[state/storage coordination](https://developers.cloudflare.com/durable-objects/api/state/),
[local tests](https://developers.cloudflare.com/workers/testing/miniflare/writing-tests/).

## Local verification

From repository root:

```powershell
node --test web/tests/stageCast2Backend.test.cjs web/tests/stageCast2Runtime.test.cjs web/tests/stageCast2.test.cjs
npm test --prefix web
npm run --prefix web lint:sync
npm run --prefix web build
python -B -m unittest discover -s tests -v
```

Additional checks from `web/`: `npx eslint workers/stageCast2Backend.ts
workers/stageCast2Worker.ts --max-warnings 0` and `npx tsc --ignoreConfig --noEmit
--target es2023 --module esnext --moduleResolution bundler --skipLibCheck
--allowImportingTsExtensions --types node workers/stageCast2Worker.ts`.

Backend tests use injected clocks, storage and sockets. The runtime test bundles
the real entrypoint and DO into in-memory Miniflare/workerd with test-only auth
injection; it exercises real 101 upgrades, delivery, reconnect and revocation.
It uses already locked Wrangler transitive esbuild/Miniflare packages, including
the installed Miniflare v5 legacy-options converter. No dependency edits or live
Cloudflare resources/credentials are required. Existing cast/auth/projection and
songbook regression tests remain in the full web suite.
