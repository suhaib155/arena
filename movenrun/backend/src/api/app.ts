import express, { type ErrorRequestHandler } from "express";
import {
  users, authIdentities, authSessions, emailOtpChallenges, securityAuditEvents, wallets, walletLinkChallenges,
  accountCapacity, walletSignInChallenges, pendingAuthUserDeletions, walletSignInHandoffs,
} from "../db/identity.schema.js";
import { movementVerifications } from "../db/movement.schema.js";
import { getDb } from "../db/client.js";
import { getIdentityConfig } from "../identity/config.js";
import { createDrizzleStores } from "../identity/repositories/drizzle/stores.js";
import { createIdentityServices } from "../identity/http/wiring.js";
import { createIdentityRouter } from "../identity/http/router.js";
import { createProductionMovementRouter } from "../movement/http/productionRouter.js";
import { createDrizzleAccountDeletionStore } from "../identity/accountDeletion.js";
import { SupabaseAuthClient, SupabaseTokenVerifier } from "../identity/providers/supabaseAuth.js";
import { EoaSignatureVerifier } from "../identity/providers/eoaVerifier.js";
import { createDrizzleSignInStores } from "../identity/repositories/signInStores.js";
import { DEFAULT_WALLET_CHAIN_ID, SupabaseSignInService } from "../identity/services/supabaseSignIn.service.js";
import { createCorsMiddleware, createSecurityHeadersMiddleware } from "../middleware/security.js";
import { createGlobalRateLimiter, createWriteRateLimiter } from "../middleware/rateLimit.js";
import type { ApiConfig } from "./config.js";

export function createApiApp(config: ApiConfig) {
  // Sign-in is Google or wallet through Supabase Auth only. The email-code
  // service is never wired here, whatever the environment holds, so no
  // deployment of this API can send a code or accept one.
  const db = getDb();
  const identityConfig = getIdentityConfig();
  const stores = createDrizzleStores(db);
  const identity = createIdentityServices(stores, identityConfig, { emailDelivery: null });
  const supabaseSignIn = new SupabaseSignInService({
    tokens: new SupabaseTokenVerifier(config.supabase),
    auth: new SupabaseAuthClient(config.supabase),
    stores,
    signIn: createDrizzleSignInStores(db),
    eoaVerifier: new EoaSignatureVerifier(),
    config: { authDomain: config.IDENTITY_AUTH_DOMAIN, chainId: identityConfig.allowedChainIds[0] ?? DEFAULT_WALLET_CHAIN_ID },
  });
  // Provider users left behind by an erased account (provider unreachable at
  // the time) are removed in the background until the provider confirms.
  // Wallet sign-in codes the app never collected release their provider user too.
  const retryDeletions = () => {
    supabaseSignIn.expireHandoffs()
      .then(() => supabaseSignIn.retryPendingDeletions())
      .catch(() => console.error("Pending sign-in deletions could not be retried"));
  };
  const retryTimer = setInterval(retryDeletions, 5 * 60 * 1000);
  retryTimer.unref();
  setTimeout(retryDeletions, 5_000).unref();
  // Provider users that never became a MovenRun account (see sweepOrphanProviderUsers).
  const sweepOrphans = () => {
    supabaseSignIn.sweepOrphanProviderUsers()
      .catch(() => console.error("Unused sign-in records could not be swept"));
  };
  const sweepTimer = setInterval(sweepOrphans, 30 * 60 * 1000);
  sweepTimer.unref();
  setTimeout(sweepOrphans, 60_000).unref();
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
      for (const table of [users, authIdentities, authSessions, emailOtpChallenges, securityAuditEvents, wallets, walletLinkChallenges,
        accountCapacity, walletSignInChallenges, pendingAuthUserDeletions, walletSignInHandoffs, movementVerifications]) {
        await db.select().from(table).limit(0);
      }
      res.json({ status: "ready", database: "ready", signIn: "supabase" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.use(express.json({ limit: "2mb" }));
  // Authentication entry is public, but still subject to the write limit.
  app.use("/identity/auth", createWriteRateLimiter(config));
  app.use("/identity", createIdentityRouter(identity, {
    accountDeletion: createDrizzleAccountDeletionStore(db),
    supabaseSignIn,
    emailOtpEnabled: false,
  }));
  app.use("/movement", createProductionMovementRouter(config));
  app.use((_req, res) => { res.status(404).json({ error: "not_found" }); });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error?.type === "entity.too.large" ? 413 : error?.type === "entity.parse.failed" ? 400 : 500;
    res.status(status).json({ error: status === 413 ? "payload_too_large" : status === 400 ? "invalid_request" : "internal_error" });
  };
  // Never log request bodies, tokens, provider responses or raw GPS.
  app.use(errors);
  return app;
}
