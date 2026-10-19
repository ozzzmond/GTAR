# PR draft: Add disabled Stage Cast 2.0 secure pairing backend

Base: `dev` at `d961e1fcbeba505baed1b8e9436e2b40275d3c40`.
Branch: `feat/stage-cast2-p1`. P1-only commit, branch push and draft PR authorized.
Merge, tags, deployment and infrastructure activation remain unauthorized.

Stage Cast 2.0 now has an isolated Worker/Durable Object foundation for one
authenticated controller and one TV receiver. A short-lived opaque QR reference
plus six-digit PIN reserves the controller slot; the TV must explicitly approve
before either party can obtain transport access. Durable role-scoped authorization,
single-use tickets, request budgets and server-assigned presentation sequences
reject replay, guessing, cross-session access and unauthorized frame directions.

Existing casting, presentation pages, AuthGate, P0 contracts and songbooks remain
unchanged. The new Worker is disconnected from Pages and disabled without its
reviewed mode, origin and private namespace. No production configuration,
infrastructure, D1 migrations, dependencies or release metadata are changed.

Validation: targeted P0/backend/runtime tests 40/40; full web suite 1215 passed,
1 skipped, 0 failed (1216 total), run once; sync lint PASS; web build PASS;
Python repository checks 1/1; new Worker/backend ESLint and TypeScript checks PASS.
Local workerd proves actual WebSocket upgrade, delivery, reconnect and revocation.
No raw runtime logs are saved. Build reports chunk-size and mixed-import warnings.

Review focus: trust boundaries and HTTP contract in STAGE_CAST2_P1.md; absolute
10-minute authorization lease; one-hub capacity/denial-of-service tradeoff;
standard-socket eviction requiring controller snapshot; scoped WebSocket tickets
in redacted handshake headers. Infrastructure review and separate human approval
are required before any binding, route, migration or activation. Production HOLD.
