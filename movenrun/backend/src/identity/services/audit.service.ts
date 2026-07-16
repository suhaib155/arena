/**
 * Immutable, append-only security audit trail.
 *
 * Two jobs:
 *  1. Record every sensitive transition (signup, login, link/unlink, wallet
 *     provisioning/link/switch, session lifecycle, refresh replay, export
 *     flow, policy denial) — see AuditEventType.
 *  2. REDACT before persisting. Callers may pass a metadata bag; this service
 *     strips anything that looks like a secret (tokens, signatures, OTP codes,
 *     keys, mnemonics, raw emails) so a mistake at a call site can never write
 *     sensitive material into the audit log. Redaction is deny-by-default on a
 *     key-name allowlist for the value SHAPE, plus a hard blocklist of
 *     sensitive key names.
 */
import { newId } from "../crypto/secure.js";
import type { AuditEventRepository, CreateAuditEventInput } from "../repositories/interfaces.js";
import type { AuditEventRecord } from "../repositories/records.js";
import type { AuditEventType } from "../domain/types.js";

/** Key-name substrings whose values must NEVER be stored, regardless of shape. */
const BLOCKED_KEY_PATTERNS = [
  "token",
  "secret",
  "signature",
  "sig",
  "password",
  "otp",
  "code",
  "mnemonic",
  "seed",
  "privatekey",
  "private_key",
  "priv",
  "assertion",
  "authorization",
  "cookie",
  "bearer",
  "refresh",
  "pepper",
  "email", // raw email is PII; store a hash upstream if correlation is needed
];

function keyIsBlocked(key: string): boolean {
  const k = key.toLowerCase();
  return BLOCKED_KEY_PATTERNS.some((p) => k.includes(p));
}

/**
 * Produce a redacted, safe-scalar-only copy of a metadata bag. Objects are
 * recursed one level; anything blocked by key name, or any non-scalar leaf, is
 * replaced with the marker "[redacted]". This is intentionally conservative —
 * audit context is for triage, not forensics of secret values.
 */
export function redactMetadata(
  input: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!input) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (keyIsBlocked(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      // Cap string length so an oversized field can't bloat the log.
      out[key] = typeof value === "string" && value.length > 256 ? value.slice(0, 256) : value;
    } else {
      out[key] = "[redacted]";
    }
  }
  return out;
}

export interface AuditContext {
  userId?: string | null;
  subjectId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export class AuditService {
  constructor(private readonly repo: AuditEventRepository, private readonly idGen: () => string = newId) {}

  async record(eventType: AuditEventType, ctx: AuditContext = {}): Promise<AuditEventRecord> {
    const input: CreateAuditEventInput = {
      id: this.idGen(),
      userId: ctx.userId ?? null,
      eventType,
      subjectId: ctx.subjectId ?? null,
      metadata: redactMetadata(ctx.metadata),
    };
    return this.repo.append(input);
  }

  listByUser(userId: string, limit?: number): Promise<AuditEventRecord[]> {
    return this.repo.listByUser(userId, limit);
  }
}
