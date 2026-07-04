# MovenRun — Landing Website

Cinematic single-page launch site for the MovenRun territory economy, built in
the **“Daylight Cartography”** design language: bright light-mode, frosted glass
cards, a procedural daylight globe, and scroll-driven 3D storytelling that walks
from orbit → city → hex grid → movement session → capture → defend → own → beta CTA.

## Run it

Static site — no build step, no JS dependencies.

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
  loop cards, app mockup, live session, reward summary, territory economy,
  clubs & city wars, built-on-Base, roadmap, final CTA).
- `css/style.css` — design tokens (palette, type, easing, glass), all motion
  keyframes, responsive + `prefers-reduced-motion` fallbacks.
- `js/globe.js` — procedural canvas-2D daylight Earth (oceans, stylized
  continents, drifting clouds, H3-style hex wrap, atmosphere, GPS dot). No
  WebGL, no textures.
- `js/main.js` — the scroll engine: smoothed sticky-scene progress drives the
  globe descent camera, phone screens, live-session route draw, roadmap orb and
  page-long runner rail; IntersectionObservers fire the one-shot moments
  (count-ups, reward particles, hex cascades, leaderboard war).

## Design & animation notes

- Design language: **Daylight Cartography** — bright light-mode, frosted glass,
  H3 hex identity, Base Blue / Pulse Green / Deed Violet accents. No dark mode,
  no crypto-casino visuals.
- One continuous "journey" route (catmull-rom path built at runtime from
  section positions) threads the whole page; it draws with scroll and a glowing
  runner orb travels it, lighting a milestone hex per section. Hidden ≤1100px
  and under reduced motion.
- Easing: `cubic-bezier(.22,1,.36,1)` for UI, `cubic-bezier(.19,1,.22,1)` for
  the map camera, soft-overshoot spring for pops. All scroll scenes run off one
  rAF loop with smoothed progress.
- Fonts (Sora, Plus Jakarta Sans, Space Grotesk) load from Google Fonts; the
  page degrades gracefully without them. No other external requests.

## Product guardrails

- Locked MOVE is presented as **in-app progress, not a payout** (stated inline
  in the reward section); liquid rewards are framed as future and conditional
  on GPS verification, city density, and sponsor demand. No earnings promises.
- The contract snippet is a read-only display mock — no addresses, keys, or
  live chain calls.

## Verification

Checked with headless Chromium (Puppeteer) at 1440×900 and 390×844:

- Full scroll-through on desktop and mobile: zero console errors / page errors.
- Journey route builds (12 milestone nodes), draws with scroll, orb tracks.
- `prefers-reduced-motion`: journey + clouds hidden, sticky scenes unstack to
  static sections, counters render final values, all content readable.
- No horizontal layout overflow at any scroll position (`overflow-x: clip` on
  root); sticky scenes verified intact.
- Mobile sticky CTA hidden at top, shown mid-page, hidden at the final CTA.
