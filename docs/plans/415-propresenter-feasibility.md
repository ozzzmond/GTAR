# issue#415 / issue#438 — ProPresenter feasibility (2026-11-12)

ASSUMED (repository baseline): `origin/dev` @ `9006be465ee5a0a13d82701d6206d1a5a9b58d5f`, containing merged PR#497. Documentation only; no connector, framework, CSP or deployment change.

## Evidence labels

- **OWNER_TESTED**: only the E14 `curl.exe` observations supplied by the owner on 2026-11-12. Command-line evidence is not a browser test.
- **SPEC_STATED**: the supplied ProPresenter OpenAPI facts or explicitly linked browser/security specifications.
- **ASSUMED**: proposals, expectations, repository inspection, unverified items and owner decisions recorded as stated. An owner decision is a requirement, not test evidence. Unlabelled headings convey no evidence; each table row inherits its Evidence column.

## Verdict and gates

ASSUMED: Direct browser following remains gated on the carried-forward CSP blocking assumption, which has not been reverified on a phone. G2 is passed for two supplied origins via curl; Android browser feasibility and CSP approval remain pending. This document does not authorize implementation.

| Gate | Status | Evidence |
|------|--------|----------|
| G1 — GTAR CSP permits LAN HTTP fetch | BLOCKED in the previous feasibility assessment; carried-forward assumption, DEV browser verification required; decision pending owner approval | ASSUMED: inspected `connect-src`, not a deployed-browser retest |
| G2 — ProPresenter returns CORS headers | PASS for `https://gtar-web.pages.dev` and `https://dev.gtar-web.pages.dev` via curl only | OWNER_TESTED: observations below; not arbitrary origins or browser CORS enforcement |
| G3 — HTTPS Chromium to LAN HTTP | Conditional expectation under browser permission/mixed-content rules | SPEC_STATED: [Chrome guidance](https://developer.chrome.com/blog/local-network-access); ASSUMED: not device evidence |
| G4 — Android Chrome fetch + ReadableStream | UNTESTED | ASSUMED: owner plan below must establish this |
| G5 — iOS/iPadOS WebKit | Expected “not available on this device” for this extension | ASSUMED: owner direction based on documentation, not a device test or universal claim about future browsers |

## Owner evidence: E14, curl.exe, 2026-11-12

- OWNER_TESTED: `GET http://192.168.100.123:1025/v1/status/slide` with `Origin: https://gtar-web.pages.dev` returned 200, `access-control-allow-origin: https://gtar-web.pages.dev`, `vary: Origin`. `current`/`next` text, notes and UUID fields were empty; nothing was live then.
- OWNER_TESTED: `GET /v1/status/slide?chunked=true` with `Origin: https://dev.gtar-web.pages.dev` returned 200, `transfer-encoding: chunked`, `access-control-allow-origin: https://dev.gtar-web.pages.dev`, `vary: Origin`.
- ASSUMED: reflecting two distinct origins suggests origin-reflecting CORS; arbitrary origins were not tested. A per-PR DEV preview origin is also untested.
- OWNER_TESTED: the stream supplied current state immediately, then one chunk per slide change, including backward navigation. Last-slide `next` fields were empty. One final chunk repeated identical `current`/`next` UUIDs.
- OWNER_TESTED: chunks were pretty-printed multi-line JSON objects separated by a blank line, not newline-delimited JSON.
- SPEC_STATED (owner-supplied spec metadata): `/v1/doc/swagger.json` returned the JavaScript wrapper `var openapi_spec = {...}`; OpenAPI 3.0.2, API version 1.0, 152377 bytes. This API version does not identify the ProPresenter app version.
- ASSUMED (owner environment attribution): ProPresenter **7.13** comes from the owner's test environment, not the spec. No additional owner tests are implied by this revision; earlier headless/mock experiments are not counted as OWNER_TESTED.

## API scope and direct-device topology

ASSUMED (owner decision): Every GTAR device is a direct, read-only follower of ProPresenter. No GTAR device controls ProPresenter. No host or relay device; the host-relay idea is rejected.

| Allowed request | Standard response shape | Evidence |
|-----------------|-------------------------|----------|
| `GET /v1/status/slide`, optionally `?chunked=true` | `current` and `next`, each `{text, notes, uuid}` | SPEC_STATED: shape/stream parameter; ASSUMED: owner allowlist |
| `GET /v1/presentation/slide_index`, optionally `?chunked=true` | `{presentation:{index,presentation_id:{name,uuid}}}`, nullable | SPEC_STATED: shape/stream parameter; ASSUMED: owner allowlist |
| `GET /v1/presentation/active`, optionally `?chunked=true` | `{presentation:...}` | SPEC_STATED: shape/stream parameter; ASSUMED: owner allowlist |

ASSUMED (owner decision): No PUT, POST or DELETE; no other paths or query parameters in the connector allowlist. In particular, no `/v1/status/updates` in the MVP. Redirects must not broaden this boundary (proposed reject-redirect policy).

SPEC_STATED: Streaming GETs accept `?chunked=true`; each data update supplies the standard response shape. The spec warns of about 5–6 open browser connections per page. `POST /v1/status/updates` aggregates GET streams into `{url,data}` updates separated by CRLFCRLF. Its JSON array request body requires a CORS preflight; it is outside the GET-only allowlist. Counts: 180 GET, 15 PUT, 8 POST, 9 DELETE. No CORS text or authentication scheme is declared; that omission does not prove unrestricted browser access or absence of authentication in every installation.

## Streaming design, still unimplemented

ASSUMED (owner preference): Prefer streaming over the earlier 500 ms polling reference. Transport belongs entirely inside the extension, not the core event bus. Each enabled device connects directly; five Android followers imply independent streams to the same ProPresenter, not a shared relay. Server capacity for that audience is untested.

ASSUMED (proposal): Use `/v1/status/slide?chunked=true` as the primary current/next feed; open other allowlisted reads only for needed presentation identity/index. Keep one active request per endpoint per device; avoid unused streams and overlapping retries.

ASSUMED (required parser design from OWNER_TESTED format): Decode bytes incrementally, retain incomplete UTF-8/JSON across reads, and frame **complete top-level JSON objects**, tracking strings, escapes and nesting. Never parse per line or assume one network read equals one object. Blank lines are observed separators, not a substitute for JSON framing. Multiple objects may arrive in one read; an object may span reads. Bound the buffer and treat malformed/oversized input as a transport error.

ASSUMED (required dedupe from OWNER_TESTED repeat): Suppress consecutive identical `(current.uuid, next.uuid)` pairs, using a tuple rather than ambiguous string concatenation. Accept backward transitions and changes to either UUID. A→B→A must deliver all three transitions. Preserve the last pair over reconnect; do not drop an initial all-empty state merely because both UUIDs are empty. Same-UUID text edits are not established by owner evidence and remain a design limitation to investigate.

ASSUMED (failure/reconnect proposal, pending validation): On EOF, read rejection, malformed frame or network loss, abort/cancel the old reader, discard its partial object, keep the last display marked stale, and report offline. Retry with jittered exponential delays of 1, 2, 4, 8, 16, then at most 30 seconds; only one attempt at a time. Resume with the new stream's initial snapshot and retained dedupe pair. A quiet stream is normal while slides stay unchanged; silence alone must not trigger reconnect. Disable/dispose aborts readers, retries and polling; no continued requests.

ASSUMED (polling fallback proposal): If an otherwise readable allowlisted GET works but streaming repeatedly terminates or is unusable, offer explicit fallback to non-chunked GET every 500 ms while visible, only after the previous request settles, with a proposed 10-second request timeout. Stop the stream before polling; failures use the same bounded backoff. Pause fallback polling while hidden; on visibility return take a fresh snapshot and offer streaming retry. CORS, CSP, denied local-network permission and mixed-content errors cannot be bypassed by polling; stop automatic retries and explain the blocked connection. Browser fetch errors may be indistinguishable, so use DevTools evidence rather than guessing the cause. Exact retry thresholds, background stream policy and fallback UX remain design items.

## Platform split and options

ASSUMED (owner audience): 5 Android devices, 3 iPhone/iPad devices. Android-first; iOS/iPadOS (WebKit) is expected to show “not available on this device”. This is a documentation-based expectation, not a device test. Installed Android PWA behavior is also untested.

| Option | Revised disposition | Evidence |
|--------|---------------------|----------|
| O1 — E14 CORS check | DONE for the two supplied origins via curl; browser gate remains | OWNER_TESTED |
| O2 — CSP-approved direct HTTP GET | Leading path together with O3; narrower CSP candidates below, no approval yet | ASSUMED |
| O3 — Android-first availability split | Leading path with O2, pending owner approval and real Android test | ASSUMED: owner direction, not feasibility proof |
| O4 — LAN companion / WebSocket bridge | Demoted; host/relay conflicts with owner's rejected topology | ASSUMED: owner decision |
| O5 — HTTPS/WSS companion | Demoted; host/relay rejected; certificate/device setup would need a separate decision | ASSUMED |
| O6 — cloud relay | Demoted/rejected topology; no backend or Cloudflare work authorized | ASSUMED |
| O7 — separate LAN HTTP follower page | Demoted; separate origin/app experience, outside current direction | ASSUMED |
| O8 — defer this consumer | Contingency if browser gates fail; no automatic switch to another implementation | ASSUMED |

## CSP analysis only — decision pending owner approval

ASSUMED (repository inspection): The enforced header is `Content-Security-Policy`, with `connect-src 'self' https://accounts.google.com https://www.googleapis.com ws: wss:`. No explicit `http:` source is listed. The earlier assessment reported HTTP fetch blocked; it is not new OWNER_TESTED evidence.

ASSUMED (2026-11-12 DEV-preview candidate, owner-approved option 3, applied only in a draft PR for Android testing): `connect-src` additionally lists `http://*:1025/v1/status/slide`, `http://*:1025/v1/presentation/slide_index` and `http://*:1025/v1/presentation/active`. Every other directive and existing source is unchanged; no blanket `http:` is added. Whether `http://*:1025` matches an IP-literal LAN host remains UNVERIFIED until the owner's Android test. This candidate does not pass G1 by itself and must not reach PROD on the strength of this document.

| File/header | Role and approval impact | Evidence |
|-------------|--------------------------|----------|
| `web/public/_headers`, `/*` rule | Static page CSP and Permissions-Policy; copied to `web/dist/_headers` at build. This document header controls the proposed page fetch | ASSUMED: repository inspection |
| `web/functions/lib/securityHeaders.ts`, `STATIC_SECURITY_HEADERS` | Mirrors the static CSP; any authorized policy change must keep the definitions aligned | ASSUMED: repository inspection |
| `web/functions/_middleware.ts` → `applySecurityHeadersToResponse` / `API_SECURITY_HEADERS` | Adds API safety headers, not `STATIC_SECURITY_HEADERS` CSP; changing API headers alone would not relax the page policy | ASSUMED: repository inspection |
| `web/tests/g4BrowserSecurityHeadersCsp.test.cjs` | Checks source list and header parity; would need review with a separately authorized change | ASSUMED: repository inspection |
| `web/docs/deployment-handoff-g4-security-headers-csp.md` | Historical report-only handoff; current source files enforce CSP | ASSUMED: repository inspection |
| ProPresenter response `Access-Control-Allow-Origin`, `Vary: Origin` | Separate server-side CORS gate; not supplied by GTAR's headers | OWNER_TESTED: two curl responses only |

SPEC_STATED: [CSP3 source syntax and matching](https://www.w3.org/TR/CSP3/#framework-directive-source-list) provides scheme, host, optional port and path sources. There is no CIDR, IP range or private-network selector. Domain wildcards match names, not resolved network classifications. HTTP source matching also allows HTTPS upgrades. Query strings and HTTP methods are not expressible as this connector's allowlist. CSP3 does not promise arbitrary LAN-IP host matching. Its current scheme-matching algorithm also permits `ws` to match `http`; this conflicts with the earlier reported browser block. Neither G1 nor wildcard/IP behavior is settled for Android without B1; do not infer actual browser behavior from the draft alone.

ASSUMED (analysis): **Yes, HTTP access can be narrower than blanket `http:`**, for a known hostname and port/path. That does not solve arbitrary user-entered private IPs portably. Do not claim `http://192.168.*.*:1025`, CIDR notation, or a private-network keyword is valid. A fixed `http://192.168.100.123:1025` is not a portable standards-backed solution; a target-browser experiment would be needed even for that one address.

| Candidate proposal, none applied | Trade-off for all users, including extension OFF | Evidence |
|----------------------------------|------------------------------------------------|----------|
| Retain current CSP | Keeps existing policy; carried-forward direct-fetch block needs B1 verification | ASSUMED |
| Enumerate trusted hostnames with `:1025` and the three exact paths | Narrowest name-based approach, but needs controlled naming and per-site configuration. DNS does not guarantee private destination; hostname mixed-content/LNA behavior needs testing | ASSUMED |
| `http://*:1025` with each exact allowlisted path | Candidate reduces ports/paths, still covers public hosts and is not a private-IP guarantee. Wildcard/IP behavior needs Android verification; do not promise it works for E14 | ASSUMED |
| Blanket `http:` | Broadest HTTP allowance for any host/port/path, including public destinations. Browser CORS/LNA/mixed-content checks still apply; not a permission to read every target | ASSUMED |

ASSUMED (trade-offs): Header relaxation applies to every page receiving it regardless of toggle state, allowing more destinations if page script is compromised. Runtime GET/path validation limits a well-behaved extension, not other page script. A settings toggle cannot narrow the response header; a meta CSP cannot loosen an enforced header, and multiple policies intersect. A dedicated page with a separately approved policy could reduce exposure to the main app but changes architecture/hosting and is not authorized here. Port/path restrictions also trade configurable host/port flexibility for tighter policy; CSP is not a method or redirect security boundary.

ASSUMED (proposal): Evaluate a hostname/port/path policy if naming can be supported; otherwise request an explicit owner choice between broader HTTP permission and deferral. Validate any wildcard/IP candidate on Android before recommending it. If B1 shows the current policy already permits HTTP, no relaxation is needed; retain it and review its existing breadth separately. No CSP, Cloudflare, Permissions-Policy or deployment change is approved or applied by this task.

## Still untested

ASSUMED (unknowns, not claims of failure):

- Android Chrome `fetch` + `ReadableStream`, actual CORS enforcement and CSP behavior on a DEV preview; installed-PWA behavior.
- Real Local Network Access prompt, Allow/Deny, persistence and recovery; browser/OS-specific behavior.
- Browser object framing across arbitrary byte boundaries, duplicate suppression and backward-navigation rendering.
- Stream drop/reconnect, truncated JSON at EOF, fallback polling, background/resume and disable cleanup.
- Per-PR preview origin, arbitrary-origin reflection, browser preflight behavior if introduced later; other allowlisted endpoints' browser CORS.
- Church PC/network/firewall/isolation, simultaneous direct followers and capacity, iOS/iPadOS Safari.
- No spec authentication scheme is not an auth/security test. No ProPresenter WebSocket endpoint is established here.

## Owner Android DEV browser test plan (not executed)

ASSUMED (plan): Use an Android phone on the same Wi-Fi as E14, current stable Chrome in a normal tab first; record phone model, Android and Chrome versions, timestamp, network, ProPresenter 7.13, DEV URL/origin and preview head SHA. Use USB remote debugging from desktop Chrome (`chrome://inspect/#devices`) to inspect the phone's actual tab. No PROD testing. The ProPresenter operator changes slides locally; the diagnostic browser sends only GETs.

ASSUMED (prerequisite): This PR provides no connector or test harness. The raw transport steps below can run in remote DevTools. Parser/dedupe/retry acceptance steps require a later separately authorized diagnostic harness or connector; until present, record them as NOT RUN. Do not report manual reconnection as automatic-reconnect proof. First test the unchanged DEV policy: if it blocks, stop and record G1 until a separate owner-approved DEV policy exists; if it permits the request, record the discrepancy and continue with existing policy. Never disable browser security to obtain a pass.

| Case | Exact owner steps | Expected result / record | Evidence |
|------|-------------------|--------------------------|----------|
| B1 — current policy | Open the DEV preview on the phone; enable Preserve log in Console/Network; inspect the main document's CSP. From its console evaluate `fetch('http://192.168.100.123:1025/v1/status/slide?chunked=true')` | Earlier assessment predicts CSP rejection; verify rather than assume. Save exact directive/error if blocked. If readable, record that G1 differs from the prior assessment and continue without proposing an unnecessary relaxation | ASSUMED: plan/expectation |
| B2 — real permission | Only after B1 permits requests under existing or separately owner-approved DEV policy, reset this origin's site permissions, reload, initiate the same GET from DevTools, observe phone prompt. Deny once, record error; reset and repeat choosing Allow. If no prompt appears record site/OS permission state and exact result | Denied path reads no lyrics; allowed path still must pass CORS/CSP. Do not infer prompt success from curl or automatic permission grants | ASSUMED: plan/expectation |
| B3 — fetch + reader | In allowed run, assign the result to `response` using `await fetch('http://192.168.100.123:1025/v1/status/slide?chunked=true', {credentials:'omit'})`; inspect status and `response.body`; assign `reader = response.body.getReader()`. Repeatedly evaluate `await reader.read()` and incrementally decode each returned `value` with one persistent `TextDecoder` using stream mode. Do not await `response.json()` on a live stream | Status 200, readable body, first state promptly without a slide change, subsequent reads after changes; collect timing, bytes and current/next UUID pairs. Network panel should show ACAO matching the actual DEV origin and `Vary: Origin` | ASSUMED: plan/expectation |
| B4 — framing and transitions | Operator presents A, advances to B, navigates back to A, then to last slide. Keep reading; reconstruct each complete JSON object before parsing. In later parser harness, replay captured bytes split inside a JSON string, escape and multi-byte character; also join two complete objects into one input | No line-based parse failures, no dropped/coalesced states; backward transition delivered; final next fields empty. Raw-reader observation alone does not validate a future parser | ASSUMED: plan/expectation |
| B5 — dedupe | In later harness compare received-object count with delivered-state count. Replay a captured object twice, then one with changed next UUID, then A→B→A and an initial empty pair | Consecutive identical pair delivered once; changed next delivered; A→B→A all delivered; initial empty state delivered. Record raw and delivered tuples separately | ASSUMED: plan/expectation |
| B6 — drop/reconnect | While reading, turn phone Wi-Fi off for 10 seconds, restore same Wi-Fi; record EOF/rejection/timing. For raw probe cancel old reader and manually refetch. With later harness repeat; inspect retry timestamps, active requests and stale status; also drop mid-object and reconnect with same pair, then a changed slide | Raw probe establishes only new-stream readability. Harness must show one bounded retry chain, partial buffer discarded, fresh initial snapshot, correct dedupe and no duplicate readers. Quiet unchanged stream must remain connected | ASSUMED: plan/expectation |
| B7 — failure/fallback/cleanup | With later harness exercise unreachable host/port, streaming failure with working ordinary GET, permission denial, hidden/resumed tab and disable during retry; inspect requests and timers | No fallback for security blocks; fallback at most one GET per 500 ms and no overlap; bounded timeout/backoff; hidden polling stops, visible state refreshes; disable stops all activity | ASSUMED: plan/expectation |
| B8 — installed PWA / audience | Repeat B1–B7 in installed DEV PWA when available; later repeat on remaining Android devices and church network. Record iOS as expectation until separately tested | Separate results per environment; no extrapolation from one phone or curl | ASSUMED: plan/expectation |

ASSUMED (report template): For each case record NOT RUN / BLOCKED / PASS / FAIL, device/browser, origin/head SHA, action, expected vs actual, console error, response headers, timestamps and raw/delivered UUID pairs where applicable. Do not relabel these planned results OWNER_TESTED until the owner supplies actual evidence. CSP approval and device QA are still required before any implementation go decision.
