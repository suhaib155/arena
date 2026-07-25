import express from "express";
import { getConfig } from "./config.js";
import gpsRouter from "./routes/gps.js";
import zonesRouter from "./routes/zones.js";
import battlesRouter from "./routes/battles.js";
import usersRouter from "./routes/users.js";
import { createProductionIdentityRouter, createProductionWebhookRouter } from "./identity/http/productionRouter.js";
import { createCorsMiddleware, createSecurityHeadersMiddleware } from "./middleware/security.js";
import { createGlobalRateLimiter } from "./middleware/rateLimit.js";
import { requireWalletAuth } from "./middleware/auth.js";
import { getTerritoryConfig } from "./territory/config.js";
import { createTerritoryRouter } from "./territory/http/router.js";
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
app.use(
  "/v1",
  createTerritoryRouter({
    repository: new DrizzleTerritoryRepository(getDb()),
    config: territoryConfig,
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

app.listen(config.PORT, () => {
  console.log(`MovenRun API running on port ${config.PORT} (${config.NODE_ENV})`);
});

export default app;
