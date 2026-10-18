# MovenRun: free hosting readiness (Render Free + Supabase Free)

**Date:** 13 Oct 2026 · **Repository:** `suhaib155/arena` · **Code described:** `dd8306588667342fab2db0ebd4d55632acadb57a`
**Engineering and pre-listing target:** 2 Nov 2026 (not a Play availability date)

STATUS: STOP — LIVE AUTH AND ANDROID DEVICE GATES PENDING

## Summary

- **Hosting:** your choice, Render Free for the API and the existing Supabase Free project for sign-in and the database. It is prepared, not deployed.
- **One deployable source:** every security and cold-start fix is in a single source, the branch **`deploy/render-free-staging`** at the commit above. The Render Blueprint now deploys that branch instead of the outdated release branch.
- **Background clean-up:** it no longer depends on the server staying awake.
- **Unchanged:** nothing live was touched, and the app's UI is unchanged.

## 1. Source branch and SHA

| Branch | Commit | In the deploy source? |
|---|---|---|
| `release/android-v1-cxfdbd` | 991ac6a | Yes (ancestor) |
| `fix/play-auth-security-gate` | b4612bb | Yes (ancestor) |
| `chore/post-security-launch-prep` before today | ea5d58a | Yes (ancestor) |
| **`deploy/render-free-staging`** | **dd8306588667342fab2db0ebd4d55632acadb57a** | This is it |
| `main` | d344c3b | Not merged (X-14, your decision) |

- **How ancestry was checked:** with `git merge-base --is-ancestor` and log diffs both ways.
- **No newer parallel work:** no other branch has commits newer than 11 Sep that this source lacks.
- **Fixes included:**
  - cold-start handling (1f69dfc);
  - email codes unwired (728165e);
  - all security fixes (688d8b3, e79a1e2, cae5f88, 41b78a8);
  - today's hosting work (dd83065).
- **Migrations:** 0000–0009, with checksums pinned.
- **History:** no force-push, no rewrite.

## 2. Hosting choice and official limits (read 13 Oct)

**Render Free:**
- Sleeps after 15 idle minutes and takes about a minute to wake.
- 750 instance hours a month.
- May restart at any time; ephemeral disk; one instance.
- Render's own words: "Do not use them for production applications."
- **Without a payment method, overages suspend the service instead of billing.**

**Supabase Free:**
- 500 MB database, 50,000 monthly users, 5 GB egress.
- Pauses after a week idle.
- **No backups.**

**Fit:** fine for staging, internal and closed testing. It is not an uninterrupted public service. 1,000 registered accounts does not mean 1,000 people at once.

**Alternatives noted, not adopted:**
- Koyeb Free has similar limits.
- Cloud Run needs a billing account.
- Oracle Always Free carries a heavy operations load.

## 3. Render Blueprint correction

- **Branch:** `render.yaml` now names `deploy/render-free-staging`; it used to name `release/android-v1-cxfdbd`, which predates every security fix.
- **Guard test:** `renderBlueprint.test.ts` fails if the file changes any of these:
  - the branch;
  - manual deploy;
  - free plan, one instance, Virginia;
  - having no Render database;
  - the immutable install;
  - migrating before start;
  - the `/ready` health check;
  - keeping the three secrets out of the file.
- **CI:** backend CI now runs on Blueprint changes.

## 4. Background job reliability

Before this change, the deletion retry and the orphan sweep ran on `setInterval`, so they ran only while the server was awake.

**Now they run when due:**
- 5 seconds after every start or wake;
- after any request;
- once a minute while awake.

**Safety of the runs:**
- A task never runs twice at once.
- Failures log a fixed line and retry when next due.
- Only counts are logged.

**Unaffected by sleep:** these are all enforced in PostgreSQL, so no timer is involved:
- the 1,000 cap and the 50/hour quota;
- code and nonce expiry;
- session revocation.

**Only weaker after a restart:** the in-memory rate limits. The database quota and Supabase's per-IP limits remain.

**No keep-awake pings were added.**

## 5. Cost and usage protection

| Service | What to keep |
|---|---|
| Render | Free Hobby workspace, Free instance, **no payment method** |
| Supabase | Free organization, no add-ons; check Usage weekly |
| Vercel | Hobby, no card |
| Google Cloud | Budget alert if a billing account is ever needed for Maps (your decision) |
| Expo | Free build quota |

**Backups:** take the owner-run, encrypted `pg_dump` from the operator guide. Never store dumps in Git, chat or shared folders.

**Load-test plan:** written, covering cold start, pilot traffic, rate limit, database size, egress and fail-closed at the cap. It has not been run against anything live.

## 6. Tests (toolchain: Node 22, Yarn 4.9.1, PostgreSQL 16, Chromium)

| Suite | Result |
|---|---|
| Backend | **406/406**, 0 skipped |
| API runtime + maintenance + Blueprint | **17/17**, 0 skipped (was 10) |
| Website end-to-end | **23/23** |
| Shared / mobile (unchanged code) | 156/156 / 910/910 (from the previous milestone; no shared or mobile file changed) |
| Secret scan, tree and full history | Clean |
| `yarn install --immutable` | Passes |

## 7. Migrations and verified TLS

**Start-command rehearsal.** The exact Blueprint start command ran against a fresh PostgreSQL 16 with `sslmode=verify-full` and a private CA:
- migrations applied, and `/ready` answered ready in 3 seconds;
- without the CA, the connection was refused;
- no key or connection string appeared in the log.

**Migration integrity.** drizzle applies the migrations in one transaction, and the hashes it records equal `CHECKSUMS.sha256`.

## 8. Deployed versus prepared

**Deployed:** nothing.

**Not done:**
- no Render service, live migration or provider change;
- no DNS change, build or payment;
- no merge.

**Prepared:**
- the deploy branch;
- the Blueprint;
- the operator guide with X-06 click by click;
- the readiness notes.

## 9. What I need from you

Approve each step separately, in this order (`LIVE_SETUP_OPERATOR_GUIDE.md`):

1. **X-06:** create the Render Free service from `deploy/render-free-staging` at `dd83065`, with no payment method. Its first start applies migrations 0000–0009 to the live database.
2. **X-07:** attach the before-user-created hook and run the grant checks.
3. **X-05:** enable Google and Web3. Then run X-07b: set the quota to 0, confirm one new sign-up is refused, and set it back to 50.
4. **X-21:** put the website live at movenrun.xyz.

After those: X-08, X-04 and the phone test X-10. The Play account (X-01a/b) is still not created.

## 10. Remaining risk

**F-06**, wallet code phishing, is mitigated but not solved. No mobile change is possible while the frontend hold stands. The current implementation is not called production-secure until the phone evidence exists and you decide.

Next recommended action: approve X-06 when ready, using the click-by-click steps for `deploy/render-free-staging` at dd83065, then X-07, X-05 (with the hook proof) and X-21 in that order.
