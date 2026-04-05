# Vynce Workspace

This repository contains the main Vynce application workspace:

1. Browser frontend (Vite + React)
2. Main Vynce backend (Node.js + Express + MongoDB)
3. Supporting dashboard/admin assets

Vynce Control Plane is an external service and is treated as the commercial source of truth for licensing, activation, and seat entitlements.

## Architecture

Vynce is split across clear responsibility boundaries:

1. Frontend ([frontend](frontend)): UI for agents and admins.
2. Main backend ([backend](backend)): auth, onboarding approval, operational suspension/manual review, telephony readiness, calling workflows, support flows, analytics, and admin monitoring.
3. Vynce Control Plane (external): commercial license status, activation validity, seat entitlement, and activation revoke/reset state.

The frontend consumes normalized backend responses. Licensing decisions are server-backed and should not be implemented as renderer-only logic.

## Current License Integration Model

The backend merges:

1. Commercial state from Control Plane
2. Operational state from Vynce backend

The normalized license access model is exposed from:

1. `GET /api/license/status`

The expected merged shape includes:

1. `commercial`
2. `operational`
3. `effectiveAccess`

This merged model drives login, call eligibility, bulk-call eligibility, and user provisioning gates.

## Key Backend Integration Points

Primary integration files in [backend](backend):

1. [backend/dialer.js](backend/dialer.js): Main Express app and runtime access enforcement.
2. [backend/services/controlPlaneClient.js](backend/services/controlPlaneClient.js): Control-plane HTTP client, auth headers, timeout behavior, response normalization.
3. [backend/services/controlPlaneSync.js](backend/services/controlPlaneSync.js): Commercial sync helpers and merged access-state builder.

## Frontend Runtime Notes

Primary frontend integration points in [frontend](frontend):

1. [frontend/src/main.tsx](frontend/src/main.tsx): App bootstrap and providers.
2. [frontend/src/App.jsx](frontend/src/App.jsx): Route layout for public, agent, and admin sections.
3. [frontend/src/hooks/useLicenseGuard.js](frontend/src/hooks/useLicenseGuard.js): Reads merged license status from backend.

For frontend-specific architecture details, see [frontend/README.md](frontend/README.md).

## Local Development

## 1) Backend

From [backend](backend):

```bash
npm install
npm start
```

Backend defaults to `PORT=3000` unless overridden by environment variables.

## 2) Frontend

From [frontend](frontend):

```bash
npm install
npm run dev
```

Frontend uses Vite and defaults to `http://localhost:5173` unless configured otherwise.

## Required Backend Environment

Use [backend/.env.example](backend/.env.example) as the template and set real values.

Control-plane integration values:

```bash
CONTROL_PLANE_BASE_URL=
CONTROL_PLANE_API_SECRET=
CONTROL_PLANE_TIMEOUT_MS=8000
APP_ENV=development
```

Other runtime values (MongoDB, JWT, Vonage, webhook and CORS settings) are also required for full operation.

## Testing

Staged Electron control-plane E2E runs require device-binding fields (`installId` and `deviceFingerprint`) on heartbeat/deactivate payloads; see [frontend/electron/README.md](frontend/electron/README.md).

## Principles

1. Keep commercial enforcement server-backed.
2. Do not duplicate control-plane logic in the frontend.
3. Keep onboarding/telephony/calling/support ownership in the main Vynce backend.
4. Treat Control Plane as commercial source of truth, not an operational workflow engine.
