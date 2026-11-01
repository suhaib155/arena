# MovenRun 16 Oct 2026: X-26 incident closed, X-07 hook attached

Live service unchanged at `dd83065`. Code head of `security/x26-signing-keys` (#110, not deployed): `82c729e`.

| Item | State | Evidence |
|---|---|---|
| X-26 legacy JWT secret | **Closed.** Revoked; ECC (P-256) current; legacy API keys disabled; Render legacy variable removed | E-45, runbook §6 |
| X-07 Before User Created hook | **Attached** to `public.movenrun_before_user_created`; permissions and limits correct | E-45 |
| X-07b invocation proof | Pending, runs inside the X-05 window | — |
| X-05 providers | Off, not approved | — |
| X-24, X-21, X-25 | Unchanged | — |

## Checks (no secret values read or stored)

- Public JWKS: one EC ES256 key, no symmetric key.
- Live API: `/ready` 200; forged HS256, unknown-kid ES256 and `alg: none` tokens 401; missing token 400.
- Supabase Auth admin with a forged HS256 `service_role` token: 401.
- Legacy API keys: `enabled: false`.
- Read-only SQL: hook EXECUTE for `supabase_auth_admin` only; schema usage yes; capacity 1,000 / 50 per hour; 0 users; 10 migrations; 0 public tables without RLS.
- Owner dashboard: legacy secret revoked ("Previously used" empty), hook enabled, Render legacy variable removed.

## Finding

`SUPABASE_LEGACY_JWT_SECRET` existed in Render although the Blueprint and operator guide never set it. It is removed. PR #110 makes the API log at startup whether such a secret is trusted, so this is visible after the next approved deploy (X-24).

## Next

- X-05 (owner approval): enable Google and wallet, then X-07b (quota 0 refuses a new account, then restore 50).
- X-24 (owner approval): deploy #110 so the API refuses legacy keys and logs its trust mode.
