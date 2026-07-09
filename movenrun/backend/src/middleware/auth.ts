/**
 * Wallet-signature authentication for backend write endpoints.
 *
 * A caller proves control of a wallet by signing a short, canonical message
 * (see `buildSignedMessage`) over the request's method, path, body hash, a
 * nonce, an issuedAt timestamp, and the chain id, then sending the signature
 * plus the claim in four headers:
 *
 *   x-movenrun-address     — the claimed wallet address (0x-prefixed, 40 hex)
 *   x-movenrun-signature   — personal_sign / wallet.signMessage over the
 *                            canonical message below
 *   x-movenrun-nonce       — a per-request random string (replay protection)
 *   x-movenrun-issued-at   — ms since epoch when the message was signed
 *
 * `requireWalletAuth()` verifies the signature recovers to the claimed
 * address, rejects expired or replayed requests, and attaches
 * `req.movenrunAuth.address` (lowercased) for downstream handlers. It does
 * NOT check that the verified signer matches any particular request-body
 * field (e.g. `walletAddress`, `challengerAddress`) — that binding is
 * route-specific and is enforced in each route handler after body validation
 * (see routes/gps.ts, routes/zones.ts, routes/battles.ts).
 *
 * Signed message format (newline-joined):
 *   MovenRun Backend Auth
 *   Address: <address>
 *   Method: <HTTP method, upper-case>
 *   Path: <request path, no query string>
 *   BodyHash: <0x-prefixed keccak256 of the raw request body bytes>
 *   Nonce: <nonce>
 *   IssuedAt: <issuedAt, ms since epoch, as a string>
 *   ChainId: <chain id>
 */
import { ethers } from "ethers";
import type { NextFunction, Request, Response } from "express";
import { getConfig } from "../config.js";

export const AUTH_HEADER_ADDRESS = "x-movenrun-address";
export const AUTH_HEADER_SIGNATURE = "x-movenrun-signature";
export const AUTH_HEADER_NONCE = "x-movenrun-nonce";
export const AUTH_HEADER_ISSUED_AT = "x-movenrun-issued-at";

export interface VerifiedAuth {
  /** The signature-verified wallet address, lowercased for comparison. */
  address: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      movenrunAuth?: VerifiedAuth;
      /** Raw request body bytes, captured by express.json()'s `verify` hook
       *  in index.ts so the auth body hash binds to exactly what was sent. */
      rawBody?: Buffer;
    }
  }
}

/**
 * In-memory nonce cache — replay protection for a single process only. This
 * is NOT production-grade: it doesn't survive a restart and doesn't work
 * across more than one backend instance. A DB-backed `usedAuthNonces` table
 * is the follow-up once this runs behind more than one instance — see
 * docs/CONTRACTS_AUDIT.md "Auth nonce replay protection".
 */
const seenNonces = new Map<string, number>(); // `${address}:${nonce}` -> expiry ms

function pruneExpiredNonces(now: number): void {
  for (const [key, expiry] of seenNonces) {
    if (expiry <= now) seenNonces.delete(key);
  }
}

/** Exported for tests only — do not use as a general-purpose reset. */
export function _resetNonceCacheForTests(): void {
  seenNonces.clear();
}

interface SignedMessageInput {
  address: string;
  method: string;
  path: string;
  bodyHash: string;
  nonce: string;
  issuedAt: string;
  chainId: bigint;
}

function buildSignedMessage(input: SignedMessageInput): string {
  return [
    "MovenRun Backend Auth",
    `Address: ${input.address}`,
    `Method: ${input.method.toUpperCase()}`,
    `Path: ${input.path}`,
    `BodyHash: ${input.bodyHash}`,
    `Nonce: ${input.nonce}`,
    `IssuedAt: ${input.issuedAt}`,
    `ChainId: ${input.chainId.toString()}`,
  ].join("\n");
}

/**
 * Hashes the exact bytes that were sent as the request body. Falls back to
 * re-serializing the parsed body when `rawBody` wasn't captured (e.g. no
 * body-parser `verify` hook wired up) — callers that need the hash to bind to
 * exactly what was transmitted should ensure `rawBody` is set (see
 * index.ts's `express.json({ verify })`).
 */
export function hashBody(rawBody: Buffer | undefined, parsedBody: unknown): string {
  const bytes = rawBody && rawBody.length > 0 ? rawBody : Buffer.from(JSON.stringify(parsedBody ?? {}));
  return ethers.keccak256(bytes);
}

export interface RequireWalletAuthOptions {
  /** Overridable for tests; defaults to config AUTH_MAX_AGE_SECONDS. */
  maxAgeSeconds?: number;
  /** Overridable for tests; defaults to config CHAIN_ID. */
  chainId?: number | bigint;
}

const WALLET_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const CLOCK_SKEW_MS = 5_000;

/**
 * Express middleware factory: verifies a wallet-signed request. Rejects with
 * 401 on any of: missing headers, malformed address, unparsable issuedAt,
 * expired/future-skewed issuedAt, a replayed nonce, or a signature that
 * doesn't recover to the claimed address. On success, attaches
 * `req.movenrunAuth = { address }` (lowercased) and calls `next()`.
 */
export function requireWalletAuth(options: RequireWalletAuthOptions = {}) {
  return function walletAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    const address = req.header(AUTH_HEADER_ADDRESS);
    const signature = req.header(AUTH_HEADER_SIGNATURE);
    const nonce = req.header(AUTH_HEADER_NONCE);
    const issuedAt = req.header(AUTH_HEADER_ISSUED_AT);

    if (!address || !signature || !nonce || !issuedAt) {
      res.status(401).json({ error: "Missing wallet authentication headers" });
      return;
    }
    if (!WALLET_ADDRESS_RE.test(address)) {
      res.status(401).json({ error: "Invalid wallet address" });
      return;
    }

    const issuedAtMs = Number(issuedAt);
    if (!Number.isFinite(issuedAtMs)) {
      res.status(401).json({ error: "Invalid issuedAt" });
      return;
    }

    // Only reads (and validates) env when an override isn't supplied — keeps
    // unit tests hermetic and avoids getConfig()'s process.exit on missing
    // env, same as OracleService's constructor (see oracle.service.ts).
    const maxAgeSeconds = options.maxAgeSeconds ?? getConfig().AUTH_MAX_AGE_SECONDS;
    const chainId = BigInt(options.chainId ?? getConfig().CHAIN_ID);
    const now = Date.now();
    if (issuedAtMs > now + CLOCK_SKEW_MS || now - issuedAtMs > maxAgeSeconds * 1000) {
      res.status(401).json({ error: "Request expired or issuedAt out of range" });
      return;
    }

    const nonceKey = `${address.toLowerCase()}:${nonce}`;
    pruneExpiredNonces(now);
    if (seenNonces.has(nonceKey)) {
      res.status(401).json({ error: "Nonce already used" });
      return;
    }

    const bodyHash = hashBody(req.rawBody, req.body);
    const message = buildSignedMessage({
      address,
      method: req.method,
      path: (req.originalUrl || req.path).split("?")[0],
      bodyHash,
      nonce,
      issuedAt,
      chainId,
    });

    let recovered: string;
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    if (recovered.toLowerCase() !== address.toLowerCase()) {
      res.status(401).json({ error: "Signature does not match claimed address" });
      return;
    }

    // Only burn the nonce once the signature has actually verified, so an
    // attacker spamming garbage signatures can't burn a legitimate wallet's
    // nonce ahead of the real request.
    seenNonces.set(nonceKey, now + maxAgeSeconds * 1000);

    req.movenrunAuth = { address: recovered.toLowerCase() };
    next();
  };
}

export interface BuildAuthHeadersInput {
  wallet: ethers.Wallet;
  method: string;
  path: string;
  body?: unknown;
  nonce?: string;
  issuedAt?: number;
  chainId?: number | bigint;
}

/**
 * Test helper: builds the four x-movenrun-* headers for a wallet-signed
 * request using the exact message format `requireWalletAuth` verifies, so
 * tests can't drift from the real verification logic. Not used by any
 * production code path — no mobile/client signing UX is added by this PR.
 */
export async function buildAuthHeaders(input: BuildAuthHeadersInput): Promise<Record<string, string>> {
  const nonce = input.nonce ?? `${input.wallet.address}-${Math.random().toString(36).slice(2)}-${input.issuedAt ?? Date.now()}`;
  const issuedAt = String(input.issuedAt ?? Date.now());
  const chainId = BigInt(input.chainId ?? 84532);
  const bodyBytes = Buffer.from(JSON.stringify(input.body ?? {}));
  const bodyHash = ethers.keccak256(bodyBytes);
  const address = input.wallet.address;
  const message = buildSignedMessage({
    address,
    method: input.method,
    path: input.path,
    bodyHash,
    nonce,
    issuedAt,
    chainId,
  });
  const signature = await input.wallet.signMessage(message);
  return {
    [AUTH_HEADER_ADDRESS]: address,
    [AUTH_HEADER_SIGNATURE]: signature,
    [AUTH_HEADER_NONCE]: nonce,
    [AUTH_HEADER_ISSUED_AT]: issuedAt,
  };
}
