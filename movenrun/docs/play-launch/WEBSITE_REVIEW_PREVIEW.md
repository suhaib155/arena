# Website review preview (X-21 is NOT approved)

**Rendered:** 13 Oct 2026, from the Git sources at `dd83065` (`movenrun/website/`).

**How it was rendered:**
- The site was served from this workspace on `127.0.0.1` and shot in Chromium with Playwright.
- Sizes: desktop 1440 × 900 and mobile 390 × 844 (2× pixel density).
- Only the page itself and Google Fonts were allowed to load. Nothing connected to Supabase, the API or `movenrun.xyz`, and no key was used.

Nothing was published, and no DNS changed.

Screenshots: `/mnt/project-files/movenrun-play-launch/website-preview/`, named `<page>-desktop.png` and `<page>-mobile.png`.

**How the pages appear in these previews:** deployment values are still placeholders (`{{API_BASE_URL}}` and `{{SUPABASE_PUBLISHABLE_KEY}}`), so the sign-in and deletion controls show their honest "not available right now" state. That is exactly what visitors would see if the pages went live before X-06 and X-05.

**Signed-in states:** these were captured earlier with a local stand-in in `evidence/screens/`:
- `web-delete-google-confirm.png`
- `web-delete-google-done.png`
- `web-delete-wallet-confirm.png`
- `web-wallet-handoff-code.png`

## Route-by-route

| Page | What it shows | Desktop / mobile | Depends on | Notes for your review |
|---|---|---|---|---|
| `/privacy/` | Full policy: who we are, summary, a data table (location, session summary, Google sign-in, wallet sign-in, sessions, network address, on-phone progress), how the server handles routes, providers (Google Maps, Google Sign-In, Supabase, Render, wallet app, Google Play), retention, deletion, rights, security, children (under 13), "no payments or tokens; wallets for sign-in only", changes | Desktop 4,669 px tall, mobile 8,311 px; no sideways scrolling; no script errors | Nothing (static) | "Effective 2 November 2026" is written on the page. Since no Play date is promised, choose the real effective date before publishing |
| `/support/` | Email card (info@movenrun.xyz, reply within 3 working days), common questions (map, XP, signing in, wallet return code, new accounts closed at 1,000, no background tracking, no tokens, deletion), "Move safely" | 1,852 / 2,693 px; no sideways scrolling | Nothing (static) | "Within 3 working days" is a promise you make; confirm it |
| `/account-deletion/` | What is deleted; option 1 in the app; option 2 on this page (Google or wallet sign-in, then delete); option 3 by email, completed within 30 days | 1,537 / 2,207 px | Option 2 needs the API URL and publishable key (after X-06 and X-05). Until then it says "Online deletion is not available right now. Use the app or email us; both work." | "Within 30 days" is a promise you make. Play requires the deletion URL to work without the app; options 1 and 3 do already |
| `/sign-in/` (as the app opens it) | Wallet sign-in explainer; the warning "Only continue if you just tapped Continue with Wallet in the MovenRun app on this phone…" (F-06); the sign-in control | 900 / 1,037 px | API URL (X-06), Web3 provider (X-05) | With placeholders it shows "Online sign-in is not available right now. Use the app or email us; both work." That wording reads oddly on the app's own sign-in page. I have not changed it, pending your review |

**All four pages:**
- They share the header (Privacy · Delete account · Support) and the footer ("MovenRun is provided by Team MovenRun").
- On a 390 px phone, the header links wrap onto two lines. They are readable and nothing overflows.
- The security headers in `vercel.json` (no framing, nosniff, no-referrer, HSTS, permissions off) only take effect on Vercel, so they cannot be seen in a local preview.

## Homepage: flagged, not edited

`index.html` and its CSS are identical to `main`. They still describe things Play v1 does not ship. Please decide before X-21 whether the homepage stays as is:
- districts and "mastery";
- clubs ("Track streaks, clubs, and growth");
- Zone Deeds "recorded under your own keys";
- "MovenRun's contracts run on Base Sepolia… Mainnet at launch".

Play reviewers often compare the store listing with the developer website.

## What X-21 needs from you

1. Your review of these four pages, and of the homepage question above.
2. Your explicit approval to publish.

Only then: Vercel domain, DNS, filling in the placeholders, and the checks in `LIVE_SETUP_OPERATOR_GUIDE.md` gate X-21.
