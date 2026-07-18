import express from "express";
import { getConfig } from "./config.js";
import gpsRouter from "./routes/gps.js";
import zonesRouter from "./routes/zones.js";
import battlesRouter from "./routes/battles.js";
import usersRouter from "./routes/users.js";
import { createProductionIdentityRouter } from "./identity/http/productionRouter.js";
import { createCorsMiddleware, createSecurityHeadersMiddleware } from "./middleware/security.js";
import { createGlobalRateLimiter } from "./middleware/rateLimit.js";

const app = express();
const config = getConfig();

// Security headers, CORS allowlist, and a light app-wide rate limit apply
// before anything else — see middleware/security.ts, middleware/rateLimit.ts.
app.use(createSecurityHeadersMiddleware());
app.use(createCorsMiddleware());
app.use(createGlobalRateLimiter());

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
