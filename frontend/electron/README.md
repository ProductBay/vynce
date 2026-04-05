# Vynce Desktop Electron Shell

## Runtime Components

- main process: electron/main.cjs
- preload bridge: electron/preload.cjs
- activation manager: electron/services/activationManager.cjs
- control-plane client: electron/services/controlPlaneService.cjs
- secure storage: electron/storage/secureStore.cjs
- renderer shell: src/renderer/

## Environment

Copy .env.electron.example to .env.electron and set values.

## Commands

- npm run electron:dev
- npm run electron:renderer:build
- npm run electron:pack
- npm run electron:dist
- npm run electron:portable
- npm run electron:mac
- npm run electron:linux
- npm run electron:e2e:staged

## Cross-Platform Packaging

Use these commands for release packaging:

1. Windows installer:
- `npm run electron:dist`

2. Windows portable single-file build:
- `npm run electron:portable`

3. macOS artifacts:
- `npm run electron:mac`
- Produces `dmg` and `zip`
- Final public release still requires a real Mac for signing and notarization

4. Linux artifacts:
- `npm run electron:linux`
- Produces `AppImage` and `deb`

Release workflow:

1. Update `.env.electron` to the correct hosted service URLs
2. Run the target packaging command for the OS you are releasing
3. Smoke-test activation against the live control plane
4. Distribute the generated artifact from `frontend/dist`

## Staged Live E2E

`npm run electron:e2e:staged` executes a real control-plane lifecycle check:

1. activate (device A)
2. restore (device A)
3. heartbeat (device A)
4. deactivate (device A)
5. activate (device B)
6. admin revoke activation (device B)
7. heartbeat expects blocked after revoke

Device-binding requirement (must not regress):

- For bound-device control-plane deployments, heartbeat and deactivate requests must include:
	- `activationToken`
	- `installId`
	- `deviceFingerprint`
- If `installId` or `deviceFingerprint` is omitted, heartbeat/deactivate can fail with device binding errors even when activation is otherwise valid.

Set required values in `.env.electron`:

- `CONTROL_PLANE_BASE_URL`
- `CONTROL_PLANE_ADMIN_SECRET`
- `E2E_LICENSE_KEY`
- `E2E_ADMIN_EMAIL`

Regression guard:

- Keep the staged runner payloads in `scripts/staged-control-plane-e2e.mjs` aligned with this device-binding requirement.
