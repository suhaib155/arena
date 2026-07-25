import express from "express";
import IORedis from "ioredis";
import { getConfig } from "./config.js";
import gpsRouter from "./routes/gps.js";
import zonesRouter from "./routes/zones.js";
import battlesRouter from "./routes/battles.js";
import usersRouter from "./routes/users.js";
import {
  createProductionIdentityRouter,
  createProductionWebhookRouter,
  createTerritoryViewerServices,
} from "./identity/http/productionRouter.js";
import { createCorsMiddleware, createSecurityHeadersMiddleware } from "./middleware/security.js";
import { createGlobalRateLimiter } from "./middleware/rateLimit.js";
import { requireWalletAuth } from "./middleware/auth.js";
import { getTerritoryConfig } from "./territory/config.js";
import { createTerritoryRouter } from "./territory/http/router.js";
import { createSessionViewerResolver } from "./territory/http/viewer.js";
import { territoryBroadcaster } from "./territory/realtime.js";
import { startHeartbeat, subscribeToTerritoryChannel } from "./territory/realtimeBridge.js";
import { DrizzleTerritoryRepository } from "./territory/repository.drizzle.js";
import { getDb } from "./db/client.js";

const app = express();
const config = getConfig();
// Territory configuration is validated here, at startup, so an invalid
// production value fails the boot instead of silently mis-awarding territory
// on the first run of the day.
const territoryConfig = getTerritoryConfig();

// Security headers, CORS allowlist, and a light app-wide rate limit apply
// before anything else — see middleware/security.ts, middleware/rateLimit.ts.
app.use(createSecurityHeadersMiddleware());
app.use(createCorsMiddleware());
app.use(createGlobalRateLimiter());

// Provider webhooks own their raw-body handling (signature verification runs
// on the exact received bytes BEFORE parsing), so this mounts ahead of the
// app-wide JSON parser and is excluded from it. Fails closed (503) while no
// provider/webhook key is configured — see identity/webhooks/router.ts.
app.use("/identity/webhooks", createProductionWebhookRouter());

app.use(
  express.json({
    limit: "2mb",
    // Captures the exact request body bytes so middleware/auth.ts's body
    // hash binds to what was actually sent, not a re-serialization of it.
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);

// Liveness — always cheap, no dependency checks.
app.get("/health", (_req, res) => res.json({ status: "ok", ts: Date.now() }));

// Territory map, detail, history, realtime stream, and the runner's own
// capture result. Everything under /v1/territories is public map data (H3 cell
// polygons + truncated owner references, never raw GPS); the capture-result
// endpoint is wallet-authenticated and scoped to the signer's own route.
// `resolveViewer` derives identity from the caller's verified session only
// (D2) — see territory/http/viewer.ts. It reads no client-supplied identity
// claim, so there is nothing to spoof; an absent or invalid token simply yields
// an anonymous viewer, who sees held ground as `claimed` rather than `rival`.
app.use(
  "/v1",
  createTerritoryRouter({
    repository: new DrizzleTerritoryRepository(getDb()),
    config: territoryConfig,
    resolveViewer: createSessionViewerResolver(createTerritoryViewerServices()),
    requireAuth: requireWalletAuth(),
  })
);

app.use("/gps", gpsRouter);
app.use("/zones", zonesRouter);
app.use("/battles", battlesRouter);
app.use("/users", usersRouter);
// Identity & wallet foundation. Readiness (provider/config status) is exposed
// at /identity/ready, separate from the liveness probe above.
app.use("/identity", createProductionIdentityRouter());

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

/**
 * Realtime bridge (D1).
 *
 * Captures are applied by the BullMQ worker, in a *different process*, so an
 * in-process broadcast reached zero SSE subscribers. The worker now publishes
 * each committed ownership change to Redis and every API process subscribes
 * here, handing what it receives to its own broadcaster.
 *
 * The subscriber needs its own connection: ioredis puts a connection into
 * subscriber mode, after which it can no longer run ordinary commands, so this
 * must never share the BullMQ connection.
 *
 * Failing to connect degrades the live feed only. Territory itself stays
 * correct and readable over HTTP, and the app reconciles on its next map fetch,
 * so this logs and carries on rather than refusing to serve.
 */
const realtimeSubscriber = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
subscribeToTerritoryChannel(realtimeSubscriber, territoryBroadcaster, {
  onDropped: (reason) => console.warn(`territory realtime: dropped a message (${reason})`),
}).catch((error) => {
  console.error("territory realtime: subscription failed, live updates are off", error);
});
const stopHeartbeat = startHeartbeat(territoryBroadcaster);

const server = app.listen(config.PORT, () => {
  console.log(`MovenRun API running on port ${config.PORT} (${config.NODE_ENV})`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    stopHeartbeat();
    // Close the streams explicitly: an SSE connection has no natural end, so
    // without this the server waits for clients that will never disconnect.
    territoryBroadcaster.closeAll();
    realtimeSubscriber.quit().catch(() => undefined);
    server.close(() => process.exit(0));
  });
}

export default app;
