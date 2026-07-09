/**
 * Rate limiting — a light global limit for every backend route, plus a
 * stricter limit for write endpoints (POST/PUT/PATCH/DELETE), keyed by IP and,
 * once `requireWalletAuth` has run, the verified wallet address too.
 */
import rateLimit, { ipKeyGenerator, type Options as RateLimitOptions } from "express-rate-limit";
import type { Request, Response } from "express";
import { getConfig, type Config } from "../config.js";

function safeJsonRateLimitHandler(_req: Request, res: Response): void {
  // Never leak internals (store state, limiter config) in the response body.
  res.status(429).json({ error: "Too many requests, please try again later" });
}

type RateLimitConfig = Pick<
  Config,
  "RATE_LIMIT_WINDOW_MS" | "RATE_LIMIT_MAX" | "RATE_LIMIT_WRITE_MAX"
>;

const commonOptions: Partial<RateLimitOptions> = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: safeJsonRateLimitHandler,
};

/** Applied once, app-wide (index.ts) — coarse volumetric protection by IP. */
export function createGlobalRateLimiter(config: RateLimitConfig = getConfig()) {
  return rateLimit({
    ...commonOptions,
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit: config.RATE_LIMIT_MAX,
  });
}

/**
 * Applied per-route to write endpoints (POST /gps/submit, POST /zones/mint,
 * POST /battles/declare). Mount AFTER `requireWalletAuth()` so a verified
 * wallet address is available to the key generator — unauthenticated
 * requests never reach this limiter (they're already rejected by auth), but
 * they're still covered by the app-wide `createGlobalRateLimiter`.
 */
export function createWriteRateLimiter(config: RateLimitConfig = getConfig()) {
  return rateLimit({
    ...commonOptions,
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit: config.RATE_LIMIT_WRITE_MAX,
    keyGenerator: (req: Request) => {
      // ipKeyGenerator normalizes/subnets IPv6 addresses so a client can't
      // dodge the limit by cycling through addresses in the same /56 — see
      // https://express-rate-limit.github.io/ERR_ERL_KEY_GEN_IPV6/.
      const ip = ipKeyGenerator(req.ip ?? "unknown");
      const wallet = req.movenrunAuth?.address;
      return wallet ? `${ip}:${wallet}` : ip;
    },
  });
}
