# Stage Cast 2.0 offline foundation

These modules are intentionally unconnected to the application. Existing Stage
Cast, routes, AuthGate and presentation UI continue using their current contracts.
No credentials, clocks, IDs, sessions, network connections or persistence are
created. Version 1 describes the first wire contract for Stage Cast 2.0.

`stageCast2Protocol.ts` defines role-specific typed contracts and validates unknown
JSON strings or JSON objects. Callers must supply the expected direction from
their transport boundary. Exact field allowlists, safe integer sequences and
timestamps (Unix milliseconds), UTF-8 message size, depth, node and presentation
limits reject unsupported data. Validation returns detached JSON data. Errors
are fixed codes, never input echoes. Strings are display text, never trusted HTML.
Future receivers must use the existing text renderer, never innerHTML.

`stageCast2Projection.ts` accepts the existing active StageCastState and explicit
position/visibility inputs. It uses parseGtarSong with the chart-relative offset,
exactly as the existing receiver does. The supplied effectiveKey remains the
controller's existing transposeContext result, including numbers notation's key.
Projected lines are already transposed and can use SongLineRenderer directly.
Lyrics-only projection replaces chord/tab rows with empty rows and inline chords
with lyrics, retaining line indexes. Position is a zero-based parsed line index;
scroll is a bounded pixel top plus normalized fraction. The eventual receiver
should prefer fraction when viewport sizes differ. No library or source entity
is spread into the wire snapshot. Content intentionally selected for display
(title, lyrics, section labels, visible chords/tabs) remains display content;
this module cannot identify secrets manually written inside those text fields.

`stageCast2Sync.ts` is a pure receiver reducer, not session authorization. The
caller supplies the expected session identity. Initial load, reconnect and update
gaps require a full snapshot with sequence strictly greater than the retained
cursor. Old display data may be retained while awaiting resync. Updates contain
an atomic replacement snapshot plus baseSequence; they apply only when base is
the current cursor and sequence is cursor + 1. Duplicate/stale messages reject.
Gaps mark resync required without applying content. Snapshots may jump sequences.
Server revocation clears content and makes this reducer state terminal.
Malformed, wrong-session and wrong-direction messages never change state.

Sequence numbers are positive safe integers, monotonic per session and directed
stream. Receiver-bound presentation snapshots, updates and revocation share a
single server-assigned sequence stream; pairing/control messages have independent
streams and are not applied by the presentation reducer. Future server relaying
must assign receiver-stream sequence/baseSequence rather than blindly copying
controller counters. A reconnect requires the server to issue a fresh snapshot
with a new sequence even if content is unchanged. Exhaustion requires a new
server-authorized session, never wraparound. Timestamps are metadata, not ordering
or expiry authority. Ack references an applied receiver-stream sequence. Sync
errors can request resync; these modules emit no network requests or acks.

Pairing requestId and provisional sessionId are correlation labels, not secrets
or authorization. No QR/PIN credential is generated or accepted in this phase.
Future QR and six-digit PIN proofs must be short-lived, single-use server-checked
pairing inputs, never reusable presentation credentials. Authentication, ownership,
approval, expiry, replay protection across sessions, rate limits and enforcing
one controller/receiver/session belong to the future server. An apparently valid
SESSION_ESTABLISHED or direction field does not prove any of those properties.
Durable Objects, WebSockets, pairing UI and deployment remain outside P0.

Limits: 256 KiB encoded messages/snapshots, 128 Ki characters of source chart,
2048 lines, 8192 characters per line text, 1024 chord segments/tokens per line,
256 characters for titles, 128 for IDs, offsets -11 through 11, scroll fraction
0 through 1 and pixel top up to 10,000,000. Oversize input rejects rather than
silently truncating songs. Snapshot envelopes also count toward message limits.
