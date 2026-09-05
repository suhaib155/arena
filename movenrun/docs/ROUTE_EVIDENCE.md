# Canonical route evidence

The live scanner, final summary and HTTP submission share one committed route.
The map's 2,048-point drawing buffer is a separate approximation and never feeds
measurement or sealing. Canonical evidence retains at most 10,000 observations,
the existing HTTP and retry ceiling; the API limit has not increased.

## Retention and compaction

The active in-memory store appends to 256-point chunks. The newest 256 original
observations stay untouched. Each older original chunk is considered once, at
most one chunk per 256 accepted observations (or when the canonical ceiling is
reached). No raw archive survives a successful compaction.

A pinned Douglas-Peucker candidate has maximum cross-track deviation 0.1 m.
The first/end samples of each chunk, both sides of a pause/gap or H3 transition,
and every coordinate in an announced loop including its crossed/closing edges
remain. Replacement edges cannot introduce the sealing engine's 200 m continuity
break. Total removed geodesic length cannot exceed 0.01% of accepted route length.

Before committing a candidate, the production scanner replays it. Ordered
self-cross witnesses (timestamp endpoints and exact intersection fractions),
the collapsed H3 traversal sequence, subpath count and unavailable-method state
must equal the committed route. Any mismatch rejects the entire candidate.
The arriving fix is scanned and its closures pinned before periodic compaction.
At the hard cap, both candidate checks include the arriving fix. Indices may
change; the witnessed events may not. The scanner's consumed spatial
index buckets are released when its open-trail anchor advances, without deleting
events or changing segment identities.

These guarantees concern committed canonical evidence. A future intersection
may cross an old line simplified before that intersection existed. Its raw
sample indices are not recoverable; canonical replay is exact, while the tested
figure-eight crossing location differs by less than 0.1 m. No finite coordinate
budget can preserve every possible future raw-sample endpoint classification.
Previously announced crossings are pinned and cannot be moved or withdrawn.

## Why 0.1 m

Deterministic comparators tested 0, 0.1, 0.25, 0.5, 1 and 2 m. The smallest tested
useful nonzero tolerance was 0.1 m, below the fixtures' 5–30 m GPS uncertainty.
An unguarded 0.08 m change erased a shallow crossing, erased an H3 boundary
excursion, and exact-collinear deletion converted excluded endpoint contacts
into crossings. Tolerance alone is therefore insufficient. Increasing to 0.5 m
lost 0.800067% of the jitter comparator's length; 0.1 m lost 0.00512%.
The useful 0.1 m comparator's largest measured loss was 0.006808% (figure eight),
so the independent cumulative-loss ceiling rounds that up to 0.01%. A repeated
sub-decimetre oscillation test exceeds this budget despite passing geometric
tolerance and is rejected. This is a relative error budget, not a one-metre
workout limit.

Those comparator figures evaluate alternative simplifiers, not the production
chunk policy. The actual chunk store retained 515/10,000 straight points,
565/10,000 urban points, 8,644/10,000 jitter points and 8,262/10,000 dense-loop
points in the measured fixtures. The 49 dense-loop closures remained intact.

## Pauses, foreground gaps and distance

The live caller supplies a getter for the lifecycle's current immutable pause
array. Resume replaces that array; the scanner reads the replacement rather
than retaining the empty Start-time array.

`breakBefore: true` is an optional strictly typed observation field recording
missing foreground continuity before a fix. It survives mobile serialization,
HTTP parsing and temporary retry storage. Pauses retain their separate lifecycle
meaning. A pause or gap contributes neither a joining distance segment nor a
joining sealing segment. Plausibility does not infer speed across a segment
that was not observed. Structural timestamp/coordinate checks still apply.

The server independently sums continuous observation stretches; it never accepts
a client distance, seal or ownership field. Normal local canonical distance and
server distance agree within the server's nearest-metre rounding (0.5 m). The
0.01% simplification budget is loss against accepted GPS evidence, not a claim
about actual travelled distance. GPS uncertainty and stationary drift need the
separate measurement-quality policy and physical-device gate.

## Capacity is not a workout limit

When no safe old chunk frees space at 10,000 retained points, capture, active
time and scalar workout distance continue. The represented prefix and its
existing loop previews freeze. New seal claims and near-start claims stop.
There is no automatic Pause, forced Finish, modal or capacity warning during
movement.

At Summary the app explains that the map contains only the recorded section.
The workout can follow the existing local save/progress rules, but this session
cannot capture or strengthen territory and does not upload a partial route as
a complete verification. Earlier represented loop previews remain visible;
they grant no new territory. Incomplete evidence remains `local`, never
`verified`, and cannot enter the retry queue.

## Privacy and lifetime

Canonical coordinates exist only for the active session and in-memory summary.
After an explicit Save, complete evidence may use the existing bounded,
account-scoped temporary retry queue; there is no full-route history archive.
Three pending routes and the existing seven-day/attempt bounds remain unchanged.
The 2,048-point display buffer, 10,000-point canonical store, one current sample,
and bounded scanner/candidate references bound retained memory. A compaction
temporarily holds original and candidate references, never an unbounded stream.
`clear()` removes geometry, events and scalar state and permanently rejects late
callbacks. The auth-generation barrier integrates this disposal separately.

## Measured runtime and outstanding gate

Final isolated Node 22.13.0 / Windows x64 runs generated observations one at a
time and measured retained heap before snapshot/serialization. No full input
array was retained. Heap includes canonical point objects, scanner/index state
and first-use runtime caches; it is not mobile peak memory.

| Stream | Retained points | Retained heap bytes | Maximum push ms | Full HTTP body bytes |
|---|---:|---:|---:|---:|
| Straight 5,000 | 504 | 808,760 | 6.000 | 46,111 |
| Straight 10,000 | 515 | 886,752 | 5.236 | 47,105 |
| Urban 10,000 | 565 | 832,080 | 6.194 | 51,658 |
| Jitter 10,000 | 8,644 | 3,738,000 | 33.459 | 787,320 |
| Dense loops 10,000 | 8,262 | 3,338,112 | 70.126 | 751,686 |
| Irreducible 10,500 | 10,000 | 4,352,456 | 6.124 | 908,643 |
| Pause/gap 5,000 | 506 | 813,160 | 11.263 | 46,364 |

Bodies were captured through the real mobile submission/transport serializer with
an injected local response, including accuracy, lifecycle metadata and break
markers. No network request was made. The capacity-limited prefix was serialized
only for measurement; the normal submission barrier rejects it. Adding the actual
display buffer brought measured retained heap to 0.99–4.40 MB. Counts and body
bytes were identical with or without the display buffer.

At a conditional four-second accepted-fix cadence, 10,000 observations span
11 h 6 min 36 s. Smooth routes compact substantially, but an irreducible endurance
route can reach the cap within the current 24-hour contract. These synthetic
measurements cannot establish that exhaustion is practically unreachable for all
normal on-foot sessions. No API limit increase is included. Real-route capacity
assessment and any resulting API-capacity decision remain open.

Physical Android must validate long-session responsiveness, GPS measurements and
Pause/Finish reachability. No battery measurement or mobile frame-rate result is
claimed here.
