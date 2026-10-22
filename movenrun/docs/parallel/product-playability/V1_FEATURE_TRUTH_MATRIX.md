# V1 feature truth matrix

What each Play v1 feature really does in the release build at `15f7f87`, with the
evidence behind it. The machine-readable copy is
`research/product-playability/feature-register.json`. The test
`tests/featureRegister.test.ts` fails if a screen is added without a register
entry, or if the hidden list drifts from `releaseScope.ts`.

All evidence here is LOCAL (code and unit tests). Nothing is LIVE-proven on a phone.

## States

| State | Meaning |
|---|---|
| verified_local | Works, and a named test proves it locally |
| configured_unproven | Wired up, but not proven on a real phone or a hosted service |
| preview_only | An honest preview on local data, labelled as such |
| hidden_excluded | Hidden from v1 by `releaseScope.ts` and redirected home |
| future_credits_pilot | A future credits-only private pilot (V3 J2). Not built |
| future_financial | Future financial or onchain work. Not launch eligible |

## Matrix

| Feature | Routes | State | Data | Evidence | Claim issues |
|---|---|---|---|---|---|
| Home board | `/` | verified_local | local store, `lib/tasks.ts` | mobile `tasks.test.ts`, `todayNavigation.test.ts` | "Defend N zones" in a danger tone; "Capture your first zone" |
| Intro | `/opening` | verified_local | local first-run flag | mobile `introFlow.test.ts` | Step 2 "Capture and defend" before any preview label |
| Permission education | `/move` | verified_local | `moveReadiness.ts` | mobile tests; this track's A03 to A05 | Denied and services-off copy offers "a demo route", but that button exists only in development builds |
| Start move | `/move`, `/move/session` | configured_unproven | expo-location | needs a device | None |
| GPS acquisition | `/move/session` | verified_local | shared `ON_FOOT_POLICY` | corpus A01, A02 | None |
| Pause and resume | `/move/session` | verified_local | `sessionLifecycle.ts` | `stateMachine.test.ts`, T02, L03 | None |
| Finish | `/move/session` | verified_local | `sessionLifecycle.ts` | `stateMachine.test.ts` | None |
| Save eligibility | `/move/summary` | verified_local | `isSaveable` (200 m or 5 min) | corpus | Duration is wall clock (MR-A-03) |
| Session summary | `/move/summary` | verified_local | local store | corpus | "Save + preview capture", "Common Zone" (labelled preview) |
| Server verification | `/move/summary`, `/account` | configured_unproven | `POST /movement/verify` | backend tests; this track's server harness | Honest walks under 10 points are rejected (MR-A-01) |
| History | `/route/passport`, `/route/review-history`, `/route/proof`, `/account` | verified_local | local store; server list on `/account` | mobile tests | None |
| XP and streak | `/`, `/profile`, `/result` | verified_local | local store | `xpSemantics.test.ts` | XP is banked before the server verdict (MR-A-09); the day key is the phone's clock (MR-A-08) |
| Timed quests | `/quests`, `/quest/[id]`, `/active`, `/result` | verified_local | seed quests, local store | `xpSemantics.test.ts` | "You won't earn XP if you leave now" and "Keep moving" |
| Profile | `/profile` | verified_local | local store | mobile tests | "Browse quests" opens Home, not Quests |
| Google sign-in | `/welcome`, `/account`, `/auth/callback` | configured_unproven | Supabase Auth | provider OFF per the project's launch ledger (18 Oct); not checked by this track | None |
| Wallet sign-in | `/welcome`, `/account`, `/auth/wallet` | configured_unproven | Supabase Web3 | provider OFF per the launch ledger; not checked by this track | None |
| Account deletion | `/account/security` | configured_unproven | `POST /identity/account/delete` | backend tests | Guests have no server data, so only "Reset progress" applies |
| Help and legal | `/help`, `/legal` | configured_unproven | static copy | `privacyTruth.test.ts` | `LEGAL_VERSION` reads `v1-2026-11-02`; confirm before launch |
| Technical info | `/settings/technical` | preview_only | hard-coded `contractStatus.ts` | none | Highest token and chain density in the release UI (see below) |
| Territory preview | `/territory/map`, `/zone/[id]`, `/move/captured`, `/territory/alerts`, `/collections`, `/weekly-recap`, `/season-objectives` | preview_only | local store only; no server agrees to any zone | mobile tests | "Zone Captured" stamp; "Own your season." |
| Clubs and districts | `/clubs`, `/club-territory`, `/crew-missions`, `/city-districts`, `/district-mastery` | hidden_excluded | seed data | `releaseScope` guard | n/a |
| Competition | `/city-war`, `/rivals`, `/event-zones`, `/sponsor-zones` | hidden_excluded | fictional seed | `releaseScope` guard | n/a |
| Wallet management | `/account/wallets`, `/network/status` | hidden_excluded | identity API | `releaseScope` guard | n/a |
| Deeds | `/deed-showroom` | hidden_excluded | local preview | `releaseScope` guard | n/a |
| Authoritative territory | none | future_credits_pilot | not built | none | n/a |
| MOVE token and Deeds | none | future_financial | not built | none | n/a |

Two routes are outside the matrix: `/questline` is registered but not linked and
not in `FEATURE_ROUTES`, so a deep link opens it; `/onboarding` redirects to `/opening`.

## Overclaims on release surfaces (MR-A-10)

The static checker (`claims-checker/check.ts`) scans every release screen and
everything it imports. It found 16 unlabelled fail-severity hits on 15 lines.
A static scan cannot see runtime flags, so I checked each hit by hand.

**Rendered through normal navigation (10 hits, 9 lines).** Fix before QA0.

| Where | Today | Proposed copy |
|---|---|---|
| `ShareCard.tsx:24` (quest result share card) | Move → Capture → Own | Move → Explore → Progress |
| `season-objectives.tsx:137` | Own your season. | Shape your season. |
| `contractStatus.ts:66` (Technical info) | Base Sepolia | Remove the contracts drawer from v1, or label it "Developer reference. Not part of the game." |
| `contractStatus.ts:75` | The $MOVE token contract (oracle-gated, capped supply). | Remove from v1 |
| `contractStatus.ts:83` | Verifies signed GPS routes before any on-chain action. | Remove from v1 |
| `contractStatus.ts:115` (2 hits) | On-chain land-defence battles for owned zones. | Remove from v1 |
| `networkView.ts:67` | Base Sepolia · deployed | Remove from v1 |
| `networkView.ts:79` | Base Sepolia testnet · read-only | "App details" |
| `networkView.ts:81` | The contract foundation is deployed on Base Sepolia. App gameplay runs on-device… | "MovenRun v1 is a movement game. Progress is kept on your device and your account." |

The simplest safe change for the Technical info screen is to hide its
contracts drawer behind the existing `wallets` flag. That is one condition, it
needs no new copy, and it leaves the developer view intact for later.

**Reachable only by deep link (1 hit).** `onboardingQuestline.ts:105` "Refresh a
zone you own…" on `/questline`. Proposed: add `/questline` to `FEATURE_ROUTES`,
or change the copy to "Refresh a preview zone by moving over it."

**Present in release code but hidden by a runtime flag (5 hits).** Not visible
today. They become visible the moment a flag flips, so fix them with that work:
`account/index.tsx:95` (wallets flag), `help.tsx:22` (deeds flag),
`FirstTimeGuide.tsx:22` (deeds topic only), `walletPresentation.ts:65` (used only
on the gated wallets screen), and `clubs.ts:32` "Own the waterline." (clubs seed).

The checker also lists 56 preview-vocabulary words such as "capture", "defend"
and "zone". These are review items, not failures. Most sit next to an honest
"Local preview" label. The two that do not are the Home board's "Defend N zones"
in a danger tone, and the intro's "Capture and defend" step.

## Safe disabled affordances

When a v1 screen must point at a later feature, it should:

1. Say "Later" in plain text, with no date.
2. Do nothing when tapped, or open a short explanation. Never open a blank or redirect loop.
3. Not show a count, rank, balance or price for something that does not exist.
4. Keep the existing "Preview" badge and its plain-language footnote ("Badges are in-app progress. They have no cash value and grant no ownership.").

The current gating already hides every entry point to the 12 gated routes, so no
new disabled affordance is needed for v1.
