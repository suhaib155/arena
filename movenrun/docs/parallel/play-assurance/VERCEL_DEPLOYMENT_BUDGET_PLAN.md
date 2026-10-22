# Vercel deployment budget plan (Hobby)

Checkpoint: 22 October 2026
Source heads: website 61d30bb (#116, live); #128 ops/vercel-ignore-build 49c9fe9; base 2326aa6 (#112). Official pages retrieved 2026-10-22.
Claim classes: SOURCE VERIFIED / LOCAL TEST CONFIRMED / REVIEWER REPORTED / OWNER-PROVIDER GATED / NOT RUN / UNKNOWN. No Vercel setting was read or changed; no project was disconnected or deleted.

## 1. Limits and what counts (Hobby)
| Fact | Class | Source |
|---|---|---|
| 100 deployments created per day; 100 builds per hour; 1 concurrent build; 25 projects per Git repo | SOURCE VERIFIED | https://vercel.com/docs/limits (updated 2026-09-16) |
| Default behaviour: each push deploys every project connected to the repo. Two ways to avoid it: automatic skip of unaffected projects, or Ignored Build Step | SOURCE VERIFIED | https://vercel.com/docs/monorepos (updated 2026-08-11) |
| Native skip: project is "changed" if its source, an internal dependency, or a lockfile change affecting its deps changed. Requires GitHub-connected repo, npm/yarn/pnpm/Bun workspaces, project inside the workspace definition (changes outside it count as global and deploy everything), unique package names, explicit inter-package dependencies. Toggle: Settings > Build and Deployment > Root Directory > "Skip deployment" | SOURCE VERIFIED | monorepos page |
| 21 Oct 2026 change: deployments Vercel skips automatically in a recognised monorepo no longer count toward deployment rate limits; on by default for new monorepo projects, existing projects enable it in Build and Deployment settings | SOURCE VERIFIED (short page, summarised fetch) | https://vercel.com/changelog/skipped-monorepo-deployments-no-longer-count-against-limits |
| Ignored Build Step: command runs when the deployment enters BUILDING; exit 1 = build, exit 0 = abort with state CANCELED; "Canceled builds are counted as full deployments ... still count towards your deployment quotas and concurrent build slots"; runs in the Root Directory | SOURCE VERIFIED | https://vercel.com/docs/project-configuration/project-settings (updated 2026-09-21) |
Net effect: with Ignored Build Step every unrelated push still consumes one of the 100 daily deployments per connected project (the cancel is counted). Native skipping, where it applies, does not. With four stray `arena` projects plus the website project connected to one repo, one push can consume up to 5 of the 100 (the project count is OWNER-PROVIDER GATED; X-29 text lists five).

## 2. Can native skipping scope this website? Not established
| Question | Finding | Class |
|---|---|---|
| Is the website a workspace? | No. Root `movenrun/package.json` workspaces are `shared`, `contracts`, `backend`, `mobile`; there is no `movenrun/website/package.json` | SOURCE VERIFIED @ 2326aa6 / 49c9fe9 (WEBSITE_FACTS Part 3) |
| Repo-root package.json, turbo.json, nx.json, pnpm-workspace.yaml | None. Repo root holds `.github`, `README.md`, `movenrun`, `render.yaml` | SOURCE VERIFIED |
| Does Vercel recognise a workspace graph that includes the website? | Likely no, because the website is outside the workspace definition and has no package name; Vercel documents such changes as global. A project whose Root Directory is `movenrun/website` may instead be treated as unscoped (deploy always) or by some rule not documented in the fetched pages | UNKNOWN: needs a dashboard check or a throwaway fixture, not a guess |
| Does the "Skip deployment" toggle appear for this project? | UNKNOWN (dashboard) | OWNER-PROVIDER GATED |
Test to settle it (owner, no cost beyond one deployment): enable the toggle on a single project, push a change under `movenrun/backend/` only, and read the deployment list: a "skipped" entry that is not counted versus a normal build versus a canceled build. Record the result before choosing an option.

## 3. Review of #128 at 49c9fe9
| Item | Finding | Class |
|---|---|---|
| Script location | `movenrun/ops/vercel/ignored-build.sh`, outside the served folder; README diff says it lives outside because Output Directory is `.` (vercel.json outputDirectory "." at movenrun/website/vercel.json:4 @ 49c9fe9). The earlier concern (script under `website/scripts/`, publicly served) is resolved at this head: `movenrun/website/scripts/` does not exist | SOURCE VERIFIED (`git show 49c9fe9:movenrun/ops/vercel/ignored-build.sh`) |
| Behaviour | exit 0 skip, 1 build; fails open on doubt (no git, no previous SHA, missing/shallow commit, equal SHAs, failed diff); `VERCEL_FORCE_BUILD` forces; tree diff of `movenrun/website` plus optional `IGNORED_BUILD_EXTRA_WATCH`; read-only git, no network | SOURCE VERIFIED (script lines 5-54) |
| Dashboard command | `sh ../ops/vercel/ignored-build.sh || exit 1` (README/X-29) | SOURCE VERIFIED |
| Is `../ops/vercel/` present in Vercel's build checkout when Root Directory is `movenrun/website`? | UNKNOWN until the owner checks. Vercel runs the command in the Root Directory; whether the files above it are in the checkout is not stated in the fetched pages. If absent, `sh` fails with a nonzero code and `|| exit 1` makes the build proceed (fail open, so safe but saves nothing) | UNKNOWN / OWNER-PROVIDER GATED |
| Fixture fidelity | The test creates `movenrun/website/package.json` (test line 11); the real tree has none. The script does not read it, so results transfer, but the fixture is not a faithful copy | SOURCE VERIFIED |
| Test run | I ran the 27-case fixture test from copies of both files placed in a temp directory under the session scratchpad (it only creates throwaway git repos via `mktemp -d`, touches nothing else): 27 PASS, 0 FAIL, "ALL PASS" | LOCAL TEST CONFIRMED (22 Oct 2026, 49c9fe9 content) |
| What the test does not cover | Vercel's actual checkout depth, `VERCEL_GIT_PREVIOUS_SHA` population, and the counting rule for canceled builds | NOT RUN / UNKNOWN |
| Saves quota? | No. A skip via this script is a CANCELED build that counts against the 100/day (project-settings page). It reduces build minutes and protects the live site from needless redeploys, not the deployment-count budget | SOURCE VERIFIED (doc) |
The old one-liner `git diff --quiet HEAD^ HEAD -- .` is NOT approved: it compares only the last commit's parent, so a multi-commit push (or a merge) can hide a website change and skip a needed build (the #128 test cases "multi-commit, website change in middle" and "merge commit" exist for this). Do not paste it into the dashboard; X-29 revokes it.

## 4. Options
| Option | How | Pros | Cons / unknowns |
|---|---|---|---|
| (a) Native skip setting | Root Directory > "Skip deployment" | Skipped deployments not counted (21 Oct change); no script | Website is outside the workspace definition, so scoping is unproven (UNKNOWN); may deploy always, or treat website edits as global; needs the section 2 test |
| (b) #128 as Ignored Build Step | Build and Deployment > Ignored Build Step > Custom: `sh ../ops/vercel/ignored-build.sh || exit 1` | Correct for multi-commit/merge (LOCAL TEST CONFIRMED); script not served; fail-open | Canceled builds still count; availability of `../ops` in the checkout UNKNOWN; owner must merge #128 |
| (c) Root Directory `movenrun/website` + "only build when files in this folder change" if the dashboard offers it | Project settings | No script, no checkout dependency | Existence and semantics of such a switch in current dashboard UNKNOWN (not in the fetched docs) |
| (d) Reduce connected projects | Remove the four unused `arena*` integrations | Largest saving: each push no longer creates up to 4 extra deployments | Deletion is gated (section 6) |

## 5. Recommendation and exact owner steps (no change until the owner decides)
Recommended order: (d) after inventory, then test (a) once, then fall back to (b) if (a) does not scope the website. Reason: (d) removes the dominant waste regardless of mechanism; (a) is the only option that does not count skips; (b) is a safe fallback.
1. Vercel dashboard > Projects. List every project connected to the repo. Fill the inventory in section 6. Change nothing.
2. Open the website project > Settings > Build and Deployment. Write down Root Directory, Framework, Build/Install/Output settings, Ignored Build Step value, and whether "Skip deployment" exists and its state.
3. Open Deployments for the website project and note the current Production deployment id; compare with the two recorded ids (REVIEWER REPORTED `dpl_1pNg2cyGZ4MLWuqfsSHBtU9P1KBf`; X-29 `dpl_ABCfgjsFiJ4DHtRnrLPCc8npLAuD`). Keep the previous production deployment as the rollback target.
4. Run the one-push test in section 2 on the website project only. Record: built / skipped (not counted) / canceled (counted).
5. If native skipping scopes the website correctly, keep it on and leave Ignored Build Step empty. If not, merge #128 (owner decision), set the (b) command, and run one backend-only push and one website-only push to confirm CANCELED vs built. If the script fails to find `../ops`, the build proceeds; record it and use (d) instead.
6. Watch the Deployments count per day; planning tripwire 50 of 100 (owner may change).

## 6. Inventory checklist: arena, arena-pchb, arena-qg9n, arena-vv61
All fields UNKNOWN pending dashboard.
| Field | arena | arena-pchb | arena-qg9n | arena-vv61 |
|---|---|---|---|---|
| Exists / connected repo and branch | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Root Directory | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Production domains / aliases attached | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Env vars present (names only) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Current production deployment id | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Used as a rollback dependency for the live site | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Deployments in last 7 days | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Owner decision (keep / disconnect Git / delete) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
Rule: no disconnect and no delete until domains, aliases and rollback dependencies for all four are inventoried and the website's own rollback deployment is confirmed. Prefer "disconnect Git" before "delete" (reversible). Nothing here is authorised to be changed by this document.

## Integration digest
- Affected paths: this file only. Evidence: 49c9fe9 script/test read; fixture run 27/27 in a temp dir; official pages 2026-10-22. No conflict with #128 (read-only; no edits proposed to it).
- Open: `../ops/vercel/` in the build checkout (UNKNOWN); native skip scoping of a non-workspace website (UNKNOWN).
- Next decisions (owner): (1) approve the dashboard inventory/test steps; (2) merge #128 only if native skipping fails; (3) decide on the four `arena*` projects after inventory.
