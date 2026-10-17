# Owner decisions: Android backup, repository visibility, canonical domain

Written 17 Oct 2026 for the owner. None of these is approved or changed.
Each is a separate decision.

## 1. Android backup (A-08): recommend `allowBackup: false`

**Today.** `mobile/app.json` sets no `android.allowBackup`, and Expo then
writes `android:allowBackup="true"` (`@expo/config-plugins`
`AllowBackup.js`, default `true`). Android may copy the app's AsyncStorage
into the player's Google backup and into phone-to-phone transfers. That
storage holds (see `DATA_INVENTORY.md`):

- the **precise GPS route of a session not yet sent** (kept up to 7 days);
- game progress (XP, streak, quests, zones, route reviews without coordinates).

Sign-in tokens are in SecureStore (Android Keystore), whose keys do not
restore on another phone, so they are not exposed this way.

**Recommendation.** Set `"android": { "allowBackup": false }` in
`mobile/app.json`. Precise location of unsent sessions then never leaves the
phone except to MovenRun's API.

**What is lost.** On a new or reset phone, local-only progress and any session
not yet sent are not restored. Everything the account holds on the server
(verified sessions, account) comes back by signing in.

**Why it waits.** It is a mobile config change, and the mobile app is frozen
until the owner says otherwise. It needs a new build and a phone check that
the merged manifest shows `allowBackup="false"`.

## 2. Repository visibility (A-12)

**Today.** `suhaib155/arena` is public. GitHub Pages serves
`https://suhaib155.github.io/arena/` (200, 17 Oct): the raw source of an old
React prototype (`import { useState … }`, wallet and dollar icons). Nothing on
movenrun.xyz links to it.

| Option | Effect | Before doing it |
|---|---|---|
| **A. Turn off GitHub Pages** (recommended now) | Removes the stale public prototype | Nothing depends on it (verified above). GitHub → Settings → Pages → Unpublish |
| B. Keep the repo public | Free unlimited Actions minutes, free secret scanning and push protection. Security never relied on secrecy | Keep incident details factual and closed (X-26 is closed) |
| C. Make the repo private | Code, history and launch ledgers no longer public | Preflight below; it can break deploys |

**Preflight for option C** (each must be checked by the owner before switching):

1. **Render**: the GitHub app connected to the service can read private
   repos of `suhaib155` (Render → Account → GitHub). Otherwise the next deploy
   (X-24) fails to clone.
2. **Vercel**: the projects deploying `movenrun/website` belong to a Vercel
   team that is not named after `suhaib155`. Vercel's free plan limits
   deployments from private repositories by account; confirm in Vercel →
   Settings → Git that previews and production still build after the switch.
3. **GitHub Actions**: private repos get 2,000 free minutes a month; CI runs
   backend, mobile and contracts on every push. Check usage first.
4. **Secret scanning and push protection** stop being free on private repos.
5. **Connected apps** (the GitHub app used for reviews, Expo/EAS) keep access
   only if granted for private repos.

A switch is reversible, but a failed deploy or a lost preview is not
immediately visible. Do C only with time to re-check X-24 and the website.

## 3. Canonical website domain (A-03, part of X-21)

**Today (17 Oct, read only).**

| Request | Result |
|---|---|
| `https://movenrun.xyz/` | 308 → `https://www.movenrun.xyz/` |
| `https://movenrun.xyz/sign-in/` | 308 → `https://www.movenrun.xyz/sign-in/` |
| API preflight from `https://www.movenrun.xyz` | 200, **no** `access-control-allow-origin` |
| API preflight from `https://movenrun.xyz` | 204, allowed |
| `https://movenrun-website.vercel.app/` | 404 |

The API's CORS list, the wallet sign-in message (`movenrun.xyz`) and the
Supabase redirect list (`https://movenrun.xyz/sign-in/`,
`/account-deletion/`) all name the bare domain. Every page link, canonical tag
and the sitemap now name it too. With the redirect to `www`, Google's return
and wallet sign-in would fail once providers are on (X-05).

**The change (X-21, owner).** Vercel → the `movenrun/website` project →
Domains: set **`movenrun.xyz` as primary**, and `www.movenrun.xyz` to redirect
(308) to it. Both names already reach Vercel, so no DNS record should need to
change; if Vercel asks for one, that is a DNS change and waits for X-21.

**Not recommended:** adding `www` to CORS and Supabase instead. Two origins
for sign-in means two domains in wallet prompts and two redirect entries to
keep right; one canonical origin keeps the wallet message honest.

**After the change, check:** apex 200 with no redirect, `www` 308 to the apex,
the preflight row above allowed from the apex, then the X-21 placeholder
check.
