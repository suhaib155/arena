# MovenRun: X-06 approved, operator handoff, website previews

**Written:** 13 Oct 2026, 18:45 UTC
**Code described:** `dd8306588667342fab2db0ebd4d55632acadb57a` on `deploy/render-free-staging` (unchanged; no code was changed in this milestone)
**Docs:** `chore/post-security-launch-prep`
**Target:** 2 Nov 2026 for engineering and pre-listing readiness, not a Play date.

STATUS: STOP — X-06 APPROVED, OPERATOR ACCESS REQUIRED; OTHER ENGINEERING CONTINUES

## 1. Branches and parallel work

| Branch | Commit | Relation |
|---|---|---|
| `deploy/render-free-staging` | dd83065 | The approved deploy source; not moved |
| `chore/post-security-launch-prep` | this milestone's docs commit | dd83065 plus documentation only (checked with `git diff --name-only`: nothing outside `movenrun/docs/`) |
| `fix/play-auth-security-gate` | b4612bb | Ancestor |
| `release/android-v1-cxfdbd` | 991ac6a | Ancestor |
| `main` | d344c3b | Not merged |

**Parallel work:**
- No other branch was pushed after 11 Sep, except the four above.
- The open pull requests (#98–#105) are September drafts. None touch this work.
- I can see only pushed branches and reports, not other private chats. If another session is still running, its unpushed work is not visible here.
- This milestone worked only on its own docs branch; the deploy branch was not moved.

## 2. X-06: approved, not deployed

**Why it is not deployed:** this workspace cannot reach `api.render.com`, `dashboard.render.com`, `*.supabase.co` or the Supabase pooler. Every request fails at the network policy, and no Render or Supabase credential exists here.

**What that means:**
- Nothing was deployed and no migration was applied to the live database.
- I am not asking you to approve X-06 again.

**How you run it:** `LIVE_SETUP_OPERATOR_GUIDE.md` gate X-06 covers:
- the preflight checks: empty project, no prior migrations, the right commit;
- the Supabase and Render clicks;
- the proof commands;
- **what to bring back**: the service URL, the deploy id and commit, a screenshot showing the Free plan with no payment method, and the proof outputs.

**Workspace access (optional):** to let a future session check the deployed service itself, add `movenrun-staging-api.onrender.com` (or the URL Render gives) under Project settings → environment → Network access. This project uses the built-in environment, which has no settings, so this means adding a cloud environment first. Even then, deploying needs your Render login, so the clicks stay yours.

## 3. Work done in this milestone

| What | Result | Files |
|---|---|---|
| Backup and restore drill on throwaway databases | Found and fixed a real gap: the documented `pg_dump --no-privileges` restores the sign-up hook callable by `anon`. Fixed: keep privileges, restore only into an empty database, re-assert the grants afterwards with a check (E-37, D-33) | `LIVE_SETUP_OPERATOR_GUIDE.md` |
| X-06 preflight | Added a check that `drizzle.__drizzle_migrations` does not exist yet, plus a list of proofs to bring back | `LIVE_SETUP_OPERATOR_GUIDE.md` |
| Website previews | Four pages at desktop and mobile widths from the Git sources: no sideways scroll, no script errors, nothing connected live (E-38) | `WEBSITE_REVIEW_PREVIEW.md`, `evidence/website-preview-shots.mjs`, screenshots in the shared folder |
| Staging monitoring | Manual weekly checks for cold starts, quotas, paused project, account count, refusals, pending deletions and sign-up bursts | `FREE_HOSTING_READINESS.md` |
| Ledger | X-06 marked APPROVED — OPERATOR ACCESS REQUIRED; X-21 held for review | `EXTERNAL_ACTIONS.md`, `TASK_REGISTER.md`, `DECISIONS.md` (D-32, D-33), `EVIDENCE_REGISTER.md`, `EXECUTION_STATUS.md` |

**Approvals:**
- Consumed: X-06. It is approved, but it can only be carried out by you.
- Still withheld: X-07, X-05, X-21, X-04/X-08, X-14 and X-23, plus Play registration.

## 4. Tests

No code changed, so the counts from dd83065 stand:

| Suite | Result |
|---|---|
| Backend | 406/406, 0 skipped |
| API | 17/17, 0 skipped |
| Website end-to-end | 23/23 |
| Shared | 156/156 |
| Mobile (unchanged) | 910/910 |

**Run in this milestone** (PostgreSQL 16, Node 22, Chromium):
- the backup drill;
- the preview render.

## 5. Website: X-21 is NOT approved

Screenshots of `/privacy/`, `/support/`, `/account-deletion/` and `/sign-in/` (desktop and mobile) are in the shared folder `website-preview/`. Points for you to decide:
- **Privacy policy date:** it says "Effective 2 November 2026".
- **Response promises:** support replies within 3 working days, and email deletion within 30 days.
- **Placeholder wording:** the sign-in page's placeholder message reads oddly.
- **Homepage:** it still describes districts, clubs, Zone Deeds and "Mainnet at launch". It was not edited.

## 6. Risks

| Risk | State |
|---|---|
| F-06 wallet code phishing | Mitigated, not solved; needs the phone test, then X-23 (app change, on hold) |
| Free host cold starts and restarts | About a minute to wake. Clean-up catches up on wake. Not a public production service |
| No Play developer account | X-01a/b; Play steps cannot start |
| No database backups on Free | Owner-run dump, now drilled |
| Homepage claims beyond v1 | Flagged for your decision before X-21 |

Next recommended action: run X-06 from `LIVE_SETUP_OPERATOR_GUIDE.md` on `deploy/render-free-staging` at dd83065 (Free plan, no payment method) and send back the service URL, the deploy id and the `/ready` and migration-hash outputs.

Resume: read `EXECUTION_STATUS.md`, then this report; continue on `chore/post-security-launch-prep`; never move the deploy branch without owner approval.
