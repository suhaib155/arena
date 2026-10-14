# MovenRun: product roadmap restart, G1 map regions, W1 website review

**Date:** 13 Oct 2026
**Covers:** the owner's 19:47 roadmap override (D-35)
**Code commits:**
- 24ab525 and 6257d9a (G1, `feat/g1-territory-geometry`)
- 8c4d55b (W1, `web/w1-review-preview`)

**Board:** [`../../product-roadmap/PR_QUEUE.md`](../../product-roadmap/PR_QUEUE.md)

## 1. Status

- **RELEASE_GATE_STOP:** the live sequence X-06 → X-07 → X-05 → X-21 is stopped on owner actions.
  - X-06 is approved, but Render has no service yet. The connector cannot create one, so the owner must create it in the dashboard.
  - X-07, X-05 and X-21 each need their own approval.
- **ENGINEERING_CONTINUES:** G1 is in review. G2 needs the owner's V3 rule text (G0) before the territory ledger can be built.

## 2. Work done

| Packet | Result | Where |
|---|---|---|
| L0 | 42 open PRs classified; 31 are already in the release tree. Nothing closed or merged | PR_QUEUE.md |
| Board | Durable PR queue, design constraints, product status (v1 versus full game) | `docs/product-roadmap/` |
| G1 | Cells merged into GeoJSON map regions (no cell ids); owner-scoped `GET /movement/coverage` | 24ab525, draft #107 |
| G1 (2) | `cellsAlongRoute`: cells crossed between GPS samples. Gaps of 2 km or less are joined; inferred cells and gaps are counted. Not wired in yet | 6257d9a, draft #107 |
| W1 | Website review version (details below) | 8c4d55b, draft #108 |
| X-25 | Retention proposal: routine refresh rows kept 30 days, security rows 180 days. Not built | PR_QUEUE.md |

W1 website changes:
- No dates and no response-time promise.
- Network terms reduced to one roadmap line.
- No X placeholders and no app CTAs.
- Map-pin brand mark and geographic-area visuals instead of hexagons.
- Fixed the wallet sign-in fallback text.
- The 30-day deletion line is flagged BLOCKED_OWNER_PROOF.

## 3. Evidence levels

| Item | Code tested locally | Live verified | Device verified | Public approved |
|---|---|---|---|---|
| G1 regions + coverage endpoint | Yes: shared 170/170, backend 411/411 (PostgreSQL 16), API 17/17, build; CI green on #107 | No | No | n/a |
| G1 route cells | Yes: 6 new tests | No | No | n/a |
| W1 website | Yes, see the W1 checks below | Vercel preview only (not production) | No | **No (X-21)** |
| L3 session clean-up (#106) | Yes: CI green | No (X-06) | No | n/a |

W1 checks:
- 8 pages at 320, 360, 390, 768, 1024 and 1440 px, plus 200% text and 200% zoom: no overflow and no console errors.
- 44 px touch targets on phones and visible keyboard focus.
- Reduced motion has no continuous animation.
- sign-in/deletion e2e 23/23, wallet discovery 8/8, cold host 3/3, secret scan clean.

Red Vercel statuses on #106/#107 (`arena`, `arena-pchb`, `arena-qg9n`) also fail on #105 (9 Sep). They are dashboard project settings, not this work; this is noted on both PRs.

## 4. What was deliberately NOT changed (mobile/website/live resources)

- **Mobile:** nothing under `movenrun/mobile/` (frontend hold).
- **Website live:** movenrun.xyz, DNS and Vercel production are untouched. Vercel builds automatic previews of pushed branches; no setting was changed.
- **Live resources:** no Render service created or deployed. No Supabase change (ref `tavxmwuwkeynbnzfwove` untouched; the other project never touched). No migration, provider enablement, contract change, onchain transaction or spending.
- **Git:** `deploy/render-free-staging` still at dd83065 (X-24). `main` untouched. No merge, no force-push, no PR closed.
- **Data:** no deletion of audit rows (X-25 is a proposal only).

## 5. Branches pushed

- `chore/post-security-launch-prep`: board, ledgers, this report. Draft #106 → `release/android-v1-cxfdbd`.
- `feat/g1-territory-geometry` (6257d9a): draft #107 → chore branch.
- `web/w1-review-preview` (8c4d55b): draft #108 → chore branch.

## 6. Owner decisions from W1

1. Keep the "© 2026" copyright line?
2. Deletion proof: a staff-side deletion procedure must be defined and tested (`ACCOUNT_DELETION_OPERATIONS.md`, item c) before "within 30 days" can stay.
3. A real X profile later, or none. All X links are removed for now.

Screenshots (before/after, 36 PNGs) are in the project files under `movenrun-play-launch/website-preview-w1/`.

## 7. Next owner actions

1. **X-06:** create the Render Blueprint service from `deploy/render-free-staging` in the Render dashboard. I then verify `/health`, `/ready`, the logs and the migrations through the connector.
2. **X-21:** review the W1 website (packet plus screenshots) and answer yes or no to publishing.
