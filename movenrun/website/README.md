# MovenRun — Landing Website + Documentation

Two static surfaces, one folder, zero build steps:

1. **Landing page** (`index.html`) — the cinematic health-first marketing site.
2. **Documentation portal** (`docs/`) — a self-contained, GitBook-style docs
   site + the MovenRun whitepaper: pages across Start here / Product /
   Technology / Roadmap / Resources, with client-side search, a responsive
   sidebar/drawer, right-rail table of contents, 14 original SVG diagrams, and
   a printable whitepaper (`/docs/whitepaper/`, print styles + a
   Print/Save-as-PDF control). The docs present MovenRun as an onchain movement
   network on Base — verifiable movement, true ownership, a real token economy,
   and community governance — built so anyone can use it without crypto
   knowledge. They are the project's source of truth and link to no external
   references.

The docs are integrated into the landing page: a **Docs** link in desktop and
mobile navigation, a **Read the docs** CTA in the final section, and
Docs / Whitepaper / Current status links in the footer. The primary social
CTA is **Follow on X** (`https://x.com/` — temporary destination until an
official MovenRun profile exists; no handle is invented).
`sitemap.xml` and `robots.txt` cover both surfaces.

Docs maintenance (voice, self-contained rule, the non-negotiable
no-financial-promise safety line, diagrams, and the validation checklist) is
documented in **`docs/README.md`**.

Cinematic single-page marketing site for MovenRun, built in the **“Daylight
Cartography”** design language: bright light-mode, frosted glass cards, a
procedural daylight globe, and scroll-driven 3D storytelling that walks from
orbit → city → hex grid → movement session → wellbeing summary → community →
responsible Web3 → roadmap → final CTA.

## Positioning

The site presents MovenRun **health-first**:

1. **Health and movement** — walking, running, and cycling; active time,
   consistency, personal goals, exploration, and wellbeing. No medical claims.
2. **Territory and play** — the city as a movement playground: capturing and
   strengthening zones, streaks, clubs, and friendly city challenges.
3. **Responsible Web3** — an optional, gradual, user-controlled ownership
   layer on Base. Never required to play, never framed as income or a
   financial return.

Public-facing copy deliberately avoids speculative or technical language:
no earnings promises, no token/launch metrics, no grid or coordinate
internals, no contract or testnet details, and no unverified numbers. The
footer and the wellbeing/ownership sections carry explicit “no financial
promises” disclaimers.

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
  **Unchanged.**

The only JavaScript added by the polish pass is a small inline progressive
enhancement in `index.html` that closes the native `<details>` mobile menu
after a link is chosen (or on Escape / outside click). The menu is fully
functional without it.

## Navigation

- **≥1101px** — full pill navigation (How it works · Experience · Wellbeing ·
  Community · Web3 · Roadmap) plus the “Follow the launch” CTA.
- **≤1100px** — pill hides; a keyboard-operable `<details>/<summary>`
  hamburger menu appears with all links and a prominent CTA.
- **≤720px** — the desktop CTA hides; the mobile menu and the sticky bottom
  CTA take over.
- **≤480px** — single-column footer; the menu dropdown stays within the
  viewport (`min(340px, 100vw - 32px)`).

“Follow the launch” points at the GitHub repository until an official
waitlist or download page exists. All external links use
`target="_blank" rel="noopener noreferrer"`; there are no `href="#"` dead links.

## Footer

Structured consumer-product footer: brand column (description +
“Health-first by design” badge), Product / Principles / Community link
columns, © 2026 copyright line, and a development + no-financial-advice
disclaimer. Collapses 4 → 2 → 1 columns at 920px / 480px.

## Design & animation notes

- Design language: **Daylight Cartography** — bright light-mode, frosted
  glass, hex-territory identity, Base Blue / Pulse Green / Volt Mint / Deed
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
hero globe + route draw, globe-to-city descent and hex cascade, all six phone
walkthrough screens, live session counters and zone toasts, reward count-ups
and particles, economy cards, clubs map + leaderboard, roadmap orb, final
route animation, mobile menu open/close (pointer + keyboard), anchor
navigation, external CTAs, visible focus states, and `prefers-reduced-motion`
static rendering.

## Product guardrails

- Movement points / XP are presented as **in-app gameplay features**, with an
  inline note that MovenRun does not promise financial returns.
- Ownership (Zone Deeds) is framed as an **optional, future, Base-powered
  layer** introduced only with product readiness, legal compliance, and clear
  community benefit. No urgency, scarcity, or investment language.
- The clubs leaderboard and city-challenge map are labeled as an
  **illustrative product preview**, not live data.
- No launch dates, city counts, or mainnet commitments are promised.
