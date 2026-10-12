import express, { type ErrorRequestHandler } from "express";
import { users, authIdentities, authSessions, emailOtpChallenges, securityAuditEvents, wallets, walletLinkChallenges } from "../db/identity.schema.js";
import { movementVerifications } from "../db/movement.schema.js";
import { getDb } from "../db/client.js";
import { getIdentityConfig } from "../identity/config.js";
import { createDrizzleStores } from "../identity/repositories/drizzle/stores.js";
import { createIdentityServices } from "../identity/http/wiring.js";
import { createIdentityRouter } from "../identity/http/router.js";
import { createResendEmailDelivery, EmailOtpDeliveryError } from "../identity/providers/resendEmail.js";
import { createProductionMovementRouter } from "../movement/http/productionRouter.js";
import { createCorsMiddleware, createSecurityHeadersMiddleware } from "../middleware/security.js";
import { createGlobalRateLimiter, createWriteRateLimiter } from "../middleware/rateLimit.js";
import type { ApiConfig } from "./config.js";

export function createApiApp(config: ApiConfig) {
  const emailDelivery = createResendEmailDelivery();
  const db = getDb();
  const identity = createIdentityServices(createDrizzleStores(db), getIdentityConfig(), { emailDelivery });
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.use(createSecurityHeadersMiddleware(), createCorsMiddleware(config));
  app.use(createGlobalRateLimiter(config));
  app.get("/health", (_req, res) => { res.json({ status: "ok" }); });
  app.get("/ready", async (_req, res) => {
    try {
      // Probe migrated columns, not just database connectivity. No rows or
      // coordinates are selected and no connection errors reach the logs.
      for (const table of [users, authIdentities, authSessions, emailOtpChallenges, securityAuditEvents, wallets, walletLinkChallenges, movementVerifications]) {
        await db.select().from(table).limit(0);
      }
      res.status(emailDelivery ? 200 : 503).json({
        status: emailDelivery ? "ready" : "unavailable",
        database: "ready", emailDelivery: emailDelivery ? "configured" : "unconfigured",
      });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.use(express.json({ limit: "2mb" }));
  // Authentication entry is public, but still subject to the write limit.
  app.use("/identity/auth", createWriteRateLimiter(config));
  app.use("/identity", createIdentityRouter(identity));
  app.use("/movement", createProductionMovementRouter(config));
  app.use((_req, res) => { res.status(404).json({ error: "not_found" }); });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof EmailOtpDeliveryError) {
      res.status(503).json({ error: "email_delivery_unavailable" });
      return;
    }
    const status = error?.type === "entity.too.large" ? 413 : error?.type === "entity.parse.failed" ? 400 : 500;
    res.status(status).json({ error: status === 413 ? "payload_too_large" : status === 400 ? "invalid_request" : "internal_error" });
  };
  // Never log request bodies, tokens, OTPs, provider responses or raw GPS.
  app.use(errors);
  return app;
}
