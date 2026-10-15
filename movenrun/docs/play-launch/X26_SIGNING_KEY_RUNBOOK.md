# X-26: legacy JWT secret exposure — rotation, revocation and verification

Status: **OPEN incident, prepared, waiting on the owner's go for the live steps.**
It stays open until the legacy secret is **revoked** and every check in §5 passes.
Supabase project `movenrun`, ref `tavxmwuwkeynbnzfwove` only. Never the other project.

## 0. Rules for everyone working this

- Never read, print, copy, paste, hash, screenshot or forward any secret value:
  the legacy JWT secret, legacy `anon` / `service_role` keys, `sb_secret_` keys,
  database URLs, tokens. Reports carry yes/no facts and dates only.
- Never call the connector action that returned the secret (the PostgREST
  settings read). If any tool returns a credential unexpectedly: stop, do not
  repeat or forward it, record only that it happened.
- Render environment values are checked by **name or prefix only**, in the
  dashboard, by the owner. Never through a connector (it would return values).

## 1. What happened (redacted)

| Field | Value |
|---|---|
| Date | 2026-10-14 |
| System | Supabase Management API read through a third-party connector |
| Project | `tavxmwuwkeynbnzfwove` |
| What was exposed | The project's legacy HS256 JWT secret, in a connector response (so it may sit in that provider's logs) |
| Where it is not | Not in the repository, reports, commits, PRs or CI (secret scan passes) |
| Users affected | None: 0 rows in `auth.users`, sign-in providers not enabled |
| Impact if abused | Anyone holding it can mint tokens the project accepts while it is trusted: `service_role` tokens bypass RLS through the Data API **and are accepted by the Auth admin API** (list, create and delete sign-in users, read their emails), Storage and Realtime; and `authenticated` tokens for any user id. The empty Data API does not cover the Auth admin API, so **revoke before X-05 turns sign-in on** |
| Mitigation in place | Data API exposes no schema (`db_schema` empty), RLS on all 19 public tables, no public policies; the MovenRun API ignores HS256 unless `SUPABASE_LEGACY_JWT_SECRET` is set |
| Fix | Move to asymmetric signing keys, disable legacy API keys, **revoke** the legacy secret |

## 2. Dependency check (done 2026-10-14, read only)

| Check | Result | Evidence |
|---|---|---|
| API verifies Supabase tokens by JWKS (ES256/RS256) | Yes | `backend/src/identity/providers/supabaseAuth.ts` (`SupabaseTokenVerifier`) |
| API accepts HS256 | Only when `SUPABASE_LEGACY_JWT_SECRET` is set | same file, `supabaseAuthConfigFrom`; unit test "the legacy HS256 secret works only when configured" |
| `render.yaml` declares `SUPABASE_LEGACY_JWT_SECRET` | No | `render.yaml` env list; guarded by `renderBlueprint.test.ts` |
| Render dashboard has `SUPABASE_LEGACY_JWT_SECRET` | **Owner to check** (name only) | §3 step 1 |
| API keys used by server code | `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (operator guide says `sb_publishable_…` / `sb_secret_…`) | `LIVE_SETUP_OPERATOR_GUIDE.md` Render step 2 |
| Mobile app and website keys | Publishable key only (`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, website meta tag); website refuses an `sb_secret_` key | `mobile/src/lib/signInMethods.ts`, `website/js/account-auth.js` |
| Legacy `anon` / `service_role` keys anywhere in code | None | repository search |
| Public JWKS today | 1 key: EC P-256, ES256 | `https://tavxmwuwkeynbnzfwove.supabase.co/auth/v1/.well-known/jwks.json` (public keys only) |
| Hook `movenrun_before_user_created` uses JWTs | No (Postgres hook called by Supabase Auth); rotation does not affect X-07 | migration source |

Hardening on branch `security/x26-signing-keys` (not deployed; deploy needs X-24):
the API now refuses to start unless the keys are `sb_publishable_` / `sb_secret_`
keys, so revoking the legacy secret cannot silently break it, and the startup
log says `Supabase tokens: signing keys only` or `… and legacy secret` (a
yes/no, never the value).

## 3. Steps (live, owner approval X-26 required)

Do these in one sitting, in order. Supabase dashboard wording changes; if a
screen differs from this, follow the current Supabase guide
(https://supabase.com/docs/guides/auth/signing-keys) and note the difference.

1. **Render, names only.** Service `movenrun-staging-api` → Environment.
   - Is there a variable named `SUPABASE_LEGACY_JWT_SECRET`? Expected: **no**.
     If yes: delete it, save, and redeploy the **same** commit (`dd83065`,
     Manual Deploy → the same commit; this is not X-24).
   - Were `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` copied from
     Supabase → Settings → **API Keys → "Publishable and secret API keys"**
     (they start `sb_publishable_` / `sb_secret_`)? Expected: **yes**. If either
     was a legacy key, replace it with the new-style key first, redeploy the
     same commit, and check `/ready` is 200.
2. **Supabase → Settings → JWT Keys.** Read the state:
   - If the legacy secret is still **Current**: start the migration so it
     becomes a key in the new system, and make sure an **ECC (P-256)** standby
     key exists (create one if not).
   - Rotate so the **ECC key is Current**. The legacy secret moves to
     **Previously used** (still trusted until revoked).
   - If the ECC key is already Current, skip to step 3.
   Wait 20 minutes after rotating (Supabase and the API cache the key list for
   about 10 minutes each).
3. **Supabase → Settings → API Keys → Legacy API keys.** Disable the
   JWT-based legacy `anon` and `service_role` keys. Nothing of ours uses them
   (§2). Supabase requires this before the legacy secret can be revoked.
4. **Supabase → Settings → JWT Keys → Previously used → legacy secret →
   Revoke.** This is the step that removes the risk: until it is done, tokens
   signed with the exposed secret still verify.
5. **Connector hygiene.** Ask the connector provider (without quoting any
   value) whether historical response logs for 2026-10-14 can be deleted, and
   whether their Supabase action set can exclude settings that return
   secrets. Optionally disconnect the Supabase connection when not in use.

Rollback: before step 4, rotating back is possible from the same screen.
After step 4 there is no rollback and none is needed (no users, no
legacy-key consumers).

## 4. Order with X-07

X-26 first, verified, then X-07. X-05 (providers) stays off until both are
done; the X-07 invocation proof (X-07b) happens inside the X-05 window.

## 5. Verification (after step 4)

| # | Check | Who | Pass |
|---|---|---|---|
| V1 | JWT Keys page: Current = ECC (P-256); legacy secret = **Revoked** | Owner, dashboard | as stated |
| V2 | API Keys page: legacy `anon` / `service_role` disabled | Owner, dashboard | as stated |
| V3 | Public JWKS lists only asymmetric public keys (no `oct` key) | Claude, public URL | `kty` EC/RSA only |
| V4 | API `/ready` = 200 | Claude | 200 |
| V5 | API refuses forged tokens on `POST /identity/auth/google/complete`: HS256 (random key), ES256 (unknown `kid`), `alg: none` | Claude | 401 `verification_failed` each; missing token 400 |
| V6 | Render: no `SUPABASE_LEGACY_JWT_SECRET` (name check) | Owner | absent |
| V7 | Positive path: a real ES256 Supabase token is accepted | First Google sign-in in the X-05 window | sign-in succeeds |
| V8 | After the next approved deploy (X-24): startup log reads `Supabase tokens: signing keys only` | Owner or Claude, Render logs | as stated |

Baseline before rotation (2026-10-14 06:2x UTC, Render at `dd83065`): V4 200;
V5 401/401/401 and 400. These hold before and after; they prove the API
rejects forged tokens, not that the legacy secret is revoked (only V1 proves that).

Close the incident when V1–V6 pass. V7 and V8 are recorded when their windows
happen and do not keep the incident open.
