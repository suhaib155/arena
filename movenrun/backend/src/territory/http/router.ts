/**
 * Territory HTTP API.
 *
 * Routes:
 *   GET /v1/territories/map                  — viewport-scoped GeoJSON
 *   GET /v1/territories/stream               — realtime ownership changes (SSE)
 *   GET /v1/territories/:cellId              — one cell's public detail
 *   GET /v1/territories/:cellId/history      — public ownership history
 *   GET /v1/routes/:routeId/capture-result   — the runner's own capture result
 *
 * ## Privacy posture
 * The first four are public map data: H3 cell polygons (deterministic from a
 * cell id, identical for every viewer) and truncated owner references. They
 * carry no raw GPS, no route path, and no coordinate list — see `views.ts`.
 *
 * `/v1/routes/:routeId/capture-result` is private. It requires wallet-signature
 * auth and returns only the authenticated signer's own route. Even then it
 * returns cell ids and scalar summaries, never the route's points.
 *
 * ## Viewer identity (D2)
 * Ownership *relationship* (`mine` / `club` / `rival`) is computed **only** from
 * a verified session — see `viewer.ts`. Nothing here reads an identity claim
 * from a header, query parameter or body, so there is nothing to spoof.
 *
 * The public endpoints still accept an unauthenticated caller and return them
 * exactly the same cells, scores and geometry. Only the label differs: held
 * ground reads `claimed` rather than `rival`, because `rival` asserts the cell
 * belongs to somebody other than the viewer and that is not knowable without an
 * identity. Asserting it anyway is what made a runner's own territory render in
 * rival colours.
 */
import { Router, type Request, type Response } from "express";
import { getTerritoryConfig, type TerritoryConfig } from "../config.js";
import { cellsInBoundingBox, getNeighboringCells, isCellOnGrid, resolutionForGridVersion } from "../h3.js";
import type { TerritoryRepository } from "../repository.js";
import { neutralTerritory } from "../rules.js";
import { territoryBroadcaster, type TerritoryBroadcaster } from "../realtime.js";
import { ANONYMOUS_VIEWER, type TerritoryViewer } from "../rules.js";
import {
  capFeatures,
  validateCellId,
  validateHistoryLimit,
  validateMapViewport,
} from "./validation.js";
import {
  dedupeTerritories,
  describeCaptureRequirements,
  sortTerritoriesForViewer,
  toDetailResponse,
  toMapResponse,
  toPublicEvent,
  type CaptureResultResponse,
  type Viewer,
} from "./views.js";

export interface TerritoryRouterDeps {
  repository: TerritoryRepository;
  config?: TerritoryConfig;
  broadcaster?: TerritoryBroadcaster;
  /**
   * Resolves the caller's identity for relationship labelling from their
   * verified session (see http/viewer.ts). Injected so the router does not bind
   * to a particular identity implementation, and so tests can drive every
   * viewer case without minting real tokens.
   *
   * Defaults to anonymous. A deployment that does not wire this up therefore
   * labels held ground `claimed` for everyone — never `mine` for the wrong
   * person, which is the direction that matters.
   */
  resolveViewer?: (req: Request) => TerritoryViewer | Promise<TerritoryViewer>;
  /** Reads the route's lifecycle status. Injected to avoid importing the
   *  route repository (which would drag `@movenrun/shared` into scope). */
  getRouteOwnerAndStatus?: (
    routeId: string,
  ) => Promise<{ walletAddress: string; status: string } | null>;
  /** Middleware applied to the private capture-result endpoint. */
  requireAuth?: ReturnType<typeof import("../../middleware/auth.js").requireWalletAuth>;
}

/**
 * Default viewer: anonymous.
 *
 * Deliberately NOT header-derived. The previous default read the unverified
 * `x-movenrun-address` header, which is spoofable and which the mobile client
 * never sent anyway — so it produced `rival` for everyone (D2). Falling back to
 * anonymous is both safe and honest: a deployment that has not wired
 * `resolveViewer` labels held ground `claimed`, never `mine` for the wrong
 * person.
 */
function defaultResolveViewer(): TerritoryViewer {
  return ANONYMOUS_VIEWER;
}

export function createTerritoryRouter(deps: TerritoryRouterDeps): Router {
  const router = Router();
  const config = deps.config ?? getTerritoryConfig();
  const broadcaster = deps.broadcaster ?? territoryBroadcaster;
  const resolveViewer = deps.resolveViewer ?? defaultResolveViewer;
  const { repository } = deps;

  // ------------------------------------------------------------------ map
  router.get("/territories/map", async (req: Request, res: Response) => {
    const validated = validateMapViewport(req.query as Record<string, unknown>, config);
    if (!validated.ok) {
      return res.status(400).json({ error: validated.error });
    }
    const { west, south, east, north, gridVersion } = validated.value;
    const resolution = resolutionForGridVersion(gridVersion) ?? config.resolution;
    const viewer = await resolveViewer(req);

    // D3 — the order of these four steps is the whole fix.
    //
    // This used to cap the *candidate cell list* and then look those up, which
    // meant a wide viewport (≈10 000 candidates against a 2 000 cap) could
    // return zero features while genuinely owned territory sat at candidate
    // index 5 000. The limit now falls on matched rows, never on candidates.

    // 1. Every cell the viewport covers. Bounded by the viewport-area cap that
    //    validateMapViewport already enforced, so this list is never unbounded.
    const candidates = cellsInBoundingBox({ west, south, east, north }, resolution);

    // 2. Only rows that actually exist. Chunked inside the repository — the
    //    candidate list is far too long for a single IN clause. Untouched cells
    //    are absent by construction here, rather than being fabricated as
    //    neutral defaults and filtered out afterwards.
    const persisted = await repository.findPersistedCells(candidates, gridVersion);

    // 3. Deduplicate, then order deterministically: mine, club, contested,
    //    rival, protected, neutral, restricted — and cell id as a stable
    //    tiebreak, so re-requesting the same viewport returns the same set.
    const ordered = sortTerritoriesForViewer(dedupeTerritories(persisted), viewer);

    // 4. Only now apply the response limit, and report truncation against the
    //    number of matched territories — not against the candidate count.
    const capped = capFeatures(ordered, config);

    const response = toMapResponse(capped.items, viewer, {
      gridVersion,
      resolution,
      total: capped.total,
      truncated: capped.truncated,
    });

    // Short-lived caching: territory changes on a human timescale, and a few
    // seconds of staleness is invisible next to the cost of re-querying every
    // pan. `private` because the response is labelled per viewer.
    res.setHeader("Cache-Control", "private, max-age=10");
    return res.json(response);
  });

  // --------------------------------------------------------------- stream
  router.get("/territories/stream", (req: Request, res: Response) => {
    const gridVersion = Number(req.query.gridVersion ?? config.gridVersion);
    if (!Number.isInteger(gridVersion) || resolutionForGridVersion(gridVersion) === null) {
      return res.status(400).json({ error: `Unknown gridVersion: ${req.query.gridVersion}` });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const unsubscribe = broadcaster.subscribe(res, gridVersion);
    if (!unsubscribe) {
      // At capacity: refuse honestly rather than holding a connection that will
      // never receive anything.
      res.write("event: error\ndata: {\"error\":\"stream capacity reached\"}\n\n");
      res.end();
      return;
    }

    res.write(`event: ready\ndata: {"gridVersion":${gridVersion}}\n\n`);
    req.on("close", unsubscribe);
    return undefined;
  });

  // --------------------------------------------------------- cell history
  // Registered BEFORE /:cellId so "/:cellId/history" is not swallowed by it.
  router.get("/territories/:cellId/history", async (req: Request, res: Response) => {
    const cellId = validateCellId(req.params.cellId);
    if (!cellId.ok) return res.status(400).json({ error: cellId.error });

    const limit = validateHistoryLimit(req.query.limit);
    if (!limit.ok) return res.status(400).json({ error: limit.error });

    const gridVersion = config.gridVersion;
    const events = await repository.findCellHistory(cellId.value, gridVersion, limit.value);
    // toPublicEvent strips route ids and evidence hashes — those are private
    // references into a runner's own route record.
    return res.json({
      cellId: cellId.value,
      gridVersion,
      events: events.map(toPublicEvent),
    });
  });

  // ---------------------------------------------------------- cell detail
  router.get("/territories/:cellId", async (req: Request, res: Response) => {
    const cellId = validateCellId(req.params.cellId);
    if (!cellId.ok) return res.status(400).json({ error: cellId.error });

    const gridVersion = config.gridVersion;
    const resolution = resolutionForGridVersion(gridVersion) ?? config.resolution;
    if (!isCellOnGrid(cellId.value, resolution)) {
      return res.status(404).json({ error: "Cell is not on the territory grid" });
    }

    const neighbourIds = getNeighboringCells(cellId.value);
    const [records, events] = await Promise.all([
      repository.findCells([cellId.value, ...neighbourIds], gridVersion, resolution),
      repository.findCellHistory(cellId.value, gridVersion, 10),
    ]);

    const territory =
      records.get(cellId.value) ?? neutralTerritory(cellId.value, gridVersion, resolution);
    const neighbours = neighbourIds
      .map((id) => records.get(id))
      .filter((record): record is NonNullable<typeof record> => record !== undefined);

    const viewer = await resolveViewer(req);
    return res.json(
      toDetailResponse(
        territory,
        neighbours,
        events,
        viewer,
        describeCaptureRequirements(config),
      ),
    );
  });

  // ------------------------------------------------------- capture result
  const captureResultHandler = async (req: Request, res: Response) => {
    const routeId = req.params.routeId;
    if (typeof routeId !== "string" || routeId.length === 0 || routeId.length > 128) {
      return res.status(400).json({ error: "routeId is required" });
    }

    const signer = req.movenrunAuth?.address;
    if (!signer) return res.status(401).json({ error: "Authentication required" });

    const session = await repository.findCaptureSessionByRouteId(routeId);
    if (!session) {
      // A route with no capture session either does not exist or has not been
      // processed yet. Both answer the same way, so this cannot be used to
      // probe which route ids exist.
      return res.status(404).json({ error: "No capture result for this route" });
    }

    // A runner may only read their own capture result.
    if (session.walletAddress.toLowerCase() !== signer) {
      return res.status(403).json({ error: "Route does not belong to the signer" });
    }

    const [route, events] = await Promise.all([
      deps.getRouteOwnerAndStatus?.(routeId) ?? Promise.resolve(null),
      repository.findEventsByRoute(routeId, session.gridVersion),
    ]);

    // The per-cell breakdown comes from the immutable ownership events this
    // route actually produced, not from what the route claimed to enclose.
    const capturedCells: string[] = [];
    const reinforcedCells: string[] = [];
    const attackedCells: string[] = [];
    for (const event of events) {
      switch (event.eventType) {
        case "captured":
        case "transferred":
          capturedCells.push(event.h3CellId);
          break;
        case "reinforced":
          reinforcedCells.push(event.h3CellId);
          break;
        case "attacked":
        case "contested":
          attackedCells.push(event.h3CellId);
          break;
        default:
          break;
      }
    }

    const response: CaptureResultResponse = {
      routeId,
      routeStatus: route?.status ?? "UNKNOWN",
      loopClosed: session.loopClosed,
      captureEligible: session.captureEligible,
      closureDistanceMeters: session.closureDistanceMeters,
      enclosedAreaSquareMeters: session.enclosedAreaSquareMeters,
      gridVersion: session.gridVersion,
      resolution: session.resolution,
      capturedCells,
      reinforcedCells,
      attackedCells,
      // Cells the loop covered but that produced no event: restricted,
      // protected, or lost to a concurrent capture.
      rejectedCells: session.rejectedHexIds,
      rejectionReasons: session.rejectionReasons,
      processedAt: session.processedAt ? session.processedAt.toISOString() : null,
    };
    return res.json(response);
  };

  if (deps.requireAuth) {
    router.get("/routes/:routeId/capture-result", deps.requireAuth, captureResultHandler);
  } else {
    router.get("/routes/:routeId/capture-result", captureResultHandler);
  }

  return router;
}
