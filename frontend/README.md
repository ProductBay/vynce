# Vynce Frontend

Vynce Frontend is the browser client for Vynce. It runs on Vite + React and consumes backend APIs for authentication, onboarding state, calling workflows, admin operations, analytics, and merged license access status.

The frontend is not the source of truth for licensing. Commercial enforcement remains server-backed.

## Architecture

Vynce is split into three responsibility boundaries:

1. Frontend: React UI for agents and admins.
2. Main Vynce backend: authentication, onboarding approval, telephony readiness, calling, messaging, support, analytics, and admin monitoring.
3. Vynce Control Plane: external source of truth for commercial license state, seat entitlement, and packaged app activation.

The frontend only consumes normalized backend responses and should never duplicate licensing or activation rules.

## Runtime Flow

The React app starts in `src/main.tsx`, mounts routing, and wraps the app with shared providers:

1. `AuthProvider` for authenticated session and authenticated fetch calls.
2. `AppProvider` for shared app state.
3. Router providers for agent and admin route handling.

The route map in `src/App.jsx` separates public routes from protected agent/admin surfaces.

## Licensing and Access Model

The frontend consumes `GET /api/license/status` through `src/hooks/useLicenseGuard.js`.

The backend returns a merged access model with:

1. `commercial`: control-plane-backed commercial status.
2. `operational`: Vynce-owned onboarding and tenant readiness state.
3. `effectiveAccess`: final gate decisions (`canLogin`, `canSingleCall`, `canBulkCall`, `canProvisionUser`).

The frontend treats this payload as read-only. Sensitive decisions remain backend-enforced.

### Expected License Status Payload

```json
{
  "success": true,
  "data": {
    "tenantId": "tenant_xxx",
    "commercial": {
      "licenseActive": true,
      "commercialStatus": "active",
      "activationValid": true,
      "plan": "professional",
      "includedUsers": 1,
      "extraSeats": 0,
      "canProvisionUser": false
    },
    "operational": {
      "onboardingApproved": true,
      "tenantOperationalStatus": "active",
      "telephonyVerified": true,
      "canGoLive": true
    },
    "effectiveAccess": {
      "canLogin": true,
      "canSingleCall": true,
      "canBulkCall": true,
      "canProvisionUser": false
    }
  }
}
```

## Backend Integration

The frontend pairs with `../backend`, where the control-plane integration is centered around:

1. `dialer.js`: main Express application and runtime access enforcement.
2. `services/controlPlaneClient.js`: HTTP client for Vynce Control Plane.
3. `services/controlPlaneSync.js`: normalized commercial-state fetch and merged access helpers.

Vynce backend remains the source of truth for onboarding, operational suspension/review, telephony readiness, calling workflows, and support/admin operations.

Control Plane remains the source of truth for commercial license status, seat entitlement, activation validity, and activation revoke/reset state.

## Project Structure

```text
frontend/
├── public/
├── src/
│   ├── api/
│   ├── components/
│   ├── contexts/
│   ├── hooks/
│   ├── layouts/
│   ├── pages/
│   │   └── admin/
│   ├── routes/
│   ├── services/
│   ├── App.jsx
│   └── main.tsx
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.js
```

## Development

Install dependencies:

```bash
npm install
```

Run frontend dev server:

```bash
npm run dev
```

Build frontend:

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

Lint frontend:

```bash
npm run lint
```

## Backend Requirements

For frontend license/access behavior to work correctly, configure backend control-plane env values:

```bash
CONTROL_PLANE_BASE_URL=
CONTROL_PLANE_API_SECRET=
CONTROL_PLANE_TIMEOUT_MS=8000
APP_ENV=development
```

Typical backend startup from `../backend`:

```bash
npm install
npm start
```

## Key Principles

1. Keep commercial enforcement server-backed.
2. Do not duplicate control-plane licensing logic in React.
3. Do not move onboarding or telephony logic into the control plane.
4. Extend existing UX with license state without breaking core agent/admin flows.
