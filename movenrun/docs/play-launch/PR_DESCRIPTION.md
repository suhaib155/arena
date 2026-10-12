# Pull request text (for the owner to open or paste)

**Title:** MovenRun Android v1: Play release candidate

**Base:** `main` · **Head:** `release/android-v1-cxfdbd`

---

Before: the SDK 54 work was spread over four open pull requests, the app still
showed Clubs, city wars, Deeds and wallets, there was no way to delete an
account, reviewers could not sign in, and there was no production build path,
store artwork or public privacy page.

After: one branch carries the integrated SDK 54 app scoped to the Movement Game
(walk and run sessions, missions, XP, badges, personal ground preview, route
sharing, optional email account). Deferred features are switched off and
unreachable. Players can delete their account in the app or on the web, signed-in
players see the verified sessions their account holds, reviewers have a
dedicated sign-in, and a gated workflow builds the signed Play bundle.

The deferred features are hidden behind `mobile/src/lib/releaseScope.ts`, not
deleted, so a later release can turn them back on.

**How**

- Integrates #102, #103, #104 and #105 (only `yarn.lock` overlapped; regenerated).
- Mobile: release scope switchboard and route guard, copy cleanup, Delete account,
  verified-session count on Account, new icons and splash, EAS production profile
  with remote version codes, background location and other unneeded permissions
  removed from the release manifest.
- Backend: `POST /identity/account/delete` erases every row of the account in one
  transaction; `GET /movement/verifications` lists the caller's own results;
  optional reviewer sign-in configured only through server secrets; expired
  sign-in codes are deleted a day after expiry; unused SDK
  dependency removed.
- Website: privacy policy, account deletion page with a working deletion flow,
  support page, plus a check that fails while owner placeholders remain.
- CI: manual `EAS Production AAB` workflow behind the `play-release` environment;
  Hermes export added to mobile checks.
- Launch ledger in `movenrun/docs/play-launch/`.

**Tests:** mobile 890/890, backend 382/382 on PostgreSQL 16 (0 skipped), backend
API 9/9, shared 156/156; lint and typechecks clean. Device testing has not been
done yet (see `docs/play-launch/HANDSET_TEST_SCRIPT.md`).

**Not in this change:** hosting, secrets, Play Console setup and phone tests;
see `docs/play-launch/EXTERNAL_ACTIONS.md`.
