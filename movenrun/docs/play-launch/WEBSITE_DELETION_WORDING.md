# Website deletion wording: truthful pending state

Branch `website/truthful-pending-deletion`, base `61d30bb` (live website source). Backend claims are checked against the deployed API code `2192de6`. Only `movenrun/website/**` and this file changed. Not deployed; no hosted calls.

## What the API can say

`POST /identity/account/delete` erases the MovenRun rows in one transaction (`backend/src/identity/accountDeletion.ts:79-137`), queues the provider user for removal in the same transaction (`:98-101`), then tries to remove it at the provider and answers `{ deleted: true, erased, signInRecord }` where `signInRecord` is `"removed"`, `"pending"` or `"none"` (`backend/src/identity/http/router.ts:367-374`). `"pending"` means the provider call failed and the queue row will be retried (`backend/src/api/app.ts:51-54`, `supabaseSignIn.service.ts:380-382`). Before this change the page printed "deleted" for every `ok` response and the app does the same (mobile proposals below).

States now shown on the web page: complete (`removed`, or `none` = no provider record existed), requested and in progress (`pending`), requested with the last step unconfirmed (unreadable body), and error (HTTP failure). No response-time promise, date, download option or new network terminology is added. Contact is info@movenrun.xyz, signed Team MovenRun.

## Exact before and after text

### Account deletion page (/account-deletion/)

File: `movenrun/website/account-deletion/index.html`

**Change 1** (base lines 31-31, new lines 31-32)

Before:
```text
  <li>Your account, and its Google sign-in (your email address) or wallet sign-in (your public wallet address) at our sign-in provider</li>
```

After:
```text
  <li>Your MovenRun account and the sign-in method stored with it (your Google email address, or your public wallet address), in our database</li>
  <li>Your sign-in record at our sign-in provider, as a second step that follows (see "What happens when you confirm" below)</li>
```

**Change 2** (base lines 36-36, new lines 37-43)

Before:
```text
<p>Deletion from our database happens immediately and cannot be undone. Your sign-in record at our sign-in provider is removed straight after, and the removal is retried automatically if the provider cannot be reached at that moment. Your Google account and your wallet themselves are not affected: we only remove MovenRun's record of them. We keep only an anonymous record that an account was deleted, with no email, account id or other detail that could identify you. Our database plan has no automatic backups; an encrypted copy we made ourselves before your deletion still holds your data until that copy is deleted. See the <a href="/privacy/#retention">privacy policy</a> for details.</p>
```

After:
```text
<h2 id="steps">What happens when you confirm</h2>
<ol>
  <li><strong>Deletion requested.</strong> Your MovenRun account and the data listed above are erased from our database in one step. This cannot be undone, and all your devices are signed out.</li>
  <li><strong>Sign-in record removal.</strong> Your sign-in record at our sign-in provider is removed straight after. If the provider cannot be reached at that moment, the removal stays in progress and is retried automatically while our service is running. The deletion is complete only once this step has finished. If you use this page, it tells you which of the two states applies; the app does not currently show that status.</li>
</ol>
<p>Your Google account and your wallet themselves are not affected: we only remove MovenRun's record of them. We keep an anonymous record that an account was deleted, with no email, account id or other detail that could identify you.</p>
<p>Two short-lived security records are not tied to your account, so deleting the account does not remove them straight away. A wallet sign-in message (it contains the public wallet address) is cleared by a later wallet sign-in, at least a day after the message expired. For Google sign-in, a record of the sign-in session identifier (no email address, no account id) is kept for at least 30 days so the same sign-in cannot be used twice. Our database plan has no automatic backups; an encrypted copy we made ourselves before your deletion still holds your data until that copy is deleted. See the <a href="/privacy/#retention">privacy policy</a> for details.</p>
```

**Change 3** (base lines 55-55, new lines 62-62)

Before:
```text
    <p><strong>This permanently deletes your account and every session saved to it.</strong></p>
```

After:
```text
    <p><strong>This requests permanent deletion of your account and every session saved to it. It cannot be undone.</strong></p>
```

**Change 4** (base lines 63-63, new lines 70-71)

Before:
```text
<p>Email requests are handled by the MovenRun team by hand, so we cannot promise a fixed time for them. If you can still sign in, options 1 and 2 delete your account straight away.</p>
```

After:
```text
<p>Email requests are handled by the MovenRun team by hand, so we cannot promise a fixed time for them. If you can still sign in, options 1 and 2 let you request deletion yourself (only option 2 shows the status of the second step).</p>
<p>If this page shows that the sign-in record removal is still in progress, or you have any other question about a deletion, write to <a href="mailto:info@movenrun.xyz">info@movenrun.xyz</a>.<br>Team MovenRun</p>
```

### Account deletion page script (status messages)

File: `movenrun/website/js/account-deletion-page.js`

**Change 1** (base lines 37-38, new lines 37-46)

Before:
```text
      if (r.ok) { token = ""; confirmForm.hidden = true; say("Your MovenRun account and its data have been deleted.", "ok"); }
      else say("Your account could not be deleted right now. Please try again or email us.", "error");
```

After:
```text
      if (!r.ok) { say("Your account could not be deleted right now. Please try again or email info@movenrun.xyz (Team MovenRun).", "error"); return; }
      token = ""; confirmForm.hidden = true;
      // The API reports the sign-in record at the provider as "removed", "pending" or "none".
      // Only "removed" and "none" mean the deletion is complete.
      return r.json().then(function (b) { return b && typeof b.signInRecord === "string" ? b.signInRecord : ""; }, function () { return ""; }).then(function (record) {
        if (record === "removed") say("Deletion complete. Your MovenRun account, its data and your sign-in record have been removed.", "ok");
        else if (record === "none") say("Deletion complete. Your MovenRun account and its data have been removed. There was no separate sign-in record to remove.", "ok");
        else if (record === "pending") say("Deletion requested. Your MovenRun account and its data have been erased. Removing your sign-in record at our sign-in provider is still in progress and is retried automatically. Questions: info@movenrun.xyz, Team MovenRun.", "ok");
        else say("Deletion requested. Your MovenRun account and its data have been erased, but we could not confirm the final step, removing your sign-in record. Questions: info@movenrun.xyz, Team MovenRun.", "ok");
      });
```

### Privacy policy (/privacy/)

File: `movenrun/website/privacy/index.html`

**Change 1** (base lines 46-47, new lines 46-47)

Before:
```text
    <tr><td>Wallet sign-in: your public wallet address and the signed sign-in message</td><td>When you choose Continue with Wallet</td><td>To prove you control the address and recognise you when you sign in again. We never receive your private key or recovery phrase, never read your balance and never request a transaction</td><td>Held by our sign-in provider (Supabase Auth); our server keeps the sign-in provider's user id, and the signed message for up to a day</td></tr>
    <tr><td>Sign-in sessions: a device label such as "Android device", a one-way hash of the app's user agent, sign-in times</td><td>When you sign in or refresh your session</td><td>To keep you signed in and let you see and sign out your devices</td><td>Stored on our server</td></tr>
```

After:
```text
    <tr><td>Wallet sign-in: your public wallet address and the signed sign-in message</td><td>When you choose Continue with Wallet</td><td>To prove you control the address and recognise you when you sign in again. We never receive your private key or recovery phrase, never read your balance and never request a transaction</td><td>Held by our sign-in provider (Supabase Auth); our server keeps the sign-in provider's user id, and the sign-in message (which contains the address) until it is cleared out, at least a day after it expires (see below)</td></tr>
    <tr><td>Sign-in sessions: a device label such as "Android device" and sign-in times</td><td>When you sign in or refresh your session</td><td>To keep you signed in and let you see and sign out your devices</td><td>Stored on our server</td></tr>
```

**Change 2** (base lines 74-75, new lines 74-75)

Before:
```text
  <li><strong>Wallet sign-in messages</strong> expire after 5 minutes. Expired messages are cleared out once they are a day old, when the next wallet sign-in starts. One-time codes that carry a wallet sign-in back to the app are stored only as a one-way hash, expire after 5 minutes and are deleted after a day.</li>
  <li><strong>Used Google sign-ins</strong>: so that one Google sign-in cannot be used twice, our server records its sign-in session identifier and an expiry time, with no email address or account id, and keeps that record for 30 days.</li>
```

After:
```text
  <li><strong>Wallet sign-in messages</strong> expire after 5 minutes. Expired messages are cleared out, with the address they contain, only when another wallet sign-in starts and the message expired more than a day earlier, so they can stay longer than a day when no one is signing in, and deleting your account does not remove them straight away. One-time codes that carry a wallet sign-in back to the app are stored only as a one-way hash and expire after 5 minutes. Collected codes are deleted once they are a day old; codes nobody collects are deleted shortly after they expire. Both clean-ups run while our service is awake.</li>
  <li><strong>Used Google sign-ins</strong>: so that one Google sign-in cannot be used twice, our server records its sign-in session identifier and an expiry time, with no email address or account id, and keeps that record for at least 30 days. The record is removed by a clean-up that runs when a later Google sign-in is completed, so it can be kept longer than 30 days. Deleting your account does not remove it.</li>
```

**Change 3** (base lines 77-77, new lines 77-77)

Before:
```text
  <li><strong>Unsent sessions</strong> waiting for a connection are kept on your phone for up to 7 days, and are deleted when they are sent, expire, are discarded, or you sign out.</li>
```

After:
```text
  <li><strong>Unsent sessions</strong> waiting for a connection are kept on your phone until they are sent. A session that is still unsent seven days after it ended is deleted from your phone the next time you open the app while signed in and it checks its waiting sessions. They are also deleted if you discard them or sign out, and uninstalling the app removes them.</li>
```

**Change 4** (base lines 80-80, new lines 80-80)

Before:
```text
  <li><strong>Backups</strong>: our database plan does not give us automatic backups or point-in-time recovery. We may make occasional encrypted copies of the database ourselves to protect against data loss; a copy made before you delete your account still contains your account data until that copy is deleted. Any copies our providers keep for their own operations are governed by their terms.</li>
```

After:
```text
  <li><strong>Backups</strong>: our database plan does not give us automatic backups or point-in-time recovery. We may make occasional encrypted copies of the database ourselves to protect against data loss; a copy made before you delete your account still contains your account data until that copy is deleted. This describes our current hosting plan; if we turn on automatic backups we will update this policy. Any copies our providers keep for their own operations are governed by their terms.</li>
```

**Change 5** (base lines 84-84, new lines 84-84)

Before:
```text
<p>In the app: <strong>Profile → Account → Account security → Delete account</strong>. Or use the <a href="/account-deletion/">account deletion page</a>, which works without the app, with Google or with your wallet. Deletion permanently removes your account, your sign-in record at our sign-in provider (email address or wallet address), sign-in sessions and every verified session summary. Your sign-in record at our sign-in provider is removed straight after, and the removal is retried automatically if the provider cannot be reached at that moment. We keep only an anonymous count that a deletion happened, with nothing that identifies you. If you cannot sign in, you can ask by email; the team handles those requests by hand, and we do not promise a fixed time.</p>
```

After:
```text
<p>In the app: <strong>Profile → Account → Account security → Delete account</strong>. Or use the <a href="/account-deletion/">account deletion page</a>, which works without the app, with Google or with your wallet. Confirming deletion is a request that has two steps. First, your account, sign-in sessions and every verified session summary are erased from our database in one step. Second, your sign-in record at our sign-in provider (email address or wallet address) is removed straight after; if the provider cannot be reached at that moment, this step stays in progress and is retried automatically while our service is running, and the deletion page on this website says so instead of reporting the deletion as finished. The app does not currently show the status of the second step. The deletion is complete only when both steps are done. We keep only an anonymous count that a deletion happened, with nothing that identifies you. If you cannot sign in, or want to check on a deletion, email <a href="mailto:info@movenrun.xyz">info@movenrun.xyz</a> (Team MovenRun); the team handles those requests by hand, and we do not promise a fixed time.</p>
```

### Support (/support/)

File: `movenrun/website/support/index.html`

**Change 1** (base lines 46-46, new lines 46-46)

Before:
```text
<p>In the app: <strong>Profile → Account → Account security → Delete account</strong>, or use the <a href="/account-deletion/">account deletion page</a>. Both delete your account straight away. If you can no longer sign in, the deletion page explains how to ask by email.</p>
```

After:
```text
<p>In the app: <strong>Profile → Account → Account security → Delete account</strong>, or use the <a href="/account-deletion/">account deletion page</a>. Both erase your MovenRun data when you confirm. The final step, removing your sign-in record at our sign-in provider, follows straight after; the deletion page shows whether it is finished or still in progress, and the app does not currently show that status. If you can no longer sign in, the deletion page explains how to ask by email. Questions: info@movenrun.xyz, Team MovenRun.</p>
```


## Claims audit (deployed API code 2192de6; paths under `movenrun/backend/src/`)

| # | Public claim (before) | Verdict | Evidence | Wording now |
|---|---|---|---|---|
| 1 | Sign-in sessions store "a one-way hash of the app's user agent" (privacy, collect table) | **False at runtime; removed** | Both session-creating call sites pass `userAgentHash: undefined` (`identity/http/router.ts:149`, `:244`); stores write `input.userAgentHash ?? null` (`identity/repositories/drizzle/stores.ts:300`); `session.service.ts:143` same. Nullable column exists (`db/identity.schema.ts:165`, migration `0001...sql:67`) but is always NULL. | Claim deleted from the table row. "Not stored" is true today but is not asserted, so a later code change cannot silently make it false. |
| 2 | Wallet sign-in message (contains the address) kept "for up to a day" | **Not supported; corrected** | Row written at `identity/services/supabaseSignIn.service.ts:211`; cleared only inside the next `beginWallet`, for rows that expired more than 24 hours earlier (`:212`; expiry is issue time + 5 min, `:33`). Not in the maintenance list (`api/app.ts:50-56`). Not erased by account deletion (`identity/accountDeletion.ts:103-111` has no `walletSignInChallenges` delete; table not imported at `:35-44`). So it is a minimum of about a day and can be much longer. | "cleared out ... only when another wallet sign-in starts and the message expired more than a day earlier ... deleting your account does not remove them straight away." Also disclosed on the deletion page. |
| 3 | Wallet one-time codes: hash only, 5 min, deleted after a day | **Supported, wording tightened** | Hash only: `supabaseSignIn.service.ts:270`; TTL 5 min `:39`. Collected codes purged after 24 h (`:293`, `signInStores.ts:260-266`); uncollected expired codes deleted by `takeExpired` (`signInStores.ts:249-259`). Runs every 5 minutes while the process is awake (`api/app.ts:51-54`, `api/maintenance.ts:1-30`). | "Collected codes are deleted once they are a day old; codes nobody collects are deleted shortly after they expire. Both clean-ups run while our service is awake." |
| 4 | Used Google sign-in record kept "for 30 days" | **Minimum, not maximum; corrected** | Record stores session id and `keepUntil = now + 30 days` (`supabaseSignIn.service.ts:83`, `:174`). Expired rows are purged only inside `claimGoogleExchange`, at most 500 per call (`:85`, `:190`; `signInStores.ts:175-182`), i.e. when someone completes a later Google sign-in. Not erased on account deletion (no table in `accountDeletion.ts`). | "at least 30 days ... removed by a clean-up that runs when a later Google sign-in is completed, so it can be kept longer ... Deleting your account does not remove it." |
| 5 | Sign-in sessions deleted a week past expiry | **Supported** | `identity/services/session.service.ts:302` (7 days), `:366-381` prune; hourly at `api/app.ts:56`. Erased with the account (`accountDeletion.ts:104`). | Unchanged. |
| 6 | Sign-ins that never become an account removed "normally once about an hour old" | **Supported** | `ORPHAN_GRACE_MS` 1 h (`supabaseSignIn.service.ts:88`); sweep every 30 min while awake (`api/app.ts:55`); service can sleep (`api/maintenance.ts:1-30`). | Unchanged. |
| 7 | Provider sign-in record removed "straight after", retried if provider unreachable | **Supported, pending state now disclosed** | `router.ts:367-374`; retry `api/app.ts:51-54`, `supabaseSignIn.service.ts:307-324`, `:380-382` (rows not retried within 10 minutes of the last attempt). The retry runs only while the process is awake. | Two-step description; "pending" shown on the web page; "retried automatically while our service is running". No time promised. |
| 8 | In-app deletion shows deleted | **Mobile does not read `signInRecord`** | Proposals below (mobile frozen). The website now says the app does not currently show the second-step status. | Statement on privacy, support and deletion pages. Remove it when the app is updated. |
| 9 | Operator backups: plan has none; occasional self-made copies persist until deleted | **Operational fact, not provable from runtime code; owner to confirm plan** | Owner docs: `docs/play-launch/FREE_HOSTING_READINESS.md:46`, `HOSTING_SUPABASE_FREE.md:40`, `LIVE_SETUP_OPERATOR_GUIDE.md:65`. **Conflict:** the code comment in `identity/accountDeletion.ts:26-27` says "Backups age out on the hosting provider's retention schedule", which contradicts the website and those docs. | Kept, plus "This describes our current hosting plan; if we turn on automatic backups we will update this policy." Backend comment should be corrected by its owner. |
| 10 | Unsent local GPS kept up to 7 days, deleted when sent, expired, discarded or sign-out | **Supported with a caveat; reworded** | Limit 7 days from the session end time (`mobile/src/lib/pendingVerification.ts:83`, `:231-234`). Expired entries are removed only when the foreground sweep runs for a signed-in owner (`mobile/src/services/verifySession.ts:405-436`, trigger list at `:405-409`). Sign-out clears the queue (`mobile/src/store/useAuthStore.ts:634`, `:674`); in-app deletion clears it (`mobile/src/services/identityApi.ts:472-479`). A phone that is not opened keeps the data until uninstall. | "kept on your phone until they are sent. A session still unsent seven days after it ended is deleted the next time you open the app while signed in ... Also deleted if you discard them or sign out; uninstalling removes them." |
| 11 | Deletion keeps only an anonymous count | **Supported** | `accountDeletion.ts:116-124` (`account_deleted`, null user id, null metadata). | Unchanged. |
| 12 | "Immediately" / "straight away" deletion | **Partly true; reworded** | Database erase is one transaction (`accountDeletion.ts:79`); the provider step is separate and can be pending. | Two-step wording; "straight away" no longer used for the whole deletion. |

Not changed and not audited here: the docs pages (`/docs/faq/`, `/docs/verification/`, `/docs/disclaimers/`) repeat "up to seven days" for unsent routes, compatible with row 10 but less precise; `docs/assets/search-index.json` is generated from them. Left alone to keep this change to the deletion and privacy claims.

## Safety checks

- `movenrun/website/vercel.json` is byte-identical to base (CSP, X-Frame-Options, HSTS and the other headers untouched). No `<meta>` CSP exists in the pages; none was added. No inline script or style was introduced (the new status logic is in the existing external `js/account-deletion-page.js`, allowed by `script-src 'self'`).
- Canonical links (`https://movenrun.xyz/...`) and `sitemap.xml` unchanged. Redirects (`www` to apex 308) are Vercel domain settings, not in this folder, and were not touched; they can only be confirmed on the live preview.
- Local render, headless Chromium with the real `vercel.json` headers (CSP minus `upgrade-insecure-requests` for http), widths 320 and 1280: all 17 HTML files (`/`, 12 docs pages, `/privacy/`, `/support/`, `/account-deletion/`, `/sign-in/`) returned 200 with no horizontal overflow and no console or page errors. 17 distinct internal links, none broken. Fonts and the API host were blocked in the test.
- Status logic test (Node `vm` harness, API stubbed; harness is not committed because the site has no test runner and anything under `movenrun/website` is served publicly). Before (base script): `removed`, `none`, `pending` and unreadable body all print "Your MovenRun account and its data have been deleted." After: complete for `removed`/`none`, "Deletion requested ... still in progress" for `pending`, "Deletion requested ... could not confirm the final step" for an unreadable body, error text for HTTP failure.

## Mobile strings that say "deleted" (proposals only; mobile is frozen, nothing changed)

| File:line | Current | Proposal |
|---|---|---|
| `mobile/app/account/security.tsx:191` | Alert "Account deleted": "Your MovenRun account and its saved sessions have been permanently deleted." | Read `signInRecord` from the response; when `"pending"` use "Deletion requested": "Your MovenRun account and saved sessions have been erased. Removing your sign-in record is still in progress and is retried automatically. Questions: info@movenrun.xyz, Team MovenRun." Keep "deleted" only for `"removed"`/`"none"`. Needs `identityApi.ts:472` to return the body (it currently types it `{ deleted: boolean }` and discards it). |
| `mobile/app/account/security.tsx:198` | "This permanently deletes your MovenRun account, its Google or wallet sign-in record, and every verified session ..." | "This requests permanent deletion of ..." |
| `mobile/app/account/security.tsx:329` | "Your account could not be deleted. Please try again." | Add "or email info@movenrun.xyz (Team MovenRun)". |
| `mobile/app/legal.tsx:15` | "This permanently removes your account, its Google or wallet sign-in record, sign-in sessions and verified sessions from MovenRun ..." | Two-step wording as on `/privacy/#delete`. |
| `mobile/app/legal.tsx:11` | "kept on this device for up to seven days, and deleted on expiry, discard or sign-out" | Match row 10 wording. |
| `mobile/src/store/useAuthStore.ts:112` (comment) | "Resolves true only after the server confirmed the deletion." | Comment only; true for the database step. |

