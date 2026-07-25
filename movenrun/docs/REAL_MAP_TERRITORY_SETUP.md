# Real Map & Territory Capture — Setup

How the real-world map and closed-loop territory capture fit together, and what
you need to run them.

> **Three things to know before anything else**
>
> 1. **Expo Go is not supported** for the map or background location. MapLibre
>    is a native module; a **native development build** is required.
> 2. **Production map tiles need a provider.** The bundled fallback is
>    MapLibre's demo style, which has no street detail. **Public OpenStreetMap
>    tile servers must not be used as a production tile backend** — their usage
>    policy forbids it.
> 3. **Territory ownership is server authoritative.** The app records and
>    previews. The backend recomputes distance, closure, area, traversed cells,
>    captured cells and ownership from the raw evidence, and its answer is the
>    only one that counts. There is no request by which a client can assert
>    `captured: true`.

---

## Architecture

```
 mobile                          backend                         database
 ──────                          ───────                         ────────
 expo-location ─┐
 TaskManager   ─┴─► activeRunService ──POST /gps/submit──► routes (BullMQ)
                     │  bounded chunks                      │
                     │  AsyncStorage                        ▼
                     │                              gps.worker.ts
                     │                                 │
                     │                  validate → dedup → sign  (unchanged)
                     │                                 │
                     │                     evaluateLoopCapture   (territory/capture.ts)
                     │                                 │
                     │                     TerritoryOwnershipService
                     │                                 │  one locked transaction
                     │                                 ▼
                     │                          territories
                     │                          territory_ownership_events
                     │                          territory_capture_sessions
                     │                          territory_control_changes
                     │                                 │
 MovenRunMap ◄──GET /v1/territories/map ◄──────────────┘
 (MapLibre)  ◄──SSE /v1/territories/stream
```

**Two H3 grids, deliberately.**

| | Grid version | Resolution | Cell area | Used for |
|---|---|---|---|---|
| Legacy | 1 | 8 | ~0.74 km² | Oracle route proof, deployed contracts. **Frozen.** |
| Territory | 2 | 9 | ~0.10 km² | Territory ownership. |

Nothing in this work changes how a legacy route hashes, which hex it reports, or
what the oracle signs. Every stored territory carries its own `h3Resolution` and
`gridVersion`; resolution is never re-inferred from configuration after storage,
so changing `TERRITORY_H3_RESOLUTION` later cannot retroactively reinterpret
existing rows. `assertSameGridVersion` makes accidental cross-grid mixing a loud
failure rather than a subtle ownership bug.

---

## Map provider setup

You need a vector tile provider that serves a **MapLibre style JSON** URL.
Options that work without changes: MapTiler, Stadia Maps, Protomaps (self-hosted
or hosted), or your own tileserver-gl.

1. Create an account and get a style URL with your key, e.g.
   `https://api.maptiler.com/maps/streets-v2/style.json?key=YOUR_KEY`.
2. Set it as `EXPO_PUBLIC_MAP_STYLE_URL` in your build environment (see below).
   **Never commit it.**
3. Verify: the map screen shows a "Development map style" banner whenever the
   fallback is in use. No banner means your provider is live.

`productionConfigProblems()` (`mobile/src/lib/mapConfigCore.ts`) returns the
reasons a build is not releasable — an unset style URL is one of them.

### Why not public OSM tiles

`tile.openstreetmap.org` is a volunteer-funded service for browsing on
openstreetmap.org, not an app backend. Using it as one violates the tile usage
policy and gets the app's traffic blocked. A test asserts no public OSM tile host
appears in the map configuration source.

---

## Environment variables

### Mobile

Set in an EAS build profile (`eas.json` → `build.<profile>.env`), or a local
`.env` file that is **not** committed.

| Variable | Required | Purpose |
|---|---|---|
| `EXPO_PUBLIC_MAP_STYLE_URL` | production | MapLibre vector style URL. Falls back to the demo style in development. |
| `EXPO_PUBLIC_API_BASE_URL` | yes | MovenRun backend base URL. Without it, no territory loads. |
| `EXPO_PUBLIC_REALTIME_URL` | no | SSE endpoint. Defaults to `${API_BASE_URL}/v1/territories/stream`. |

These can also be supplied as `expo.extra.mapStyleUrl` / `apiBaseUrl` /
`realtimeUrl` in `app.json` for per-channel configuration. The environment
variable wins.

### Backend

Every `TERRITORY_*` value is documented with its defaults in
`backend/.env.example`. All of them are **validated at startup**: an
unparseable or out-of-range value fails the boot with every problem listed at
once. It never silently falls back to a default, because the failure mode of a
mistyped threshold is either handing out territory for a walk to the corner shop
or refusing every valid run, with no signal that anything is wrong.

Startup validation runs in **both** `src/index.ts` (the API) and
`src/workers/gps.worker.ts` (the worker), so a misconfigured deployment cannot
half-start.

---

## Native build

MapLibre and background location both need native code. `expo start` against
Expo Go will run the app, but the map renders a "Real map needs a native build"
panel instead of crashing.

```bash
cd movenrun/mobile

# One-off: link the EAS project if it isn't already (writes extra.eas.projectId)
eas init

# Development build — install this on the device, then `expo start --dev-client`
eas build --profile development --platform android
eas build --profile development --platform ios
```

`npx expo prebuild` also works if you are managing native projects locally. Do
not run `npx expo run:android` against a project that hasn't prebuilt — the
MapLibre config plugin needs to have run.

### Android permissions

Applied by the `expo-location` config plugin from `app.json`:

- `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` — foreground fixes.
- `ACCESS_BACKGROUND_LOCATION` — recording while the app is backgrounded.
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` — the visible recording
  notification, which Android requires for background location and which is the
  right thing to show regardless.

Android 10+ requires background location to be granted **separately**, from
system settings, after foreground has been granted. Android 11+ removes it from
the in-app prompt entirely. The app requests foreground first, then background,
and a denial of background **downgrades the run to foreground-only** rather than
blocking it.

### iOS permissions

- `NSLocationWhenInUseUsageDescription` — foreground.
- `NSLocationAlwaysAndWhenInUseUsageDescription` / `NSLocationAlwaysUsageDescription`
  — background.
- `UIBackgroundModes: ["location"]` — set in `app.json` and by the plugin.

The location task sets `activityType: Fitness` and
`showsBackgroundLocationIndicator: true`, which keeps updates flowing with the
screen locked and shows the blue status bar indicator honestly.

### Background tracking limitations

These are platform behaviours, not bugs, and the app is built to survive them:

- **iOS may suspend or terminate** the app under memory pressure. Recording
  resumes when the OS relaunches it to deliver a location batch, which is why
  `TaskManager.defineTask` runs at module scope — a definition inside a
  component would not exist yet in the fresh runtime, and the batch would be
  dropped silently.
- **Android battery optimisation** (Doze, OEM task killers) can throttle or stop
  updates. The foreground service notification is the strongest available
  mitigation.
- **Gaps happen.** A gap over 5 minutes raises a soft anti-cheat signal, never a
  rejection on its own.
- **Interrupted sessions are recoverable.** Session metadata and persisted
  chunks are reloaded by `restoreInterruptedSession()`.

---

## Local development

```bash
cd movenrun
corepack enable
yarn install

# Postgres + Redis
docker compose up -d postgres redis     # or your own instances

cd backend
cp .env.example .env                    # then fill in real values
yarn db:migrate                         # applies drizzle/0000..0003
yarn dev                                # API on :3000
yarn worker:gps                         # in a second shell — territory is
                                        # awarded by the worker, not the API

cd ../mobile
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000 yarn start
```

**The GPS worker is not optional.** `POST /gps/submit` only queues a job; all
validation, signing and territory capture happen in `worker:gps`. Without it
routes stay `SUBMITTED` for ever and no territory is ever awarded. Redis must be
reachable by both processes.

### Database migrations

Migrations `0001`–`0003` are **hand-authored**. `drizzle-kit generate` is
blocked by a pre-existing BigInt-default serialization bug in the route schema
(`hexActivities.totalDistanceMeters.default(0n)`), which is documented in
`docs/CONTRACTS_AUDIT.md` and predates this work.

`0003_territory_ownership.sql` was validated by applying `0000`–`0003` in order
to an ephemeral PostgreSQL 16 and then exercising each constraint with
deliberately bad inserts.

---

## Map API

All paths are relative to `EXPO_PUBLIC_API_BASE_URL`.

### `GET /v1/territories/map`

```
GET /v1/territories/map?west=-0.11&south=51.49&east=-0.09&north=51.51&zoom=15
```

| Parameter | Required | Notes |
|---|---|---|
| `west` `south` `east` `north` | yes | Degrees. `west < east`, `south < north`. |
| `zoom` | no | 0–24. |
| `gridVersion` | no | Defaults to the configured territory grid. |

Rejected with `400`: missing or non-numeric bounds, out-of-range coordinates,
inverted ordering, a degenerate zero-area box, a viewport above
`TERRITORY_MAX_MAP_VIEWPORT_AREA`, or an unknown grid version.

Returns a GeoJSON `FeatureCollection`. Each feature's `properties`:

```json
{
  "cellId": "892a1008943ffff",
  "state": "owned",
  "relationship": "rival",
  "controlScore": 34,
  "defenceScore": 61,
  "gridVersion": 2,
  "resolution": 9,
  "capturedAt": "2026-05-01T10:00:00.000Z",
  "owner": { "displayAddress": "0x1111…1111", "clubId": null }
}
```

`meta` reports `count`, `total`, `truncated` and `generatedAt`. When `truncated`
is true the response hit `TERRITORY_MAX_MAP_FEATURES` and the map is partial —
this is reported rather than silently presented as complete.

### `GET /v1/territories/:cellId`

State, truncated owner, control/defence, capture and defence timestamps,
neighbour summaries, recent public events, plain-language capture requirements,
whether the caller may capture/reinforce/attack, and the cell polygon.

### `GET /v1/territories/:cellId/history?limit=25`

Public ownership history, newest first. Route ids and evidence hashes are
stripped — those are private references into a runner's own route record.

### `GET /v1/territories/stream?gridVersion=2`

Server-Sent Events. Named events: `territoryCaptured`, `territoryReinforced`,
`territoryAttacked`, `territoryContested`, `territoryTransferred`,
`territoryReleased`.

```
event: territoryCaptured
data: {"event":"territoryCaptured","cellId":"892a…","gridVersion":2,
       "previousState":"neutral","nextState":"owned",
       "previousOwner":null,"nextOwner":"0x1111…1111","version":1,
       "at":"2026-05-01T10:00:00.000Z"}
```

Every event carries `version` — the territory row's optimistic-concurrency
counter. Clients apply an event only when it is **strictly newer** than what
they hold, so duplicated and out-of-order deliveries cannot roll the map back.

**Runner coordinates are never broadcast.** A live feed of which cells changed
is a fact about the map; a live feed of where a person is would be a stalking
tool.

> **Single instance.** Subscribers are held in memory, so a second backend
> instance will not see this one's events. Fanning out needs a Redis pub/sub hop
> between `broadcast` and the subscriber loop — the interface is shaped so that
> is a swap of one method. Same caveat as the auth nonce cache in
> `middleware/auth.ts`.

### `GET /v1/routes/:routeId/capture-result`

**Private.** Requires wallet-signature auth (the `x-movenrun-*` headers) and
returns only the authenticated signer's own route; another wallet's route is a
`403`, and an unprocessed or unknown route is a `404` (the same answer, so the
endpoint cannot be used to probe which route ids exist).

Returns route status, loop state, closure distance, enclosed area, and the
captured / reinforced / attacked / rejected cell lists derived from the
immutable ownership events the route actually produced. `processedAt: null`
means the worker has not finished — the app shows "Verifying…".

---

## Territory states

| State | Meaning |
|---|---|
| `neutral` | Unclaimed. Any valid closed-loop capture can take it. |
| `owned` | Held, with defence above zero. |
| `contested` | Defence hit zero. Another qualifying action transfers it. |
| `protected` | Held and shielded from attack (events, sponsors, grace periods). |
| `restricted` | Not playable at all. |
| `dormant` | Owned but inactive long enough to fall out of active play. |

Event types: `captured`, `reinforced`, `attacked`, `contested`, `transferred`,
`expired`, `released`, `restricted`.

**Relationship** (`mine` / `club` / `rival` / `contested` / `neutral` /
`protected` / `restricted`) is computed **per request**, never stored — the same
cell is `mine` to one runner and `rival` to another.

### The rule that is not negotiable

**Ownership never flips on a single ordinary pass.** An attack drives defence
down; only a cell already at zero defence (`contested`) can transfer, and only
to an actor who performs another qualifying action on it. A test walks twenty
passes at a 50-defence cell and asserts no direct transfer ever occurs.

Crossing a cell counts for more than merely enclosing it, both when reinforcing
and when attacking. A transferred cell starts fresh rather than inheriting the
loser's score. Balancing numbers live in one constant
(`backend/src/territory/rules.ts`), not scattered through service code.

---

## Capture validation rules

A route must satisfy **all** of these. Defaults shown; every one is
configurable.

| Requirement | Default |
|---|---|
| Valid GPS points | ≥ 40 |
| Distance | ≥ 800 m |
| Duration | ≥ 5 min |
| Start↔end closure | ≤ 50 m |
| Enclosed area | 10 000 m² – 5 000 000 m² |
| GPS accuracy | ≤ 30 % of points worse than 30 m |
| Speed | ≤ 8 m/s between fixes |
| Single-hop jump | ≤ 250 m |
| Geometry | No self-intersection, non-degenerate |
| Timestamps | Forward-only |
| Route hash | Not a duplicate |

**Closing the loop is necessary, never sufficient.** A route that starts and
ends on the same doorstep but covers 12 m in 40 seconds satisfies closure and is
still rejected. Every failed requirement is reported, not just the first, and a
rejected route still reports its closure distance and enclosed area so the
runner can see how close they came.

### Which cells a loop claims

Enclosed cells **unioned with** the cells the route actually ran through.

`polygonToCells` is centre-based, and a resolution-9 cell is ~0.1 km² against a
0.01 km² minimum loop — so an enclosure-only rule would give a perfectly
legitimate small block loop nothing at all. Running the streets around a block is
exactly what this game is meant to reward. The two sets stay separately reported,
because the ownership rules weight them differently.

---

## Privacy

- Raw GPS is **never persisted** by the route pipeline. Only safe scalar
  lifecycle metadata is stored.
- **No column in any territory table** stores a coordinate, route point or
  polyline. Territory is identified by H3 cell id; evidence is referenced by
  route id and route hash only.
- Public responses carry **H3 cell boundaries** — deterministic from a cell id,
  identical for every viewer, revealing nothing about any individual.
- Owner identity is **truncated** (`0x1111…1111`). A full address is a
  persistent identifier linking a person's movements across every cell they
  hold.
- **Nothing logs a coordinate**, at any level. Crash reporters and device logs
  both persist. A test enforces this for the location modules.
- **Nothing precise goes on-chain.**
- Route upload requires authentication, enforces route ownership, and is rate
  limited; payload size and per-batch sample counts are capped.
- Local storage is bounded: one write per 200-sample chunk, uploaded chunks
  deleted, a hard 20 000-sample session ceiling, and an unsynced backlog that
  drops its oldest chunks rather than filling the device.

**Retention.** Territory rows and ownership events are retained indefinitely —
they are the game state, and the ownership log is an audit trail that must not
be rewritten. Capture sessions carry only counts, scalars and cell ids. Deleting
an account should clear `ownerUserId`/`ownerWalletAddress` and release held
cells rather than deleting history rows, which would corrupt other players'
capture records; that flow follows the existing account model and is not
implemented by this work.

---

## Anti-cheat

Signals are scored into a risk total that maps to one of four verdicts:
`accepted`, `acceptedWithWarnings`, `needsReview`, `rejected`.

**Hard** signals (physically impossible): impossible speed, impossible
acceleration, teleportation, timestamp reversal, invalid coordinates.

**Soft** signals (reachable by honest hardware): poor accuracy, repeated
identical points, unrealistic straight lines, vehicle-like movement, a reported
mocked location, excessive background gaps, failed device integrity.

Two rules hold:

1. **One ambiguous anomaly never rejects.** Every soft signal is weighted below
   the rejection threshold, and rejection additionally requires a hard signal. A
   test stacks every soft signal at once and asserts the verdict stays
   reviewable.
2. **The client's mocked-location flag is never sufficient.** A device that
   fakes its location can fake the flag too.

The pre-existing server-side route hash and per-wallet time-overlap dedup remain
the authoritative replay protection. This adds signals; it removes nothing.

---

## Troubleshooting

**The map shows "Real map needs a native build".**
You are in Expo Go, or the config plugin hasn't run. Build a development client.

**The map is blank / shows a "Development map style" banner.**
`EXPO_PUBLIC_MAP_STYLE_URL` is unset, so the MapLibre demo style is in use. It
has no street detail by design.

**"Map couldn't load".**
The style URL is unreachable or the key is wrong. Open the style URL in a
browser — it should return JSON.

**No territory ever appears.**
Check `EXPO_PUBLIC_API_BASE_URL`, then `curl` the map endpoint directly. If the
API answers but the array is empty, nothing has been captured in that viewport
yet.

**"Viewport too large".**
Zoom in, or raise `TERRITORY_MAX_MAP_VIEWPORT_AREA`.

**Routes stay `SUBMITTED` and no territory is awarded.**
`yarn worker:gps` isn't running, or Redis is unreachable from it.

**Territory is never awarded even though routes verify.**
Check the worker log line `Route <id> capture: eligible=false … reasons=…`. The
most common causes are a loop that didn't close within 50 m and an enclosed area
below 10 000 m².

**The backend won't start with a territory config error.**
That is the fail-closed guard working. Every problem is listed in the message.

**Background recording stops when the screen locks.**
Background permission wasn't granted (Android 10+ requires granting it from
system settings separately), or battery optimisation is throttling the app.

---

## Production checklist

- [ ] `EXPO_PUBLIC_MAP_STYLE_URL` points at a real provider with a valid key.
- [ ] `EXPO_PUBLIC_API_BASE_URL` points at the production API over HTTPS.
- [ ] `productionConfigProblems()` returns an empty array for the release build.
- [ ] Every `TERRITORY_*` value reviewed for your city's density — the defaults
      are conservative starting points, not tuned values.
- [ ] `CORS_ORIGINS` set explicitly (the backend fails closed without it).
- [ ] Migrations `0000`–`0003` applied.
- [ ] `worker:gps` running and monitored; Redis reachable from it.
- [ ] Rate limits reviewed for expected route-submission volume.
- [ ] A tile-provider quota alert configured.
- [ ] Native build tested on a real device with the screen locked.
- [ ] **Realtime fan-out**: still single-instance. Either run one API instance
      or add the Redis pub/sub hop before scaling out.
- [ ] Account-deletion flow decided for territory (release cells; do not delete
      history).
