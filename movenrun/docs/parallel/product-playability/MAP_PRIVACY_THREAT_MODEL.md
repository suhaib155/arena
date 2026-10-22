# Map privacy threat model

Scope: movement data in v1 as built at `15f7f87`, plus the PROPOSED territory
overlay and public boards in [MAP_GEOGRAPHY_PRODUCT_SPEC.md](MAP_GEOGRAPHY_PRODUCT_SPEC.md).
Evidence is LOCAL code reading and tests. Nothing was tested against a hosted service.

## What is sensitive

A walking route that starts and ends at the same place most mornings reveals
where someone lives. Repeated routes reveal routine: school runs, a workplace, a
gym, a time of day. Co-walks reveal who someone walks with.

## Data that exists in v1

| Data | Where | Who can read it |
|---|---|---|
| Live fixes during a session | Phone memory only | The app |
| A finished guest session | Local store: distance, duration, XP, local preview zones. No raw route in history | The device |
| A finished signed-in session | Sent to `POST /movement/verify` with its points. The server measures them in memory | The server while it handles the request |
| Server record (`movement_verifications`) | Distance, duration, start and end time, traversed res-8 cell ids, seal verdict, status. No coordinates and no route index (`backend/src/db/movement.schema.ts`) | The user, through `/movement/verifications`, and operators |
| Retry queue | Up to 3 pending sessions with points, owner-scoped, on the device | The app, for that account only |
| Route proof share | A summary image or text the user chooses to share | Whoever the user shares it with |

## Threats and controls

| # | Threat | Today | Control (built or PROPOSED) |
|---|---|---|---|
| T1 | A public board reveals a home through a lone player's cells | No public board exists in v1 | PROPOSED: res-6 areas only, at least 3 distinct players, no cell ids (GEO-10) |
| T2 | A shared route image shows a start point at a front door | Route proof shares a summary | PROPOSED: trim the first and last 200 m of any drawn route in shares, or share stats only. Needs a device check of the current image |
| T3 | Another account on the same phone submits a previous user's routes | Queue is owner-scoped; mobile `verificationRetry.test.ts` ("the ownership check is decided before age, budget and backoff") | Built |
| T4 | Sign-out mid-upload leaves a route behind | Privacy generation erases it; tested | Built |
| T5 | Logs leak coordinates or tokens | No redaction tool existed | `tools/redactLog.ts` removes coordinates, tokens, emails, ids, cells, wallets and IPs; tested. Use it for every QA0 log |
| T6 | Cell ids act as coarse location | Server keeps res-8 cells (about 0.7 km²) per session | Keep cell ids out of any public or shared surface. Retention: delete with the account (built), and define a retention period for unused records (owner decision) |
| T7 | A fixture or test leaks a real place | All fixtures sit in the open Atlantic; a test enforces it | Built |
| T8 | Overlay fills a claim the server has not agreed to | No overlay in v1 | PROPOSED: unconfirmed is outline only (GEO-07) |
| T9 | Co-walkers can be linked by identical routes | Server sees both routes | No public route surface exists. Keep it that way; do not add "who walked here" features |
| T10 | Background tracking | Manifest blocks background location and foreground services | Built |

## Rules for QA0 evidence

1. No raw route, screenshot of a route near a home, or unredacted log leaves the tester's phone.
2. Every log goes through `tools/redactLog.ts` before it is attached anywhere.
3. Device walks for QA0 start and end at least 200 m from any home, or in a public park.
4. Screenshots of the map are cropped to the stats panel unless the route is in a public space.

## Residual risks

- The server stores res-8 cell ids and start and end times per session, which together are a coarse location history. No retention period for these rows is defined in the code this track read.
- Request logs on the hosting provider could capture request bodies if body logging were ever turned on. This track did not inspect hosted log settings.
- A determined observer who walks with a player can still learn that player's routes. No software control fixes that.
