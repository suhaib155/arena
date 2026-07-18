/**
 * Production wiring for the identity/wallet router: Drizzle/Postgres stores +
 * fail-closed identity config + NO external provider adapters (none is approved
 * or configured in this PR). Provider-dependent flows therefore fail closed.
 *
 * `getIdentityConfig()` exits the process on invalid production config, so a
 * deployment with incomplete identity settings never starts serving — the
 * fail-closed startup contract. Nothing here opens a DB connection at import
 * time: `getDb()` builds a lazy pool that connects on first query.
 */
import type { Router } from "express";
import { getDb } from "../../db/client.js";
import { getIdentityConfig } from "../config.js";
import { createDrizzleStores } from "../repositories/drizzle/stores.js";
import { createIdentityServices } from "./wiring.js";
import { createIdentityRouter } from "./router.js";

export function createProductionIdentityRouter(): Router {
  const config = getIdentityConfig();
  const stores = createDrizzleStores(getDb());
  // No provider adapters are wired in this PR — embedded wallet, email
  // delivery, Google OIDC, and the smart-account verifier all remain absent,
  // so their flows fail closed rather than fabricate a result.
  const services = createIdentityServices(stores, config, {});
  return createIdentityRouter(services);
}
