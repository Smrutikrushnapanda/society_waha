# SocietyOS WAHA

Current deployment: WAHA 2026.9.2 CORE / WEBJS, pinned by image digest.

Deployment target: dedicated `societyos-waha` Neon project and a separate Render
workspace. Live deployment, session migration and traffic cutover remain pending.

`compose.yaml` retains filesystem sessions; adding `compose.postgres.yaml` opts into
PostgreSQL with a dedicated secret file and certificate-verifying compatibility preload.
Existing sessions are not automatically imported. Retain `sessions/` and the old
container until authenticated recreation acceptance succeeds.

Templates: [.env.example](.env.example), [.env.postgres.example](.env.postgres.example).
SQL: [provision-postgres.sql](provision-postgres.sql). Never use NestJS database-owner
credentials as the WAHA runtime login.

## Render deployment

1. Create a Render Blueprint from this repository using [render.yaml](render.yaml).
   It selects Docker, the Standard plan, WEBJS, PostgreSQL session/media storage,
   and `/ping` as the public health-check path. Keep a single service instance.
2. Set both PostgreSQL URLs from private `.env.postgres`. Use the direct Neon
   endpoint, `waha_runtime`, bootstrap database `postgres`, and `sslmode=verify-full`.
   The provisioned databases are `waha_all` and
   `waha_webjs_session_01m5amp8ak239hr4cs57ydvaqm`.
3. Fill the Blueprint's secret fields: `WAHA_API_KEY`, dashboard username/password,
   `WAHA_BASE_URL` (the gateway's public HTTPS URL), `WHATSAPP_HOOK_URL` (backend HTTPS
   URL plus `/api/v1/whatsapp/webhook`), and `WHATSAPP_HOOK_HMAC_KEY`.
   Set `PORT=3000` and `WHATSAPP_API_PORT=3000` so bundled verification scripts use
   the same port as the server.
4. Deploy and verify `/ping`. Check `/health` separately with the `X-Api-Key` header.
   HTTP health does not establish WhatsApp authentication.
5. During approved cutover, snapshot and stop the old local WAHA before starting
   the same account on Render. Preserve session name
   `session_01m5amp8ak239hr4cs57ydvaqm`; one-time QR pairing may be required.
6. After the session reports `WORKING`, allow at least 60 seconds for its initial
   remote authentication save. In the Render shell, verify the saved archive:

   ```sh
   node /opt/societyos-waha/verify-persistence.cjs
   ```

7. Configure the SocietyOS backend with `WHATSAPP_PROVIDER=waha`, the gateway HTTPS
   `WAHA_BASE_URL`, matching `WAHA_API_KEY` and `WAHA_SESSION_NAME`, and
   `WAHA_WEBHOOK_SECRET` matching `WHATSAPP_HOOK_HMAC_KEY`. Redeploy the backend,
   send a diagnostic message, then restart WAHA and verify the same account returns
   to `WORKING` without another QR scan.

Keep `.env`, `.env.postgres`, session files, media and backups private. Preserve the
old local container/authentication data for rollback. Stop Render WAHA before
reactivating the local instance; never run both against the same account.

## Verification

Run TLS configuration tests without Docker or live database access:

```sh
node --test tests/postgres-tls.test.cjs
```

`node tests/postgres.integration.mjs` runs isolated Docker/PostgreSQL tests with a
synthetic authentication archive. Its Compose image is pinned to the audited ARM
build; it does not verify real WhatsApp authentication or Render cutover.
