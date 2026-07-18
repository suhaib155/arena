/**
 * Generic HMAC-SHA-256 webhook verifier (ADR-0013).
 *
 * This is real, provider-neutral verification infrastructure — NOT a fake
 * adapter: it implements the widely-used timestamped-HMAC scheme (the same
 * family as Stripe/Svix signing) over the RAW request bytes, with bounded
 * clock skew, key-version pinning, and a bounded previous-key overlap window
 * for rotation. When a concrete provider is selected, its adapter either maps
 * the provider's header format onto this verifier or replaces it — either way
 * the interface (types.ts) is the boundary.
 *
 * Signature scheme (headers are lower-case):
 *   x-movenrun-webhook-key-id     — which signing key produced the signature
 *   x-movenrun-webhook-timestamp  — unix seconds at signing time
 *   x-movenrun-webhook-signature  — hex HMAC-SHA-256 over:
 *        "movenrun.webhook.v1\n" + keyId + "\n" + timestamp + "\n" + rawBody
 *
 * Security properties:
 *  - verification happens on the RAW bytes before any JSON parsing;
 *  - the context label domain-separates this HMAC use from every other
 *    HMAC in the codebase (same rationale as the access-token context);
 *  - comparison is timing-safe (crypto/secure.ts safeEqual);
 *  - stale/future timestamps beyond maxSkewSeconds are rejected;
 *  - an unknown key id is rejected; the previous key is accepted only until
 *    its configured expiry (bounded overlap — no unlimited historical keys);
 *  - errors carry a coarse reason class only — never the signature/body.
 */
import { createHash, createHmac } from "node:crypto";
import { safeEqual } from "../crypto/secure.js";
import type { WebhookKey } from "../providerConfig.js";
import {
  WebhookVerificationError,
  type ProviderWebhookVerifier,
  type VerifiedProviderEvent,
  type VerifyWebhookInput,
} from "./types.js";

export const WEBHOOK_HEADER_KEY_ID = "x-movenrun-webhook-key-id";
export const WEBHOOK_HEADER_TIMESTAMP = "x-movenrun-webhook-timestamp";
export const WEBHOOK_HEADER_SIGNATURE = "x-movenrun-webhook-signature";

const CONTEXT = "movenrun.webhook.v1\n";
const SIGNATURE_RE = /^[0-9a-f]{64}$/i;

export interface HmacWebhookVerifierOptions {
  provider: string;
  currentKey: WebhookKey;
  previousKey?: (WebhookKey & { expiresAt: Date }) | null;
  maxSkewSeconds: number;
}

/** Compute the signature for raw bytes — exported so tests (and a future
 *  internal sender) can produce valid signatures without duplicating the
 *  scheme. Never used to ACCEPT input except via verify(). */
export function computeWebhookSignature(key: WebhookKey, timestamp: string, rawBody: Buffer): string {
  return createHmac("sha256", key.secret)
    .update(CONTEXT)
    .update(`${key.keyId}\n${timestamp}\n`)
    .update(rawBody)
    .digest("hex");
}

export class HmacWebhookVerifier implements ProviderWebhookVerifier {
  readonly provider: string;
  private readonly currentKey: WebhookKey;
  private readonly previousKey: (WebhookKey & { expiresAt: Date }) | null;
  private readonly maxSkewSeconds: number;

  constructor(opts: HmacWebhookVerifierOptions) {
    this.provider = opts.provider;
    this.currentKey = opts.currentKey;
    this.previousKey = opts.previousKey ?? null;
    this.maxSkewSeconds = opts.maxSkewSeconds;
  }

  private resolveKey(keyId: string, now: Date): WebhookKey {
    if (keyId === this.currentKey.keyId) return this.currentKey;
    if (this.previousKey && keyId === this.previousKey.keyId) {
      if (now.getTime() > this.previousKey.expiresAt.getTime()) {
        throw new WebhookVerificationError("expired_key");
      }
      return this.previousKey;
    }
    throw new WebhookVerificationError("unknown_key_version");
  }

  async verify(input: VerifyWebhookInput): Promise<VerifiedProviderEvent> {
    const keyId = input.headers[WEBHOOK_HEADER_KEY_ID];
    const timestamp = input.headers[WEBHOOK_HEADER_TIMESTAMP];
    const signature = input.headers[WEBHOOK_HEADER_SIGNATURE];

    if (!signature) throw new WebhookVerificationError("missing_signature");
    if (!keyId || !SIGNATURE_RE.test(signature)) throw new WebhookVerificationError("malformed_signature");
    if (!timestamp) throw new WebhookVerificationError("missing_timestamp");

    const tsSeconds = Number(timestamp);
    if (!Number.isInteger(tsSeconds) || tsSeconds <= 0) {
      throw new WebhookVerificationError("missing_timestamp");
    }
    const skew = input.now.getTime() / 1000 - tsSeconds;
    if (skew > this.maxSkewSeconds) throw new WebhookVerificationError("stale_timestamp");
    if (-skew > this.maxSkewSeconds) throw new WebhookVerificationError("future_timestamp");

    const key = this.resolveKey(keyId, input.now);
    const expected = computeWebhookSignature(key, timestamp, input.rawBody);
    if (!safeEqual(signature.toLowerCase(), expected)) {
      throw new WebhookVerificationError("bad_signature");
    }

    // Only AFTER the signature verifies do we parse the payload.
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody.toString("utf8"));
    } catch {
      throw new WebhookVerificationError("malformed_payload");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new WebhookVerificationError("malformed_payload");
    }
    const body = parsed as Record<string, unknown>;
    const providerEventId = typeof body.id === "string" && body.id ? body.id : null;
    const eventType = typeof body.type === "string" && body.type ? body.type : null;
    if (!providerEventId || !eventType) throw new WebhookVerificationError("malformed_payload");

    const createdRaw = body.createdAt;
    let providerCreatedAt: Date | null = null;
    if (typeof createdRaw === "string") {
      const d = new Date(createdRaw);
      if (!Number.isNaN(d.getTime())) providerCreatedAt = d;
    }

    return {
      provider: this.provider,
      providerEventId,
      eventType,
      eventVersion: typeof body.version === "string" ? body.version : null,
      providerCreatedAt,
      payloadDigest: createHash("sha256").update(input.rawBody).digest("hex"),
      keyId: key.keyId,
      data: typeof body.data === "object" && body.data !== null && !Array.isArray(body.data)
        ? (body.data as Record<string, unknown>)
        : {},
    };
  }
}
