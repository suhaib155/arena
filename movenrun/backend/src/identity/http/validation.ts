/**
 * Request validation for the identity/wallet HTTP surface.
 *
 * Every schema is `.strict()`, so an UNKNOWN field is a hard rejection — this
 * is what structurally guarantees "no endpoint accepts mnemonic/private-key-
 * shaped input": there is no field for a mnemonic or private key anywhere, and
 * a body that tries to smuggle one in is rejected before any handler runs.
 * `assertNoSecretShapedInput` is a belt-and-braces second check that scans keys
 * and string values for seed-phrase / raw-key shapes and refuses them, so even
 * a future non-strict schema can't regress the seed-phrase policy (ADR-0008).
 */
import { z } from "zod";
import { IdentityError } from "../domain/errors.js";
import { WALLET_TYPES } from "../domain/types.js";

const address = z.string().min(1).max(100);
const walletType = z.enum(WALLET_TYPES as unknown as [string, ...string[]]);

export const emailOtpBeginSchema = z.object({ email: z.string().min(3).max(254) }).strict();
export const emailOtpCompleteSchema = z
  .object({ email: z.string().min(3).max(254), code: z.string().min(4).max(12) })
  .strict();

export const refreshSchema = z.object({ refreshToken: z.string().min(10).max(4096) }).strict();

export const linkBeginSchema = z
  .object({
    action: z.enum(["link_external_wallet", "base_account_login"]),
    address,
    chainId: z.number().int().positive(),
    walletType,
  })
  .strict();

export const linkCompleteSchema = z
  .object({
    nonce: z.string().min(1).max(256),
    address,
    signature: z.string().min(1).max(4096),
    walletType,
    chainId: z.number().int().positive(),
    action: z.enum(["link_external_wallet", "base_account_login"]),
    sourceProvider: z.string().min(1).max(64),
  })
  .strict();

export const walletIdSchema = z.object({ walletId: z.string().min(1).max(128) }).strict();
export const identityIdSchema = z.object({ identityId: z.string().min(1).max(128) }).strict();

/** Keys that must never appear in any request body — a hard seed-phrase/key
 *  policy backstop independent of individual schemas. */
const FORBIDDEN_KEY = /(mnemonic|seed[_-]?phrase|seedphrase|private[_-]?key|privatekey|secret[_-]?key|recovery[_-]?phrase|passphrase|keystore)/i;
/** A 12/15/18/21/24-word lowercase phrase (BIP-39 shape) or a raw 32-byte hex key. */
const SEED_PHRASE_SHAPE = /^\s*([a-z]+\s+){11,23}[a-z]+\s*$/i;
const RAW_PRIVATE_KEY_SHAPE = /^0x?[0-9a-f]{64}$/i;

/**
 * Reject any body that carries a seed-phrase / raw-private-key shaped key or
 * value. Applied to every request before schema parsing. Never logs the
 * offending value.
 */
export function assertNoSecretShapedInput(body: unknown): void {
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || value == null) return;
    if (typeof value === "string") {
      if (SEED_PHRASE_SHAPE.test(value) || RAW_PRIVATE_KEY_SHAPE.test(value)) {
        throw new IdentityError("invalid_request", "request contains prohibited secret-shaped input");
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) visit(v, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (FORBIDDEN_KEY.test(k)) {
          throw new IdentityError("invalid_request", "request contains a prohibited field");
        }
        visit(v, depth + 1);
      }
    }
  };
  visit(body, 0);
}

/** Parse `body` with `schema`, converting a Zod failure into a stable
 *  `invalid_request` IdentityError (never a stack/500). */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  assertNoSecretShapedInput(body);
  const result = schema.safeParse(body);
  if (!result.success) throw new IdentityError("invalid_request");
  return result.data;
}
