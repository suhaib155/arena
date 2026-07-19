/**
 * Provider webhook HTTP boundary.
 *
 * Mounted BEFORE the app-wide express.json() (see index.ts) so this route
 * owns its body handling: express.raw with an explicit size limit, so the
 * verifier sees the EXACT raw bytes — signature verification happens before
 * any parsing, and generic JSON parsing never touches webhook requests.
 *
 * Fail-closed: when webhooks are disabled (no provider selected / no signing
 * key configured — the current production state per ADR-0011), every request
 * receives a stable 503 `provider_not_configured`. There is no debug mode,
 * no verification bypass, and no fake verifier.
 *
 * Responses are stable and non-attacker-helpful:
 *   401 verification_failed  — any signature/timestamp/key failure
 *   400 invalid_request      — verified but malformed payload
 *   413 invalid_request      — oversized body (from the raw parser limit)
 *   415 invalid_request      — wrong content type
 *   200 {received:true}      — accepted (duplicate deliveries included:
 *                              idempotent success, no second side effect)
 * Raw bodies and signatures are never logged.
 */
import { Router, raw, type NextFunction, type Request, type Response } from "express";
import type { AuditService } from "../services/audit.service.js";
import type { ProviderWebhookVerifier } from "./types.js";
import { WebhookVerificationError } from "./types.js";
import type { ProviderEventService } from "./eventService.js";

export const WEBHOOK_BODY_LIMIT = "256kb";

export interface WebhookRouterDeps {
  /** null = webhooks disabled → every request fails closed with 503. */
  verifier: ProviderWebhookVerifier | null;
  events: ProviderEventService | null;
  audit: AuditService;
  now?: () => Date;
}

export function createProviderWebhookRouter(deps: WebhookRouterDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  router.post(
    "/provider",
    // Raw bytes only, bounded size. Content-type must be JSON — anything else
    // never reaches the verifier.
    raw({ type: "application/json", limit: WEBHOOK_BODY_LIMIT }),
    (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        if (!deps.verifier || !deps.events) {
          res.status(503).json({ error: { code: "provider_not_configured" } });
          return;
        }
        if (!Buffer.isBuffer(req.body)) {
          // express.raw only populates a Buffer for the matching content-type.
          res.status(415).json({ error: { code: "invalid_request" } });
          return;
        }
        try {
          const event = await deps.verifier.verify({
            rawBody: req.body,
            headers: {
              "x-movenrun-webhook-key-id": req.header("x-movenrun-webhook-key-id"),
              "x-movenrun-webhook-timestamp": req.header("x-movenrun-webhook-timestamp"),
              "x-movenrun-webhook-signature": req.header("x-movenrun-webhook-signature"),
            },
            now: now(),
          });
          const { duplicate, digestMismatch } = await deps.events.ingest(event);
          if (digestMismatch) {
            // Same event id, different payload — a security anomaly (audited in
            // ingest). Stable 409; the first delivery's content is authoritative.
            res.status(409).json({ error: { code: "conflict" } });
            return;
          }
          // Duplicates are idempotent success — the provider must not retry.
          res.status(200).json({ received: true, duplicate });
        } catch (err) {
          if (err instanceof WebhookVerificationError) {
            // Coarse failure class to the audit trail; stable response to the
            // caller. Never the signature or body.
            await deps.audit.record("webhook_rejected", { metadata: { reason: err.reason } });
            const status = err.reason === "malformed_payload" ? 400 : 401;
            res.status(status).json({
              error: { code: err.reason === "malformed_payload" ? "invalid_request" : "verification_failed" },
            });
            return;
          }
          next(err instanceof Error ? err : new Error(String(err)));
        }
      })().catch(next);
    }
  );

  // Router-scoped error boundary: raw-parser errors (oversized body) become a
  // stable 413 instead of leaking through the generic 500 handler.
  router.use((err: Error & { type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type === "entity.too.large") {
      res.status(413).json({ error: { code: "invalid_request" } });
      return;
    }
    next(err);
  });

  return router;
}
