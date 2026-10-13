# Pull request text (for the owner to open or paste)

**Title:** MovenRun Android v1: Play release candidate

**Base:** `main` · **Head:** `release/android-v1-cxfdbd`

---

Before: the SDK 54 work was spread over four open pull requests, the app still
showed Clubs, city wars, Deeds and wallet management, sign-in needed an email
code from a delivery provider, there was no way to delete an account, and there
was no production build path, store artwork or public privacy page.

After: one branch carries the integrated SDK 54 app scoped to the Movement Game
(walk and run sessions, missions, XP, badges, personal ground preview, route
sharing). Players can play as a guest or sign in with **Continue with Google**
or **Continue with Wallet** through Supabase Auth; new accounts stop at 1,000.
Players can delete their account in the app or on the web with either method,
signed-in players see the verified sessions their account holds, and a gated
workflow builds the signed Play bundle.

Wallet sign-in is one signed message: no transaction, no fee, no custody. In
the app it runs in the wallet's own browser and comes back with a one-time code
that only the phone that started it can use. Deferred features are hidden
behind `mobile/src/lib/releaseScope.ts`, not deleted.

**How**

- Integrates #102, #103, #104 and #105 (only `yarn.lock` overlapped; regenerated).
- Mobile: release scope switchboard and route guard, copy cleanup, Google sign-in
  (Supabase PKCE in the system browser), wallet sign-in (wallet browser + PKCE-bound
  code, deep link or typed), Delete account, verified-session count on Account,
  new icons and splash, EAS production profile, unneeded permissions removed.
- Backend: Supabase token verification (JWKS), Google and wallet sign-in routes,
  server-written single-use EIP-4361 messages (EOA only), the wallet handoff
  exchange, a 1,000-account cap enforced under a database lock and by a Supabase
  before-user-created hook, provider users removed on deletion or refusal,
  `POST /identity/account/delete`, `GET /movement/verifications`, row level
  security on every table, email codes never wired into the hosted API, reviewer
  code removed.
- Website: privacy policy and support page for Google and wallet sign-in,
  account deletion with Google or wallet, the `/sign-in/` page for the app, and a
  check that fails while deployment values are missing.
- Hosting: `render.yaml` for a Render Free service with the Supabase Free database.
- CI: manual `EAS Production AAB` workflow behind the `play-release` environment;
  Hermes export in mobile checks.
- Launch ledger in `movenrun/docs/play-launch/`.

**Tests:** mobile 908/908, backend 397/397 on PostgreSQL 16 (0 skipped), backend
API 10/10, shared 156/156, website sign-in and deletion in Chromium 23/23;
typechecks clean; Android Hermes bundle builds. Supabase Auth was replaced by a
local stand-in in these tests. Hosted and phone testing have not been done yet
(`docs/play-launch/HANDSET_TEST_SCRIPT.md`).

**Not in this change:** Supabase provider settings, hosting, secrets, Play
Console setup and phone tests; see `docs/play-launch/EXTERNAL_ACTIONS.md`.
Google and wallet sign-ins are separate accounts in v1 (no linking).
