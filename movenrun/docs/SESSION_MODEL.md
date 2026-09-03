# The session model

What a MovenRun movement session *is*: one identity, one explicit lifecycle,
one movement mode, one rules version, and validated pauses — surviving save,
submission, retry and reconciliation without a second authority or a second
route store.

## Four layers, never collapsed

| Layer | Question | Where it lives |
|---|---|---|
| Capture lifecycle | what is the phone doing? | `mobile/src/lib/sessionLifecycle.ts` |
| Finished evidence | what happened, immutably? | `SessionMetadata` in `@movenrun/shared/session` + observations |
| Verification | what did the server say? | `VerificationState`, `movement_verifications` |
| Gameplay | eligibility, sealing, points | **does not exist yet** |

Collapsing any two is how a model stops being able to describe reality. A
session can be paused *and* unverified *and* ineligible; those are three facts,
not three values of one enum.

## The capture lifecycle

```txt
  idle ──requestStart──▶ starting ──trackerStarted──▶ active ⇄ paused
    ▲                        │                           │       │
    └──────trackerFailed─────┘                           └─finish┴──▶ finished
```

There is no `finishing` state to match `starting`: Finish is synchronous —
it closes any open pause, stamps `finishedAt` and produces the evidence in one
step. A state nothing can enter would still have to be handled everywhere it
appeared, and a reader would reasonably assume it was reachable.

`starting` exists because starting a tracker is asynchronous and can fail.
Before this PR the session id was minted during render and the tracker was
started in an effect that swallowed its own failure — so a permission revoked
between screens left a session that looked live, ran a clock, and recorded
nothing. Nothing is stamped until the tracker confirms; a failed start returns
to `idle` with no id burned.

Every transition returns an outcome (`ok` / `ignored` / `invalid`) rather than
throwing, so a double tap is a value the caller ignores. That is what makes
Start, Pause, Resume and Finish single-flight **in the domain** rather than in a
disabled button, which does not survive a replayed effect or a remount.

## Identity

`clientSessionId` is minted **once**, at the start transition, from
`newClientSessionId()`. It is never regenerated — not on render, pause, resume,
finish, save, navigation, or verification retry. The backend's idempotency is
keyed on `(authenticated user, clientSessionId)`, so a fresh id per attempt
would turn every retry into a second verification.

It is not derived from coordinates, not derived from the user, never displayed,
and never logged.

## Movement mode

**There is exactly one mode: `onFoot`.** The app has no walk/run classifier and
no cadence sensor, and inferring the difference from pace on the client would be
a guess presented as provenance.

**Cycling is absent, not present-and-disabled.** Game Economy V3 gives cycling
its own territory treatment — a different map, not a different label — and none
of it exists. A `cycling` value today would be one the server must reject, the
UI must hide, and a future reader would reasonably assume was supported. It
arrives with the rules version that defines what it means.

Mode is stamped at Start and is immutable through finish, save, submission and
every retry. It is **provenance, not trust**: a session labelled `onFoot` faces
exactly the same plausibility checks as one carrying no label, and a test
asserts the verification path never reads it.

## Rules version

`SESSION_RULES_VERSION = 1`, in `shared/src/domain/session.ts`. That module is
the only authority.

It is **not** the app version, the API version, the storage schema version, the
migration number, the H3 resolution or the build number. It answers one
question: under which gameplay interpretation was this session captured?

Not configurable — no environment variable, no remote config, no UI selector, no
fallback to the package version. A client that could choose its own rules
version would be choosing how its own movement is scored. The server validates
against `SUPPORTED_RULES_VERSIONS` and fails closed on anything else, so a
`rulesVersion: 999` is refused rather than treated as current.

**A legacy session is represented by absence**, not by a number. There is no
truthful value for a session captured before versions existed.

### When the next version is created

When a change alters how an *already-captured* session would be interpreted —
new eligibility thresholds, sealing semantics, a new mode. Adding a field that
does not change interpretation does not need one.

## Schema version vs rules version

Two different things, deliberately not one field:

- `PENDING_SCHEMA_VERSION` (mobile retry queue) — the **storage shape**.
  Migration code reasons about this.
- `SESSION_RULES_VERSION` — the **gameplay interpretation**. Gameplay code
  reasons about this.

The retry queue's schema version deliberately did **not** move for this change.
Bumping it would make every queued item fail closed and be dropped — throwing
away a user's unsent verification to avoid a nullable field.

## Pauses are not tracking gaps

| | Pause | Tracking gap |
|---|---|---|
| Cause | the user pressed Pause | the app was backgrounded, fixes stopped |
| Means | "I chose to stop" | "we lost your data" |
| Effect on distance | none expected | the distance is a floor |

Merging them would turn a data-loss warning into a user choice, in the direction
that flatters the app. They are recorded separately and a test asserts both
survive a session that has one of each.

A gap **is** still recorded while paused: pausing does not make the app's
inability to observe untrue.

## Durations, named

| Name | Meaning |
|---|---|
| `elapsedMs` | `finishedAt − startedAt`, pauses included |
| `pausedMs` | sum of validated pause intervals |
| `activeMs` | elapsed minus paused — what the screen's clock shows |
| server duration | measured from accepted observations, under verification rules |

The last is **not** the same number and is not meant to be. The server drops
points the tracker kept and knows nothing about a pause. Neither is wrong; they
answer different questions, so they have different names. The client's duration
is never sent as a claim.

## Two clocks: lifecycle vs observations

`startedAt`/`finishedAt` say when the **user** started and finished.
`startTime`/`endTime` bound the **observations**, derived from the observed
timestamps because the server validates that every point falls inside them.

They are not the same and must not be collapsed: a fix can arrive before the UI
finished transitioning, and the last fix normally precedes the Finish tap. The
server checks the pair for coherence — observations may not begin before the
session started or continue after it finished — which is a check neither clock
could perform alone.

## The API

```jsonc
POST /movement/verify
{
  "sessionId": "mv-…",
  "startTime": 0, "endTime": 0, "points": [ … ],
  "session": {                       // optional — see compatibility below
    "mode": "onFoot",
    "rulesVersion": 1,
    "startedAt": 0, "finishedAt": 0,
    "pauses": [{ "startedAt": 0, "endedAt": 0 }]
  }
}
```

`.strict()` throughout, including the nested `session` object. There is no
field for distance, duration, traversed cells, capture, ownership, seal, XP,
points or trust score, and a body offering one is refused before a handler runs.

### Compatibility matrix

| Client | Backend | Result |
|---|---|---|
| new (sends `session`) | new | provenance stored |
| old (no `session`) | new | accepted, stored as legacy (NULL) |
| new (sends `session`) | old | **rejected** — old `.strict()` refuses the unknown key |
| old | old | unchanged |

The third row is why **the backend deploys first**. There is no production
backend deployment today and the app ships through EAS, so this is a sequencing
note rather than a live migration — but it is a real constraint the moment both
are deployed.

`session` is optional for one reason only: a retry queued by a build that
predates this model has no metadata and nothing truthful to invent. **Removal
milestone:** once the retry retention window (`MAX_PENDING_AGE_MS`, 7 days) has
elapsed after the first release carrying this model, no legacy-shaped
submission can still exist, and the field can become required.

## Persistence

Migration `0004_session_provenance.sql` adds five **nullable** columns to
`movement_verifications`: `movement_mode`, `rules_version`, `started_at`,
`finished_at`, `paused_ms`.

Nullable is the design, not a convenience. NULL means "captured before the
session model existed". A `NOT NULL … DEFAULT` would have been easier and would
have asserted that historical sessions followed rules that had not been written
when they ran.

`paused_ms` is a **total**, deliberately not the intervals: the durations are
what later interpretation needs, and the individual timestamps would be a
finer-grained record of when someone stood still. No coordinates are added, and
the existing `(user_id, client_session_id)` unique constraint is untouched.

## Idempotency with immutable metadata

Once a session id has provenance stored, a later submission under that id
**cannot change it**. A genuine disagreement is a `409 session_metadata_conflict`
— not an overwrite, which would let a client restate history, and not a silent
return of the stored row, which would report an acceptance that did not happen.

Two cases are absence rather than contradiction and do **not** conflict:

- a legacy submission replaying against a row that has provenance;
- a submission with provenance against a legacy row.

In both, the stored row stands unchanged.

## Retry

The queued item carries the metadata the session was stamped with, and replays
it exactly. It is never rebuilt at retry time from the current default mode or
the current rules version — an app update between a failed submission and its
retry must not reinterpret a session that already happened.

A pre-#92 queued item stays valid, keeps submitting in the legacy shape, and is
recorded as legacy. Corrupt metadata rejects the whole item rather than being
half-accepted: half-readable provenance is worse than none, because it would be
submitted as though it were what the session recorded.

## What this model does not do

No eligibility (10 min / 750 m), no 30-minute anti-splitting window, no scoring
session limits, no sealing, no solid/shade, no points settlement, no charge, no
territory authority, no background tracking. The current save threshold —
200 m **or** 5 minutes — is **unchanged**, and is baseline product behaviour
rather than the final V3 rule.

Sealing (#93) receives from this model exactly what it needs: explicit
`startedAt`/`finishedAt`, deterministic observation order, stable route
evidence, mode and rules version — with no `isSealed` placeholder, because
absence is better than premature semantics.
