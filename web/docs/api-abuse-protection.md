# API abuse protection (G2)

Distributed enforcement is **dormant**, not active in any deployed environment.
This change does not add bindings, variables, migrations, WAF rules, credentials,
or infrastructure. Existing authentication, approval checks, QR process-local
30/minute guard, request bounds, and Sync CAS remain in place. The legacy QR map
is only a best-effort guard, not an authoritative distributed security boundary.
Its 429 now includes Retry-After and consistent JSON/CORS/cache semantics.

## Audit and cost boundaries

| Surface | Existing guard | Optional distributed guard / remaining gap |
| --- | --- | --- |
| QR create | Active D1 account, 1 MiB streaming bound, payload validation, local 30/minute | 30/minute/account before body and INSERT |
| QR retrieval | Active D1 account, token format, expiry and payload validation | 120/minute/account before shared-setlist SELECT |
| Session issue | Secret and DB checks, 16 KiB streaming bound, verified Google identity | 300/minute shared anonymous admission before body/JWKS; 20/minute/verified Google subject before profile writes/token issuance |
| Session retrieval | Signed session or verified Google token, current D1 user and subject binding | 600/minute shared anonymous admission before token verification/D1 lookup |
| Cloud Sync | Active D1 account, 2 MiB streaming bound, required CAS version/checksum | 120 reads and 60 writes/minute/account; rejection before Songbook storage work |
| Metadata / Workers AI | Active D1 account, 64 KiB bound, validated fields, model validation, 300 output tokens | 10/minute plus 100/hour/account, consumed before inference; failed inference still costs admission |
| UG search/tab | Active D1 account, query/URL allowlist, 2 MiB upstream response bound | Shared 60/minute/account before network fetch |
| Catalog | Active D1 account, 256 KiB body, 100 KiB chart, pagination max 100, transactional revisions | Existing validation preserved; distributed catalog quotas deferred |
| Admin | Current active admin and request bounds | Existing permissions preserved; distributed admin quotas deferred |

Account quotas use authoritative D1 user IDs after authentication, except session
issuance which uses the verified Google subject. No request body ID, bearer token
string, CF-Connecting-IP, X-Forwarded-For, or other client header is used as a key.
Anonymous admission deliberately uses a shared global bucket, not IP identity.
This avoids spoofing but allows anonymous traffic to exhaust shared login capacity;
operators must evaluate the proposed limits against congregation traffic before
activation. Authenticated requests still incur authentication/D1 lookup cost before
their account quota; these quotas do not replace perimeter protection. Band Sync
does not call these server endpoints and its protocol is unchanged.

## Design and configuration contract

Cloudflare's [native rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
is local to each Cloudflare location and permissive/eventually consistent, so it
does not satisfy strict global accounting. KV counters likewise cannot provide
an atomic cross-isolate read/increment. WAF rules require separately authorized
configuration and cannot substitute for server-verified account quotas.

The selected integration maps each HMAC-SHA256(policy, identity) to one Durable
Object; the existing server-only AUTH_SECRET supplies the HMAC key. Raw identities
are not transmitted to the backend or logged. Keys are pseudonymous, not anonymous;
secret rotation changes bucket identity and resets quotas. Each object updates a
single fixed-window counter per policy through a
[durable storage transaction](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction).
No process-local counter grants admission. Reconstructed object instances share
persisted counters. Policy and clock come from backend code, never client input.
Fixed windows permit up to twice a quota across a window boundary. Minute and hour
AI quotas are separate: a later rejection may consume an earlier admission, never
refund it. This conservatively bounds inference; it is not an in-flight job cap,
token accounting system, or site-wide AI spending budget.

| Configuration | Behavior |
| --- | --- |
| API_ABUSE_MODE absent or `off` (even with a binding) | Disabled; current endpoint behavior and guards retained |
| Exact `durable-v1`, valid AUTH_SECRET (at least 32 characters), callable API_ABUSE_LIMITER namespace | Request the backend; `ready` means configured, not proof of backend health |
| Any other explicit mode, missing/malformed namespace, or invalid secret | Explicit activation attempt fails closed with 503, Retry-After: 5 |
| Backend exception, non-2xx, invalid JSON/decision | 503, Retry-After: 5; no expensive downstream work |
| Backend denies quota | 429, RATE_LIMIT_EXCEEDED, positive integer Retry-After to window reset |

Responses expose Retry-After through CORS and use no-store. Backend errors and
private values are not logged. The client passes a three-second abort signal to
the namespace fetch and independently bounds headers/JSON to three seconds even
if the transport ignores abort. Ambiguous backend outcomes
are never retried automatically and may consume admission without downstream work.

## Human prerequisites (separate authorization)

1. Review quotas, anonymous shared admission, fixed-window bursts, failure behavior,
   storage retention, and operational cost. No paid plan or live capability is assumed.
2. Package the exported `ApiAbuseLimiter` class and shared policies from
   functions/lib/abuseProtection.ts into a separate reviewed Worker with a
   SQLite-backed Durable Object namespace and its own migration. Keep its counters
   reachable only through trusted bindings; do not publish a public admission route.
   Pages [binds externally hosted Durable Objects](https://developers.cloudflare.com/pages/functions/bindings/#durable-objects).
3. Approve Worker deployment, namespace provisioning, billing and separate
   preview/production namespaces. Persisted object records need an approved retention
   policy; this dormant implementation has no deletion/alarm automation.
4. Configure Pages API_ABUSE_LIMITER for that namespace, verify the same policy
   version and stable AUTH_SECRET across instances, and prove concurrent enforcement
   and backend failure behavior in an authorized preview environment.
5. Only after that verification, separately approve setting API_ABUSE_MODE to
   `durable-v1`. Setting a binding alone cannot activate this integration. Rollback
   to absent/`off` deliberately disables distributed enforcement, retaining legacy guards.

Deterministic tests exercise the implementation against serialized transactional
fixtures, including reconstructed instances, real SQLite Sync CAS, authenticated
QR round trips, account separation, anonymous shared admission, expiry, downstream
rejection, AI budgeting, malformed backend replies and missing configuration.
They prove local code behavior, not live Cloudflare deployment or billing readiness.
