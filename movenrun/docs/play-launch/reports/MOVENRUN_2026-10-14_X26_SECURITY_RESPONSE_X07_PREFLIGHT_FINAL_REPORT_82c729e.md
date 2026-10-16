# MovenRun 14 Oct 2026: X-26 security response prepared, X-07 preflight

Code commit: `82c729e` on `security/x26-signing-keys` (base `chore/post-security-launch-prep`). Not deployed; the live service stays at `dd83065`.

## Status

| Item | State | Evidence level |
|---|---|---|
| X-26 legacy JWT secret | **OPEN incident.** Treated as compromised. Runbook ready; live rotation and revoke wait for the owner's go | code/local + live read-only |
| X-07 hook attach | Preflight passes; waits for the owner's go, after X-26 is verified | live read-only |
| X-05, X-21, X-24, X-25 | Unchanged, separate decisions | — |

No secret value was read, printed or stored in this work. The connector action that returned the secret was not called again.

## What was checked (read only)

- API token check: JWKS (ES256/RS256) only; HS256 refused unless `SUPABASE_LEGACY_JWT_SECRET` is set. `render.yaml` does not declare it. Whether the Render dashboard has it is an owner name-only check (runbook §3 step 1).
- No code uses legacy `anon` / `service_role` keys. Mobile and website use the publishable key only.
- Public JWKS: one EC P-256 (ES256) public key.
- Live API at `dd83065`: `/ready` 200; forged HS256, ES256 (unknown kid) and `alg: none` tokens on `POST /identity/auth/google/complete` all 401 `verification_failed`; missing token 400.
- X-07 preflight (as `supabase_read_only_user`): `supabase_auth_admin` EXECUTE yes; `anon`, `authenticated` and the read-only role EXECUTE no; `supabase_auth_admin` schema usage yes; function SECURITY DEFINER with `search_path=public, pg_temp`; capacity 1,000 / 50 per hour; 0 auth users; 0 public tables without RLS.

## Code change (82c729e)

- `supabaseAuthConfigFrom` refuses keys that are not `sb_publishable_` / `sb_secret_`, so revoking the legacy secret cannot silently break the API.
- Startup line: `V3 API listening; Supabase tokens: signing keys only` (or `… and legacy secret`).
- Tests: backend 388 pass / 0 fail, API 16 pass / 0 fail, typecheck clean, secret scan clean.

## Next

1. Owner: confirm X-26, then run runbook §3 (Render name check, ECC current, disable legacy keys, revoke).
2. Claude: run V3–V5 the same hour; owner confirms V1, V2, V6. Close the incident then.
3. Owner: confirm X-07; attach the hook; proof X-07b in the X-05 window.
