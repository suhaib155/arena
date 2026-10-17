import express, { type ErrorRequestHandler } from "express";
import {
  users, authIdentities, authSessions, emailOtpChallenges, securityAuditEvents, wallets, walletLinkChallenges,
  accountCapacity, walletSignInChallenges, pendingAuthUserDeletions, walletSignInHandoffs, authUserCreations, googleSignInExchanges,
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
import { createMaintenance } from "./maintenance.js";
import { trustProxySetting } from "./trustedProxies.js";
import { gameplayRulesFromEnv } from "../gameplay/rules.js";
import { createProductionGameplay } from "../gameplay/wiring.js";

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
  // Background clean-up, run when due on start, after requests and once a
  // minute while awake, so a free host that sleeps still catches up on wake
  // (see maintenance.ts). Nothing here guards a request: the cap, quota,
  // expiry and revocation are checked in the database when used.
  //  - Provider users left by an erased account (provider unreachable at the
  //    time) and by wallet codes the app never collected.
  //  - Provider users that never became a MovenRun account (sweepOrphanProviderUsers).
  //  - Sign-in sessions a week past their refresh expiry: every refresh adds
  //    a row, and Supabase Free holds 500 MB (FREE_HOSTING_READINESS.md).
  // Gameplay (G3/G4) is off unless MOVENRUN_GAMEPLAY_ENABLED is "true": no
  // route, no task and no query against its tables (migration 0011 is only
  // proposed). Enabling it is an owner decision; see G34_SERVER_ARCHITECTURE.md.
  const gameplayRules = gameplayRulesFromEnv();
  const gameplay = gameplayRules
    ? createProductionGameplay({
      db,
      rules: gameplayRules,
      verifyBearer: async (token) => ({ userId: (await identity.sessions.verifyAccess(token)).userId }),
      rateLimit: config,
    })
    : null;
  const maintenance = createMaintenance([
    {
      name: "pending sign-in deletions",
      everyMs: 5 * 60 * 1000,
      run: async () => (await supabaseSignIn.expireHandoffs()) + (await supabaseSignIn.retryPendingDeletions()),
    },
    { name: "unused sign-in records", everyMs: 30 * 60 * 1000, run: () => supabaseSignIn.sweepOrphanProviderUsers() },
    { name: "expired sign-in sessions", everyMs: 60 * 60 * 1000, run: () => identity.sessions.pruneExpiredSessions() },
    ...(gameplay ? [gameplay.dayClose] : []),
  ]);
  maintenance.start();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxySetting(config.TRUST_PROXY, config.TRUST_PROXY_HOPS));
  app.use(maintenance.afterResponse);
  app.use(createSecurityHeadersMiddleware(), createCorsMiddleware(config));
  app.use(createGlobalRateLimiter(config));
  app.get("/health", (_req, res) => { res.json({ status: "ok" }); });
  app.get("/ready", async (_req, res) => {
    try {
      // Probe migrated columns, not just database connectivity. No rows or
      // coordinates are selected and no connection errors reach the logs.
      for (const table of [users, authIdentities, authSessions, emailOtpChallenges, securityAuditEvents, wallets, walletLinkChallenges,
        accountCapacity, walletSignInChallenges, pendingAuthUserDeletions, walletSignInHandoffs, authUserCreations, googleSignInExchanges, movementVerifications]) {
        await db.select().from(table).limit(0);
      }
      res.json({ status: "ready", database: "ready", signIn: "supabase" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  // Authentication entry is public, but still subject to the write limit,
  // checked before any body is read.
  app.use("/identity/auth", createWriteRateLimiter(config));
  // Identity bodies are a token, a signed message or a code: a few kilobytes
  // at most. Only a movement session (up to 10,000 points) needs more, so the
  // larger limit applies there alone and nobody can make the public sign-in
  // routes parse megabytes.
  app.use("/identity", express.json({ limit: "32kb" }));
  app.use("/movement", express.json({ limit: "2mb" }));
  app.use("/identity", createIdentityRouter(identity, {
    accountDeletion: createDrizzleAccountDeletionStore(db),
    supabaseSignIn,
    emailOtpEnabled: false,
  }));
  app.use("/movement", createProductionMovementRouter(config));
  if (gameplay) {
    app.use("/gameplay", express.json({ limit: "8kb" }));
    app.use("/gameplay", gameplay.router);
  }
  app.use((_req, res) => { res.status(404).json({ error: "not_found" }); });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error?.type === "entity.too.large" ? 413 : error?.type === "entity.parse.failed" ? 400 : 500;
    res.status(status).json({ error: status === 413 ? "payload_too_large" : status === 400 ? "invalid_request" : "internal_error" });
  };
  // Never log request bodies, tokens, provider responses or raw GPS.
  app.use(errors);
  return app;
}
