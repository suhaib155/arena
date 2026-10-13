# Website W1 review packet (non-public preview)

**X-21 (publishing) is NOT approved; nothing was published.** No Vercel, DNS or
`movenrun.xyz` change was made. The site was served only on `127.0.0.1` for
screenshots. `vercel.json` (security headers) is unchanged.

- Branch: `web/w1-review-preview`, from `origin/chore/post-security-launch-prep`.
- Scope: `movenrun/website/` plus two documents and one evidence script under
  `movenrun/docs/play-launch/`. `movenrun/mobile/` is untouched.
- Screenshots (not in Git): `/mnt/project-files/movenrun-play-launch/website-preview-w1/`
  (`before-*` from the base branch, `after-*` from this branch; `after-matrix.json`
  is the raw responsiveness data). Produced by
  `docs/play-launch/evidence/website-w1-shots.mjs`.

## Files changed (`git diff --stat` against the base branch)

```
 movenrun/docs/play-launch/ACCOUNT_DELETION_OPERATIONS.md  |  new
 movenrun/docs/play-launch/WEBSITE_W1_REVIEW_PACKET.md     |  new (this file)
 movenrun/docs/play-launch/evidence/website-w1-shots.mjs   |  new
 movenrun/website/README.md                         |  38 +--
 movenrun/website/account-deletion/index.html       |   8 +-
 movenrun/website/css/style.css                     | 115 +++++----
 movenrun/website/docs/README.md                    |  12 +-
 movenrun/website/docs/assets/diagrams/capture.svg  |  32 +--
 movenrun/website/docs/assets/diagrams/districts.svg|  12 +-
 movenrun/website/docs/assets/diagrams/points.svg   |   2 +-
 movenrun/website/docs/assets/diagrams/roadmap.svg  |   8 +-
 movenrun/website/docs/assets/diagrams/territory-lifecycle.svg | 8 +-
 movenrun/website/docs/assets/diagrams/verification.svg |  4 +-
 movenrun/website/docs/assets/diagrams/zone-deed.svg |   6 +-
 movenrun/website/docs/assets/docs.css              |   9 +-
 movenrun/website/docs/assets/search-index.json     |   2 +-
 movenrun/website/docs/capture/index.html           |  17 +-
 movenrun/website/docs/community/index.html         |   5 +-
 movenrun/website/docs/disclaimers/index.html       |   5 +-
 movenrun/website/docs/faq/index.html               |   5 +-
 movenrun/website/docs/holding/index.html           |   5 +-
 movenrun/website/docs/how-it-works/index.html      |   5 +-
 movenrun/website/docs/index.html                   |   7 +-
 movenrun/website/docs/onchain/index.html           |  15 +-
 movenrun/website/docs/points/index.html            |   5 +-
 movenrun/website/docs/progress/index.html          |   5 +-
 movenrun/website/docs/roadmap/index.html           |  17 +-
 movenrun/website/docs/verification/index.html      |   5 +-
 movenrun/website/index.html                        | 110 ++++-----
 movenrun/website/js/account-auth.js                |   4 +-
 movenrun/website/js/globe.js                       |  53 ++--
 movenrun/website/js/main.js                        | 271 ++++++++++++---------
 movenrun/website/legal/legal.css                   |   7 +-
 movenrun/website/privacy/index.html                |   8 +-
 movenrun/website/sign-in/index.html                |   4 +-
 movenrun/website/support/index.html                |   6 +-
```

## Product-claims matrix

| Claim on the site | Status | Where |
|---|---|---|
| Walk, run or cycle; a saved session claims a new cell; hold by returning; hold fades when you stay away | Live (in the app) | Home hero, loop cards; docs how-it-works, capture, holding |
| XP, levels, streaks | Live (in the app) | Home hero chip "in the app today", economy card |
| Districts and mastery | Live (in the app, local) | Home loop card 04; docs community |
| Clubs pooling ground for districts | Preview (local, does not sync) | Home clubs section ("preview in the app", chips "Interface mockup", "City districts · Mockup", "Sample clubs and numbers / Not live data"); roadmap phase 2 "planned" |
| Club board numbers (218 areas etc.) and the district map | Mockup | Home clubs section |
| Phone screens, live session map, reward summary | Interface mockup / illustration | Home app, session and wellbeing sections |
| Points (in-game currency) | Planned | Home economy card chip "Planned"; roadmap phase 3; docs points |
| Deeds held in your own wallet | Planned, not live | Home Onchain lede "They are not live yet"; roadmap phase 4; docs onchain |
| Mainnet deployment | Objective for official launch; has not happened | Docs roadmap only (single technical statement) |
| Web sign-in (wallet handoff) and web account deletion | Built; not operable until X-06, X-07, X-05 | `/sign-in/`, `/account-deletion/` (show the unavailable state until then) |
| Email deletion completed within 30 days | BLOCKED_OWNER_PROOF | `/account-deletion/` option 3 (see below) |
| Support by email (no time window) | Live mailbox to be proven (see deletion checklist item a) | `/support/` |
| No coordinates stored; no financial promise; free to play, no wallet needed | Policy statement | Home footer, final card, base list; privacy |

## What changed, by owner decision

1. **No public dates or times.** Removed "Effective 2 November 2026" from
   `/privacy/` and the phrase "and its effective date". Removed the clubs
   "war timer" countdown (`23:59:42`, ticking every second) and its script.
   The sample reward caption "Tue 06:42" became "Sample". No replacement date
   was invented. The "© 2026" copyright line in footers was kept (a copyright
   notice, not a publication or launch date; owner may remove).
2. **No fixed support promise.** `/support/` now says "Help is available by
   email from Team MovenRun." Contact stays `info@movenrun.xyz`.
3. **30-day deletion line.** Kept in `/account-deletion/` option 3, preceded
   by `<!-- BLOCKED_OWNER_PROOF: keep only after the mailbox, ownership checks
   and deletion log are proven (see docs/play-launch/ACCOUNT_DELETION_OPERATIONS.md) -->`.
   The privacy page does not repeat it. In-app and web deletion text unchanged.
4. **Wallet sign-in unavailable fallback.** `js/account-auth.js` `unavailable`
   now reads: "Wallet sign-in is not available right now. Go back to the
   MovenRun app and try again later; you can keep playing as a guest
   meanwhile. Never share your recovery phrase, private key or a sign-in code
   with anyone, including us." This message is shown only on `/sign-in/`.
   The generic fallback lost "or email us" ("Sign-in didn't complete. Please
   try again."). `/account-deletion/` keeps its own "Online deletion is not
   available right now. Use the app or email us; both work." No test or
   evidence script asserted the old sign-in wording (`git grep` over the repo,
   mobile excluded).
5. **Email OTP references.** None found on the website. The wallet
   "one-time code that carries a sign-in back to the app" (privacy, support,
   sign-in) is a real feature and was kept.
6. **Network terminology.** Removed "Base Sepolia", "test network",
   "Mainnet at launch" and "Base mainnet" from the homepage and docs
   (onchain, roadmap, roadmap diagram, search index, maintainer READMEs).
   Homepage Onchain lede: "Deeds are planned as records you hold in your own
   wallet. They are not live yet." Phase 4: "Deeds" / "Held ground can become
   deeds recorded under your own keys." The one technical statement is on
   `/docs/roadmap/`: "Mainnet deployment is an objective for the official
   launch; it has not happened." No contract addresses anywhere.
7. **Pillars kept.** Clubs, districts, claiming/holding and Deeds sections are
   all present; existing "Planned", "Interface mockup", "Mockup" chips kept.
8. **No app CTA.** No download, store badge, beta or waitlist CTA exists. The
   placeholder `https://x.com/` links (nav, mobile menu, final section,
   footer, mobile sticky bar, every docs header) were removed. Primary CTA is
   now "Read the whitepaper" → `/docs/`; final section secondary is
   "How it works" → `/docs/how-it-works/`. Final lede: "MovenRun is in
   development and not open yet. The whitepaper explains how the game works
   and what is built so far." Google Play remains named on `/privacy/` as a
   processor (legal disclosure).
9. **No visible hexagon motif.**
   - Brand mark (nav, splash, footer, final card, favicon data URI, every
     subpage and docs header): a map pin in #18C987.
   - `genHexGrid` replaced by `genAreaGrid`: a seeded (mulberry32) jittered
     street grid whose blocks are sometimes split, inset to leave streets and
     drawn as rounded paths. Same `{el, x, y, dist}` return; used by the city
     descent, phone maps, live session, economy cards, clubs map and final map.
   - Globe: the hex wrap is replaced by a faint latitude/longitude graticule.
   - Inline shapes (loop cards, deed icons, roadmap phase marks, reward
     cluster), CSS clip-path hexagons (icons, club colour chips, list bullets,
     burst particles), canvas confetti and journey milestones are now rounded
     parcels, rounded chips or circles. "⬡/⬢" glyphs replaced; "hexes" in
     sample data became "areas". Class names containing "hex" were renamed.
   - Docs: `/docs/capture/` now describes areas on the real map and says
     territory is computed on an internal grid the player never sees; seven
     diagrams redrawn with parcel shapes; search index updated.
   - Final `git grep -niE "hexagon|hex(es)?\b|⬡|polygon points" movenrun/website`:
     the only hits are the `hex` variable in `hexUtf8()` in
     `js/account-auth.js` (hex-encoding the wallet sign-in message for
     `personal_sign`; not a visual). The store/CTA grep
     (`play store|app store|download|get the app|waitlist|beta`) matches only
     `website/README.md`, which states there is no such CTA; Google Play on
     `/privacy/` is the processor disclosure.
10. **Responsive.** See table below. Fixes: legal page header links and brand
    now 44 px tall; docs search button 44 × 44 and brand 44 px tall on phones;
    the hero globe is redrawn after a resize under reduced motion (it went
    blank before).
11. `vercel.json` unchanged; `node scripts/check-secrets.mjs` passes.

## Responsiveness results (after)

Checked in Chromium per width and page: page scrolled top to bottom, then
`scrollWidth <= innerWidth` at every step, console and page errors, touch
targets of primary nav/CTA under 720 px, and five Tab presses each showing an
outline or focus shadow.

| Width | home | privacy | support | account-deletion | sign-in | docs | docs/capture | docs/roadmap |
|---|---|---|---|---|---|---|---|---|
| 320 | no overflow, 0 errors | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 |
| 360 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 |
| 390 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 |
| 768 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 |
| 1024 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 |
| 1440 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 |
| 1440, root text 200% | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 |
| 1440 at 200% zoom (720 CSS px, 2×) | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 | no overflow, 0 |

- Touch targets under 44 px on phones: none (after the fixes above).
- Keyboard focus: visible on every tabbed element on every page and width.
- Navigation: desktop pill nav; `<details>` menu under 1100 px; sticky
  "Read the whitepaper" bar on phones.
- `prefers-reduced-motion: reduce` (home and docs): 0 running infinite
  animations, 0 `requestAnimationFrame` calls per second when idle, no errors.
- Blocked requests: none (only 127.0.0.1 and Google Fonts were allowed).

## BLOCKED_OWNER_PROOF: the 30-day deletion line

`/account-deletion/` still contains "We complete the deletion within 30 days
and reply when it is done." directly after the `BLOCKED_OWNER_PROOF` comment.
It must not be published until the checklist in
`ACCOUNT_DELETION_OPERATIONS.md` is complete: (a) mailbox receives mail,
(b) ticket id and acknowledgement, (c) ownership verification (Google: same
email; wallet-only: no email proof, send to in-app/web deletion; never ask for
secrets), (d) deletion log, (e) named staff coverage and escalation,
(f) shorter legal deadlines override. If it cannot be proven, delete the
sentence instead.

## Dependencies

Web sign-in (`/sign-in/`) and web deletion (`/account-deletion/` option 2)
need **X-06** (API URL), **X-07** (before-user-created hook) and **X-05**
(Google and Web3 providers) before they can work for real. Until then the
pages carry `{{API_BASE_URL}}` / `{{SUPABASE_PUBLISHABLE_KEY}}` placeholders
and show the unavailable state; `node scripts/check-launch-placeholders.mjs`
correctly fails until X-21 fills them.

## Tests run

- `evidence/web-wallet-discovery-check.mjs`: 8/8 pass.
- `evidence/web-cold-host-check.mjs`: 3/3 pass.
- `evidence/website-w1-shots.mjs`: 36 screenshots, 66 matrix rows, no
  overflow, no errors, no blocked requests.
- `scripts/check-secrets.mjs`: pass.
- `scripts/check-launch-placeholders.mjs`: fails as expected (placeholders
  awaiting X-06/X-05/X-21).
- `evidence/web-sign-in-deletion-e2e.mjs`: not run in this session (no
  credentials for the local PostgreSQL). It asserts no wording changed here;
  its 320 px fit check is covered by the matrix above.
