# Production Punch List

This checklist tracks what still needs to happen before Vynce is production-ready.

Legend:
- `[ ]` Not done
- `[-]` In progress / partially done
- `[x]` Done and verified

## Critical Blockers

- [ ] Remove all committed secrets from `backend/.env` and any other checked-in env files.
  Evidence: `backend/.env` currently contains live-looking Vonage credentials, Mongo URI, JWT secret, license token, and activation ID.

- [ ] Rotate every exposed credential.
  Evidence: Current repo state suggests the following should be rotated: Vonage API key/secret, JWT secret, Mongo URI credentials, license token, activation ID.

- [ ] Define a clean production environment contract.
  Evidence: Config is split inconsistently across `.env`, `backend/.env`, and frontend code fallbacks.

- [-] Remove hardcoded `localhost` and local socket/API fallbacks from shipping frontend paths.
  Evidence:
  - Corrected in `frontend/src/services/api`
  - Corrected in `frontend/src/pages/VoicemailManager.jsx`
  - Corrected in `frontend/src/contexts/AppContext.jsx`
  - Remaining local socket/env assumptions still exist in `frontend/.env`

- [-] Remove or isolate offline-only logic from production code paths.
  Evidence:
  - `frontend/src/components/Topbar.jsx` and `frontend/src/hooks/useLicenseGuard.js` now use `VITE_OFFLINE_MODE` instead of hardcoded offline flags
  - Offline behavior still exists and must remain disabled in production envs
  - `backend/test-server.js` is still an offline-only server that must stay out of production startup paths

## Backend Readiness

- [ ] Verify the real backend startup path (`npm start`) works cleanly with production config.
  Evidence: Earlier checks showed failures around license expiry and Mongo/Atlas connectivity.

- [ ] Lock down CORS for real deployment domains only.
  Evidence: Localhost assumptions still exist in backend CORS handling and related config.

- [ ] Validate cookie/session security for production.
  Evidence: Needs confirmation for `secure`, `sameSite`, domain handling, and refresh-token behavior in deployed HTTPS environments.

- [ ] Add startup validation for required production env vars.
  Evidence: Some validation exists, but full production env validation and fail-fast behavior are not yet confirmed.

- [ ] Confirm webhook and telephony configuration is production-safe.
  Evidence: `PUBLIC_WEBHOOK_URL`, Vonage integration, and private key loading need an end-to-end production pass.

## Frontend Readiness

- [-] Remove noisy debug logs from frontend auth, routing, scripts, calls, and upload flows.
  Evidence:
  - Routine `console.log`, `console.warn`, and `console.group` usage was removed from `frontend/src`
  - Cleanup completed in `ProtectedRoute.jsx`, `Topbar.jsx`, `ScriptsManager.jsx`, `Calls.jsx`, `Login.jsx`, `Layout.jsx`, `CallList.jsx`, `AppContext.jsx`, and `apiClient.js`
  - `console.error` remains in some places and should be reviewed later for production reporting

- [ ] Pass frontend typecheck.
  Evidence: `npx tsc --noEmit` timed out during the quick audit and was not verified clean.

- [ ] Pass frontend production build.
  Evidence: `npm run build` timed out during the quick audit and was not verified clean.

- [-] Verify all production-facing pages use consistent API wiring.
  Evidence:
  - Corrected shared API usage in `frontend/src/api.js`, `frontend/src/services/api`, `frontend/src/pages/VoicemailManager.jsx`, and `frontend/src/contexts/AppContext.jsx`
  - Fixed settings-page double-prefix bug in `frontend/src/pages/Settings.jsx` (`/api/api/settings` -> `/settings` via `apiClient`)
  - A broader audit is still needed across the rest of the frontend

## Functional Smoke Tests

- [ ] Login flow passes in a production-like environment.
- [ ] Register flow passes in a production-like environment.
- [ ] Dashboard loads and reflects live call state correctly.
- [ ] Calls page reflects single and bulk updates correctly.
- [ ] Scripts manager CRUD works against the real backend.
- [ ] CSV upload and bulk calling work against the real backend.
- [ ] Voicemail manager works against the real backend.
- [ ] Settings, billing, and logout flows work in a production-like environment.

## Observability and Delivery

- [ ] Add frontend error reporting.
- [ ] Add backend structured error logging and request tracing.
- [ ] Add uptime/health monitoring and alerting.
- [ ] Add CI build and test gates.
- [ ] Add secret scanning in CI.
- [ ] Add a deploy checklist or release checklist.

## Items Already Verified

- [x] Offline frontend and backend can run locally on stable ports.
  Evidence: Verified on local frontend `127.0.0.1:5174` and backend `localhost:3000`.

- [x] Offline scripts CRUD path is wired.
  Evidence: `GET /api/scripts` and `POST /api/scripts` were verified against the offline backend.

- [x] Offline CSV bulk path now creates call records.
  Evidence: Verified by uploading a test CSV and confirming `/api/calls` returned bulk call entries.

- [x] Frontend shipping paths no longer hardcode key localhost API defaults.
  Evidence: Shared frontend API/socket usage was corrected in `frontend/src/services/api`, `frontend/src/pages/VoicemailManager.jsx`, and `frontend/src/contexts/AppContext.jsx`.

- [x] Frontend hardcoded offline flags were replaced with env-driven flags.
  Evidence: `frontend/src/components/Topbar.jsx` and `frontend/src/hooks/useLicenseGuard.js` now use `VITE_OFFLINE_MODE`.

- [x] Settings page API wiring was corrected for the offline/local app.
  Evidence: `frontend/src/pages/Settings.jsx` no longer double-prefixes `apiClient` routes, and offline `GET/POST /api/settings` now work after adding support in `backend/test-server.js`.

## Suggested Execution Order

1. Secrets removal and credential rotation
2. Environment contract cleanup
3. Remove localhost and offline assumptions from shipping code
4. Stabilize the real production backend startup path
5. Pass frontend typecheck and production build
6. Run end-to-end smoke tests in a production-like environment
7. Add monitoring, CI gates, and release safeguards
