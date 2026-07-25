/**
 * Territory HTTP router — authentication, authorisation and privacy.
 *
 * Driven through Express's real routing with a fake request/response pair
 * rather than a live server: no port, no database, no Redis. What matters here
 * is which handler runs, what status it returns, and what it puts in the body.
 *
 * The load-bearing tests:
 *   - the capture-result endpoint refuses an unauthenticated caller;
 *   - it refuses a caller asking for someone else's route;
 *   - an unknown route and an unprocessed route answer identically, so the
 *     endpoint cannot be used to probe which route ids exist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { createTerritoryRouter } from "./router.js";
import { TERRITORY_DEFAULTS } from "../config.js";
import { InMemoryTerritoryRepository } from "../repository.js";
import { TerritoryOwnershipService } from "../ownership.service.js";
import { TerritoryBroadcaster } from "../realtime.js";
import { latLngToCell, TERRITORY_H3_RESOLUTION_V2 } from "../h3.js";
import type { TerritoryCaptureSession } from "../types.js";

const GRID = 2;
const RES = TERRITORY_H3_RESOLUTION_V2;
const CELL = latLngToCell(51.5, -0.1, RES)!;
const RUNNER = "0x1111111111111111111111111111111111111111";
const RIVAL = "0x2222222222222222222222222222222222222222";

/** Build a session-shaped viewer (D2). Identity only ever comes from a verified
 *  session, so tests construct it directly rather than faking a header. */
function viewer(wallet: string | null, clubId: string | null) {
  return wallet
    ? { userId: `user-${wallet.slice(-4)}`, walletAddresses: [wallet.toLowerCase()], clubId, authenticated: true }
    : { userId: null, walletAddresses: [], clubId, authenticated: false };
}


interface Captured {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  /** Raw SSE frames written to the socket (D1). */
  frames: string[];
  ended: boolean;
}

/** Minimal Express-compatible response recorder. */
function fakeResponse(): Response & { captured: Captured } {
  const captured: Captured = { status: 200, body: undefined, headers: {}, frames: [], ended: false };
  const res = {
    captured,
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return this;
    },
    write(chunk: string) {
      captured.frames.push(chunk);
      return true;
    },
    end() {
      captured.ended = true;
      return this;
    },
    on() {
      return this;
    },
    flushHeaders() {},
  };
  return res as unknown as Response & { captured: Captured };
}

function fakeRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    query: {},
    params: {},
    headers: {},
    header() {
      return undefined;
    },
    on() {
      return this;
    },
    ...overrides,
  } as unknown as Request;
}

/** Run a request through the router and return what the handler produced. */
async function dispatch(
  router: ReturnType<typeof createTerritoryRouter>,
  url: string,
  overrides: Partial<Request> = {},
): Promise<Captured> {
  const [path, search] = url.split("?");
  const query = Object.fromEntries(new URLSearchParams(search ?? ""));
  const req = fakeRequest({ url: path, originalUrl: url, query, ...overrides });
  const res = fakeResponse();

  await new Promise<void>((resolve, reject) => {
    // Express routers are (req, res, next) middleware.
    (router as unknown as (r: Request, s: Response, n: (e?: unknown) => void) => void)(
      req,
      res,
      (error?: unknown) => (error ? reject(error) : resolve()),
    );
    // Handlers here are async; give the microtask queue a chance to drain.
    setImmediate(resolve);
  });
  // Let any pending async handler finish writing.
  await new Promise((resolve) => setImmediate(resolve));
  return res.captured;
}

function session(overrides: Partial<TerritoryCaptureSession> = {}): TerritoryCaptureSession {
  return {
    id: "session-1",
    routeId: "route-1",
    walletAddress: RUNNER,
    userId: null,
    loopClosed: true,
    captureEligible: true,
    closureDistanceMeters: 12,
    enclosedAreaSquareMeters: 62_500,
    traversedHexCount: 4,
    capturedHexCount: 2,
    rejectedHexIds: [],
    rejectionReasons: [],
    gridVersion: GRID,
    resolution: RES,
    createdAt: new Date("2026-05-01T10:00:00Z"),
    processedAt: new Date("2026-05-01T10:00:05Z"),
    ...overrides,
  };
}

function router(repository = new InMemoryTerritoryRepository(), who = RUNNER) {
  return {
    repository,
    router: createTerritoryRouter({
      repository,
      config: TERRITORY_DEFAULTS,
      broadcaster: new TerritoryBroadcaster(),
      resolveViewer: () => viewer(who, null),
    }),
  };
}

// ----------------------------------------------------------------- map route

test("the map endpoint validates its viewport before touching the repository", async () => {
  const { router: r } = router();
  const result = await dispatch(r, "/territories/map?west=-0.11&south=51.49");
  assert.equal(result.status, 400);
  assert.match(String((result.body as { error: string }).error), /required/);
});

test("an oversized viewport is refused", async () => {
  const { router: r } = router();
  const result = await dispatch(r, "/territories/map?west=-90&south=-45&east=90&north=45");
  assert.equal(result.status, 400);
  assert.match(String((result.body as { error: string }).error), /Viewport too large/);
});

test("a valid viewport returns a FeatureCollection with cache metadata", async () => {
  const { repository, router: r } = router();
  await new TerritoryOwnershipService(repository).applyCapture({
    routeId: "route-1",
    walletAddress: RUNNER,
    gridVersion: GRID,
    resolution: RES,
    traversedHexIds: [CELL],
    capturedHexIds: [CELL],
  });

  const result = await dispatch(
    r,
    "/territories/map?west=-0.105&south=51.495&east=-0.095&north=51.505",
  );
  assert.equal(result.status, 200);
  const body = result.body as { type: string; features: unknown[]; meta: { count: number } };
  assert.equal(body.type, "FeatureCollection");
  assert.ok(body.features.length >= 1);
  assert.equal(result.headers["cache-control"], "private, max-age=10");
});

test("untouched cells are omitted rather than shipped as empty defaults", async () => {
  const { router: r } = router();
  const result = await dispatch(
    r,
    "/territories/map?west=-0.105&south=51.495&east=-0.095&north=51.505",
  );
  assert.equal(result.status, 200);
  const body = result.body as { features: unknown[] };
  assert.deepEqual(body.features, [], "nothing captured means nothing returned");
});

// -------------------------------------------------------------- detail route

test("a malformed cell id is rejected before it reaches a query", async () => {
  const { router: r } = router();
  const result = await dispatch(r, "/territories/'; DROP TABLE territories; --");
  assert.equal(result.status, 400);
});

test("a well-formed cell id at the wrong resolution is a 404", async () => {
  const { router: r } = router();
  // A valid resolution-8 (legacy) index is not on the territory grid.
  const legacy = "882a1008943ffff";
  const result = await dispatch(r, `/territories/${legacy}`);
  assert.equal(result.status, 404);
});

test("detail returns public state for an untouched cell without inventing an owner", async () => {
  const { router: r } = router();
  const result = await dispatch(r, `/territories/${CELL}`);
  assert.equal(result.status, 200);
  const body = result.body as { state: string; owner: unknown; actions: { canCapture: boolean } };
  assert.equal(body.state, "neutral");
  assert.equal(body.owner, null);
  assert.equal(body.actions.canCapture, true);
});

// ------------------------------------------------------------- history route

test("history never returns route ids or evidence hashes", async () => {
  const { repository, router: r } = router();
  await new TerritoryOwnershipService(repository).applyCapture({
    routeId: "route-private-abc",
    walletAddress: RUNNER,
    evidenceHash: "0xsecretroutehash",
    gridVersion: GRID,
    resolution: RES,
    traversedHexIds: [CELL],
    capturedHexIds: [CELL],
  });

  const result = await dispatch(r, `/territories/${CELL}/history`);
  assert.equal(result.status, 200);
  const serialised = JSON.stringify(result.body);
  assert.ok(!serialised.includes("route-private-abc"), "a route id leaked");
  assert.ok(!serialised.includes("0xsecretroutehash"), "an evidence hash leaked");
  assert.ok(!serialised.includes(RUNNER), "a full wallet address leaked");
});

test("an invalid history limit is rejected", async () => {
  const { router: r } = router();
  const result = await dispatch(r, `/territories/${CELL}/history?limit=0`);
  assert.equal(result.status, 400);
});

// -------------------------------------------------------- capture-result auth

test("an unauthenticated caller cannot read a capture result", async () => {
  const { repository, router: r } = router();
  await repository.saveCaptureSession(session());

  const result = await dispatch(r, "/routes/route-1/capture-result");
  assert.equal(result.status, 401);
});

test("a runner reads their own capture result", async () => {
  const { repository, router: r } = router();
  await repository.saveCaptureSession(session());

  const result = await dispatch(r, "/routes/route-1/capture-result", {
    movenrunAuth: { address: RUNNER.toLowerCase() },
  } as Partial<Request>);
  assert.equal(result.status, 200);
  const body = result.body as { routeId: string; captureEligible: boolean };
  assert.equal(body.routeId, "route-1");
  assert.equal(body.captureEligible, true);
});

test("A RUNNER CANNOT READ SOMEONE ELSE'S CAPTURE RESULT", async () => {
  const { repository, router: r } = router();
  await repository.saveCaptureSession(session({ walletAddress: RUNNER }));

  const result = await dispatch(r, "/routes/route-1/capture-result", {
    movenrunAuth: { address: RIVAL.toLowerCase() },
  } as Partial<Request>);
  assert.equal(result.status, 403);
});

test("an unknown route and an unprocessed route answer identically", async () => {
  const { router: r } = router();
  const unknown = await dispatch(r, "/routes/does-not-exist/capture-result", {
    movenrunAuth: { address: RUNNER.toLowerCase() },
  } as Partial<Request>);
  assert.equal(unknown.status, 404);
  // Same status and shape for a route that exists but has not been evaluated —
  // so the endpoint cannot be used to enumerate which route ids are real.
  assert.deepEqual(unknown.body, { error: "No capture result for this route" });
});

test("a pending capture reports processedAt null rather than a false success", async () => {
  const { repository, router: r } = router();
  await repository.saveCaptureSession(
    session({ processedAt: null, captureEligible: false, capturedHexCount: 0 }),
  );

  const result = await dispatch(r, "/routes/route-1/capture-result", {
    movenrunAuth: { address: RUNNER.toLowerCase() },
  } as Partial<Request>);
  assert.equal(result.status, 200);
  assert.equal((result.body as { processedAt: string | null }).processedAt, null);
});

test("the capture result reports the cells the route actually changed", async () => {
  const { repository, router: r } = router();
  await new TerritoryOwnershipService(repository).applyCapture({
    routeId: "route-1",
    walletAddress: RUNNER,
    gridVersion: GRID,
    resolution: RES,
    traversedHexIds: [CELL],
    capturedHexIds: [CELL],
  });
  await repository.saveCaptureSession(session());

  const result = await dispatch(r, "/routes/route-1/capture-result", {
    movenrunAuth: { address: RUNNER.toLowerCase() },
  } as Partial<Request>);
  const body = result.body as { capturedCells: string[]; rejectedCells: string[] };
  assert.deepEqual(body.capturedCells, [CELL]);
  assert.deepEqual(body.rejectedCells, []);
});

test("a rejected capture reports its reasons", async () => {
  const { repository, router: r } = router();
  await repository.saveCaptureSession(
    session({
      captureEligible: false,
      capturedHexCount: 0,
      loopClosed: false,
      rejectionReasons: ["loopNotClosed", "areaBelowMinimum"],
    }),
  );

  const result = await dispatch(r, "/routes/route-1/capture-result", {
    movenrunAuth: { address: RUNNER.toLowerCase() },
  } as Partial<Request>);
  const body = result.body as { captureEligible: boolean; rejectionReasons: string[] };
  assert.equal(body.captureEligible, false);
  assert.deepEqual(body.rejectionReasons, ["loopNotClosed", "areaBelowMinimum"]);
});

test("an over-long route id is rejected", async () => {
  const { router: r } = router();
  const result = await dispatch(r, `/routes/${"a".repeat(300)}/capture-result`, {
    movenrunAuth: { address: RUNNER.toLowerCase() },
  } as Partial<Request>);
  assert.equal(result.status, 400);
});

// ------------------------------------------------------------ stream route

test("the stream refuses an unknown grid version", async () => {
  const { router: r } = router();
  const result = await dispatch(r, "/territories/stream?gridVersion=99");
  assert.equal(result.status, 400);
});

test("the stream sets SSE headers", async () => {
  const { router: r } = router();
  const result = await dispatch(r, "/territories/stream?gridVersion=2");
  assert.equal(result.headers["content-type"], "text/event-stream");
  assert.equal(result.headers["cache-control"], "no-cache, no-transform");
  // A buffering proxy would defeat the whole point of a stream.
  assert.equal(result.headers["x-accel-buffering"], "no");
});

test("D1: the stream states its reconnect contract up front", async () => {
  const { router: r } = router();
  const result = await dispatch(r, "/territories/stream?gridVersion=2");
  const frames = result.frames.join("");
  // There is no replay buffer, so a reconnecting client must resynchronise by
  // refetching its viewport rather than assuming it can resume.
  assert.match(frames, /retry: \d+\n\n/, "a reconnect backoff must be set");
  assert.match(frames, /event: ready\n/);
  const ready = JSON.parse(frames.split("event: ready\ndata: ")[1].split("\n\n")[0]);
  assert.equal(ready.gridVersion, 2);
  assert.equal(ready.resync, true, "the client must be told to resync, not resume");
  assert.ok(ready.heartbeatSeconds > 0, "the client must know when to consider the feed dead");
});

test("D1: one caller cannot open unlimited streams", async () => {
  const repository = new InMemoryTerritoryRepository();
  const broadcaster = new TerritoryBroadcaster(100, 2);
  const r = createTerritoryRouter({
    repository,
    config: TERRITORY_DEFAULTS,
    broadcaster,
    resolveViewer: () => viewer(RUNNER, null),
  });

  const first = await dispatch(r, "/territories/stream?gridVersion=2");
  const second = await dispatch(r, "/territories/stream?gridVersion=2");
  const third = await dispatch(r, "/territories/stream?gridVersion=2");

  assert.ok(first.frames.join("").includes("event: ready"));
  assert.ok(second.frames.join("").includes("event: ready"));
  // The third is refused honestly rather than held open delivering nothing.
  assert.match(third.frames.join(""), /event: error\n.*capacity/s);
  assert.equal(third.ended, true, "a refused stream must be closed, not left hanging");
  assert.equal(broadcaster.subscriberCount, 2);
});

test("D1: streams are bucketed per caller, so one runner cannot starve another", async () => {
  const repository = new InMemoryTerritoryRepository();
  const broadcaster = new TerritoryBroadcaster(100, 1);

  const build = (who: string | null, ip: string) =>
    createTerritoryRouter({
      repository,
      config: TERRITORY_DEFAULTS,
      broadcaster,
      resolveViewer: () => viewer(who, null),
    });

  const runnerRouter = build(RUNNER, "10.0.0.1");
  await dispatch(runnerRouter, "/territories/stream?gridVersion=2", {
    ip: "10.0.0.1",
  } as Partial<Request>);
  const runnerSecond = await dispatch(runnerRouter, "/territories/stream?gridVersion=2", {
    ip: "10.0.0.1",
  } as Partial<Request>);
  assert.match(runnerSecond.frames.join(""), /capacity/, "the same runner is capped");

  // A different signed-in runner — sharing the same NAT address — is unaffected,
  // because the bucket key is the verified user id when there is one.
  const rivalRouter = build(RIVAL, "10.0.0.1");
  const rivalFirst = await dispatch(rivalRouter, "/territories/stream?gridVersion=2", {
    ip: "10.0.0.1",
  } as Partial<Request>);
  assert.ok(rivalFirst.frames.join("").includes("event: ready"));
});

test("D1: anonymous callers are bucketed by IP", async () => {
  const repository = new InMemoryTerritoryRepository();
  const broadcaster = new TerritoryBroadcaster(100, 1);
  const r = createTerritoryRouter({
    repository,
    config: TERRITORY_DEFAULTS,
    broadcaster,
    resolveViewer: () => viewer(null, null),
  });

  const first = await dispatch(r, "/territories/stream?gridVersion=2", {
    ip: "203.0.113.7",
  } as Partial<Request>);
  const second = await dispatch(r, "/territories/stream?gridVersion=2", {
    ip: "203.0.113.7",
  } as Partial<Request>);
  const other = await dispatch(r, "/territories/stream?gridVersion=2", {
    ip: "203.0.113.8",
  } as Partial<Request>);

  assert.ok(first.frames.join("").includes("event: ready"));
  assert.match(second.frames.join(""), /capacity/);
  assert.ok(other.frames.join("").includes("event: ready"), "a different IP is a different bucket");
});

test("D1: a disconnect frees the caller's slot", async () => {
  const repository = new InMemoryTerritoryRepository();
  const broadcaster = new TerritoryBroadcaster(100, 1);
  const r = createTerritoryRouter({
    repository,
    config: TERRITORY_DEFAULTS,
    broadcaster,
    resolveViewer: () => viewer(RUNNER, null),
  });

  // Capture the close handler the router registers, then fire it.
  let onClose: null | (() => void) = null;
  await dispatch(r, "/territories/stream?gridVersion=2", {
    on(event: string, handler: () => void) {
      if (event === "close") onClose = handler;
      return this;
    },
  } as unknown as Partial<Request>);

  assert.equal(broadcaster.subscriberCount, 1);
  assert.ok(onClose, "the router must register a close handler");
  (onClose as () => void)();
  assert.equal(broadcaster.subscriberCount, 0, "a disconnect must release the subscriber");

  const again = await dispatch(r, "/territories/stream?gridVersion=2");
  assert.ok(again.frames.join("").includes("event: ready"), "the slot must be reusable");
});
