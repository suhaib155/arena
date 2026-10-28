# V1 truthful-claims copy changes (28 Oct)

Status: **needs owner approval (UI freeze exception).** Text strings only. No
layout, styling, navigation, component or logic change. Base `15f7f87`.
Source: rendered claims audit (#139), rows and extra findings cited.

| # | Audit ref | File | Before | After |
|---|---|---|---|---|
| 1 | row 1 | `mobile/src/components/ShareCard.tsx` | Move → Capture → Own | Move → Explore → Progress |
| 2 | row 2 | `mobile/app/season-objectives.tsx` | Own your season. | Shape your season. |
| 3 | row 4 | `mobile/src/data/contractStatus.ts` (MoveToken) | The $MOVE token contract (oracle-gated, capped supply). | Testnet reference only. MovenRun v1 has no token. |
| 4 | row 5 | `mobile/src/data/contractStatus.ts` (GPSOracle) | Verifies signed GPS routes before any on-chain action. | Testnet reference only. Not used in v1. |
| 5 | row 6 | `mobile/src/data/contractStatus.ts` (ZoneChallenge) | On-chain land-defence battles for owned zones. | Testnet reference only. No battles in v1. |
| 6 | extra 3 | `mobile/src/lib/introFlow.ts` title | Capture and defend | Explore new ground |
| 7 | extra 3 | `mobile/src/lib/introFlow.ts` body | Moving through a zone can capture or strengthen it. Return before control fades to defend your ground. | Your moves show up as a local preview of the places you have been. |
| 8 | extra 4 | `mobile/src/lib/onboardingQuestline.ts` | Refresh a zone you own by moving over it or fortifying. | Refresh a preview zone by moving over it. |
| 9 | deletion | `mobile/app/account/security.tsx` (success alert) | Your MovenRun account and its saved sessions have been permanently deleted. | Your MovenRun account data and saved sessions have been deleted. Removing the Google or wallet sign-in record may still be finishing. |
| 10 | deletion | `mobile/app/account/security.tsx` (confirm dialog) | This permanently deletes your MovenRun account, its Google or wallet sign-in record, and every verified session saved to it, and signs out all devices. | This deletes your MovenRun account data and every verified session saved to it, requests removal of its Google or wallet sign-in record, and signs out all devices. |
| 11 | deletion | `mobile/app/legal.tsx` ("Deleting your account") | This permanently removes your account, its Google or wallet sign-in record, sign-in sessions and verified sessions from MovenRun and clears progress on this device. | This removes your account data, sign-in sessions and verified sessions from MovenRun and clears progress on this device. Removal of the Google or wallet sign-in record is requested at the same time and can take longer to finish. |

Why 9 to 11: the backend answers `{deleted: true, signInRecord: "removed" | "pending" | "none"}`
(`backend/src/identity/http/router.ts:371-377` on `security/a2-deletion-queue-cas`).
The app ignores `signInRecord` and always said "permanently deleted". The new
wording is true for both outcomes and promises no timeline.

## Not changed (owner decision needed, outside text-only scope)

- Audit rows 3, 7, 8, 9 and the hard-coded pill "Base Sepolia · deployed"
  (`technical.tsx:80`): these state testnet deployment facts, not ownership or
  income. Removing them is Option B (hide the Technical info row and add
  `/settings/technical` to `FEATURE_ROUTES.wallets`), a navigation change.
- `deedPreview.ts:252` "Capture and defend a zone to unlock a fortified deed
  preview." and `territoryIntro.ts` comments: Deeds flag is off; the showroom
  is unreachable in v1.
- Zone Deed, Move Vault and Season Controller rows in `contractStatus.ts`
  (already marked future or later; "season burn" remains in the Season
  Controller row).

## Tests

- New `src/lib/__tests__/v1TruthfulClaims.test.ts` (5 tests) asserts the old
  strings are absent from the rendered sources and data.
- `introFlow.test.ts` updated for the new step title and body.
- `test-inventory.json` regenerated (88 files).
