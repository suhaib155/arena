# MovenRun — Landing Website + Documentation

Two static surfaces, one folder, zero build steps:

1. **Landing page** (`index.html`) — the cinematic health-first marketing site.
2. **Documentation portal** (`docs/`) — a self-contained, GitBook-style docs
   site + the MovenRun whitepaper: pages across Start here / Product /
   Technology / Roadmap / Resources, with client-side search, a responsive
   sidebar/drawer, right-rail table of contents, 14 original SVG diagrams, and
   a printable whitepaper (`/docs/whitepaper/`, print styles + a
   Print/Save-as-PDF control). The docs describe the movement game that exists
   today and the onchain layer it is designed to grow into, and they are
   explicit about which is which: deeds are planned and not live, nothing has
   been minted, and no wallet or gas sponsorship has been built.
   See `docs/README.md` for the voice rules that keep it that way. They are
   the project's source of truth and link to no external references.

The docs are integrated into the landing page: a **Docs** link in desktop and
mobile navigation, and **Read the whitepaper** (`/docs/`) as the primary CTA in
the navigation, the final section and the mobile sticky bar, with a secondary
**How it works** link. There is no social, waitlist, beta, download or
app-store CTA, and no placeholder external link.
`sitemap.xml` and `robots.txt` cover both surfaces.

Docs maintenance (voice, self-contained rule, the non-negotiable
no-financial-promise safety line, diagrams, and the validation checklist) is
documented in **`docs/README.md`**.

Cinematic single-page marketing site for MovenRun, built in the **“Daylight
Cartography”** design language: bright light-mode, frosted glass cards, a
procedural daylight globe, and scroll-driven 3D storytelling that walks from
orbit → city → map areas → movement session → wellbeing summary → community →
responsible Web3 → roadmap → final CTA.

## Positioning

The site presents MovenRun **health-first**:

1. **Health and movement** — walking, running, and cycling; active time,
   consistency, personal goals, exploration, and wellbeing. No medical claims.
2. **Territory and play** — the city as a movement playground: capturing and
   strengthening zones, streaks, clubs, and friendly city challenges.
3. **Responsible Web3** — a *planned* ownership layer, described in the
   future tense because it does not exist. Nothing has been minted, and no
   wallet or gas sponsorship has been built. Never required to play, never framed as income or a financial
   return.

Public-facing copy deliberately avoids speculative language: no earnings
promises, no token or launch metrics, no grid or coordinate internals, and no
unverified numbers. Marketing pages name no chain environment (no test
network or mainnet labels) and show no contract addresses; deeds are labelled
as planned and not live. The single technical statement about deployment
lives on the docs roadmap: mainnet deployment is an objective for the official
launch and has not happened. Pages carry no publication, effective or launch
dates and no countdowns. The footer and the
wellbeing and ownership sections carry explicit “no financial promises”
disclaimers.

## Run it

Static site — no build step, no npm packages, no JS dependencies.

```bash
cd movenrun/website
python3 -m http.server 8080   # or any static server
# open http://localhost:8080
```

Opening `index.html` directly from disk also works.

## Deploying to Vercel

Static export, `vercel.json` in this folder sets the build to a no-op. Project settings:

- **Root Directory:** `movenrun/website`
- **Framework Preset:** Other
- **Install Command:** (empty)
- **Build Command:** (empty)
- **Output Directory:** `.`

### Public values in the sign-in and deletion pages

There is no build step, so nothing is injected at build time. The pages read
their configuration from `<meta>` tags:

- `movenrun-api` (in `sign-in/` and `account-deletion/`) is the public API
  origin, `https://movenrun-staging-api.onrender.com`, already filled in. It
  must stay in step with `connect-src` in `vercel.json`.
- `movenrun-supabase-url` is the public Supabase project URL, already filled in.
- `movenrun-supabase-publishable-key` (in `account-deletion/`) stays as the
  placeholder `{{SUPABASE_PUBLISHABLE_KEY}}` in Git. At publish time the owner
  replaces it with the project's **publishable** key (`sb_publishable_…`,
  public by design), then runs `node scripts/check-launch-placeholders.mjs`
  from `movenrun/`. The check fails while a placeholder remains and refuses a
  secret key (`sb_secret_…`) or a legacy JWT key. Never put a secret key in
  any page. Until the key is filled in, the deletion page hides "Continue with
  Google"; wallet sign-in and wallet deletion need only the API.

## Structure

- `index.html` — all eleven scroll scenes (hero, globe-to-city descent, core
  loop cards, app walkthrough, live movement session, wellbeing summary, core
  experience vs. optional ownership, clubs & community, responsible Web3,
  roadmap, final CTA) plus the responsive navigation and professional footer.
- `css/style.css` — design tokens (palette, type, easing, glass), all motion
  keyframes, responsive + `prefers-reduced-motion` fallbacks. **Unchanged** by
  the polish pass.
- `css/polish.css` — polish layer loaded after `style.css`: skip link and
  keyboard focus states, the `<details>`-based mobile menu, hero principle
  chips, the “Our approach” card, the structured footer, `100svh` +
  safe-area-viewport hardening, and narrow-width fixes.
- `js/globe.js` — procedural canvas-2D daylight Earth. **Unchanged.**
- `js/main.js` — the scroll engine: smoothed sticky-scene progress drives the
  globe descent camera, phone screens, live-session route draw, roadmap orb and
  page-long runner rail; IntersectionObservers fire the one-shot moments.
  The club board and district map paint once and stay static.

The only JavaScript added by the polish pass is `js/nav-menu.js`, a small
progressive enhancement that closes the native `<details>` mobile menu after a
link is chosen (or on Escape / outside click). The menu is fully functional
without it. No page carries inline scripts or styles.

## Navigation

- **≥1101px** — full pill navigation (How it works · Experience · Wellbeing ·
  Community · Onchain · Roadmap · Docs) plus the “Read the whitepaper” CTA.
- **≤1100px** — pill hides; a keyboard-operable `<details>/<summary>`
  hamburger menu appears with all links and a prominent CTA.
- **≤720px** — the desktop CTA hides; the mobile menu and the sticky bottom
  CTA take over.
- **≤480px** — single-column footer; the menu dropdown stays within the
  viewport (`min(340px, 100vw - 32px)`).

“Read the whitepaper” points at `/docs/`. All external links use
`target="_blank" rel="noopener noreferrer"`; there are no `href="#"` dead links.

## Footer

Structured consumer-product footer: brand column (description +
“Health-first by design” badge), Product / Principles / Community link
columns, © 2026 copyright line, and a development + no-financial-advice
disclaimer. Collapses 4 → 2 → 1 columns at 920px / 480px.

## Design & animation notes

- Design language: **Daylight Cartography** — bright light-mode, frosted
  glass, map-territory identity (rounded parcels on a real street map; the
  internal grid is never drawn), Base Blue / Pulse Green / Volt Mint / Deed
  Violet accents. No dark crypto-dashboard visuals.
- One continuous "journey" route threads the whole page; it draws with scroll
  and a glowing runner orb travels it. Hidden ≤1100px and under reduced motion.
- All scroll scenes run off one rAF loop with smoothed progress. Every DOM
  hook consumed by `main.js` (splash, journey, hero globe, descent, city
  stage, phone screens, session, reward, economy, clubs, roadmap, final scene,
  mobile CTA) is preserved verbatim.
- Fonts (Sora, Plus Jakarta Sans, Space Grotesk) load from Google Fonts with
  system fallbacks; the page stays readable if the font request fails. No
  other external requests.

## Verification matrix

Checked with headless Chromium (Playwright) after the polish pass:

| Viewport | Overflow (`scrollWidth === clientWidth`) | Console errors | Notes |
| --- | --- | --- | --- |
| 360 × 800 | pass | none | mobile menu, sticky CTA, single-column flows |
| 375 × 812 | pass | none | |
| 390 × 844 | pass | none | phone mockup inside viewport |
| 430 × 932 | pass | none | |
| 768 × 1024 | pass | none | mobile menu + desktop CTA |
| 1024 × 768 | pass | none | mobile menu + desktop CTA |
| 1280 × 800 | pass | none | full navigation |
| 1440 × 900 | pass | none | full navigation + journey rail |
| 1920 × 1080 | pass | none | large-desktop layout |

Also verified at multiple scroll positions per viewport: splash dismissal,
hero globe + route draw, globe-to-city descent and area cascade, all six phone
walkthrough screens, the scroll-driven session demo and zone toasts, reward
particles, economy cards, clubs map + leaderboard, roadmap orb, final
route animation, mobile menu open/close (pointer + keyboard), anchor
navigation, external CTAs, visible focus states, and `prefers-reduced-motion`
static rendering.

## Product guardrails

- XP is presented as an **in-app gameplay feature**, with an inline note that
  MovenRun does not promise financial returns. Points are planned and are not
  shown as earned in the app.
- Territory (claiming, holding and decay, districts and mastery) is labelled
  once per section as an **on-device preview**. Server-held territory and
  clubs syncing between players are planned and never shown as live.
- Ownership (Zone Deeds) is framed as an **optional, future layer**
  introduced only with product readiness, legal compliance, and clear
  community benefit. No urgency, scarcity, or investment language.
- The clubs leaderboard and city-district map are labelled as an
  **interface mockup** with sample numbers. Both are static: no ticking
  counters, reordering rows or changing areas that imitate live activity.
  The sample session summary shows fixed numbers rather than count-ups.
- The map visuals are organic parcels on a street map. No hexagons or
  hex grids appear anywhere on the site.
- No launch dates, city counts, or mainnet commitments are promised.
