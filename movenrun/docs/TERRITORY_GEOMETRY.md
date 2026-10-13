# Territory geometry: map regions, not hexagons

**Owner rule (14 Oct 2026):** H3 is how the server indexes ground. It must not
be what a player sees. The map shows coloured areas on the real street map.

This is the contract between the server's cells and a map. The code is
`shared/src/domain/territoryGeometry.ts`, and the first endpoint is
`GET /movement/coverage`.

## The contract

`regionsForCells(cells, state, { outline })` returns a GeoJSON
`FeatureCollection` of `MultiPolygon` regions (RFC 7946):

| Field | Meaning |
|---|---|
| `id` | Opaque and stable for the same cells (a hash, never a cell id) |
| `geometry` | Neighbouring cells merged into one area. Internal edges removed, holes kept, outer rings counter-clockwise |
| `properties.state` | One of `covered`, `held`, `contested`, `at_risk` |
| `properties.cellCount`, `areaKm2` | Size of the area |
| `properties.cellEdgeMeters` | About 530 m: the honest precision of the area |
| `properties.outline` | `exact` (the true cell union) or `smoothed` (rounded corners, for display only) |

## Rules

1. **The cell set is the authority.** A `smoothed` outline is a picture of
   the ground. It is not the ground. Nothing may decide ownership from it.
2. **Only states the server computes.** Today the only one is `covered`: the
   ground a player's verified sessions passed through. `held`, `contested`
   and `at_risk` wait for the server-side territory ledger (sealing claims,
   erosion, other players; packets G2–G4). A client never shows them from
   local state.
3. **No cell ids, routes or session ids leave the server** in this shape. A
   region is at least one cell (about 0.66 km²), so it cannot reveal a route
   or an address more precisely than the cells already do.
4. **Bounded.** At most 5,000 cells per call. Coverage reads the newest 500
   sessions; if they hold more ground than that, the oldest ground is left
   out and `basis.truncated` is true.
5. **Bad input is refused, not dropped.** Calls to `regionsForCells` throw on a
   cell id that is not canonical. Coverage skips an invalid stored id and
   counts it in `basis.skippedCells`.

## `GET /movement/coverage`

- **Auth and caching:** bearer token, owner-scoped, `Cache-Control: no-store`.
- **Rate limit:** the same as a write.
- **Response:** the FeatureCollection plus
  `basis: { sessionsUsed, truncated, skippedCells }`.
- **Outline:** `?outline=smoothed` returns display outlines.

It is coverage, not ownership: nobody holds ground because of it.

**Not deployed.** The approved deploy commit (dd83065) does not include it,
and the app does not call it, because the mobile frontend is on hold.

## Limits

- Areas that cross the antimeridian are not handled specially.
- Smoothing works in degrees. That is fine at city scale, but it is not a
  geodesic operation.
