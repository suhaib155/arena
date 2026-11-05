# Vercel project and build-budget cleanup plan (29 Oct 2026)

Plan only. Nothing was changed, disconnected, deleted or redeployed, and no Vercel or Render API was written to. The live website deployment `dpl_ABCfgjsFiJ4DHtRnrLPCc8npLAuD` is never touched by any step below. This builds on `docs/parallel/play-assurance/VERCEL_DEPLOYMENT_BUDGET_PLAN.md` (branch `research/parallel-c-play-assurance`, 22 Oct), whose open questions are updated with new evidence.

Marks: VERIFIED (how) or UNVERIFIED (needs the dashboard). No Vercel read tool was available in this session, so no dashboard value was read.

## 1. What is known

| Fact | Mark | How |
|---|---|---|
| Five Vercel projects report a status on every push to the repository: `movenrun-website`, `arena`, `arena-pchb`, `arena-qg9n`, `arena-vv61` | VERIFIED | GitHub commit statuses of `a2a3eec` (29 Oct 06:36Z) and `49c9fe9` (22 Oct): five `Vercel – <project>` contexts each |
| All five are in one Vercel team (`ghantareum-4453s-projects`) | VERIFIED | status target URLs |
| `arena`, `arena-pchb` and `arena-qg9n` fail their builds on current heads and did on 22 Oct and on #105 (9 Sep); `arena-vv61` and `movenrun-website` succeed | VERIFIED for the 22 and 29 Oct heads; the #105 (9 Sep) claim is from a PR queue note, not from the cited commit statuses | same statuses; PR queue note |
| On 29 Oct 18:13Z the head `106ab56` shows all five as "Deployment rate limited, retry in 24 hours" | VERIFIED | commit status |
| The 100 newest GitHub deployment records span 28 Oct (18) and 29 Oct (82), all Preview, one per project per push: arena 23, arena-pchb 20, arena-qg9n 21, arena-vv61 18, movenrun-website 17, plus one Render staging record. Older pages could not be listed through the proxy | VERIFIED | GitHub deployments API, first page |
| So about 99 preview builds in roughly 30 hours; at five per push that is about 20 pushes, 16 of them on 29 Oct | VERIFIED (arithmetic on the above). The "about 20 pushes" figure is arithmetic over the newest 100 deployment records only. Daily counts drift because the window is rolling; today by environment: Preview arena 24, arena-pchb 20, arena-qg9n 20, arena-vv61 18, movenrun-website 17 | |
| Hobby limit 100 deployments per day; canceled ignored builds still count | VERIFIED second-hand (vendor pages cited in the 22 Oct plan, not re-read) | vendor pages cited there |
| A skipped deployment in a recognised monorepo is not counted since 21 Oct | UNVERIFIED | changelog page cited in the 22 Oct plan (short page); and the website is not a workspace member (`movenrun/package.json` workspaces: shared, contracts, backend, mobile; no `website/package.json`), so scoping is unproven |
| Production website: `dpl_ABCfgjsFiJ4DHtRnrLPCc8npLAuD` (61d30bb), rollback `dpl_1pNg2cyGZ4MLWuqfsSHBtU9P1KBf`, aliases `movenrun.xyz`, `www.movenrun.xyz` | UNVERIFIED here | register entry E-79 records the owner's promotion; not re-read in the dashboard |
| Root directory, git connection, domains, env vars, last production deploy of each of the four extra projects | UNVERIFIED | dashboard only |
| `movenrun-website` Root Directory is `movenrun/website`, output directory `.` | VERIFIED for the output directory (`website/vercel.json`); root directory UNVERIFIED | |
| The ignored-build script on `ops/vercel-ignore-build` (49c9fe9): exit 0 skips, exit 1 builds, fails open, read-only git, tree diff between previous and current commit, `VERCEL_FORCE_BUILD` override, lives in `movenrun/ops/vercel/` outside the served folder | VERIFIED | read in full; its 27-case fixture test passed in the 22 Oct review (not rerun) |
| Whether `../ops/vercel/` exists in Vercel's checkout when Root Directory is `movenrun/website` | UNVERIFIED | if absent, `sh` fails and `|| exit 1` makes the build proceed: safe, saves nothing |

## 2. Why the cap is exhausted

Every push creates a preview deployment in each connected project, and a build that is then cancelled by an ignored-build step still counts. Four of the five projects are not the live site, and three of those four fail every build. With five projects and about 16 pushes a day (many reviewed branches, stacked pull requests, CI-only and documentation-only commits) the 100-a-day limit is reached in under a day, and Vercel then refuses even `movenrun-website`, whose previews are the ones that matter.

## 3. Projects: keep or remove

| Project | Evidence it is a duplicate or stale | Evidence needed before the owner removes it |
|---|---|---|
| `arena` | Name matches the repository; failing build since at least 9 Sep (VERIFIED) | Root directory (likely the repository root, which has no website); any domain or alias; env var names; last production deployment; confirm it is not the project behind any `*.vercel.app` link still referenced in docs |
| `arena-pchb` | Same failure pattern (VERIFIED); random suffix suggests an accidental import | Same list |
| `arena-qg9n` | Same (VERIFIED) | Same list |
| `arena-vv61` | Builds succeed (VERIFIED), so it may be configured to the website folder. Not a failure, so it is the one most likely to have a purpose | Same list, plus its root directory compared with `movenrun-website`; whether any domain or alias is attached; whether any deployment is the website's rollback target |
| `movenrun-website` | The live project | Keep. Record Settings values (root directory, ignored build step, domains, current production id) before any change |

Rule: no removal until, for all four, no domain or alias is attached, none holds the production or rollback deployment of the website, and the website's own production id is confirmed. Prefer Disconnect Git over Delete (reversible); Delete only after a week with no effect.

## 4. Ways to stop preview builds

| Option | Steps (owner, dashboard) | Counts toward 100/day? | Risk | Rollback |
|---|---|---|---|---|
| A. Disconnect Git on the four extra projects (recommended first) | Each project: Settings, Git, Disconnect. Do one, push a test commit, confirm only four statuses appear, then the next | Removes up to 4 of every 5 | Low: no production traffic if the inventory in section 3 is clean. A disconnected project stops updating; its existing deployments and domains keep working | Settings, Git, Connect Git Repository, select the repository again |
| B. Ignored Build Step on `movenrun-website` (script from `ops/vercel-ignore-build`, needs that branch merged by the owner) | Settings, Build and Deployment, Ignored Build Step, Custom: `sh ../ops/vercel/ignored-build.sh \|\| exit 1`. Do not use `git diff --quiet HEAD^ HEAD -- .` (revoked, hides multi-commit changes) | Yes (cancelled builds count); saves build minutes and needless redeploys only | Low, fails open | Clear the field |
| C. Native Skip deployment (monorepo skipping) | Settings, Build and Deployment, enable Skip deployment; push a change touching only `movenrun/backend/` and read the list | No, if it scopes the website | Unproven for a folder outside the workspace definition. It may deploy always, or treat website edits as global | Turn the toggle off |
| D. Delete the four projects | Settings, Advanced, Delete | Same effect as A | Irreversible; loses deployment history and domains | None. Not recommended until A has run for a week |
| E. Stop previews for the website too (Settings, Git, disable Preview Deployments, if offered) | Production branch deploys only | Almost all | Loses website previews for review (the website has a review preview step in the docs) | Re-enable |

## 5. Expected deployments per day

Let P be pushes per day (about 16 now).

| State | Deployments counted per day |
|---|---|
| Today | 5P, about 80 at P = 16: at the limit |
| After A | P, about 16, with the same P up to 100 pushes |
| After A and B | P (cancelled builds still count) |
| After A and C, if C scopes the website | only pushes that change the website, likely 0 to 3 |
| After A and E | production promotions only |

## 6. Order and checks

1. Read only: record every project's settings per section 3, and the website's current production deployment id against E-79. Stop if the id differs.
2. Option A on one project, one test push, check the status list and that `https://movenrun.xyz/` still answers (200). Repeat for the others.
3. Option C test once; if the website is not scoped, merge the script branch and use B.
4. Watch the daily count for a week; tripwire 50 of 100. Decide on D only after that.
5. Never run a deploy or promotion from this plan; the production deployment id above must be unchanged at every step.

## 7. Blocked or not done

- No dashboard or API read of Vercel: no Vercel tool was present in this session, and the brief forbids workarounds. Every dashboard field above stays UNVERIFIED.
- The GitHub deployment history older than the newest 100 records could not be paged through the proxy, so the daily rate before 28 Oct is unknown.
