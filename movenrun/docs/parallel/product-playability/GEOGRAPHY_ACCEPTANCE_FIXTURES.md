# Geography acceptance fixtures

Each fixture is a test in `research/product-playability/tests/geography.test.ts`
against `geography/coverage.ts`. All are SYNTHETIC and LOCAL. Result at this
commit: 12 of 12 PASS.

| Id | Requirement | How the test checks it | Result |
|---|---|---|---|
| GEO-01 | A ring of cells becomes one polygon with a hole | A k=2 disk minus its centre disk gives one polygon with an outer ring and an inner ring | PASS |
| GEO-02 | Disconnected patches stay separate | Two disks far apart give two polygons | PASS |
| GEO-03 | Areas crossing 180° stay contiguous | Cells at the antimeridian produce rings with no jump over 180° after unwrapping | PASS |
| GEO-04 | Polar cells do not crash | Cells near the pole give finite rings | PASS |
| GEO-05 | Adjacent states share boundaries with no overlap | The concept dataset gives every cell exactly one state, so no two state layers can cover the same cell. Overlap of drawn polygons is not checked | PASS |
| GEO-06 | Masked terrain is omitted, never shown as open ground | Masking reduces drawn area, and fully masked open ground draws no fill and no outline in any layer | PASS |
| GEO-07 | Pending claims are outline only | Pending and unconfirmed records have outlines and no fill | PASS |
| GEO-08 | Zoom coarsening compacts whole parents and invents nothing | Below zoom 14 the compacted set expands back to exactly the same res-8 cells, for a partial parent and a whole one | PASS |
| GEO-09 | Smoothing is display-only | Smoothed area stays within 10% of the raw area. Smoothing runs only on drawn rings, after the cell sets are fixed (by construction, not by a separate assertion) | PASS |
| GEO-10 | Public boards are coarse and crowd-limited | Only res-6 areas with 3 or more distinct players appear; no cell ids, routes or player ids are in the output | PASS |
| GEO-11 | The concept render is labelled and nameless | The SVG contains "SIMULATED / NOT LIVE" and none of the words street, avenue, park, district, city or owner | PASS |
| GEO-12 | States are not told apart by colour alone | Every state has a distinct pattern | PASS |

## Still needed before a real pilot

These cannot be tested with synthetic data. They need the real geometry and a phone.

- A district file for the pilot city, with its licence, loads and draws inside its true boundary.
- The overlay at zoom 12 to 17 on a mid-range Android phone keeps the map responsive (frame time, memory).
- Patterns read in sunlight at full brightness.
- TalkBack can reach each area's state as text.
