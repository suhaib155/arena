# Task register

Prefixes: **M** mobile, **B** backend and auth, **P** privacy and deletion,
**A** store assets, **R** release build and signing, **QA** device testing,
**O** operations. States: DONE, OPEN (unblocked engineering), BLOCKED (needs an
item from `EXTERNAL_ACTIONS.md`).

| ID | Task | State | Evidence / blocker |
|---|---|---|---|
| M-01 | Integrate the SDK 54 stack (#102–#105) on one release branch | DONE | E-01 |
| M-02 | Freeze Play v1 scope: hide Clubs, competition, Deeds, wallets; route guard; tests | DONE | E-05, `FEATURE_MATRIX.md` |
| M-03 | Remove economy and ownership wording from reachable copy (legal, captured, collections, splash) | DONE | 83685ac, a18a196 |
| M-04 | Delete account in Account security | DONE | E-10 |
| M-05 | Show the account's verified sessions after sign-in / reinstall | DONE | E-13 |
| M-06 | Release config: EAS production profile, remote version codes, permission removal | DONE | E-07 |
| M-07 | Hermes export check in mobile CI | DONE | 626f3c0 |
| M-08 | Restore local XP and streaks from the server after reinstall | DEFERRED (D-07) | |
| B-01 | Hard account erasure endpoint `POST /identity/account/delete` | DONE | E-09 |
| B-02 | Reviewer sign-in through server secrets | DONE | E-12 |
| B-03 | `GET /movement/verifications` for the signed-in player | DONE | E-13 |
| B-04 | Remove unused AI SDK dependency | DONE | 915727b |
| B-05 | Provision hosting, run migrations, set secrets | BLOCKED | X-03, X-05 (owner dashboards; no host or Supabase access from this workspace) |
| B-06 | Real email delivery | BLOCKED | X-06 |
| B-08 | Row level security on every table (blocks a hosted database's automatic REST API) | DONE | E-18 |
| B-09 | Prove verified TLS to a managed Postgres for the API and migrations | DONE | E-17 |
| B-10 | No-cost staging runbook (Supabase + Render Free) | DONE | `HOSTING_SUPABASE_FREE.md` |
| B-07 | Shared rate limiter across instances (current global and write limiter is in memory; OTP throttling is already in Postgres) | OPEN, needed only if more than one instance runs | |
| P-01 | Data inventory | DONE | `DATA_INVENTORY.md` |
| P-02 | Privacy policy page | DONE (placeholders) | `website/privacy/` |
| P-03 | Web account deletion page with working flow | DONE (placeholders) | E-11 |
| P-04 | Support page | DONE (placeholders) | `website/support/` |
| P-05 | Fill developer name, support email, host, backup retention, API URL | BLOCKED | X-02, X-03; E-15 fails until done |
| P-06 | Deploy the website and check every URL loads without sign-in | BLOCKED | After P-05 |
| P-10 | Purge expired OTP rows for emails that never created an account | DONE | E-16 |
| A-01 | App icon, adaptive icon, monochrome icon, splash | DONE | E-14 |
| A-02 | Play icon 512 and feature graphic | DONE | E-14 |
| A-03 | Store listing text | DONE | `STORE_LISTING.md` |
| A-04 | Phone screenshots | BLOCKED | X-13 |
| R-01 | Production AAB workflow with release gates and approval environment | DONE | `.github/workflows/eas-production-aab.yml` |
| R-02 | EAS production environment variables and Maps key restriction | BLOCKED | X-08 |
| R-03 | Build the AAB | BLOCKED | X-09, X-14 |
| R-04 | Check the AAB's merged manifest, 64-bit libraries and 16 KB page size | BLOCKED | X-12 |
| R-05 | Play App Signing enrolment and SHA-1 added to the Maps key | BLOCKED | X-08, X-11 |
| QA-01 | Handset script on preview APK | BLOCKED | X-04, X-10 |
| QA-02 | Two-account check on hosted API | BLOCKED | B-05 |
| QA-03 | Handset script on Play internal test | BLOCKED | X-12 |
| O-01 | Play Console app, declarations, listing | BLOCKED | X-11 |
| O-02 | Closed test (12 testers, 14 days) if the account requires it | BLOCKED | X-01, X-15 |
| O-03 | Production release and rollout | BLOCKED | X-16 (owner only) |
| O-04 | 48-hour post-release monitoring plan | DONE | `POST_LAUNCH_MONITORING.md` |
| O-05 | Run and record the 48-hour monitoring | BLOCKED | X-18, after X-16 |
