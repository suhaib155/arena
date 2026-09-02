# The world grid

MovenRun has exactly one gameplay geography: **real H3, resolution 8**. This
document is the engineering reference for it — where it is defined, why the
layer exists at all, and what it deliberately does not do.

## Where it lives

| | |
|---|---|
| Canonical resolution | `shared/src/constants/h3.ts` — `H3_RESOLUTION = 8` |
| Domain module | `shared/src/domain/h3.ts` |
| Import path | `@movenrun/shared/h3` (geography only) or `@movenrun/shared` (everything) |
| Library | `h3-js` `^4.1.0` (resolved: 4.5.0) |
| Backend consumer | `backend/src/services/hex.service.ts` |
| Mobile consumer | `mobile/src/lib/territoryCells.ts` |

There is one definition of the resolution and no way to configure it. It is not
derived from zoom, not chosen per platform, and not read from the environment —
`backend/src/config.ts` used to carry an overridable `H3_RESOLUTION`, read by
nothing, and it has been removed. A guard
(`mobile/src/lib/__tests__/h3Foundation.test.ts`) scans the whole workspace for
a second definition and fails on one, naming `mobile/_legacy/` as the single
excluded tree.

## Why there is a domain layer rather than direct `h3-js` calls

Because the library fails **open** on bad input, in ways that produce a
plausible answer rather than an error. Measured against h3-js 4.5.0:

| Call | Input | Result |
|---|---|---|
| `latLngToCell` | latitude `91`, `1000` | a valid cell — the coordinate is wrapped |
| `latLngToCell` | longitude `200`, `540` | a valid cell, wrapped the same way |
| `cellToLatLng` | `"zzz"` | `[79.24, 38.02]` — a real-looking point |
| `cellToBoundary` | `"zzz"` | a six-vertex polygon spanning most of the globe |
| `gridDisk` | `"zzz"` | `[]` — a neighbourhood that is silently empty |
| `isValidCell` | `"8860145B49FFFFF"` | `true`, though `latLngToCell` only emits lowercase |

A latitude of 91 is not a location, and a route carrying one is a bug or an
attack. Wrapping it puts territory somewhere real, which is the worst available
outcome. Every entry point in the domain module validates first and throws
`H3DomainError`.

The uppercase case is different in kind and matters just as much: two strings
would denote one cell and compare unequal, so a `Set` would deduplicate one
piece of ground into two and any store keyed by cell id could hold two rows for
it. The canonical spelling is the lowercase one the library emits; the other is
rejected.

## Coordinate order

The API takes `{ latitude, longitude }`, never a positional pair. Reversal is
otherwise silent — both orders type-check, both are plausible numbers, and the
library accepts an out-of-range latitude by wrapping it, so a reversed pair
yields a real cell in the wrong hemisphere.

GeoJSON is longitude-first and H3 is latitude-first. That swap happens in
exactly one place, `cellBoundaryRing`, and nowhere else.

## Traversed cells: what they mean

`cellsForObservations` — and `HexService.getHexIdsForPoints`, which delegates to
it — returns the cells **containing observed points**, deduplicated, in
first-touch order.

This is containment of samples, **not** intersection of the path between them.
If two consecutive fixes land in cells that are not neighbours, the cells
crossed in between are not reported. Nothing interpolates.

That is the honest description of what the data supports: the device reports
samples, and the space between two of them is an assumption. **Sealing and solid
capture will need true path geometry and must derive it deliberately, with their
own proof, rather than inheriting a projection that was never that.** The
primitives they will need — boundary geometry, adjacency, a local layout — are
here; the interpolation is not, because it would be a guess wearing the same
name as a measurement.

## What a cell is not

A cell id is an identifier for a piece of ground. It carries no holder, no
capture, no strength, no seal, no solid/shade classification, no deed and no
verification status. Those are gameplay state that later phases attach to a cell
from the outside.

Keeping them out is architectural, not stylistic: the moment `solid` lives on
the cell type, every consumer of geography has to know about gameplay, and the
grid has to be replaced the first time the rules change.

In particular, on the current system: **a verified traversed cell is not owned
ground.** The backend measures movement and reports where it happened. It writes
no territory — `hex_activities`, `user_route_hexes` and `zones` exist in the
schema and have no writer — and the app's captured zones remain local preview
state that no server has agreed to.

## Bounds

`neighborhood(cell, radius)` refuses a radius above `MAX_NEIGHBORHOOD_RADIUS`
(3, at most 37 cells). A disk grows quadratically, so an unbounded radius
arriving from a screen, a zoom level or corrupted state is a render explosion.
The bound is a constant, so raising it is a reviewed change rather than a
caller's discretion.

Pentagons are handled by not assuming: twelve cells in the grid have five
neighbours rather than six, so cell counts are asserted as upper bounds and
vertex counts as a range.

## Privacy

**A sequence of H3 cells is location history.** Each resolution-8 cell is about
0.74 km², and an ordered list of them approximates a route.

So: no cell sequence is logged, sent to analytics, attached to crash metadata,
included in a shared proof, added to a chain payload, or written to durable
storage. The app derives cells transiently for the screen and keeps only the
cells it actually captures — single points, not a trail — plus a traversed
*count* on a verification record. `mobile/src/lib/__tests__/h3Foundation.test.ts`
guards the log, share and persist boundaries specifically, rather than sweeping
the repository with a regex a line break would defeat.

## The shared package

`@movenrun/shared` previously declared `./dist/index.js` as its entry, had no
`tsconfig.json`, and had no `src/index.ts` — so `yarn workspace @movenrun/shared
build` ran a bare `tsc`, printed the compiler's help text and exited 2. Nothing
could import the bare specifier: the backend reached past the exports map into
`../shared/src/*` through a path alias and excluded every file that used the
bare form from its type-check, and mobile did not depend on the package at all.

It now **exports its TypeScript source**:

```json
"main": "./src/index.ts",
"exports": { ".": "./src/index.ts", "./h3": "./src/domain/h3.ts" }
```

Source rather than a built `dist` because both consumers already transpile:
backend runs through `tsx`, mobile through Metro and `babel-preset-expo`. A
`dist` would make every consumer depend on a build step having run first —
including EAS, where nothing runs one — which is the failure this repair is
undoing.

Two entry points on purpose. `@movenrun/shared/h3` is geography alone; the root
is everything, including the emission schedule and deployed contract addresses.
Mobile imports the narrow one, so a phone does not carry a token supply schedule
in its bundle.

## Representation across the boundary

Mobile, backend and shared all speak the **string** H3 index — 15 lowercase hex
digits. The contracts speak **`uint64`**: `ZoneNFT`, `GPSOracle` and the
`DeedRegistry` in PR #80 all key on `uint64 hexId`/`cellId`, and `DeedRegistry`
carries `uint8 public constant H3_RESOLUTION = 8` explicitly referencing
`shared/src/constants/h3.ts`.

Those are two encodings of one 64-bit value, and the conversion is
`BigInt("0x" + cell)`. No third representation has been introduced. No contract
was changed.

## Map rendering

There is no map provider. The Territory screen is an abstract board, and the
route preview is drawn from session points on a plain canvas.

The board now **orders** its cells by real relative position — `localLayout`
places them on a local axial grid and they are read out north-to-south, then
west-to-east — instead of by a hash of the zone id. It is still a board: dense,
four columns, no holes, no scale, no bearing, no basemap. Adjacent ground tends
to appear near adjacent ground, and that is the whole of the claim.

A real map would need a provider decision (Mapbox, MapLibre, Google), a native
dependency, and a rendering path for `cellBoundaryRing`. That conversion exists
and is tested; the provider choice is deliberately not made here.
