# Google sign-in and server songbook sync

This filename is retained for continuity. Active GTAR uses Google identity for
sign-in and Cloudflare Pages Functions/D1 for cloud songbook synchronization.
Google Drive AppData sync and the former `useDriveSync` hook are historical.

## Authentication configuration

Set the frontend `VITE_GOOGLE_CLIENT_ID` in the ignored `web/.env.local`, using
`web/.env.example` as a starting point, then restart Vite. Configure a Google Web
application OAuth client with the exact hosted and local JavaScript origins,
including `http://localhost:5173` for canonical local development. No Google
client secret belongs in the frontend. Drive API enablement and Drive AppData
scope are not prerequisites for current server-backed songbook sync.

The server also needs the matching `GOOGLE_CLIENT_ID` (or its supported
`VITE_GOOGLE_CLIENT_ID` alias), a private `AUTH_SECRET`, a `DB` binding with the
tracked migrations applied, and an explicitly configured administrator bootstrap
identity when establishing the first administrator. See [server and local
prerequisites](README.md).

Sign-in obtains a Google ID token and sends it to `/api/auth/session`. The server
verifies the identity and authoritative D1 account/access status, then issues a
session token. Pending or denied accounts see their respective access screens;
active accounts can use the app. `VITE_AUTHORIZED_EMAILS` supports client-side
role/allowlist behavior; it does not replace server approval or D1 authorization.

Sessions are retained in browser sessionStorage and rechecked against the server.
Sign-out or an invalid/expired session locks the client while retaining device
songbook data. The explicit development bypass is available only in a Vite DEV
build on loopback hosts; it bypasses local app access and disables cloud sync.
It is unavailable in hosted preview/production builds and on LAN hosts.

## Cloud songbook operation

Use **Cloud Songbook Sync** and **Sync Now** to synchronize the signed-in account's
songs and setlists through `/api/songbook/sync`. Review conflict information and
export backups before resolution. See [sync and recovery semantics](../SYNC_RECOVERY.md)
for current merge behavior, device recovery, and implementation limits.

## Validation and security boundary

Run `npm test`, `npm run lint:sync`, and `npm run build` from `web`. Authentication
and cloud-songbook tests exercise the current server/session contract with mocked
network/D1 responses; they do not claim live OAuth or cross-device verification.
The UI gate is client-side; backend authorization protects server data. Static
frontend configuration/assets are public. Separately configure hosting access
controls if the static application itself must be restricted.
