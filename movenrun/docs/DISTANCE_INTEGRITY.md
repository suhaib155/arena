# Foreground distance integrity

## Measurement policy

`ON_FOOT_MEASUREMENT_POLICY_VERSION = 1` identifies the server's measurement-quality policy. It is separate from immutable session/gameplay rules. Existing saved verification records retain their prior result on idempotent retry; new V3 evaluations apply this quality policy. Older V3 recordings containing dense uncertain segments can be rejected as needing review. Legacy submissions without session metadata retain their legacy quality handling; no on-foot provenance is invented.

A foreground fix must contain finite coordinates, a positive increasing timestamp and known horizontal accuracy between 0 and 40 m. Live delivery must be no more than 10 seconds old and cannot be future dated. The 10-second allowance accommodates roughly two requested 4-second intervals; it does not promise that the OS delivers within that time. Duplicate received timestamps cannot extend evidence even if the previous duplicate was rejected.

A connected accepted segment must exceed both 2 m and the sum of its endpoint accuracy radii. Overlapping uncertainty circles are insufficient displacement evidence. Rejected noise does not advance the accepted anchor, so slow walking can build enough displacement. This is deliberately conservative: it can omit short movement and corners inside uncertainty, and reported accuracy can itself be wrong. It is not exact distance or spoof-proof human proof.

Geometry-implied speed above 12 m/s (43.2 km/h) is outside this on-foot policy. This retains fast running while refusing the reproduced 15 m/s (54 km/h) route. Optional valid native speed is an additional local quality signal and diagnostic; it is not sent as distance authority. The server independently checks geometry, timestamps and accuracy. A failing V3 segment rejects the route with a compact quality-review outcome instead of silently changing its topology before sealing. No client distance or trust outcome is accepted.

## Acquisition and lifecycle

`GpsTracker.start` checks foreground permission and services, then acquires three coherent fixes with accuracy at most 20 m, spanning at least 8 seconds, within a 30-second timeout. The 20 m bound is twice the requested approximate High accuracy; 8 seconds spans two requested native intervals and guards a single transient fix. These are initial engineering bounds awaiting fixtures and device validation, not measured guarantees.

Acquisition uses the same High accuracy and a zero displacement interval so a stationary user can obtain fixes. After acquisition the watch switches to the existing 5 m displacement interval. Expo's Android `timeInterval` is a minimum update interval, not a maximum wait or battery guarantee. No background permission, task, subscription or navigation-grade accuracy is introduced.

Acquisition samples are discarded. Start resolves only after the normal foreground subscription exists; the existing `trackerStarted` boundary then mints identity and starts active time. `TrackerStartError` distinguishes permission denial, services off, timeout, tracker error and cancellation. `settingsRelevant` is true only for permission/services errors. Cancellation removes late-arriving subscriptions; runtime errors have an optional callback. Failed-start recovery presentation belongs to the adjacent movement-state task.

## Canonical evidence and observed time

The live counter, finished session, summary and proof use Task 2 canonical evidence. GPS rejection happens before canonical buffering and live scanning. Explicit pause/background breaks reset the displacement anchor; no missing straight-line distance is inferred. The server uses the same shared haversine/evidence-distance function and break semantics. Canonical incremental sums can differ from a fresh sum by floating-point roundoff; server integer rounding contributes at most 0.5 m. The validation target is below 0.000001 m before rounding and 0.500001 m after rounding for identical represented evidence.

When evidence capacity is exhausted, the existing capacity-limited session is not submitted as complete. Its continuing local distance is not claimed to have server parity. The cap, bounded compaction, session control and capacity behavior are unchanged.

Submission observation bounds now come from the first and last actual fixes. Backend duration is the sum of connected observed intervals, excluding pause/background break intervals. Padding declared start/end/lifecycle time cannot increase it. Sparse fixes cannot establish continuous movement; stationary time can legitimately be unobserved with the native displacement interval.

## Internal diagnostics

The development-only in-memory recorder keeps at most 128 entries with timestamp, reported accuracy, optional native speed, segment displacement, decision/rejection reason, local total and canonical retained count. It also tracks total received/accepted fixes and the matching session's backend total. It stores no coordinates, has no normal UI or analytics output, performs no persistence and emits no logs. Production calls are inert. This is an engineering inspection facility, not a route archive.

## Validation status

Implementation-first pass: suites and mutations are deferred by request. The initial deterministic fixture file was authored before that instruction and has not been executed. Planned acceptance is zero meaningful stationary movement for 5–30 m reported-uncertainty clouds; slow/brisk walking and running within 5% plus a 12 m endpoint allowance at 5 m accuracy. Acquisition noise, improving/weak accuracy, 50 m outliers, duplicate/stale fixes, breaks, vehicle speed, router parity and cancellation still require execution and expanded fixture coverage in the verification pass. No physical-device GPS result or measured battery/performance claim is made.
