# Deletion copy audit, 30 October 2026

Owner decision (30 October 2026): show "Deletion requested" or "Deletion pending" until completion is verified. Never claim permanent deletion while provider removal remains outstanding. No time frames, publication dates or support-response promises.

What the server says (`backend/src/identity/http/router.ts`, `POST /identity/account/delete`):

- 200 `{ deleted: true, status: "completed", signInRecord: "removed" | "none" | "pending" }`. The 200 body can still carry `signInRecord: "pending"` when the provider removal has not finished, so a 200 alone does not prove completion.
- 202 `{ deleted: false, status: "pending", requestId, signedOut: true, signInRecord: "pending" }`: accepted and queued, finishes in the background.
- 409 `account_deletion_pending`: a deletion is already in progress.
- 503 `deletion_busy` (with `Retry-After`): nothing was changed or scheduled.

## Already corrected on the two fix branches

| Surface | Branch | Change |
| --- | --- | --- |
| Android security screen alert, confirm dialog, caption; legal screen | `fix/deletion-copy-android-30oct` | "Deletion requested" unless the response confirms completion including the sign-in record; "Deletion pending" for 409; "Nothing was deleted" for 503 |
| Website `account-deletion/index.html` (lede, "happens immediately", confirm prompt, 202/200/409/503 messages, email option) | `fix/deletion-copy-web-30oct` | Same wording; "within 30 days" removed |

## Other places that make a deletion claim (not edited here)

| # | Location | Current wording | Problem | Proposed wording |
| --- | --- | --- | --- | --- |
| 1 | `website/privacy/index.html` line 36 (summary list) | "You can delete your account and its data in the app or on our account deletion page." | Implies deletion is a completed act | "You can request deletion of your account and its data in the app or on our account deletion page." |
| 2 | `website/privacy/index.html` line 73 (Backups) | "our database plan keeps no provider backups, so data you delete does not live on in a backup." | Absolute claim, to be confirmed against the provider plan before it is repeated anywhere | Keep only if the plan is verified: "our database plan keeps no provider backups." |
| 3 | `website/privacy/index.html` line 77 (Deleting your account) | "Deletion permanently removes your account, your sign-in record at our sign-in provider ... sign-in sessions and every verified session summary." | Claims permanent removal including provider record | "When you request deletion, we remove your account, sign-in sessions and every verified session summary, and ask our sign-in provider to remove your sign-in record (email address or wallet address). Your account shows as Deletion requested or Deletion pending until we have verified that the removal is complete." |
| 4 | `website/privacy/index.html` line 83 (your rights) | "You can ask us ... to correct or delete it, by emailing info@movenrun.xyz." | No time promise; acceptable | No change needed. |
| 5 | `website/privacy/index.html` line 90 (children) | "... contact us and we will delete it." | Unconditional | "... contact us and we will act on a deletion request." |
| 6 | `website/privacy/index.html` line 69 and 72 (retention list) | "kept until you delete your account"; "stays until you ... delete your account in the app" | Fine as a retention statement | Optional: "until deletion is completed". |
| 7 | `website/support/index.html` lines 45-46 | "How do I delete my account? In the app: ... Delete account, or use the account deletion page." | Heading implies instant deletion | "How do I request deletion of my account?" and add: "The app and the page show Deletion requested or Deletion pending until the removal is verified." |
| 8 | `website/support/index.html` line 7 (meta description) | "... account deletion." | No claim | No change needed. |
| 9 | `website/sign-in/index.html` line 46 | "Looking to delete your account? Use the account deletion page." | Fine | No change needed. |
| 10 | `docs/play-launch/STORE_LISTING.md` line 32 | "Delete your account and its data at any time, in the app or on the web" | Store text promises a completed outcome | "Request deletion of your account and its data at any time, in the app or on the web" |
| 11 | `docs/play-launch/PLAY_CONSOLE_WORKSHEET.md` line 38 (Account deletion row) | "... sign in with Google or the wallet, then delete" | Describes a completed act | "... sign in with Google or the wallet, then request deletion. The page shows Deletion requested or Deletion pending until the removal is verified." |
| 12 | `docs/play-launch/PLAY_CONSOLE_WORKSHEET.md` line 42 (Data safety) | "Can users request deletion? Yes." | Accurate | No change needed. |
| 13 | `docs/play-launch/PLAY_CONSOLE_WORKSHEET.md` lines 67-70 (reviewer note) | "Deleting it is allowed; signing in again creates a fresh account." | Immediate re-creation may not be possible while a request is pending | "Requesting deletion is allowed. Until the deletion is verified complete the account shows as pending; after that, signing in again creates a fresh account." |
| 14 | `docs/play-launch/HANDSET_TEST_SCRIPT.md` rows 15e and 16 | "deletion succeeds"; "account deleted; signed out; ... signing in again creates a fresh account" | Expects a completed outcome | "Deletion requested (or Deletion complete only if the response confirmed the sign-in record removal); signed out; local progress cleared; signing in again is refused while the deletion is pending" |
| 15 | `docs/play-launch/FEATURE_MATRIX.md` line 30 | "provider user removed at Supabase" / "removes your Google or wallet sign-in record" | States completion | "requests removal of your Google or wallet sign-in record" |
| 16 | `docs/play-launch/DECISIONS.md` D-05 | "Account deletion is a hard delete ... in one transaction" | Describes the older synchronous design; the queued design (202) supersedes it when promoted | Add: "Completion is reported to people only after the sign-in record removal is verified." |
| 17 | `docs/play-launch/WEBSITE_REVIEW_PREVIEW.md` line 28 | "option 3 by email, completed within 30 days" and "Within 3 working days" support reply | Describes time frames the owner has asked not to promise (the page no longer says them) | Remove both time frames from the description |
| 18 | `docs/play-launch/PLAY_REGISTRATION_CHECKLIST.md` line 84 | "Account deletion in app and on the web: Met (locally tested)" | Fine as a checklist status | No change needed. |
| 19 | `docs/play-launch/DATA_INVENTORY.md` lines 24-35, 45 | "Until deletion"; "Deleted through the admin API when the MovenRun account is deleted" | Inventory language; fine, but line 45 should name the pending stage | "Removal is requested through the admin API when the account deletion is requested, and retried until the provider confirms" |
| 20 | `docs/play-launch/evidence/web-sign-in-deletion-e2e.mjs` line 159 | Asserts the status text includes "deleted" | Test of old wording; the 200 case still says "deleted" only when completion is confirmed, a pending reply does not | Update the assertion with the e2e fixture to the confirmed-completion response |
| 21 | Store data-safety form and in-store deletion URL text (Play Console, not in the repo) | Not in the repository | Cannot be audited here | Use the wording in rows 10 and 11 when the form is next edited |
| 22 | Mobile `app/account/security.tsx` and `app/legal.tsx` on branches other than the Android fix branch (for example the base of this branch, which still has "permanently deleted") | "has been permanently deleted"; "permanently deletes" | Contradicts the owner decision | Merge or port `fix/deletion-copy-android-30oct` |

## Notes

- `scripts/check-launch-placeholders.mjs` reports unfilled `{{API_BASE_URL}}` and `{{SUPABASE_PUBLISHABLE_KEY}}` in `account-deletion` and `sign-in`; these deployment placeholders exist on the base commit and are deliberately not filled here.
