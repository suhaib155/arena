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

## Notes

- Fonts (Sora, Plus Jakarta Sans, Space Grotesk) load from Google Fonts; the
  page degrades gracefully without them.
- Copy follows the product guardrails: Locked MOVE is presented as in-app
  progress (no earnings implied), and liquid rewards are explicitly gated on
  GPS verification, density, and sponsor demand.
