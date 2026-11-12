# issue#415 / issue#438 — Phase 1 platform feasibility (2026-11-12)

Baseline: `dev` @ 709ab99. Docs and evidence only. No Core, CSP, connector or framework change.

## Verdict

**ProPresenter direct browser path: BLOCKED as deployed. Phase 3 must not start.**

| # | Gate | State | Basis |
|---|------|-------|-------|
| G1 | GTAR's own CSP allows `fetch` to `http://<LAN-IP>:1025` | **BLOCKED** | Tested (T8) + repo |
| G2 | ProPresenter 7.13 answers with `Access-Control-Allow-Origin` | **UNKNOWN** | Not tested; no public documentation found |
| G3 | Chromium lets an HTTPS page reach LAN HTTP | PASS with user permission, IP literal only | Tested (T1–T7), desktop headless only |
| G4 | Android Chrome behaves like G3 | **UNVERIFIED** | Not tested on a device |
| G5 | iOS Safari lets an HTTPS page reach LAN HTTP | **EXPECTED BLOCKED** | Not tested; documentation only |

G1 alone blocks every browser. G2 decides whether any direct path exists at all. G5 means iPhone
cannot be assumed even if G1 and G2 are resolved.

## What was actually tested

Environment (one only):
- Browser: Chromium 153.0.8010.12, headless, Playwright 1.63.0.
- OS: Linux 6.18 x86_64 cloud container. Not a phone, not Windows, not the church or home network.
- Page origin: `https://localhost:8443`, trusted throwaway certificate, address space forced to
  `public` with `--ip-address-space-overrides` so the page behaves like deployed HTTPS GTAR.
- Target: **mock** HTTP server on `192.168.50.10` (RFC1918 alias on the container loopback),
  ports 1025 (no CORS headers) and 1026 (`Access-Control-Allow-Origin: *`), answering the three
  POC paths with placeholder JSON. **Not ProPresenter.** Response shapes are placeholders.
- Permission: granted with Playwright `grantPermissions(['local-network-access'])`. No real
  permission prompt was shown or clicked. Ungranted state reads `prompt`; headless resolves it as denied.

| T | Case | Result | Reached server |
|---|------|--------|----------------|
| T1 | No permission grant, IP literal, no CORS header | FAIL `Permission was denied for this request to access the local address space` | no |
| T2 | No permission grant, IP literal, `ACAO: *` | FAIL same as T1 | no |
| T3 | Permission granted, IP literal, no CORS header | FAIL `No 'Access-Control-Allow-Origin' header` | yes |
| T4 | Permission granted, IP literal, `ACAO: *`: `/v1/status/slide`, `/v1/presentation/active`, `/v1/presentation/slide_index` | **OK 200, body readable** (all three) | yes |
| T5 | Permission granted, `mode: 'no-cors'`, no CORS header | Opaque response, status 0, body unreadable | yes |
| T6 | Permission granted, hostname resolving to the private IP, `ACAO: *` | FAIL mixed content `request has been blocked` | no |
| T7 | T6 plus `fetch(..., { targetAddressSpace: 'local' })` | OK 200 | yes |
| T8 | T4 on a page carrying GTAR's current `connect-src` | FAIL `violates the following Content Security Policy directive: "connect-src 'self' https://accounts.google.com https://www.googleapis.com ws: wss:"` | no |
| T9 | `ws://` IP literal, permission granted, GTAR `connect-src` | WebSocket OPEN | yes |
| T10 | `ws://` IP literal, no permission grant | FAIL `net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` | no |

Also probed in the same browser: `navigator.requestMIDIAccess` present, `permissions.query({name:'midi'})`
= `prompt`; `navigator.bluetooth` absent (headless Linux; not meaningful for phones).

Read from the repo (not a browser test): the `connect-src` value used in T8 is the one in
`web/public/_headers` and `web/functions/lib/securityHeaders.ts` at 709ab99. It allows `ws:` and `wss:`
but no `http:` source.

## What the tests show

1. **GTAR's CSP blocks the request before the browser's network rules apply (T8).** The follower
   cannot work from deployed GTAR without a `connect-src` change. CSP cannot express "private IP
   ranges only"; the available forms are `http:` (any HTTP host) or a fixed host list, which does
   not fit a user-entered LAN IP.
2. **CORS is mandatory (T3, T5).** With permission granted the request reaches the server, but the
   page cannot read the body unless the server sends `Access-Control-Allow-Origin`. `no-cors` is not
   a workaround: lyrics are unreadable. The POC proved the endpoints from PowerShell and from the
   documentation page served by ProPresenter itself; neither is a cross-origin browser read.
3. **Chromium gates the request on a per-site Local Network Access permission (T1, T2, T10).**
   Without the grant nothing leaves the browser.
4. **Mixed content is exempted only when the browser knows the target is local before resolving it
   (T4, T6, T7):** a private IP literal, or an explicit `targetAddressSpace: 'local'`. A hostname
   such as `E14` fails unless the connector sets that option.
5. **`ws://` already passes GTAR's CSP and needs no CORS (T9),** but is under the same permission
   (T10). The verified POC endpoints are HTTP; no ProPresenter WebSocket endpoint was verified.

## Not tested — assumptions and documentation only

| Item | Expectation | Source | Confidence |
|------|-------------|--------|------------|
| ProPresenter 7.13 CORS headers | Unknown | None found | none |
| Android Chrome | Same Local Network Access model as desktop (reported shipping on Android from Chrome 142); prompt wording and persistence on phones unverified | Chromium intent threads, vendor notes | medium |
| Android Chrome installed PWA | Same as tab | Assumption | low |
| iOS Safari, and every iOS browser (all WebKit) | HTTPS page to `http://` LAN blocked as mixed content. A WebKit change aligning mixed content with the Local Network Access spec is reported merged to WebKit main (2026-09) behind a setting; no shipped Safari version confirmed | WebKit bug 279249, WebKit PR 72974, standards-positions issue 520 (no formal position) | medium |
| Church PC firewall and network isolation | Unknown; issue#415 already says not to assume the home root cause | issue#415 | none |
| Real permission prompt UX, denial recovery | Unknown | — | none |
| The three users' phones | Not tested | — | none |

## Web MIDI availability (evidence only, no implementation)

| Browser / OS | Web MIDI | Basis |
|--------------|----------|-------|
| Chromium 153 desktop (Linux headless) | API present, permission `prompt` | Tested here |
| Chrome / Edge desktop | Supported; whole API behind a permission prompt since Chrome 124 | Documentation |
| Chrome Android | Supported | Documentation (caniuse/MDN); not device-tested |
| Firefox desktop | Supported from 108, flagged partial | Documentation |
| Firefox Android | Not supported | Documentation |
| Safari macOS | Not supported natively | Documentation |
| iOS Safari and all iOS browsers | Not supported | Documentation |

Consequence for issue#438: a MIDI extension must report "not available on this device/browser" on
every iPhone. Secure context is required; GTAR is HTTPS so that part holds.

## Incidental observation (no action taken)

Band Sync connects to `ws://<LAN-IP>:8765` from the same HTTPS origin. T10 shows Chromium 153 blocks
`ws://` to a local address until the Local Network Access permission is granted. Whether shipped
Band Sync is affected on real phones was **not tested** and is out of scope here. Band Sync keeps its
current core behavior.

## Options (none applied; owner decides)

| Opt | What | Covers | Cost / risk |
|-----|------|--------|-------------|
| O1 | Owner runs one check on E14 to settle G2 (below) | Decides whether O2 is worth anything | Minutes, zero code |
| O2 | Add `http:` to `connect-src`, direct fetch | Chromium desktop + Android Chrome (if G2 and G4 pass). Not iOS | Weakens CSP for all users, including those with the extension off; header lives in two files and is a Cloudflare-served header (owner approval) |
| O3 | Support matrix: ship for Chromium only, report "not available on this device/browser" on iOS | Same as O2 | iPhone users excluded; needs O2 |
| O4 | LAN companion next to ProPresenter that re-serves the three GETs with CORS or over `ws://` | Chromium without a CSP change if `ws://` (T9); solves G2 | New component to install and maintain on the church PC; still not iOS (mixed content) |
| O5 | Companion with HTTPS/WSS | All browsers including iOS | Certificate for a LAN host: private CA installed on every phone, or public DNS name plus certificate. Highest setup cost |
| O6 | Cloud relay through GTAR backend | All browsers | New backend surface and data path; PROD/Cloudflare; contradicts "no cloud" for this module |
| O7 | Serve a follower page over plain HTTP from the LAN | All browsers | Not the installed PWA, no service worker, separate origin and storage |
| O8 | Park issue#415; prove the contract with a consumer that needs no LAN | — | ProPresenter value deferred |

Explicitly not done: no proxy, relay, TLS bypass, backend or CSP change was added.

### O1 — the one check that unblocks the decision

On any machine on the same network as E14, with ProPresenter running:

```bash
curl -i -H "Origin: https://example.com" http://<E14-IP>:1025/v1/status/slide
```

- Response contains `Access-Control-Allow-Origin` → G2 PASS; O2/O3 become possible for Chromium.
- No such header → G2 FAIL; direct fetch is dead in every browser; only O4–O8 remain.

Second check, only if G2 passes and the owner wants device evidence before any code: on the Android
phone, open DevTools remote or any HTTPS page console and run
`fetch('http://<E14-IP>:1025/v1/status/slide').then(r => r.text()).then(console.log, console.error)`;
record whether a "connect to devices on your local network" prompt appears and the result. The same
line on iPhone Safari records G5.

## Sources

- Chrome for Developers, "New permission prompt for Local Network Access" — https://developer.chrome.com/blog/local-network-access
- WICG Local Network Access — https://wicg.github.io/local-network-access/
- Chromium Intent to Ship: Local network access restrictions — https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY
- WebKit bug 279249 (HTTPS page blocked loading local content) — https://bugs.webkit.org/show_bug.cgi?id=279249
- WebKit PR 72974, mixed content rules aligned with the LNA spec — https://github.com/WebKit/WebKit/pull/72974
- WebKit standards-positions issue 520 — https://github.com/WebKit/standards-positions/issues/520
- Web MIDI: https://caniuse.com/midi , https://developer.chrome.com/blog/web-midi-permission-prompt

## Appendix — harness outline

Throwaway script, not committed. Reproduce with Playwright Chromium:
1. HTTPS page server on `localhost:8443` (certificate trusted by the browser); `/csp` adds GTAR's `connect-src`.
2. Mock HTTP servers on a private-range address, one without and one with `Access-Control-Allow-Origin: *`,
   answering `/v1/presentation/active`, `/v1/presentation/slide_index`, `/v1/status/slide`; accept a WebSocket upgrade.
3. Launch args: `--ip-address-space-overrides=127.0.0.1:8443=public`,
   `--host-resolver-rules=MAP pp.test <private-ip>`.
4. Per case: fresh context, optional `grantPermissions(['local-network-access'])`, `fetch`/`WebSocket`
   from the page, record result, console messages and server hits.
