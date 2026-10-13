# MovenRun: post-security launch prep (frontend on hold)

**Date:** 13 Oct 2026 · **Repository:** `suhaib155/arena` · **Code described:** `41b78a8` · **Branch:** `chore/post-security-launch-prep`
**Engineering and pre-listing target:** 2 Nov 2026. This is not a Play availability date (D-24).

STATUS: SECURITY REVIEWED LOCALLY — LIVE SUPABASE + ANDROID AUTH + PLAY ACCOUNT GATES STILL PENDING

## Owner dashboard

| | Items |
|---|---|
| **DONE** | Google and wallet sign-in, the 1,000 cap, the 50/hour quota, deletion and the sweep (all locally tested); security review rounds 1–3; hook contract on PostgreSQL; migration checksums; secret scan in CI; live setup operator guide; Play registration checklist; Android device gate plan; X-20 accepted ("accept separate accounts", 13 Oct) |
| **BLOCKED — OWNER** | X-01a/b/c Play developer account (not created); live setup X-06 → X-07 → X-05 → X-21; X-08 and X-04 (APK); X-10 phone test by 24 Oct; X-22 mailbox for info@movenrun.xyz |
| **BLOCKED — EXTERNAL** | Google's account verification and, for a Personal account, the production-access review; whether each wallet's browser returns to the app (phone only); 64-bit and 16 KB confirmation in the App bundle explorer |
| **NEEDS APPROVAL** | X-06 applying migrations · X-05 enabling providers · X-21 DNS · X-04 EAS build · X-01b US$25 fee · X-14 merge · X-11, X-12, X-16 Play Console and publish · X-23 App Link return (later) |
| **OPEN** | F-06 residual (phone step 15h, then X-23); hosted proof that Supabase calls the hook (X-07b) |

## What changed in this milestone

**Owner facts recorded** (`DECISIONS.md`, `EXTERNAL_ACTIONS.md`, `TASK_REGISTER.md`, `FEATURE_MATRIX.md`):
- **X-01** is now NOT CREATED — OWNER REGISTRATION PENDING, split into:
  - X-01a: choose the truthful account type;
  - X-01b: register and pay the US$25 fee;
  - X-01c: if Personal, the closed test and production access.
- **D-24:** 2 Nov is the engineering and pre-listing target only.
- **D-25:** the frontend is on hold.
- **D-26:** reports get unique names.
- **D-27:** migrations are append-only.
- **D-28:** the sweep has limits.
- **X-20 / D-17:** separate accounts are accepted.

**Backend fixes.** Backend only; no app source changed.

| ID | Severity | Fix | Commit |
|---|---|---|---|
| F-14 | Medium | The orphan sweep reads each user again at Supabase just before deleting it, so a person who signed in after the listing keeps their sign-in. A failed read deletes nothing. At most 100 deletions per run, and only one run at a time | cae5f88 |
| F-13 | Low | Supabase tokens with a `crit` header or a future or malformed `nbf` are refused | cae5f88 |
| F-15 | Low | Every `/identity` response is `Cache-Control: no-store` | 41b78a8 |
| F-16 | Info | Hosted hook may need `usage on schema public` for `supabase_auth_admin`. Read-only check and the one grant are in the X-07 gate | docs |

**New guards.**
- `backend/drizzle/CHECKSUMS.sha256` with `migrationChecksums.test.ts`: any edit, rename or unlisted migration fails CI.
- `hookContract.test.ts`, on real PostgreSQL with the Supabase roles.
- `scripts/check-secrets.mjs`, now a step in `backend-checks.yml`.

**New documents.**
- `LIVE_SETUP_OPERATOR_GUIDE.md`: gate-by-gate proof commands, the migration inventory with checksums, rollback and rescue, and backup and export for a Free plan with no backups.
- `PLAY_REGISTRATION_CHECKLIST.md`: account types, the US$25 fee, testing tracks, and the pre-listing engineering review.
- `ANDROID_DEVICE_GATE_PLAN.md`: preconditions, schedule to 24 Oct, pass rules.
- `AUTH_SECURITY_REVIEW.md` round 3: the token, session and code audit, the hook contract, and the F-06 App Link design.

## Security review results

**Hook contract, proven on PostgreSQL 16:**
- **Who can call it:** only `supabase_auth_admin`. PUBLIC, `anon` and `authenticated` are denied, and the auth role cannot read the tables directly.
- **Return shape:** `{}` when admitted, or an error with `http_code` 403 at the cap or 429 over the quota.
- **Concurrency:** 20 simultaneous calls against a quota of 5 admit exactly 5.
- **Full:** at the cap, every call is refused and nothing is recorded.
- **Deletion:** deleting a player frees a place.
- **Quota 0:** refuses everything.
- **Fails closed:** with no capacity row, or if the function errors.
- **Data recorded:** `auth_user_creations` holds only a number and a time.

**Token audit:**
- **Keys:** JWKS rotation is handled with a once-a-minute refresh limit. The key decides the algorithm, and `none` or HS256 without a secret are refused.
- **Claims:** `iss`, `aud` (string or array), `role`, `exp`, `iat` and `nbf` are all checked.
- **Provider:** the Google route needs a Google session.
- **PKCE:** S256 on both flows.
- **Wallet:** single-use nonce and exact message.
- **Codes:** stored hashed and never logged.
- **Refresh tokens:** rotate, and reuse revokes the whole session family.

**Migrations:**
- 0000–0009 only create; nothing drops, deletes or touches `auth`.
- drizzle applies them in one transaction.
- A fresh `drizzle-kit migrate` records hashes identical to the pinned list.
- RLS is on for all 19 tables.

**Secrets:** tracked files, all history and `website/` are clean. A planted-fakes test proves the scanner catches the patterns.

**F-06 is still a residual risk, not solved.**
- **What would help:** a verified HTTPS App Link would stop another app receiving the automatic return.
- **What it would not stop:** a person being talked into reading out a code.
- **What it needs:**
  - app changes, which wait for the frontend hold to lift;
  - X-21, the website at movenrun.xyz;
  - the Play signing certificate;
  - your go (X-23), after the phone check.

## Tests (this branch)

| Suite | Result |
|---|---|
| Backend, PostgreSQL 16 | **406/406**, 0 skipped (was 399) |
| API runtime (built API, migrations 0000–0009) | **10/10** |
| Shared | **156/156** |
| Mobile (code unchanged since b4612bb) | **910/910** |
| Website end-to-end, Chromium | **23/23** |
| Website wallet choice / sleeping API | **8/8** / **3/3** |
| Secret scan: tree, history, website | Clean |

Supabase was a local stand-in throughout. Nothing hosted or on a phone.

## Deployment status

Nothing was deployed or changed live. Specifically:
- No provider was enabled.
- No migration was applied to the live database.
- No DNS change, build, Play Console action, payment or onchain transaction.
- No merge and no force-push.

This workspace cannot reach Supabase, movenrun.xyz or Expo.

## What I need from you

1. **X-01a:** choose the account type truthfully. Personal is correct unless MovenRun is a registered entity with a D-U-N-S number.
2. **X-01b**, when you are ready: register and pay the US$25 fee. Steps are in `PLAY_REGISTRATION_CHECKLIST.md`.
3. **Approve the live sequence.** Each gate has proof commands in `LIVE_SETUP_OPERATOR_GUIDE.md`:
   1. X-06, the database and API;
   2. X-07, the hook;
   3. X-05, the providers, then X-07b, the hook proof;
   4. X-21, the website at movenrun.xyz.
4. **Build and test the APK.** X-08 and X-04, then X-10 on a phone by 24 Oct, following `ANDROID_DEVICE_GATE_PLAN.md`.
5. **Branch.** `chore/post-security-launch-prep` carries all earlier work plus this milestone. Nothing is merged.

## Not to do next

- Do not enable providers before the hook is attached and checked.
- Do not register as an organization without a real D-U-N-S entity.
- No keep-awake pings for the free host.
- No paid plans.
- No app UI work until your design brief.
- No merge, publish or live migration without your approval.

Next recommended action: approve the safe X-06 -> X-07 -> X-05 -> X-21 operator sequence when ready, then test the exact APK on Android; keep mobile frontend frozen until the owner provides its next design brief.
