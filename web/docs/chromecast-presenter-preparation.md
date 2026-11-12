# Chromecast presenter preparation (#425)

This is configuration-gated DEV preparation, not a verified Chromecast integration.
No GTAR Cast App ID exists in this change. No registration, purchase, deployment,
production configuration, receiver publication or device registration was performed.

## Owner evidence

Owner reported Techlife 12 Pro with Android Chrome and a Realme Android TV with
Chromecast. Chrome's Presentation API sample launched a registered receiver that
displayed Hello World independently while the controller browser remained usable.
No screen mirroring was used. The sample App ID EF1A139F belongs to Google's sample;
it is explicitly rejected by GTAR configuration. This establishes hardware feasibility,
not GTAR sender SDK, receiver, CSP or synchronization acceptance.

## Owner prerequisite and DEV setup

1. Decide whether to authorize the USD 5 Cast developer registration. The agent
   has no authorization to pay or register. Confirm the current fee in the console.
2. Once authorized, register a GTAR **Custom Web Receiver**, with an HTTPS URL
   on the owner-selected DEV/preview origin: `/cast-receiver.html`. Register the
   Realme TV as a test device for the unpublished receiver. Publishing is unnecessary
   for this test and is outside this task.
3. Supply the resulting GTAR App ID as public build configuration
   `VITE_CHROMECAST_APP_ID`. Build only DEV (`--mode debug`, or the existing DEV
   build environment); existing Cast2 must also be enabled. Preview builds can use
   `VITE_STAGE_CAST2=true` under the existing DEV gate. Keep the App ID unset in PROD.
4. Owner deploys the preview. The registered receiver URL and controller must use
   the **same HTTPS origin**. Its existing Cast2 worker must accept that exact origin
   in `CAST2_ORIGIN`, with the existing reviewed-v1 mode and service binding. No new
   backend, credentials, D1 migration or authorization bypass is required.
5. Open Android Chrome with both devices on the same Wi-Fi. In TV Cast, choose
   Google Chromecast. The SDK picker launches GTAR's receiver. Close the TV Cast
   modal to continue controlling songs. Disconnect Chromecast stops the receiver
   and revokes its Cast2 pairing; Connect Chromecast then creates a fresh pairing.

An absent/invalid App ID, Google's sample ID or disabled Cast2 leaves Chromecast
dormant: no SDK fetch, picker or built receiver entry. The sender additionally
requires a secure context, Android Chrome platform restrictions, PresentationRequest
capability and successful SDK initialization. No-device/SDK failure leaves Browser /
QR pairing available. User-agent matching alone never enables the transport.

## Architecture and security

```text
TV Cast modal -> official Web Sender SDK -> registered GTAR Custom Web Receiver
                       HELLO nonce -> receiver
                       <- one-time ref + PIN + expiry (targeted sender only)
controller -> existing Cast2 /claim -> role credential -> one-use socket ticket
controller -> Cast2 WebSocket authority -> existing receiver renderer
```

`stageCast.ts` already has platform/capability detection, popup/HDMI projection and
Presentation API handling. That legacy direct path uses its own presentation
connection and serialized stage state. Chromecast reuses its capability utility
and stop lifecycle, but does not send that state over Cast or use its protected
`/stage/present` page. Browser/QR `/tv` remains unchanged.

`cast-receiver.html` has a separate receiver-only entry with the existing Cast2
panel: no AuthGate, controller app, OAuth bootstrap or service-worker registration.
It may create a receiver pairing anonymously, exactly like `/tv`; this grants no
controller/account API access. HTTP calls omit credentials and reject redirects.
The socket obtains the existing single-use 15-second ticket through receiver-role
authorization. Only the existing Cast2 server validates credentials and sequences.

Cast messages use one namespace and an exact, size-bounded handoff schema. A fresh
256-bit nonce binds each launch response; the sender consumes it before awaiting
HTTP. The receiver binds the first valid HELLO sender for that receiver lifetime
and replies only to that sender. Cast pairing assumes the user selected a trusted
TV on the local network; the nonce is correlation/replay protection, not account
authentication. The ref and PIN confer the same possession authority as the TV's
displayed QR/PIN and are never logged or placed in a URL. No OAuth, GTAR session
token, role credential, socket ticket, arbitrary URL or presentation snapshot is
sent over Cast. Server pairing expires after 120 seconds; the first successful
claim burns the PIN atomically and later claims fail. Existing account/anonymous
controller authorization, guessing limits, lease expiry and revocation remain in
force. Joining senders cannot replace the bound handoff sender.

On reconnect the Cast2 reducer still rejects stale/out-of-order messages and
requires a full snapshot. Chromecast opts into clearing its displayed snapshot
during reconnect; Browser/QR retains its existing last-confirmed display behavior.
Controller projection stays subscribed while the modal is closed or the socket is
offline; a new pairing republishes the current in-memory song. Cast2, not the Cast
channel, supplies the authoritative snapshot and subsequent song changes. SDK
session resumption with retained controller credentials uses that same Cast2
session. After losing the controller page's Cast ownership (for example a reload),
end the retained TV session and disconnect/reconnect Chromecast to pair afresh;
the TV does not need a reboot.

The source/global production CSP is untouched. Only configured DEV build artifacts
allow `https://www.gstatic.com` in script-src for the official sender SDK and its
framework. The dedicated receiver has its own restrictive HTML CSP and middleware
headers: receiver SDK path only, same-origin connections, no OAuth frames,
camera/clipboard disabled, no-referrer, no-store. Auth gates elsewhere stay intact.
Receiver runtime SDK requests and CSP compatibility still require hardware QA.

## Validation boundary and owner QA

Automated tests cover platform and configuration gates; SDK lifecycle with a test
double; exact handoff validation, sender binding and duplicate response rejection;
real Cast2 PIN replay/expiry; reconnect to a song changed offline; scoped receiver
headers; existing Cast2 UI, resilience and HDMI/Presentation routing.

Pending hardware acceptance: the GTAR SDK option and picker on Techlife 12 Pro;
registered receiver launch on Realme TV; independent lyrics with usable controller;
disconnect/reconnect without TV reboot; receiver and controller Wi-Fi loss followed
by multiple song changes; reload/re-pair recovery; sequence/full-snapshot recovery;
no CSP violations; and Browser/QR on Android, iOS, desktop plus HDMI regression.
No automated SDK double or existing sample run proves these hardware criteria.

## Primary references

- [Web Sender SDK integration](https://developers.google.com/cast/docs/web_sender/integrate)
- [Custom receiver and messaging](https://developers.google.com/cast/docs/web_receiver/core_features)
- [Receiver options](https://developers.google.com/cast/docs/reference/web_receiver/cast.framework.CastReceiverOptions)
- [Application and test-device registration](https://developers.google.com/cast/docs/registration)
