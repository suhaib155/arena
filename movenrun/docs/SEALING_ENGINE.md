# The sealing engine

**Nothing about a route becomes claimable ground until the route seals.** This
is the mechanic that turns a tracker into a game, and this document is what it
does, what it deliberately does not do, and which of its rules are settled
versus provisional.

## What sealing is not

A seal event says a loop closed. It says nothing about who holds the ground
inside it, whether that ground is solid or shade, or whether anything is owed
for it. `sealed === true` is never a synonym for `owned === true`, and no code
path here reads, writes or implies ownership.

| Layer | Question | Where it lives |
|---|---|---|
| Live preview | did I just close a loop? | `mobile/src/lib/sealPreview.ts` — **guidance** |
| Verified sealing | did the route the server believes close? | `shared/src/domain/sealing.ts`, run in `backend/.../domain/verification.ts` — **authority** |
| Territory claim | what ground does that closure win? | **does not exist** (#94 solid, #95 shade) |

## The three methods

```
SEAL_METHODS = ["self_cross", "return_to_start", "finish_on_held_ground"]
```

Exactly three. There is no rival trail cut, no cooperative pincer, no
administrative seal, no purchased seal and no timeout seal — each is either a
later mechanic with unsettled safety questions or something the product has
never asked for, and a value in the enum would be one the server must reject
and a reader would assume was supported. An unrecognised method name read back
from storage is dropped at the boundary rather than passed on.

### Come home — `return_to_start`

Finish within **150 m** of the session start, measured **geodesically**
(`haversineMeters`). Not a planar approximation of degrees, not a map-pixel
distance, and not H3 cell equality: each of those is a different rule wearing
the same number.

The comparison is **inclusive** — `distance <= 150` — because the natural
reading of "within 150 metres" includes 150, and a rule whose behaviour at its
own stated number is undefined is not a rule. Tested at 149.5 m, exactly 150 m
and 150.5 m.

The seal is decided **at Finish**. Entering the radius mid-session changes the
preview, never the session.

### Cut your own line — `self_cross`

A new stretch of route crosses an earlier one; the loop between them closes
immediately and the session carries on. This is the only mid-session method.

### Come to ground — `finish_on_held_ground`

Finish on an H3 resolution-8 cell you already hold — the **exact** cell, never a
neighbour.

**The domain implements this fully and it is fully tested. Production sealing
never uses it**, because it needs a *trusted* held-cell set and no authority
produces one: the app's zone list is local preview state that no server has
agreed to. The server passes `heldCells: null`, and the engine reports the
method **unavailable** rather than false — "nobody who can be believed has been
asked" is a different fact from "you were not standing on your own ground".

A client cannot supply held cells. The strict schema refuses `heldCells`,
`capturedCells`, `finishOnOwned` and every relative; a client that could name
its own ground could seal at will. This activates when #96 supplies
server-authoritative territory.

## Geometry

### The space

Distance is geodesic. Intersection is planar, in a **local equirectangular
tangent frame** centred on the session's first point (`shared/src/domain/geo.ts`).

```
x = R · Δλ(normalised) · cos φ₀      y = R · Δφ
```

The frame's error grows as roughly `(d/R)²/6` — about 4 m at 100 km. That is
irrelevant to what it is used for: two segments only cross if they are within
metres of each other, and over that separation the frame is consistent to well
under a millimetre. **Topology survives; absolute position is not what the
answer depends on.** Beyond `MAX_PROJECTION_RADIUS_M` (100 km) the projector
refuses rather than returning quietly wrong geometry, and self-cross is reported
unavailable for that route.

Longitude deltas are wrapped into (−180, 180], so a route straddling the
antimeridian projects and measures continuously. Poles are refused: `cos(90°)`
collapses every longitude onto one line.

No geometry dependency was added. `h3-js` remains the only spatial package.

### What counts as a crossing

A **proper transverse crossing** and nothing else:

- not parallel (`|cross product| >= PARALLEL_EPSILON_M2`);
- neither segment degenerate (`>= DEGENERATE_SEGMENT_M`, 1 cm);
- the intersection strictly interior to **both** (`PARAM_EPSILON < s,t < 1−ε`).

Consequences, each deliberate:

| Case | Seals? | Why |
|---|---|---|
| Transverse cut through an earlier segment | **yes** | the signature of cutting your own line |
| Endpoint touch / T-junction | no | this is what GPS noise produces all day |
| Shared vertex with the previous segment | no | that is the route continuing |
| Collinear retrace (out-and-back) | no | parallel segments never intersect here |
| Partial overlap, containment | no | same |
| Zero-length or duplicated fix | no | a point has no direction to cross |

`PARAM_EPSILON` is a **degeneracy guard, not a proximity radius** — it is a
fraction, and on the shortest segment the tracker can produce (2 m) it excludes
a few nanometres. A test asserts the distinction, because a tolerance that grew
into "near any old trail" would be a gameplay rule nobody wrote down.

### Adjacency

Segment `i` and segment `i−1` share a structural vertex. They are excluded by
**that shared vertex**, not by a magic "ignore the last N points". Without the
rule a session would seal on its third fix and never stop; a 60-point zigzag
test proves it does not.

### Route breaks

The route is a set of continuous stretches. A break sits between two consecutive
fixes when either:

1. a **declared pause** overlaps the span between them, or
2. the straight-line jump exceeds `continuityBreakMeters` (200 m).

The segment spanning a break is **not created**. Not shortened, not flagged —
absent, because a segment that was never observed must not be available to
cross. Whatever happened in that gap is unknown, and the line across it is a
guess.

Rule 2 is how a **tracking gap** is caught without transmitting one. Gaps are a
mobile-only record (`FinishedSession.gaps`) and are deliberately **not** sent:
a client-supplied field that makes sealing *easier by omission* would be client
authority through the back door. What the server can see for itself is a jump no
sampling could have followed, and that is the same evidence.

Stretches either side of a break are real route and **may** cross each other.
Only the bridge is missing.

Return-to-start still evaluates across a broken route — it depends on two
endpoints, not on continuous geometry. `subpathCount` is reported so later
territory work can decide whether a closure is usable for enclosure.

### Multiple closures, and the open trail

A session may close many times. Events are ordered and each carries its own
route slice.

After a closure the **open-trail anchor** advances past the closing segment.
That is what makes the same geometric closure impossible to seal twice — no
cooldown timer, no clock a replay cannot see, just a route structure that cannot
produce the event again. Jitter around a crossing point produces one event, not
a stream.

When one long step cuts two earlier stretches, candidates are ordered by
position along the incoming step and the **nearest** closes. The anchor then
consumes the rest: the second cut is inside ground already banked.

## The output

```ts
SealEvent {
  sequence; method; startIndex; endIndex; closure; atFinish
}
```

**A seal event contains no coordinates.** It carries point indices and fractions
along segments, which whoever holds the route can turn back into a position and
nobody else can. That is enough for #95 to build an exact closed polygon —
`X → p[start] → … → p[end] → X` — and it means a seal result can be returned,
stored or logged without carrying location.

Closure shapes: `crossing` (both fractions locate the same point), `endpoints`
(join the last point back to the first), `undetermined` (held ground — what it
encloses is an open product question, recorded honestly rather than guessed).

## Rules versions

`sealingRulesFor(rulesVersion)` is the only source of sealing parameters:

| Version | `returnRadiusMeters` | `continuityBreakMeters` |
|---|---|---|
| 1 | 150 | 200 |

Not configurable. No environment variable, no remote config, no build flag, no
UI selector — a per-server seal radius would mean two players on the same street
get different answers, which is the mistake the dormant `H3_RESOLUTION` override
already taught this repo. An **unknown version returns null and every caller
fails closed**: no events, no preview, no summary.

A session's version is stamped at Start and immutable, so a route captured today
is still read under today's rules after the numbers change.

`rulesVersion` is gameplay semantics; storage schema version is serialisation.
They stay separate.

## Where it runs

```
authenticate → validate structure/provenance → verify observations
  → (verified only) evaluate sealing from the accepted route
  → flatten to a summary → store / return
```

Sealing runs **after** the anomaly check, on the points the server believes. A
rejected route produces `sealEvaluation: null`: a loop inside a route that did
not happen is not a loop, and the phone may well have shown one. No provenance
also means no seal — there is nothing to interpret without a rules version.

The verified route is never subset by verification (`verifyMovement` accepts or
rejects whole), so the accepted route *is* `observation.points`. No refactor was
needed to expose it, and nothing about it is persisted.

## Persistence and privacy

Migration `0005_seal_summary.sql` adds three **nullable** columns:

| Column | Meaning |
|---|---|
| `sealed` | evaluated and closed / evaluated and open / **NULL = never evaluated** |
| `seal_methods` | `text[]`, validated against the enum on read |
| `seal_event_count` | how many closures |

`NULL` and `false` are different statements. NULL means the engine never ran —
the row predates it, carried no provenance, or was rejected. `false` means the
route was evaluated and stayed open, which is an ordinary result.

**Not stored, anywhere:** route coordinates, intersection points, sealed
polygons, route indices, closure fractions, H3 trails, start or finish
locations. The geometry is transient by design — it exists for the life of one
request so territory work can consume it — and a durable record of *where* a
player's loops close would be a finer-grained trace than this table has ever
kept. Old rows are not backfilled: reinterpreting a historical verification
without its route would mean inventing the answer.

The API returns `sealed`, `sealMethods`, `sealCount` and nothing else. The phone
still holds its own route while showing the summary, so it never needs to be
told where.

## Preview versus authority

The phone previews sealing so the mechanic is understandable while moving. There
is **one implementation**: `evaluateSealing` feeds every point to
`createSealScanner`, and the live preview feeds the same scanner one point at a
time. A parity test asserts the batch path *is* the incremental path.

What differs is the evidence, and only the evidence — the phone feeds fixes its
own tracker accepted (`acceptPoint`: accuracy ≤ 40 m, ≥ 2 m step, ≤ 12 m/s), the
server feeds the fixes it verified. Given identical points they agree exactly.
That difference is why the preview is never final: a route the tracker liked can
still be refused.

The client submits no sealing field of any kind. `sealed`, `sealMethod`,
`sealEvents`, `intersection`, `sealPolygon`, `heldCells`, `capturedCells`,
`solidCells`, `shadeCells` and `finishOnOwned` are all refused by the strict
schema before a handler runs.

## Performance

Segments are indexed in an in-memory uniform grid (`GRID_CELL_M = 64`), so a new
segment is tested against the handful of segments near it rather than against
every earlier one. The index lives on the scanner, is never serialised, and is
dropped with the session — one session's geometry cannot reach the next.
`MAX_SCAN_SEGMENTS` (50 000) bounds a malformed or hostile route; no real
session approaches it. A 4 000-point spiral is exercised in the suite.

Geometry is evaluated **only when the route grows** — never on a clock tick, a
re-render, or a pause/resume.

## What this change does not do

No solid, no shade, no polygon-to-H3 filling, no ownership writes, no erosion or
takeover, no server-authoritative territory, no deeds, no toll or reward
economy, no session-eligibility change, no 10-minute / 750-metre rule, no
30-minute anti-splitting merge, no points settlement, no charge, no token logic,
no background tracking, no rival trail cutting, no pincer, no cycling territory.

The 200 m / 5 min save threshold is unchanged.

**One product behaviour did change, deliberately.** Saving a qualifying session
used to claim the first untouched cell the route passed through, with no closure
of any kind — the precise thing this mechanic says does not happen. Local
preview capture is now gated on the route having sealed. An unsealed route banks
its XP, its history, its route-trust record and its server verification exactly
as before, and claims nothing. No existing held preview state is erased, and
nothing is migrated into server authority.

## Open decisions

Each is implemented one way, deterministically, and each is a candidate for
change once there is device data.

| # | Decision | Chosen now | Status | Validated by | Revisited in |
|---|---|---|---|---|---|
| 1 | Return radius | 150 m, inclusive | **HYPOTHESIS** — the design says so | real finish-position spread | a future rules version |
| 2 | Endpoint touch | does not seal | **HYPOTHESIS** | how often players end *on* their trail | #94/#95 |
| 3 | Collinear retrace | does not seal | **HYPOTHESIS** | out-and-back frequency | #94/#95 |
| 4 | Open-trail anchor | advances past the closing segment | implementation | multi-loop sessions | #94 |
| 5 | Two cuts on one step | nearest closes, rest consumed | implementation | rare in practice | #94 |
| 6 | `continuityBreakMeters` | 200 m | **HYPOTHESIS** | real sampling gaps on device | a future rules version |
| 7 | Held-ground closure | `undetermined` | **OPEN** — the design does not say what it encloses | product decision | #94/#95 |
| 8 | Return-to-start after a gap | still seals; `subpathCount` reported | implementation | whether #95 can use it | #95 |
| 9 | Preview quality filter | tracker's `acceptPoint`, not server rules | implementation | preview/authority disagreement rate | — |
| 10 | Multiple closures | all kept, none collapsed | implementation | whether #94 claims each independently | #94 |
| 11 | Tracking gaps on the wire | not sent; derived from the jump | implementation | preview/authority disagreement rate | #96 |

## What #94 Solid receives

- ordered `SealEvent[]` with the exact route slice per closure;
- an exact closure edge for `self_cross` and `return_to_start`;
- `subpathCount`, so a closure across an interrupted route can be judged;
- the session's rules version and mode;
- deterministic ordering and stable event identity;
- **no** `isSealed` placeholder in territory state, because absence is better
  than premature semantics.
