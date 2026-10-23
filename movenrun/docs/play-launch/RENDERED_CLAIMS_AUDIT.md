# Rendered claims audit (Track A MR-A-10)

Base: `15f7f87` (Android QA0 candidate). Docs only. No mobile code or UI was
changed. Every proposed change below needs owner approval because mobile UI is
frozen.

Source of the list: Track A, `V1_FEATURE_TRUTH_MATRIX.md`, "Overclaims on
release surfaces (MR-A-10)": 10 hits on 9 lines rendered through normal
navigation. The Track A line numbers all reproduce on `15f7f87`.

## Release flags in force at 15f7f87

`src/lib/releaseScope.ts` is a hard-coded switchboard, with no environment or
build-profile override: `clubs: false`, `competition: false`, `deeds: false`,
`wallets: false`. `FEATURE_ROUTES.wallets` covers only `/account/wallets` and
`/network/status`. `/settings/technical` and `/season-objectives` are in no
`FEATURE_ROUTES` list, so no flag hides them. `/network/status` redirects to
`/settings/technical`, but that route is itself guarded.

## Reachability paths (verified)

- Technical info: Profile tab, "Technical info" row, `app/(tabs)/profile.tsx:286-290`,
  unconditional, in the same group as Account, Help and Legal. The hero, the
  "This device" rows and the safety card show on open. The contracts drawer
  (`app/settings/technical.tsx:~112-155`) is collapsed by default and opens on
  tapping "Technical details".
- Season Objectives: Profile tab, `app/(tabs)/profile.tsx:195-200`, unconditional.
  Also reached from Weekly Recap (`app/weekly-recap.tsx:217`).
- Share card: `app/result.tsx:227` renders it on every Warmup Quest result
  (`app/active.tsx:51` routes to `/result`). It is on screen, not only in the
  share action.

## Table

"True for v1" means true for a movement game with no tokens, NFTs or balances,
where territory is a local preview.

| # | Claim | File:line | Reachable in v1 (flag evidence) | True for v1 | Proposed minimal change | Owner approval needed |
|---|---|---|---|---|---|---|
| 1 | "Move → Capture → Own" | `src/components/ShareCard.tsx:24` | Yes. Rendered on `/result` after any Warmup Quest (`app/result.tsx:227`). No flag involved; no flag covers `/result`. | No. "Own" implies ownership; v1 has none and capture is a local preview. | One-line copy: "Move → Explore → Progress" (Track A wording). | Yes |
| 2 | "Own your season." | `app/season-objectives.tsx:137` | Yes. Profile row (`profile.tsx:195-200`) is unconditional; route not in `FEATURE_ROUTES`. `seasonObjectives.ts` filters only club-group objectives with the `clubs` flag. | No. No ownership, and the season is a local objective list. | One-line copy: "Shape your season." | Yes |
| 3 | "Base Sepolia" (Network row, `status.networkName`) | `src/data/contractStatus.ts:66`, rendered at `app/settings/technical.tsx:~112` | Yes, after expanding "Technical details". Reached from Profile > Technical info (`profile.tsx:289`). `wallets: false` does not hide this route. | Misleading. It is a testnet deployment record, unrelated to v1 play, and it shows as an app property. | Gate the drawer behind `isFeatureInRelease("wallets")` (see Option A), or relabel "Developer reference. Not part of the game." | Yes |
| 4 | "The $MOVE token contract (oracle-gated, capped supply)." | `src/data/contractStatus.ts:75` (MoveToken row, `technical.tsx:~150`) | Yes, same path as #3, drawer open. | No. v1 has no token; the line reads as a live token. | Same gate as #3 (the row disappears with the drawer). | Yes |
| 5 | "Verifies signed GPS routes before any on-chain action." | `src/data/contractStatus.ts:83` (GPSOracle row) | Yes, same path as #3, drawer open. | No. Nothing in v1 goes on-chain; it also implies signed-route verification the app does not do. | Same gate as #3. | Yes |
| 6 | "On-chain land-defence battles for owned zones." (two checker hits on one line: "On-chain" and "owned zones") | `src/data/contractStatus.ts:115` (ZoneChallenge row) | Yes, same path as #3, drawer open. | No. No battles, no owned zones, no chain in v1. | Same gate as #3. | Yes |
| 7 | "Base Sepolia · deployed" (chain row value) | `src/lib/networkView.ts:67`, shown in the "This device" card (`technical.tsx:~91-96`) | Yes, visible on opening Technical info, no drawer tap. Not hidden by the drawer gate. | Misleading. A deployment status is not a v1 feature. | Hide the whole screen entry (Option B), or copy: "Not used in v1". | Yes |
| 8 | "Base Sepolia testnet · read-only" (hero title, `dominantLabel`) | `src/lib/networkView.ts:79`, rendered at `technical.tsx:~75` | Yes, first thing shown on Technical info. | Misleading, same reason as #7. | Option B, or copy: "App details" (Track A wording). | Yes |
| 9 | "The contract foundation is deployed on Base Sepolia. App gameplay runs on-device and off-chain during beta ..." (hero detail) | `src/lib/networkView.ts:81`, rendered at `technical.tsx:~77` | Yes, same as #8. | Half true. The second sentence is accurate; the first advertises chain deployment. | Option B, or copy: "MovenRun v1 is a movement game. Progress is kept on your device and your account." | Yes |

That is 9 table rows covering all 10 Track A hits (row 6 is two hits). The hits
sit in three files plus the screen.

## Extra findings (not in Track A's 10)

1. `app/settings/technical.tsx:80` hard-codes a pill "Base Sepolia · deployed"
   in the hero, independent of `networkView.ts`. Any fix to `networkView.ts`
   alone leaves it visible. Hiding the drawer alone also leaves it.
2. `technical.tsx:~146` heading "Public contract foundation" and the "Zone Deed
   NFTs", "Gear", "Move Vault" and "Season Controller ... season burn" rows in
   `contractStatus.ts:91-130` render under the same drawer. They are covered by
   the same gate as #3 to #6 but were not counted by Track A's checker.
3. `src/lib/introFlow.ts:83` "Capture and defend / Moving through a zone can
   capture or strengthen it. Return before control fades to defend your
   ground." is shown in the opening intro (`app/opening.tsx`). It is not one of
   the 10, and not a token claim, but it asserts live capture and defence.
   Track A listed it as a review item. Candidate copy: "Explore new ground"
   with "Your moves show up as a local preview of the places you have been."
4. `src/lib/onboardingQuestline.ts:105` "Refresh a zone you own by moving over it
   or fortifying." renders only at `/questline`. The route is registered
   (`app/_layout.tsx:180`) but nothing links to it (confirmed: no
   `router.push("/questline")` in `app` or `src`) and it is not in
   `FEATURE_ROUTES`. Deep link only. Confirmed as Track A states. Fix on the
   same UX0 request: copy "Refresh a preview zone by moving over it.".
5. Track A's "simplest safe change" (hide the contracts drawer behind the
   `wallets` flag) fixes only #3 to #6 (and the extra rows in 2). It does not
   fix #7 to #9 or the hard-coded pill (item 1), which sit outside the drawer.
   This refines the Track A claim.

## Confirm or refute of Track A claims

- All 10 hits: confirmed rendered on `15f7f87` through normal navigation, none
  flagged off. The five Track A "hidden by runtime flag" items were not
  re-audited line by line except that `RELEASE_FEATURES` is all `false`, which
  is consistent with them being hidden.
- Reachability of #3 to #6 needs one extra tap (open "Technical details").
  Track A did not say so. #7 to #9 and #1, #2 need no extra tap.
- Track A's one-condition fix: partly refuted, as in finding 5.

## Two ways to remove the Technical info claims

- Option A (Track A): wrap the contracts block in
  `technical.tsx` with `isFeatureInRelease("wallets") ? ... : null`. Fixes #3 to
  #6 only. Copy for #7 to #9 and the pill still has to change.
- Option B (complete, still tiny): hide the "Technical info" row at
  `profile.tsx:286-290` behind `isFeatureInRelease("wallets")` and add
  `"/settings/technical"` to `FEATURE_ROUTES.wallets` in `releaseScope.ts`. That
  removes #3 to #9 and the pill together, since the screen exists only to show
  network and contract state. Cost: reviewers and players lose the "app and
  connection details" page; the tests `networkView.test.ts` and
  `phase5Guards.test.ts:101`, which pin "Base Sepolia" strings, stay valid
  because the code is unchanged, and `releaseNavigation.test.ts` /
  `releaseScope.test.ts` would need a case for the new route. Check that no
  Play data-safety or support text sends users to that page before choosing B.

## Recommended single UX0 request

Copy: #1 and #2 (two one-line changes). Visibility: Option B (or A plus three
copy lines for #7 to #9 and the pill). Optional: findings 3 and 4 copy. Nothing
here changes behaviour; all of it is for the owner to approve while the UI is
frozen.
