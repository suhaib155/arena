# Map geography product spec

PROPOSED. This describes a future, opt-in territory overlay. Nothing here is
built in the app, and clubs and territory stay hidden in v1. The concept code in
`research/product-playability/geography/` is SIMULATED and not wired to anything.

## Owner rules this follows

- MovenRun's long-term game is territory strategy and movement. Clubs, districts,
  sealing, territory control and Deeds are core, built later through scoped, tested PRs.
- H3 hexes are backend-only. The player sees a real map with coloured
  geographic areas, never a hex board.
- Play v1 is a movement game. Nothing on the map is owned, earned or paid out.

## What the player sees

1. **The base map is real.** Google Maps tiles with their attribution, as the
   app already uses. No custom basemap.
2. **Areas, not cells.** The server's res-8 cells for one state are merged into
   one polygon, then smoothed for display. The smoothing is display-only: it
   never changes which cells are in which state. GEO-09 checks the smoothed
   area stays within 10% of the raw area.
3. **Coarser when zoomed out.** Below zoom 14, whole parent cells of one state
   are compacted. Partial parents stay detailed. Coarsening never invents coverage (GEO-08).
4. **Five display states**, each with a pattern as well as a colour, so the map
   works in glare and for colour-blind players (GEO-12):

| State | Pattern | Label |
|---|---|---|
| solid | filled | Solid |
| shade | hatch | Shade |
| contested | crosshatch | Contested |
| unclaimed | none | Open ground |
| pending | dashed outline only | Awaiting check |

5. **Nothing unconfirmed is ever filled.** A claim the server has not confirmed
   is drawn as a dashed outline (GEO-07). This keeps the local preview from
   looking like a server fact.
6. **Masked terrain is omitted**, not drawn as open ground. Water, private land
   and any operator-masked area are removed before drawing (GEO-06).

## Where district boundaries come from

Districts must never be invented from cells, and must never claim to be a city's
official boundary unless they are.

- **Operator-uploaded geometry only.** An operator uploads a district file for a
  pilot city: GeoJSON, with a version, a source and a licence. The server stores
  each version and never edits it in place.
- **Attribution travels with the geometry.** If the source is OpenStreetMap or a
  council dataset, its attribution is shown on the map wherever the boundaries are drawn.
- **No fabricated districts.** Until a city has uploaded geometry, the map shows
  areas only, with no district names or lines.
- **Versioned.** A season pins one geometry version, so boundaries cannot move under players mid-season.
- **Concept stays nameless.** The concept render has no place names, and GEO-11 enforces this.

## Public boards

The only public shape is a count of distinct players per coarse area: res-6,
about 36 km². An area is shown only with at least 3 players. A board never
shows cells, routes, start points or player ids (GEO-10). See
[MAP_PRIVACY_THREAT_MODEL.md](MAP_PRIVACY_THREAT_MODEL.md).

## Maps key and billing

- The Android Maps key must be restricted to the app id `io.movenrun.app` and the
  release signing certificate's SHA-1. The device protocol checks this (QA0-07).
- Polygons are drawn client-side over the existing map. No extra Maps API
  product, and so no new billing line, is needed for the overlay.
- Nothing in this track touched the Maps console or billing.

## Concept render

`geography/conceptDataset.ts --write` draws 91 cells in clustered states over
the open Atlantic. The output, `concept-coverage.svg`, is stamped
SIMULATED / NOT LIVE. Visually it reads as organic coloured areas, not hexagons.

## Open product decisions

1. Which pilot city, and who supplies its district geometry and licence.
2. Whether "contested" is shown in the first pilot at all, or only solid and open ground.
3. The public board's minimum crowd. 3 is the floor here; a larger number is safer in a small pilot.
