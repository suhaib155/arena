# V3 preview API deployment

Deploy this branch separately from production. Do not merge it to deploy a
physical-demo backend. Mobile remains at the reviewed map/action-system stack.

## Runtime

`yarn workspace @movenrun/backend build` type-checks the complete API import graph
and emits `backend/dist/api.cjs`, including shared TypeScript domain code.
`yarn workspace @movenrun/backend start` runs that artifact on Node 22.
The build rejects legacy routes/workers/blockchain imports. `/identity` and
`/movement` retain the existing services, validation, session bearer checks,
canonical distance/sealing and Drizzle persistence. No Redis, oracle key,
contracts or chain RPC variables are required by this entry.

`start:legacy` explicitly selects the old runtime; it still requires its old
configuration. Worker commands are unchanged. This deployment never starts them.

`/health` reports process liveness. `/ready` checks all columns of the active
identity/session/OTP/audit/wallet/movement tables and whether email delivery is
configured. Configured does not mean a real message has been delivered: verify
delivery separately. Both endpoints are rate limited. The server stores no raw
GPS request bodies and has no request-body logger. Errors never log credentials,
OTP values, recipient addresses or upstream response bodies.

## External account boundary

1. Create or sign in to a Render account and authorize repository access to
   `suhaib155/arena`. Enable billing for a dedicated Starter web service and
   Basic 256 MB PostgreSQL instance. Review the dashboard's current price before
   provisioning. Import the root `render.yaml` from `fix/preview-v3-api-runtime`.
   Automatic deploys are disabled. Record the exact deployed commit separately.
2. Create a Resend account and verify a sending domain/subdomain you control with
   the DNS records Resend supplies. Create a **Sending access** API key restricted
   to that domain. Set `RESEND_API_KEY` directly in Render's secret environment
   settings, never in chat, source, mobile/EAS variables, logs or screenshots.
3. Set `IDENTITY_EMAIL_FROM` to a bare address on that verified domain, e.g.
   `signin@your-verified-subdomain`. No mailbox password is required.
4. Set `CORS_ORIGINS` to exact HTTPS browser origins you control. For a native-only
   demo, use the actual Render service HTTPS origin. Native app requests without
   an Origin header remain supported and still require bearer authentication.
5. Render supplies its private managed `DATABASE_URL` and generates two independent
   random peppers (`IDENTITY_SESSION_PEPPER`, `IDENTITY_OTP_PEPPER`). Keep them in
   Render only. Do not rotate session pepper without accepting session invalidation.
   The application requires distinct values of at least 32 characters.
6. Confirm the direct Render proxy path before retaining `TRUST_PROXY_HOPS=1`.
   Never expose the application port directly or add another public proxy without
   revalidating client-IP handling. Keep one instance; rate limits are process-local.

The database has no public IP allowlist. The service and DB use the same private
region. Do not disable PostgreSQL TLS certificate validation for an external DB.
If using another provider, use its verified TLS connection configuration.

## Migrations and verification

Render's pre-deploy command runs `yarn workspace @movenrun/backend db:migrate`.
It applies the committed Drizzle chain `0000` through `0005`; no schema push or
invented seed accounts. A failed migration prevents deployment. The runtime test
uses a disposable local database and applies this command twice to verify retries.

Before setting the mobile URL, require:

- `/health` and `/ready` return 200 over the canonical HTTPS service URL.
- A dedicated mailbox owner completes real email OTP sign-in inside the app.
  Never ask the owner to share the code, password or tokens. Codes/tokens stay in
  the app authentication flow. Tests using a mocked delivery transport do not
  replace this real delivery gate.
- Authenticated `/identity/me` and `/movement/verify` succeed; missing/revoked
  bearer tokens fail; a retry returns the same persisted movement result.
- Confirm the resulting PostgreSQL row stores only the existing derived outcome,
  without raw coordinates or request bodies. Inspect logs without exporting
  sensitive material; do not enable request/body tracing.

Only after backend readiness and real delivery are verified, set the EAS
**preview** environment's public `EXPO_PUBLIC_API_URL` to the canonical HTTPS URL.
Keep it absent until then; the client must continue to fail honestly when unset.
Build a new preview APK from the exact demo descendant and record its build ID,
Git SHA, APK link, backend SHA and environment selection. Do not reuse the older
APK without an API URL. Physical phone verification remains a separate gate.

Provider references: [Render Blueprint specification](https://render.com/docs/blueprint-spec),
[Resend domain verification](https://resend.com/docs/dashboard/domains/introduction),
[Resend send API](https://resend.com/docs/api-reference/emails/send-email).
