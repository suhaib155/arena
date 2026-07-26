# Design Polish & Real-Map Integration — Execution Plan

Branch: `claude/design-polish-map-integration-j9ni98`
Base: `review/pre-merge-audit` (the branch the reviewed APK was built from)
Status: **plan — not yet executed**

---

## 0. What was actually tested, and why the map was missing

The reviewed APK came from `review/pre-merge-audit`. That branch already
contains a real MapLibre map, a territory API, viewport loading, follow-mode and
capture preview — roughly 21k lines, all unit-tested. **None of it is reachable
from the screens the reviewer opened.** Three independent reasons, all verified
in code:

| # | Cause | Evidence |
|---|---|---|
| 1 | The **Territory** tab pushes `/territory/map`, which is the *decorative hex board*, not the map. The real screen is `/territory/live-map`. | `src/components/MovenTabBar.tsx` → `push("/territory/map")`; `app/territory/map.tsx` renders `Hexagon` cells from `buildTerritoryOverview` |
| 2 | `/territory/live-map` is only reachable via a **horizontally-scrolling quick-link row that renders only when you already own ≥ 1 zone**. A new user can never get to it. | `app/territory/map.tsx` — the `QuickLink` row is inside the `overview.total > 0` branch |
| 3 | The **active session** screen draws `RouteCanvas` — a decorative grid with floating hexes and "Waiting for movement…" — instead of the map. | `app/move/session.tsx:202` |

And even if you reached the real map, it would render as a grey world outline:

| # | Cause | Evidence |
|---|---|---|
| 4 | No tile style URL is configured, so `resolveMapConfig()` falls through to `DEVELOPMENT_FALLBACK_STYLE_URL` = MapLibre **demotiles** — country outlines, **no streets**. | `app.json` has no `extra.mapStyleUrl`; `eas.json` sets no `EXPO_PUBLIC_MAP_STYLE_URL`; `src/lib/mapConfigCore.ts` |
| 5 | No `EXPO_PUBLIC_API_BASE_URL`, so territory polygons can never load. | same |

So "the real map is nowhere to be found" is not a rendering bug — the map is
built, unwired, and pointed at a placeholder tile source.

---

## 1. Defect inventory (from the reviewed build)

Each row is a reviewer observation mapped to a verified root cause.

### D1 — Onboarding pager is dead on Android
*"cursor animation doesn't work as I swipe. neither it goes next when clicking
next, i eventually had to click skip"*

`app/onboarding.tsx:61-64` updates the page index **only** in
`onMomentumScrollEnd`. On Android a slow drag that snaps without a fling emits
no momentum event, so `index` stays `0`. Two visible consequences:

* the dots never advance (screenshot: slide 2 content, dot 1 lit);
* `next()` scrolls to `pageWidth * (index + 1)` — the page you are already on —
  so **Next does nothing forever**. Skip is the only exit.

### D2 — Two consecutive intro flows
`app/opening.tsx` (3 cinematic panels) runs, then `app/onboarding.tsx` (3 more
slides). Six full-screen intros before the product. This is the
"so many impressionalism" complaint. Last-step labels are also inconsistent
(`"Enter MovenRun"` vs `"Get started"`).

### D3 — Stock OS dialogs
`Alert.alert` produces an unstyled Android Material dialog with ALL-CAPS
`KEEP MOVING / FINISH` — no brand, no hierarchy, destructive and safe actions
weighted identically. Occurrences: `app/move/session.tsx:118,135`,
`app/active.tsx:57`, `app/account/security.tsx:120,133,158`,
`app/account/wallets.tsx:84,109`.

### D4 — Tab bar active indicator renders as a hard square
Round on Home, a hard-edged white square on Clubs and Profile.
`MovenTabBar.tsx` `tabDisc` is `42×42 / borderRadius 21` nested inside
`ScalePress`'s `Animated.View` transform — the rounding is being lost on the
navigated-to tabs. Needs an on-device repro; the fix is structural (below).

### D5 — Session controls clipped and ambiguous
Pause/Finish sit at the bottom of a non-scrolling column and are cut off by the
viewport on the reviewed device. Their labels also don't make the state
obvious — the reviewer could not tell which one stops and which continues.

### D6 — Type scale is not a scale
`src/theme.ts` defines `type.*`, but nearly every screen spreads a token and
then overrides it inline: `fontSize: 14.5`, `12.5`, `10.5`, `9.5`, `13.5`…
There is no rhythm, which is what "text sizing doesn't look perfect" is.

### D7 — Custom fonts were never shipped
`theme.ts` states outright that Sora / Plus Jakarta Sans / Space Grotesk are
"a deliberate follow-up PR". The app therefore renders in system Roboto while
the website renders in Sora. This is the single largest reason the app reads as
less mature than the site.

### D8 — Responsive helpers exist but are barely used
`src/lib/responsive.ts` (`fs`, `vh`, `isCompact`, `isTiny`) and
`src/hooks/useResponsive.ts` are used by **2 of 42 screens**
(`move/session.tsx`, `move/captured.tsx`). Everything else is fixed pixels.

### D9 — Palette divergence: app vs website
| | Canvas | Lead | Accents | Type |
|---|---|---|---|---|
| **Website** (`website/css/style.css`) | `#F8FAF7` bright | Base Blue `#246BFE` | green `#18C987`, violet `#7657FF`, coral `#FF6B4A`, gold `#F7B955` | Sora / Plus Jakarta / Space Grotesk |
| **App** (`mobile/src/theme.ts`) | `#F0E9DE` sand cream | Forest `#1E4D3A` | muted sage/peach/sand tints | system sans |

The app deliberately went warm and desaturated; against the site it reads flat.
This is the "looks so boring" complaint.

### D10 — Territory screen is decorative
`app/territory/map.tsx` renders hexes in offset rows with no geographic meaning,
and its empty state ("No territory yet") is where a map should be.

---

## 2. Decisions required before execution

### DEC-1 — Map provider

| Option | What ships | Cost | Effort |
|---|---|---|---|
| **A (recommended)** — keep MapLibre, point it at **OpenFreeMap Liberty** (`https://tiles.openfreemap.org/styles/liberty`) | A real OSM street map: named roads, buildings, parks, labels — the Google-Maps-style look the reviewer asked for | **No API key, no registration, no request limits** | ~0 — one config value; all 435 lines of `MovenRunMap` + territory fill layers + tests already work |
| B — keep MapLibre, MapTiler Streets | Slightly richer cartography | Free tier, **needs an account + key in EAS secrets** | ~0 code, + credential provisioning |
| C — swap to `react-native-maps` with the Google provider | Literally Google's tiles | **Google Cloud project + billing account + API key**, per-load pricing | Rewrite the map layer: `MovenRunMap`, `territoryStyle` fill expressions → per-`Polygon` components, `viewport`, `mapFollow`, and ~8 test files |

**Recommendation: A.** It gives the reviewer's actual goal — a true street map
with proper controls — today, with zero credentials, and preserves the tested
code. Option C additionally loses the single-`ShapeSource` rendering model that
keeps 1 500 territory cells at 60fps.

### DEC-2 — Territory polygon data source
Territory fills need `EXPO_PUBLIC_API_BASE_URL` pointing at a reachable backend.
Until one is deployed, the plan ships the map with **basemap + live route +
on-device capture preview**, and territory fills degrade to an explicit
"territory sync unavailable" chip rather than an empty map. No fake polygons.

---

## 3. Design direction

Reconcile the app onto the website's system, keeping the app's warmth where it
earns its keep.

**Canvas.** Move from `#F0E9DE` sand to the website's `#F8FAF7` morning white,
with `#FFFFFF` cards. Brighter canvas, more contrast, more air.

**Lead colour.** Base Blue `#246BFE` becomes the primary action colour (it is
the brand's chain identity and the site's lead). Forest green is retained as the
**territory-owned** colour, where it means something, rather than as the colour
of every button.

**Accents.** Website values verbatim: `#18C987` pulse green, `#58F2B3` volt
mint, `#7657FF` deed violet, `#FF6B4A` coral, `#F7B955` gold. These are the
"best colours" the reviewer asked for — they are already chosen, on the site.

**Type.** Ship the three real faces via `expo-font` + `@expo-google-fonts/*`:
Sora (display/titles), Plus Jakarta Sans (body/UI), Space Grotesk (numerals,
pace, distance, coordinates). This is the highest-leverage single change.

**Depth.** Keep the current soft warm shadows but raise contrast: hairline
borders on cards, real elevation on floating controls, one signature gradient
(`#246BFE → #7657FF`) reserved for the primary CTA and the Move button.

---

## 4. Workstreams

Ordered so each phase is independently shippable and reviewable.

### P1 — Design-system foundation
*Goal: one scale, one palette, real fonts. Nothing visual is hand-tuned per screen.*

* `src/theme.ts` — retone `palette` to the website values; keep every existing
  token **name** so all 42 screens inherit the change without edits (this is the
  established pattern in this file and must be preserved).
* `src/theme/typography.ts` *(new, split out of `theme.ts`)* — a real modular
  scale: `display / title / heading / subheading / body / bodySm / caption /
  kicker / mono`, each with `fontFamily`, `fontSize`, `lineHeight`,
  `letterSpacing`. No half-point sizes.
* `src/theme/fonts.ts` *(new)* — `useAppFonts()` loading Sora, Plus Jakarta
  Sans, Space Grotesk; `app/_layout.tsx` holds the splash until loaded.
* `src/lib/responsive.ts` — add `useScaledType()` so `fs()` is applied to the
  scale once, centrally, instead of per screen.
* **Sweep:** remove inline `fontSize` overrides across `app/**` and
  `src/components/**`, replacing them with scale tokens. This is mechanical and
  is what fixes D6 permanently.
* Deps: `expo-font`, `@expo-google-fonts/sora`,
  `@expo-google-fonts/plus-jakarta-sans`, `@expo-google-fonts/space-grotesk`.

### P2 — Make the map real and reachable
*Goal: the reviewer opens the app and sees streets.*

* `app.json` → `extra.mapStyleUrl` = OpenFreeMap Liberty (DEC-1 A);
  `eas.json` → `EXPO_PUBLIC_MAP_STYLE_URL` / `EXPO_PUBLIC_API_BASE_URL` per
  profile. Update `mapConfigCore.productionConfigProblems()` so a configured
  keyless provider is no longer reported as a problem.
* **Retire the decorative board.** `app/territory/map.tsx` becomes a redirect to
  the real map; the tab bar points at the real map directly. The hex board's
  *useful* parts (defence priority row, quick links) move into the map's bottom
  sheet. `Hexagon` stays — it is the brand mark, used in badges and the logo.
* `src/components/map/MapControls.tsx` *(new)* — the proper button cluster the
  reviewer asked for, over the map: recentre/follow, zoom ±, layer toggle,
  legend toggle, compass reset. Reuses the existing `FloatingMapControl`.
* `src/components/map/MapBottomSheet.tsx` *(new)* — collapsed / expanded sheet
  for selected-cell detail and session stats. Replaces `ZoneSheet`'s ad-hoc
  layout; keeps its API.

### P3 — Active session becomes map-first
*Goal: the recording screen looks like the reference (real map, route drawn live, stats card over it).*

* `app/move/session.tsx` — swap `RouteCanvas` for `MovenRunMap` with
  `followUser`, `showUserLocation`, and the live route feature built by the
  **existing** `lib/geo/routeGeoJson`. Map fills the screen; stats and controls
  float over it.
* Split the screen — it is currently one file doing tracking, clock, preview
  maths and layout:
  * `src/features/session/useSessionTracking.ts` — tracker + clock + pause
    (moved verbatim out of the screen, no behaviour change);
  * `src/features/session/SessionStatsPanel.tsx`;
  * `src/features/session/CapturePreviewCard.tsx` (wraps existing
    `lib/territory/capturePreview`).
* `RouteCanvas` / `RoutePath` are kept **only** for the summary/share card,
  where a stylised route is the right choice.

### P4 — One onboarding, one that works
* Delete the second flow. `app/onboarding.tsx` and `app/opening.tsx` collapse
  into `app/onboarding/index.tsx` with **3** panels, reusing the existing
  `openingAnimation` scan/pulse and `FadeSlideIn`.
* `src/features/onboarding/Pager.tsx` *(new)* — index driven by `onScroll`
  (`scrollEventThrottle={16}`) **and** `onScrollEndDrag`, not
  `onMomentumScrollEnd`. Fixes D1 at the root.
* `src/features/onboarding/PagerDots.tsx` — dots interpolate against the live
  scroll `Animated.Value`, so the pill slides with the finger instead of
  snapping. This is the "cursor animation" the reviewer expected.
* Final CTA label: **"Continue"**. Skip stays, but is no longer the only way out.
* `src/lib/__tests__/pager.test.ts` — pure index/interpolation maths, covering
  the exact drag-without-momentum case.

### P5 — In-app dialogs
* `src/components/ConfirmSheet.tsx` *(new)* — themed bottom sheet: title, body,
  primary and secondary actions, destructive variant, backdrop dismiss,
  `accessibilityViewIsModal`, focus trap.
* `src/hooks/useConfirm.ts` — promise-returning API so call sites read the same
  as `Alert.alert` did.
* Replace all 8 `Alert.alert` sites. "Finish session?" becomes a sheet whose
  primary action is **Finish** and whose secondary is **Keep moving**, with the
  session's distance/time restated so the choice is informed.

### P6 — Chrome and layout correctness
* `MovenTabBar.tsx` — active indicator becomes a **non-animated, absolutely
  positioned sibling** with explicit `width/height/borderRadius` and
  `overflow: "hidden"`, so no transform can round-trip it into a square (D4).
  Verify on device across all three tabs.
* `MovementControlBar.tsx` — controls pinned above the safe-area inset with
  guaranteed 56dp targets; icon + label + colour + shape all carry state
  (`▮▮ Pause` / `▶ Resume` / `⚑ Finish`), and Finish is visually separated.
* `Screen.tsx` — add `scroll` and `footer` variants so screens stop
  re-implementing overflow handling; this is what clipped D5.
* **Responsive sweep:** apply `useResponsive()` to every screen with a fixed
  hero/board height. Extend `src/lib/__tests__/responsive.test.ts` with the
  short-phone cases.

### P7 — Codebase structure
*The reviewer explicitly asked for this; it is a deliverable, not cleanup.*

* Rule: **screens compose, they don't compute.** Any `app/**` file over ~250
  lines gets its logic moved to `src/features/<name>/` and its sub-views to
  sibling components. Priority order by size: `move/summary.tsx` (27.8 KB),
  `deed-showroom.tsx` (23 KB), `city-war.tsx` (22.7 KB),
  `club-territory.tsx` (21.9 KB), `city-districts.tsx` (21.4 KB),
  `district-mastery.tsx` (20.8 KB), `crew-missions.tsx` (20 KB),
  `(tabs)/index.tsx` (19.3 KB), `(tabs)/clubs.tsx` (19.2 KB).
* Introduce `src/features/` as the home for screen-specific logic + views.
  `src/components/` stays reserved for genuinely shared primitives.
* **Reuse, don't rewrite.** These already exist and must be used rather than
  reimplemented: `MovenRunMap`, `lib/territory/{territoryStyle,viewport,mapFollow,capturePreview,realtimeReconcile}`,
  `lib/geo/{routeGeoJson,routeSample,runStorage}`, `services/location/*`,
  `lib/{responsive,ring,gradient}`, `components/{Gradient,ProgressRing,ListSection,MetricValue,TintedNavCard,LoadingState,EmptyState}`.
  `mobile/_legacy/` remains reference-only and is not deleted.

### P8 — Verification
* `yarn workspace @movenrun/mobile lint` (tsc) and `test` green; new pure
  modules (pager maths, confirm-sheet state, type scale) get offline tests in
  the existing `node --test` harness.
* Device pass on a short Android phone (the reviewed device class) against
  `docs/PRE_MERGE_DEVICE_TEST_PLAN.md`, plus the specific regressions: onboarding
  swipe + Next, tab indicator on all three tabs, session controls not clipped,
  map renders streets, recentre works.
* Screenshot diff of every touched screen appended to the PR.

---

## 5. Explicitly out of scope
* Contracts — no change (`contracts/` diff must stay empty).
* Wallet connection, liquid MOVE, token rewards — blocked by the roadmap
  guardrail.
* Backend feature work beyond configuration; the territory API is already built.
* Expo SDK upgrade — separate PR by standing policy.

---

## 6. Suggested execution order
`P1 → P2 → P3 → P4 → P5 → P6` as reviewable commits, with `P7` applied
continuously to every file touched, then a dedicated `P7` pass for the large
screens the earlier phases did not reach, then `P8`.
