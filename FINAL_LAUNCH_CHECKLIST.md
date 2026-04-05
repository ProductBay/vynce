# Final Launch Checklist

## Top 5 Before Launch

1. Rotate all previously exposed secrets.
2. Fill `backend/.env.production.example` with real production values outside the repo.
3. Deploy the real backend and confirm `GET /api/health` and `GET /api/ready` both pass.
4. Run live Vonage staging validation for human answer, voicemail, failed call, and signed webhooks.
5. Complete the release smoke test and rollback checklist below.

## Production Smoke Test

- Log in as tenant user and superadmin.
- Verify onboarding submit, review, approve, and post-approval unlock.
- Verify single live call path.
- Verify bulk upload path.
- Verify voicemail / TTS behavior.
- Verify support inbox and provider webhook ingestion.
- Verify tenant suspension blocks login and calling.
- Verify seat enforcement and superadmin add-user flow.

## Operational Checks

- Confirm HTTPS is enabled for the app and API domains.
- Confirm secure cookies work on the production domain.
- Confirm `PUBLIC_WEBHOOK_URL` is public and reachable.
- Confirm Vonage signed webhooks are enabled.
- Confirm monitoring is watching `/api/health` and `/api/ready`.
- Confirm error logs and alert routing are active.

## Rollback Readiness

- Keep the previous deploy artifact ready.
- Keep the previous environment snapshot ready.
- Verify rollback owner and contact path.
- Verify post-deploy and post-rollback smoke checks are documented.
