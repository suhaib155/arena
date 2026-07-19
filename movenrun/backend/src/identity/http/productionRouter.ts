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
import { getProviderConfig } from "../providerConfig.js";
import { createDrizzleStores } from "../repositories/drizzle/stores.js";
import { AuditService } from "../services/audit.service.js";
import { createIdentityServices } from "./wiring.js";
import { createIdentityRouter } from "./router.js";
import { DrizzleProviderEventStore } from "../webhooks/eventStore.drizzle.js";
import { ProviderEventService } from "../webhooks/eventService.js";
import { HmacWebhookVerifier } from "../webhooks/hmacVerifier.js";
import { createProviderWebhookRouter } from "../webhooks/router.js";

export function createProductionIdentityRouter(): Router {
  const config = getIdentityConfig();
  const providerConfig = getProviderConfig();
  const stores = createDrizzleStores(getDb());
  // No provider adapters are wired (ADR-0011 is Blocked) — embedded wallet,
  // email delivery, Google OIDC, and the smart-account verifier all remain
  // absent, so their flows fail closed rather than fabricate a result.
  const services = createIdentityServices(stores, config, {}, {
    providerName: providerConfig.providerName,
    providerStatus: providerConfig.providerStatus,
    webhooksEnabled: providerConfig.webhooks.enabled,
  });
  return createIdentityRouter(services);
}

/**
 * Production webhook router. Must be mounted BEFORE the app-wide
 * express.json() so it owns raw-body handling (see webhooks/router.ts).
 * With webhooks disabled (the current production state), the verifier and
 * event service are null and every request fails closed with a stable 503.
 * The production handler registry is empty by design — verified events are
 * stored durably and then ignored until provider event semantics exist.
 */
export function createProductionWebhookRouter(): Router {
  const providerConfig = getProviderConfig();
  const audit = new AuditService(createDrizzleStores(getDb()).audit);
  const webhooks = providerConfig.webhooks;
  if (!webhooks.enabled || !webhooks.currentKey) {
    return createProviderWebhookRouter({ verifier: null, events: null, audit });
  }
  const verifier = new HmacWebhookVerifier({
    provider: providerConfig.providerName,
    currentKey: webhooks.currentKey,
    previousKey: webhooks.previousKey,
    maxSkewSeconds: webhooks.maxSkewSeconds,
  });
  const events = new ProviderEventService({
    store: new DrizzleProviderEventStore(getDb()),
    audit,
    // Empty allowlist until ADR-0011 selects a provider: every verified event
    // is durably stored, then ignored + audited by the processor.
    handlers: new Map(),
  });
  return createProviderWebhookRouter({ verifier, events, audit });
}
