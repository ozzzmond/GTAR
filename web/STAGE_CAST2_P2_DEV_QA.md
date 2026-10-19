# Stage Cast 2.0 P2: Cloudflare DEV Field QA Enablement

Status: Ready for DEV Field QA deployment. Production HOLD. No production infrastructure, database, or release changes.

## Overview

Stage Cast 2.0 P2 brings the Stage Cast 2 offline protocol foundation (P0) and secure pairing backend (P1) into real device field testing on Cloudflare DEV (`dev.gtar-web.pages.dev`). It connects mobile/tablet controllers and Smart TV browser receivers via Cloudflare Pages Functions and a private Durable Object WebSocket hub.

## Trust Boundaries & Security Model

1. **PROD Hold & Strict Feature Gating**:
   - Production builds (`CF_PAGES_BRANCH=main` or production release identity) evaluate `__GTAR_STAGE_CAST2_ENABLED__` to `false`.
   - `wrangler.jsonc` production environment has zero DO bindings, zero `CAST2_MODE`, and zero `CAST2_ORIGIN`. Any request fails closed with 503 `DISABLED`.
   - Client-side gating cannot be bypassed via hostname spoofing or local variables alone because server-side authentication and authorization are unconditionally enforced.

2. **Server-Side Authentication & Authorization**:
   - Controller pairing claims require active Google authenticated sessions verified against D1 database tokens.
   - TV receiver connections require explicit human on-screen approval via "Approve controller".
   - Origin must match configured HTTPS `CAST2_ORIGIN` (`https://dev.gtar-web.pages.dev`), and `CF-Connecting-IP` must be present.
   - All connections utilize short-lived, single-use connection tickets over `wss://` (never passing bearer tokens over WebSockets).

3. **Field QA URLs**:
   - **Smart TV Browser Receiver**: `https://dev.gtar-web.pages.dev/tv/cast2`
   - **Mobile Phone / Tablet Controller**: `https://dev.gtar-web.pages.dev/` (opens Stage Cast 2 panel)
   - **QR Pairing Entrypoint**: `https://dev.gtar-web.pages.dev/#cast2=<64-char-ref>`

## Cloudflare DEV Deployment Actions (Requires Human Approval)

To activate backend transport in Cloudflare DEV:

1. **Deploy DEV Worker**:
   Deploy `gtar-stage-cast2-dev` using `web/wrangler.stage-cast2-dev.jsonc`:
   ```bash
   npx wrangler deploy --config wrangler.stage-cast2-dev.jsonc
   ```
   This creates/updates the worker, registers the `StageCast2Hub` SQLite Durable Object migration, and binds to `gtar-db-dev`.

2. **Verify Pages Preview Bindings**:
   Verify `web/wrangler.jsonc` preview environment contains:
   - Durable Object binding `CAST2_HUB` to script `gtar-stage-cast2-dev` class `StageCast2Hub`
   - Environment variables: `CAST2_MODE=reviewed-v1`, `CAST2_ORIGIN=https://dev.gtar-web.pages.dev`
   - D1 binding `DB` to `gtar-db-dev`

3. **Field Testing Workflow**:
   - On Smart TV: Open `https://dev.gtar-web.pages.dev/tv/cast2`. Click "Create TV pairing". TV displays QR code and 6-digit PIN.
   - On Mobile / Tablet: Scan QR code with phone camera or navigate to `https://dev.gtar-web.pages.dev/#cast2=<ref>`. Sign in with authorized Google account. Enter the 6-digit PIN. Click "Request TV approval".
   - On Smart TV: Tap "Approve controller".
   - Real-time teleprompter sync: Controller song selection, transpose offset, chords toggle, and auto-scrolling project directly to the TV display.
